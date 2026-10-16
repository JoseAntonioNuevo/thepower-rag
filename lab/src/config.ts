// GUÍA DE LECTURA · lab/src/config.ts
// Configuración del laboratorio reproducible de S10 y S11 con el stack del ejercicio publicado:
// PostgreSQL + pgvector, vector(768), índice HNSW, modelos por variables y umbrales calibrados.

// Dimensión fija exigida por el enunciado de S10 y S11 para la columna vector(768).
export const LAB_EMBEDDING_DIMENSIONS = 768 as const;

// Parámetros del índice HNSW sobre PostgreSQL + pgvector con distancia coseno (<=>).
export const LAB_HNSW_INDEX = {
  // Nombre del índice en PostgreSQL.
  indexName: "lab_chunks_embedding_hnsw_idx",
  // Operador de pgvector para distancia coseno.
  operatorClass: "vector_cosine_ops",
  // Número máximo de conexiones bidireccionales por nodo en el grafo HNSW.
  m: 16,
  // Tamaño de la lista dinámica de candidatos durante la construcción del índice.
  efConstruction: 64,
} as const;

// Parámetros de fragmentación del corpus de laboratorio (mismo tamaño 900 y solapamiento 80 que el curso).
export const LAB_CHUNKING = {
  // Tamaño máximo de cada fragmento en caracteres.
  maxChars: 900,
  // Solapamiento entre fragmentos consecutivos de una misma sección.
  overlapChars: 80,
} as const;

// Umbrales calibrados con el conjunto de validación (separado de las 20 preguntas de test) para S10:
// en validación el negativo más alto dio similitud 0,148 (distancia 0,852) y el positivo más bajo 0,250
// (distancia 0,750), por lo que el punto de corte con margen queda en similitud 0,25 (distancia 0,75).
export const LAB_BASIC_THRESHOLDS = {
  // Vecinos recuperados de pgvector en la búsqueda única de RAG básico.
  topK: 4,
  // Similitud coseno mínima (1 - distancia_coseno) para aceptar un fragmento antes de generar.
  minSimilarity: 0.25,
  // Distancia coseno máxima equivalente en pgvector (<=>, donde menor significa más próximo).
  maxCosineDistance: 0.75,
} as const;

// Escala de puntuaciones [0, 1], umbrales de decisión y límites de iteración para S11 (CRAG).
export const LAB_CRAG_CONFIG = {
  // Candidatos recuperados por búsqueda en CRAG (enunciado S11: hasta diez candidatos).
  maxCandidates: 10,
  // Fragmentos útiles máximos conservados para el contexto final.
  maxRetained: 6,
  // Búsquedas máximas por pregunta (la inicial más dos reformulaciones = tres en total).
  maxRetrievals: 3,
  // Reformulaciones máximas después de la búsqueda inicial.
  maxReformulations: 2,
  // Escala mínima del reordenador.
  minScore: 0,
  // Escala máxima del reordenador.
  maxScore: 1,
  // Relevancia individual mínima en [0, 1] para que un fragmento se considere útil.
  minChunkRelevance: 0.5,
  // Cobertura mínima de la pregunta completa para declarar evidencia parcial/ambigua.
  partialCoverageMin: 0.4,
  // Cobertura mínima de la pregunta completa (sin lagunas) para declarar evidencia suficiente.
  sufficientCoverageMin: 0.75,
} as const;

// Configuración resuelta del laboratorio a partir de variables de entorno o valores de referencia.
export interface LabConfig {
  // Modelo generativo (variable GEN_MODEL_ID, referencia Gemini 3.8 Flash).
  genModelId: string;
  // Modelo de embeddings de 768 dimensiones (variable EMBEDDING_MODEL_ID, referencia Gemini Embedding 2).
  embeddingModelId: string;
  // Modelo de reordenamiento opcional (variable RERANKER_MODEL_ID, referencia Qwen3-Reranker-0.6B).
  rerankerModelId: string;
  // Modelo evaluador de suficiencia y reformulación (variable EVALUATOR_MODEL_ID).
  evaluatorModelId: string;
  // Cadena de conexión a PostgreSQL con pgvector (variable DATABASE_URL).
  databaseUrl: string | null;
  // Dimensión vectorial fija (768).
  dimensions: 768;
  // Umbral de similitud coseno para el RAG básico de S10.
  minSimilarity: number;
  // Distancia coseno máxima equivalente (1 - minSimilarity).
  maxCosineDistance: number;
}

// Lee la configuración del laboratorio desde un diccionario de variables de entorno.
export function resolveLabConfig(env: Record<string, string | undefined> = process.env): LabConfig {
  // Modelo generativo configurado o referencia del documento enviado.
  const genModelId = env.GEN_MODEL_ID?.trim() || "gemini-3.8-flash";
  // Modelo de embeddings configurado o referencia del documento enviado (768 dimensiones).
  const embeddingModelId = env.EMBEDDING_MODEL_ID?.trim() || "gemini-embedding-2";
  // Modelo de reordenamiento opcional citado en el enunciado de S11.
  const rerankerModelId = env.RERANKER_MODEL_ID?.trim() || "Qwen/Qwen3-Reranker-0.6B";
  // Modelo evaluador para CRAG.
  const evaluatorModelId = env.EVALUATOR_MODEL_ID?.trim() || genModelId;
  // URL de PostgreSQL si se ha proporcionado.
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  // Similitud mínima configurable o calibrada por defecto.
  const parsedSim = Number(env.RAG_MIN_SIMILARITY);
  // Valida que el umbral esté dentro de (0, 1).
  const minSimilarity =
    Number.isFinite(parsedSim) && parsedSim > 0 && parsedSim < 1
      ? parsedSim
      : LAB_BASIC_THRESHOLDS.minSimilarity;
  // Distancia coseno máxima complementaria.
  const maxCosineDistance = Number((1 - minSimilarity).toFixed(4));
  // Devuelve la configuración inmutable.
  return {
    genModelId,
    embeddingModelId,
    rerankerModelId,
    evaluatorModelId,
    databaseUrl,
    dimensions: LAB_EMBEDDING_DIMENSIONS,
    minSimilarity,
    maxCosineDistance,
  };
}
