// GUÍA DE LECTURA · packages/rag/src/embedding-cache.ts
// Caché local de los embeddings BGE-M3 del corpus: guarda un vector por fragmento con huellas del
// documento y del texto, y solo se reutiliza si coincide exactamente con la preparación y el perfil.
// Huella FNV-1a.
import { fnv1a64 } from "./hash";
// Identificador del perfil de índice y su tipo.
import { indexProfileId, type ProfileIdentity } from "./ids";
// Manifiesto del corpus que describe documentos y fragmentos.
import { manifestFrom, type CorpusManifest } from "./ingest";
// Tipo del corpus preparado.
import type { PreparedCorpus } from "./prepare";
// Procedencias admitidas y su tipo.
import { RUNTIME_PROVENANCE, type RuntimeProvenance } from "./provenance";

// Modelo semántico de Workers AI usado por el RAG real.
export const SEMANTIC_EMBEDDING_MODEL = "@cf/baai/bge-m3";

// Identidad del perfil semántico de un corpus con unas dimensiones dadas.
export function semanticIdentity(
  corpus: PreparedCorpus,
  dimensions: number,
): ProfileIdentity & {
  // Identificador calculado del perfil.
  id: string;
} {
  // Datos que definen el perfil.
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
  // Los mismos datos más su identificador.
  return { ...identity, id: indexProfileId(identity) };
}

// Manifiesto del corpus para el perfil semántico.
export function semanticManifest(corpus: PreparedCorpus, dimensions: number): CorpusManifest {
  // Identidad del perfil.
  const profile = semanticIdentity(corpus, dimensions);
  // Manifiesto con el modelo, las dimensiones y el perfil semánticos.
  return manifestFrom({
    ...corpus,
    embeddingModel: profile.model,
    dimensions,
    remoteRevision: null,
    indexProfile: profile,
  });
}

// Vector guardado de un fragmento.
export interface EmbeddingCacheItem {
  // Fragmento al que pertenece.
  chunkId: string;
  // Huella del documento fuente.
  sourceHash: string;
  // Huella del texto del fragmento.
  textHash: string;
  // Valores del vector.
  values: number[];
}

// Caché completa de un perfil.
export interface EmbeddingCache {
  // Preparación del corpus.
  preparationId: string;
  // Perfil de índice.
  profileId: string;
  // Modelo de embeddings.
  model: string;
  // Dimensiones.
  dimensions: number;
  // Revisión del proveedor, o null.
  providerRevision: string | null;
  // Procedencia de los vectores (prueba, emulación o remoto).
  provenance: RuntimeProvenance;
  // Un vector por fragmento, en el orden del manifiesto.
  items: EmbeddingCacheItem[];
}

// Huella del texto de un fragmento.
export function chunkTextHash(text: string): string {
  // FNV-1a de 64 bits.
  return fnv1a64(text);
}

// Devuelve el valor como objeto plano, o null si no lo es.
function record(value: unknown): Record<string, unknown> | null {
  // null, arrays y no objetos se rechazan.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // No es un objeto plano.
    return null;
  }
  // Objeto con claves de texto.
  return value as Record<string, unknown>;
}

// Valida una caché leída de disco antes de reutilizarla; cualquier diferencia la invalida.
export function validateEmbeddingCache(
  value: unknown,
  manifest: CorpusManifest,
  provenance: RuntimeProvenance,
): { ok: true; cache: EmbeddingCache } | { ok: false; reason: string } {
  // Cuerpo como objeto.
  const body = record(value);
  // Tiene que ser un objeto con la lista items.
  if (body === null || !Array.isArray(body.items)) {
    // Forma incorrecta.
    return { ok: false, reason: "La caché de embeddings no tiene la forma esperada." };
  }
  // Debe ser de la misma preparación, perfil, modelo y dimensión que el manifiesto.
  if (
    body.preparationId !== manifest.preparationId ||
    body.profileId !== manifest.profileId ||
    body.model !== manifest.embeddingModel ||
    body.dimensions !== manifest.dimensions
  ) {
    // No corresponde.
    return { ok: false, reason: "La caché no corresponde a esta preparación, perfil o dimensión." };
  }
  // La procedencia guardada tiene que existir y coincidir con la actual.
  if (
    typeof body.provenance !== "string" ||
    !RUNTIME_PROVENANCE.includes(body.provenance as RuntimeProvenance) ||
    body.provenance !== provenance
  ) {
    // Una caché de otra procedencia no se mezcla.
    return {
      ok: false,
      reason: "La caché es de otra procedencia y no se reutiliza.",
    };
  }
  // La revisión, si existe, tiene que ser texto.
  if (
    body.providerRevision !== undefined &&
    body.providerRevision !== null &&
    typeof body.providerRevision !== "string"
  ) {
    // Revisión inválida.
    return { ok: false, reason: "La revisión del proveedor en la caché no es válida." };
  }
  // Debe haber exactamente un vector por fragmento.
  if (body.items.length !== manifest.chunks.length) {
    // No cubre el perfil.
    return { ok: false, reason: "La caché no cubre los fragmentos del perfil." };
  }
  // Mapa documento → huella del archivo fuente.
  const documents = new Map(
    manifest.documents.map((document) => [document.id, document.sourceHash]),
  );
  // Filas validadas.
  const items: EmbeddingCacheItem[] = [];
  // Recorre los fragmentos del manifiesto con su posición.
  for (const [index, chunk] of manifest.chunks.entries()) {
    // Fila de la caché en la misma posición.
    const item = record(body.items[index]);
    // Valores del vector.
    const values = item?.values;
    // La fila debe coincidir en id, huellas y dimensión, con números finitos.
    if (
      item === null ||
      item.chunkId !== chunk.chunkId ||
      item.sourceHash !== documents.get(chunk.documentId) ||
      item.textHash !== chunkTextHash(chunk.text) ||
      !Array.isArray(values) ||
      values.length !== manifest.dimensions ||
      values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
    ) {
      // Una sola fila incorrecta invalida la caché.
      return {
        ok: false,
        reason: "Una fila de la caché no coincide con el fragmento o no es finita.",
      };
    }
    // Copia validada de la fila.
    items.push({
      chunkId: chunk.chunkId,
      sourceHash: documents.get(chunk.documentId) ?? "",
      textHash: chunkTextHash(chunk.text),
      values: [...values],
    });
  }
  // Caché validada.
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

// Lista de vectores en el orden del manifiesto.
export function vectorsFromCache(cache: EmbeddingCache): number[][] {
  // Extrae los valores de cada fila.
  return cache.items.map((item) => item.values);
}

// Construye la caché a partir de los vectores calculados.
export function cacheFromVectors(
  manifest: CorpusManifest,
  vectors: readonly (readonly number[])[],
  providerRevision: string | null,
  provenance: RuntimeProvenance,
): EmbeddingCache {
  // Mapa documento → huella del archivo fuente.
  const documents = new Map(
    manifest.documents.map((document) => [document.id, document.sourceHash]),
  );
  // Caché con una fila por fragmento.
  return {
    // Identidad: preparación, perfil, modelo, dimensión, revisión y procedencia.
    preparationId: manifest.preparationId,
    profileId: manifest.profileId,
    model: manifest.embeddingModel,
    dimensions: manifest.dimensions,
    providerRevision,
    provenance,
    // Una fila por fragmento: huellas del documento y del texto, y el vector copiado.
    items: manifest.chunks.map((chunk, index) => ({
      chunkId: chunk.chunkId,
      sourceHash: documents.get(chunk.documentId) ?? "",
      textHash: chunkTextHash(chunk.text),
      values: [...(vectors[index] ?? [])],
    })),
  };
}
