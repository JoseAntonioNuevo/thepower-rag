import { LIMITS, type Audience } from "@thepower-rag/contracts";
import type { ChunkRecord, RetrievalHit, RetrievalQuery } from "@thepower-rag/core";

export interface VectorMatch {
  id: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface VectorIndex {
  query(
    vector: number[],
    options: {
      topK: number;
      returnMetadata: "all";
      filter: {
        corpusVersion: string;
        profileId: string;
        audience: { $in: string[] };
      };
    },
  ): Promise<{ matches: VectorMatch[] }>;
  upsert(
    vectors: { id: string; values: number[]; metadata: Record<string, string> }[],
  ): Promise<{ mutationId?: string }>;
}

export function audienceFilter(audience: Audience): string[] {
  return audience === "program" ? ["program"] : ["program", audience];
}

export async function queryVectorize(
  index: VectorIndex,
  query: RetrievalQuery & { profileId: string },
  signal: AbortSignal,
  timeoutMs: number = LIMITS.retrievalTimeoutMs,
): Promise<RetrievalHit[]> {
  if (signal.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      index.query([...query.vector], {
        topK: query.limit,
        returnMetadata: "all",
        filter: {
          corpusVersion: query.corpusVersion,
          profileId: query.profileId,
          audience: { $in: audienceFilter(query.audience) },
        },
      }),
      new Promise<never>((_, reject) => {
        onAbort = () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("retrieval-timeout"));
        }, timeoutMs);
      }),
    ]);
    return result.matches.map((match) => ({
      chunkId: match.id,
      score: typeof match.score === "number" && Number.isFinite(match.score) ? match.score : null,
    }));
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

export interface SqlStatement {
  bind(...values: unknown[]): { first<T>(): Promise<T | null> };
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
}

const CHUNK_SQL = `SELECT chunks.chunk_id AS chunkId, chunks.document_id AS documentId,
  documents.title AS title, chunks.section AS section, chunks.text AS text,
  documents.audience AS audience, chunks.version_id AS corpusVersion
  FROM chunks
  JOIN documents ON documents.version_id = chunks.version_id AND documents.document_id = chunks.document_id
  WHERE chunks.version_id = ? AND chunks.chunk_id = ?`;

export async function readChunk(
  database: SqlDatabase,
  corpusVersion: string,
  chunkId: string,
): Promise<ChunkRecord | null> {
  const row = await database.prepare(CHUNK_SQL).bind(corpusVersion, chunkId).first<ChunkRecord>();
  if (row === null) {
    return null;
  }
  if (row.corpusVersion !== corpusVersion || row.chunkId !== chunkId) {
    return null;
  }
  if (row.audience !== "program" && row.audience !== "L/X" && row.audience !== "M/J") {
    return null;
  }
  return row;
}

export interface ObjectBucket {
  put(key: string, body: string | Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export {
  contentManifestKey as manifestObjectKey,
  documentObjectKey as corpusObjectKey,
  indexConfigReceiptKey,
  profileManifestKey,
} from "@thepower-rag/core";

export interface IndexProfileRow {
  id: string;
  corpusVersion: string;
  embeddingModel: string;
  dimensions: number;
  metric: string;
  family: string;
  status: string;
  providerRevision: string | null;
}

const PROFILE_SQL = `SELECT id, corpus_version AS corpusVersion, embedding_model AS embeddingModel,
  dimensions, metric, family, status, provider_revision AS providerRevision
  FROM index_profiles
  WHERE id = ? AND corpus_version = ?`;

export async function readIndexProfile(
  database: SqlDatabase,
  profileId: string,
  corpusVersion: string,
): Promise<IndexProfileRow | null> {
  const row = await database
    .prepare(PROFILE_SQL)
    .bind(profileId, corpusVersion)
    .first<IndexProfileRow>();
  if (row === null || row.id !== profileId || row.corpusVersion !== corpusVersion) {
    return null;
  }
  return row;
}

export function profileReady(
  row: IndexProfileRow | null,
  expected: {
    embeddingModel: string;
    dimensions: number;
    corpusVersion: string;
    indexProfile: string;
    metric: "cosine";
  },
): { ok: true } | { ok: false; missing: string[] } {
  if (row === null) {
    return { ok: false, missing: ["INDEX_PROFILE"] };
  }
  const missing: string[] = [];
  if (row.status !== "ready") {
    missing.push("INDEX_PROFILE");
  }
  if (row.family !== "workers-ai") {
    missing.push("INDEX_PROFILE");
  }
  if (row.embeddingModel !== expected.embeddingModel) {
    missing.push("EMBEDDING_MODEL");
  }
  if (row.dimensions !== expected.dimensions) {
    missing.push("EMBEDDING_DIMENSIONS");
  }
  if (row.corpusVersion !== expected.corpusVersion) {
    missing.push("CORPUS_VERSION");
  }
  if (row.id !== expected.indexProfile) {
    missing.push("INDEX_PROFILE");
  }
  if (row.metric !== expected.metric) {
    missing.push("VECTOR_METRIC");
  }
  const unique = [...new Set(missing)];
  return unique.length === 0 ? { ok: true } : { ok: false, missing: unique };
}
