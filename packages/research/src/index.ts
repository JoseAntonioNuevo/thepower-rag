// GUÍA DE LECTURA · packages/research/src/index.ts
// Punto de entrada del paquete @thepower-rag/research: lógica pura de la investigación de S12
// (evidencia, plan, política de parada, verificación del informe, fusión de medios y URLs).
// Funciones de evidencia y cobertura.
export {
  authorityAllows,
  buildShown,
  carryCoverage,
  dedupeEvidence,
  flatten,
  reconcileCoverage,
  sourceFor,
  storeInScope,
  validateAssessment,
  withoutHeadings,
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
export { boundedText, validateFollowUp, validatePlan, validateOrderArgs } from "./plan";
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
export { fuseInputs, orderNumber } from "./fusion";
// Tipos de la fusión.
export type { FusionInputText, FusionResult } from "./fusion";
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
  // Contexto de llamada, cancelación y consumo.
  CallContext,
  CancelLike,
  Consumption,
  // Evidencia y puertos de las políticas de la tienda y de la herramienta de pedidos.
  OrderToolPort,
  StoreEvidence,
  StoreEvidencePort,
  // Evidencia común y subpregunta del modelo.
  EvidenceItem,
  ModelSubquestion,
  // Lectura de páginas y sus fallos y resultados.
  PageReadPort,
  PageSnapshot,
  PortFailure,
  PortResult,
  // Ejecutor, modelo, observaciones, puertos, petición y resultado.
  ResearchExecutor,
  ResearchModelPort,
  ResearchObservation,
  ResearchPorts,
  ResearchRequest,
  ResearchResult,
  // Búsqueda web y argumentos de la herramienta.
  SearchHit,
  SearchPort,
  OrderToolArgs,
  // Evidencia mostrada, observación de texto y evidencias de herramienta y web.
  ShownEvidence,
  TextObservation,
  ToolEvidence,
  WebEvidence,
} from "./ports";
