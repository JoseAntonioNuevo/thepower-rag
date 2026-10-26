-- GUÍA DE LECTURA · material/aula/consultas-d1-tableplus.sql
-- Ejecutar en la conexión de TablePlus «thePower · D1 producción · Solo lectura», que apunta a la base
-- thepower-ai-course-rag-d1 con un token D1 Read. Ninguna consulta escribe y el token tampoco podría.
-- Selecciona un bloque y ejecútalo. Cada consulta lee D1 en ese momento: lo que guarde la web aparece al
-- volver a ejecutarla. Los vectores viven en Vectorize, no en D1; aquí se ve el texto y su mapa de ids.
-- Zocomar es la versión cb7dabfb11854 (perfil peb8d9e84d3ba); el curso, c3a59a406888b (p76509a5f9743).

-- 00 · Qué guarda D1 del RAG: filas por tabla (D1 no admite un UNION de siete partes)
SELECT (SELECT COUNT(*) FROM corpus_versions) AS corpus_versions,
       (SELECT COUNT(*) FROM documents) AS documents,
       (SELECT COUNT(*) FROM chunks) AS chunks,
       (SELECT COUNT(*) FROM index_profiles) AS index_profiles,
       (SELECT COUNT(*) FROM vector_map) AS vector_map,
       (SELECT COUNT(*) FROM ingest_items) AS ingest_items,
       (SELECT COUNT(*) FROM public_budget) AS public_budget;

-- 01 · Versiones del corpus: el curso y la tienda, con su modelo de embeddings y dimensión
SELECT id AS version, embedding_model, dimensions, status
FROM corpus_versions
ORDER BY id;

-- 02 · Perfiles de índice: modelo, dimensión, métrica, troceado y vectores visibles en Vectorize
SELECT id AS perfil, corpus_version, embedding_model, dimensions, metric,
       chunk_max_chars, chunk_overlap, status, expected_vectors, visible_vectors, active
FROM index_profiles
ORDER BY corpus_version;

-- 03 · Las 12 políticas de Zocomar
SELECT document_id, title, audience, source_hash
FROM documents
WHERE version_id = 'cb7dabfb11854'
ORDER BY document_id;

-- 04 · Fragmentos por política: cuántos y de qué tamaño (máximo 900 caracteres)
SELECT document_id, COUNT(*) AS fragmentos,
       MIN(length(text)) AS min_caracteres, MAX(length(text)) AS max_caracteres
FROM chunks
WHERE version_id = 'cb7dabfb11854'
GROUP BY document_id
ORDER BY document_id;

-- 05 · Los fragmentos de una política, en orden: cambia el document_id para enseñar otra
SELECT chunk_id, ordinal, section, length(text) AS caracteres, text
FROM chunks
WHERE version_id = 'cb7dabfb11854' AND document_id = '02-devoluciones'
ORDER BY ordinal;

-- 06 · El id que cita la respuesta: [cite:...] es este chunk_id (reembolso de una devolución con Bizum)
SELECT chunk_id, document_id, section, text
FROM chunks
WHERE chunk_id IN ('cb7dabfb11854:02-devoluciones:04', 'cb7dabfb11854:06-pagos-y-reembolsos:02');

-- 07 · Buscar texto literal: por qué una palabra no basta (compárese con la búsqueda semántica)
SELECT chunk_id, section, text
FROM chunks
WHERE version_id = 'cb7dabfb11854' AND text LIKE '%Bizum%'
ORDER BY chunk_id;

-- 08 · Política vigente frente a la sustituida: el mismo tema con datos distintos
SELECT document_id, section, text
FROM chunks
WHERE version_id = 'cb7dabfb11854'
  AND document_id IN ('04-envios-vigente', '05-envios-2025-sustituida')
  AND text LIKE '%gratuit%'
ORDER BY document_id, ordinal;

-- 09 · Fragmento → vector: el id que se guardó en Vectorize para cada fragmento de Zocomar.
-- El vector de 1024 números no está en D1; Vectorize lo guarda con este mismo id.
SELECT profile_id, vector_id, chunk_id
FROM vector_map
WHERE profile_id = 'peb8d9e84d3ba'
ORDER BY chunk_id;

-- 10 · Diario de ingesta: qué se escribió en R2, D1 y Vectorize y con qué resultado
SELECT corpus_version, profile_id, store, outcome, COUNT(*) AS operaciones
FROM ingest_items
GROUP BY corpus_version, profile_id, store, outcome
ORDER BY corpus_version, store;

-- 11 · Presupuesto público del chat: reservas acumuladas del peor caso (no es gasto real)
SELECT id, reserved_usd, turns
FROM public_budget;
