import { expect, it } from "vite-plus/test";
import { handleBridgeRequest } from "../apps/api/src/bridge-worker";
const env = {
  BRIDGE_TOKEN: "synthetic-bridge-token",
  BRIDGE_ROLE: "verify",
  BRIDGE_REMOTE: "true",
  APP_MODE: "real",
  OPENROUTER_API_KEY: "synthetic-key",
  MODEL_ID: "example/generator",
  EVALUATOR_MODEL_ID: "example/evaluator",
  EMBEDDING_MODEL: "@cf/baai/bge-m3",
  EMBEDDING_DIMENSIONS: "1024",
  CORPUS_VERSION: "c3a59a406888b",
  INDEX_PROFILE: "p76509a5f9743",
  VECTOR_METRIC: "cosine",
  MIN_RETRIEVAL_SCORE: "0.5",
  AI: {
    run: async () => {
      throw new Error("unexpected provider call");
    },
  },
  DB: {},
  VECTORIZE: {},
};
const post = (body: string) =>
  handleBridgeRequest(
    new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "x-thepower-bridge": env.BRIDGE_TOKEN, "content-type": "application/json" },
      body,
    }),
    env as never,
  );
it("permite aclarar sin reserva generativa y sin llamada remota", async () => {
  const response = await post(
    JSON.stringify({
      mode: "crag",
      audience: "program",
      messages: [
        { id: "q", role: "user", parts: [{ type: "text", text: "¿Cuándo es la clase de RAG?" }] },
      ],
    }),
  );
  expect(response.status).toBe(200);
  const text = await response.text();
  expect(text).toContain('"completion":"clarified"');
  expect(text).toContain('"retrievalCount":0');
  expect(text).toContain('"reformulationCount":0');
});
it("mantiene el error de JSON sin solicitar gasto", async () => {
  expect((await post("{")).status).toBe(400);
});
it("bloquea una generación sin reserva", async () => {
  expect(
    (
      await post(
        JSON.stringify({
          mode: "sin-rag",
          audience: "program",
          messages: [
            { id: "q", role: "user", parts: [{ type: "text", text: "Explica embeddings" }] },
          ],
        }),
      )
    ).status,
  ).toBe(400);
});
