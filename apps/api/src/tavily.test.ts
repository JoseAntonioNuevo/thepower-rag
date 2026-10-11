import { describe, expect, it } from "vite-plus/test";
import { createTavilyReader, createTavilySearch } from "./tavily";
import { researchSettings } from "./env";
import {
  parsePriceSnapshot,
  priceSnapshot,
  RESEARCH_PRICE_VERSION_V2,
  searchProviderForSnapshot,
} from "./research-money";

const context = { signal: new AbortController().signal, timeoutMs: 5000 };
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

function requestJson(init: RequestInit): unknown {
  if (typeof init.body !== "string") {
    throw new Error("Se esperaba un cuerpo JSON serializado.");
  }
  return JSON.parse(init.body) as unknown;
}

describe("Tavily en la investigación durable", () => {
  it("selecciona Tavily sin exigir una clave Firecrawl y falla sin su propia clave", () => {
    expect(researchSettings(settings)).toMatchObject({
      ok: true,
      settings: { searchProvider: "tavily" },
    });
    expect(
      researchSettings({ ...settings, TAVILY_API_KEY: undefined, FIRECRAWL_API_KEY: "other" }),
    ).toMatchObject({ ok: false, missing: ["TAVILY_API_KEY"] });
    expect(researchSettings({ ...settings, RESEARCH_SEARCH_PROVIDER: "unknown" })).toMatchObject({
      ok: false,
    });
  });

  it("reserva un crédito por operación y no aplica un precio fijo más barato", () => {
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
    expect(prices?.searchMicros).toBe(8000);
    expect(prices?.readMicros).toBe(8000);
    expect(prices?.searchProvider).toBe("tavily");
    const parsed = prices && parsePriceSnapshot(JSON.stringify(prices));
    expect(parsed && searchProviderForSnapshot(parsed)).toBe("tavily");
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
    expect(legacy && searchProviderForSnapshot(legacy)).toBe("firecrawl");
  });

  it("busca en modo basic sin respuesta generada ni auto-upgrade, y conserva créditos separados de USD", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const port = createTavilySearch({
      apiKey: "test-key",
      fetch: async (url, init) => {
        seen.push({ url, init });
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
    const result = await port.search(
      { query: "checkpointer", allowedDomains: ["docs.langchain.com"], limit: 2 },
      context,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://api.tavily.com/search");
    expect(requestJson(seen[0]!.init)).toMatchObject({
      search_depth: "basic",
      auto_parameters: false,
      include_answer: false,
      include_raw_content: false,
      include_domains: ["docs.langchain.com"],
      include_usage: true,
    });
    expect(result).toMatchObject({
      ok: true,
      consumption: { kind: "reported", credits: 1, usd: null },
    });
  });

  it("lee una página real de la respuesta del proveedor, con hash y fecha observada", async () => {
    const seen: unknown[] = [];
    const port = createTavilyReader({
      apiKey: "test-key",
      allowedDomains: ["docs.langchain.com"],
      now: () => 0,
      fetch: async (_url, init) => {
        seen.push(requestJson(init));
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
    const result = await port.read({ url: "https://docs.langchain.com/graph" }, context);
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
    expect(result).toMatchObject({
      ok: true,
      value: {
        text: "The checkpointer saves state.",
        publishedAt: null,
        retrievedAt: "1970-01-01T00:00:00.000Z",
      },
      consumption: { credits: 0.2, usd: null },
    });
    expect(result.ok && result.value.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("bloquea URL privadas o fuera de la lista y una URL final ajena", async () => {
    let calls = 0;
    const port = createTavilyReader({
      apiKey: "test-key",
      allowedDomains: ["docs.langchain.com"],
      fetch: async () => {
        calls += 1;
        return Response.json({
          results: [{ url: "https://other.example/page", raw_content: "wrong" }],
          usage: { credits: 0.2 },
        });
      },
    });
    expect(await port.read({ url: "http://127.0.0.1/private" }, context)).toMatchObject({
      ok: false,
      error: "blocked",
    });
    expect(calls).toBe(0);
    expect(await port.read({ url: "https://docs.langchain.com/graph" }, context)).toMatchObject({
      ok: false,
      error: "blocked",
    });
    expect(calls).toBe(1);
  });

  it("distingue fallo de lectura, respuesta inválida y consumo desconocido sin reintentar", async () => {
    let calls = 0;
    const reader = createTavilyReader({
      apiKey: "test-key",
      allowedDomains: ["docs.langchain.com"],
      fetch: async () => {
        calls += 1;
        return Response.json({
          results: [],
          failed_results: [{ error: "failed" }],
          usage: { credits: 0 },
        });
      },
    });
    expect(await reader.read({ url: "https://docs.langchain.com/graph" }, context)).toMatchObject({
      ok: false,
      error: "provider",
    });
    const port = createTavilySearch({
      apiKey: "test-key",
      fetch: async () => {
        calls += 1;
        return Response.json({ unexpected: true });
      },
    });
    expect(
      await port.search({ query: "q", allowedDomains: ["docs.langchain.com"], limit: 1 }, context),
    ).toMatchObject({ ok: false, error: "invalid", consumption: { kind: "unknown" } });
    expect(calls).toBe(2);
    const aborted = new AbortController();
    aborted.abort();
    const failing = createTavilySearch({
      apiKey: "test-key",
      fetch: async () => {
        throw new Error("aborted");
      },
    });
    expect(
      await failing.search(
        { query: "q", allowedDomains: ["docs.langchain.com"], limit: 1 },
        { ...context, signal: aborted.signal },
      ),
    ).toMatchObject({ ok: false, error: "aborted", consumption: { kind: "unknown" } });
  });
});
