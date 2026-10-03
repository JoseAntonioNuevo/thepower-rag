CREATE TABLE corpus_versions (
  id TEXT PRIMARY KEY,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  remote_revision TEXT,
  status TEXT NOT NULL
);

CREATE TABLE documents (
  version_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  title TEXT NOT NULL,
  audience TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  PRIMARY KEY (version_id, document_id)
);

CREATE TABLE chunks (
  version_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY (version_id, chunk_id)
);
