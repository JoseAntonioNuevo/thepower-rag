import type { ChunkRecord } from "@thepower-rag/core";
import { validatePlan } from "@thepower-rag/research";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import type { ResearchSettings, RetrievalSettings } from "./env";
import { fixtureChunks, fixtureCorpusVersion } from "./fixture";
import {
  createRealResearchPorts,
  createResearchModelPort,
  createVectorCoursePort,
  estimateResearchMaxUsd,
  type RealResearchInput,
} from "./research-real";
import { createCourseSessionTool } from "./research-tool";
import type { SqlDatabase, VectorIndex } from "./stores";
import { BGE_M3_MODEL } from "./vectors";

const corpus = fixtureCorpusVersion();
const library = fixtureChunks();
const call = { signal: new AbortController().signal, timeoutMs: 5_000 };

const retrieval: RetrievalSettings = {
  embeddingModel: BGE_M3_MODEL,
  dimensions: 4,
  corpusVersion: corpus,
  indexProfile: "profile-test",
  metric: "cosine",
  minScore: 0.5,
};

const settings: ResearchSettings = {
  plannerModelId: "example/planner",
  firecrawlApiKey: "test-key",
  allowedDomains: ["docs.langchain.com"],
  budgetUsd: 1,
  inputUsdPerMillion: 0.2,
  outputUsdPerMillion: 1,
  firecrawlUsdPerCredit: 0.01,
};

function chunk(id: string): ChunkRecord {
  const found = library.find((item) => item.chunkId === id);
  if (found === undefined) {
    throw new Error(`falta ${id}`);
  }
  return found;
}

describe("adaptadores reales simulados", () => {
  it("muestra el HTTP del proveedor sin revelar su cuerpo ni reintentar", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        throw new APICallError({
          message: "private-provider-body",
          url: "https://provider.example",
          requestBodyValues: { private: "private-question" },
          statusCode: 429,
          responseBody: "private-provider-body",
          isRetryable: true,
        });
      },
    });
    const result = await createResearchModelPort({ planner: model, generator: model }).plan(
      { question: "Vectorize", audience: "program" },
      call,
    );
    expect(calls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: "provider",
      detail: "El proveedor del modelo respondió HTTP 429.",
      consumption: { kind: "unknown" },
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("identifica la salida estructurada truncada sin exponerla ni reintentar", async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        return {
          content: [{ type: "text", text: '{"private-input":' }],
          finishReason: { unified: "length", raw: "max_tokens" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const result = await createResearchModelPort({ planner: model, generator: model }).plan(
      { question: "Vectorize", audience: "program" },
      call,
    );
    expect(calls).toBe(1);
    expect(result).toMatchObject({
      ok: false,
      error: "provider",
      detail: "El modelo agotó el tope de salida antes de completar el objeto.",
      consumption: { kind: "estimated", inputTokens: 10, outputTokens: 8 },
    });
    expect(JSON.stringify(result)).not.toContain("private-input");
  });
  it("el curso vectorial devuelve solo fragmentos por encima del umbral", async () => {
    const seen: unknown[] = [];
    const index: VectorIndex = {
      query: async (vector, options) => {
        seen.push({ vector, options });
        return {
          matches: [
            { id: `${corpus}:s12-deep-research:00`, score: 0.91 },
            { id: `${corpus}:s12-deep-research:01`, score: 0.1 },
          ],
        };
      },
      upsert: async () => ({}),
    };
    const database: SqlDatabase = {
      prepare: () => ({
        bind: (...values: unknown[]) => ({
          first: async <T>(): Promise<T | null> => {
            const id = String(values[1]);
            return (id.endsWith(":00") ? chunk(id) : null) as T | null;
          },
        }),
      }),
    };
    const course = createVectorCoursePort({
      embedder: { run: async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] }) },
      index,
      database,
      retrieval,
    });
    const result = await course.retrieve(
      { query: "deep research", audience: "program", corpusVersion: corpus, limit: 4 },
      call,
    );
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.map((item) => item.sourceId) : []).toEqual([
      `${corpus}:s12-deep-research:00`,
    ]);
    expect(result.consumption).toEqual({ kind: "unknown" });
    expect(JSON.stringify(seen)).toContain("profile-test");
  });

  it("un embedding abortado no se convierte en evidencia ausente", async () => {
    const controller = new AbortController();
    controller.abort();
    const course = createVectorCoursePort({
      embedder: { run: async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] }) },
      index: { query: async () => ({ matches: [] }), upsert: async () => ({}) },
      database: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
      retrieval,
    });
    const result = await course.retrieve(
      { query: "deep research", audience: "program", corpusVersion: corpus, limit: 2 },
      { signal: controller.signal, timeoutMs: 5_000 },
    );
    expect(result).toMatchObject({ ok: false, error: "aborted", consumption: { kind: "unknown" } });
  });

  it("la herramienta lee el catálogo y no inventa un campo ausente", async () => {
    const tool = createCourseSessionTool({
      corpusVersion: corpus,
      audience: "M/J",
      read: async (_version, id) =>
        id.includes("calendario") ? null : (library.find((item) => item.chunkId === id) ?? null),
    });
    const result = await tool.getCourseSession({ sessionId: "S12", audience: "M/J" }, call);
    expect(result.ok).toBe(true);
    const text = result.ok && result.value !== null ? result.value.text : "";
    expect(text).toContain("Ejercicio resumido");
    expect(text).toContain("la fecha no consta");
    expect(result.ok && result.value !== null ? result.value.backingSourceIds : []).toContain(
      `${corpus}:s12-deep-research:00`,
    );
  });

  it("un catálogo que lanza un error no fabrica la ficha", async () => {
    const tool = createCourseSessionTool({
      corpusVersion: corpus,
      audience: "M/J",
      read: async () => {
        throw new Error("catalog unavailable");
      },
    });
    const result = await tool.getCourseSession({ sessionId: "S12", audience: "M/J" }, call);
    expect(result).toMatchObject({
      ok: false,
      error: "provider",
      detail: "El catálogo del curso no respondió.",
    });
  });

  it("el modelo estructurado no reintenta y registra el USD informado", async () => {
    let calls = 0;
    const plan = {
      route: "course",
      rationale: "Basta el material del curso. ".repeat(20),
      clarification: null,
      subquestions: [
        {
          id: "q1",
          text: "Qué es un checkpointer.",
          kind: "technical",
          external: false,
          query: null,
        },
      ],
      tool: null,
    };
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        return {
          content: [{ type: "text", text: JSON.stringify(plan) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
          warnings: [],
          providerMetadata: undefined,
        };
      },
    });
    const port = createResearchModelPort({ planner: model, generator: model });
    const result = await port.plan(
      { question: "¿Qué es un checkpointer?", audience: "program" },
      call,
    );
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.ok ? result.value : null).toMatchObject({
      route: "course",
      rationale: plan.rationale.trim().slice(0, 240).trimEnd(),
      subquestions: plan.subquestions,
    });
    expect(result.ok && validatePlan(result.value, "program").ok).toBe(true);
    expect(result.consumption).toMatchObject({
      kind: "estimated",
      usd: 0.0000044,
      complete: true,
      inputTokens: 4,
      outputTokens: 8,
    });
    expect(result.consumption.kind === "estimated" ? result.consumption.provenance : "").toContain(
      "no es un importe del proveedor",
    );
  });

  it("construir los puertos reales no llama a la red", async () => {
    let calls = 0;
    const input = {
      signal: new AbortController().signal,
      audience: "program",
      corpusVersion: corpus,
      settings,
      priceSearchProvider: "firecrawl",
      retrieval,
      planner: new MockLanguageModelV4({}),
      generator: new MockLanguageModelV4({}),
      embedder: { run: async () => ({ data: [] }) },
      index: { query: async () => ({ matches: [] }), upsert: async () => ({}) },
      database: { prepare: () => ({ bind: () => ({ first: async () => null }) }) },
      fetch: async () => {
        calls += 1;
        return new Response("no", { status: 500 });
      },
    } satisfies RealResearchInput;
    const ports = createRealResearchPorts(input);
    expect(calls).toBe(0);
    expect(ports.measured).toBe(true);
    expect(ports.fixture).toBe(false);
    expect(ports.estimatedMaxUsd).toBeGreaterThan(0);
    expect(estimateResearchMaxUsd(settings)).toBe(ports.estimatedMaxUsd);
    expect(() => createRealResearchPorts({ ...input, priceSearchProvider: "tavily" })).toThrow(
      "research-search-provider-price-mismatch",
    );
  });
});
