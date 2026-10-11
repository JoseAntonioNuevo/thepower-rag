-- Medios de la fase 3. Los bytes viven en R2. Aquí solo hay metadatos.

CREATE TABLE IF NOT EXISTS research_media_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  bit_depth INTEGER,
  status TEXT NOT NULL,
  extracted_text TEXT,
  detail TEXT,
  job_id TEXT,
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS research_media_idem
  ON research_media_assets(owner_id, conversation_id, idempotency_key);

CREATE TABLE IF NOT EXISTS research_job_inputs (
  job_id TEXT PRIMARY KEY,
  voice INTEGER NOT NULL,
  image_asset_id TEXT,
  audio_asset_id TEXT,
  image_hash TEXT,
  audio_hash TEXT,
  audio_duration_ms INTEGER
);
