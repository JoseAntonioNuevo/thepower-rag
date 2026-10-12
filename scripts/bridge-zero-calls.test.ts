// GUÍA DE LECTURA · scripts/bridge-zero-calls.test.ts
// Pruebas del puente en modo verify remoto: aclarar no gasta, JSON inválido da 400 y sin reserva no se genera.
// Funciones de prueba.
import { expect, it } from "vite-plus/test";
// Puente que se prueba.
import { handleBridgeRequest } from "../apps/api/src/bridge-worker";
// Entorno remoto cuyo Workers AI falla si se llama.
const env = {
  BRIDGE_TOKEN: "synthetic-bridge-token",
  BRIDGE_ROLE: "verify",
  BRIDGE_REMOTE: "true",
  APP_MODE: "real",
  ANTHROPIC_API_KEY: "synthetic-key",
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
      // Cualquier llamada al proveedor es un error.
      throw new Error("unexpected provider call");
    },
  },
  DB: {},
  VECTORIZE: {},
};
// Envía un POST al chat del puente.
const post = (body: string) =>
  handleBridgeRequest(
    new Request("http://127.0.0.1/api/chat", {
      method: "POST",
      headers: { "x-thepower-bridge": env.BRIDGE_TOKEN, "content-type": "application/json" },
      body,
    }),
    env as never,
  );
// Pregunta de calendario sin grupo: aclaración sin llamadas.
it("permite aclarar sin reserva generativa y sin llamada remota", async () => {
  // Petición CRAG.
  const response = await post(
    JSON.stringify({
      mode: "crag",
      audience: "program",
      messages: [
        { id: "q", role: "user", parts: [{ type: "text", text: "¿Cuándo es la clase de RAG?" }] },
      ],
    }),
  );
  // 200.
  expect(response.status).toBe(200);
  // Texto.
  const text = await response.text();
  // Aclarada.
  expect(text).toContain('"completion":"clarified"');
  // Sin búsquedas.
  expect(text).toContain('"retrievalCount":0');
  // Sin reformulaciones.
  expect(text).toContain('"reformulationCount":0');
});
// JSON inválido: 400.
it("mantiene el error de JSON sin solicitar gasto", async () => {
  // 400.
  expect((await post("{")).status).toBe(400);
});
// Generar sin reserva: bloqueado.
it("bloquea una generación sin reserva", async () => {
  // Sin reserva, sin RAG responde 400 y no llama al proveedor.
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
