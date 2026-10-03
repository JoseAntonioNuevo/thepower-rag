import type { Audience } from "@thepower-rag/contracts";
import { allowsAudience } from "./pipeline";
import { CRAG_LIMITS } from "./limits";

export const CRAG_BOUNDS = {
  maxRetrievals: CRAG_LIMITS.maxRetrievals,
  maxReformulations: CRAG_LIMITS.maxReformulations,
  maxCandidates: 10,
  maxRetained: 6,
  maxReasonChars: 240,
  maxQueryChars: 500,
  maxGaps: 4,
  maxGapChars: 160,
  maxIdChars: 128,
  maxDiscarded: 24,
  executionBudgetMs: 20_000,
} as const;

export type EvidenceStatus = "sufficient" | "partial" | "insufficient";

export interface CragScope {
  runId: string;
  audience: Audience;
  corpusVersion: string;
  profileId: string;
  embeddingLabel: string;
}

export interface CragChunk {
  documentId: string;
  chunkId: string;
  title: string;
  section: string;
  text: string;
  audience: Audience;
  corpusVersion: string;
  profileId: string;
  score: number | null;
}

export interface RankedHit {
  chunkId: string;
  score: number;
  reason: string;
}

export interface CragAssessment {
  status: EvidenceStatus;
  reason: string;
  gaps: string[];
  usefulIds: string[];
}

export type CragRoute = "answer" | "refuse" | "retain" | "discard" | "stop";

export interface CragSignal {
  readonly aborted: boolean;
}

export interface CragPorts {
  measured: boolean;
  now(): number;
  signal: CragSignal;
  reserve(
    kind: "retrieval" | "evaluation" | "reformulation" | "generation",
  ): { ok: true } | { ok: false; reason: string };
  retrieve(input: {
    query: string;
    scope: CragScope;
    limit: number;
    attempt: number;
    remainingMs: number;
  }): Promise<
    { ok: true; chunks: CragChunk[]; providerCall: boolean } | { ok: false; reason: string }
  >;
  rankAndAssess(input: {
    question: string;
    query: string;
    chunks: readonly CragChunk[];
    attempt: number;
    remainingMs: number;
  }): Promise<
    | { ok: true; raw: unknown; providerCall: boolean }
    | { ok: false; reason: string; providerCall: boolean }
  >;
  reformulate(input: {
    question: string;
    query: string;
    gaps: readonly string[];
    attempt: number;
    remainingMs: number;
  }): Promise<
    | { ok: true; raw: unknown; providerCall: boolean }
    | { ok: false; reason: string; providerCall: boolean }
  >;
  generate(input: {
    question: string;
    evidence: readonly CragChunk[];
    remainingMs: number;
  }): Promise<
    | {
        ok: true;
        text: string;
        providerCall: boolean;
        usage: {
          inputTokens: number | null;
          outputTokens: number | null;
          totalTokens: number | null;
        } | null;
        cost: { amount: number; currency: string; source: string; method: string } | null;
      }
    | { ok: false; reason: string; providerCall: boolean }
  >;
}

export function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function remainingBudgetMs(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt) {
    return 0;
  }
  return Math.max(0, CRAG_BOUNDS.executionBudgetMs - (now - startedAt));
}

export function budgetOpen(startedAt: number, now: number): boolean {
  return remainingBudgetMs(startedAt, now) > 0;
}

export function chunkInScope(chunk: CragChunk, scope: CragScope): boolean {
  return (
    chunk.corpusVersion === scope.corpusVersion &&
    chunk.profileId === scope.profileId &&
    chunk.text.trim().length > 0 &&
    allowsAudience(chunk.audience, scope.audience)
  );
}

export function dedupeChunks(chunks: readonly CragChunk[]): CragChunk[] {
  const seen = new Set<string>();
  const result: CragChunk[] = [];
  for (const chunk of chunks) {
    if (seen.has(chunk.chunkId)) {
      continue;
    }
    seen.add(chunk.chunkId);
    result.push(chunk);
  }
  return result;
}

export function routeAfterAssessment(input: {
  status: EvidenceStatus | null;
  retrievalCount: number;
  reformulationCount: number;
}): CragRoute {
  if (input.status === "sufficient") {
    return "answer";
  }
  if (
    input.retrievalCount >= CRAG_BOUNDS.maxRetrievals ||
    input.reformulationCount >= CRAG_BOUNDS.maxReformulations
  ) {
    return "refuse";
  }
  if (input.status === "partial") {
    return "retain";
  }
  if (input.status === "insufficient") {
    return "discard";
  }
  return "stop";
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    return null;
  }
  return trimmed;
}

export function validateRankingAndAssessment(
  candidates: readonly CragChunk[],
  raw: unknown,
): { ok: true; ranking: RankedHit[]; assessment: CragAssessment } | { ok: false; reason: string } {
  const body = record(raw);
  if (body === null || !Array.isArray(body.ranking) || !Array.isArray(body.usefulIds)) {
    return { ok: false, reason: "La salida del evaluador no tiene la forma esperada." };
  }
  if (body.ranking.length !== candidates.length) {
    return { ok: false, reason: "La ordenación no cubre los fragmentos recuperados." };
  }
  const expected = new Set(candidates.map((chunk) => chunk.chunkId));
  const ranking: RankedHit[] = [];
  const seen = new Set<string>();
  for (const item of body.ranking) {
    const row = record(item);
    const chunkId = row === null ? null : boundedText(row.chunkId, CRAG_BOUNDS.maxIdChars);
    const reason = row === null ? null : boundedText(row.reason, CRAG_BOUNDS.maxReasonChars);
    const score = row?.score;
    if (
      chunkId === null ||
      reason === null ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      !expected.has(chunkId) ||
      seen.has(chunkId)
    ) {
      return {
        ok: false,
        reason: "La ordenación trae un id, una puntuación o un motivo inválido.",
      };
    }
    seen.add(chunkId);
    ranking.push({ chunkId, score, reason });
  }
  if (seen.size !== expected.size) {
    return { ok: false, reason: "La ordenación omite un fragmento recuperado." };
  }
  const status = body.status;
  if (status !== "sufficient" && status !== "partial" && status !== "insufficient") {
    return { ok: false, reason: "El estado de la evidencia no es válido." };
  }
  const reason = boundedText(body.reason, CRAG_BOUNDS.maxReasonChars);
  if (reason === null) {
    return { ok: false, reason: "El motivo de la evidencia está vacío o es demasiado largo." };
  }
  if (!Array.isArray(body.gaps) || body.gaps.length > CRAG_BOUNDS.maxGaps) {
    return { ok: false, reason: "Las lagunas no tienen la forma esperada." };
  }
  const gaps: string[] = [];
  for (const gap of body.gaps) {
    const text = boundedText(gap, CRAG_BOUNDS.maxGapChars);
    if (text === null) {
      return { ok: false, reason: "Una laguna está vacía o es demasiado larga." };
    }
    gaps.push(text);
  }
  if (body.usefulIds.length > CRAG_BOUNDS.maxRetained) {
    return { ok: false, reason: "Hay demasiados fragmentos marcados como útiles." };
  }
  const usefulIds: string[] = [];
  const usefulSeen = new Set<string>();
  for (const id of body.usefulIds) {
    const chunkId = boundedText(id, CRAG_BOUNDS.maxIdChars);
    if (chunkId === null || !expected.has(chunkId) || usefulSeen.has(chunkId)) {
      return { ok: false, reason: "Los ids útiles no coinciden con los fragmentos recuperados." };
    }
    usefulSeen.add(chunkId);
    usefulIds.push(chunkId);
  }
  const usefulText = new Map(candidates.map((chunk) => [chunk.chunkId, chunk.text.trim()]));
  if (status === "insufficient") {
    if (usefulIds.length > 0 || gaps.length > 0) {
      return {
        ok: false,
        reason: "Una evidencia insuficiente no puede conservar fragmentos ni lagunas.",
      };
    }
  } else if (usefulIds.length === 0 || usefulIds.some((id) => usefulText.get(id) === "")) {
    return { ok: false, reason: "La evidencia útil no tiene texto recuperado." };
  } else if (status === "partial" && gaps.length === 0) {
    return { ok: false, reason: "Una evidencia parcial tiene que nombrar la laguna." };
  } else if (status === "sufficient" && gaps.length > 0) {
    return { ok: false, reason: "Una evidencia suficiente no lleva lagunas." };
  }
  return { ok: true, ranking, assessment: { status, reason, gaps, usefulIds } };
}

export function validateReformulation(
  raw: unknown,
  seenQueries: readonly string[],
): { ok: true; query: string } | { ok: false; reason: string } {
  const body = record(raw);
  const query = body === null ? null : boundedText(body.query, CRAG_BOUNDS.maxQueryChars);
  if (query === null) {
    return { ok: false, reason: "La reformulación está vacía o no es válida." };
  }
  const normalized = normalizeQuery(query);
  if (seenQueries.some((seen) => normalizeQuery(seen) === normalized)) {
    return { ok: false, reason: "La reformulación no cambia la búsqueda." };
  }
  return { ok: true, query };
}

export function orderByRanking(
  chunks: readonly CragChunk[],
  ranking: readonly RankedHit[],
  usefulIds: readonly string[],
): { ok: true; chunks: CragChunk[] } | { ok: false; reason: string } {
  if (usefulIds.length === 0) {
    return { ok: false, reason: "No hay fragmentos útiles para responder." };
  }
  const useful = new Set<string>();
  for (const id of usefulIds) {
    if (useful.has(id)) {
      return { ok: false, reason: "Los ids útiles están repetidos." };
    }
    useful.add(id);
  }
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const ordered: CragChunk[] = [];
  const seen = new Set<string>();
  for (const hit of ranking) {
    if (!useful.has(hit.chunkId) || seen.has(hit.chunkId)) {
      continue;
    }
    const chunk = byId.get(hit.chunkId);
    if (chunk === undefined || chunk.text.trim().length === 0) {
      return { ok: false, reason: "Un id útil no está entre la evidencia mostrada." };
    }
    seen.add(hit.chunkId);
    ordered.push({ ...chunk, score: hit.score });
  }
  if (seen.size !== useful.size) {
    return { ok: false, reason: "La ordenación no cubre la evidencia útil." };
  }
  return { ok: true, chunks: ordered.slice(0, CRAG_BOUNDS.maxRetained) };
}

export function retainEvidence(input: {
  retained: readonly CragChunk[];
  shown: readonly CragChunk[];
  usefulIds: readonly string[];
  ranking: readonly RankedHit[];
}): { ok: true; chunks: CragChunk[] } | { ok: false; reason: string } {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const chunk of input.retained) {
    if (!seen.has(chunk.chunkId)) {
      seen.add(chunk.chunkId);
      ids.push(chunk.chunkId);
    }
  }
  for (const id of input.usefulIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return orderByRanking(dedupeChunks([...input.shown, ...input.retained]), input.ranking, ids);
}

export function evidenceForAnswer(
  shown: readonly CragChunk[],
  usefulIds: readonly string[],
  ranking: readonly RankedHit[],
): { ok: true; chunks: CragChunk[] } | { ok: false; reason: string } {
  return orderByRanking(shown, ranking, usefulIds);
}
