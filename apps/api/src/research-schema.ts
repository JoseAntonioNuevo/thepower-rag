/**
 * Esquema aditivo de la investigación. Vive en RESEARCH_DB, no en la base
 * del curso. Las sentencias son idempotentes. No borra filas de presupuesto.
 */
export const RESEARCH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS research_accounts (
  id TEXT PRIMARY KEY,
  budget_micros INTEGER NOT NULL CHECK (budget_micros > 0),
  reserved_micros INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
  unknown_micros INTEGER NOT NULL DEFAULT 0 CHECK (unknown_micros >= 0),
  consumed_micros INTEGER NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  config_version TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS research_conversations_owner
  ON research_conversations(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS research_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  job_id TEXT,
  client_key TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(conversation_id, ordinal),
  UNIQUE(conversation_id, client_key)
);

CREATE TABLE IF NOT EXISTS research_jobs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  execution_status TEXT NOT NULL,
  report_outcome TEXT,
  idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  original_question TEXT NOT NULL,
  contextualized_question TEXT,
  scenario_id TEXT,
  corpus_version TEXT NOT NULL,
  deadline_at INTEGER NOT NULL,
  queue_deadline_at INTEGER NOT NULL,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  lease_token INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  executor_id TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  dispatch_state TEXT NOT NULL,
  reserved_micros INTEGER NOT NULL CHECK (reserved_micros >= 0),
  unknown_micros INTEGER NOT NULL DEFAULT 0 CHECK (unknown_micros >= 0),
  consumed_micros INTEGER NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  limit_micros INTEGER NOT NULL,
  price_json TEXT NOT NULL,
  result_json TEXT,
  progress_text TEXT,
  crash_consumed INTEGER NOT NULL DEFAULT 0,
  attention_reason TEXT
);
CREATE INDEX IF NOT EXISTS research_jobs_owner ON research_jobs(owner_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS research_one_active_job
  ON research_jobs(conversation_id)
  WHERE execution_status IN ('queued', 'running', 'attention');

CREATE TABLE IF NOT EXISTS research_submissions (
  owner_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  job_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, conversation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS research_operations (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  kind TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  state TEXT NOT NULL,
  reservation_micros INTEGER NOT NULL CHECK (reservation_micros >= 0),
  consumed_micros INTEGER NOT NULL DEFAULT 0 CHECK (consumed_micros >= 0),
  unknown_hold_micros INTEGER NOT NULL DEFAULT 0 CHECK (unknown_hold_micros >= 0),
  fence INTEGER NOT NULL,
  result_json TEXT,
  UNIQUE(job_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS research_operations_job ON research_operations(job_id, ordinal);

CREATE TABLE IF NOT EXISTS research_events (
  job_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (job_id, seq)
);

CREATE TABLE IF NOT EXISTS research_checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  metadata TEXT NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS research_checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL,
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

CREATE TABLE IF NOT EXISTS research_report_artifacts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

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
`;
