import { expect, it, vi } from "vite-plus/test";
import { MockLanguageModelV4 } from "ai/test";
import { simulateReadableStream } from "ai";
import prepared from "../../../corpus/prepared/corpus.json";
import { readCourseContext } from "./course-context";
import { createApp } from "./app";
import type { SqlDatabase, IndexProfileRow } from "./stores";
import type { WorkerEnv } from "./env";
const rows = prepared.documents.flatMap((doc) =>
  doc.chunks.map((chunk) => ({
    ...chunk,
    documentId: doc.id,
    title: doc.title,
    audience: doc.audience,
    corpusVersion: prepared.preparationId,
  })),
);
function database(result: unknown[]): SqlDatabase {
  return {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: result }) }) }),
  } as unknown as SqlDatabase;
}
it("carga todos los fragmentos de cada grupo y valida integridad sin mezclar calendarios", async () => {
  for (const audience of ["program", "L/X", "M/J"] as const) {
    const selected = rows.filter((r) => r.audience === "program" || r.audience === audience);
    const result = await readCourseContext(
      database(selected),
      prepared.preparationId,
      audience,
      new AbortController().signal,
    );
    expect(result).toHaveLength(selected.length);
    expect(new Set(result.map((r) => r.documentId)).size).toBe(audience === "program" ? 20 : 21);
    expect(result.some((r) => r.documentId.startsWith("s20"))).toBe(true);
    expect(result.some((r) => r.documentId.startsWith("s01"))).toBe(true);
    expect(result.some((r) => r.audience !== audience && r.audience !== "program")).toBe(false);
  }
});
it("contexto parcial, duplicado, alterado o fuera de ámbito se bloquea", async () => {
  const selected = rows.filter((r) => r.audience === "program");
  for (const bad of [
    selected.slice(1),
    [...selected, selected[0]!],
    [...selected.slice(1), { ...selected[0]!, text: "altered" }],
    rows,
  ])
    await expect(
      readCourseContext(
        database(bad),
        prepared.preparationId,
        "program",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/contexto|catálogo/);
});
it("el modelo recibe el curso completo y el historial, y se muestran solo fuentes citadas", async () => {
  const selected = rows.filter((r) => r.audience === "program");
  const first = selected.find((r) => r.documentId === "s05-langgraph")!;
  let prompt = "";
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompt = JSON.stringify(options);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "a" },
            {
              type: "text-delta",
              id: "a",
              delta: `La siguiente es S5, LangGraph [cite:${first.chunkId}]`,
            },
            { type: "text-end", id: "a" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: 10, text: 10, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
  const profile: IndexProfileRow = {
    id: "p-complete-test",
    corpusVersion: prepared.preparationId,
    embeddingModel: "@cf/baai/bge-m3",
    dimensions: 1024,
    metric: "cosine",
    family: "workers-ai",
    status: "ready",
    providerRevision: null,
  };
  const embed = vi.fn<() => Promise<never>>(async () => {
    throw new Error("must not embed");
  });
  const env: WorkerEnv = {
    APP_MODE: "real",
    RAG_CONTEXT_MODE: "complete",
    ANTHROPIC_API_KEY: "synthetic-key",
    MODEL_ID: "example/model",
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    EMBEDDING_DIMENSIONS: "1024",
    CORPUS_VERSION: prepared.preparationId,
    INDEX_PROFILE: profile.id,
    VECTOR_METRIC: "cosine",
    MIN_RETRIEVAL_SCORE: ".5",
    AI: { run: embed },
    VECTORIZE: {},
    DB: database(selected),
    CORPUS: {},
  };
  const messages = [
    { id: "q1", role: "user", parts: [{ type: "text", text: "¿Qué vemos en LangChain?" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "LangChain se ve en S4." }] },
    { id: "q2", role: "user", parts: [{ type: "text", text: "¿Y la siguiente?" }] },
  ];
  const response = await createApp({ languageModel: model, profile }).request(
    "/api/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "rag", audience: "program", messages }),
    },
    env,
  );
  const raw = await response.text();
  expect(response.status).toBe(200);
  expect(prompt).toContain("s01-ecosistema");
  expect(prompt).toContain("s20-proyecto-final");
  expect(prompt).toContain("LangChain se ve en S4.");
  expect(raw.match(/"type":"data-source"/g)).toHaveLength(1);
  expect(raw).toContain("context-complete");
  expect(raw).toContain("rag-complete-v2");
  expect(embed).not.toHaveBeenCalled();
});
