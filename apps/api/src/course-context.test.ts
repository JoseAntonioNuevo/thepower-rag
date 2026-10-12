// GUÍA DE LECTURA · apps/api/src/course-context.test.ts
// Pruebas del RAG con contexto completo: carga todos los fragmentos del grupo, bloquea contextos
// alterados y envía al modelo el curso completo con el historial, mostrando solo las fuentes citadas.
// Utilidades de prueba.
import { expect, it, vi } from "vite-plus/test";
// Modelo simulado.
import { MockLanguageModelV4 } from "ai/test";
// Stream simulado.
import { simulateReadableStream } from "ai";
// Corpus preparado.
import prepared from "../../../corpus/prepared/corpus.json";
// Lectura del contexto completo.
import { readCourseContext } from "./course-context";
// Aplicación Hono.
import { createApp } from "./app";
// Tipos de D1 y perfil.
import type { SqlDatabase, IndexProfileRow } from "./stores";
// Tipo del entorno.
import type { WorkerEnv } from "./env";
// Filas de D1 a partir del corpus preparado.
const rows = prepared.documents.flatMap((doc) =>
  doc.chunks.map((chunk) => ({
    ...chunk,
    documentId: doc.id,
    title: doc.title,
    audience: doc.audience,
    corpusVersion: prepared.preparationId,
  })),
);
// D1 simulada que devuelve las filas dadas.
function database(result: unknown[]): SqlDatabase {
  // Objeto con la forma mínima usada.
  return {
    prepare: () => ({ bind: () => ({ all: async () => ({ results: result }) }) }),
  } as unknown as SqlDatabase;
}
// Cada grupo recibe el programa y su calendario, nada más.
it("carga todos los fragmentos de cada grupo y valida integridad sin mezclar calendarios", async () => {
  // Para cada audiencia.
  for (const audience of ["program", "L/X", "M/J"] as const) {
    // Filas visibles para esa audiencia.
    const selected = rows.filter((r) => r.audience === "program" || r.audience === audience);
    // Lee el contexto.
    const result = await readCourseContext(
      database(selected),
      prepared.preparationId,
      audience,
      new AbortController().signal,
    );
    // Todas las filas.
    expect(result).toHaveLength(selected.length);
    // 20 documentos del programa, más el calendario en una cohorte.
    expect(new Set(result.map((r) => r.documentId)).size).toBe(audience === "program" ? 20 : 21);
    // Incluye S20.
    expect(result.some((r) => r.documentId.startsWith("s20"))).toBe(true);
    // Incluye S1.
    expect(result.some((r) => r.documentId.startsWith("s01"))).toBe(true);
    // Ningún calendario de otro grupo.
    expect(result.some((r) => r.audience !== audience && r.audience !== "program")).toBe(false);
  }
});
// Un contexto incompleto, duplicado, alterado o de otro grupo se bloquea.
it("contexto parcial, duplicado, alterado o fuera de ámbito se bloquea", async () => {
  // Filas del programa.
  const selected = rows.filter((r) => r.audience === "program");
  // Cada caso inválido.
  for (const bad of [
    // Falta un fragmento.
    selected.slice(1),
    // Un fragmento duplicado.
    [...selected, selected[0]!],
    // Un texto alterado.
    [...selected.slice(1), { ...selected[0]!, text: "altered" }],
    // Fragmentos de otros grupos.
    rows,
  ])
    await expect(
      // Cada caso debe rechazarse: no se trunca ni se completa el contexto.
      readCourseContext(
        database(bad),
        prepared.preparationId,
        "program",
        new AbortController().signal,
      ),
    ).rejects.toThrow(/contexto|catálogo/);
});
// El modelo recibe el curso completo y el historial; solo se muestran las fuentes citadas.
it("el modelo recibe el curso completo y el historial, y se muestran solo fuentes citadas", async () => {
  // Filas del programa.
  const selected = rows.filter((r) => r.audience === "program");
  // Fragmento de S5.
  const first = selected.find((r) => r.documentId === "s05-langgraph")!;
  // Instrucciones que recibe el modelo.
  let prompt = "";
  // Modelo simulado que cita S5.
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      // Guarda la petición.
      prompt = JSON.stringify(options);
      // Stream de respuesta.
      return {
        // Stream simulado con una respuesta que cita el primer fragmento.
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "a" },
            {
              type: "text-delta",
              id: "a",
              delta: `La siguiente es S5, LangGraph [cite:${first.chunkId}]`,
            },
            { type: "text-end", id: "a" },
            // Fin con consumo.
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
  // Perfil de índice listo.
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
  // Embebedor que no debe llamarse.
  const embed = vi.fn<() => Promise<never>>(async () => {
    // Error si se llama.
    throw new Error("must not embed");
  });
  // Entorno real con contexto completo.
  const env: WorkerEnv = {
    // Modo real con contexto completo y modelo de prueba.
    APP_MODE: "real",
    RAG_CONTEXT_MODE: "complete",
    ANTHROPIC_API_KEY: "synthetic-key",
    MODEL_ID: "example/model",
    // Ajustes del índice: el modo completo no lo usa, pero la capacidad los exige.
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    EMBEDDING_DIMENSIONS: "1024",
    CORPUS_VERSION: prepared.preparationId,
    INDEX_PROFILE: profile.id,
    VECTOR_METRIC: "cosine",
    MIN_RETRIEVAL_SCORE: ".5",
    // Bindings: embeddings y D1 con los fragmentos del programa.
    AI: { run: embed },
    VECTORIZE: {},
    DB: database(selected),
    CORPUS: {},
  };
  // Historial con una pregunta de seguimiento.
  const messages = [
    { id: "q1", role: "user", parts: [{ type: "text", text: "¿Qué vemos en LangChain?" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "LangChain se ve en S4." }] },
    { id: "q2", role: "user", parts: [{ type: "text", text: "¿Y la siguiente?" }] },
  ];
  // Petición de RAG.
  const response = await createApp({ languageModel: model, profile }).request(
    "/api/chat",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "rag", audience: "program", messages }),
    },
    env,
  );
  // Cuerpo del stream.
  const raw = await response.text();
  // Respuesta correcta.
  expect(response.status).toBe(200);
  // El modelo recibió S1.
  expect(prompt).toContain("s01-ecosistema");
  // Y S20.
  expect(prompt).toContain("s20-proyecto-final");
  // Y el historial.
  expect(prompt).toContain("LangChain se ve en S4.");
  // Una sola fuente mostrada: la citada.
  expect(raw.match(/"type":"data-source"/g)).toHaveLength(1);
  // Traza de contexto completo.
  expect(raw).toContain("context-complete");
  // Prompt de contexto completo.
  expect(raw).toContain("rag-complete-v2");
  // Sin embeddings.
  expect(embed).not.toHaveBeenCalled();
});
