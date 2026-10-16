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
  // Orden de los almacenes, selección del perfil activo y comprobación del catálogo.
  INGEST_ORDER,
  applyActiveSelection,
  catalogMatches,
  // Clasificación de la lectura de vuelta y manifiestos.
  classifyIndexReadback,
  contentManifestFrom,
  // Fase y diario de la ingesta.
  ingestionPhase,
  journalForProfile,
  journalItem,
  manifestFrom,
  // Ingesta completa y selección del perfil.
  runIngestion,
  selectActiveProfile,
  // Serialización de manifiestos y validación de vectores.
  serializeContentManifest,
  serializeManifest,
  validateVectors,
} from "./ingest";
// Tipos de la ingesta.
export type {
  // Catálogo leído de D1 y manifiestos.
  CatalogSnapshot,
  ContentManifest,
  CorpusManifest,
  // Índice, evidencia, diario y puertos de la ingesta.
  IndexDescription,
  IngestEvidence,
  IngestJournalItem,
  IngestPorts,
  // Fases, resultados, almacenes y vectores.
  IngestionPhase,
  JournalOutcome,
  StoreName,
  VectorWrite,
  VisibleVector,
} from "./ingest";
// Nombres, límites e identificadores de los recursos del curso.
export {
  // Nombres de los recursos de Cloudflare del curso.
  COURSE_D1_NAME,
  COURSE_R2_NAME,
  COURSE_VECTORIZE_PREFIX,
  // Límites de Vectorize: tamaño de nombres, metadatos e ids.
  INDEX_NAME_MAX_BYTES,
  METADATA_VALUE_MAX_BYTES,
  // Troceado y métrica sin verificar.
  PREP_CHUNKING,
  UNVERIFIED_METRIC,
  VECTOR_ID_MAX_BYTES,
  // Lotes de lectura y escritura e índices de metadatos obligatorios.
  VECTORIZE_GET_BATCH,
  VECTORIZE_METADATA_INDEXES,
  VECTORIZE_UPSERT_BATCH,
  // Claves de R2 e ids derivados del contenido.
  contentManifestKey,
  contentVersionId,
  documentObjectKey,
  indexConfigReceiptKey,
  // Perfil, preparación y manifiesto.
  indexProfileId,
  preparationId,
  profileManifestKey,
  // Bytes UTF-8, id de vector y nombre del índice.
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
  // Topes del grafo, escala de puntuaciones, presupuesto, alcance y duplicados.
  CRAG_BOUNDS,
  CRAG_SCORE_THRESHOLDS,
  assessCoverageByThresholds,
  budgetOpen,
  chunkInScope,
  dedupeChunks,
  // Evidencia para responder, consultas normalizadas y orden validado.
  evidenceForAnswer,
  normalizeQuery,
  orderByRanking,
  // Plazo restante, retención y ruta tras evaluar.
  remainingBudgetMs,
  retainEvidence,
  routeAfterAssessment,
  // Validadores de las salidas del modelo (reordenamiento, suficiencia y reformulación).
  validateAssessment,
  validateRanking,
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
  // Señal de cancelación y puertos de catálogo, fragmentos y documentos.
  CancelSignal,
  ChunkCatalogPort,
  ChunkRecord,
  CorpusCatalogPort,
  DocumentStorePort,
  // Puertos de embeddings, evaluación y generación con sus tipos.
  EmbeddingPort,
  EvaluationPort,
  GenerationPort,
  GenerationRequest,
  GenerationResult,
  // Consumo y coste medidos y mensajes.
  MeasuredCost,
  MeasuredUsage,
  ModelMessage,
  // Búsqueda y documentos guardados.
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
