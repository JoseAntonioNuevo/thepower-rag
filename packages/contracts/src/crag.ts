// GUÍA DE LECTURA · packages/contracts/src/crag.ts
// Contrato de CRAG (RAG correctivo): guiones de la demo, cada paso del grafo y el resumen
// final que el navegador muestra. Los topes (3 búsquedas, 2 reformulaciones) están en el esquema.
// Zod declara y valida la forma de los datos.
import { z } from "zod";
// Esquemas comunes: audiencia, consumo y coste.
import { audienceSchema, runCostSchema, runUsageSchema } from "./domain";

// Guiones de la demo de CRAG: cada uno enseña un recorrido distinto del grafo sin llamar a un modelo.
export const DEMO_CRAG_SCENARIOS = [
  // Evidencia suficiente en la primera búsqueda (S5).
  {
    id: "sufficient-s5",
    label: "Suficiente a la primera",
    question: "¿Cómo modela LangGraph un agente con estado y nodos?",
  },
  // Evidencia parcial que obliga a reformular y buscar otra vez (S5 y S6).
  {
    id: "partial-s5-s6",
    label: "Evidencia parcial y segunda búsqueda",
    question: "¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución?",
  },
  // La primera evidencia no sirve y se descarta antes de encontrar S6.
  {
    id: "irrelevant-then-s6",
    label: "Primera evidencia descartada",
    question: "¿Qué cubre la sesión de observabilidad del programa?",
  },
  // Dato que no consta en el corpus: la respuesta es un rechazo.
  {
    id: "missing-info",
    label: "Dato ausente y rechazo",
    question: "¿Qué beca interna del año 1991 cubre este programa?",
  },
  // Pregunta de calendario sin cohorte: se pide aclaración antes de buscar.
  {
    id: "clarify-cohort",
    label: "Calendario sin cohorte",
    question: "¿Cuándo es la sesión de RAG avanzado?",
  },
  // Fallo provocado del evaluador para ver cómo termina el grafo con error.
  {
    id: "evaluator-error",
    label: "Fallo controlado del evaluador",
    question: "Provoca un fallo controlado del evaluador de prueba.",
  },
] as const;

// Identificadores válidos de guion; deben coincidir con los de la lista anterior.
export const demoScenarioSchema = z.enum([
  "sufficient-s5",
  "partial-s5-s6",
  "irrelevant-then-s6",
  "missing-info",
  "clarify-cohort",
  "evaluator-error",
]);

// Tipo con los seis identificadores de guion.
export type DemoScenarioId = z.infer<typeof demoScenarioSchema>;

// Un paso del grafo CRAG tal como se envía al navegador mientras se ejecuta.
export const cragStepSchema = z.object({
  // Ejecución a la que pertenece el paso.
  runId: z.string().min(1).max(128),
  // Qué hizo el grafo: buscar, ordenar, valorar suficiencia, reformular, conservar, descartar, responder, rechazar…
  kind: z.enum([
    "retrieve",
    "rank",
    "assess",
    "reformulate",
    "retain",
    "discard",
    "answer",
    "refuse",
    "clarify",
    "error",
    "abort",
  ]),
  // Número de búsqueda (0 a 3), o null si el paso no es una búsqueda.
  retrieval: z.number().int().min(0).max(3).nullable(),
  // Número de reformulación (0 a 2), o null.
  reformulation: z.number().int().min(0).max(2).nullable(),
  // Consulta usada en ese paso.
  query: z.string().max(500),
  // Texto de estado legible.
  status: z.string().min(1).max(240),
  // Veredicto del evaluador sobre la evidencia, si lo hay.
  evidenceStatus: z.enum(["sufficient", "partial", "insufficient"]).nullable(),
  // Fragmentos conservados (como mucho 6).
  retainedIds: z.array(z.string().min(1).max(128)).max(6),
  // Fragmentos descartados en este paso.
  discardedIds: z.array(z.string().min(1).max(128)).max(10),
});

// Tipo de un paso.
export type CragStep = z.infer<typeof cragStepSchema>;

// Contador de llamadas de un tipo: ejecuciones, llamadas al proveedor y duración.
const callSchema = z.object({
  // Veces que se ejecutó ese nodo del grafo.
  executions: z.number().int().min(0).max(3),
  // Llamadas reales al proveedor; null si no se pudo medir.
  providerCalls: z.number().int().min(0).max(3).nullable(),
  // Milisegundos acumulados, o null.
  durationMs: z.number().int().min(0).nullable(),
});

// Resumen final de un turno de CRAG.
export const cragSummarySchema = z.object({
  // Identificador de la ejecución.
  runId: z.string().min(1).max(128),
  // true si salió de la demostración con guiones.
  fixture: z.boolean(),
  // Guion usado, o null en una pregunta libre.
  scenarioId: z.string().min(1).max(64).nullable(),
  // Si las llamadas se midieron de verdad.
  measured: z.boolean(),
  // Si el turno terminó con una respuesta parcial.
  partial: z.boolean(),
  // Grupo de la pregunta.
  audience: audienceSchema,
  // Versión del corpus consultada.
  corpusVersion: z.string().min(1).max(128),
  // Perfil de índice usado.
  profileId: z.string().min(1).max(128),
  // Pregunta original del alumno.
  originalQuestion: z.string().min(1).max(2_000),
  // Última consulta enviada al índice.
  currentQuery: z.string().max(500),
  // Búsquedas hechas (máximo 3).
  retrievalCount: z.number().int().min(0).max(3),
  // Reformulaciones hechas (máximo 2).
  reformulationCount: z.number().int().min(0).max(2),
  // Búsquedas que aún quedaban.
  attemptsRemaining: z.number().int().min(0).max(3),
  // Reformulaciones que aún quedaban.
  rewritesRemaining: z.number().int().min(0).max(2),
  // Último veredicto sobre la evidencia.
  evidenceStatus: z.enum(["sufficient", "partial", "insufficient"]).nullable(),
  // Cómo terminó: respuesta, rechazo, aclaración, error o cancelación.
  terminal: z.enum(["answer", "refuse", "clarify", "error", "aborted"]),
  // Motivo legible del final.
  reason: z.string().min(1).max(240),
  // Fragmentos que respaldan la respuesta, con su motivo y puntuación en la escala [0, 1].
  retained: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(128),
        reason: z.string().min(1).max(240),
        score: z.number().min(0).max(1).nullable(),
      }),
    )
    .max(6),
  // Fragmentos descartados, con motivo y número de búsqueda.
  discarded: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(128),
        reason: z.string().min(1).max(240),
        attempt: z.number().int().min(1).max(3),
      }),
    )
    .max(24),
  // Llamadas por nodo: búsqueda, evaluación, reformulación y generación.
  calls: z.object({
    retrieval: callSchema,
    evaluation: callSchema,
    reformulation: callSchema,
    generation: callSchema,
  }),
  // Consumo de la generación final.
  usage: runUsageSchema.nullable(),
  // Coste estimado de la generación final.
  cost: runCostSchema.nullable(),
});

// Tipo del resumen.
export type CragSummary = z.infer<typeof cragSummarySchema>;
