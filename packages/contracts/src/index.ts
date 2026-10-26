// GUÍA DE LECTURA · packages/contracts/src/index.ts
// Punto de entrada del paquete @thepower-rag/contracts: reexporta lo que usan el navegador,
// la API y los scripts. «export type» solo reexporta tipos y no añade código al bundle.
// Esquemas y utilidades de la petición de chat.
export {
  issuesFrom,
  chatMessageSchema,
  chatModeSchema,
  chatRequestSchema,
  messageText,
} from "./chat";
// Tipos del chat.
export type { ChatMessage, ChatMode, ChatRequest, FieldIssue } from "./chat";
// Esquemas del dominio: grupos, citas, consumo, coste, metadatos y traza.
export {
  audienceSchema,
  capabilityStatusSchema,
  citationSchema,
  cohortSchema,
  demoEventSchema,
  evidenceDecisionSchema,
  ragStepSchema,
  runCostSchema,
  runMetadataSchema,
  runUsageSchema,
  traceEventSchema,
} from "./domain";
// Tipos del dominio.
export type {
  Audience,
  CapabilityStatus,
  Citation,
  CohortId,
  DemoEvent,
  EvidenceDecision,
  RagStep,
  RunMetadata,
  TraceEvent,
} from "./domain";
// Esquema de las respuestas de error.
export { errorResponseSchema } from "./errors";
// Tipo de una respuesta de error.
export type { ErrorResponse } from "./errors";
// Esquema de /api/health.
export { chatCorpusIdSchema, healthResponseSchema } from "./health";
// Tipo de la respuesta de salud.
export type { ChatCorpusId, HealthResponse } from "./health";
// Límites, nombres de variables y elección de proveedor y razonamiento.
export {
  // Variables de CRAG, proveedor por defecto y variables de generación.
  CRAG_VARIABLES,
  DEFAULT_LLM_PROVIDER,
  GENERATION_VARIABLES,
  // Límites generales y proveedores admitidos.
  LIMITS,
  LLM_PROVIDERS,
  // Credencial y variables de cada proveedor.
  PROVIDER_CREDENTIAL,
  PROVIDER_ENV_VARIABLES,
  // Bindings y variables del RAG.
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  // Niveles de razonamiento y funciones que los leen.
  REASONING_EFFORTS,
  generationVariables,
  // Comprueba si un valor está configurado (no es un marcador replace-with).
  isConfiguredValue,
  // Proveedor y razonamiento elegidos.
  llmProvider,
  reasoningEffort,
} from "./limits";
// Tipos de esos nombres.
export type {
  CragVariable,
  GenerationVariable,
  LlmProvider,
  RagBindingName,
  RagSettingVariable,
  ReasoningEffort,
} from "./limits";
// Guiones y esquemas de CRAG.
export { DEMO_CRAG_SCENARIOS, cragStepSchema, cragSummarySchema, demoScenarioSchema } from "./crag";
// Tipos de CRAG.
export type { CragStep, CragSummary, DemoScenarioId } from "./crag";
// Límites, guiones y esquemas de la investigación.
export {
  // Dominios, pregunta y guiones de la demo.
  DEFAULT_RESEARCH_DOMAINS,
  DEMO_RESEARCH_QUESTION,
  DEMO_RESEARCH_SCENARIOS,
  // Mensaje y límites de la investigación.
  RESEARCH_ACCOUNTING_MISSING,
  RESEARCH_LIMITS,
  // Autorización de gasto y variables.
  RESEARCH_SPEND_TOKEN,
  RESEARCH_VARIABLES,
  // Esquemas Zod de nodos, resultados, rutas y guiones.
  researchNodeSchema,
  researchOutcomeSchema,
  researchRouteSchema,
  researchScenarioSchema,
  // Esquemas de fuentes, medios y pasos.
  researchSourceIdSchema,
  researchMediaSchema,
  researchSourceSchema,
  researchStepSchema,
  // Esquemas de parada, subpreguntas, resumen y tipos de subpregunta.
  researchStopSchema,
  researchSubquestionSchema,
  researchSummarySchema,
  subquestionKindSchema,
} from "./research";
// Tipo de los medios de la investigación.
export type { ResearchMedia } from "./research";
// Límites de medios y reglas del modelo de visión.
export {
  MEDIA_LIMITS,
  VISION_MODEL_IDS,
  isVisionModel,
  maxVisionInputTokens,
  visionModelAccepted,
  visualTokens,
} from "./media";
// Tipo de los IDs de visión de Claude.
export type { VisionModelId } from "./media";
// Tipos de la investigación.
export type {
  ResearchNode,
  ResearchOutcome,
  ResearchRoute,
  ResearchScenarioId,
  ResearchSource,
  ResearchStep,
  ResearchStop,
  ResearchSubquestion,
  ResearchSummary,
  ResearchVariable,
  SubquestionKind,
} from "./research";
// Tipos del mensaje que viaja entre la API y React.
export type { CourseDataParts, CourseUIMessage } from "./ui-message";
// Consola docente local del laboratorio: no importa adaptadores de servidor.
export { AULA_STAGES, aulaStages } from "./aula";
export type {
  AulaStageId,
  AulaKind,
  AulaMode,
  AulaRunStatus,
  AulaJson,
  AulaObserver,
  AulaEvent,
  AulaRun,
  AulaStoredChunk,
  AulaDocument,
  AulaStatus,
} from "./aula";
