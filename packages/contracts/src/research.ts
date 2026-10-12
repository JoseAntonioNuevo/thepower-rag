// GUÍA DE LECTURA · packages/contracts/src/research.ts
// Contrato de la investigación de S12: límites del laboratorio, guiones de la demo, fuentes
// (curso, herramienta, web y adjuntos), pasos del grafo y el resumen completo que ve el navegador.
// Zod declara y valida la forma de los datos.
import { z } from "zod";
// Audiencia del curso: programa o cohorte.
import { audienceSchema } from "./domain";

/**
 * Límites de laboratorio de la etapa de investigación (fase 1 de S12).
 * Son ajustes iniciales, no garantías de rendimiento. Los topes globales
 * mandan sobre el trabajo por subpregunta y no se reinician entre rondas.
 */
export const RESEARCH_LIMITS = {
  // Subpreguntas máximas en que se divide una pregunta.
  maxSubquestions: 3,
  // Rondas de búsqueda: la inicial y una de seguimiento.
  maxRounds: 2,
  // Búsquedas externas en total.
  maxSearchCalls: 4,
  // Páginas leídas en total.
  maxPagesRead: 6,
  // Páginas leídas en una misma ronda.
  maxPagesPerRound: 4,
  // Resultados que se piden a cada búsqueda.
  maxResultsPerSearch: 5,
  // URLs descubiertas que se registran.
  maxDiscovered: 20,
  // Llamadas a la herramienta de sesiones del curso.
  maxToolCalls: 2,
  // Consultas al corpus del curso.
  maxCourseQueries: 6,
  // Llamadas al modelo (plan, evaluación, seguimiento y síntesis).
  maxModelCalls: 5,
  // Plazo total de la investigación: 2 minutos.
  deadlineMs: 120_000,
  // Tiempo mínimo que debe quedar para empezar otra llamada.
  minCallMs: 1_000,
  // Plazos de cada tipo de llamada en milisegundos.
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
  // Bytes máximos de una respuesta del buscador.
  maxSearchResponseBytes: 262_144,
  // Bytes máximos de una página leída.
  maxReadResponseBytes: 1_048_576,
  // Caracteres de una página que se conservan.
  maxPageChars: 12_000,
  // Fragmentos del curso por consulta.
  maxCourseFragmentsPerQuery: 4,
  // Evidencias aceptadas como máximo.
  maxEvidenceItems: 16,
  // Caracteres de contexto que se envían al modelo.
  maxContextChars: 30_000,
  // Caracteres de cada extracto citado.
  maxExcerptChars: 500,
  // Extractos por fuente.
  maxExcerptsPerSource: 3,
  // Caracteres de una consulta de búsqueda.
  maxQueryChars: 300,
  // Caracteres de la pregunta original.
  maxQuestionChars: 2_000,
  // Caracteres de una subpregunta.
  maxSubquestionChars: 300,
  // Caracteres de un motivo o explicación.
  maxReasonChars: 240,
  // Caracteres de un título.
  maxTitleChars: 200,
  // Caracteres de una URL.
  maxUrlChars: 600,
  // Hallazgos máximos del informe.
  maxFindings: 6,
  // Comprobaciones máximas.
  maxChecks: 5,
  // Puntos sin resolver que se listan.
  maxUnresolved: 5,
  // Caracteres de una afirmación comprobada.
  maxClaimChars: 600,
  // Caracteres de la respuesta final.
  maxAnswerChars: 1_200,
  // Tokens de salida por tipo de llamada al modelo.
  maxOutputTokens: {
    plan: 800,
    assess: 3_200,
    followUp: 800,
    synthesis: 1_800,
  },
  // Pasos máximos de la traza.
  maxTraceEntries: 80,
} as const;

/** Dominios de documentación oficial admitidos por defecto para leer páginas. */
export const DEFAULT_RESEARCH_DOMAINS = [
  "developers.cloudflare.com",
  "docs.langchain.com",
  "langchain-ai.github.io",
] as const;

// Variables que la investigación real necesita además del RAG.
export const RESEARCH_VARIABLES = [
  "RESEARCH_MODEL_ID",
  "FIRECRAWL_API_KEY",
  "RESEARCH_SPEND_AUTHORIZATION",
  "RESEARCH_BUDGET_USD",
] as const;

// Tipo con esos nombres.
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

// Pregunta de la demo: un error real de dimensiones de embeddings que hay que investigar.
export const DEMO_RESEARCH_QUESTION =
  "He cambiado el modelo de embeddings y mi RAG muestra:\nDimension mismatch: expected 1024, got 768.\nInvestiga qué significa, cómo comprobar la configuración y qué opciones tengo para corregirlo. Relaciónalo con lo visto en el curso.";

// Guiones de la demo de investigación; cada uno enseña un recorrido del grafo sin gastar.
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

// Identificadores válidos de guion (incluye uno extra para probar un fallo tras el plan).
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

// Tipo con los identificadores de guion.
export type ResearchScenarioId = z.infer<typeof researchScenarioSchema>;

// Alias corto de los límites para los esquemas siguientes.
const L = RESEARCH_LIMITS;
// Motivo o explicación con su tope.
const reason = z.string().min(1).max(L.maxReasonChars);
// Consulta de búsqueda con su tope.
const query = z.string().min(1).max(L.maxQueryChars);
// Identificador de fuente: letras, números, dos puntos, guiones; hasta 128 caracteres.
export const researchSourceIdSchema = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
// Las subpreguntas se llaman q1, q2 y q3.
const subquestionId = z.enum(["q1", "q2", "q3"]);
// Extracto citado con su tope.
const excerpt = z.string().min(1).max(L.maxExcerptChars);

// Tipo de subpregunta: del curso, de una sesión concreta o técnica.
export const subquestionKindSchema = z.enum(["course", "session", "technical"]);
// Tipo correspondiente.
export type SubquestionKind = z.infer<typeof subquestionKindSchema>;

// Ruta del plan: responder con el curso, usar la herramienta, investigar fuera o aclarar.
export const researchRouteSchema = z.enum(["course", "tool", "investigate", "clarify"]);
// Tipo correspondiente.
export type ResearchRoute = z.infer<typeof researchRouteSchema>;

// Subpregunta del plan.
export const researchSubquestionSchema = z.object({
  // q1, q2 o q3.
  id: subquestionId,
  // Texto de la subpregunta.
  text: z.string().min(1).max(L.maxSubquestionChars),
  // Tipo de subpregunta.
  kind: subquestionKindSchema,
  // Si necesita fuentes externas.
  external: z.boolean(),
});
// Tipo de una subpregunta.
export type ResearchSubquestion = z.infer<typeof researchSubquestionSchema>;

// Fuente de evidencia; kind indica de cuál de los cuatro tipos es.
export const researchSourceSchema = z.discriminatedUnion("kind", [
  // Fragmento del corpus del curso.
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
  // Resultado de la herramienta de sesiones, respaldado por fragmentos del curso.
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
  // Página web leída, con fecha de lectura y hash del contenido.
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
  // Imagen o audio que subió el usuario; su autoridad es la de una entrada del usuario.
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
// Tipo de una fuente.
export type ResearchSource = z.infer<typeof researchSourceSchema>;

// Nodos del grafo de investigación, en el orden aproximado en que se recorren.
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
// Tipo de un nodo.
export type ResearchNode = z.infer<typeof researchNodeSchema>;

// Paso del grafo que se envía al navegador mientras se ejecuta.
export const researchStepSchema = z.object({
  // Ejecución a la que pertenece.
  runId: z.string().min(1).max(128),
  // Nodo que se ejecutó.
  node: researchNodeSchema,
  // Ronda de búsqueda.
  round: z.number().int().min(0).max(L.maxRounds),
  // Estado legible.
  status: z.string().min(1).max(L.maxReasonChars),
});
// Tipo de un paso.
export type ResearchStep = z.infer<typeof researchStepSchema>;

// Motivo por el que se detuvo la investigación.
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
// Tipo del motivo de parada.
export type ResearchStop = z.infer<typeof researchStopSchema>;

// Resultado global de la investigación.
export const researchOutcomeSchema = z.enum([
  "complete",
  "partial",
  "refused",
  "clarify",
  "error",
  "aborted",
]);
// Tipo del resultado.
export type ResearchOutcome = z.infer<typeof researchOutcomeSchema>;

// Estado de una llamada externa.
const callStatus = z.enum(["ok", "error", "timeout", "late", "skipped"]);
// Identificador de adjunto (UUID).
const assetId = z.string().regex(/^[0-9a-f-]{36}$/i);
// Hash SHA-256 del contenido con prefijo.
const contentHash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
// Detalle legible de un medio.
const mediaDetail = z.string().max(L.maxReasonChars);

// Resumen de los medios de una investigación: imagen, audio, voz y posibles conflictos.
export const researchMediaSchema = z.object({
  // Lecturas de imagen hechas (0 o 1).
  visionCalls: z.number().int().min(0).max(1),
  // Transcripciones hechas (0 o 1).
  transcriptionCalls: z.number().int().min(0).max(1),
  // Locuciones generadas (0 o 1).
  speechCalls: z.number().int().min(0).max(1),
  // Resultado de leer la imagen, o null si no había.
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
  // Resultado de transcribir el audio, o null.
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
  // Contradicción entre imagen y audio, si la hay.
  conflict: z.string().max(L.maxReasonChars).nullable(),
  // Locución del resumen, o null.
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

// Resumen completo de una investigación: plan, búsquedas, evidencias, cobertura, parada y cuentas.
export const researchSummarySchema = z.object({
  // Identificador de la ejecución.
  runId: z.string().min(1).max(128),
  // true si salió de la demo con guiones.
  fixture: z.boolean(),
  // Guion usado, o null.
  scenarioId: researchScenarioSchema.nullable(),
  // Si el consumo se midió de verdad.
  measured: z.boolean(),
  // Grupo de la pregunta.
  audience: audienceSchema,
  // Versión del corpus.
  corpusVersion: z.string().min(1).max(128),
  // Pregunta original.
  originalQuestion: z.string().min(1).max(L.maxQuestionChars),
  // Ruta elegida por el plan.
  route: researchRouteSchema.nullable(),
  // Explicación del plan.
  planRationale: z.string().max(L.maxReasonChars).nullable(),
  // Subpreguntas del plan.
  subquestions: z.array(researchSubquestionSchema).max(L.maxSubquestions),
  // Rondas hechas.
  rounds: z.number().int().min(0).max(L.maxRounds),
  // Consultas al corpus del curso.
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
  // Llamadas a la herramienta de sesiones.
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
  // Búsquedas externas.
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
  // URLs descubiertas y qué se decidió con cada una.
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
  // Páginas leídas, con su estado y si contenían instrucciones sospechosas.
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
  // Evidencias aceptadas y a qué subpreguntas cubren.
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
  // Evidencias rechazadas y por qué.
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
  // Cobertura de cada subpregunta y la laguna que queda.
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
  // Contradicciones detectadas.
  contradictions: z.array(reason).max(3),
  // Ronda de seguimiento, si la hubo.
  followUp: z
    .object({
      reason,
      queries: z.array(z.object({ subquestionId, query })).max(L.maxSubquestions),
    })
    .nullable(),
  // Motivo de parada.
  stop: researchStopSchema,
  // Explicación de la parada.
  stopDetail: reason,
  // Resultado global.
  outcome: researchOutcomeSchema,
  // Comprobación de las afirmaciones del informe contra los extractos citados.
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
  // Fuentes citadas en el informe.
  citedSourceIds: z.array(researchSourceIdSchema).max(L.maxEvidenceItems),
  // Contadores de uso frente a los límites.
  counters: z.object({
    searchCalls: z.number().int().min(0).max(L.maxSearchCalls),
    pagesRead: z.number().int().min(0).max(L.maxPagesRead),
    modelCalls: z.number().int().min(0).max(L.maxModelCalls),
    toolCalls: z.number().int().min(0).max(L.maxToolCalls),
    courseQueries: z.number().int().min(0).max(L.maxCourseQueries),
    elapsedMs: z.number().int().min(0).nullable(),
  }),
  // Límites aplicados en esta ejecución.
  limits: z.object({
    maxSubquestions: z.number().int(),
    maxRounds: z.number().int(),
    maxSearchCalls: z.number().int(),
    maxPagesRead: z.number().int(),
    deadlineMs: z.number().int(),
  }),
  // Contabilidad de la investigación: estimaciones e importes informados.
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
  // Traza de pasos.
  trace: z.array(researchStepSchema).max(L.maxTraceEntries),
  // Conversación a la que pertenece (investigación durable).
  threadId: z.string().min(1).max(80).nullable().optional(),
  // Trabajo durable que la ejecutó.
  jobId: z.string().min(1).max(80).nullable().optional(),
  // Pregunta reescrita con el contexto de la conversación.
  contextualizedQuestion: z.string().max(L.maxQuestionChars).nullable().optional(),
  // Medios de la investigación.
  media: researchMediaSchema.optional(),
});

// Tipo del resumen de medios.
export type ResearchMedia = z.infer<typeof researchMediaSchema>;
// Tipo del resumen de la investigación.
export type ResearchSummary = z.infer<typeof researchSummarySchema>;
