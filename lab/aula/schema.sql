-- GUÍA DE LECTURA · lab/aula/schema.sql
-- Registro local de ejecuciones docentes, separado de las tablas del corpus y del presupuesto.
CREATE TABLE IF NOT EXISTS lab_aula_runs (
  -- UUID público del recorrido que aparece también en el navegador y en cada evento
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('rag','baseline','ingest')),
  mode TEXT NOT NULL CHECK (mode IN ('step','auto')),
  status TEXT NOT NULL CHECK (status IN ('running','waiting','complete','failed','cancelled','interrupted')),
  question TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  waiting_stage TEXT,
  current_stage TEXT,
  stages JSONB NOT NULL,
  result JSONB NOT NULL DEFAULT 'null'::jsonb,
  error TEXT
);
-- Clave compuesta: orden inequívoco por ejecución e índice para la relación con su padre
CREATE TABLE IF NOT EXISTS lab_aula_events (
  run_id UUID NOT NULL REFERENCES lab_aula_runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK (seq > 0),
  stage TEXT,
  type TEXT NOT NULL CHECK (type IN ('stage','sql','delta','usage','status')),
  phase TEXT NOT NULL CHECK (phase IN ('waiting','running','complete','error','info')),
  at TIMESTAMPTZ NOT NULL,
  duration_ms DOUBLE PRECISION,
  data JSONB NOT NULL,
  PRIMARY KEY (run_id, seq)
);
