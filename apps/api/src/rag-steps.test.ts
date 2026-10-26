// GUÍA DE LECTURA · apps/api/src/rag-steps.test.ts
// Pruebas de los pasos del RAG básico del modo clase: orden del recorrido, umbral, rechazo,
// aclaración, contexto completo y límites del contrato, sin red.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Esquema del contrato.
import { ragStepSchema, type TraceEvent } from "@thepower-rag/contracts";
// Funciones que se prueban.
import { NO_RAG_TIMINGS, ragAnswerStep, ragGenerateStep, ragRetrievalSteps } from "./rag-steps";

// Traza base con dos candidatos: uno pasa el umbral y otro no.
function trace(overrides: Partial<TraceEvent> = {}): TraceEvent {
  // Campos de una traza de Vectorize.
  return {
    query: "¿Puedo devolver unos auriculares?",
    queryRewrite: "pending",
    corpusVersion: "c-test",
    embedding: "@cf/baai/bge-m3",
    scoreMeaning: "Puntuación devuelta por Vectorize.",
    retrieved: [
      { chunkId: "c-test:a:00", score: 0.71, selected: true },
      { chunkId: "c-test:b:00", score: 0.6, selected: false },
    ],
    decision: "answer",
    generation: "called",
    status: "ok",
    ...overrides,
  };
}

// Grupo.
describe("pasos del RAG básico", () => {
  // Respuesta: embedding, búsqueda y umbral con los tiempos medidos.
  it("recorre embedding, búsqueda y umbral con sus duraciones", () => {
    // Pasos.
    const steps = ragRetrievalSteps({
      trace: trace(),
      threshold: 0.661926,
      timings: { embedMs: 41.6, searchMs: 120 },
    });
    // Orden del grafo: la generación la emite el stream después.
    expect(steps.map((step) => step.kind)).toEqual(["embed", "search", "threshold"]);
    // Duraciones redondeadas.
    expect(steps.map((step) => step.durationMs)).toEqual([42, 120, null]);
    // La búsqueda todavía no marca nada como seleccionado.
    expect(steps[1]?.candidates.every((item) => !item.selected)).toBe(true);
    // El umbral marca el que pasa y lo cuenta.
    expect(steps[2]?.candidates.map((item) => item.selected)).toEqual([true, false]);
    expect(steps[2]?.status).toContain("1 de 2 alcanzan 0,662");
    // Todos cumplen el contrato.
    for (const step of steps) ragStepSchema.parse(step);
  });

  // Nombres: título y sección del fragmento cuando se conocen; sin ellos, solo el id.
  it("nombra los candidatos con título y sección cuando se conocen", () => {
    // Pasos con el nombre de uno de los dos candidatos.
    const steps = ragRetrievalSteps({
      trace: trace(),
      threshold: 0.661926,
      timings: NO_RAG_TIMINGS,
      labels: new Map([["c-test:a:00", { title: "Electrónica y garantía", section: "Higiene" }]]),
    });
    // El umbral lleva el nombre del primero y deja el segundo sin nombre.
    const [first, second] = steps[2]!.candidates;
    expect(first).toMatchObject({ title: "Electrónica y garantía", section: "Higiene" });
    expect(second?.title).toBeUndefined();
    // La generación también los nombra.
    const generate = ragGenerateStep({
      query: "q",
      model: null,
      chunkIds: ["c-test:a:00"],
      labels: new Map([["c-test:a:00", { title: "T", section: "S" }]]),
    });
    expect(generate.candidates[0]).toMatchObject({ title: "T", section: "S" });
  });

  // Rechazo: nada pasa el umbral y no se genera.
  it("termina en rechazo sin generación cuando nada alcanza el umbral", () => {
    // Pasos.
    const steps = ragRetrievalSteps({
      trace: trace({
        decision: "refuse",
        generation: "skipped",
        retrieved: [{ chunkId: "c-test:a:00", score: 0.61, selected: false }],
      }),
      threshold: 0.661926,
      timings: NO_RAG_TIMINGS,
    });
    // Termina en refuse.
    expect(steps.map((step) => step.kind)).toEqual(["embed", "search", "threshold", "refuse"]);
    // El umbral lo explica.
    expect(steps[2]?.status).toContain("Ninguno alcanza");
  });

  // Aclaración de calendario sin búsqueda.
  it("pide aclaración sin buscar cuando falta el grupo", () => {
    // Pasos.
    const steps = ragRetrievalSteps({
      trace: trace({ decision: "clarify", generation: "skipped", retrieved: [] }),
      threshold: 0.5,
      timings: NO_RAG_TIMINGS,
    });
    // Un único paso.
    expect(steps.map((step) => step.kind)).toEqual(["clarify"]);
  });

  // Contexto completo: no hay embedding ni umbral.
  it("en contexto completo solo lee D1, sin embedding ni umbral", () => {
    // Pasos.
    const steps = ragRetrievalSteps({
      trace: trace({ queryRewrite: "context-complete" }),
      threshold: null,
      timings: NO_RAG_TIMINGS,
    });
    // Un único paso de lectura.
    expect(steps.map((step) => step.kind)).toEqual(["search"]);
    expect(steps[0]?.model).toBeNull();
  });

  // Generación y respuesta: modelo, evidencia y citas dentro de los límites.
  it("describe la generación y la respuesta con sus ids", () => {
    // Paso de generación con doce ids: el contrato admite diez.
    const ids = Array.from({ length: 12 }, (_, index) => `c-test:a:${String(index)}`);
    const generate = ragGenerateStep({ query: "q", model: "claude-haiku-5-5", chunkIds: ids });
    expect(ragStepSchema.parse(generate).candidates).toHaveLength(10);
    expect(generate.status).toContain("claude-haiku-5-5 escribe con 12 fragmentos");
    // Respuesta con una cita.
    const answer = ragAnswerStep({
      query: "q",
      model: "claude-haiku-5-5",
      durationMs: 812.4,
      citedIds: ["c-test:a:00"],
    });
    expect(answer.durationMs).toBe(812);
    expect(answer.status).toContain("Cita 1 fragmento validado");
  });
});
