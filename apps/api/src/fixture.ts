import {
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  type IndexedChunk,
} from "@thepower-rag/core";
import type { Audience } from "@thepower-rag/contracts";
import corpus from "../../../corpus/prepared/corpus.json";

interface PreparedFile {
  contentVersion: string;
  preparationId: string;
  version: string;
  embeddingModel: string;
  dimensions: number;
  remoteRevision: null;
  coverage: {
    curriculum: "complete" | "partial";
    calendarLx: "complete" | "partial";
    calendarMj: "complete" | "partial";
    exerciseDetail: "complete" | "partial";
    remote: "not-verified";
  };
  indexProfile: {
    id: string;
    family: "fixture" | "workers-ai";
    model: string;
    dimensions: number;
  };
  documents: {
    id: string;
    title: string;
    audience: Audience;
    chunks: { chunkId: string; section: string; text: string }[];
  }[];
}

const prepared = corpus as PreparedFile;
let cached: IndexedChunk[] | null = null;

export function fixtureCorpusVersion(): string {
  return prepared.preparationId;
}

export function fixtureContentVersion(): string {
  return prepared.contentVersion;
}

export function fixtureProfile() {
  return prepared.indexProfile;
}

export function fixtureCoverage() {
  return prepared.coverage;
}

export function fixtureChunks(): IndexedChunk[] {
  if (cached) {
    return cached;
  }
  if (
    prepared.embeddingModel !== FIXTURE_EMBEDDING_MODEL ||
    prepared.dimensions !== FIXTURE_DIMENSIONS ||
    prepared.indexProfile.family !== "fixture" ||
    prepared.indexProfile.model !== FIXTURE_EMBEDDING_MODEL ||
    prepared.indexProfile.dimensions !== FIXTURE_DIMENSIONS
  ) {
    throw new Error("El corpus preparado no usa el perfil de prueba declarado.");
  }
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
  return cached;
}

export { FIXTURE_MIN_SCORE };
