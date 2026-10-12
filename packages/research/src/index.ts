// GUÍA DE LECTURA · packages/research/src/index.ts
// Punto de entrada del paquete @thepower-rag/research: lógica pura de la investigación de S12
// (evidencia, plan, política de parada, verificación del informe, fusión de medios y URLs).
// Funciones de evidencia y cobertura.
export {
  authorityAllows,
  buildShown,
  carryCoverage,
  courseInScope,
  dedupeEvidence,
  flatten,
  reconcileCoverage,
  sourceFor,
  validateAssessment,
} from "./evidence";
// Tipos de evidencia y cobertura.
export type {
  AcceptedEvidence,
  AssessmentResult,
  CoverageEntry,
  CoverageStatus,
  RejectedEvidence,
} from "./evidence";
// Validación del plan, del seguimiento y de los argumentos de la herramienta.
export { boundedText, validateFollowUp, validatePlan, validateSessionArgs } from "./plan";
// Tipos del plan.
export type { FollowUpQuery, PlanItem, ResearchPlan } from "./plan";
// Política: plazos, presupuesto de búsquedas y decisión del siguiente paso.
export {
  FOLLOW_UP_MIN_MS,
  attributeCause,
  callTimeoutMs,
  decideNext,
  emptyCounters,
  pagesLeft,
  remainingMs,
  searchesLeft,
} from "./policy";
// Tipos de la política.
export type { AttemptLog, Counters, GapCause, NextStep } from "./policy";
// Verificación de las afirmaciones del informe.
export {
  CLAIM_CHECK_METHOD,
  claimSupportVerdict,
  claimSupported,
  contentTokens,
  verifyReport,
} from "./report";
// Tipos del informe verificado.
export type { ClaimSupport, DroppedClaim, ReportClaim, VerifiedReport } from "./report";
// Fusión de imagen y audio.
export { dimensionPair, fuseInputs } from "./fusion";
// Tipos de la fusión.
export type { DimensionPair, FusionInputText, FusionResult } from "./fusion";
// Guion de la locución.
export { spokenScript } from "./speech-script";
// Política de URLs y detección de instrucciones incrustadas.
export {
  checkUrl,
  flagEmbeddedInstructions,
  normalizeUrl,
  parseAllowedDomains,
  webSourceId,
} from "./url-policy";
// Tipo del veredicto sobre una URL.
export type { UrlVerdict } from "./url-policy";
// Puertos (interfaces) de la investigación.
export type {
  CallContext,
  CancelLike,
  Consumption,
  CourseEvidence,
  CourseEvidencePort,
  CourseSessionToolPort,
  EvidenceItem,
  ModelSubquestion,
  PageReadPort,
  PageSnapshot,
  PortFailure,
  PortResult,
  ResearchExecutor,
  ResearchModelPort,
  ResearchObservation,
  ResearchPorts,
  ResearchRequest,
  ResearchResult,
  SearchHit,
  SearchPort,
  SessionToolArgs,
  ShownEvidence,
  TextObservation,
  ToolEvidence,
  WebEvidence,
} from "./ports";
