// GUÍA DE LECTURA · packages/rag/src/index.ts
// Punto de entrada del paquete @thepower-rag/core: reexporta la lógica del RAG sin depender de
// Cloudflare (troceado, ingesta, CRAG, recuperación, presupuesto y embeddings de prueba).
// Topes de CRAG y planificación de pasos.
export { CRAG_LIMITS, planReformulation, planRetrieval } from "./limits";
// Tipo del plan de un paso.
export type { Plan } from "./limits";
// Troceado de los documentos Markdown.
export { chunkId, chunkMarkdown } from "./chunk";
// Tipos del troceado.
export type { ChunkOptions, PreparedChunk } from "./chunk";
// Embedding léxico y coseno de la demostración.
export {
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  cosine,
  fixtureEmbed,
} from "./fixture-embed";
// Huella FNV-1a.
export { fnv1a64 } from "./hash";
// Ingesta del corpus en el índice y su diario.
export {
  INGEST_ORDER,
  applyActiveSelection,
  catalogMatches,
  classifyIndexReadback,
  contentManifestFrom,
  ingestionPhase,
  journalForProfile,
  journalItem,
  manifestFrom,
  runIngestion,
  selectActiveProfile,
  serializeContentManifest,
  serializeManifest,
  validateVectors,
} from "./ingest";
// Tipos de la ingesta.
export type {
  CatalogSnapshot,
  ContentManifest,
  CorpusManifest,
  IndexDescription,
  IngestEvidence,
  IngestJournalItem,
  IngestPorts,
  IngestionPhase,
  JournalOutcome,
  StoreName,
  VectorWrite,
  VisibleVector,
} from "./ingest";
// Nombres, límites e identificadores de los recursos del curso.
export {
  COURSE_D1_NAME,
  COURSE_R2_NAME,
  COURSE_VECTORIZE_PREFIX,
  INDEX_NAME_MAX_BYTES,
  METADATA_VALUE_MAX_BYTES,
  PREP_CHUNKING,
  UNVERIFIED_METRIC,
  VECTOR_ID_MAX_BYTES,
  VECTORIZE_GET_BATCH,
  VECTORIZE_METADATA_INDEXES,
  VECTORIZE_UPSERT_BATCH,
  contentManifestKey,
  contentVersionId,
  documentObjectKey,
  indexConfigReceiptKey,
  indexProfileId,
  preparationId,
  profileManifestKey,
  utf8Bytes,
  vectorIdFor,
  vectorizeIndexName,
} from "./ids";
// Utilidades de SQL seguro.
export { activeSelectionSql, assertProfileId, assertVersionId, sqlLiteral } from "./sql";
// Identidad de un perfil de índice.
export type { ProfileIdentity } from "./ids";
// Lógica pura del grafo CRAG: validación, orden y evidencia.
export {
  CRAG_BOUNDS,
  budgetOpen,
  chunkInScope,
  dedupeChunks,
  evidenceForAnswer,
  normalizeQuery,
  orderByRanking,
  remainingBudgetMs,
  retainEvidence,
  routeAfterAssessment,
  validateRankingAndAssessment,
  validateReformulation,
} from "./crag";
// Tipos de CRAG.
export type {
  CragAssessment,
  CragChunk,
  CragPorts,
  CragRoute,
  CragScope,
  CragSignal,
  EvidenceStatus,
  RankedHit,
} from "./crag";
// Recuperación del RAG básico y filtro de citas.
export {
  allowsAudience,
  citationsFor,
  gateScoredChunks,
  isScheduleQuestion,
  retrieveBasic,
  splitCitationBuffer,
  suppressUnknownCitations,
} from "./pipeline";
// Tipos de la recuperación.
export type { IndexedChunk, RetrievalOutcome } from "./pipeline";
// Presupuesto de llamadas y gasto por turno.
export {
  ALLOWANCE_MARGIN,
  OPERATION_BOUNDS,
  VERIFY_GENERATIVE_CALLS,
  createAllowanceLedger,
  planFits,
  verificationPlan,
  worstCaseUsd,
} from "./allowance";
// Tipos del presupuesto.
export type {
  AllowanceKind,
  AllowanceLedger,
  AllowancePrices,
  AllowanceReservation,
  AllowanceSnapshot,
  VerificationStep,
} from "./allowance";
// Caché e identidad de los embeddings semánticos.
export {
  SEMANTIC_EMBEDDING_MODEL,
  cacheFromVectors,
  chunkTextHash,
  semanticIdentity,
  semanticManifest,
  validateEmbeddingCache,
  vectorsFromCache,
} from "./embedding-cache";
// Tipos de la caché.
export type { EmbeddingCache, EmbeddingCacheItem } from "./embedding-cache";
// Embedding emulado para pruebas locales.
export {
  LOCAL_EMULATED_DIMENSIONS,
  LOCAL_EMULATED_EMBEDDING_MODEL,
  LOCAL_EMULATED_MIN_SCORE,
  localEmulatedEmbed,
} from "./local-emulated-embed";
// Procedencia de una ejecución.
export { classifyRuntime, usableForRemoteIndex } from "./provenance";
// Tipos de procedencia.
export type { AdapterRecord, RuntimeProvenance } from "./provenance";
// Preparación del corpus y su cobertura.
export { coverageFrom, formatCoverage, prepareCorpus } from "./prepare";
// Tipos de la preparación.
export type { CoverageReport, PreparedCorpus, PreparedDocument, SourceFile } from "./prepare";
// Puertos (interfaces) que implementan los adaptadores de Cloudflare.
export type {
  CancelSignal,
  ChunkCatalogPort,
  ChunkRecord,
  CorpusCatalogPort,
  DocumentStorePort,
  EmbeddingPort,
  EvaluationPort,
  GenerationPort,
  GenerationRequest,
  GenerationResult,
  MeasuredCost,
  MeasuredUsage,
  ModelMessage,
  RetrievalHit,
  RetrievalPort,
  RetrievalQuery,
  StoredDocument,
} from "./ports";
// Tipos básicos del corpus y de CRAG.
export type {
  CorpusVersion,
  CragState,
  DocumentAudience,
  RetrievedChunk,
  SourceDocument,
  TextChunk,
} from "./types";

// Atajo exacto para la pregunta del horario semanal.
export { isWeeklyScheduleQuestion, calendarOverviewId, calendarOverviewOutcome } from "./calendar";
