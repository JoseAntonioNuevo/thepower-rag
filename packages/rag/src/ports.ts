import type { Audience, EvidenceDecision } from "@thepower-rag/contracts";
import type { RetrievedChunk, SourceDocument } from "./types";

export interface CancelSignal {
  readonly aborted: boolean;
}

export interface RetrievalQuery {
  vector: readonly number[];
  audience: Audience;
  corpusVersion: string;
  limit: number;
}

export interface RetrievalHit {
  chunkId: string;
  score: number | null;
}

export interface RetrievalPort {
  retrieve(query: RetrievalQuery, signal: CancelSignal): Promise<readonly RetrievalHit[]>;
}

export interface EmbeddingPort {
  embed(texts: readonly string[], signal: CancelSignal): Promise<readonly (readonly number[])[]>;
}

export interface ModelMessage {
  role: "user" | "assistant";
  text: string;
}

export interface GenerationRequest {
  modelId: string;
  promptId: string;
  system: string;
  messages: readonly ModelMessage[];
  signal: CancelSignal;
}

export interface MeasuredUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface MeasuredCost {
  amount: number;
  currency: string;
  source: string;
  method: string;
}

export interface GenerationResult {
  text: string;
  usage: MeasuredUsage | null;
  cost: MeasuredCost | null;
}

export interface GenerationPort {
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

export interface EvaluationPort {
  evaluate(
    input: {
      question: string;
      chunks: readonly RetrievedChunk[];
    },
    signal: CancelSignal,
  ): Promise<EvidenceDecision>;
}

export interface StoredDocument {
  id: string;
  versionId: string;
  mediaType: string;
  body: Uint8Array;
}

export interface DocumentStorePort {
  put(document: StoredDocument): Promise<void>;
  get(id: string, versionId: string): Promise<StoredDocument | null>;
}

export interface ChunkRecord {
  chunkId: string;
  documentId: string;
  title: string;
  section: string;
  text: string;
  audience: Audience;
  corpusVersion: string;
}

export interface ChunkCatalogPort {
  getChunk(corpusVersion: string, chunkId: string): Promise<ChunkRecord | null>;
}

export interface CorpusCatalogPort {
  listVersions(): Promise<readonly { id: string; label: string }[]>;
  listDocuments(versionId: string): Promise<readonly SourceDocument[]>;
}
