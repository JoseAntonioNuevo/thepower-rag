import { DEFAULT_RESEARCH_DOMAINS, RESEARCH_LIMITS } from "@thepower-rag/contracts";
import { checkUrl } from "@thepower-rag/research";
import { describe, expect, it } from "vite-plus/test";
import {
  createFirecrawlReader,
  createFirecrawlSearch,
  FIRECRAWL_SCRAPE_URL,
  FIRECRAWL_SEARCH_URL,
  readBounded,
} from "./firecrawl";

const context = { signal: new AbortController().signal, timeoutMs: 10_000 };

function jsonResponse(body: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers:
      extra === undefined
        ? { "content-type": "application/json" }
        : { "content-type": "application/json", ...extra },
  });
}

function requestText(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "";
}

describe("adaptador Firecrawl con red simulada", () => {
  it("envía el contrato de búsqueda y no convierte créditos sin precio", async () => {
    let calls = 0;
    let body: unknown;
    let authorization = "";
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async (url, init) => {
        calls += 1;
        expect(url).toBe(FIRECRAWL_SEARCH_URL);
        body = JSON.parse(requestText(init?.body));
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return jsonResponse({
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
          creditsUsed: 2,
        });
      },
    });
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 5 },
      context,
    );
    expect(calls).toBe(1);
    expect(authorization).toBe("Bearer test-key");
    expect(body).toMatchObject({
      query: "langgraph",
      limit: 5,
      includeDomains: ["docs.langchain.com"],
      ignoreInvalidURLs: true,
    });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value[0]?.url : "").toContain("docs.langchain.com");
    expect(result.consumption).toEqual({ kind: "reported", credits: 2, usd: null });
  });

  it("convierte créditos a USD solo con un precio explícito", async () => {
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: 0.01,
      fetch: async () => jsonResponse({ success: true, data: { web: [] }, creditsUsed: 2 }),
    });
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    expect(result.consumption).toEqual({ kind: "reported", credits: 2, usd: 0.02 });
  });

  it("sin créditos informados el consumo queda desconocido", async () => {
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: 0.01,
      fetch: async () => jsonResponse({ success: true, data: { web: [] } }),
    });
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    expect(result.consumption).toEqual({ kind: "unknown" });
  });

  it("no llama a la red si falta la credencial", async () => {
    let calls = 0;
    const search = createFirecrawlSearch({
      apiKey: "  ",
      usdPerCredit: null,
      fetch: async () => {
        calls += 1;
        return jsonResponse({});
      },
    });
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    expect(calls).toBe(0);
    expect(result).toMatchObject({ ok: false, error: "blocked", consumption: { kind: "none" } });
  });

  it("distingue un HTTP de cliente de un fallo cuyo cargo es desconocido", async () => {
    const unauthorized = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async () => jsonResponse({ error: "no" }, 401),
    });
    const unavailable = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async () => jsonResponse({ error: "down" }, 503),
    });
    const denied = await unauthorized.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    const down = await unavailable.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    expect(denied).toMatchObject({ ok: false, error: "provider", consumption: { kind: "none" } });
    expect(down).toMatchObject({ ok: false, error: "provider", consumption: { kind: "unknown" } });
  });

  it("rechaza un cuerpo mal formado o con una forma inesperada", async () => {
    const malformed = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async () => new Response("no-json", { status: 200 }),
    });
    const shaped = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async () => jsonResponse({ success: false }),
    });
    const badJson = await malformed.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    const badShape = await shaped.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    expect(badJson).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "unknown" },
    });
    expect(badShape).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "unknown" },
    });
  });

  it("corta una respuesta que declara o acumula más bytes del tope", async () => {
    const declared = await readBounded(
      new Response("demasiado", { headers: { "content-length": "50" } }),
      8,
    );
    expect(declared).toBeNull();
    const stream = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("0123456789"));
          controller.close();
        },
      }),
    );
    expect(await readBounded(stream, 4)).toBeNull();
    const search = createFirecrawlSearch({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async () =>
        new Response("x", {
          status: 200,
          headers: { "content-length": String(RESEARCH_LIMITS.maxSearchResponseBytes + 1) },
        }),
    });
    const result = await search.search(
      { query: "langgraph", allowedDomains: ["docs.langchain.com"], limit: 1 },
      context,
    );
    expect(result).toMatchObject({ ok: false, error: "invalid" });
  });

  it("la lectura usa el contrato v2 y conserva una URL final no permitida", async () => {
    let body: unknown;
    const reader = createFirecrawlReader({
      apiKey: "test-key",
      usdPerCredit: null,
      now: () => Date.parse("2026-10-10T00:00:00.000Z"),
      fetch: async (url, init) => {
        expect(url).toBe(FIRECRAWL_SCRAPE_URL);
        body = JSON.parse(requestText(init?.body));
        return jsonResponse({
          success: true,
          data: {
            markdown: "Texto de la página.",
            metadata: {
              title: "Fuera",
              url: "https://evil.example/secret",
              sourceURL: "https://docs.langchain.com/langgraph",
              statusCode: 200,
            },
          },
          creditsUsed: 2,
        });
      },
    });
    const result = await reader.read({ url: "https://docs.langchain.com/langgraph" }, context);
    expect(body).toMatchObject({
      url: "https://docs.langchain.com/langgraph",
      formats: [{ type: "markdown" }],
      onlyMainContent: true,
      proxy: "basic",
    });
    expect(result.ok).toBe(true);
    const finalUrl = result.ok ? result.value.finalUrl : "";
    expect(finalUrl).toBe("https://evil.example/secret");
    expect(checkUrl(finalUrl, DEFAULT_RESEARCH_DOMAINS).ok).toBe(false);
    expect(result.consumption).toEqual({ kind: "reported", credits: 2, usd: null });
  });

  it("una señal abortada no se trata como una página leída", async () => {
    const controller = new AbortController();
    controller.abort();
    const reader = createFirecrawlReader({
      apiKey: "test-key",
      usdPerCredit: null,
      fetch: async (_url, init) => {
        expect(init?.signal?.aborted).toBe(true);
        throw new DOMException("The operation was aborted.", "AbortError");
      },
    });
    const result = await reader.read(
      { url: "https://docs.langchain.com/langgraph" },
      { signal: controller.signal, timeoutMs: 5_000 },
    );
    expect(result).toMatchObject({ ok: false, error: "aborted", consumption: { kind: "unknown" } });
  });
});
