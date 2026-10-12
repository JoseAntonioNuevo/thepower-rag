// GUÍA DE LECTURA · apps/api/src/fixture.ts
// Corpus de la demostración: lee el corpus preparado incluido en el bundle y calcula, una sola vez,
// los vectores léxicos de prueba de cada fragmento.
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
// Fragmentos ya calculados (caché del módulo).
let cached: IndexedChunk[] | null = null;

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

// Fragmentos de la demo con su vector léxico.
export function fixtureChunks(): IndexedChunk[] {
  // Si ya se calcularon, se reutilizan.
  if (cached) {
    // Caché.
    return cached;
  }
  // El corpus preparado debe usar el perfil léxico de la demo.
  if (
    prepared.embeddingModel !== FIXTURE_EMBEDDING_MODEL ||
    prepared.dimensions !== FIXTURE_DIMENSIONS ||
    prepared.indexProfile.family !== "fixture" ||
    prepared.indexProfile.model !== FIXTURE_EMBEDDING_MODEL ||
    prepared.indexProfile.dimensions !== FIXTURE_DIMENSIONS
  ) {
    // Error si no.
    throw new Error("El corpus preparado no usa el perfil de prueba declarado.");
  }
  // Aplana documentos y fragmentos y calcula cada vector.
  cached = prepared.documents.flatMap((document) =>
    document.chunks.map((chunk) => ({
      documentId: document.id,
      chunkId: chunk.chunkId,
      title: document.title,
      section: chunk.section,
      text: chunk.text,
      audience: document.audience,
      corpusVersion: prepared.preparationId,
      vector: fixtureEmbed(chunk.text),
    })),
  );
  // Fragmentos calculados.
  return cached;
}

// Umbral de la demo.
export { FIXTURE_MIN_SCORE };
