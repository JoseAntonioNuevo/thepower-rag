import { fnv1a64 } from "./hash";

export const VECTOR_ID_MAX_BYTES = 64;
export const METADATA_VALUE_MAX_BYTES = 64;
export const INDEX_NAME_MAX_BYTES = 64;
export const VECTORIZE_UPSERT_BATCH = 1000;
// La página de límites no publica un tope menor para get_by_ids.
// 1000 es el lote de upsert del binding y el tamaño de página de list-vectors.
export const VECTORIZE_GET_BATCH = 1000;
export const VECTORIZE_METADATA_INDEXES = ["corpusVersion", "audience", "profileId"] as const;
export const UNVERIFIED_METRIC = "unverified";
export const COURSE_D1_NAME = "thepower-ai-course-rag-d1";
export const COURSE_R2_NAME = "thepower-ai-course-rag-corpus";
export const COURSE_VECTORIZE_PREFIX = "thepower-ai-course-rag-";

export const PREP_CHUNKING = { maxChars: 900, overlap: 80 } as const;

export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code <= 0xffff) {
      bytes += 3;
    } else {
      bytes += 4;
    }
  }
  return bytes;
}

export function contentVersionId(sourceMaterial: string): string {
  return `c${fnv1a64(sourceMaterial).slice(0, 12)}`;
}

export function preparationId(
  sourceMaterial: string,
  chunking: { maxChars: number; overlap: number },
): string {
  return `c${fnv1a64(`${sourceMaterial}\nchunk:${String(chunking.maxChars)}:${String(chunking.overlap)}`).slice(0, 12)}`;
}

export interface ProfileIdentity {
  family: "fixture" | "workers-ai";
  model: string;
  dimensions: number;
  metric: "cosine";
  chunkMaxChars: number;
  chunkOverlap: number;
  providerRevision: string | null;
  preparationId: string;
}

export function indexProfileId(profile: ProfileIdentity): string {
  const material = [
    profile.family,
    profile.model,
    String(profile.dimensions),
    profile.metric,
    String(profile.chunkMaxChars),
    String(profile.chunkOverlap),
    profile.providerRevision ?? "null",
    profile.preparationId,
  ].join("\n");
  return `p${fnv1a64(material).slice(0, 12)}`;
}

export function vectorizeIndexName(profileId: string): string {
  const suffix = profileId.startsWith("p") ? profileId.slice(1) : profileId;
  const name = `${COURSE_VECTORIZE_PREFIX}${suffix}`;
  if (utf8Bytes(name) > INDEX_NAME_MAX_BYTES) {
    throw new Error("El nombre del índice supera el límite de Vectorize.");
  }
  return name;
}

export function vectorIdFor(chunkId: string): string {
  if (utf8Bytes(chunkId) > VECTOR_ID_MAX_BYTES) {
    throw new Error("El identificador del fragmento supera 64 bytes y no se compacta en silencio.");
  }
  return chunkId;
}

export function documentObjectKey(preparationId: string, documentId: string): string {
  return `corpus/${preparationId}/documents/${documentId}.md`;
}

export function contentManifestKey(preparationId: string): string {
  return `corpus/${preparationId}/content-manifest.json`;
}

export function profileManifestKey(preparationId: string, profileId: string): string {
  return `corpus/${preparationId}/profiles/${profileId}/manifest.json`;
}

export function indexConfigReceiptKey(preparationId: string, profileId: string): string {
  return `corpus/${preparationId}/profiles/${profileId}/index-config.json`;
}
