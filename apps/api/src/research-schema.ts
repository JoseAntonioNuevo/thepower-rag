// GUÍA DE LECTURA · apps/api/src/research-schema.ts
// SQL de la base de la investigación durable (RESEARCH_DB): cuenta de gasto, conversaciones, mensajes,
// trabajos, operaciones de pago, checkpoints, eventos y medios, con triggers que impiden superar el
// presupuesto. La copia aplicable con Wrangler está en apps/api/migrations-research/ y lleva los
// mismos comentarios. Si cambias una tabla aquí, cambia también esa migración (y al revés).
// Las bases creadas antes del 26/10/2026 guardaban el grupo del curso; dropLegacyGroupColumns
// (research-db.ts) quita esa columna al arrancar.
/**
 * Esquema aditivo de la investigación. Vive en RESEARCH_DB, no en la base
 * del chat (DB). Las sentencias son idempotentes. No borra filas de presupuesto.
 * Las líneas «--» son comentarios SQL: «schemaStatements» (research-db.ts) las salta
 * antes de enviar cada sentencia a D1, así que solo documentan.
 */
export const RESEARCH_SCHEMA_SQL = `
-- Qué guarda: la cuenta de gasto de la investigación, las conversaciones y sus mensajes, los
-- trabajos durables, cada llamada de pago (operación), los checkpoints de LangGraph, los
-- eventos de progreso y los informes largos.
-- Por qué en un D1 aparte (binding RESEARCH_DB): la investigación tiene su propio presupuesto
-- y no puede consumir ni mezclar el del chat («public_budget»).
-- Dinero: todo va en micro-USD enteros (1 USD = 1 000 000) para no tener errores de redondeo.
-- Seguridad del gasto: los TRIGGER del final mueven el dinero entre «reservado», «consumido» y
-- «desconocido» dentro de la misma escritura y abortan con RAISE si se supera el presupuesto.
-- Idempotencia: todas las sentencias usan IF NOT EXISTS, así que repetirlas no borra nada.
-- Nota técnica: «schemaStatements» (research-db.ts) salta estas líneas «--» y ejecuta cada
-- sentencia por separado, porque D1 no acepta el script entero de una vez.

-- Cuenta global de gasto de la investigación. Hay una sola fila, con id «research».
CREATE TABLE IF NOT EXISTS research_accounts (
  -- Id de la cuenta («research»).
  id TEXT PRIMARY KEY,
  -- Presupuesto total autorizado en micro-USD. Tiene que ser positivo.
  budget_micros INTEGER NOT NULL CHECK (budget_micros > 0),
  -- Reservado por trabajos en curso: el peor caso que aún puede gastarse.
  reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
  -- Llamadas enviadas cuyo resultado no se conoce: se cuentan como gastadas por prudencia.
  unknown_micros INTEGER NOT NULL DEFAULT 0 CHECK (unknown_micros >= 0),
  -- Gasto estimado ya confirmado por llamadas terminadas.
  consumed_micros INTEGER NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  -- Versión de la tabla de precios con la que se creó la cuenta.
  config_version TEXT NOT NULL
);

-- Conversación de investigación. Cada una pertenece a un propietario.
CREATE TABLE IF NOT EXISTS research_conversations (
  -- Id aleatorio de la conversación.
  id TEXT PRIMARY KEY,
  -- Propietario: la sesión anónima (producción) o la cookie local firmada.
  owner_id TEXT NOT NULL,
  -- Fechas en milisegundos desde 1970.
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
-- Índice para listar las conversaciones de un propietario, la más reciente primero.
CREATE INDEX IF NOT EXISTS research_conversations_owner
  ON research_conversations(owner_id, updated_at DESC);

-- Mensajes de una conversación: preguntas del usuario y respuestas del sistema.
CREATE TABLE IF NOT EXISTS research_messages (
  -- Id del mensaje.
  id TEXT PRIMARY KEY,
  -- Conversación a la que pertenece.
  conversation_id TEXT NOT NULL,
  -- Posición dentro de la conversación (1, 2, 3…).
  ordinal INTEGER NOT NULL,
  -- «user» o «assistant».
  role TEXT NOT NULL,
  -- Texto del mensaje.
  text TEXT NOT NULL,
  -- Trabajo de investigación que produjo o atendió este mensaje, si lo hay.
  job_id TEXT,
  -- Clave que envía el navegador para que reenviar el mismo mensaje no lo duplique.
  client_key TEXT,
  -- Fecha de creación.
  created_at INTEGER NOT NULL,
  -- No puede haber dos mensajes en la misma posición.
  UNIQUE(conversation_id, ordinal),
  -- Ni dos mensajes con la misma clave del cliente.
  UNIQUE(conversation_id, client_key)
);

-- Trabajo de investigación durable: una pregunta que se ejecuta en un Workflow de Cloudflare.
CREATE TABLE IF NOT EXISTS research_jobs (
  -- Id del trabajo. También es el id de la instancia del Workflow.
  id TEXT PRIMARY KEY,
  -- Conversación y propietario.
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  -- Id de ejecución que se muestra en la traza.
  run_id TEXT NOT NULL,
  -- queued, running, attention (necesita revisión), complete, cancelled o failed.
  execution_status TEXT NOT NULL,
  -- Resultado del informe (completo, parcial, rechazo, abortado…). NULL mientras corre.
  report_outcome TEXT,
  -- Clave de idempotencia del envío: el mismo envío no crea dos trabajos.
  idempotency_key TEXT NOT NULL,
  -- Huella del contenido de la petición, para detectar una clave reutilizada con otra pregunta.
  fingerprint TEXT NOT NULL,
  -- Pregunta tal y como la escribió el usuario.
  original_question TEXT NOT NULL,
  -- Pregunta con la memoria de la conversación resuelta («esa sesión» → «S5»).
  contextualized_question TEXT,
  -- Guion de la demo, si es una ejecución local de prueba.
  scenario_id TEXT,
  -- Versión del corpus de ThePower Shop consultada.
  corpus_version TEXT NOT NULL,
  -- Plazo total del trabajo y plazo para empezar a correr (milisegundos).
  deadline_at INTEGER NOT NULL,
  queue_deadline_at INTEGER NOT NULL,
  -- Inicio, creación y fin.
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  -- Ficha del arrendamiento (fence). Sube en cada reclamación: un ejecutor viejo ya no puede escribir.
  lease_token INTEGER NOT NULL DEFAULT 0,
  -- Hasta cuándo es válido el arrendamiento del ejecutor actual.
  lease_until INTEGER,
  -- Ejecutor que tiene el arrendamiento.
  executor_id TEXT,
  -- 1 si el usuario pidió cancelar.
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  -- Estado de la creación del Workflow: pending, created o create_unknown.
  dispatch_state TEXT NOT NULL,
  -- Dinero del trabajo en micro-USD: reservado, desconocido y consumido.
  reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
  unknown_micros INTEGER NOT NULL DEFAULT 0 CHECK (unknown_micros >= 0),
  consumed_micros INTEGER NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  -- Tope de gasto de este trabajo (0,25 USD en producción).
  limit_micros INTEGER NOT NULL,
  -- Tarifas congeladas al crear el trabajo: un cambio de precios no afecta a un trabajo en curso.
  price_json TEXT NOT NULL,
  -- Resumen final en JSON (fuentes, informe, consumo).
  result_json TEXT,
  -- Texto corto de progreso para la interfaz.
  progress_text TEXT,
  -- 1 cuando la caída simulada de la demo ya ocurrió (para no repetirla al reanudar).
  crash_consumed INTEGER NOT NULL DEFAULT 0,
  -- Motivo del estado «attention» (por ejemplo «recoverable» o «reconciliation-required»).
  attention_reason TEXT
);
-- Índice para listar los trabajos de un propietario.
CREATE INDEX IF NOT EXISTS research_jobs_owner ON research_jobs(owner_id, id);
-- Como mucho un trabajo vivo por conversación: impide lanzar dos investigaciones a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS research_one_active_job
  ON research_jobs(conversation_id)
  WHERE execution_status IN ('queued', 'running', 'attention');

-- Registro de envíos: asocia una clave de idempotencia con el trabajo que creó.
CREATE TABLE IF NOT EXISTS research_submissions (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  -- Clave que manda el navegador con cada envío.
  idempotency_key TEXT NOT NULL,
  -- Huella de la petición: la misma clave con otra pregunta se rechaza.
  fingerprint TEXT NOT NULL,
  -- Trabajo creado por ese envío.
  job_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, conversation_id, idempotency_key)
);

-- Operación: una llamada de pago (modelo, búsqueda, lectura, visión, voz…) dentro de un trabajo.
-- Es el «diario» que permite reanudar sin pagar dos veces la misma llamada.
CREATE TABLE IF NOT EXISTS research_operations (
  -- Id de la operación.
  id TEXT PRIMARY KEY,
  -- Trabajo al que pertenece.
  job_id TEXT NOT NULL,
  -- Orden dentro del trabajo.
  ordinal INTEGER NOT NULL,
  -- Tipo de llamada (plan, evaluación, búsqueda, lectura, visión…).
  kind TEXT NOT NULL,
  -- Huella de la entrada de la llamada. Misma huella en el mismo trabajo = misma operación.
  fingerprint TEXT NOT NULL,
  -- reserved → dispatched → completed | unknown, o reserved → released si no se envió.
  state TEXT NOT NULL,
  -- Peor coste reservado antes de enviar la llamada.
  reservation_micros INTEGER NOT NULL CHECK (reservation_micros >= 0),
  -- Coste estimado con el consumo real devuelto.
  consumed_micros INTEGER NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  -- Parte que se retiene como desconocida (por ejemplo, créditos sin precio verificado).
  unknown_hold_micros INTEGER NOT NULL DEFAULT 0 CHECK (unknown_hold_micros >= 0),
  -- Ficha del arrendamiento con la que se escribió. Protege frente a ejecutores antiguos.
  fence INTEGER NOT NULL,
  -- Resultado guardado. Al repetir el paso se reutiliza en vez de volver a llamar.
  result_json TEXT,
  -- Una operación por huella y trabajo.
  UNIQUE(job_id, fingerprint)
);
-- Índice para recorrer las operaciones de un trabajo en orden.
CREATE INDEX IF NOT EXISTS research_operations_job ON research_operations(job_id, ordinal);

-- Eventos de progreso que la interfaz consulta mientras el trabajo corre.
CREATE TABLE IF NOT EXISTS research_events (
  job_id TEXT NOT NULL,
  -- Número de evento dentro del trabajo (1, 2, 3…).
  seq INTEGER NOT NULL,
  -- Tipo de evento.
  kind TEXT NOT NULL,
  -- Texto corto (como mucho 240 caracteres).
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
);

-- Checkpoints de LangGraph: el estado del grafo tras cada nodo. Permite seguir en otro paso
-- del Workflow sin repetir nodos. Las columnas siguen el formato del checkpointer de LangGraph.
CREATE TABLE IF NOT EXISTS research_checkpoints (
  -- Hilo del grafo (uno por trabajo).
  thread_id TEXT NOT NULL,
  -- Espacio de nombres del checkpoint (subgrafos).
  checkpoint_ns TEXT NOT NULL,
  -- Id del checkpoint y del anterior.
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  -- Tipo de serialización y contenido serializado.
  type TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  metadata TEXT NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

-- Escrituras pendientes de LangGraph: resultados de nodos que aún no forman un checkpoint completo.
CREATE TABLE IF NOT EXISTS research_checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  -- Tarea que escribió y posición de la escritura.
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  -- Canal del estado que cambia, tipo de serialización y valor.
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

-- Informes largos guardados aparte del resultado del trabajo, para no inflar result_json.
CREATE TABLE IF NOT EXISTS research_report_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  -- Solo su propietario puede leerlo.
  owner_id TEXT NOT NULL,
  -- Texto completo del informe.
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Al crear un trabajo, su reserva se suma a la cuenta global. Si la suma de reservado,
-- desconocido y consumido supera el presupuesto, RAISE aborta y el trabajo no se crea.
CREATE TRIGGER IF NOT EXISTS research_job_reserve
AFTER INSERT ON research_jobs
BEGIN
  UPDATE research_accounts
  SET reserved_micros = reserved_micros + NEW.reserved_micros
  WHERE id = 'research';
  SELECT RAISE(ABORT, 'research-budget')
  WHERE (SELECT reserved_micros FROM research_accounts WHERE id = 'research') < 0
     OR (SELECT reserved_micros + unknown_micros + consumed_micros FROM research_accounts WHERE id = 'research')
        > (SELECT budget_micros FROM research_accounts WHERE id = 'research');
END;

-- Una llamada enviada terminó: su reserva pasa a consumido (y la parte dudosa a desconocido),
-- tanto en la cuenta global como en el trabajo.
CREATE TRIGGER IF NOT EXISTS research_op_complete
AFTER UPDATE OF state ON research_operations
WHEN NEW.state = 'completed' AND OLD.state = 'dispatched'
BEGIN
  UPDATE research_accounts
  SET reserved_micros = reserved_micros - NEW.reservation_micros,
      consumed_micros = consumed_micros + NEW.consumed_micros,
      unknown_micros = unknown_micros + NEW.unknown_hold_micros
  WHERE id = 'research';
  UPDATE research_jobs
  SET reserved_micros = reserved_micros - NEW.reservation_micros,
      consumed_micros = consumed_micros + NEW.consumed_micros,
      unknown_micros = unknown_micros + NEW.unknown_hold_micros
  WHERE id = NEW.job_id;
  SELECT RAISE(ABORT, 'research-settle')
  WHERE (SELECT reserved_micros FROM research_accounts WHERE id = 'research') < 0
     OR (SELECT reserved_micros FROM research_jobs WHERE id = NEW.job_id) < 0;
END;

-- Una llamada enviada quedó sin resultado conocido: toda su reserva pasa a desconocido.
-- Nunca se libera como si no hubiera costado nada, porque el proveedor pudo cobrarla.
CREATE TRIGGER IF NOT EXISTS research_op_unknown
AFTER UPDATE OF state ON research_operations
WHEN NEW.state = 'unknown' AND OLD.state = 'dispatched'
BEGIN
  UPDATE research_accounts
  SET reserved_micros = reserved_micros - NEW.reservation_micros,
      unknown_micros = unknown_micros + NEW.reservation_micros
  WHERE id = 'research';
  UPDATE research_jobs
  SET reserved_micros = reserved_micros - NEW.reservation_micros,
      unknown_micros = unknown_micros + NEW.reservation_micros
  WHERE id = NEW.job_id;
  SELECT RAISE(ABORT, 'research-unknown')
  WHERE (SELECT reserved_micros FROM research_accounts WHERE id = 'research') < 0
     OR (SELECT reserved_micros FROM research_jobs WHERE id = NEW.job_id) < 0;
END;

-- Una reserva que nunca llegó a enviarse se libera entera: no hubo llamada, no hubo coste.
CREATE TRIGGER IF NOT EXISTS research_op_release
AFTER UPDATE OF state ON research_operations
WHEN NEW.state = 'released' AND OLD.state = 'reserved'
BEGIN
  UPDATE research_accounts
  SET reserved_micros = reserved_micros - NEW.reservation_micros
  WHERE id = 'research';
  UPDATE research_jobs
  SET reserved_micros = reserved_micros - NEW.reservation_micros
  WHERE id = NEW.job_id;
  SELECT RAISE(ABORT, 'research-release')
  WHERE (SELECT reserved_micros FROM research_accounts WHERE id = 'research') < 0
     OR (SELECT reserved_micros FROM research_jobs WHERE id = NEW.job_id) < 0;
END;

-- Cuando un trabajo termina (completo, cancelado o fallido), lo que le quedaba reservado se
-- devuelve a la cuenta global y su reserva queda en cero.
CREATE TRIGGER IF NOT EXISTS research_job_finish
AFTER UPDATE OF execution_status ON research_jobs
WHEN NEW.execution_status IN ('complete', 'cancelled', 'failed')
 AND OLD.execution_status IN ('queued', 'running', 'attention')
BEGIN
  UPDATE research_accounts
  SET reserved_micros = reserved_micros - NEW.reserved_micros
  WHERE id = 'research';
  UPDATE research_jobs SET reserved_micros = 0 WHERE id = NEW.id;
  SELECT RAISE(ABORT, 'research-finish')
  WHERE (SELECT reserved_micros FROM research_accounts WHERE id = 'research') < 0;
END;

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
  -- «image», «audio» o «speech».
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
`;
