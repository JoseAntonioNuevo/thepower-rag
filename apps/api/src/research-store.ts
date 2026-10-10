import type { Audience, ResearchOutcome, ResearchScenarioId } from "@thepower-rag/contracts";
import type { Consumption } from "@thepower-rag/research";
import type { ResearchDatabase } from "./research-db";
import { sqlError } from "./research-db";
import { RESEARCH_MAX_USER_TURNS, type MemoryTurn } from "./research-memory";
import type { PriceSnapshot } from "./research-money";
import { ResearchAttention } from "./research-state";

export interface ConversationRow {
  id: string;
  owner_id: string;
  audience: Audience;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  ordinal: number;
  role: "user" | "assistant";
  text: string;
  job_id: string | null;
  client_key: string | null;
  created_at: number;
}

export interface JobRow {
  id: string;
  conversation_id: string;
  owner_id: string;
  run_id: string;
  audience: Audience;
  execution_status: "queued" | "running" | "complete" | "cancelled" | "attention" | "failed";
  report_outcome: ResearchOutcome | null;
  idempotency_key: string;
  fingerprint: string;
  original_question: string;
  contextualized_question: string | null;
  scenario_id: ResearchScenarioId | null;
  corpus_version: string;
  deadline_at: number;
  queue_deadline_at: number;
  started_at: number | null;
  created_at: number;
  finished_at: number | null;
  lease_token: number;
  lease_until: number | null;
  executor_id: string | null;
  cancel_requested: number;
  dispatch_state: "pending" | "created" | "create_unknown";
  reserved_micros: number;
  unknown_micros: number;
  consumed_micros: number;
  limit_micros: number;
  price_json: string;
  result_json: string | null;
  progress_text: string | null;
  crash_consumed: number;
  attention_reason: string | null;
}

export interface AccountRow {
  budget_micros: number;
  reserved_micros: number;
  unknown_micros: number;
  consumed_micros: number;
}

export interface OperationRow {
  id: string;
  job_id: string;
  ordinal: number;
  kind: string;
  fingerprint: string;
  state: "reserved" | "dispatched" | "completed" | "unknown" | "released";
  reservation_micros: number;
  consumed_micros: number;
  unknown_hold_micros: number;
  fence: number;
  result_json: string | null;
}

export type AdmitResult =
  | { ok: true; job: JobRow; created: boolean }
  | { ok: false; reason: "conversation" | "fingerprint" | "budget" | "active" | "turns" };

const JOB_COLUMNS = `id, conversation_id, owner_id, run_id, audience, execution_status, report_outcome,
  idempotency_key, fingerprint, original_question, contextualized_question, scenario_id, corpus_version,
  deadline_at, queue_deadline_at, started_at, created_at, finished_at, lease_token, lease_until,
  executor_id, cancel_requested, dispatch_state, reserved_micros, unknown_micros, consumed_micros,
  limit_micros, price_json, result_json, progress_text, crash_consumed, attention_reason`;

export async function createConversation(
  database: ResearchDatabase,
  ownerId: string,
  audience: Audience,
  now: number,
): Promise<ConversationRow> {
  const id = crypto.randomUUID();
  await database
    .prepare(
      `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, ownerId, audience, now, now)
    .run();
  return { id, owner_id: ownerId, audience, created_at: now, updated_at: now };
}

export async function listConversations(
  database: ResearchDatabase,
  ownerId: string,
): Promise<ConversationRow[]> {
  return database
    .prepare(
      `SELECT id, owner_id, audience, created_at, updated_at
       FROM research_conversations WHERE owner_id = ? ORDER BY updated_at DESC`,
    )
    .bind(ownerId)
    .all<ConversationRow>();
}

export async function getConversation(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  return database
    .prepare(
      `SELECT id, owner_id, audience, created_at, updated_at
       FROM research_conversations WHERE id = ? AND owner_id = ?`,
    )
    .bind(conversationId, ownerId)
    .first<ConversationRow>();
}

export async function listMessages(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
): Promise<MessageRow[]> {
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

export async function memoryTurns(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
): Promise<MemoryTurn[]> {
  const messages = await listMessages(database, ownerId, conversationId);
  return messages.map((message) => ({ role: message.role, text: message.text }));
}

export async function readAccount(database: ResearchDatabase): Promise<AccountRow | null> {
  return database
    .prepare(
      `SELECT budget_micros, reserved_micros, unknown_micros, consumed_micros
       FROM research_accounts WHERE id = 'research'`,
    )
    .first<AccountRow>();
}

export async function getJob(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
): Promise<JobRow | null> {
  return database
    .prepare(`SELECT ${JOB_COLUMNS} FROM research_jobs WHERE id = ? AND owner_id = ?`)
    .bind(jobId, ownerId)
    .first<JobRow>();
}

export async function admitJob(
  database: ResearchDatabase,
  input: {
    ownerId: string;
    conversationId: string;
    idempotencyKey: string;
    fingerprint: string;
    originalQuestion: string;
    contextualized: string | null;
    scenarioId: ResearchScenarioId | null;
    corpusVersion: string;
    prices: PriceSnapshot;
    now: number;
    deadlineMs: number;
    queueMs: number;
  },
): Promise<AdmitResult> {
  const conversation = await getConversation(database, input.ownerId, input.conversationId);
  if (conversation === null) {
    return { ok: false, reason: "conversation" };
  }
  const existing = await database
    .prepare(
      `SELECT fingerprint, job_id FROM research_submissions
       WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
    )
    .bind(input.ownerId, input.conversationId, input.idempotencyKey)
    .first<{ fingerprint: string; job_id: string }>();
  if (existing) {
    if (existing.fingerprint !== input.fingerprint) {
      return { ok: false, reason: "fingerprint" };
    }
    const job = await getJob(database, input.ownerId, existing.job_id);
    return job ? { ok: true, job, created: false } : { ok: false, reason: "budget" };
  }
  const turns = await database
    .prepare(
      `SELECT COUNT(*) AS total FROM research_messages
       WHERE conversation_id = ? AND role = 'user'`,
    )
    .bind(input.conversationId)
    .first<{ total: number }>();
  if ((turns?.total ?? 0) >= RESEARCH_MAX_USER_TURNS) {
    return { ok: false, reason: "turns" };
  }
  const jobId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const deadlineAt = input.now + input.deadlineMs;
  const queueDeadlineAt = input.now + input.queueMs;
  try {
    await database.batch([
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
           )`,
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
        ),
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
           )`,
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
        ),
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
      database
        .prepare(`UPDATE research_conversations SET updated_at = ? WHERE id = ? AND owner_id = ?`)
        .bind(input.now, input.conversationId, input.ownerId),
    ]);
  } catch (error) {
    const message = sqlError(error);
    if (message.includes("research-budget")) {
      return { ok: false, reason: "budget" };
    }
    if (message.includes("research_one_active_job")) {
      return { ok: false, reason: "active" };
    }
    if (message.includes("UNIQUE") || message.includes("constraint")) {
      const raced = await database
        .prepare(
          `SELECT fingerprint, job_id FROM research_submissions
           WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
        )
        .bind(input.ownerId, input.conversationId, input.idempotencyKey)
        .first<{ fingerprint: string; job_id: string }>();
      if (raced) {
        if (raced.fingerprint !== input.fingerprint) {
          return { ok: false, reason: "fingerprint" };
        }
        const racedJob = await getJob(database, input.ownerId, raced.job_id);
        return racedJob
          ? { ok: true, job: racedJob, created: false }
          : { ok: false, reason: "budget" };
      }
    }
    throw error;
  }
  const submission = await database
    .prepare(
      `SELECT fingerprint, job_id FROM research_submissions
       WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
    )
    .bind(input.ownerId, input.conversationId, input.idempotencyKey)
    .first<{ fingerprint: string; job_id: string }>();
  if (!submission) {
    const active = await database
      .prepare(
        `SELECT id FROM research_jobs
         WHERE conversation_id = ? AND execution_status IN ('queued', 'running', 'attention')`,
      )
      .bind(input.conversationId)
      .first<{ id: string }>();
    return { ok: false, reason: active ? "active" : "budget" };
  }
  if (submission.fingerprint !== input.fingerprint) {
    return { ok: false, reason: "fingerprint" };
  }
  const job = await getJob(database, input.ownerId, submission.job_id);
  if (!job) {
    return { ok: false, reason: "budget" };
  }
  return { ok: true, job, created: job.id === jobId };
}

export async function claimJob(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  executorId: string,
  now: number,
  leaseMs: number,
): Promise<JobRow | null> {
  const current = await getJob(database, ownerId, jobId);
  if (current === null || current.cancel_requested === 1) {
    return null;
  }
  if (current.execution_status === "queued" && now > current.queue_deadline_at) {
    await cancelJob(database, ownerId, jobId, now);
    return null;
  }
  if (now > current.deadline_at && current.execution_status === "queued") {
    await cancelJob(database, ownerId, jobId, now);
    return null;
  }
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
  if (claimed.changes < 1) {
    return null;
  }
  return getJob(database, ownerId, jobId);
}

export async function cancelJob(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  now: number,
): Promise<JobRow | null> {
  const job = await getJob(database, ownerId, jobId);
  if (job === null) {
    return null;
  }
  if (
    job.execution_status === "complete" ||
    job.execution_status === "cancelled" ||
    job.execution_status === "failed"
  ) {
    return job;
  }
  await database.batch([
    database
      .prepare(
        `UPDATE research_operations SET state = 'unknown'
         WHERE job_id = ? AND state = 'dispatched'
           AND EXISTS (SELECT 1 FROM research_jobs WHERE id = ? AND owner_id = ?)`,
      )
      .bind(jobId, jobId, ownerId),
    database
      .prepare(
        `UPDATE research_operations SET state = 'released'
         WHERE job_id = ? AND state = 'reserved'
           AND EXISTS (SELECT 1 FROM research_jobs WHERE id = ? AND owner_id = ?)`,
      )
      .bind(jobId, jobId, ownerId),
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
  return getJob(database, ownerId, jobId);
}

export async function promoteDispatched(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
): Promise<number> {
  const result = await database
    .prepare(
      `UPDATE research_operations SET state = 'unknown'
       WHERE job_id = ? AND state = 'dispatched'
         AND EXISTS (SELECT 1 FROM research_jobs WHERE id = ? AND owner_id = ?)`,
    )
    .bind(jobId, jobId, ownerId)
    .run();
  if (result.changes > 0) {
    await database
      .prepare(
        `UPDATE research_jobs
         SET execution_status = 'attention', attention_reason = 'reconciliation-required'
         WHERE id = ? AND owner_id = ? AND execution_status IN ('queued', 'running', 'attention')`,
      )
      .bind(jobId, ownerId)
      .run();
  }
  return result.changes;
}

/** Vuelve a running el mismo trabajo. No toca el plazo, la reserva ni la pregunta. */
export async function resumeRecoverable(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
): Promise<JobRow | null> {
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
  if (result.changes < 1) {
    return null;
  }
  return getJob(database, ownerId, jobId);
}

export async function markAttention(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  reason: string,
): Promise<void> {
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

export async function finishJob(
  database: ResearchDatabase,
  input: {
    ownerId: string;
    jobId: string;
    leaseToken: number;
    now: number;
    execution: "complete" | "failed";
    outcome: ResearchOutcome | null;
    resultJson: string | null;
  },
): Promise<boolean> {
  const open = await database
    .prepare(
      `SELECT COUNT(*) AS total FROM research_operations
       WHERE job_id = ? AND state IN ('reserved', 'dispatched')`,
    )
    .bind(input.jobId)
    .first<{ total: number }>();
  if ((open?.total ?? 0) > 0) {
    return false;
  }
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
  return result.changes > 0;
}

export async function markDispatch(
  database: ResearchDatabase,
  jobId: string,
  state: JobRow["dispatch_state"],
): Promise<void> {
  await database
    .prepare(
      `UPDATE research_jobs SET dispatch_state = ? WHERE id = ? AND dispatch_state != 'created'`,
    )
    .bind(state, jobId)
    .run();
}

export async function markCrashConsumed(database: ResearchDatabase, jobId: string): Promise<void> {
  await database
    .prepare(`UPDATE research_jobs SET crash_consumed = 1 WHERE id = ? AND crash_consumed = 0`)
    .bind(jobId)
    .run();
}

export async function setProgress(
  database: ResearchDatabase,
  jobId: string,
  text: string,
): Promise<void> {
  await database
    .prepare(`UPDATE research_jobs SET progress_text = ? WHERE id = ?`)
    .bind(text.slice(0, 240), jobId)
    .run();
}

export async function appendEvent(
  database: ResearchDatabase,
  jobId: string,
  kind: string,
  text: string,
  now: number,
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO research_events (job_id, seq, kind, text, created_at)
       SELECT ?, COALESCE((SELECT MAX(seq) FROM research_events WHERE job_id = ?), 0) + 1, ?, ?, ?`,
    )
    .bind(jobId, jobId, kind, text.slice(0, 240), now)
    .run();
}

export async function listEvents(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  after: number,
): Promise<{ seq: number; kind: string; text: string }[]> {
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

export async function listOperations(
  database: ResearchDatabase,
  jobId: string,
): Promise<OperationRow[]> {
  return database
    .prepare(
      `SELECT id, job_id, ordinal, kind, fingerprint, state, reservation_micros, consumed_micros,
              unknown_hold_micros, fence, result_json
       FROM research_operations WHERE job_id = ? ORDER BY ordinal`,
    )
    .bind(jobId)
    .all<OperationRow>();
}

export async function operationByFingerprint(
  database: ResearchDatabase,
  jobId: string,
  fingerprint: string,
): Promise<OperationRow | null> {
  return database
    .prepare(
      `SELECT id, job_id, ordinal, kind, fingerprint, state, reservation_micros, consumed_micros,
              unknown_hold_micros, fence, result_json
       FROM research_operations WHERE job_id = ? AND fingerprint = ?`,
    )
    .bind(jobId, fingerprint)
    .first<OperationRow>();
}

export async function beginOperation(
  database: ResearchDatabase,
  input: {
    jobId: string;
    kind: string;
    fingerprint: string;
    reservation: number;
    fence: number;
  },
): Promise<OperationRow> {
  const existing = await operationByFingerprint(database, input.jobId, input.fingerprint);
  if (existing) {
    if (existing.state === "unknown" || existing.state === "dispatched") {
      throw new ResearchAttention(existing.id);
    }
    if (existing.state === "reserved" && existing.fence !== input.fence) {
      throw new ResearchAttention(existing.id);
    }
    return existing;
  }
  const id = crypto.randomUUID();
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
  const row = await operationByFingerprint(database, input.jobId, input.fingerprint);
  if (row === null) {
    throw new ResearchAttention(id);
  }
  if (row.state === "unknown" || row.state === "dispatched") {
    throw new ResearchAttention(row.id);
  }
  return row;
}

/** Libera solo trabajo reservado y no enviado del arrendamiento vigente. */
export async function releaseReservedOperations(
  database: ResearchDatabase,
  jobId: string,
  fence: number,
): Promise<number> {
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
  return result.changes;
}

export async function holdDispatched(
  database: ResearchDatabase,
  operationId: string,
  fence: number,
): Promise<boolean> {
  const result = await database
    .prepare(
      `UPDATE research_operations SET state = 'unknown'
       WHERE id = ? AND state = 'dispatched' AND fence = ?`,
    )
    .bind(operationId, fence)
    .run();
  return result.changes > 0;
}

export async function markDispatched(
  database: ResearchDatabase,
  operationId: string,
  fence: number,
): Promise<boolean> {
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
  return result.changes > 0;
}

export function settlementOf(
  consumption: Consumption,
  reservation: number,
): { consumed: number; unknownHold: number } {
  if (consumption.kind === "none") {
    return { consumed: 0, unknownHold: 0 };
  }
  if (consumption.kind === "unknown") {
    return { consumed: 0, unknownHold: reservation };
  }
  if (consumption.usd === null) {
    return { consumed: 0, unknownHold: reservation };
  }
  const consumed = Math.ceil(consumption.usd * 1_000_000 - 1e-6);
  if (!Number.isSafeInteger(consumed) || consumed < 0) {
    return { consumed: 0, unknownHold: reservation };
  }
  return { consumed, unknownHold: 0 };
}

export async function completeOperation(
  database: ResearchDatabase,
  input: {
    operationId: string;
    fence: number;
    resultJson: string;
    consumption: Consumption;
    reservation: number;
  },
): Promise<boolean> {
  const settlement = settlementOf(input.consumption, input.reservation);
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
  return result.changes > 0;
}

export async function recordAssistantMessage(
  database: ResearchDatabase,
  input: { conversationId: string; ownerId: string; jobId: string; text: string; now: number },
): Promise<void> {
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
  const before = await readAccount(database);
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
  for (const row of rows) {
    const threadId = `job:${row.id}`;
    await database
      .prepare(`DELETE FROM research_checkpoint_writes WHERE thread_id = ?`)
      .bind(threadId)
      .run();
    await database
      .prepare(`DELETE FROM research_checkpoints WHERE thread_id = ?`)
      .bind(threadId)
      .run();
  }
  const after = await readAccount(database);
  if (
    before?.consumed_micros !== after?.consumed_micros ||
    before?.unknown_micros !== after?.unknown_micros ||
    before?.reserved_micros !== after?.reserved_micros
  ) {
    throw new Error("La retención alteró el presupuesto.");
  }
  return rows.length;
}
