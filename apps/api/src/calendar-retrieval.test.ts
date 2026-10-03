import { expect, it, vi } from "vite-plus/test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createApp } from "./app";
import type { WorkerEnv } from "./env";
import type { SqlDatabase, IndexProfileRow } from "./stores";
const version = "c-calendar-test";
const profile: IndexProfileRow = {
  id: "p-calendar-test",
  corpusVersion: version,
  embeddingModel: "@cf/baai/bge-m3",
  dimensions: 1024,
  metric: "cosine",
  family: "workers-ai",
  status: "ready",
  providerRevision: null,
};
function setup(group: "L/X" | "M/J", badScope = false) {
  const id = `${version}:calendario-${group === "L/X" ? "lx" : "mj"}:00`;
  const row = {
    chunkId: id,
    documentId: group === "L/X" ? "calendario-lx" : "calendario-mj",
    title: "Calendario",
    section: "Calendario",
    text:
      group === "L/X"
        ? "Lunes y miércoles, de 18:30 a 20:00. No hay clase el 12 de octubre ni el 2 de noviembre."
        : "Martes y jueves, de 18:30 a 20:00.",
    audience: badScope ? (group === "L/X" ? "M/J" : "L/X") : group,
    corpusVersion: version,
  };
  let prompt = "";
  const generate = vi.fn<() => void>(() => {});
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      generate();
      prompt = JSON.stringify(options);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: `${row.text} [cite:${id}]` },
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
  const embed = vi.fn<() => Promise<never>>(async () => {
    throw new Error("must not embed overview");
  });
  const query = vi.fn<() => Promise<never>>(async () => {
    throw new Error("must not search vectors for overview");
  });
  const read = vi.fn<() => void>(() => {});
  const db: SqlDatabase = {
    prepare: () => ({
      bind: () => ({
        first: async <T>() => {
          read();
          return row as T;
        },
      }),
    }),
  };
  const env: WorkerEnv = {
    APP_MODE: "real",
    OPENROUTER_API_KEY: "synthetic-key",
    MODEL_ID: "example/model",
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    EMBEDDING_DIMENSIONS: "1024",
    CORPUS_VERSION: version,
    INDEX_PROFILE: profile.id,
    VECTOR_METRIC: "cosine",
    MIN_RETRIEVAL_SCORE: "0.99",
    AI: { run: embed },
    VECTORIZE: { query },
    DB: db,
    CORPUS: {},
  };
  return {
    app: createApp({ languageModel: model, profile }),
    env,
    generate,
    embed,
    query,
    read,
    prompt: () => prompt,
  };
}
async function post(group: "L/X" | "M/J" | "program", state: ReturnType<typeof setup>) {
  const response = await state.app.request(
    "/api/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "rag",
        audience: group,
        messages: [
          { id: "q", role: "user", parts: [{ type: "text", text: "que dias hay clase?" }] },
        ],
      }),
    },
    state.env,
  );
  return { response, raw: await response.text() };
}
it("ruta real usa D1 con fuente y grupo correctos aunque no se supere un umbral vectorial", async () => {
  for (const group of ["L/X", "M/J"] as const) {
    const state = setup(group);
    const { response, raw } = await post(group, state);
    expect(response.status).toBe(200);
    expect(raw).toContain('"completion":"complete"');
    expect(raw).toContain('"score":null');
    expect(raw).toContain(group === "L/X" ? "calendario-lx:00" : "calendario-mj:00");
    expect(state.prompt()).toContain(group === "L/X" ? "Lunes y miércoles" : "Martes y jueves");
    expect(state.generate).toHaveBeenCalledTimes(1);
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.embed).not.toHaveBeenCalled();
    expect(state.query).not.toHaveBeenCalled();
  }
});
it("grupo General aclara sin buscar ni generar; dato de otro grupo se rechaza", async () => {
  const general = setup("L/X");
  const a = await post("program", general);
  expect(a.raw).toContain('"completion":"clarified"');
  expect(general.generate).not.toHaveBeenCalled();
  expect(general.read).not.toHaveBeenCalled();
  const mismatch = setup("L/X", true);
  const b = await post("L/X", mismatch);
  expect(b.raw).toContain('"completion":"refused"');
  expect(mismatch.generate).not.toHaveBeenCalled();
});
