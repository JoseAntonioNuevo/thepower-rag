-- GUÍA DE LECTURA · lab/schema.sql
-- Esquema de PostgreSQL con pgvector para el laboratorio reproducible de S10 y S11.
-- Define vectores de 768 dimensiones e índice HNSW con distancia coseno.

-- Activa la extensión pgvector en la base de datos del laboratorio
CREATE EXTENSION IF NOT EXISTS vector;

-- Versiones preparadas del corpus sintético con modelo y dimensión fijados a 768
CREATE TABLE IF NOT EXISTS lab_corpus_versions (
  corpus_version TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions = 768),
  chunk_size INTEGER NOT NULL,
  chunk_overlap INTEGER NOT NULL,
  document_count INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Documentos en bruto leídos y limpiados durante la reconstrucción del índice
CREATE TABLE IF NOT EXISTS lab_documents (
  document_id TEXT NOT NULL,
  corpus_version TEXT NOT NULL REFERENCES lab_corpus_versions(corpus_version) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  PRIMARY KEY (corpus_version, document_id)
);

-- Fragmentos con identificador estable y vector de 768 dimensiones
CREATE TABLE IF NOT EXISTS lab_chunks (
  chunk_id TEXT PRIMARY KEY,
  corpus_version TEXT NOT NULL REFERENCES lab_corpus_versions(corpus_version) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_dimensions INTEGER NOT NULL CHECK (embedding_dimensions = 768),
  embedding vector(768) NOT NULL
);

-- Índice HNSW sobre la columna vector(768) usando distancia coseno (<=>)
CREATE INDEX IF NOT EXISTS lab_chunks_embedding_hnsw_idx
  ON lab_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Índice auxiliar por versión de corpus y modelo para filtrar antes de ordenar
CREATE INDEX IF NOT EXISTS lab_chunks_version_model_idx
  ON lab_chunks (corpus_version, embedding_model);
