import type { Audience, CohortId, EvidenceDecision } from "@thepower-rag/contracts";

export interface CorpusVersion {
  id: string;
  label: string;
  embeddingModel: string;
  dimensions: number;
  remoteRevision: null;
}

export type DocumentAudience = { kind: "program" } | { kind: "cohort"; cohort: CohortId };

export interface SourceDocument {
  id: string;
  versionId: string;
  title: string;
  audience: DocumentAudience;
  sourceHash: string;
}

export interface TextChunk {
  documentId: string;
  chunkId: string;
  title: string;
  section: string;
  text: string;
  corpusVersion: string;
}

export interface RetrievedChunk extends TextChunk {
  score: number | null;
  audience: Audience;
}

export interface CragState {
  originalQuestion: string;
  currentQuery: string;
  retrievalCount: number;
  reformulationCount: number;
  retainedChunks: RetrievedChunk[];
  discardedChunks: RetrievedChunk[];
  evidence: EvidenceDecision;
}
