// GUÍA DE LECTURA · apps/api/src/local-schema.ts
// Esquema SQL de las tablas que usa la verificación local con workerd: versiones del corpus,
// documentos, fragmentos, perfiles de índice, diario de ingesta, mapa de vectores y un almacén
// vectorial emulado. Las migraciones reales están en apps/api/migrations.
// Sentencias en orden; las ALTER TABLE reproducen la evolución de las migraciones.
// Por qué una copia en TypeScript: el Worker puente de la verificación local crea estas tablas
// en un D1 local vacío sin depender de que Wrangler aplique migraciones. El texto de cada
// sentencia es idéntico al de apps/api/migrations (sin sus comentarios «--»):
// scripts/local-schema.test.ts lo comprueba. Las columnas están explicadas en esas migraciones.
export const LOCAL_SCHEMA = [
  // 0001 · Una fila por versión preparada del corpus (id = hash del contenido).
  `CREATE TABLE corpus_versions (
  id TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  remote_revision TEXT,
  status TEXT NOT NULL
)`,
  // 0001 · Documentos fuente de cada versión: sesión del temario o calendario, con su audiencia.
  `CREATE TABLE documents (
  version_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (version_id, document_id)
)`,
  // 0001 · Texto literal de cada fragmento citable; Vectorize solo guarda vectores.
  `CREATE TABLE chunks (
  version_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (version_id, chunk_id)
)`,
  // 0002 · Perfil de índice: corpus + modelo + dimensión + métrica. Solo uno está activo.
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
  // 0002 · Diario idempotente de la ingesta: qué se escribió en R2, D1 y Vectorize.
  `CREATE TABLE ingest_items (
  corpus_version TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  store TEXT NOT NULL,
  item_key TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY (corpus_version, profile_id, store, item_key)
)`,
  // 0002 · Relación entre el id del vector en Vectorize y el fragmento de D1.
  `CREATE TABLE vector_map (
  profile_id TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, vector_id)
)`,
  // 0003 · Resultado del elemento: succeeded, pending (aún no visible) o failed.
  "ALTER TABLE ingest_items ADD COLUMN outcome TEXT",
  // 0003 · Mutación de Vectorize que escribió el lote, para comprobar su visibilidad.
  "ALTER TABLE ingest_items ADD COLUMN mutation_id TEXT",
  // Solo local · Almacén vectorial emulado: Wrangler no ofrece Vectorize local, así que el
  // puente guarda aquí cada vector (valores y metadatos en JSON) y local-vectorize.ts calcula
  // el coseno. Nunca existe en el D1 remoto del curso.
  `CREATE TABLE local_vector_store (
  id TEXT PRIMARY KEY,
  values_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL
)`,
  // «as const» fija la lista como tupla de solo lectura: nadie puede añadir ni cambiar sentencias.
] as const;

// Devuelve las sentencias del esquema local.
export function schemaStatements(): readonly string[] {
  // Lista de solo lectura.
  return LOCAL_SCHEMA;
}
