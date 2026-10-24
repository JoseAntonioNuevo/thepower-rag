-- GUÍA DE LECTURA · material/aula/consultas-tableplus.sql
-- Ejecutar en la conexión local aether_rag (127.0.0.1:54329). No se modifica ninguna tabla.
-- Selecciona un bloque y ejecútalo. El bloque 04b elige el run_id para los bloques 05 a 10.

-- 00 · Verifica la conexión y su modo de lectura antes de empezar
SELECT current_database() AS base, current_user AS rol,
       current_setting('default_transaction_read_only') AS solo_lectura;

-- 01 · Documentos: fuente y huella de contenido
SELECT document_id, title, source_path, content_hash
FROM lab_documents
ORDER BY document_id;

-- 02 · Fragmentos y dimensión real de los embeddings almacenados
SELECT chunk_id, document_id, ordinal, section,
       vector_dims(embedding) AS dimensiones,
       content, embedding
FROM lab_chunks
ORDER BY document_id, ordinal;

-- 03 · Modelo, corpus, tamaño de fragmento y solapamiento del índice
SELECT corpus_version, embedding_model, embedding_dimensions,
       chunk_size, chunk_overlap, document_count, chunk_count, created_at
FROM lab_corpus_versions
ORDER BY created_at DESC;

-- 04 · Ejecución actual: su identificador se ve en el lateral de la consola
SELECT id, kind, mode, status, question, current_stage, waiting_stage,
       created_at, updated_at, error
FROM lab_aula_runs
ORDER BY created_at DESC
LIMIT 10;

-- 04b · Pega aquí el UUID de la consola y ejecuta este bloque una vez por recorrido
-- El UUID inicial pertenece al ensayo real de cifrado del 23 de octubre, no a una simulación
-- set_config solo conserva la selección en esta sesión de TablePlus, incluso en modo de lectura
SELECT set_config('aula.run_id', 'aceee32e-9529-431c-a6ae-840008a1b69b', false) AS ejecucion_elegida;

-- 05 · Eventos de la ejecución elegida, en el orden confirmado por PostgreSQL
SELECT seq, stage, type, phase, at, ROUND(duration_ms::numeric, 2) AS duracion_ms, data
FROM lab_aula_events
WHERE run_id = current_setting('aula.run_id')::uuid
ORDER BY seq;

-- 06 · Vector real de la pregunta, tal como lo devolvió el proveedor
SELECT run_id, data->'output'->'vector' AS vector_pregunta,
       data->'output'->>'dimensions' AS dimensiones
FROM lab_aula_events
WHERE run_id = current_setting('aula.run_id')::uuid
  AND stage = 'question-embedding' AND type = 'stage' AND phase = 'complete'
ORDER BY at DESC LIMIT 1;

-- 07 · SQL y parámetros reales de la búsqueda (el vector se enlaza como parámetro)
SELECT data->>'statement' AS sql, data->'parameters' AS parametros, data->'rows' AS filas
FROM lab_aula_events
WHERE run_id = current_setting('aula.run_id')::uuid
  AND stage = 'search' AND type = 'sql' AND phase = 'complete'
ORDER BY at DESC LIMIT 1;

-- 08 · Contexto exacto construido antes de llamar al generador
SELECT data->'output'->>'system' AS instrucciones,
       data->'output'->>'prompt' AS pregunta_y_contexto
FROM lab_aula_events
WHERE run_id = current_setting('aula.run_id')::uuid
  AND stage = 'prompt' AND type = 'stage' AND phase = 'complete'
ORDER BY at DESC LIMIT 1;

-- 09 · Citas admitidas y sus fragmentos de evidencia
SELECT data->'output'->'citations' AS citas,
       data->'output'->'sources' AS fuentes,
       data->'output'->>'answer' AS respuesta
FROM lab_aula_events
WHERE run_id = current_setting('aula.run_id')::uuid
  AND stage = 'citations' AND type = 'stage' AND phase = 'complete'
ORDER BY at DESC LIMIT 1;

-- 10 · Los deltas son bloques del proveedor, no tokens ni una animación simulada
SELECT seq, at, data->>'text' AS fragmento_recibido
FROM lab_aula_events
WHERE run_id = current_setting('aula.run_id')::uuid
  AND type = 'delta'
ORDER BY seq;

-- 11 · Definición del índice HNSW y extensión instalada
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'lab_chunks';
SELECT extversion FROM pg_extension WHERE extname = 'vector';
