import type { Audience, Citation, TraceEvent } from "@thepower-rag/contracts";
import { LIMITS } from "@thepower-rag/contracts";
import { isWeeklyScheduleQuestion, calendarOverviewId, calendarOverviewOutcome } from "./calendar";
import { cosine } from "./fixture-embed";

export interface IndexedChunk {
  documentId: string;
  chunkId: string;
  title: string;
  section: string;
  text: string;
  audience: Audience;
  corpusVersion: string;
  vector: readonly number[];
}

export interface RetrievalOutcome {
  decision: "answer" | "refuse" | "clarify";
  evidence: IndexedChunk[];
  trace: TraceEvent;
}

export function allowsAudience(chunkAudience: Audience, requested: Audience): boolean {
  if (requested === "program") {
    return chunkAudience === "program";
  }
  return chunkAudience === "program" || chunkAudience === requested;
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 280 ? `${flat.slice(0, 277)}...` : flat;
}

export function citationsFor(chunks: readonly IndexedChunk[]): Citation[] {
  return chunks.map((chunk) => ({
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    title: chunk.title,
    section: chunk.section,
    excerpt: excerpt(chunk.text),
    corpusVersion: chunk.corpusVersion,
  }));
}

const CITE_OPEN = "[cite:";
const CITE_ID = /^\[cite:([A-Za-z0-9:_-]{1,128})\]/;
const MAX_CITE_BUFFER = CITE_OPEN.length + 128 + 1;

function isCitationPrefix(tail: string): boolean {
  if (tail.length > MAX_CITE_BUFFER || tail.includes("]")) {
    return false;
  }
  return CITE_OPEN.startsWith(tail) || tail.startsWith(CITE_OPEN);
}

export function suppressUnknownCitations(text: string, allowed: ReadonlySet<string>): string {
  return text.replace(/\[cite:([A-Za-z0-9:_-]{1,128})\]/g, (match, id: string) =>
    allowed.has(id) ? match : "",
  );
}

export function splitCitationBuffer(
  pending: string,
  allowed: ReadonlySet<string>,
): { emit: string; rest: string } {
  const open = pending.lastIndexOf("[");
  if (open === -1) {
    return { emit: suppressUnknownCitations(pending, allowed), rest: "" };
  }
  const tail = pending.slice(open);
  if (!isCitationPrefix(tail) || CITE_ID.test(tail)) {
    return { emit: suppressUnknownCitations(pending, allowed), rest: "" };
  }
  return {
    emit: suppressUnknownCitations(pending.slice(0, open), allowed),
    rest: tail,
  };
}

export function isScheduleQuestion(question: string): boolean {
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/\b(?:entrega|plazo|rubrica)\b/.test(normalized)) return false;
  if (/\bcuando\s+(?:conviene|compensa|plantea|usar|se usa|necesito)\b/.test(normalized))
    return false;
  return (
    isWeeklyScheduleQuestion(question) ||
    /\b(?:fecha|calendario|horario|que dias?|dia de la sesion)\b/.test(normalized) ||
    /\bcuando\s+(?:es|son|hay|tenemos|empieza|comienza|termina|se imparte|se celebra|se da)\b/.test(
      normalized,
    ) ||
    /\b(?:quien imparte|quien ensena|que profesor|que profesores|profesores del curso)\b/.test(
      normalized,
    )
  );
}

export function gateScoredChunks(input: {
  question: string;
  audience: Audience;
  corpusVersion: string;
  embeddingLabel: string;
  scoreMeaning: string;
  minScore: number;
  ranked: readonly { chunk: IndexedChunk; score: number | null }[];
}): RetrievalOutcome {
  const base = {
    query: input.question,
    queryRewrite: "pending" as const,
    corpusVersion: input.corpusVersion,
    embedding: input.embeddingLabel,
    scoreMeaning: input.scoreMeaning,
  };
  const visible = input.ranked.filter(
    (item) =>
      item.chunk.corpusVersion === input.corpusVersion &&
      allowsAudience(item.chunk.audience, input.audience),
  );
  const retrieved = visible.map((item) => ({
    chunkId: item.chunk.chunkId,
    score: item.score,
    selected: item.score !== null && item.score >= input.minScore,
  }));
  const selected = visible.filter((item) => item.score !== null && item.score >= input.minScore);
  if (selected.length === 0) {
    return {
      decision: "refuse",
      evidence: [],
      trace: {
        ...base,
        retrieved,
        decision: "refuse",
        generation: "skipped",
        status: "Ningún fragmento supera el umbral de la canalización.",
      },
    };
  }
  return {
    decision: "answer",
    evidence: selected.map((item) => item.chunk),
    trace: {
      ...base,
      retrieved,
      decision: "answer",
      generation: "called",
      status: "Hay contexto seleccionado para generar.",
    },
  };
}

export function retrieveBasic(input: {
  question: string;
  audience: Audience;
  chunks: readonly IndexedChunk[];
  embed: (text: string) => readonly number[];
  minScore: number;
  embeddingLabel: string;
  corpusVersion: string;
  scoreMeaning: string;
}): RetrievalOutcome {
  const base = {
    query: input.question,
    queryRewrite: "pending" as const,
    corpusVersion: input.corpusVersion,
    embedding: input.embeddingLabel,
    scoreMeaning: input.scoreMeaning,
  };
  if (input.audience === "program" && isScheduleQuestion(input.question)) {
    return {
      decision: "clarify",
      evidence: [],
      trace: {
        ...base,
        retrieved: [],
        decision: "clarify",
        generation: "skipped",
        status: "Falta el grupo para una pregunta de calendario.",
      },
    };
  }
  if (isWeeklyScheduleQuestion(input.question)) {
    const id = calendarOverviewId(input.audience, input.corpusVersion);
    const chunk = input.chunks.find((item) => item.chunkId === id) ?? null;
    return calendarOverviewOutcome({
      question: input.question,
      audience: input.audience,
      corpusVersion: input.corpusVersion,
      chunk,
    });
  }
  const queryVector = input.embed(input.question);
  const ranked = input.chunks
    .filter((chunk) => allowsAudience(chunk.audience, input.audience))
    .filter((chunk) => chunk.corpusVersion === input.corpusVersion)
    .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.vector) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, LIMITS.retrievalTopK);
  return gateScoredChunks({
    question: input.question,
    audience: input.audience,
    corpusVersion: input.corpusVersion,
    embeddingLabel: input.embeddingLabel,
    scoreMeaning: input.scoreMeaning,
    minScore: input.minScore,
    ranked,
  });
}
