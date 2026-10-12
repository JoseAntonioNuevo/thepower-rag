// GUÍA DE LECTURA · apps/api/src/tavily.test.ts
// Pruebas de Tavily como buscador de la investigación: selección por configuración, reserva por
// crédito, contrato de búsqueda y lectura, bloqueo de URL y errores sin reintentos.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Adaptadores de Tavily.
import { createTavilyReader, createTavilySearch } from "./tavily";
// Lectura de los ajustes de investigación.
import { researchSettings } from "./env";
// Tarifas congeladas y tope de salida del modelo.
import {
  parsePriceSnapshot,
  priceSnapshot,
  RESEARCH_PRICE_VERSION_V2,
  searchProviderForSnapshot,
  modelOutputCap,
} from "./research-money";

// Contexto de llamada: señal y plazo de 5 segundos.
const context = { signal: new AbortController().signal, timeoutMs: 5000 };
// Variables de entorno de prueba con Tavily como buscador.
const settings = {
  RESEARCH_MODEL_ID: "claude-haiku-5-5",
  RESEARCH_SEARCH_PROVIDER: "tavily",
  TAVILY_API_KEY: "test-key",
  RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
  RESEARCH_BUDGET_USD: "1",
  RESEARCH_JOB_LIMIT_USD: "0.25",
  RESEARCH_INPUT_USD_PER_MILLION: "0.1",
  RESEARCH_OUTPUT_USD_PER_MILLION: "0.5",
  TAVILY_USD_PER_CREDIT: "0.008",
};

// Cuerpo JSON de una petición simulada.
function requestJson(init: RequestInit): unknown {
  // Si no es texto, la prueba falla.
  if (typeof init.body !== "string") {
    // Error claro.
    throw new Error("Se esperaba un cuerpo JSON serializado.");
  }
  // JSON parseado.
  return JSON.parse(init.body) as unknown;
}

// Grupo de pruebas de Tavily.
describe("Tavily en la investigación durable", () => {
  // Tavily solo exige su propia clave.
  it("selecciona Tavily sin exigir una clave Firecrawl y falla sin su propia clave", () => {
    // Con TAVILY_API_KEY, ajustes válidos.
    expect(researchSettings(settings)).toMatchObject({
      ok: true,
      settings: { searchProvider: "tavily" },
    });
    // Sin ella falta TAVILY_API_KEY aunque haya clave de Firecrawl.
    expect(
      researchSettings({ ...settings, TAVILY_API_KEY: undefined, FIRECRAWL_API_KEY: "other" }),
    ).toMatchObject({ ok: false, missing: ["TAVILY_API_KEY"] });
    // Un buscador desconocido no es válido.
    expect(researchSettings({ ...settings, RESEARCH_SEARCH_PROVIDER: "unknown" })).toMatchObject({
      ok: false,
    });
  });

  // La reserva usa el precio por crédito de Tavily, no un precio fijo menor.
  it("reserva un crédito por operación y no aplica un precio fijo más barato", () => {
    // Tarifas con Tavily a 0,008 USD por crédito.
    const prices = priceSnapshot({
      budgetUsd: "1",
      jobLimitUsd: "0.25",
      inputUsdPerMillion: "0.1",
      outputUsdPerMillion: "0.5",
      searchProvider: "tavily",
      tavilyUsdPerCredit: "0.008",
      firecrawlUsdPerCredit: "0.001",
      searchUsd: "0.000001",
      readUsd: "0.000001",
    });
    // Búsqueda: 8.000 micro-USD (0,008 USD).
    expect(prices?.searchMicros).toBe(8000);
    // Lectura: lo mismo.
    expect(prices?.readMicros).toBe(8000);
    // Buscador guardado.
    expect(prices?.searchProvider).toBe("tavily");
    // Tope de salida calculado con esas tarifas.
    expect(prices && modelOutputCap(prices, 0.1, 0.5)).toBe(3200);
    // Tarifa antigua con menos dinero por llamada al modelo.
    const legacyOutput = { ...prices!, modelCallMicros: 1700 };
    // Tope de salida menor.
    expect(modelOutputCap(legacyOutput, 0.1, 0.5)).toBe(1800);
    // Si la entrada ya no cabe, no hay tope posible.
    expect(modelOutputCap(legacyOutput, 1, 0.5)).toBeNull();
    // La copia no cambia el valor original.
    expect(legacyOutput.modelCallMicros).toBe(1700);
    // Las tarifas sobreviven a JSON.
    const parsed = prices && parsePriceSnapshot(JSON.stringify(prices));
    // Y conservan el buscador.
    expect(parsed && searchProviderForSnapshot(parsed)).toBe("tavily");
    // Tarifa de la versión 2, sin campo de buscador.
    const legacy = parsePriceSnapshot(
      JSON.stringify({
        version: RESEARCH_PRICE_VERSION_V2,
        budgetMicros: 1_000_000,
        jobLimitMicros: 250_000,
        modelCallMicros: 10,
        searchMicros: 20_000,
        readMicros: 20_000,
        courseMicros: 24,
        holdMicros: 50_024,
        visionCallMicros: 10,
        sttMicrosPerMinute: 510,
        ttsMicrosPerChar: 18,
        speechCapMicros: 18_000,
      }),
    );
    // Se interpreta como Firecrawl.
    expect(legacy && searchProviderForSnapshot(legacy)).toBe("firecrawl");
  });

  // Búsqueda básica sin respuesta generada; créditos sin USD.
  it("busca en modo basic sin respuesta generada ni auto-upgrade, y conserva créditos separados de USD", async () => {
    // Peticiones vistas.
    const seen: { url: string; init: RequestInit }[] = [];
    // Buscador con fetch simulado.
    const port = createTavilySearch({
      apiKey: "test-key",
      fetch: async (url, init) => {
        // Guarda la petición.
        seen.push({ url, init });
        // Un resultado y 1 crédito.
        return Response.json({
          results: [
            {
              url: "https://docs.langchain.com/graph",
              title: "Graph",
              content: "Discovery snippet",
            },
          ],
          usage: { credits: 1 },
        });
      },
    });
    // Busca.
    const result = await port.search(
      { query: "checkpointer", allowedDomains: ["docs.langchain.com"], limit: 2 },
      context,
    );
    // Una llamada.
    expect(seen).toHaveLength(1);
    // Endpoint de búsqueda.
    expect(seen[0]?.url).toBe("https://api.tavily.com/search");
    // Contrato enviado.
    expect(requestJson(seen[0]!.init)).toMatchObject({
      search_depth: "basic",
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      include_domains: ["docs.langchain.com"],
      include_usage: true,
    });
    // Correcto con créditos y usd null.
    expect(result).toMatchObject({
      ok: true,
      consumption: { kind: "reported", credits: 1, usd: null },
    });
  });

  // La lectura devuelve el texto del proveedor con hash y fecha.
  it("lee una página real de la respuesta del proveedor, con hash y fecha observada", async () => {
    // Cuerpos vistos.
    const seen: unknown[] = [];
    // Lector con reloj en 0.
    const port = createTavilyReader({
      apiKey: "test-key",
      allowedDomains: ["docs.langchain.com"],
      now: () => 0,
      fetch: async (_url, init) => {
        // Guarda el cuerpo.
        seen.push(requestJson(init));
        // Contenido de la página y 0,2 créditos.
        return Response.json({
          results: [
            {
              url: "https://docs.langchain.com/graph",
              raw_content: "The checkpointer saves state.",
            },
          ],
          failed_results: [],
          usage: { credits: 0.2 },
        });
      },
    });
    // Lee.
    const result = await port.read({ url: "https://docs.langchain.com/graph" }, context);
    // Contrato de lectura.
    expect(seen).toEqual([
      {
        urls: ["https://docs.langchain.com/graph"],
        extract_depth: "basic",
        format: "markdown",
        include_images: false,
        include_usage: true,
        timeout: 4,
      },
    ]);
    // Texto, fecha de lectura y créditos.
    expect(result).toMatchObject({
      ok: true,
      value: {
        text: "The checkpointer saves state.",
        publishedAt: null,
        retrievedAt: "1970-01-01T00:00:00.000Z",
      },
      consumption: { credits: 0.2, usd: null },
    });
    // Hash SHA-256.
    expect(result.ok && result.value.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  // URL privadas o ajenas: bloqueadas.
  it("bloquea URL privadas o fuera de la lista y una URL final ajena", async () => {
    // Contador.
    let calls = 0;
    // Lector cuya respuesta viene de otro dominio.
    const port = createTavilyReader({
      apiKey: "test-key",
      allowedDomains: ["docs.langchain.com"],
      fetch: async () => {
        // Cuenta.
        calls += 1;
        // Resultado de un dominio ajeno.
        return Response.json({
          results: [{ url: "https://other.example/page", raw_content: "wrong" }],
          usage: { credits: 0.2 },
        });
      },
    });
    // IP local: bloqueada antes de llamar.
    expect(await port.read({ url: "http://127.0.0.1/private" }, context)).toMatchObject({
      ok: false,
      error: "blocked",
    });
    // Sin llamadas.
    expect(calls).toBe(0);
    // URL permitida pero respuesta ajena: bloqueada.
    expect(await port.read({ url: "https://docs.langchain.com/graph" }, context)).toMatchObject({
      ok: false,
      error: "blocked",
    });
    // Una llamada.
    expect(calls).toBe(1);
  });

  // Errores distintos sin reintentos.
  it("distingue fallo de lectura, respuesta inválida y consumo desconocido sin reintentar", async () => {
    // Contador.
    let calls = 0;
    // Lector cuya lectura falla.
    const reader = createTavilyReader({
      apiKey: "test-key",
      allowedDomains: ["docs.langchain.com"],
      fetch: async () => {
        // Cuenta.
        calls += 1;
        // Sin resultados, con un fallo.
        return Response.json({
          results: [],
          failed_results: [{ error: "failed" }],
          usage: { credits: 0 },
        });
      },
    });
    // Error de proveedor.
    expect(await reader.read({ url: "https://docs.langchain.com/graph" }, context)).toMatchObject({
      ok: false,
      error: "provider",
    });
    // Buscador con respuesta inesperada.
    const port = createTavilySearch({
      apiKey: "test-key",
      fetch: async () => {
        // Cuenta.
        calls += 1;
        // Forma desconocida.
        return Response.json({ unexpected: true });
      },
    });
    // Error invalid con consumo desconocido.
    expect(
      await port.search({ query: "q", allowedDomains: ["docs.langchain.com"], limit: 1 }, context),
    ).toMatchObject({ ok: false, error: "invalid", consumption: { kind: "unknown" } });
    // Dos llamadas, sin reintentos.
    expect(calls).toBe(2);
    // Controlador.
    const aborted = new AbortController();
    // Cancela.
    aborted.abort();
    // Buscador cuyo fetch lanza.
    const failing = createTavilySearch({
      apiKey: "test-key",
      fetch: async () => {
        // Error.
        throw new Error("aborted");
      },
    });
    // Con la señal cancelada: aborted.
    expect(
      await failing.search(
        { query: "q", allowedDomains: ["docs.langchain.com"], limit: 1 },
        { ...context, signal: aborted.signal },
      ),
    ).toMatchObject({ ok: false, error: "aborted", consumption: { kind: "unknown" } });
  });
});
