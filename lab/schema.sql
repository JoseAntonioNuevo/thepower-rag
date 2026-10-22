-- GUÍA DE LECTURA · lab/schema.sql
-- Esquema de PostgreSQL con pgvector para el laboratorio reproducible de S10 y S11.
-- Define vectores de 768 dimensiones e índice HNSW con distancia coseno.

-- Activa la extensión pgvector en la base de datos del laboratorio
CREATE EXTENSION IF NOT EXISTS vector;

-- Versiones preparadas del corpus sintético con modelo y dimensión fijados a 768
CREATE TABLE IF NOT EXISTS lab_corpus_versions (
  -- Huella de los documentos preparados que identifica esta reconstrucción
  corpus_version TEXT PRIMARY KEY,
  -- Modelo y ruta de inferencia comunes a los vectores guardados y a las consultas
  embedding_model TEXT NOT NULL,
  -- El esquema impide registrar una dimensión diferente de la columna vectorial
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions = 768),
  -- Tamaño máximo de fragmento utilizado al preparar el texto
  chunk_size INTEGER NOT NULL,
  -- Caracteres compartidos por fragmentos consecutivos para conservar contexto
  chunk_overlap INTEGER NOT NULL,
  -- Conteo previsto de documentos que se contrasta con el recibo de reconstrucción
  document_count INTEGER NOT NULL,
  -- Conteo previsto de vectores que se verifica leyendo las filas insertadas
  chunk_count INTEGER NOT NULL,
  -- Momento de registro generado por PostgreSQL
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documentos en bruto leídos y limpiados durante la reconstrucción del índice
CREATE TABLE IF NOT EXISTS lab_documents (
  -- Identificador estable del archivo fuente dentro de una versión
  document_id TEXT NOT NULL,
  -- Al borrar una versión se eliminan también sus documentos asociados
  corpus_version TEXT NOT NULL REFERENCES lab_corpus_versions(corpus_version) ON DELETE CASCADE,
  -- Título que aparecerá junto a las fuentes de las respuestas
  title TEXT NOT NULL,
  -- Ruta relativa que permite abrir el Markdown original en clase
  source_path TEXT NOT NULL,
  -- Huella del contenido limpio para poder detectar modificaciones del documento
  content_hash TEXT NOT NULL,
  -- Un mismo documento puede coexistir bajo distintas versiones del corpus
  PRIMARY KEY (corpus_version, document_id)
);

-- Fragmentos con identificador estable y vector de 768 dimensiones
CREATE TABLE IF NOT EXISTS lab_chunks (
  -- Identificador que se utiliza para recuperar y citar el fragmento
  chunk_id TEXT PRIMARY KEY,
  -- Versión a la que pertenece el vector y límite de aislamiento de la búsqueda
  corpus_version TEXT NOT NULL REFERENCES lab_corpus_versions(corpus_version) ON DELETE CASCADE,
  -- Identidad del documento del que se extrajo el texto
  document_id TEXT NOT NULL,
  -- Posición del fragmento dentro del documento para conservar su orden original
  ordinal INTEGER NOT NULL,
  -- Título del documento reproducido junto al vecino recuperado
  title TEXT NOT NULL,
  -- Sección Markdown para situar la afirmación en su contexto
  section TEXT NOT NULL,
  -- Texto que se entrega al generador cuando el fragmento supera el umbral
  content TEXT NOT NULL,
  -- Impide mezclar familias de embeddings al filtrar la consulta
  embedding_model TEXT NOT NULL,
  -- Metadato comprobado además de la restricción del propio tipo vectorial
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions = 768),
  -- Representación numérica almacenada que utiliza el operador de distancia coseno
  embedding vector(768) NOT NULL
);

-- Índice HNSW sobre la columna vector(768) usando distancia coseno (<=>)
CREATE INDEX IF NOT EXISTS lab_chunks_embedding_hnsw_idx
  -- Construye el índice sobre los fragmentos, que son las unidades de recuperación
  ON lab_chunks
  -- La clase de operadores debe coincidir con <=> usado por queryNearest
  USING hnsw (embedding vector_cosine_ops)
  -- Conectividad del grafo y esfuerzo de construcción, distintos del top-k de cada consulta
  WITH (m = 16, ef_construction = 64);

-- Índice auxiliar por versión de corpus y modelo para filtrar antes de ordenar
CREATE INDEX IF NOT EXISTS lab_chunks_version_model_idx
  ON lab_chunks (corpus_version, embedding_model);
