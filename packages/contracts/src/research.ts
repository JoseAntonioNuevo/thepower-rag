import { z } from "zod";
import { audienceSchema } from "./domain";

/**
 * Límites de laboratorio de la etapa de investigación (fase 1 de S12).
 * Son ajustes iniciales, no garantías de rendimiento. Los topes globales
 * mandan sobre el trabajo por subpregunta y no se reinician entre rondas.
 */
export const RESEARCH_LIMITS = {
  maxSubquestions: 3,
  maxRounds: 2,
  maxSearchCalls: 4,
  maxPagesRead: 6,
  maxPagesPerRound: 4,
  maxResultsPerSearch: 5,
  maxDiscovered: 20,
  maxToolCalls: 2,
  maxCourseQueries: 6,
  maxModelCalls: 5,
  deadlineMs: 120_000,
  minCallMs: 1_000,
  timeouts: {
    planMs: 20_000,
    courseMs: 10_000,
    toolMs: 5_000,
    searchMs: 15_000,
    readMs: 25_000,
    assessMs: 30_000,
    followUpMs: 15_000,
    synthesisMs: 40_000,
  },
  maxSearchResponseBytes: 262_144,
  maxReadResponseBytes: 1_048_576,
  maxPageChars: 12_000,
  maxCourseFragmentsPerQuery: 4,
  maxEvidenceItems: 16,
  maxContextChars: 30_000,
  maxExcerptChars: 500,
  maxExcerptsPerSource: 3,
  maxQueryChars: 300,
  maxQuestionChars: 2_000,
  maxSubquestionChars: 300,
  maxReasonChars: 240,
  maxTitleChars: 200,
  maxUrlChars: 600,
  maxFindings: 6,
  maxChecks: 5,
  maxUnresolved: 5,
  maxClaimChars: 600,
  maxAnswerChars: 1_200,
  maxOutputTokens: {
    plan: 800,
    assess: 3_200,
    followUp: 800,
    synthesis: 1_800,
  },
  maxTraceEntries: 80,
} as const;

/** Dominios de documentación oficial admitidos por defecto para leer páginas. */
export const DEFAULT_RESEARCH_DOMAINS = [
  "developers.cloudflare.com",
  "docs.langchain.com",
  "langchain-ai.github.io",
] as const;

export const RESEARCH_VARIABLES = [
  "RESEARCH_MODEL_ID",
  "FIRECRAWL_API_KEY",
  "RESEARCH_SPEND_AUTHORIZATION",
  "RESEARCH_BUDGET_USD",
] as const;

export type ResearchVariable = (typeof RESEARCH_VARIABLES)[number];

/**
 * Valor exacto que tiene que llevar RESEARCH_SPEND_AUTHORIZATION. No se
 * hereda de la autorización de puesta en marcha del RAG.
 */
export const RESEARCH_SPEND_TOKEN = "s12-research-phase1";

/**
 * Pieza que falta en la fase 1 para poder gastar: un libro de cuentas
 * durable de la investigación completa. Siempre aparece como ausente.
 */
export const RESEARCH_ACCOUNTING_MISSING = "RESEARCH_DURABLE_ACCOUNTING";

export const DEMO_RESEARCH_QUESTION =
  "He cambiado el modelo de embeddings y mi RAG muestra:\nDimension mismatch: expected 1024, got 768.\nInvestiga qué significa, cómo comprobar la configuración y qué opciones tengo para corregirlo. Relaciónalo con lo visto en el curso.";

export const DEMO_RESEARCH_SCENARIOS = [
  {
    id: "sufficient-first-round",
    label: "Evidencia suficiente en la primera ronda",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "partial-follow-up",
    label: "Evidencia parcial y ronda de seguimiento",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "irrelevant-discarded",
    label: "Página irrelevante descartada",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "internal-fact-missing",
    label: "Dato interno del curso sin documentar",
    question:
      "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?",
  },
  {
    id: "provider-failure",
    label: "Fallo del buscador y de una lectura",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "no-progress-stop",
    label: "Parada por falta de progreso",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "invalid-citation",
    label: "Cita inválida y conclusión sin apoyo",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "course-tool",
    label: "Dato interno con la herramienta de sesión",
    question: "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?",
  },
  {
    id: "slow-search",
    label: "Búsqueda lenta para cancelar",
    question: DEMO_RESEARCH_QUESTION,
  },
  {
    id: "ambiguous-operation",
    label: "Operación ambigua: hace falta conciliación",
    question: DEMO_RESEARCH_QUESTION,
  },
] as const;

export const researchScenarioSchema = z.enum([
  "sufficient-first-round",
  "partial-follow-up",
  "irrelevant-discarded",
  "internal-fact-missing",
  "provider-failure",
  "no-progress-stop",
  "invalid-citation",
  "course-tool",
  "slow-search",
  "ambiguous-operation",
  "crash-after-plan",
]);

export type ResearchScenarioId = z.infer<typeof researchScenarioSchema>;

const L = RESEARCH_LIMITS;
const reason = z.string().min(1).max(L.maxReasonChars);
const query = z.string().min(1).max(L.maxQueryChars);
export const researchSourceIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const subquestionId = z.enum(["q1", "q2", "q3"]);
const excerpt = z.string().min(1).max(L.maxExcerptChars);

export const subquestionKindSchema = z.enum(["course", "session", "technical"]);
export type SubquestionKind = z.infer<typeof subquestionKindSchema>;

export const researchRouteSchema = z.enum(["course", "tool", "investigate", "clarify"]);
export type ResearchRoute = z.infer<typeof researchRouteSchema>;

export const researchSubquestionSchema = z.object({
  id: subquestionId,
  text: z.string().min(1).max(L.maxSubquestionChars),
  kind: subquestionKindSchema,
  external: z.boolean(),
});
export type ResearchSubquestion = z.infer<typeof researchSubquestionSchema>;

export const researchSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("course"),
    sourceId: researchSourceIdSchema,
    documentId: z.string().min(1).max(128),
    title: z.string().min(1).max(L.maxTitleChars),
    section: z.string().max(L.maxTitleChars),
    excerpts: z.array(excerpt).min(1).max(L.maxExcerptsPerSource),
    corpusVersion: z.string().min(1).max(128),
    audience: audienceSchema,
    subquestionIds: z.array(subquestionId).max(L.maxSubquestions),
  }),
  z.object({
    kind: z.literal("tool"),
    sourceId: researchSourceIdSchema,
    toolName: z.literal("get_course_session"),
    title: z.string().min(1).max(L.maxTitleChars),
    excerpts: z.array(excerpt).min(1).max(L.maxExcerptsPerSource),
    backingSourceIds: z.array(researchSourceIdSchema).min(1).max(4),
    corpusVersion: z.string().min(1).max(128),
    audience: audienceSchema,
    subquestionIds: z.array(subquestionId).max(L.maxSubquestions),
  }),
  z.object({
    kind: z.literal("web"),
    sourceId: researchSourceIdSchema,
    url: z.string().url().max(L.maxUrlChars),
    domain: z.string().min(1).max(253),
    title: z.string().min(1).max(L.maxTitleChars),
    retrievedAt: z.string().datetime(),
    publishedAt: z.string().max(64).nullable(),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    excerpts: z.array(excerpt).min(1).max(L.maxExcerptsPerSource),
    subquestionIds: z.array(subquestionId).max(L.maxSubquestions),
    fixture: z.boolean(),
  }),
  z.object({
    kind: z.literal("attachment"),
    sourceId: researchSourceIdSchema,
    role: z.enum(["image", "audio"]),
    assetId: z.string().regex(/^[0-9a-f-]{36}$/i),
    title: z.string().min(1).max(L.maxTitleChars),
    excerpts: z.array(excerpt).min(1).max(L.maxExcerptsPerSource),
    contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    authority: z.literal("user-input"),
    subquestionIds: z.array(subquestionId).max(L.maxSubquestions),
  }),
]);
export type ResearchSource = z.infer<typeof researchSourceSchema>;

export const researchNodeSchema = z.enum([
  "validate",
  "plan",
  "course",
  "tool",
  "search",
  "select",
  "read",
  "assess",
  "decide",
  "follow-up",
  "synthesize",
  "verify",
  "finish",
]);
export type ResearchNode = z.infer<typeof researchNodeSchema>;

export const researchStepSchema = z.object({
  runId: z.string().min(1).max(128),
  node: researchNodeSchema,
  round: z.number().int().min(0).max(L.maxRounds),
  status: z.string().min(1).max(L.maxReasonChars),
});
export type ResearchStep = z.infer<typeof researchStepSchema>;

export const researchStopSchema = z.enum([
  "all-covered",
  "course-answer",
  "clarify",
  "max-rounds",
  "search-budget",
  "page-budget",
  "deadline",
  "no-progress",
  "repeated-queries",
  "no-specific-gap",
  "provider-failure",
  "model-failure",
  "invalid-output",
  "aborted",
  "nothing-supported",
  "unresolved-contradiction",
]);
export type ResearchStop = z.infer<typeof researchStopSchema>;

export const researchOutcomeSchema = z.enum([
  "complete",
  "partial",
  "refused",
  "clarify",
  "error",
  "aborted",
]);
export type ResearchOutcome = z.infer<typeof researchOutcomeSchema>;

const callStatus = z.enum(["ok", "error", "timeout", "late", "skipped"]);
const assetId = z.string().regex(/^[0-9a-f-]{36}$/i);
const contentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const mediaDetail = z.string().max(L.maxReasonChars);

export const researchMediaSchema = z.object({
  visionCalls: z.number().int().min(0).max(1),
  transcriptionCalls: z.number().int().min(0).max(1),
  speechCalls: z.number().int().min(0).max(1),
  image: z
    .object({
      assetId,
      contentHash,
      status: z.enum(["read", "failed", "unknown-fixture"]),
      observedText: z.string().max(1_000),
      notes: z.string().max(500),
      uncertain: z.boolean(),
      detail: mediaDetail,
    })
    .nullable(),
  audio: z
    .object({
      assetId,
      contentHash,
      status: z.enum(["read", "failed", "unknown-fixture"]),
      transcript: z.string().max(1_000),
      detail: mediaDetail,
      language: z.string().max(16).nullable(),
      durationSeconds: z.number().finite().nonnegative().nullable(),
      wordCount: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  conflict: z.string().max(L.maxReasonChars).nullable(),
  speech: z
    .object({
      status: z.enum(["ready", "failed", "skipped", "ambiguous", "unconfigured"]),
      text: z.string().max(600),
      assetId: assetId.nullable(),
      mime: z.string().max(80).nullable(),
      detail: mediaDetail,
      fixture: z.boolean(),
    })
    .nullable(),
});

export const researchSummarySchema = z.object({
  runId: z.string().min(1).max(128),
  fixture: z.boolean(),
  scenarioId: researchScenarioSchema.nullable(),
  measured: z.boolean(),
  audience: audienceSchema,
  corpusVersion: z.string().min(1).max(128),
  originalQuestion: z.string().min(1).max(L.maxQuestionChars),
  route: researchRouteSchema.nullable(),
  planRationale: z.string().max(L.maxReasonChars).nullable(),
  subquestions: z.array(researchSubquestionSchema).max(L.maxSubquestions),
  rounds: z.number().int().min(0).max(L.maxRounds),
  courseQueries: z
    .array(
      z.object({
        round: z.number().int().min(1).max(L.maxRounds),
        subquestionId,
        query,
        status: callStatus,
        sourceIds: z.array(researchSourceIdSchema).max(L.maxCourseFragmentsPerQuery),
      }),
    )
    .max(L.maxCourseQueries),
  toolCalls: z
    .array(
      z.object({
        round: z.number().int().min(1).max(L.maxRounds),
        name: z.literal("get_course_session"),
        args: z.object({ sessionId: z.string().max(8), audience: audienceSchema }),
        status: z.enum(["ok", "rejected", "error"]),
        detail: reason,
        sourceIds: z.array(researchSourceIdSchema).max(4),
      }),
    )
    .max(L.maxToolCalls),
  searches: z
    .array(
      z.object({
        round: z.number().int().min(1).max(L.maxRounds),
        subquestionId,
        query,
        status: callStatus,
        resultCount: z.number().int().min(0).max(L.maxResultsPerSearch),
        detail: reason,
      }),
    )
    .max(L.maxSearchCalls),
  discovered: z
    .array(
      z.object({
        round: z.number().int().min(1).max(L.maxRounds),
        url: z.string().max(L.maxUrlChars),
        title: z.string().max(L.maxTitleChars),
        domain: z.string().max(253),
        decision: z.enum(["selected", "not-allowed", "duplicate", "already-read", "over-budget"]),
      }),
    )
    .max(L.maxDiscovered),
  pagesRead: z
    .array(
      z.object({
        round: z.number().int().min(1).max(L.maxRounds),
        url: z.string().max(L.maxUrlChars),
        finalUrl: z.string().max(L.maxUrlChars).nullable(),
        sourceId: researchSourceIdSchema.nullable(),
        status: z.enum(["ok", "error", "timeout", "late", "rejected"]),
        detail: reason,
        chars: z.number().int().min(0).max(L.maxPageChars),
        contentHash: z.string().max(80).nullable(),
        instructionsFlagged: z.boolean(),
      }),
    )
    .max(L.maxPagesRead),
  accepted: z
    .array(
      z.object({
        sourceId: researchSourceIdSchema,
        kind: z.enum(["course", "tool", "web"]),
        subquestionIds: z.array(subquestionId).min(1).max(L.maxSubquestions),
        reason,
      }),
    )
    .max(L.maxEvidenceItems),
  rejected: z
    .array(
      z.object({
        sourceId: researchSourceIdSchema,
        kind: z.enum(["course", "tool", "web"]),
        round: z.number().int().min(1).max(L.maxRounds),
        reason,
      }),
    )
    .max(L.maxEvidenceItems * 2),
  coverage: z
    .array(
      z.object({
        subquestionId,
        status: z.enum(["covered", "partial", "uncovered"]),
        cause: z.enum(["evidence", "missing-evidence", "operational-failure", "not-allowed"]),
        gap: z.string().max(L.maxReasonChars).nullable(),
        sourceIds: z.array(researchSourceIdSchema).max(L.maxEvidenceItems),
      }),
    )
    .max(L.maxSubquestions),
  contradictions: z.array(reason).max(3),
  followUp: z
    .object({
      reason,
      queries: z.array(z.object({ subquestionId, query })).max(L.maxSubquestions),
    })
    .nullable(),
  stop: researchStopSchema,
  stopDetail: reason,
  outcome: researchOutcomeSchema,
  claimCheck: z.object({
    method: z.string().min(1).max(L.maxReasonChars),
    checked: z
      .number()
      .int()
      .min(0)
      .max(L.maxFindings + L.maxChecks + 1),
    dropped: z
      .array(
        z.object({
          claim: z.string().max(L.maxClaimChars),
          reason,
        }),
      )
      .max(L.maxFindings + L.maxChecks + 1),
  }),
  citedSourceIds: z.array(researchSourceIdSchema).max(L.maxEvidenceItems),
  counters: z.object({
    searchCalls: z.number().int().min(0).max(L.maxSearchCalls),
    pagesRead: z.number().int().min(0).max(L.maxPagesRead),
    modelCalls: z.number().int().min(0).max(L.maxModelCalls),
    toolCalls: z.number().int().min(0).max(L.maxToolCalls),
    courseQueries: z.number().int().min(0).max(L.maxCourseQueries),
    elapsedMs: z.number().int().min(0).nullable(),
  }),
  limits: z.object({
    maxSubquestions: z.number().int(),
    maxRounds: z.number().int(),
    maxSearchCalls: z.number().int(),
    maxPagesRead: z.number().int(),
    deadlineMs: z.number().int(),
  }),
  accounting: z.object({
    measured: z.boolean(),
    estimatedMaxUsd: z.number().finite().nonnegative().nullable(),
    providerReportedUsd: z.number().finite().nonnegative().nullable(),
    providerReportedCredits: z.number().finite().nonnegative().nullable(),
    /** USD calculado con tarifas publicadas. No es providerReportedUsd. */
    estimatedUsd: z.number().finite().nonnegative().nullable().optional(),
    estimateProvenance: z.string().min(1).max(L.maxReasonChars).nullable().optional(),
    estimateComplete: z.boolean().nullable().optional(),
    unknownConsumptionCalls: z.number().int().min(0),
    finalAnswerUsd: z.number().finite().nonnegative().nullable(),
    totalComplete: z.boolean(),
    note: z.string().min(1).max(L.maxReasonChars),
  }),
  trace: z.array(researchStepSchema).max(L.maxTraceEntries),
  threadId: z.string().min(1).max(80).nullable().optional(),
  jobId: z.string().min(1).max(80).nullable().optional(),
  contextualizedQuestion: z.string().max(L.maxQuestionChars).nullable().optional(),
  media: researchMediaSchema.optional(),
});

export type ResearchMedia = z.infer<typeof researchMediaSchema>;
export type ResearchSummary = z.infer<typeof researchSummarySchema>;
