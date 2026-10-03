import type { Audience } from "@thepower-rag/contracts";
import {
  contentManifestKey,
  documentObjectKey,
  indexConfigReceiptKey,
  profileManifestKey,
  VECTORIZE_GET_BATCH,
  VECTORIZE_METADATA_INDEXES,
  VECTORIZE_UPSERT_BATCH,
  utf8Bytes,
  VECTOR_ID_MAX_BYTES,
} from "./ids";
import type { PreparedCorpus } from "./prepare";

export type StoreName = "r2" | "d1" | "vectorize";
export type IngestionPhase = "planned" | "partial" | "pending-visibility" | "ready" | "failed";
export type JournalOutcome = "succeeded" | "pending" | "failed";

export interface IngestJournalItem {
  store: StoreName;
  versionId: string;
  profileId: string;
  key: string;
  outcome: JournalOutcome;
  ok: boolean;
  error: string | null;
  mutationId: string | null;
}

export interface CorpusManifest {
  kind: "profile";
  contentVersion: string;
  preparationId: string;
  verifiedDate: string;
  profileId: string;
  embeddingModel: string;
  dimensions: number;
  metric: "cosine";
  family: "fixture" | "workers-ai";
  providerRevision: string | null;
  chunkMaxChars: number;
  chunkOverlap: number;
  contentManifestKey: string;
  documents: {
    id: string;
    title: string;
    audience: Audience;
    session: string | null;
    sourcePath: string;
    sourceHash: string;
    body: string;
  }[];
  chunks: {
    chunkId: string;
    vectorId: string;
    documentId: string;
    section: string;
    text: string;
    ordinal: number;
  }[];
  remoteRevision: null;
}

export interface ContentManifest {
  kind: "content";
  contentVersion: string;
  preparationId: string;
  verifiedDate: string;
  documents: CorpusManifest["documents"];
  chunks: CorpusManifest["chunks"];
}

export interface VisibleVector {
  id: string;
  metadata: { corpusVersion: string; audience: string; profileId: string } | null;
}

export interface IndexDescription {
  name: string | null;
  dimensions: number | null;
  metric: string | null;
  vectorCount: number | null;
}

export interface CatalogSnapshot {
  documents: { id: string; title: string; audience: string; sourceHash: string }[];
  chunks: { chunkId: string; documentId: string; text: string; ordinal: number }[];
  mappings: { vectorId: string; chunkId: string }[];
}

export interface IngestEvidence {
  versionId: string;
  profileId: string;
  expectedDocuments: number;
  expectedChunks: number;
  journal: readonly IngestJournalItem[];
}

export function manifestFrom(corpus: PreparedCorpus): CorpusManifest {
  return {
    kind: "profile",
    contentVersion: corpus.contentVersion,
    preparationId: corpus.preparationId,
    verifiedDate: corpus.verifiedDate,
    profileId: corpus.indexProfile.id,
    embeddingModel: corpus.indexProfile.model,
    dimensions: corpus.indexProfile.dimensions,
    metric: corpus.indexProfile.metric,
    family: corpus.indexProfile.family,
    providerRevision: corpus.indexProfile.providerRevision,
    chunkMaxChars: corpus.indexProfile.chunkMaxChars,
    chunkOverlap: corpus.indexProfile.chunkOverlap,
    contentManifestKey: contentManifestKey(corpus.preparationId),
    documents: corpus.documents.map((document) => ({
      id: document.id,
      title: document.title,
      audience: document.audience,
      session: document.session,
      sourcePath: document.sourcePath,
      sourceHash: document.sourceHash,
      body: document.body,
    })),
    chunks: corpus.documents.flatMap((document) =>
      document.chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        vectorId: chunk.vectorId,
        documentId: document.id,
        section: chunk.section,
        text: chunk.text,
        ordinal: chunk.ordinal,
      })),
    ),
    remoteRevision: null,
  };
}

export function contentManifestFrom(manifest: CorpusManifest): ContentManifest {
  return {
    kind: "content",
    contentVersion: manifest.contentVersion,
    preparationId: manifest.preparationId,
    verifiedDate: manifest.verifiedDate,
    documents: manifest.documents,
    chunks: manifest.chunks,
  };
}

export function serializeManifest(manifest: CorpusManifest): string {
  return `${JSON.stringify(manifest)}\n`;
}

export function serializeContentManifest(manifest: ContentManifest): string {
  return `${JSON.stringify(manifest)}\n`;
}

export function journalItem(input: Omit<IngestJournalItem, "ok">): IngestJournalItem {
  return { ...input, ok: input.outcome === "succeeded" };
}

export function journalForProfile(
  items: readonly IngestJournalItem[],
  versionId: string,
  profileId: string,
): IngestJournalItem[] {
  return items.filter((item) => item.versionId === versionId && item.profileId === profileId);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const pending = new Set(right);
  return left.every((id) => pending.delete(id)) && pending.size === 0;
}

export function catalogMatches(
  manifest: CorpusManifest,
  snapshot: CatalogSnapshot | null,
): boolean {
  if (snapshot === null) {
    return false;
  }
  if (
    snapshot.documents.length !== manifest.documents.length ||
    snapshot.chunks.length !== manifest.chunks.length ||
    snapshot.mappings.length !== manifest.chunks.length
  ) {
    return false;
  }
  const documents = new Map(snapshot.documents.map((document) => [document.id, document]));
  for (const document of manifest.documents) {
    const found = documents.get(document.id);
    if (
      found === undefined ||
      found.title !== document.title ||
      found.audience !== document.audience ||
      found.sourceHash !== document.sourceHash
    ) {
      return false;
    }
  }
  const chunks = new Map(snapshot.chunks.map((chunk) => [chunk.chunkId, chunk]));
  const mappings = new Map(snapshot.mappings.map((mapping) => [mapping.vectorId, mapping.chunkId]));
  for (const chunk of manifest.chunks) {
    const found = chunks.get(chunk.chunkId);
    if (
      found === undefined ||
      found.documentId !== chunk.documentId ||
      found.text !== chunk.text ||
      found.ordinal !== chunk.ordinal ||
      mappings.get(chunk.vectorId) !== chunk.chunkId
    ) {
      return false;
    }
  }
  return true;
}

export function classifyIndexReadback(input: {
  expectedIds: readonly string[];
  visible: readonly VisibleVector[];
  expectedMetadata: ReadonlyMap<
    string,
    { corpusVersion: string; audience: string; profileId: string }
  >;
  dimensions: number | null;
  expectedDimensions: number;
  metric: string | null;
  vectorCount: number | null;
  expectedIndexName: string | null;
  indexName: string | null;
}): { outcome: JournalOutcome; error: string | null } {
  if (input.metric !== null && input.metric !== "cosine") {
    return { outcome: "failed", error: "index-metric-mismatch" };
  }
  if (input.dimensions !== null && input.dimensions !== input.expectedDimensions) {
    return { outcome: "failed", error: "index-dimension-mismatch" };
  }
  if (
    input.expectedIndexName !== null &&
    input.indexName !== null &&
    input.indexName !== input.expectedIndexName
  ) {
    return { outcome: "failed", error: "index-name-mismatch" };
  }
  const visibleIds = input.visible.map((vector) => vector.id);
  const idsReady = sameIds(visibleIds, input.expectedIds);
  if (!idsReady) {
    const expected = new Set(input.expectedIds);
    const unexpected = visibleIds.filter((id) => !expected.has(id));
    if (
      input.vectorCount === input.expectedIds.length &&
      visibleIds.length === input.expectedIds.length &&
      unexpected.length > 0
    ) {
      return { outcome: "failed", error: "vectorize-id-mismatch" };
    }
  }
  if (idsReady) {
    const metadataReady = input.visible.every((vector) => {
      const expected = input.expectedMetadata.get(vector.id);
      return (
        expected !== undefined &&
        vector.metadata !== null &&
        vector.metadata.corpusVersion === expected.corpusVersion &&
        vector.metadata.audience === expected.audience &&
        vector.metadata.profileId === expected.profileId
      );
    });
    if (!metadataReady) {
      return { outcome: "failed", error: "vectorize-metadata-mismatch" };
    }
    if (input.vectorCount !== null && input.vectorCount > input.expectedIds.length) {
      return { outcome: "failed", error: "vectorize-unexpected-vectors" };
    }
  }
  const visible =
    idsReady &&
    input.metric === "cosine" &&
    input.dimensions === input.expectedDimensions &&
    input.vectorCount === input.expectedIds.length &&
    (input.expectedIndexName === null || input.indexName === input.expectedIndexName);
  if (visible) {
    return { outcome: "succeeded", error: null };
  }
  return { outcome: "pending", error: "vectorize-readback-incomplete" };
}

export function ingestionPhase(evidence: IngestEvidence): IngestionPhase {
  const own = journalForProfile(evidence.journal, evidence.versionId, evidence.profileId);
  if (evidence.expectedDocuments === 0 || evidence.expectedChunks === 0) {
    return "failed";
  }
  if (own.some((item) => item.outcome === "failed")) {
    return "failed";
  }
  const succeeded = new Set(
    own.filter((item) => item.outcome === "succeeded").map((item) => item.store),
  );
  if (succeeded.size === 0) {
    return "planned";
  }
  const written = succeeded.has("r2") && succeeded.has("d1") && succeeded.has("vectorize");
  if (!written) {
    return "partial";
  }
  const visibility = own.find((item) => item.key === "vectors:visibility");
  if (visibility?.outcome === "succeeded") {
    return "ready";
  }
  return "pending-visibility";
}

export interface VectorWrite {
  id: string;
  values: readonly number[];
  metadata: { corpusVersion: string; audience: Audience; profileId: string };
}

export interface IngestPorts {
  getObject(key: string): Promise<string | null>;
  putObject(key: string, body: string): Promise<void>;
  writeCatalog(manifest: CorpusManifest): Promise<void>;
  readCatalog(versionId: string, profileId: string): Promise<CatalogSnapshot | null>;
  listMetadataIndexes(): Promise<readonly string[]>;
  upsertVectors(vectors: readonly VectorWrite[]): Promise<{ mutationId: string | null }>;
  readVectors(ids: readonly string[]): Promise<readonly VisibleVector[]>;
  describeIndex(): Promise<IndexDescription>;
  persistJournal(item: IngestJournalItem): Promise<void>;
  recordPhase(update: {
    phase: IngestionPhase;
    mutationId: string | null;
    observedMetric: string | null;
    lastError: string | null;
  }): Promise<void>;
}

function remember(journal: IngestJournalItem[], item: IngestJournalItem): IngestJournalItem[] {
  const rest = journal.filter(
    (current) =>
      !(
        current.versionId === item.versionId &&
        current.profileId === item.profileId &&
        current.store === item.store &&
        current.key === item.key
      ),
  );
  return [...rest, item];
}

export function validateVectors(
  manifest: CorpusManifest,
  vectors: readonly (readonly number[])[],
): VectorWrite[] {
  if (vectors.length !== manifest.chunks.length) {
    throw new Error("El número de embeddings no coincide con los fragmentos.");
  }
  const documentIds = new Set(manifest.documents.map((document) => document.id));
  const seen = new Set<string>();
  return manifest.chunks.map((chunk, index) => {
    const values = vectors[index];
    if (values === undefined || values.length !== manifest.dimensions) {
      throw new Error("La dimensión del embedding no coincide con el perfil.");
    }
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error("El embedding contiene un valor no finito.");
    }
    if (utf8Bytes(chunk.vectorId) > VECTOR_ID_MAX_BYTES) {
      throw new Error("El identificador vectorial supera 64 bytes.");
    }
    if (seen.has(chunk.vectorId) || seen.has(chunk.chunkId)) {
      throw new Error("Hay un identificador de fragmento o de vector repetido.");
    }
    seen.add(chunk.vectorId);
    seen.add(chunk.chunkId);
    const document = manifest.documents.find((item) => item.id === chunk.documentId);
    if (document === undefined || !documentIds.has(document.id)) {
      throw new Error("El fragmento no tiene documento.");
    }
    if (
      document.audience !== "program" &&
      document.audience !== "L/X" &&
      document.audience !== "M/J"
    ) {
      throw new Error("La audiencia del documento no es válida.");
    }
    return {
      id: chunk.vectorId,
      values,
      metadata: {
        corpusVersion: manifest.preparationId,
        audience: document.audience,
        profileId: manifest.profileId,
      },
    };
  });
}

async function readVectorsInBatches(
  ids: readonly string[],
  read: IngestPorts["readVectors"],
  batchSize: number,
): Promise<VisibleVector[]> {
  if (batchSize < 1) {
    throw new Error("El lote de lectura vectorial no es válido.");
  }
  const found: VisibleVector[] = [];
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = await read(ids.slice(index, index + batchSize));
    found.push(...batch);
  }
  return found;
}

function batchesOf<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export async function runIngestion(input: {
  manifest: CorpusManifest;
  vectors: readonly (readonly number[])[] | null;
  ports: IngestPorts;
  journal?: readonly IngestJournalItem[];
  upsertBatchSize?: number;
  getBatchSize?: number;
  expectedIndexName?: string | null;
  profileIsActive?: boolean;
}): Promise<{ phase: IngestionPhase; journal: IngestJournalItem[]; mutationId: string | null }> {
  const versionId = input.manifest.preparationId;
  const profileId = input.manifest.profileId;
  let journal = journalForProfile(input.journal ?? [], versionId, profileId);
  if (input.profileIsActive === true) {
    return {
      phase: ingestionPhase({
        versionId,
        profileId,
        expectedDocuments: input.manifest.documents.length,
        expectedChunks: input.manifest.chunks.length,
        journal,
      }),
      journal,
      mutationId: null,
    };
  }
  const mark = async (item: IngestJournalItem) => {
    journal = remember(journal, item);
    await input.ports.persistJournal(item);
  };
  const contentKey = contentManifestKey(versionId);
  const profileKey = profileManifestKey(versionId, profileId);
  const contentBody = serializeContentManifest(contentManifestFrom(input.manifest));
  const profileBody = serializeManifest(input.manifest);

  const putImmutable = async (key: string, body: string) => {
    const existing = await input.ports.getObject(key);
    if (existing === body) {
      await mark(
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: "succeeded",
          error: null,
          mutationId: null,
        }),
      );
      return;
    }
    if (existing !== null) {
      await mark(
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: "failed",
          error: "r2-immutable-conflict",
          mutationId: null,
        }),
      );
      return;
    }
    try {
      await input.ports.putObject(key, body);
      const read = await input.ports.getObject(key);
      await mark(
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: read === body ? "succeeded" : "failed",
          error: read === body ? null : "r2-readback-mismatch",
          mutationId: null,
        }),
      );
    } catch {
      await mark(
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: "failed",
          error: "r2-write-failed",
          mutationId: null,
        }),
      );
    }
  };

  if (input.manifest.documents.length > 0 && input.manifest.chunks.length > 0) {
    for (const document of input.manifest.documents) {
      await putImmutable(documentObjectKey(versionId, document.id), document.body);
    }
    const documentsOk = input.manifest.documents.every((document) =>
      journal.some(
        (item) =>
          item.key === documentObjectKey(versionId, document.id) && item.outcome === "succeeded",
      ),
    );
    if (documentsOk) {
      await putImmutable(contentKey, contentBody);
      const contentOk = journal.some(
        (item) => item.key === contentKey && item.outcome === "succeeded",
      );
      if (contentOk) {
        try {
          const current = await input.ports.getObject(profileKey);
          if (current !== profileBody) {
            await input.ports.putObject(profileKey, profileBody);
          }
          const read = await input.ports.getObject(profileKey);
          await mark(
            journalItem({
              store: "r2",
              versionId,
              profileId,
              key: profileKey,
              outcome: read === profileBody ? "succeeded" : "failed",
              error: read === profileBody ? null : "r2-manifest-mismatch",
              mutationId: null,
            }),
          );
        } catch {
          await mark(
            journalItem({
              store: "r2",
              versionId,
              profileId,
              key: profileKey,
              outcome: "failed",
              error: "r2-write-failed",
              mutationId: null,
            }),
          );
        }
      }
    }
  }

  const r2Ready = journal.some((item) => item.key === profileKey && item.outcome === "succeeded");
  if (r2Ready) {
    try {
      await input.ports.writeCatalog(input.manifest);
      const catalog = await input.ports.readCatalog(versionId, profileId);
      const matches = catalogMatches(input.manifest, catalog);
      await mark(
        journalItem({
          store: "d1",
          versionId,
          profileId,
          key: "catalog",
          outcome: matches ? "succeeded" : "failed",
          error: matches ? null : "d1-readback-mismatch",
          mutationId: null,
        }),
      );
    } catch {
      await mark(
        journalItem({
          store: "d1",
          versionId,
          profileId,
          key: "catalog",
          outcome: "failed",
          error: "d1-write-failed",
          mutationId: null,
        }),
      );
    }
  }

  let mutationId: string | null = null;
  const d1Ready = journal.some(
    (item) => item.store === "d1" && item.key === "catalog" && item.outcome === "succeeded",
  );
  let described: IndexDescription = {
    name: null,
    dimensions: null,
    metric: null,
    vectorCount: null,
  };
  if (d1Ready && input.vectors !== null) {
    try {
      const metadataIndexes = await input.ports.listMetadataIndexes();
      const metadataReady = VECTORIZE_METADATA_INDEXES.every((name) =>
        metadataIndexes.includes(name),
      );
      if (!metadataReady) {
        await mark(
          journalItem({
            store: "vectorize",
            versionId,
            profileId,
            key: "metadata-indexes",
            outcome: "failed",
            error: "metadata-indexes-missing",
            mutationId: null,
          }),
        );
      } else {
        const writes = validateVectors(input.manifest, input.vectors);
        const upsertBatchSize = input.upsertBatchSize ?? VECTORIZE_UPSERT_BATCH;
        const groups = batchesOf(writes, upsertBatchSize);
        let rejected = false;
        for (const [index, batch] of groups.entries()) {
          const key = `vectors:batch:${String(index)}`;
          const prior = journal.find(
            (item) => item.key === key && item.outcome === "succeeded" && item.mutationId !== null,
          );
          if (prior !== undefined) {
            mutationId = prior.mutationId;
            continue;
          }
          const result = await input.ports.upsertVectors(batch);
          if (result.mutationId === null || result.mutationId.length === 0) {
            await mark(
              journalItem({
                store: "vectorize",
                versionId,
                profileId,
                key,
                outcome: "failed",
                error: "vectorize-write-rejected",
                mutationId: null,
              }),
            );
            rejected = true;
            break;
          }
          mutationId = result.mutationId;
          await mark(
            journalItem({
              store: "vectorize",
              versionId,
              profileId,
              key,
              outcome: "succeeded",
              error: null,
              mutationId: result.mutationId,
            }),
          );
        }
        if (!rejected) {
          const visible = await readVectorsInBatches(
            writes.map((vector) => vector.id),
            (ids) => input.ports.readVectors(ids),
            input.getBatchSize ?? VECTORIZE_GET_BATCH,
          );
          described = await input.ports.describeIndex();
          const expectedMetadata = new Map(
            writes.map((vector) => [vector.id, vector.metadata] as const),
          );
          const classification = classifyIndexReadback({
            expectedIds: writes.map((vector) => vector.id),
            visible,
            expectedMetadata,
            dimensions: described.dimensions,
            expectedDimensions: input.manifest.dimensions,
            metric: described.metric,
            vectorCount: described.vectorCount,
            expectedIndexName: input.expectedIndexName ?? null,
            indexName: described.name,
          });
          // Reconcile a previous readback failure after the accepted mutation,
          // without replaying its upsert or losing pending-visibility semantics.
          if (journal.some((item) => item.key === "vectors")) {
            await mark(
              journalItem({
                store: "vectorize",
                versionId,
                profileId,
                key: "vectors",
                outcome: classification.outcome,
                error: classification.error,
                mutationId,
              }),
            );
          }
          if (classification.outcome === "succeeded") {
            const receipt = `${JSON.stringify({
              indexName: described.name,
              dimensions: described.dimensions,
              metric: described.metric,
              vectorCount: described.vectorCount,
              mutationIds: journal
                .filter((item) => item.key.startsWith("vectors:batch:") && item.mutationId !== null)
                .map((item) => item.mutationId),
            })}\n`;
            const receiptKey = indexConfigReceiptKey(versionId, profileId);
            await input.ports.putObject(receiptKey, receipt);
            const read = await input.ports.getObject(receiptKey);
            if (read !== receipt) {
              await mark(
                journalItem({
                  store: "vectorize",
                  versionId,
                  profileId,
                  key: "vectors:visibility",
                  outcome: "failed",
                  error: "index-config-readback-mismatch",
                  mutationId,
                }),
              );
            } else {
              await mark(
                journalItem({
                  store: "vectorize",
                  versionId,
                  profileId,
                  key: "vectors:visibility",
                  outcome: "succeeded",
                  error: null,
                  mutationId,
                }),
              );
            }
          } else {
            await mark(
              journalItem({
                store: "vectorize",
                versionId,
                profileId,
                key: "vectors:visibility",
                outcome: classification.outcome,
                error: classification.error,
                mutationId,
              }),
            );
          }
        }
      }
    } catch {
      await mark(
        journalItem({
          store: "vectorize",
          versionId,
          profileId,
          key: "vectors",
          outcome: "failed",
          error: "vectorize-write-failed",
          mutationId: null,
        }),
      );
    }
  }

  const phase = ingestionPhase({
    versionId,
    profileId,
    expectedDocuments: input.manifest.documents.length,
    expectedChunks: input.manifest.chunks.length,
    journal,
  });
  const visibility = journal.find((item) => item.key === "vectors:visibility");
  await input.ports.recordPhase({
    phase,
    mutationId,
    observedMetric: described.metric,
    lastError: visibility?.outcome === "succeeded" ? null : (visibility?.error ?? null),
  });
  return { phase, journal, mutationId };
}

export function selectActiveProfile(input: {
  requestedId: string;
  profiles: readonly { id: string; status: IngestionPhase; active: boolean }[];
}): { activeId: string | null; changed: boolean; reason: string } {
  const current = input.profiles.find((profile) => profile.active) ?? null;
  const requested = input.profiles.find((profile) => profile.id === input.requestedId) ?? null;
  if (requested === null || requested.status !== "ready") {
    return {
      activeId: current?.id ?? null,
      changed: false,
      reason: "La versión pedida no está lista. La versión activa no cambia.",
    };
  }
  return { activeId: requested.id, changed: current?.id !== requested.id, reason: "Perfil listo." };
}

export function applyActiveSelection(
  profiles: readonly { id: string; status: IngestionPhase; active: boolean }[],
  requestedId: string,
): { id: string; status: IngestionPhase; active: boolean }[] {
  const decision = selectActiveProfile({ requestedId, profiles });
  if (!decision.changed) {
    return profiles.map((profile) => ({ ...profile }));
  }
  return profiles.map((profile) => ({ ...profile, active: profile.id === decision.activeId }));
}

export const INGEST_ORDER = [
  "Comprobar los índices de metadatos corpusVersion, audience y profileId antes de insertar.",
  "Escribir los documentos inmutables y el manifiesto de contenido en R2.",
  "Escribir el manifiesto del perfil en una clave que incluye profileId.",
  "Escribir el catálogo en D1 y leer identificadores, textos y el mapa vectorial.",
  "Insertar los embeddings que el diario no tenga ya aceptados y guardar cada mutación.",
  "Una lectura incompleta queda en pending-visibility. No se vuelve a insertar solo para esperar.",
  "Marcar listo solo con métrica observada, dimensión, recuento, identificadores y metadatos.",
  "Elegir la versión activa en una operación distinta. Un fallo no sustituye la anterior.",
] as const;

export { contentManifestKey, documentObjectKey, indexConfigReceiptKey, profileManifestKey };
