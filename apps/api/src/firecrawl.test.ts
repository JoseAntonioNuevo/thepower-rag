// GUÍA DE LECTURA · apps/api/src/firecrawl.test.ts
// Pruebas del cliente Firecrawl con red simulada: contrato de búsqueda y lectura, créditos, errores
// HTTP, cuerpos inválidos, tope de bytes y cancelación.
// Dominios por defecto y límites.
import { DEFAULT_RESEARCH_DOMAINS, RESEARCH_LIMITS } from "@thepower-rag/contracts";
// Comprobador de URL permitidas.
import { checkUrl } from "@thepower-rag/research";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que se prueban.
import {
  createFirecrawlReader,
  createFirecrawlSearch,
  FIRECRAWL_SCRAPE_URL,
  FIRECRAWL_SEARCH_URL,
  readBounded,
} from "./firecrawl";

// Contexto de llamada: señal y plazo.
const context = { signal: new AbortController().signal, timeoutMs: 10_000 };

// Respuesta JSON simulada con estado y cabeceras extra.
function jsonResponse(body: unknown, status = 200, extra?: Record<string, string>): Response {
  // Response con el JSON.
  return new Response(JSON.stringify(body), {
    status,
    headers:
      extra === undefined
        ? { "content-type": "application/json" }
        : { "content-type": "application/json", ...extra },
  });
}

// Cuerpo de la petición como texto.
function requestText(body: BodyInit | null | undefined): string {
  // Texto o vacío.
  return typeof body === "string" ? body : "";
}

// Grupo de pruebas de Firecrawl.
describe("adaptador Firecrawl con red simulada", () => {
  // La búsqueda envía el contrato y sin tarifa deja usd en null.
  it("envía el contrato de búsqueda y no convierte créditos sin precio", async () => {
    // Contador.
    let calls = 0;
    // Cuerpo enviado.
    let body: unknown;
    // Cabecera de autorización enviada.
    let authorization = "";
    // Buscador con fetch que registra la petición.
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async (url, init) => {
        // Cuenta.
        calls += 1;
        // URL de búsqueda.
        expect(url).toBe(FIRECRAWL_SEARCH_URL);
        // Guarda el cuerpo.
        body = JSON.parse(requestText(init?.body));
        // Guarda la autorización.
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        // Un resultado y 2 créditos.
        return jsonResponse({
          // Respuesta de búsqueda válida con un resultado web.
          success: true,
          data: {
            web: [
              {
                url: "https://docs.langchain.com/langgraph",
                title: "LangGraph",
                description: "Persistencia",
              },
            ],
          },
          // Créditos que se convierten en consumo.
          creditsUsed: 2,
        });
      },
    });
    // Busca.
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 5 },
      context,
    );
    // Una llamada.
    expect(calls).toBe(1);
    // Clave como Bearer.
    expect(authorization).toBe("Bearer test-key");
    // Contrato enviado.
    expect(body).toMatchObject({
      query: "langgraph",
      limit: 5,
      includeDomains: ["docs.langchain.com"],
      ignoreInvalidURLs: true,
    });
    // Correcto.
    expect(result.ok).toBe(true);
    // URL del resultado.
    expect(result.ok ? result.value[0]?.url : "").toContain("docs.langchain.com");
    // Créditos sin USD.
    expect(result.consumption).toEqual({ kind: "reported", credits: 2, usd: null });
  });

  // Con tarifa, los créditos se convierten a USD.
  it("convierte créditos a USD solo con un precio explícito", async () => {
    // Buscador con 0,01 USD por crédito.
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: 0.01,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => jsonResponse({ success: true, data: { web: [] }, creditsUsed: 2 }),
    });
    // Busca.
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // 2 créditos × 0,01 = 0,02 USD.
    expect(result.consumption).toEqual({ kind: "reported", credits: 2, usd: 0.02 });
  });

  // Sin créditos informados, consumo desconocido.
  it("sin créditos informados el consumo queda desconocido", async () => {
    // Respuesta sin creditsUsed.
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: 0.01,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => jsonResponse({ success: true, data: { web: [] } }),
    });
    // Busca.
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Desconocido.
    expect(result.consumption).toEqual({ kind: "unknown" });
  });

  // Sin clave no hay red.
  it("no llama a la red si falta la credencial", async () => {
    // Contador.
    let calls = 0;
    // Clave en blanco.
    const search = createFirecrawlSearch({
      apiKey: "  ",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => {
        // Cuenta.
        calls += 1;
        // Respuesta vacía.
        return jsonResponse({});
      },
    });
    // Busca.
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Sin llamadas.
    expect(calls).toBe(0);
    // Bloqueado y sin consumo.
    expect(result).toMatchObject({ ok: false, error: "blocked", consumption: { kind: "none" } });
  });

  // 401 no cobra; 503 deja el cargo desconocido.
  it("distingue un HTTP de cliente de un fallo cuyo cargo es desconocido", async () => {
    // Responde 401.
    const unauthorized = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => jsonResponse({ error: "no" }, 401),
    });
    // Responde 503.
    const unavailable = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => jsonResponse({ error: "down" }, 503),
    });
    // Busca con el 401.
    const denied = await unauthorized.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Busca con el 503.
    const down = await unavailable.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Sin cargo.
    expect(denied).toMatchObject({ ok: false, error: "provider", consumption: { kind: "none" } });
    // Cargo desconocido.
    expect(down).toMatchObject({ ok: false, error: "provider", consumption: { kind: "unknown" } });
  });

  // Cuerpo no JSON o con otra forma: invalid.
  it("rechaza un cuerpo mal formado o con una forma inesperada", async () => {
    // Responde texto.
    const malformed = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => new Response("no-json", { status: 200 }),
    });
    // Responde success false.
    const shaped = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => jsonResponse({ success: false }),
    });
    // Busca.
    const badJson = await malformed.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Busca.
    const badShape = await shaped.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Inválido.
    expect(badJson).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "unknown" },
    });
    // Inválido.
    expect(badShape).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "unknown" },
    });
  });

  // Respuesta que declara o acumula más bytes que el tope.
  it("corta una respuesta que declara o acumula más bytes del tope", async () => {
    // Declara 50 bytes con tope 8.
    const declared = await readBounded(
      new Response("demasiado", { headers: { "content-length": "50" } }),
      8,
    );
    // null.
    expect(declared).toBeNull();
    // Stream de 10 bytes.
    const stream = new Response(
      new ReadableStream({
        // Doble de prueba: inicializa la fuente del stream y encola los datos definidos por este adaptador.
        start(controller) {
          // Encola el texto.
          controller.enqueue(new TextEncoder().encode("0123456789"));
          // Cierra.
          controller.close();
        },
      }),
    );
    // Con tope 4, null.
    expect(await readBounded(stream, 4)).toBeNull();
    // Buscador que declara más del tope.
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () =>
        new Response("x", {
          status: 200,
          headers: { "content-length": String(RESEARCH_LIMITS.maxSearchResponseBytes + 1) },
        }),
    });
    // Busca.
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    // Inválido.
    expect(result).toMatchObject({ ok: false, error: "invalid" });
  });

  // La lectura usa v2 y devuelve la URL final aunque no esté permitida.
  it("la lectura usa el contrato v2 y conserva una URL final no permitida", async () => {
    // Cuerpo enviado.
    let body: unknown;
    // Lector con reloj fijo.
    const reader = createFirecrawlReader({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
      now: () => Date.parse("2026-10-10T00:00:00.000Z"),
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async (url, init) => {
        // URL de lectura.
        expect(url).toBe(FIRECRAWL_SCRAPE_URL);
        // Guarda el cuerpo.
        body = JSON.parse(requestText(init?.body));
        // Página que redirige a un dominio ajeno.
        return jsonResponse({
          // Lectura válida pero cuya URL final es de un dominio no permitido.
          success: true,
          data: {
            markdown: "Texto de la página.",
            metadata: {
              title: "Fuera",
              // url: destino final; sourceURL: lo que se pidió.
              url: "https://evil.example/secret",
              sourceURL: "https://docs.langchain.com/langgraph",
              statusCode: 200,
            },
          },
          // Créditos.
          creditsUsed: 2,
        });
      },
    });
    // Lee.
    const result = await reader.read({ url: "https://docs.langchain.com/langgraph" }, context);
    // Contrato enviado.
    expect(body).toMatchObject({
      url: "https://docs.langchain.com/langgraph",
      formats: [{ type: "markdown" }],
      onlyMainContent: true,
      proxy: "basic",
    });
    // Correcto.
    expect(result.ok).toBe(true);
    // URL final.
    const finalUrl = result.ok ? result.value.finalUrl : "";
    // Es la ajena.
    expect(finalUrl).toBe("https://evil.example/secret");
    // El grafo la rechazará: no está permitida.
    expect(checkUrl(finalUrl, DEFAULT_RESEARCH_DOMAINS).ok).toBe(false);
    // Créditos sin USD.
    expect(result.consumption).toEqual({ kind: "reported", credits: 2, usd: null });
  });

  // Cancelada: error aborted, no página.
  it("una señal abortada no se trata como una página leída", async () => {
    // Controlador.
    const controller = new AbortController();
    // Cancela.
    controller.abort();
    // Lector cuyo fetch lanza AbortError.
    const reader = createFirecrawlReader({
      apiKey: "test-key",
      usdPerCredit: null,
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async (_url, init) => {
        // La señal llega cancelada.
        expect(init?.signal?.aborted).toBe(true);
        // Error de cancelación.
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    // Lee.
    const result = await reader.read(
      { url: "https://docs.langchain.com/langgraph" },
      { signal: controller.signal, timeoutMs: 5_000 },
    );
    // Error aborted.
    expect(result).toMatchObject({ ok: false, error: "aborted", consumption: { kind: "unknown" } });
  });
});
