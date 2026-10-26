-- GUÍA DE LECTURA · material/aula/consultas-d1-tableplus.sql
-- Ejecutar en la conexión de TablePlus «thePower · D1 producción · Solo lectura», que apunta a la base
-- thepower-ai-course-rag-d1 con un token D1 Read. Ninguna consulta escribe y el token tampoco podría.
-- Selecciona un bloque y ejecútalo. Cada consulta lee D1 en ese momento: lo que guarde la web aparece al
-- volver a ejecutarla. Los vectores viven en Vectorize, no en D1; aquí se ve el texto y su mapa de ids.
-- Todas las consultas se limitan a ThePower Shop: versión cc140d7876624, perfil p3d2b914bd60c. El corpus del
-- curso (c3a59a406888b) sigue en D1 porque lo lee la investigación de S12, pero no se enseña aquí.

-- 00 · Qué guarda D1 de la tienda: documentos, fragmentos, vectores e ingesta
SELECT (SELECT COUNT(*) FROM documents WHERE version_id = 'cc140d7876624') AS documents,
       (SELECT COUNT(*) FROM chunks WHERE version_id = 'cc140d7876624') AS chunks,
       (SELECT COUNT(*) FROM vector_map WHERE profile_id = 'p3d2b914bd60c') AS vector_map,
       (SELECT COUNT(*) FROM ingest_items WHERE corpus_version = 'cc140d7876624') AS ingest_items;

-- 01 · Versión del corpus de la tienda, con su modelo de embeddings y dimensión
SELECT id AS version, embedding_model, dimensions, status
FROM corpus_versions
WHERE id = 'cc140d7876624';

-- 02 · Perfil de índice de la tienda: modelo, dimensión, métrica, troceado y vectores visibles
SELECT id AS perfil, corpus_version, embedding_model, dimensions, metric,
       chunk_max_chars, chunk_overlap, status, expected_vectors, visible_vectors, active
FROM index_profiles
WHERE id = 'p3d2b914bd60c';

-- 03 · Las 12 políticas de ThePower Shop
SELECT document_id, title, audience, source_hash
FROM documents
WHERE version_id = 'cc140d7876624'
ORDER BY document_id;

-- 04 · Fragmentos por política: cuántos y de qué tamaño (máximo 900 caracteres)
SELECT document_id, COUNT(*) AS fragmentos,
       MIN(length(text)) AS min_caracteres, MAX(length(text)) AS max_caracteres
FROM chunks
WHERE version_id = 'cc140d7876624'
GROUP BY document_id
ORDER BY document_id;

-- 05 · Los fragmentos de una política, en orden: cambia el document_id para enseñar otra
SELECT chunk_id, ordinal, section, length(text) AS caracteres, text
FROM chunks
WHERE version_id = 'cc140d7876624' AND document_id = '02-devoluciones'
ORDER BY ordinal;

-- 06 · El id que cita la respuesta: [cite:...] es este chunk_id (reembolso de una devolución con Bizum)
SELECT chunk_id, document_id, section, text
FROM chunks
WHERE chunk_id IN ('cc140d7876624:02-devoluciones:04', 'cc140d7876624:06-pagos-y-reembolsos:02');

-- 07 · Buscar texto literal: por qué una palabra no basta (compárese con la búsqueda semántica)
SELECT chunk_id, section, text
FROM chunks
WHERE version_id = 'cc140d7876624' AND text LIKE '%Bizum%'
ORDER BY chunk_id;

-- 08 · Política vigente frente a la sustituida: el mismo tema con datos distintos
SELECT document_id, section, text
FROM chunks
WHERE version_id = 'cc140d7876624'
  AND document_id IN ('04-envios-vigente', '05-envios-2025-sustituida')
  AND text LIKE '%gratuit%'
ORDER BY document_id, ordinal;

-- 09 · Fragmento → vector: el id que se guardó en Vectorize para cada fragmento de ThePower Shop.
-- El vector de 1024 números no está en D1; Vectorize lo guarda con este mismo id.
SELECT profile_id, vector_id, chunk_id
FROM vector_map
WHERE profile_id = 'p3d2b914bd60c'
ORDER BY chunk_id;

-- 10 · Diario de ingesta de la tienda: qué se escribió en R2, D1 y Vectorize y con qué resultado
SELECT corpus_version, profile_id, store, outcome, COUNT(*) AS operaciones
FROM ingest_items
WHERE corpus_version = 'cc140d7876624'
GROUP BY corpus_version, profile_id, store, outcome
ORDER BY store;

-- 11 · Presupuesto público del chat: reservas acumuladas del peor caso (no es gasto real)
SELECT id, reserved_usd, turns
FROM public_budget;
