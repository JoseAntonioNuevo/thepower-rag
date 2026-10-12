// GUÍA DE LECTURA · apps/api/src/research-store.ts
// Almacén SQL de la investigación durable (D1): conversaciones, mensajes, trabajos, operaciones de pago
// y cuenta de gasto. Las escrituras que deben ir juntas usan database.batch, que en D1 es atómico, y
// cada cambio de una operación exige la ficha (fence) del arrendamiento vigente.
// Tipos de audiencia, resultado y escenario.
import type { Audience, ResearchOutcome, ResearchScenarioId } from "@thepower-rag/contracts";
// Tipo de consumo.
import type { Consumption } from "@thepower-rag/research";
// Tipo de la base de datos.
import type { ResearchDatabase } from "./research-db";
// Extrae el mensaje de un error SQL.
import { sqlError } from "./research-db";
// Máximo de turnos y tipo de turno de memoria.
import { RESEARCH_MAX_USER_TURNS, type MemoryTurn } from "./research-memory";
// Tipo de las tarifas congeladas.
import type { PriceSnapshot } from "./research-money";
// Error de atención.
import { ResearchAttention } from "./research-state";

// Fila de research_conversations.
export interface ConversationRow {
  // Id.
  id: string;
  // Propietario.
  owner_id: string;
  // Audiencia.
  audience: Audience;
  // Creación.
  created_at: number;
  // Última actividad.
  updated_at: number;
}

// Fila de research_messages.
export interface MessageRow {
  // Id.
  id: string;
  // Conversación.
  conversation_id: string;
  // Posición.
  ordinal: number;
  // Papel.
  role: "user" | "assistant";
  // Texto.
  text: string;
  // Trabajo que la generó.
  job_id: string | null;
  // Clave del cliente (idempotencia).
  client_key: string | null;
  // Creación.
  created_at: number;
}

// Fila de research_jobs: un trabajo de investigación.
export interface JobRow {
  // Id.
  id: string;
  // Conversación.
  conversation_id: string;
  // Propietario.
  owner_id: string;
  // Ejecución.
  run_id: string;
  // Audiencia.
  audience: Audience;
  // Estado de ejecución.
  execution_status: "queued" | "running" | "complete" | "cancelled" | "attention" | "failed";
  // Resultado del informe.
  report_outcome: ResearchOutcome | null;
  // Clave de idempotencia.
  idempotency_key: string;
  // Huella de la petición.
  fingerprint: string;
  // Pregunta original.
  original_question: string;
  // Pregunta con memoria.
  contextualized_question: string | null;
  // Escenario de prueba.
  scenario_id: ResearchScenarioId | null;
  // Versión del corpus.
  corpus_version: string;
  // Plazo total.
  deadline_at: number;
  // Plazo para empezar.
  queue_deadline_at: number;
  // Inicio.
  started_at: number | null;
  // Creación.
  created_at: number;
  // Fin.
  finished_at: number | null;
  // Ficha del arrendamiento (sube en cada reclamación).
  lease_token: number;
  // Fin del arrendamiento.
  lease_until: number | null;
  // Ejecutor.
  executor_id: string | null;
  // Cancelación pedida (0/1).
  cancel_requested: number;
  // Estado de creación del Workflow.
  dispatch_state: "pending" | "created" | "create_unknown";
  // Micro-USD reservados.
  reserved_micros: number;
  // Micro-USD de cargo desconocido.
  unknown_micros: number;
  // Micro-USD consumidos.
  consumed_micros: number;
  // Tope del trabajo.
  limit_micros: number;
  // Tarifas congeladas.
  price_json: string;
  // Resultado en JSON.
  result_json: string | null;
  // Progreso visible.
  progress_text: string | null;
  // Si ya se usó la caída simulada.
  crash_consumed: number;
  // Motivo de atención.
  attention_reason: string | null;
}

// Fila de research_accounts: la cuenta global de gasto.
export interface AccountRow {
  // Presupuesto.
  budget_micros: number;
  // Reservado.
  reserved_micros: number;
  // Desconocido.
  unknown_micros: number;
  // Consumido.
  consumed_micros: number;
}

// Fila de research_operations: una llamada de pago.
export interface OperationRow {
  // Id.
  id: string;
  // Trabajo.
  job_id: string;
  // Posición.
  ordinal: number;
  // Tipo.
  kind: string;
  // Huella.
  fingerprint: string;
  // Estado.
  state: "reserved" | "dispatched" | "completed" | "unknown" | "released";
  // Reserva.
  reservation_micros: number;
  // Consumido.
  consumed_micros: number;
  // Retención desconocida.
  unknown_hold_micros: number;
  // Ficha del arrendamiento.
  fence: number;
  // Resultado.
  result_json: string | null;
}

// Resultado de admitir un trabajo.
export type AdmitResult =
  | { ok: true; job: JobRow; created: boolean }
  | {
      // Rechazado.
      ok: false;
      // Motivo.
      reason: "conversation" | "fingerprint" | "budget" | "active" | "turns" | "attachment";
    };

// Medios ligados a un trabajo.
export interface JobMediaBinding {
  // Voz pedida.
  voice: boolean;
  // Imagen.
  image: { id: string; hash: string } | null;
  // Audio.
  audio: { id: string; hash: string; durationMs: number } | null;
}

// Condición SQL: los medios existen, son del propietario y de la conversación, y no están en otro trabajo.
const ASSET_GUARD = `
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM research_media_assets
             WHERE id = ? AND owner_id = ? AND conversation_id = ? AND role = ?
               AND content_hash = ? AND (job_id IS NULL OR job_id = ?)
           ))
           AND (? IS NULL OR EXISTS (
             SELECT 1 FROM research_media_assets
             WHERE id = ? AND owner_id = ? AND conversation_id = ? AND role = ?
               AND content_hash = ? AND (job_id IS NULL OR job_id = ?)
           ))`;

// Valores de ASSET_GUARD en orden.
function assetGuardBinds(
  media: JobMediaBinding | null,
  ownerId: string,
  conversationId: string,
  jobId: string,
): unknown[] {
  // Imagen.
  const image = media?.image ?? null;
  // Audio.
  const audio = media?.audio ?? null;
  // Dos bloques de 7 valores: imagen y audio.
  return [
    image?.id ?? null,
    image?.id ?? "",
    ownerId,
    conversationId,
    "image",
    image?.hash ?? "",
    jobId,
    audio?.id ?? null,
    audio?.id ?? "",
    ownerId,
    conversationId,
    "audio",
    audio?.hash ?? "",
    jobId,
  ];
}

// Columnas de research_jobs.
const JOB_COLUMNS = `id, conversation_id, owner_id, run_id, audience, execution_status, report_outcome,
  idempotency_key, fingerprint, original_question, contextualized_question, scenario_id, corpus_version,
  deadline_at, queue_deadline_at, started_at, created_at, finished_at, lease_token, lease_until,
  executor_id, cancel_requested, dispatch_state, reserved_micros, unknown_micros, consumed_micros,
  limit_micros, price_json, result_json, progress_text, crash_consumed, attention_reason`;

// Crea una conversación.
export async function createConversation(
  database: ResearchDatabase,
  ownerId: string,
  audience: Audience,
  now: number,
): Promise<ConversationRow> {
  // Id nuevo.
  const id = crypto.randomUUID();
  // INSERT.
  await database
    .prepare(
      `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, ownerId, audience, now, now)
    .run();
  // Fila creada.
  return { id, owner_id: ownerId, audience, created_at: now, updated_at: now };
}

// Conversaciones del propietario, recientes primero.
export async function listConversations(
  database: ResearchDatabase,
  ownerId: string,
): Promise<ConversationRow[]> {
  // SELECT.
  return database
    .prepare(
      `SELECT id, owner_id, audience, created_at, updated_at
       FROM research_conversations WHERE owner_id = ? ORDER BY updated_at DESC`,
    )
    .bind(ownerId)
    .all<ConversationRow>();
}

// Una conversación del propietario.
export async function getConversation(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  // SELECT.
  return database
    .prepare(
      `SELECT id, owner_id, audience, created_at, updated_at
       FROM research_conversations WHERE id = ? AND owner_id = ?`,
    )
    .bind(conversationId, ownerId)
    .first<ConversationRow>();
}

// Mensajes de una conversación del propietario, en orden.
export async function listMessages(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
): Promise<MessageRow[]> {
  // SELECT con JOIN para comprobar el propietario.
  return database
    .prepare(
      `SELECT messages.id, messages.conversation_id, messages.ordinal, messages.role, messages.text,
              messages.job_id, messages.client_key, messages.created_at
       FROM research_messages AS messages
       JOIN research_conversations AS conversations ON conversations.id = messages.conversation_id
       WHERE messages.conversation_id = ? AND conversations.owner_id = ?
       ORDER BY messages.ordinal`,
    )
    .bind(conversationId, ownerId)
    .all<MessageRow>();
}

// Mensajes como turnos de memoria.
export async function memoryTurns(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
): Promise<MemoryTurn[]> {
  // Mensajes.
  const messages = await listMessages(database, ownerId, conversationId);
  // Papel y texto.
  return messages.map((message) => ({ role: message.role, text: message.text }));
}

// Lee la cuenta global.
export async function readAccount(database: ResearchDatabase): Promise<AccountRow | null> {
  // SELECT.
  return database
    .prepare(
      `SELECT budget_micros, reserved_micros, unknown_micros, consumed_micros
       FROM research_accounts WHERE id = 'research'`,
    )
    .first<AccountRow>();
}

// Un trabajo del propietario.
export async function getJob(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
): Promise<JobRow | null> {
  // SELECT.
  return database
    .prepare(`SELECT ${JOB_COLUMNS} FROM research_jobs WHERE id = ? AND owner_id = ?`)
    .bind(jobId, ownerId)
    .first<JobRow>();
}

// Admite un trabajo: guarda envío, trabajo, mensaje y medios en un solo lote atómico.
export async function admitJob(
  database: ResearchDatabase,
  input: {
    // Propietario.
    ownerId: string;
    // Conversación.
    conversationId: string;
    // Clave de idempotencia.
    idempotencyKey: string;
    // Huella de la petición.
    fingerprint: string;
    // Pregunta original.
    originalQuestion: string;
    // Pregunta con memoria.
    contextualized: string | null;
    // Escenario.
    scenarioId: ResearchScenarioId | null;
    // Versión del corpus.
    corpusVersion: string;
    // Tarifas congeladas.
    prices: PriceSnapshot;
    // Momento.
    now: number;
    // Plazo total.
    deadlineMs: number;
    // Plazo de cola.
    queueMs: number;
    // Medios.
    media?: JobMediaBinding | null;
  },
): Promise<AdmitResult> {
  // Conversación del propietario.
  const conversation = await getConversation(database, input.ownerId, input.conversationId);
  // No existe.
  if (conversation === null) {
    // Rechazo.
    return { ok: false, reason: "conversation" };
  }
  // Envío previo con la misma clave.
  const existing = await database
    .prepare(
      `SELECT fingerprint, job_id FROM research_submissions
       WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
    )
    .bind(input.ownerId, input.conversationId, input.idempotencyKey)
    .first<{ fingerprint: string; job_id: string }>();
  // Si existe.
  if (existing) {
    // Otra huella: conflicto.
    if (existing.fingerprint !== input.fingerprint) {
      // Rechazo.
      return { ok: false, reason: "fingerprint" };
    }
    // Mismo envío: devuelve su trabajo.
    const job = await getJob(database, input.ownerId, existing.job_id);
    // Trabajo existente.
    return job ? { ok: true, job, created: false } : { ok: false, reason: "budget" };
  }
  // Turnos del usuario.
  const turns = await database
    .prepare(
      `SELECT COUNT(*) AS total FROM research_messages
       WHERE conversation_id = ? AND role = 'user'`,
    )
    .bind(input.conversationId)
    .first<{ total: number }>();
  // Demasiados turnos.
  if ((turns?.total ?? 0) >= RESEARCH_MAX_USER_TURNS) {
    // Rechazo.
    return { ok: false, reason: "turns" };
  }
  // Id del trabajo.
  const jobId = crypto.randomUUID();
  // Id de ejecución.
  const runId = crypto.randomUUID();
  // Plazo total.
  const deadlineAt = input.now + input.deadlineMs;
  // Plazo de cola.
  const queueDeadlineAt = input.now + input.queueMs;
  // Los triggers de D1 pueden rechazar el lote: se traduce a un motivo.
  try {
    // Lote atómico.
    await database.batch([
      // 1) Envío, solo si no existe y no hay otro trabajo activo.
      database
        .prepare(
          `INSERT INTO research_submissions (owner_id, conversation_id, idempotency_key, fingerprint, job_id)
           SELECT ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM research_submissions
             WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?
           )
           AND NOT EXISTS (
             SELECT 1 FROM research_jobs
             WHERE conversation_id = ? AND execution_status IN ('queued', 'running', 'attention')
           )
           ${ASSET_GUARD}`,
        )
        .bind(
          input.ownerId,
          input.conversationId,
          input.idempotencyKey,
          input.fingerprint,
          jobId,
          input.ownerId,
          input.conversationId,
          input.idempotencyKey,
          input.conversationId,
          ...assetGuardBinds(input.media ?? null, input.ownerId, input.conversationId, jobId),
        ),
      // 2) Trabajo con su reserva, solo si se registró el envío.
      database
        .prepare(
          `INSERT INTO research_jobs (
             id, conversation_id, owner_id, run_id, audience, execution_status, report_outcome,
             idempotency_key, fingerprint, original_question, contextualized_question, scenario_id,
             corpus_version, deadline_at, queue_deadline_at, started_at, created_at, finished_at,
             lease_token, lease_until, executor_id, cancel_requested, dispatch_state,
             reserved_micros, unknown_micros, consumed_micros, limit_micros, price_json,
             result_json, progress_text, crash_consumed, attention_reason
           )
           SELECT ?, ?, ?, ?, ?, 'queued', NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL,
                  0, NULL, NULL, 0, 'pending', ?, 0, 0, ?, ?, NULL, NULL, 0, NULL
           WHERE EXISTS (
             SELECT 1 FROM research_submissions
             WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?
               AND fingerprint = ? AND job_id = ?
           )
           ${ASSET_GUARD}`,
        )
        .bind(
          jobId,
          input.conversationId,
          input.ownerId,
          runId,
          conversation.audience,
          input.idempotencyKey,
          input.fingerprint,
          input.originalQuestion,
          input.contextualized,
          input.scenarioId,
          input.corpusVersion,
          deadlineAt,
          queueDeadlineAt,
          input.now,
          input.prices.holdMicros,
          input.prices.jobLimitMicros,
          JSON.stringify(input.prices),
          input.ownerId,
          input.conversationId,
          input.idempotencyKey,
          input.fingerprint,
          jobId,
          ...assetGuardBinds(input.media ?? null, input.ownerId, input.conversationId, jobId),
        ),
      // 3) Mensaje del usuario.
      database
        .prepare(
          `INSERT INTO research_messages (id, conversation_id, ordinal, role, text, job_id, client_key, created_at)
           SELECT ?, ?, COALESCE((SELECT MAX(ordinal) FROM research_messages WHERE conversation_id = ?), 0) + 1,
                  'user', ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM research_jobs WHERE id = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.conversationId,
          input.conversationId,
          input.originalQuestion,
          jobId,
          input.idempotencyKey,
          input.now,
          jobId,
        ),
      // 4) Actividad de la conversación.
      database
        .prepare(`UPDATE research_conversations SET updated_at = ? WHERE id = ? AND owner_id = ?`)
        .bind(input.now, input.conversationId, input.ownerId),
      // 5) Medios: entrada del trabajo y vínculo de cada archivo.
      ...(input.media
        ? [
            database
              .prepare(
                `INSERT INTO research_job_inputs (
                   job_id, voice, image_asset_id, audio_asset_id, image_hash, audio_hash, audio_duration_ms
                 )
                 SELECT ?, ?, ?, ?, ?, ?, ?
                 WHERE EXISTS (SELECT 1 FROM research_jobs WHERE id = ?)`,
              )
              .bind(
                jobId,
                input.media.voice ? 1 : 0,
                input.media.image?.id ?? null,
                input.media.audio?.id ?? null,
                input.media.image?.hash ?? null,
                input.media.audio?.hash ?? null,
                input.media.audio?.durationMs ?? null,
                jobId,
              ),
            database
              .prepare(
                `UPDATE research_media_assets SET job_id = ?
                 WHERE ? IS NOT NULL AND id = ? AND owner_id = ? AND conversation_id = ?
                   AND content_hash = ? AND (job_id IS NULL OR job_id = ?)`,
              )
              .bind(
                jobId,
                input.media.image?.id ?? null,
                input.media.image?.id ?? "",
                input.ownerId,
                input.conversationId,
                input.media.image?.hash ?? "",
                jobId,
              ),
            database
              .prepare(
                `UPDATE research_media_assets SET job_id = ?
                 WHERE ? IS NOT NULL AND id = ? AND owner_id = ? AND conversation_id = ?
                   AND content_hash = ? AND (job_id IS NULL OR job_id = ?)`,
              )
              .bind(
                jobId,
                input.media.audio?.id ?? null,
                input.media.audio?.id ?? "",
                input.ownerId,
                input.conversationId,
                input.media.audio?.hash ?? "",
                jobId,
              ),
          ]
        : []),
    ]);
  } catch (error) {
    // Mensaje del error.
    const message = sqlError(error);
    // Trigger de presupuesto.
    if (message.includes("research-budget")) {
      // Sin presupuesto.
      return { ok: false, reason: "budget" };
    }
    // Índice de un trabajo activo.
    if (message.includes("research_one_active_job")) {
      // Ya hay uno activo.
      return { ok: false, reason: "active" };
    }
    // Carrera con otro envío idéntico.
    if (message.includes("UNIQUE") || message.includes("constraint")) {
      // Envío que ganó.
      const raced = await database
        .prepare(
          `SELECT fingerprint, job_id FROM research_submissions
           WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
        )
        .bind(input.ownerId, input.conversationId, input.idempotencyKey)
        .first<{ fingerprint: string; job_id: string }>();
      // Si existe.
      if (raced) {
        // Otra huella.
        if (raced.fingerprint !== input.fingerprint) {
          // Conflicto.
          return { ok: false, reason: "fingerprint" };
        }
        // Su trabajo.
        const racedJob = await getJob(database, input.ownerId, raced.job_id);
        // Lo devuelve.
        return racedJob
          ? { ok: true, job: racedJob, created: false }
          : { ok: false, reason: "budget" };
      }
    }
    // Otro error.
    throw error;
  }
  // Envío guardado.
  const submission = await database
    .prepare(
      `SELECT fingerprint, job_id FROM research_submissions
       WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
    )
    .bind(input.ownerId, input.conversationId, input.idempotencyKey)
    .first<{ fingerprint: string; job_id: string }>();
  // No se guardó.
  if (!submission) {
    // ¿Hay un trabajo activo?
    const active = await database
      .prepare(
        `SELECT id FROM research_jobs
         WHERE conversation_id = ? AND execution_status IN ('queued', 'running', 'attention')`,
      )
      .bind(input.conversationId)
      .first<{ id: string }>();
    // Sí.
    if (active) {
      // Activo.
      return { ok: false, reason: "active" };
    }
    // Medios no válidos.
    if (input.media?.image || input.media?.audio) {
      // Adjunto.
      return { ok: false, reason: "attachment" };
    }
    // Sin presupuesto.
    return { ok: false, reason: "budget" };
  }
  // Otra huella.
  if (submission.fingerprint !== input.fingerprint) {
    // Conflicto.
    return { ok: false, reason: "fingerprint" };
  }
  // Trabajo.
  const job = await getJob(database, input.ownerId, submission.job_id);
  // No existe.
  if (!job) {
    // Sin presupuesto.
    return { ok: false, reason: "budget" };
  }
  // Admitido; created indica si es nuevo.
  return { ok: true, job, created: job.id === jobId };
}

// Reclama un trabajo con un arrendamiento nuevo.
export async function claimJob(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  executorId: string,
  now: number,
  leaseMs: number,
): Promise<JobRow | null> {
  // Trabajo.
  const current = await getJob(database, ownerId, jobId);
  // No existe o se canceló.
  if (current === null || current.cancel_requested === 1) {
    // null.
    return null;
  }
  // En cola fuera de plazo de cola.
  if (current.execution_status === "queued" && now > current.queue_deadline_at) {
    // Se cancela.
    await cancelJob(database, ownerId, jobId, now);
    // null.
    return null;
  }
  // En cola fuera del plazo total.
  if (now > current.deadline_at && current.execution_status === "queued") {
    // Se cancela.
    await cancelJob(database, ownerId, jobId, now);
    // null.
    return null;
  }
  // UPDATE condicional: sube la ficha y fija ejecutor y fin del arrendamiento.
  const claimed = await database
    .prepare(
      `UPDATE research_jobs
       SET lease_token = lease_token + 1,
           lease_until = ?,
           executor_id = ?,
           execution_status = 'running',
           started_at = COALESCE(started_at, ?)
       WHERE id = ? AND owner_id = ? AND cancel_requested = 0
         AND execution_status IN ('queued', 'running')
         AND (lease_until IS NULL OR lease_until < ? OR executor_id = ?)
         AND (execution_status = 'running' OR ? <= deadline_at)`,
    )
    .bind(now + leaseMs, executorId, now, jobId, ownerId, now, executorId, now)
    .run();
  // Otro ejecutor lo tiene.
  if (claimed.changes < 1) {
    // null.
    return null;
  }
  // Trabajo reclamado.
  return getJob(database, ownerId, jobId);
}

// Cancela un trabajo: libera reservas y marca enviadas como desconocidas.
export async function cancelJob(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  now: number,
): Promise<JobRow | null> {
  // Trabajo.
  const job = await getJob(database, ownerId, jobId);
  // No existe.
  if (job === null) {
    // null.
    return null;
  }
  // Ya terminado.
  if (
    job.execution_status === "complete" ||
    job.execution_status === "cancelled" ||
    job.execution_status === "failed"
  ) {
    // Sin cambios.
    return job;
  }
  // Lote atómico.
  await database.batch([
    // Enviadas: cargo desconocido.
    database
      .prepare(
        `UPDATE research_operations SET state = 'unknown'
         WHERE job_id = ? AND state = 'dispatched'
           AND EXISTS (SELECT 1 FROM research_jobs WHERE id = ? AND owner_id = ?)`,
      )
      .bind(jobId, jobId, ownerId),
    // Reservadas: liberadas.
    database
      .prepare(
        `UPDATE research_operations SET state = 'released'
         WHERE job_id = ? AND state = 'reserved'
           AND EXISTS (SELECT 1 FROM research_jobs WHERE id = ? AND owner_id = ?)`,
      )
      .bind(jobId, jobId, ownerId),
    // Trabajo cancelado y ficha nueva.
    database
      .prepare(
        `UPDATE research_jobs
         SET cancel_requested = 1,
             lease_token = lease_token + 1,
             execution_status = 'cancelled',
             finished_at = ?,
             report_outcome = COALESCE(report_outcome, 'aborted')
         WHERE id = ? AND owner_id = ?
           AND execution_status IN ('queued', 'running', 'attention')`,
      )
      .bind(now, jobId, ownerId),
  ]);
  // Trabajo actualizado.
  return getJob(database, ownerId, jobId);
}

// Operaciones enviadas sin resultado pasan a desconocidas y el trabajo pide reconciliación.
export async function promoteDispatched(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
): Promise<number> {
  // UPDATE de las enviadas.
  const result = await database
    .prepare(
      `UPDATE research_operations SET state = 'unknown'
       WHERE job_id = ? AND state = 'dispatched'
         AND EXISTS (SELECT 1 FROM research_jobs WHERE id = ? AND owner_id = ?)`,
    )
    .bind(jobId, jobId, ownerId)
    .run();
  // Si cambió alguna.
  if (result.changes > 0) {
    // El trabajo pasa a atención.
    await database
      .prepare(
        `UPDATE research_jobs
         SET execution_status = 'attention', attention_reason = 'reconciliation-required'
         WHERE id = ? AND owner_id = ? AND execution_status IN ('queued', 'running', 'attention')`,
      )
      .bind(jobId, ownerId)
      .run();
  }
  // Cuántas cambiaron.
  return result.changes;
}

/** Vuelve a running el mismo trabajo. No toca el plazo, la reserva ni la pregunta. */
export async function resumeRecoverable(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
): Promise<JobRow | null> {
  // UPDATE condicional: solo desde atención recuperable.
  const result = await database
    .prepare(
      `UPDATE research_jobs
       SET execution_status = 'running', attention_reason = NULL
       WHERE id = ? AND owner_id = ?
         AND execution_status = 'attention'
         AND attention_reason = 'recoverable'
         AND cancel_requested = 0`,
    )
    .bind(jobId, ownerId)
    .run();
  // No cambió.
  if (result.changes < 1) {
    // null.
    return null;
  }
  // Trabajo reanudado.
  return getJob(database, ownerId, jobId);
}

// Marca el trabajo para atención con un motivo.
export async function markAttention(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  reason: string,
): Promise<void> {
  // UPDATE si sigue activo.
  await database
    .prepare(
      `UPDATE research_jobs
       SET execution_status = 'attention', attention_reason = ?
       WHERE id = ? AND owner_id = ? AND cancel_requested = 0
         AND execution_status IN ('queued', 'running', 'attention')`,
    )
    .bind(reason, jobId, ownerId)
    .run();
}

// Cierra un trabajo si no quedan operaciones abiertas y la ficha es la vigente.
export async function finishJob(
  database: ResearchDatabase,
  input: {
    // Propietario.
    ownerId: string;
    // Trabajo.
    jobId: string;
    // Ficha.
    leaseToken: number;
    // Momento.
    now: number;
    // Completo o fallido.
    execution: "complete" | "failed";
    // Resultado.
    outcome: ResearchOutcome | null;
    // JSON del resultado.
    resultJson: string | null;
  },
): Promise<boolean> {
  // Operaciones reservadas o enviadas.
  const open = await database
    .prepare(
      `SELECT COUNT(*) AS total FROM research_operations
       WHERE job_id = ? AND state IN ('reserved', 'dispatched')`,
    )
    .bind(input.jobId)
    .first<{ total: number }>();
  // Si quedan.
  if ((open?.total ?? 0) > 0) {
    // No se cierra.
    return false;
  }
  // UPDATE con la ficha vigente.
  const result = await database
    .prepare(
      `UPDATE research_jobs
       SET execution_status = ?,
           report_outcome = ?,
           result_json = ?,
           finished_at = ?
       WHERE id = ? AND owner_id = ? AND lease_token = ? AND cancel_requested = 0
         AND execution_status = 'running'`,
    )
    .bind(
      input.execution,
      input.outcome,
      input.resultJson,
      input.now,
      input.jobId,
      input.ownerId,
      input.leaseToken,
    )
    .run();
  // Si se cerró.
  return result.changes > 0;
}

// Guarda el estado de creación del Workflow (sin retroceder desde created).
export async function markDispatch(
  database: ResearchDatabase,
  jobId: string,
  state: JobRow["dispatch_state"],
): Promise<void> {
  // UPDATE.
  await database
    .prepare(
      `UPDATE research_jobs SET dispatch_state = ? WHERE id = ? AND dispatch_state != 'created'`,
    )
    .bind(state, jobId)
    .run();
}

// Marca la caída simulada como usada.
export async function markCrashConsumed(database: ResearchDatabase, jobId: string): Promise<void> {
  // UPDATE.
  await database
    .prepare(`UPDATE research_jobs SET crash_consumed = 1 WHERE id = ? AND crash_consumed = 0`)
    .bind(jobId)
    .run();
}

// Guarda el progreso visible.
export async function setProgress(
  database: ResearchDatabase,
  jobId: string,
  text: string,
): Promise<void> {
  // UPDATE recortado.
  await database
    .prepare(`UPDATE research_jobs SET progress_text = ? WHERE id = ?`)
    .bind(text.slice(0, 240), jobId)
    .run();
}

// Añade un evento con número de secuencia.
export async function appendEvent(
  database: ResearchDatabase,
  jobId: string,
  kind: string,
  text: string,
  now: number,
): Promise<void> {
  // INSERT con la siguiente secuencia.
  await database
    .prepare(
      `INSERT INTO research_events (job_id, seq, kind, text, created_at)
       SELECT ?, COALESCE((SELECT MAX(seq) FROM research_events WHERE job_id = ?), 0) + 1, ?, ?, ?`,
    )
    .bind(jobId, jobId, kind, text.slice(0, 240), now)
    .run();
}

// Eventos posteriores a una secuencia (máximo 40).
export async function listEvents(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  after: number,
): Promise<{ seq: number; kind: string; text: string }[]> {
  // SELECT con JOIN para comprobar el propietario.
  return database
    .prepare(
      `SELECT events.seq, events.kind, events.text
       FROM research_events AS events
       JOIN research_jobs AS jobs ON jobs.id = events.job_id
       WHERE events.job_id = ? AND jobs.owner_id = ? AND events.seq > ?
       ORDER BY events.seq
       LIMIT 40`,
    )
    .bind(jobId, ownerId, after)
    .all<{ seq: number; kind: string; text: string }>();
}

// Operaciones de un trabajo en orden.
export async function listOperations(
  database: ResearchDatabase,
  jobId: string,
): Promise<OperationRow[]> {
  // SELECT.
  return database
    .prepare(
      `SELECT id, job_id, ordinal, kind, fingerprint, state, reservation_micros, consumed_micros,
              unknown_hold_micros, fence, result_json
       FROM research_operations WHERE job_id = ? ORDER BY ordinal`,
    )
    .bind(jobId)
    .all<OperationRow>();
}

// Operación por huella.
export async function operationByFingerprint(
  database: ResearchDatabase,
  jobId: string,
  fingerprint: string,
): Promise<OperationRow | null> {
  // SELECT.
  return database
    .prepare(
      `SELECT id, job_id, ordinal, kind, fingerprint, state, reservation_micros, consumed_micros,
              unknown_hold_micros, fence, result_json
       FROM research_operations WHERE job_id = ? AND fingerprint = ?`,
    )
    .bind(jobId, fingerprint)
    .first<OperationRow>();
}

// Registra una operación reservada o devuelve la existente con la misma huella.
export async function beginOperation(
  database: ResearchDatabase,
  input: {
    // Trabajo.
    jobId: string;
    // Tipo.
    kind: string;
    // Huella.
    fingerprint: string;
    // Reserva en micro-USD.
    reservation: number;
    // Ficha del arrendamiento.
    fence: number;
  },
): Promise<OperationRow> {
  // Operación previa.
  const existing = await operationByFingerprint(database, input.jobId, input.fingerprint);
  // Existe.
  if (existing) {
    // Enviada o desconocida: nunca se reenvía.
    if (existing.state === "unknown" || existing.state === "dispatched") {
      // Atención.
      throw new ResearchAttention(existing.id);
    }
    // Reservada por otro arrendamiento.
    if (existing.state === "reserved" && existing.fence !== input.fence) {
      // Atención.
      throw new ResearchAttention(existing.id);
    }
    // Reutiliza.
    return existing;
  }
  // Id nuevo.
  const id = crypto.randomUUID();
  // INSERT condicional: trabajo vigente y reserva dentro de lo que queda.
  await database
    .prepare(
      `INSERT INTO research_operations (
         id, job_id, ordinal, kind, fingerprint, state, reservation_micros, consumed_micros,
         unknown_hold_micros, fence
       )
       SELECT ?, ?, COALESCE((SELECT MAX(ordinal) FROM research_operations WHERE job_id = ?), 0) + 1,
              ?, ?, 'reserved', ?, 0, 0, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM research_operations WHERE job_id = ? AND fingerprint = ?
       )
       AND EXISTS (
         SELECT 1 FROM research_jobs
         WHERE id = ? AND lease_token = ? AND cancel_requested = 0 AND execution_status = 'running'
       )
       AND ? <= (
         SELECT reserved_micros FROM research_jobs WHERE id = ?
       ) - COALESCE((
         SELECT SUM(reservation_micros) FROM research_operations
         WHERE job_id = ? AND state IN ('reserved', 'dispatched')
       ), 0)`,
    )
    .bind(
      id,
      input.jobId,
      input.jobId,
      input.kind,
      input.fingerprint,
      input.reservation,
      input.fence,
      input.jobId,
      input.fingerprint,
      input.jobId,
      input.fence,
      input.reservation,
      input.jobId,
      input.jobId,
    )
    .run();
  // Operación guardada.
  const row = await operationByFingerprint(database, input.jobId, input.fingerprint);
  // No se pudo reservar.
  if (row === null) {
    // Atención.
    throw new ResearchAttention(id);
  }
  // Otra la envió en paralelo.
  if (row.state === "unknown" || row.state === "dispatched") {
    // Atención.
    throw new ResearchAttention(row.id);
  }
  // Operación reservada.
  return row;
}

/** Libera solo trabajo reservado y no enviado del arrendamiento vigente. */
export async function releaseReservedOperations(
  database: ResearchDatabase,
  jobId: string,
  fence: number,
): Promise<number> {
  // UPDATE con la ficha vigente.
  const result = await database
    .prepare(
      `UPDATE research_operations SET state = 'released'
       WHERE job_id = ? AND state = 'reserved' AND fence = ?
         AND EXISTS (
           SELECT 1 FROM research_jobs
           WHERE research_jobs.id = research_operations.job_id
             AND research_jobs.execution_status = 'running'
             AND research_jobs.cancel_requested = 0
             AND research_jobs.lease_token = research_operations.fence
         )`,
    )
    .bind(jobId, fence)
    .run();
  // Cuántas se liberaron.
  return result.changes;
}

// Retiene una operación enviada: su cargo pasa a desconocido.
export async function holdDispatched(
  database: ResearchDatabase,
  operationId: string,
  fence: number,
): Promise<boolean> {
  // UPDATE con la ficha.
  const result = await database
    .prepare(
      `UPDATE research_operations
       SET state = 'unknown', unknown_hold_micros = reservation_micros
       WHERE id = ? AND state = 'dispatched' AND fence = ?`,
    )
    .bind(operationId, fence)
    .run();
  // Si cambió.
  return result.changes > 0;
}

// Marca una operación como enviada justo antes de llamar.
export async function markDispatched(
  database: ResearchDatabase,
  operationId: string,
  fence: number,
): Promise<boolean> {
  // UPDATE con la ficha vigente.
  const result = await database
    .prepare(
      `UPDATE research_operations SET state = 'dispatched'
       WHERE id = ? AND state = 'reserved' AND fence = ?
         AND EXISTS (
           SELECT 1 FROM research_jobs
           WHERE research_jobs.id = research_operations.job_id
             AND research_jobs.execution_status = 'running'
             AND research_jobs.cancel_requested = 0
             AND research_jobs.lease_token = research_operations.fence
         )`,
    )
    .bind(operationId, fence)
    .run();
  // Si cambió.
  return result.changes > 0;
}

// Cuánto se consume y cuánto queda retenido según el consumo informado.
export function settlementOf(
  consumption: Consumption,
  reservation: number,
): { consumed: number; unknownHold: number } {
  // Sin consumo.
  if (consumption.kind === "none") {
    // Nada.
    return { consumed: 0, unknownHold: 0 };
  }
  // Desconocido o estimado.
  if (consumption.kind === "unknown" || consumption.kind === "estimated") {
    // Una estimación, aunque esté completa, no es USD verificado. No se libera.
    return { consumed: 0, unknownHold: reservation };
  }
  // Informado sin USD.
  if (consumption.usd === null) {
    // Retiene la reserva.
    return { consumed: 0, unknownHold: reservation };
  }
  // USD a micro-USD redondeando hacia arriba.
  const consumed = Math.ceil(consumption.usd * 1_000_000 - 1e-6);
  // Importe inválido.
  if (!Number.isSafeInteger(consumed) || consumed < 0) {
    // Retiene la reserva.
    return { consumed: 0, unknownHold: reservation };
  }
  // Consumido.
  return { consumed, unknownHold: 0 };
}

// Guarda el resultado de una operación enviada.
export async function completeOperation(
  database: ResearchDatabase,
  input: {
    // Operación.
    operationId: string;
    // Ficha.
    fence: number;
    // Resultado.
    resultJson: string;
    // Consumo.
    consumption: Consumption;
    // Reserva.
    reservation: number;
  },
): Promise<boolean> {
  // Liquidación.
  const settlement = settlementOf(input.consumption, input.reservation);
  // UPDATE con la ficha vigente.
  const result = await database
    .prepare(
      `UPDATE research_operations
       SET state = 'completed', result_json = ?, consumed_micros = ?, unknown_hold_micros = ?
       WHERE id = ? AND state = 'dispatched' AND fence = ?
         AND EXISTS (
           SELECT 1 FROM research_jobs
           WHERE research_jobs.id = research_operations.job_id
             AND research_jobs.execution_status = 'running'
             AND research_jobs.cancel_requested = 0
             AND research_jobs.lease_token = research_operations.fence
         )`,
    )
    .bind(
      input.resultJson,
      settlement.consumed,
      settlement.unknownHold,
      input.operationId,
      input.fence,
    )
    .run();
  // Si se guardó.
  return result.changes > 0;
}

/** Sustituye el texto del turno de usuario de este trabajo. No inserta otro turno. */
export async function rememberAdmittedTurn(
  database: ResearchDatabase,
  input: {
    // Propietario.
    ownerId: string;
    // Conversación.
    conversationId: string;
    // Trabajo.
    jobId: string;
    // Clave del mensaje.
    idempotencyKey: string;
    // Texto admitido.
    text: string;
  },
): Promise<void> {
  // UPDATE del mensaje del usuario.
  await database
    .prepare(
      `UPDATE research_messages
       SET text = ?
       WHERE conversation_id = ? AND job_id = ? AND role = 'user' AND client_key = ?
         AND EXISTS (
           SELECT 1 FROM research_conversations
           WHERE research_conversations.id = research_messages.conversation_id
             AND research_conversations.owner_id = ?
         )`,
    )
    .bind(
      input.text.slice(0, 1_200),
      input.conversationId,
      input.jobId,
      input.idempotencyKey,
      input.ownerId,
    )
    .run();
}

// Guarda el informe como mensaje del asistente, una sola vez por trabajo.
export async function recordAssistantMessage(
  database: ResearchDatabase,
  input: { conversationId: string; ownerId: string; jobId: string; text: string; now: number },
): Promise<void> {
  // INSERT condicional.
  await database
    .prepare(
      `INSERT INTO research_messages (id, conversation_id, ordinal, role, text, job_id, client_key, created_at)
       SELECT ?, ?, COALESCE((SELECT MAX(ordinal) FROM research_messages WHERE conversation_id = ?), 0) + 1,
              'assistant', ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM research_conversations WHERE id = ? AND owner_id = ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM research_messages WHERE conversation_id = ? AND client_key = ?
       )`,
    )
    .bind(
      crypto.randomUUID(),
      input.conversationId,
      input.conversationId,
      input.text.slice(0, 4_000),
      input.jobId,
      `job:${input.jobId}`,
      input.now,
      input.conversationId,
      input.ownerId,
      input.conversationId,
      `job:${input.jobId}`,
    )
    .run();
}

/** Borra checkpoints antiguos. No toca cargos desconocidos ni el presupuesto. */
export async function purgeCheckpoints(
  database: ResearchDatabase,
  olderThan: number,
): Promise<number> {
  // Cuenta antes.
  const before = await readAccount(database);
  // Trabajos terminados, antiguos y sin cargos desconocidos.
  const rows = await database
    .prepare(
      `SELECT id FROM research_jobs
       WHERE finished_at IS NOT NULL AND finished_at < ?
         AND unknown_micros = 0
         AND execution_status IN ('complete', 'cancelled', 'failed')
         AND NOT EXISTS (
           SELECT 1 FROM research_operations
           WHERE research_operations.job_id = research_jobs.id AND state = 'unknown'
         )`,
    )
    .bind(olderThan)
    .all<{ id: string }>();
  // Cada trabajo.
  for (const row of rows) {
    // Hilo del checkpointer.
    const threadId = `job:${row.id}`;
    // Borra escrituras.
    await database
      .prepare(`DELETE FROM research_checkpoint_writes WHERE thread_id = ?`)
      .bind(threadId)
      .run();
    // Borra checkpoints.
    await database
      .prepare(`DELETE FROM research_checkpoints WHERE thread_id = ?`)
      .bind(threadId)
      .run();
  }
  // Cuenta después.
  const after = await readAccount(database);
  // La cuenta no debe cambiar.
  if (
    before?.consumed_micros !== after?.consumed_micros ||
    before?.unknown_micros !== after?.unknown_micros ||
    before?.reserved_micros !== after?.reserved_micros
  ) {
    // Error.
    throw new Error("La retención alteró el presupuesto.");
  }
  // Trabajos limpiados.
  return rows.length;
}

// Fila de research_job_inputs: medios del trabajo.
export interface JobInputRow {
  // Trabajo.
  job_id: string;
  // Voz (0/1).
  voice: number;
  // Imagen.
  image_asset_id: string | null;
  // Audio.
  audio_asset_id: string | null;
  // Hash de la imagen.
  image_hash: string | null;
  // Hash del audio.
  audio_hash: string | null;
  // Duración del audio.
  audio_duration_ms: number | null;
}

// Medios de un trabajo.
export async function readJobInput(
  database: ResearchDatabase,
  jobId: string,
): Promise<JobInputRow | null> {
  // SELECT.
  return database
    .prepare(
      `SELECT job_id, voice, image_asset_id, audio_asset_id, image_hash, audio_hash, audio_duration_ms
       FROM research_job_inputs WHERE job_id = ?`,
    )
    .bind(jobId)
    .first<JobInputRow>();
}

// Guarda un borrador del resultado sin cerrar el trabajo.
export async function saveResultDraft(
  database: ResearchDatabase,
  input: {
    // Propietario.
    ownerId: string;
    // Trabajo.
    jobId: string;
    // Ficha.
    leaseToken: number;
    // Resultado.
    outcome: string;
    // JSON.
    resultJson: string;
  },
): Promise<boolean> {
  // UPDATE con la ficha vigente.
  const result = await database
    .prepare(
      `UPDATE research_jobs
       SET result_json = ?, report_outcome = ?
       WHERE id = ? AND owner_id = ? AND lease_token = ? AND cancel_requested = 0
         AND execution_status = 'running'`,
    )
    .bind(input.resultJson, input.outcome, input.jobId, input.ownerId, input.leaseToken)
    .run();
  // Si se guardó.
  return result.changes > 0;
}

// Medios sin trabajo más antiguos que una fecha.
export async function listOrphanMedia(
  database: ResearchDatabase,
  olderThan: number,
): Promise<{ id: string; object_key: string }[]> {
  // SELECT.
  return database
    .prepare(
      `SELECT id, object_key FROM research_media_assets
       WHERE job_id IS NULL AND created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM research_job_inputs
           WHERE research_job_inputs.image_asset_id = research_media_assets.id
              OR research_job_inputs.audio_asset_id = research_media_assets.id
         )`,
    )
    .bind(olderThan)
    .all<{ id: string; object_key: string }>();
}

// Borra un medio solo si no está ligado a un trabajo.
export async function deleteMediaRow(database: ResearchDatabase, id: string): Promise<boolean> {
  // DELETE condicional.
  const result = await database
    .prepare(`DELETE FROM research_media_assets WHERE id = ? AND job_id IS NULL`)
    .bind(id)
    .run();
  // Si se borró.
  return result.changes > 0;
}
