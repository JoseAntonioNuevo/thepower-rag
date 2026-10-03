import {
  VECTORIZE_METADATA_INDEXES,
  applyActiveSelection,
  type CorpusManifest,
} from "@thepower-rag/core";
import { loadBoundJournal, runBoundIngestion, type IngestBindings } from "./ingest-run";

type Row = Record<string, unknown>;

interface MemoryTables {
  corpus_versions: Row[];
  documents: Row[];
  chunks: Row[];
  vector_map: Row[];
  index_profiles: Row[];
  ingest_items: Row[];
}

function replace(rows: Row[], keys: string[], next: Row): void {
  const index = rows.findIndex((row) => keys.every((key) => row[key] === next[key]));
  if (index === -1) {
    rows.push(next);
    return;
  }
  rows[index] = { ...rows[index], ...next };
}

export interface MemoryBindings extends IngestBindings {
  tables: MemoryTables;
  upserts: number;
  reads: number;
}

export function createMemoryBindings(input?: {
  dimensions?: number;
  metadataIndexes?: readonly string[];
  visibleAfterReads?: number;
}): MemoryBindings {
  const tables: MemoryTables = {
    corpus_versions: [],
    documents: [],
    chunks: [],
    vector_map: [],
    index_profiles: [],
    ingest_items: [],
  };
  const vectors = new Map<string, { values: number[]; metadata?: Record<string, unknown> }>();
  const metadataIndexes = [...(input?.metadataIndexes ?? VECTORIZE_METADATA_INDEXES)];
  const visibleAfterReads = input?.visibleAfterReads ?? 1;
  let upserts = 0;
  let reads = 0;
  let mutation = 0;
  const objects = new Map<string, string>();

  const apply = (sql: string, values: readonly unknown[]) => {
    if (sql.includes("INSERT INTO corpus_versions")) {
      replace(tables.corpus_versions, ["id"], {
        id: values[0],
        embedding_model: values[1],
        dimensions: values[2],
        remote_revision: values[3],
        status: "catalog",
      });
      return;
    }
    if (sql.includes("INSERT INTO index_profiles")) {
      const existing = tables.index_profiles.find((row) => row.id === values[0]);
      replace(tables.index_profiles, ["id"], {
        id: values[0],
        corpus_version: values[1],
        embedding_model: values[2],
        dimensions: values[3],
        metric: values[4],
        chunk_max_chars: values[5],
        chunk_overlap: values[6],
        provider_revision: values[7],
        family: values[8],
        status: existing?.active === 1 ? existing.status : "partial",
        expected_vectors: values[9],
        visible_vectors: existing?.visible_vectors ?? null,
        mutation_id: existing?.mutation_id ?? null,
        last_error: existing?.last_error ?? null,
        active: existing?.active ?? 0,
      });
      return;
    }
    if (sql.includes("INSERT INTO documents")) {
      replace(tables.documents, ["version_id", "document_id"], {
        version_id: values[0],
        document_id: values[1],
        title: values[2],
        audience: values[3],
        source_hash: values[4],
      });
      return;
    }
    if (sql.includes("INSERT INTO chunks")) {
      replace(tables.chunks, ["version_id", "chunk_id"], {
        version_id: values[0],
        chunk_id: values[1],
        document_id: values[2],
        section: values[3],
        text: values[4],
        ordinal: values[5],
      });
      return;
    }
    if (sql.includes("INSERT INTO vector_map")) {
      replace(tables.vector_map, ["profile_id", "vector_id"], {
        profile_id: values[0],
        vector_id: values[1],
        chunk_id: values[2],
      });
      return;
    }
    if (sql.includes("INSERT INTO ingest_items")) {
      replace(tables.ingest_items, ["corpus_version", "profile_id", "store", "item_key"], {
        corpus_version: values[0],
        profile_id: values[1],
        store: values[2],
        item_key: values[3],
        ok: values[4],
        error: values[5],
        outcome: values[6],
        mutation_id: values[7],
      });
      return;
    }
    if (sql.includes("UPDATE index_profiles")) {
      const phase = values[0];
      const id = values[6];
      const row = tables.index_profiles.find((item) => item.id === id && item.active !== 1);
      if (row === undefined) {
        return;
      }
      row.status = phase;
      row.mutation_id = values[1];
      row.last_error = values[2];
      if (values[3] !== null) {
        row.metric = values[4];
      }
      row.visible_vectors = phase === "ready" ? row.expected_vectors : null;
    }
  };

  const query = (sql: string, values: readonly unknown[]): Row[] => {
    if (sql.includes("FROM documents")) {
      return tables.documents
        .filter((row) => row.version_id === values[0])
        .map((row) => ({
          id: row.document_id,
          title: row.title,
          audience: row.audience,
          sourceHash: row.source_hash,
        }));
    }
    if (sql.includes("FROM chunks")) {
      return tables.chunks
        .filter((row) => row.version_id === values[0])
        .map((row) => ({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          text: row.text,
          ordinal: row.ordinal,
        }));
    }
    if (sql.includes("FROM vector_map")) {
      return tables.vector_map
        .filter((row) => row.profile_id === values[0])
        .map((row) => ({ vectorId: row.vector_id, chunkId: row.chunk_id }));
    }
    if (sql.includes("FROM ingest_items")) {
      return tables.ingest_items
        .filter((row) => row.corpus_version === values[0] && row.profile_id === values[1])
        .map((row) => ({
          store: row.store,
          itemKey: row.item_key,
          ok: row.ok,
          error: row.error,
          outcome: row.outcome,
          mutationId: row.mutation_id,
        }));
    }
    if (sql.includes("FROM index_profiles")) {
      return tables.index_profiles.map((row) => ({
        id: row.id,
        status: row.status,
        active: row.active,
      }));
    }
    return [];
  };

  const prepare = (sql: string) => ({
    bind(...values: unknown[]) {
      return {
        run: async () => {
          apply(sql, values);
          return {};
        },
        all: async <T>() => ({ results: query(sql, values) as T[] }),
        first: async <T>() => (query(sql, values)[0] as T | undefined) ?? null,
      };
    },
  });

  const bindings: MemoryBindings = {
    tables,
    get upserts() {
      return upserts;
    },
    get reads() {
      return reads;
    },
    CORPUS: {
      async put(key, body) {
        objects.set(key, typeof body === "string" ? body : new TextDecoder().decode(body));
      },
      async get(key) {
        const body = objects.get(key);
        return body === undefined ? null : { text: async () => body };
      },
    },
    DB: {
      prepare,
      batch: async (statements) => {
        for (const statement of statements) {
          await (statement as { run(): Promise<unknown> }).run();
        }
      },
    },
    VECTORIZE: {
      async upsert(batch) {
        upserts += 1;
        for (const vector of batch) {
          vectors.set(vector.id, { values: [...vector.values], metadata: { ...vector.metadata } });
        }
        mutation += 1;
        return { mutationId: `mut-${String(mutation)}` };
      },
      async getByIds(ids) {
        reads += 1;
        if (reads < visibleAfterReads) {
          return [];
        }
        return ids.flatMap((id) => {
          const found = vectors.get(id);
          return found === undefined ? [] : [{ id, metadata: found.metadata }];
        });
      },
      async describe() {
        return {
          dimensions: input?.dimensions,
          vectorCount: vectors.size,
        };
      },
    },
    listMetadataIndexes: async () => metadataIndexes,
  };
  return bindings;
}

export async function readProfileRows(
  bindings: MemoryBindings,
): Promise<{ id: string; status: string; active: boolean }[]> {
  const rows = await bindings.DB.prepare("SELECT id, status, active FROM index_profiles")
    .bind()
    .all<{ id: string; status: string; active: number }>();
  return rows.results.map((row) => ({
    id: row.id,
    status: row.status,
    active: row.active === 1,
  }));
}

export async function writeProfileRows(
  bindings: MemoryBindings,
  profiles: readonly { id: string; status: string; active: boolean }[],
): Promise<void> {
  for (const profile of profiles) {
    const row = bindings.tables.index_profiles.find((item) => item.id === profile.id);
    if (row !== undefined) {
      row.active = profile.active ? 1 : 0;
      row.status = profile.status;
    }
  }
}

export function createMemoryDataPlane(input: {
  bindings: MemoryBindings;
  management: {
    metric: string | null;
    dimensions: number | null;
    name: string | null;
    metadataIndexes: readonly string[];
  };
  embed(texts: readonly string[]): Promise<{
    vectors: number[][];
    providerRevision: string | null;
  }>;
}) {
  const adapter = {
    id: "memory-tables" as const,
    remote: false,
    binding: null,
  };
  return {
    management: input.management,
    adapters: () => [adapter, { id: "fixture-embedder" as const, remote: false, binding: null }],
    async embed(texts: readonly string[], reservationId: string) {
      if (!/^r[0-9]+$/.test(reservationId)) {
        throw new Error("Falta la reserva.");
      }
      const embedded = await input.embed(texts);
      return {
        ...embedded,
        adapter: { id: "fixture-embedder" as const, remote: false, binding: null },
      };
    },
    async ingest(request: { manifest: CorpusManifest; vectors: number[][] }) {
      const profiles = await readProfileRows(input.bindings);
      if (profiles.some((profile) => profile.id === request.manifest.profileId && profile.active)) {
        return { phase: "failed", upserts: 0, profileId: request.manifest.profileId, adapter };
      }
      const journal = await loadBoundJournal(
        input.bindings.DB as Parameters<typeof loadBoundJournal>[0],
        request.manifest.preparationId,
        request.manifest.profileId,
      );
      const before = input.bindings.upserts;
      let result = await runBoundIngestion(
        input.bindings,
        request.manifest,
        request.vectors,
        journal,
        {
          metric: input.management.metric,
          reportedName: input.management.name,
          expectedIndexName: input.management.name,
        },
      );
      let polls = 0;
      while (result.phase === "pending-visibility" && polls < 2) {
        polls += 1;
        result = await runBoundIngestion(
          input.bindings,
          request.manifest,
          request.vectors,
          result.journal,
          {
            metric: input.management.metric,
            reportedName: input.management.name,
            expectedIndexName: input.management.name,
          },
        );
      }
      return {
        phase: result.phase,
        upserts: input.bindings.upserts - before,
        profileId: request.manifest.profileId,
        adapter,
      };
    },
    async selectActive(profileId: string) {
      const before = await readProfileRows(input.bindings);
      const next = applyActiveSelection(
        before.map((profile) => ({
          ...profile,
          status: profile.status as
            | "ready"
            | "partial"
            | "pending-visibility"
            | "failed"
            | "planned",
        })),
        profileId,
      );
      await writeProfileRows(input.bindings, next);
      const after = await readProfileRows(input.bindings);
      const active = after.find((profile) => profile.active);
      const requested = before.find((profile) => profile.id === profileId);
      if (requested === undefined || requested.status !== "ready") {
        return {
          ok: false,
          summary: "La versión pedida no está lista. La versión activa no cambia.",
          activeId: active?.id ?? null,
          adapter,
        };
      }
      if (active?.id !== profileId) {
        return {
          ok: false,
          summary: "La lectura final no prueba el perfil activo.",
          activeId: active?.id ?? null,
          adapter,
        };
      }
      return {
        ok: true,
        summary: "perfil activo comprobado por lectura final",
        activeId: active.id,
        adapter,
      };
    },
  };
}
