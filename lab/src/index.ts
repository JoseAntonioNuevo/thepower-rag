// GUÍA DE LECTURA · lab/src/index.ts
// Punto de entrada del laboratorio reproducible de S10 y S11 con PostgreSQL + pgvector,
// vector(768), índice HNSW, RAG básico, grafo CRAG con nodos separados y evaluación 14+6.
// Configuración y umbrales calibrados.
export {
  LAB_BASIC_THRESHOLDS,
  LAB_CHUNKING,
  LAB_CRAG_CONFIG,
  LAB_EMBEDDING_DIMENSIONS,
  LAB_HNSW_INDEX,
  resolveLabConfig,
  type LabConfig,
} from "./config";
// Preparación, limpieza y troceado de los documentos ficticios.
export {
  cleanDocumentText,
  prepareLabCorpusFromDirectory,
  type LabDocument,
  type LabPreparedChunk,
  type LabPreparedCorpus,
} from "./corpus";
// Embeddings de 768 dimensiones y distancia/similitud coseno.
export {
  assertVector768,
  cosineDistance768,
  cosineSimilarity768,
  createDeterministic768EmbeddingProvider,
  embedLabText768,
  tokenizeSpanish,
  type LabEmbeddingProvider,
} from "./embeddings";
// Almacén PostgreSQL + pgvector (`vector(768)` + HNSW) y su doble en memoria.
export {
  InMemoryPgVectorStore,
  PgVectorDatabaseStore,
  formatPgVectorLiteral,
  parseLabSchemaStatements,
  type LabRebuildReceipt,
  type LabVectorHit,
  type LabVectorStore,
  type PostgresSqlExecutor,
} from "./pgvector-store";
// Reordenamiento en escala [0, 1], formato Qwen3-Reranker-0.6B, suficiencia y reformulación.
export {
  assessLabEvidence,
  decideLabSufficiency,
  formatQwen3RerankerPrompt,
  reformulateLabQuery,
  rerankLabCandidates,
  splitQuestionAspects,
  type LabRerankedCandidate,
  type LabSufficiencyAssessment,
} from "./reranker";
// Canalización de RAG básico de S10.
export {
  buildUntrustedDataBlock,
  runLabBasicRag,
  synthesizeGroundedLabAnswer,
  type LabBasicRagResult,
} from "./rag-basic";
// Grafo LangGraph de CRAG de S11 con nodos separados `retrieve -> rerank -> assess`.
export {
  runLabCrag,
  type LabCragIterationTrace,
  type LabCragResult,
  type LabDiscardedRecord,
} from "./crag-graph";
// Conjuntos de validación (6) y test (20: 14+6) y comparador entre RAG básico y CRAG.
export {
  LAB_DEMO_CASES,
  LAB_TEST_SET_20,
  LAB_VALIDATION_SET,
  runLabComparison20,
  type LabDemoCase,
  type LabEvaluatedQuestion,
  type LabEvaluationCase,
  type LabEvaluationReport,
  type LabStageSummary,
} from "./evaluation";
