-- Migración 0002 del D1 del curso: perfiles de índice, diario de ingesta y mapa de vectores.
-- Qué hace: separa «qué texto hay» (versión del corpus) de «cómo se indexó» (perfil). Un mismo
-- corpus puede tener varios perfiles: el léxico de prueba de 128 dimensiones y el BGE-M3 real.
-- Por qué: si cambia el modelo de embeddings, la dimensión o la métrica, los vectores viejos ya
-- no sirven. Cada combinación tiene su propio id de perfil y nunca se mezclan.

-- Un perfil de índice: corpus + modelo + dimensión + métrica + troceado.
CREATE TABLE index_profiles (
  -- Id del perfil, derivado de sus parámetros (por ejemplo `p76509a5f9743`).
  id TEXT PRIMARY KEY,
  -- Versión del corpus indexada.
  corpus_version TEXT NOT NULL,
  -- Modelo de embeddings usado.
  embedding_model TEXT NOT NULL,
  -- Dimensión de los vectores. Tiene que coincidir con la del índice Vectorize.
  dimensions INTEGER NOT NULL,
  -- Métrica de similitud. El RAG real exige `cosine` leída de `wrangler vectorize get`.
  metric TEXT NOT NULL,
  -- Tamaño máximo de cada fragmento en caracteres (900).
  chunk_max_chars INTEGER NOT NULL,
  -- Solapamiento entre fragmentos consecutivos (80).
  chunk_overlap INTEGER NOT NULL,
  -- Revisión del modelo en el proveedor, si se conoce.
  provider_revision TEXT,
  -- Familia: `fixture` (hash léxico de la demo) o `workers-ai` (BGE-M3 real).
  family TEXT NOT NULL,
  -- Fase: planned, partial, pending-visibility, ready o failed. Solo `ready` se consulta.
  status TEXT NOT NULL,
  -- Cuántos vectores deberían existir (uno por fragmento).
  expected_vectors INTEGER NOT NULL,
  -- Cuántos se han leído de vuelta en Vectorize. NULL hasta la primera lectura.
  visible_vectors INTEGER,
  -- Id de la última mutación aceptada por Vectorize (la inserción es asíncrona).
  mutation_id TEXT,
  -- Último error de la ingesta, para diagnosticar sin volver a ejecutarla.
  last_error TEXT,
  -- 1 si es el perfil que consulta la aplicación. Se elige con `activate -- select-active`.
  active INTEGER NOT NULL DEFAULT 0
);

-- Diario idempotente de la ingesta: una fila por cada objeto escrito en un almacén.
-- Permite reanudar una ingesta cortada sin volver a embeber ni insertar lo que ya está.
CREATE TABLE ingest_items (
  -- Versión del corpus.
  corpus_version TEXT NOT NULL,
  -- Perfil de índice.
  profile_id TEXT NOT NULL,
  -- Almacén escrito: `r2`, `d1` o `vectorize`.
  store TEXT NOT NULL,
  -- Clave del elemento dentro de ese almacén (objeto, documento o lote de vectores).
  item_key TEXT NOT NULL,
  -- 1 si quedó escrito y leído de vuelta.
  ok INTEGER NOT NULL,
  -- Motivo del fallo, si lo hubo.
  error TEXT,
  -- Una fila por elemento: repetir la ingesta actualiza, no duplica.
  PRIMARY KEY (corpus_version, profile_id, store, item_key)
);

-- Relación entre el id de cada vector en Vectorize y el fragmento de D1 que representa.
CREATE TABLE vector_map (
  -- Perfil al que pertenece el vector.
  profile_id TEXT NOT NULL,
  -- Id del vector en Vectorize.
  vector_id TEXT NOT NULL,
  -- Fragmento de `chunks` cuyo texto se recupera al encontrar este vector.
  chunk_id TEXT NOT NULL,
  -- Un vector por perfil.
  PRIMARY KEY (profile_id, vector_id)
);
