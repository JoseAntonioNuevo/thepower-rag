export { CRAG_LIMITS, planReformulation, planRetrieval } from "./limits";
export type { Plan } from "./limits";
export { chunkId, chunkMarkdown } from "./chunk";
export type { ChunkOptions, PreparedChunk } from "./chunk";
export {
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  cosine,
  fixtureEmbed,
} from "./fixture-embed";
export { fnv1a64 } from "./hash";
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
export { activeSelectionSql, assertProfileId, assertVersionId, sqlLiteral } from "./sql";
export type { ProfileIdentity } from "./ids";
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
export {
  allowsAudience,
  citationsFor,
  gateScoredChunks,
  isScheduleQuestion,
  retrieveBasic,
  splitCitationBuffer,
  suppressUnknownCitations,
} from "./pipeline";
export type { IndexedChunk, RetrievalOutcome } from "./pipeline";
export {
  ALLOWANCE_MARGIN,
  OPERATION_BOUNDS,
  VERIFY_GENERATIVE_CALLS,
  createAllowanceLedger,
  planFits,
  verificationPlan,
  worstCaseUsd,
} from "./allowance";
export type {
  AllowanceKind,
  AllowanceLedger,
  AllowancePrices,
  AllowanceReservation,
  AllowanceSnapshot,
  VerificationStep,
} from "./allowance";
export {
  SEMANTIC_EMBEDDING_MODEL,
  cacheFromVectors,
  chunkTextHash,
  semanticIdentity,
  semanticManifest,
  validateEmbeddingCache,
  vectorsFromCache,
} from "./embedding-cache";
export type { EmbeddingCache, EmbeddingCacheItem } from "./embedding-cache";
export {
  LOCAL_EMULATED_DIMENSIONS,
  LOCAL_EMULATED_EMBEDDING_MODEL,
  LOCAL_EMULATED_MIN_SCORE,
  localEmulatedEmbed,
} from "./local-emulated-embed";
export { classifyRuntime, usableForRemoteIndex } from "./provenance";
export type { AdapterRecord, RuntimeProvenance } from "./provenance";
export { coverageFrom, formatCoverage, prepareCorpus } from "./prepare";
export type { CoverageReport, PreparedCorpus, PreparedDocument, SourceFile } from "./prepare";
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
export type {
  CorpusVersion,
  CragState,
  DocumentAudience,
  RetrievedChunk,
  SourceDocument,
  TextChunk,
} from "./types";

export { isWeeklyScheduleQuestion, calendarOverviewId, calendarOverviewOutcome } from "./calendar";
