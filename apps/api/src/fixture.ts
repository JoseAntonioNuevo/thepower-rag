// GUÍA DE LECTURA · apps/api/src/fixture.ts
// Corpus de la demostración: lee los corpus preparados incluidos en el bundle (el del chat de la demo
// y el de ThePower Shop, que usa la investigación) y calcula, una sola vez, los vectores léxicos de
// prueba de cada fragmento.
// Constantes y función del embedding de la demo, y tipo de fragmento.
import {
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  type IndexedChunk,
} from "@thepower-rag/core";
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Corpus preparado (JSON) incluido en el bundle.
import corpus from "../../../corpus/prepared/corpus.json";
// Corpus preparado de ThePower Shop, con el mismo perfil léxico de la demo.
import storeCorpus from "../../../corpus/prepared/thepower-shop.json";

// Forma del archivo del corpus preparado.
interface PreparedFile {
  // Versión del contenido.
  contentVersion: string;
  // Versión de preparación.
  preparationId: string;
  // Versión usada en los ids.
  version: string;
  // Modelo de embeddings.
  embeddingModel: string;
  // Dimensiones.
  dimensions: number;
  // Revisión remota sin verificar.
  remoteRevision: null;
  // Cobertura.
  coverage: {
    // Temario.
    curriculum: "complete" | "partial";
    // Calendario L/X.
    calendarLx: "complete" | "partial";
    // Calendario M/J.
    calendarMj: "complete" | "partial";
    // Ejercicios.
    exerciseDetail: "complete" | "partial";
    // Verificación remota.
    remote: "not-verified";
  };
  // Perfil de índice.
  indexProfile: {
    // Id.
    id: string;
    // Familia.
    family: "fixture" | "workers-ai";
    // Modelo.
    model: string;
    // Dimensiones.
    dimensions: number;
  };
  // Documentos con sus fragmentos.
  documents: {
    // Id.
    id: string;
    // Título.
    title: string;
    // Audiencia.
    audience: Audience;
    // Fragmentos.
    chunks: { chunkId: string; section: string; text: string }[];
  }[];
}

// Corpus con su tipo.
const prepared = corpus as PreparedFile;
// Corpus de la tienda con su tipo.
const preparedStore = storeCorpus as PreparedFile;
// Fragmentos ya calculados (caché del módulo).
let cached: IndexedChunk[] | null = null;
// Fragmentos de la tienda ya calculados.
let cachedStore: IndexedChunk[] | null = null;

// Versión de preparación del corpus de la demo.
export function fixtureCorpusVersion(): string {
  // Id de preparación.
  return prepared.preparationId;
}

// Versión del contenido.
export function fixtureContentVersion(): string {
  // Id de contenido.
  return prepared.contentVersion;
}

// Perfil de índice de la demo.
export function fixtureProfile() {
  // Perfil.
  return prepared.indexProfile;
}

// Cobertura del corpus.
export function fixtureCoverage() {
  // Cobertura.
  return prepared.coverage;
}

// Fragmentos de un corpus preparado con su vector léxico.
function indexChunks(file: PreparedFile): IndexedChunk[] {
  // El corpus preparado debe usar el perfil léxico de la demo.
  if (
    file.embeddingModel !== FIXTURE_EMBEDDING_MODEL ||
    file.dimensions !== FIXTURE_DIMENSIONS ||
    file.indexProfile.family !== "fixture" ||
    file.indexProfile.model !== FIXTURE_EMBEDDING_MODEL ||
    file.indexProfile.dimensions !== FIXTURE_DIMENSIONS
  ) {
    // Error si no.
    throw new Error("El corpus preparado no usa el perfil de prueba declarado.");
  }
  // Aplana documentos y fragmentos y calcula cada vector.
  return file.documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      documentId: document.id,
      chunkId: chunk.chunkId,
      title: document.title,
      section: chunk.section,
      text: chunk.text,
      audience: document.audience,
      corpusVersion: file.preparationId,
      vector: fixtureEmbed(chunk.text),
    })),
  );
}

// Fragmentos de la demo con su vector léxico.
export function fixtureChunks(): IndexedChunk[] {
  // Se calculan una vez y se reutilizan.
  cached ??= indexChunks(prepared);
  // Fragmentos calculados.
  return cached;
}

// Versión de preparación del corpus de ThePower Shop que usa la demo de la investigación.
export function storeFixtureCorpusVersion(): string {
  // Id de preparación.
  return preparedStore.preparationId;
}

// Fragmentos de ThePower Shop con su vector léxico, para la demo de la investigación.
export function storeFixtureChunks(): IndexedChunk[] {
  // Se calculan una vez y se reutilizan.
  cachedStore ??= indexChunks(preparedStore);
  // Fragmentos calculados.
  return cachedStore;
}

// Umbral de la demo.
export { FIXTURE_MIN_SCORE };
