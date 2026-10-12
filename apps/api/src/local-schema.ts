// GUÍA DE LECTURA · apps/api/src/local-schema.ts
// Esquema SQL de las tablas que usa la verificación local con workerd: versiones del corpus,
// documentos, fragmentos, perfiles de índice, diario de ingesta, mapa de vectores y un almacén
// vectorial emulado. Las migraciones reales están en apps/api/migrations.
// Sentencias en orden; las ALTER TABLE reproducen la evolución de las migraciones.
export const LOCAL_SCHEMA = [
  `CREATE TABLE corpus_versions (
  id TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  remote_revision TEXT,
  status TEXT NOT NULL
)`,
  `CREATE TABLE documents (
  version_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (version_id, document_id)
)`,
  `CREATE TABLE chunks (
  version_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (version_id, chunk_id)
)`,
  `CREATE TABLE index_profiles (
  id TEXT PRIMARY KEY,
  corpus_version TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  metric TEXT NOT NULL,
  chunk_max_chars INTEGER NOT NULL,
  chunk_overlap INTEGER NOT NULL,
  provider_revision TEXT,
  family TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_vectors INTEGER NOT NULL,
  visible_vectors INTEGER,
  mutation_id TEXT,
  last_error TEXT,
  active INTEGER NOT NULL DEFAULT 0
)`,
  `CREATE TABLE ingest_items (
  corpus_version TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  store TEXT NOT NULL,
  item_key TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY (corpus_version, profile_id, store, item_key)
)`,
  `CREATE TABLE vector_map (
  profile_id TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, vector_id)
)`,
  "ALTER TABLE ingest_items ADD COLUMN outcome TEXT",
  "ALTER TABLE ingest_items ADD COLUMN mutation_id TEXT",
  `CREATE TABLE local_vector_store (
  id TEXT PRIMARY KEY,
  values_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL
)`,
] as const;

// Devuelve las sentencias del esquema local.
export function schemaStatements(): readonly string[] {
  // Lista de solo lectura.
  return LOCAL_SCHEMA;
}
