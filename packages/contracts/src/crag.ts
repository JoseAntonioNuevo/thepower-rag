import { z } from "zod";
import { audienceSchema, runCostSchema, runUsageSchema } from "./domain";

export const DEMO_CRAG_SCENARIOS = [
  {
    id: "sufficient-s5",
    label: "Suficiente a la primera",
    question: "¿Cómo modela LangGraph un agente con estado y nodos?",
  },
  {
    id: "partial-s5-s6",
    label: "Evidencia parcial y segunda búsqueda",
    question: "¿Cómo modela LangGraph el estado de un agente y cómo se observa esa ejecución?",
  },
  {
    id: "irrelevant-then-s6",
    label: "Primera evidencia descartada",
    question: "¿Qué cubre la sesión de observabilidad del programa?",
  },
  {
    id: "missing-info",
    label: "Dato ausente y rechazo",
    question: "¿Qué beca interna del año 1991 cubre este programa?",
  },
  {
    id: "clarify-cohort",
    label: "Calendario sin cohorte",
    question: "¿Cuándo es la sesión de RAG avanzado?",
  },
  {
    id: "evaluator-error",
    label: "Fallo controlado del evaluador",
    question: "Provoca un fallo controlado del evaluador de prueba.",
  },
] as const;

export const demoScenarioSchema = z.enum([
  "sufficient-s5",
  "partial-s5-s6",
  "irrelevant-then-s6",
  "missing-info",
  "clarify-cohort",
  "evaluator-error",
]);

export type DemoScenarioId = z.infer<typeof demoScenarioSchema>;

export const cragStepSchema = z.object({
  runId: z.string().min(1).max(128),
  kind: z.enum([
    "retrieve",
    "rank",
    "reformulate",
    "retain",
    "discard",
    "answer",
    "refuse",
    "clarify",
    "error",
    "abort",
  ]),
  retrieval: z.number().int().min(0).max(3).nullable(),
  reformulation: z.number().int().min(0).max(2).nullable(),
  query: z.string().max(500),
  status: z.string().min(1).max(240),
  evidenceStatus: z.enum(["sufficient", "partial", "insufficient"]).nullable(),
  retainedIds: z.array(z.string().min(1).max(128)).max(6),
  discardedIds: z.array(z.string().min(1).max(128)).max(10),
});

export type CragStep = z.infer<typeof cragStepSchema>;

const callSchema = z.object({
  executions: z.number().int().min(0).max(3),
  providerCalls: z.number().int().min(0).max(3).nullable(),
  durationMs: z.number().int().min(0).nullable(),
});

export const cragSummarySchema = z.object({
  runId: z.string().min(1).max(128),
  fixture: z.boolean(),
  scenarioId: z.string().min(1).max(64).nullable(),
  measured: z.boolean(),
  partial: z.boolean(),
  audience: audienceSchema,
  corpusVersion: z.string().min(1).max(128),
  profileId: z.string().min(1).max(128),
  originalQuestion: z.string().min(1).max(2_000),
  currentQuery: z.string().max(500),
  retrievalCount: z.number().int().min(0).max(3),
  reformulationCount: z.number().int().min(0).max(2),
  attemptsRemaining: z.number().int().min(0).max(3),
  rewritesRemaining: z.number().int().min(0).max(2),
  evidenceStatus: z.enum(["sufficient", "partial", "insufficient"]).nullable(),
  terminal: z.enum(["answer", "refuse", "clarify", "error", "aborted"]),
  reason: z.string().min(1).max(240),
  retained: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(128),
        reason: z.string().min(1).max(240),
        score: z.number().finite().nullable(),
      }),
    )
    .max(6),
  discarded: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(128),
        reason: z.string().min(1).max(240),
        attempt: z.number().int().min(1).max(3),
      }),
    )
    .max(24),
  calls: z.object({
    retrieval: callSchema,
    evaluation: callSchema,
    reformulation: callSchema,
    generation: callSchema,
  }),
  usage: runUsageSchema.nullable(),
  cost: runCostSchema.nullable(),
});

export type CragSummary = z.infer<typeof cragSummarySchema>;
