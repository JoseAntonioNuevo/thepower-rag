import { describe, expect, it } from "vite-plus/test";
import { contentManifestKey, indexConfigReceiptKey, profileManifestKey } from "./ids";
import {
  applyActiveSelection,
  runIngestion,
  type CatalogSnapshot,
  type CorpusManifest,
  type IngestJournalItem,
  type IngestPorts,
  type VisibleVector,
} from "./ingest";
import { activeSelectionSql, sqlLiteral } from "./sql";

function manifest(profileId = "p0123456789ab"): CorpusManifest {
  return {
    kind: "profile",
    contentVersion: "c0123456789ab",
    preparationId: "c0123456789ab",
    verifiedDate: "2026-10-03",
    profileId,
    embeddingModel: "@cf/baai/bge-m3",
    dimensions: 2,
    metric: "cosine",
    family: "workers-ai",
    providerRevision: null,
    chunkMaxChars: 900,
    chunkOverlap: 80,
    contentManifestKey: contentManifestKey("c0123456789ab"),
    documents: [
      {
        id: "nota",
        title: "Nota",
        audience: "program",
        session: "S1",
        sourcePath: "nota.md",
        sourceHash: "abc",
        body: "# Nota\n\nTexto de prueba.",
      },
    ],
    chunks: [
      {
        chunkId: "c0123456789ab:nota:00",
        vectorId: "c0123456789ab:nota:00",
        documentId: "nota",
        section: "Nota",
        text: "Texto de prueba.",
        ordinal: 0,
      },
      {
        chunkId: "c0123456789ab:nota:01",
        vectorId: "c0123456789ab:nota:01",
        documentId: "nota",
        section: "Nota",
        text: "Segundo fragmento.",
        ordinal: 1,
      },
    ],
    remoteRevision: null,
  };
}

function ports(options?: {
  fail?: boolean;
  indexes?: string[];
  visible?: boolean;
  metric?: string | null;
  dimensions?: number | null;
  vectorCount?: number | null;
  wrongIds?: boolean;
  onUpsert?: () => void;
  onRead?: () => void;
}): IngestPorts & { objects: Map<string, string>; persisted: IngestJournalItem[] } {
  const objects = new Map<string, string>();
  const stored = new Map<string, VisibleVector["metadata"]>();
  const persisted: IngestJournalItem[] = [];
  let catalog: CatalogSnapshot | null = null;
  let mutations = 0;
  const current = manifest();
  return {
    objects,
    persisted,
    getObject: async (key) => objects.get(key) ?? null,
    putObject: async (key, body) => {
      if (options?.fail === true && key.endsWith("nota.md")) {
        throw new Error("fallo de prueba");
      }
      objects.set(key, body);
    },
    writeCatalog: async (written) => {
      catalog = {
        documents: written.documents.map((document) => ({
          id: document.id,
          title: document.title,
          audience: document.audience,
          sourceHash: document.sourceHash,
        })),
        chunks: written.chunks.map((chunk) => ({
          chunkId: chunk.chunkId,
          documentId: chunk.documentId,
          text: chunk.text,
          ordinal: chunk.ordinal,
        })),
        mappings: written.chunks.map((chunk) => ({
          vectorId: chunk.vectorId,
          chunkId: chunk.chunkId,
        })),
      };
    },
    readCatalog: async () => catalog,
    listMetadataIndexes: async () => options?.indexes ?? ["corpusVersion", "audience", "profileId"],
    upsertVectors: async (batch) => {
      options?.onUpsert?.();
      mutations += 1;
      for (const vector of batch) {
        stored.set(vector.id, vector.metadata);
      }
      return { mutationId: `mut-${String(mutations)}` };
    },
    readVectors: async (ids) => {
      options?.onRead?.();
      if (options?.visible === false) {
        return [];
      }
      if (options?.wrongIds === true) {
        return ids.map((id) => ({ id: `otro-${id}`, metadata: stored.get(id) ?? null }));
      }
      return ids
        .filter((id) => stored.has(id))
        .map((id) => ({ id, metadata: stored.get(id) ?? null }));
    },
    describeIndex: async () => ({
      name: "thepower-ai-course-rag-0123456789ab",
      dimensions: options?.dimensions === undefined ? current.dimensions : options.dimensions,
      metric: options?.metric === undefined ? "cosine" : options.metric,
      vectorCount:
        options?.vectorCount === undefined
          ? options?.visible === false
            ? 0
            : stored.size
          : options.vectorCount,
    }),
    persistJournal: async (item) => {
      persisted.push(item);
    },
    recordPhase: async () => undefined,
  };
}

describe("ingesta", () => {
  it("escribe manifiestos distintos y solo queda lista con lectura de vuelta", async () => {
    const current = manifest();
    const memory = ports();
    const result = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    expect(result.phase).toBe("ready");
    const profileKey = profileManifestKey(current.preparationId, current.profileId);
    const body = memory.objects.get(profileKey) ?? "";
    expect(body).toContain(current.profileId);
    expect(body).not.toBe(current.preparationId);
    expect(memory.objects.has(`corpus/${current.preparationId}/manifest.json`)).toBe(false);
    expect(memory.objects.get(contentManifestKey(current.preparationId))).toContain(
      '"kind":"content"',
    );
    expect(
      memory.objects.get(indexConfigReceiptKey(current.preparationId, current.profileId)),
    ).toContain('"metric":"cosine"');
    expect(memory.persisted.some((item) => item.key === "catalog" && item.ok)).toBe(true);
  });

  it("no pisa el manifiesto de otro perfil del mismo contenido", async () => {
    const first = manifest("p0123456789ab");
    const second = manifest("pba9876543210");
    second.dimensions = 4;
    second.embeddingModel = "@cf/baai/bge-m3";
    const memory = ports();
    await runIngestion({
      manifest: first,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    const firstBody = memory.objects.get(profileManifestKey(first.preparationId, first.profileId));
    const content = memory.objects.get(contentManifestKey(first.preparationId));
    await runIngestion({
      manifest: second,
      vectors: [
        [0.1, 0.2, 0.3, 0.4],
        [0.2, 0.2, 0.2, 0.2],
      ],
      ports: {
        ...memory,
        describeIndex: async () => ({
          name: null,
          dimensions: 4,
          metric: "cosine",
          vectorCount: 2,
        }),
      },
    });
    expect(memory.objects.get(profileManifestKey(first.preparationId, first.profileId))).toBe(
      firstBody,
    );
    expect(memory.objects.get(contentManifestKey(first.preparationId))).toBe(content);
    expect(
      memory.objects.get(profileManifestKey(second.preparationId, second.profileId)),
    ).toContain(second.profileId);
  });

  it("deja la visibilidad pendiente y la siguiente lectura no reinserta", async () => {
    const current = manifest();
    let visible = false;
    let upserts = 0;
    const memory = ports({
      visible: false,
      metric: null,
      dimensions: null,
      vectorCount: 0,
      onUpsert: () => {
        upserts += 1;
      },
    });
    const waiting = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
      upsertBatchSize: 1,
    });
    expect(waiting.phase).toBe("pending-visibility");
    expect(waiting.journal.some((item) => item.outcome === "failed")).toBe(false);
    expect(upserts).toBe(2);
    const mutations = waiting.journal
      .filter((item) => item.key.startsWith("vectors:batch:"))
      .map((item) => item.mutationId);
    expect(mutations).toEqual(["mut-1", "mut-2"]);
    visible = true;
    const resumed = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      journal: waiting.journal,
      ports: {
        ...memory,
        readVectors: async (ids) => {
          expect(visible).toBe(true);
          return ids.map((id) => ({
            id,
            metadata: {
              corpusVersion: current.preparationId,
              audience: "program",
              profileId: current.profileId,
            },
          }));
        },
        describeIndex: async () => ({
          name: null,
          dimensions: 2,
          metric: "cosine",
          vectorCount: 2,
        }),
      },
      upsertBatchSize: 1,
    });
    expect(resumed.phase).toBe("ready");
    expect(upserts).toBe(2);
  });

  it("un perfil activo no se reescribe al consultar el estado", async () => {
    let writes = 0;
    let phases = 0;
    const memory = ports();
    const result = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      journal: [
        {
          store: "r2",
          versionId: "c0123456789ab",
          profileId: "p0123456789ab",
          key: "ya",
          outcome: "succeeded",
          ok: true,
          error: null,
          mutationId: null,
        },
      ],
      ports: {
        ...memory,
        putObject: async () => {
          writes += 1;
        },
        recordPhase: async () => {
          phases += 1;
        },
      },
      profileIsActive: true,
    });
    expect(writes).toBe(0);
    expect(phases).toBe(0);
    expect(result.phase).not.toBe("ready");
  });

  it("distingue un fallo de un resultado vacío y no toca otra versión", async () => {
    const current = manifest();
    const memory = ports({ fail: true });
    memory.objects.set("corpus/otra/documents/nota.md", "version anterior");
    const failed = await runIngestion({
      manifest: current,
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    expect(failed.phase).toBe("failed");
    expect(
      failed.journal.some((item) => item.outcome === "failed" && item.error === "r2-write-failed"),
    ).toBe(true);
    expect(memory.objects.get("corpus/otra/documents/nota.md")).toBe("version anterior");
    const empty = manifest();
    empty.documents = [];
    empty.chunks = [];
    const blank = await runIngestion({ manifest: empty, vectors: [], ports: ports() });
    expect(blank.phase).toBe("failed");
  });

  it("no inserta vectores si faltan los índices de metadatos", async () => {
    let upserts = 0;
    const memory = ports({
      indexes: [],
      onUpsert: () => {
        upserts += 1;
      },
    });
    const result = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: memory,
    });
    expect(upserts).toBe(0);
    expect(result.phase).toBe("failed");
    expect(result.journal.some((item) => item.error === "metadata-indexes-missing")).toBe(true);
  });

  it("rechaza métrica distinta, metadatos incongruentes y un recuento que no identifica", async () => {
    const metric = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: ports({ metric: "euclidean" }),
    });
    expect(metric.phase).toBe("failed");
    expect(metric.journal.some((item) => item.error === "index-metric-mismatch")).toBe(true);
    const mismatch = await runIngestion({
      manifest: manifest(),
      vectors: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
      ports: ports({ wrongIds: true, vectorCount: 2 }),
    });
    expect(mismatch.phase).toBe("failed");
    expect(mismatch.journal.some((item) => item.error === "vectorize-id-mismatch")).toBe(true);
  });

  it("conserva el perfil activo si el pedido no está listo", () => {
    const profiles = [
      { id: "p0123456789ab", status: "ready" as const, active: true },
      { id: "pba9876543210", status: "failed" as const, active: false },
    ];
    expect(applyActiveSelection(profiles, "pba9876543210")).toEqual(profiles);
    const sql = activeSelectionSql("pba9876543210");
    expect(sql).toContain("status = 'ready'");
    expect(sql).not.toContain("DELETE");
    expect(sqlLiteral("'); DROP TABLE documents; --")).toBe("'''); DROP TABLE documents; --'");
  });
});
