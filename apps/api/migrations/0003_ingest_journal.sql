-- Migración 0003 del D1 del curso: diario de ingesta con resultado y mutación.
-- Por qué: un booleano `ok` no distingue «falló» de «Vectorize lo aceptó pero aún no se ve».
-- Esa visibilidad tardía es normal en Vectorize y no debe tratarse como fallo ni reenviarse.

-- Resultado del elemento: `succeeded`, `pending` (aceptado, aún no visible) o `failed`.
ALTER TABLE ingest_items ADD COLUMN outcome TEXT;
-- Id de la mutación de Vectorize que escribió el lote, para comprobar después su visibilidad.
ALTER TABLE ingest_items ADD COLUMN mutation_id TEXT;
