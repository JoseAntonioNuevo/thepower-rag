CREATE TABLE index_profiles (
  id TEXT PRIMARY KEY,
  corpus_version TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  metric TEXT NOT NULL,
  chunk_max_chars INTEGER NOT NULL,
  chunk_overlap INTEGER NOT NULL,
  provider_revision TEXT,
  family TEXT NOT NULL,
  status TEXT NOT NULL,
  expected_vectors INTEGER NOT NULL,
  visible_vectors INTEGER,
  mutation_id TEXT,
  last_error TEXT,
  active INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ingest_items (
  corpus_version TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  store TEXT NOT NULL,
  item_key TEXT NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  PRIMARY KEY (corpus_version, profile_id, store, item_key)
);

CREATE TABLE vector_map (
  profile_id TEXT NOT NULL,
  vector_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, vector_id)
);
