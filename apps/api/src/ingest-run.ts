import { corpusObjectKey, type ObjectBucket, type SqlDatabase } from "./stores";
import {
  runIngestion,
  UNVERIFIED_METRIC,
  type CatalogSnapshot,
  type CorpusManifest,
  type IngestJournalItem,
  type IngestionPhase,
  type VectorWrite,
  type VisibleVector,
} from "@thepower-rag/core";

interface CatalogDatabase extends SqlDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown>;
}

interface VectorBinding {
  upsert(vectors: VectorWrite[]): Promise<{ mutationId?: string }>;
  getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, unknown> }[]>;
  describe(): Promise<{ dimensions?: number; vectorCount?: number }>;
}

export interface IngestBindings {
  CORPUS: ObjectBucket;
  DB: CatalogDatabase;
  VECTORIZE: VectorBinding;
  listMetadataIndexes(): Promise<readonly string[]>;
}

function textValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function visibleFromBinding(vector: {
  id: string;
  metadata?: Record<string, unknown>;
}): VisibleVector {
  const metadata = vector.metadata;
  const corpusVersion = textValue(metadata?.corpusVersion);
  const audience = textValue(metadata?.audience);
  const profileId = textValue(metadata?.profileId);
  if (corpusVersion === null || audience === null || profileId === null) {
    return { id: vector.id, metadata: null };
  }
  return { id: vector.id, metadata: { corpusVersion, audience, profileId } };
}

export async function runBoundIngestion(
  bindings: IngestBindings,
  manifest: CorpusManifest,
  vectors: readonly (readonly number[])[] | null,
  journal: readonly IngestJournalItem[] = [],
  observed: {
    metric: string | null;
    reportedName: string | null;
    expectedIndexName: string | null;
  } = {
    metric: null,
    reportedName: null,
    expectedIndexName: null,
  },
): Promise<{ phase: IngestionPhase; journal: IngestJournalItem[]; mutationId: string | null }> {
  return runIngestion({
    manifest,
    vectors,
    journal,
    expectedIndexName: observed.expectedIndexName,
    getBatchSize: 20,
    ports: {
      getObject: async (key) => {
        const object = await bindings.CORPUS.get(key);
        return object === null ? null : object.text();
      },
      putObject: async (key, body) => {
        await bindings.CORPUS.put(key, body);
      },
      writeCatalog: async (current) => {
        const statements = [
          bindings.DB.prepare(
            `INSERT INTO corpus_versions (id, embedding_model, dimensions, remote_revision, status)
             VALUES (?, ?, ?, ?, 'catalog')
             ON CONFLICT(id) DO UPDATE SET
               embedding_model = excluded.embedding_model,
               dimensions = excluded.dimensions,
               remote_revision = excluded.remote_revision`,
          ).bind(
            current.preparationId,
            current.embeddingModel,
            current.dimensions,
            current.providerRevision,
          ),
          bindings.DB.prepare(
            `INSERT INTO index_profiles (
               id, corpus_version, embedding_model, dimensions, metric, chunk_max_chars,
               chunk_overlap, provider_revision, family, status, expected_vectors, active
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, 0)
             ON CONFLICT(id) DO UPDATE SET
               corpus_version = excluded.corpus_version,
               embedding_model = excluded.embedding_model,
               dimensions = excluded.dimensions,
               metric = excluded.metric,
               chunk_max_chars = excluded.chunk_max_chars,
               chunk_overlap = excluded.chunk_overlap,
               provider_revision = excluded.provider_revision,
               family = excluded.family,
               expected_vectors = excluded.expected_vectors,
               status = CASE WHEN index_profiles.active = 1 THEN index_profiles.status ELSE excluded.status END`,
          ).bind(
            current.profileId,
            current.preparationId,
            current.embeddingModel,
            current.dimensions,
            UNVERIFIED_METRIC,
            current.chunkMaxChars,
            current.chunkOverlap,
            current.providerRevision,
            current.family,
            current.chunks.length,
          ),
        ];
        for (const document of current.documents) {
          statements.push(
            bindings.DB.prepare(
              `INSERT INTO documents (version_id, document_id, title, audience, source_hash)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(version_id, document_id) DO UPDATE SET
                 title = excluded.title, audience = excluded.audience, source_hash = excluded.source_hash`,
            ).bind(
              current.preparationId,
              document.id,
              document.title,
              document.audience,
              document.sourceHash,
            ),
          );
        }
        for (const chunk of current.chunks) {
          statements.push(
            bindings.DB.prepare(
              `INSERT INTO chunks (version_id, chunk_id, document_id, section, text, ordinal)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(version_id, chunk_id) DO UPDATE SET
                 document_id = excluded.document_id, section = excluded.section,
                 text = excluded.text, ordinal = excluded.ordinal`,
            ).bind(
              current.preparationId,
              chunk.chunkId,
              chunk.documentId,
              chunk.section,
              chunk.text,
              chunk.ordinal,
            ),
            bindings.DB.prepare(
              `INSERT INTO vector_map (profile_id, vector_id, chunk_id) VALUES (?, ?, ?)
               ON CONFLICT(profile_id, vector_id) DO UPDATE SET chunk_id = excluded.chunk_id`,
            ).bind(current.profileId, chunk.vectorId, chunk.chunkId),
          );
        }
        await bindings.DB.batch(statements);
      },
      readCatalog: async (versionId, profileId) => {
        const documents = await bindings.DB.prepare(
          `SELECT document_id AS id, title, audience, source_hash AS sourceHash
           FROM documents WHERE version_id = ?`,
        )
          .bind(versionId)
          .all<CatalogSnapshot["documents"][number]>();
        const chunks = await bindings.DB.prepare(
          `SELECT chunk_id AS chunkId, document_id AS documentId, text, ordinal
           FROM chunks WHERE version_id = ?`,
        )
          .bind(versionId)
          .all<CatalogSnapshot["chunks"][number]>();
        const mappings = await bindings.DB.prepare(
          `SELECT vector_id AS vectorId, chunk_id AS chunkId
           FROM vector_map WHERE profile_id = ?`,
        )
          .bind(profileId)
          .all<CatalogSnapshot["mappings"][number]>();
        return {
          documents: documents.results,
          chunks: chunks.results,
          mappings: mappings.results,
        };
      },
      listMetadataIndexes: () => bindings.listMetadataIndexes(),
      upsertVectors: async (batch) => {
        const result = await bindings.VECTORIZE.upsert([...batch]);
        return { mutationId: result.mutationId ?? null };
      },
      readVectors: async (ids) => {
        const found = await bindings.VECTORIZE.getByIds([...ids]);
        return found.map((vector) => visibleFromBinding(vector));
      },
      describeIndex: async () => {
        const info = (await bindings.VECTORIZE.describe()) as {
          dimensions?: number;
          vectorCount?: number;
          config?: { metric?: string };
        };
        const bindingMetric =
          info.config !== undefined && typeof info.config.metric === "string"
            ? info.config.metric
            : null;
        return {
          name: observed.reportedName,
          dimensions: typeof info.dimensions === "number" ? info.dimensions : null,
          metric: bindingMetric ?? observed.metric,
          vectorCount: typeof info.vectorCount === "number" ? info.vectorCount : null,
        };
      },
      persistJournal: async (item) => {
        await bindings.DB.prepare(
          `INSERT INTO ingest_items (
             corpus_version, profile_id, store, item_key, ok, error, outcome, mutation_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(corpus_version, profile_id, store, item_key) DO UPDATE SET
             ok = excluded.ok,
             error = excluded.error,
             outcome = excluded.outcome,
             mutation_id = excluded.mutation_id`,
        )
          .bind(
            item.versionId,
            item.profileId,
            item.store,
            item.key,
            item.ok ? 1 : 0,
            item.error,
            item.outcome,
            item.mutationId,
          )
          .run();
      },
      recordPhase: async (update) => {
        await bindings.DB.prepare(
          `UPDATE index_profiles
           SET status = ?, mutation_id = ?, last_error = ?,
               metric = CASE WHEN ? IS NULL THEN metric ELSE ? END,
               visible_vectors = CASE WHEN ? = 'ready' THEN expected_vectors ELSE NULL END
           WHERE id = ? AND active = 0`,
        )
          .bind(
            update.phase,
            update.mutationId,
            update.lastError,
            update.observedMetric,
            update.observedMetric,
            update.phase,
            manifest.profileId,
          )
          .run();
      },
    },
  });
}

export async function loadBoundJournal(
  database: CatalogDatabase,
  versionId: string,
  profileId: string,
): Promise<IngestJournalItem[]> {
  const rows = await database
    .prepare(
      `SELECT store, item_key AS itemKey, ok, error, outcome, mutation_id AS mutationId
       FROM ingest_items
       WHERE corpus_version = ? AND profile_id = ?`,
    )
    .bind(versionId, profileId)
    .all<{
      store: string;
      itemKey: string;
      ok: number;
      error: string | null;
      outcome: string | null;
      mutationId: string | null;
    }>();
  return rows.results.flatMap((row) => {
    if (row.store !== "r2" && row.store !== "d1" && row.store !== "vectorize") {
      return [];
    }
    const outcome =
      row.outcome === "succeeded" || row.outcome === "pending" || row.outcome === "failed"
        ? row.outcome
        : row.ok === 1
          ? "succeeded"
          : "failed";
    return [
      {
        store: row.store,
        versionId,
        profileId,
        key: row.itemKey,
        outcome,
        ok: outcome === "succeeded",
        error: row.error,
        mutationId: row.mutationId,
      },
    ];
  });
}

export { corpusObjectKey };
