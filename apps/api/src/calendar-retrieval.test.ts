// GUÍA DE LECTURA · apps/api/src/calendar-retrieval.test.ts
// Pruebas del atajo de calendario en la ruta real: lee la ficha del grupo en D1 sin embeddings ni
// búsqueda vectorial, aclara sin grupo y rechaza una ficha de otro grupo.
// Utilidades de prueba.
import { expect, it, vi } from "vite-plus/test";
// Stream simulado.
import { simulateReadableStream } from "ai";
// Modelo simulado.
import { MockLanguageModelV4 } from "ai/test";
// Aplicación Hono.
import { createApp } from "./app";
// Tipo del entorno.
import type { WorkerEnv } from "./env";
// Tipos de D1 y perfil.
import type { SqlDatabase, IndexProfileRow } from "./stores";
// Versión de prueba.
const version = "c-calendar-test";
// Perfil listo.
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
// Prepara app, entorno y dobles para un grupo; badScope cambia la audiencia de la ficha.
function setup(group: "L/X" | "M/J", badScope = false) {
  // Id de la ficha del grupo.
  const id = `${version}:calendario-${group === "L/X" ? "lx" : "mj"}:00`;
  // Ficha de calendario.
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
  // Instrucciones que recibe el modelo.
  let prompt = "";
  // Contador de generaciones.
  const generate = vi.fn<() => void>(() => {});
  // Modelo simulado que repite la ficha con su cita.
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      // Cuenta la generación.
      generate();
      // Guarda la petición.
      prompt = JSON.stringify(options);
      // Stream de respuesta.
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
  // Embebedor que no debe llamarse.
  const embed = vi.fn<() => Promise<never>>(async () => {
    // Error si se llama.
    throw new Error("must not embed overview");
  });
  // Búsqueda vectorial que no debe llamarse.
  const query = vi.fn<() => Promise<never>>(async () => {
    // Error si se llama.
    throw new Error("must not search vectors for overview");
  });
  // Contador de lecturas de D1.
  const read = vi.fn<() => void>(() => {});
  // D1 que devuelve la ficha.
  const db: SqlDatabase = {
    prepare: () => ({
      bind: () => ({
        first: async <T>() => {
          // Cuenta la lectura.
          read();
          // Ficha.
          return row as T;
        },
      }),
    }),
  };
  // Entorno real.
  const env: WorkerEnv = {
    APP_MODE: "real",
    ANTHROPIC_API_KEY: "synthetic-key",
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
  // App y dobles.
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
// Envía la pregunta del horario para un grupo.
async function post(group: "L/X" | "M/J" | "program", state: ReturnType<typeof setup>) {
  // Petición de RAG.
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
  // Respuesta y cuerpo.
  return { response, raw: await response.text() };
}
// L/X y M/J leen su ficha sin umbral ni búsqueda vectorial.
it("ruta real usa D1 con fuente y grupo correctos aunque no se supere un umbral vectorial", async () => {
  // Para cada grupo.
  for (const group of ["L/X", "M/J"] as const) {
    // Preparación.
    const state = setup(group);
    // Petición.
    const { response, raw } = await post(group, state);
    // Respuesta correcta.
    expect(response.status).toBe(200);
    // Completa.
    expect(raw).toContain('"completion":"complete"');
    // Sin puntuación.
    expect(raw).toContain('"score":null');
    // Ficha del grupo.
    expect(raw).toContain(group === "L/X" ? "calendario-lx:00" : "calendario-mj:00");
    // El modelo recibió la ficha.
    expect(state.prompt()).toContain(group === "L/X" ? "Lunes y miércoles" : "Martes y jueves");
    // Una generación.
    expect(state.generate).toHaveBeenCalledTimes(1);
    // Una lectura.
    expect(state.read).toHaveBeenCalledTimes(1);
    // Sin embeddings.
    expect(state.embed).not.toHaveBeenCalled();
    // Sin búsqueda vectorial.
    expect(state.query).not.toHaveBeenCalled();
  }
});
// Sin grupo se aclara; una ficha de otro grupo se rechaza.
it("grupo General aclara sin buscar ni generar; dato de otro grupo se rechaza", async () => {
  // Preparación.
  const general = setup("L/X");
  // Pregunta del programa completo.
  const a = await post("program", general);
  // Aclaración.
  expect(a.raw).toContain('"completion":"clarified"');
  // Sin generación.
  expect(general.generate).not.toHaveBeenCalled();
  // Sin lectura.
  expect(general.read).not.toHaveBeenCalled();
  // Ficha con audiencia cambiada.
  const mismatch = setup("L/X", true);
  // Pregunta de L/X.
  const b = await post("L/X", mismatch);
  // Rechazo.
  expect(b.raw).toContain('"completion":"refused"');
  // Sin generación.
  expect(mismatch.generate).not.toHaveBeenCalled();
});
