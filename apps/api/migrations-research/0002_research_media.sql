-- Medios de la fase 3. Los bytes viven en R2. Aquí solo hay metadatos.
-- Qué guarda: cada imagen o audio subido por el usuario y cada voz generada, y qué medios usa
-- cada trabajo. Por qué: los bytes pesan y van a un R2 privado distinto del corpus. D1 solo
-- guarda lo necesario para validar, enlazar con su dueño y limpiar los huérfanos.

-- Un archivo de la investigación: imagen, audio o voz generada.
CREATE TABLE IF NOT EXISTS research_media_assets (
  -- Id del archivo.
  id TEXT PRIMARY KEY,
  -- Propietario y conversación: nadie más puede leerlo.
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  -- `image`, `audio` o `speech`.
  role TEXT NOT NULL,
  -- Clave del objeto en R2. Única: dos filas no apuntan al mismo objeto.
  object_key TEXT NOT NULL UNIQUE,
  -- SHA-256 del contenido, calculado en el servidor.
  content_hash TEXT NOT NULL,
  -- Tipo real detectado por los bytes (no el declarado por el navegador).
  mime TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  -- Imagen: ancho y alto en píxeles.
  width INTEGER,
  height INTEGER,
  -- Audio: duración, frecuencia de muestreo, canales y bits por muestra.
  duration_ms INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  bit_depth INTEGER,
  -- Estado del archivo (subido, leído, fallido…).
  status TEXT NOT NULL,
  -- Texto leído en la imagen o transcrito del audio.
  extracted_text TEXT,
  -- Detalle o motivo del error, si lo hubo.
  detail TEXT,
  -- Trabajo que lo usa, cuando ya se asoció a uno.
  job_id TEXT,
  -- Clave de idempotencia de la subida.
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Repetir la misma subida devuelve el mismo archivo en vez de crear otro.
CREATE UNIQUE INDEX IF NOT EXISTS research_media_idem
  ON research_media_assets(owner_id, conversation_id, idempotency_key);

-- Entradas multimodales de un trabajo: si pidió voz y qué imagen y audio usa.
CREATE TABLE IF NOT EXISTS research_job_inputs (
  -- Trabajo.
  job_id TEXT PRIMARY KEY,
  -- 1 si el usuario pidió la respuesta hablada.
  voice INTEGER NOT NULL,
  -- Archivos asociados y sus huellas, congeladas al crear el trabajo.
  image_asset_id TEXT,
  audio_asset_id TEXT,
  image_hash TEXT,
  audio_hash TEXT,
  -- Duración del audio, usada para reservar el coste de la transcripción.
  audio_duration_ms INTEGER
);
