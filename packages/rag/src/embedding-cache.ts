import { fnv1a64 } from "./hash";
import { indexProfileId, type ProfileIdentity } from "./ids";
import { manifestFrom, type CorpusManifest } from "./ingest";
import type { PreparedCorpus } from "./prepare";
import { RUNTIME_PROVENANCE, type RuntimeProvenance } from "./provenance";

export const SEMANTIC_EMBEDDING_MODEL = "@cf/baai/bge-m3";

export function semanticIdentity(
  corpus: PreparedCorpus,
  dimensions: number,
): ProfileIdentity & {
  id: string;
} {
  const identity: ProfileIdentity = {
    family: "workers-ai",
    model: SEMANTIC_EMBEDDING_MODEL,
    dimensions,
    metric: "cosine",
    chunkMaxChars: corpus.indexProfile.chunkMaxChars,
    chunkOverlap: corpus.indexProfile.chunkOverlap,
    providerRevision: null,
    preparationId: corpus.preparationId,
  };
  return { ...identity, id: indexProfileId(identity) };
}

export function semanticManifest(corpus: PreparedCorpus, dimensions: number): CorpusManifest {
  const profile = semanticIdentity(corpus, dimensions);
  return manifestFrom({
    ...corpus,
    embeddingModel: profile.model,
    dimensions,
    remoteRevision: null,
    indexProfile: profile,
  });
}

export interface EmbeddingCacheItem {
  chunkId: string;
  sourceHash: string;
  textHash: string;
  values: number[];
}

export interface EmbeddingCache {
  preparationId: string;
  profileId: string;
  model: string;
  dimensions: number;
  providerRevision: string | null;
  provenance: RuntimeProvenance;
  items: EmbeddingCacheItem[];
}

export function chunkTextHash(text: string): string {
  return fnv1a64(text);
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function validateEmbeddingCache(
  value: unknown,
  manifest: CorpusManifest,
  provenance: RuntimeProvenance,
): { ok: true; cache: EmbeddingCache } | { ok: false; reason: string } {
  const body = record(value);
  if (body === null || !Array.isArray(body.items)) {
    return { ok: false, reason: "La caché de embeddings no tiene la forma esperada." };
  }
  if (
    body.preparationId !== manifest.preparationId ||
    body.profileId !== manifest.profileId ||
    body.model !== manifest.embeddingModel ||
    body.dimensions !== manifest.dimensions
  ) {
    return { ok: false, reason: "La caché no corresponde a esta preparación, perfil o dimensión." };
  }
  if (
    typeof body.provenance !== "string" ||
    !RUNTIME_PROVENANCE.includes(body.provenance as RuntimeProvenance) ||
    body.provenance !== provenance
  ) {
    return {
      ok: false,
      reason: "La caché es de otra procedencia y no se reutiliza.",
    };
  }
  if (
    body.providerRevision !== undefined &&
    body.providerRevision !== null &&
    typeof body.providerRevision !== "string"
  ) {
    return { ok: false, reason: "La revisión del proveedor en la caché no es válida." };
  }
  if (body.items.length !== manifest.chunks.length) {
    return { ok: false, reason: "La caché no cubre los fragmentos del perfil." };
  }
  const documents = new Map(
    manifest.documents.map((document) => [document.id, document.sourceHash]),
  );
  const items: EmbeddingCacheItem[] = [];
  for (const [index, chunk] of manifest.chunks.entries()) {
    const item = record(body.items[index]);
    const values = item?.values;
    if (
      item === null ||
      item.chunkId !== chunk.chunkId ||
      item.sourceHash !== documents.get(chunk.documentId) ||
      item.textHash !== chunkTextHash(chunk.text) ||
      !Array.isArray(values) ||
      values.length !== manifest.dimensions ||
      values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
    ) {
      return {
        ok: false,
        reason: "Una fila de la caché no coincide con el fragmento o no es finita.",
      };
    }
    items.push({
      chunkId: chunk.chunkId,
      sourceHash: documents.get(chunk.documentId) ?? "",
      textHash: chunkTextHash(chunk.text),
      values: [...values],
    });
  }
  return {
    ok: true,
    cache: {
      preparationId: manifest.preparationId,
      profileId: manifest.profileId,
      model: manifest.embeddingModel,
      dimensions: manifest.dimensions,
      providerRevision: typeof body.providerRevision === "string" ? body.providerRevision : null,
      provenance,
      items,
    },
  };
}

export function vectorsFromCache(cache: EmbeddingCache): number[][] {
  return cache.items.map((item) => item.values);
}

export function cacheFromVectors(
  manifest: CorpusManifest,
  vectors: readonly (readonly number[])[],
  providerRevision: string | null,
  provenance: RuntimeProvenance,
): EmbeddingCache {
  const documents = new Map(
    manifest.documents.map((document) => [document.id, document.sourceHash]),
  );
  return {
    preparationId: manifest.preparationId,
    profileId: manifest.profileId,
    model: manifest.embeddingModel,
    dimensions: manifest.dimensions,
    providerRevision,
    provenance,
    items: manifest.chunks.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      sourceHash: documents.get(chunk.documentId) ?? "",
      textHash: chunkTextHash(chunk.text),
      values: [...(vectors[index] ?? [])],
    })),
  };
}
