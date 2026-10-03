import type { Audience } from "@thepower-rag/contracts";
import type { IndexedChunk, RetrievalOutcome } from "./pipeline";

// Only a general weekly timetable is an exact metadata lookup. Specific dates,
// sessions, teachers and topics keep their normal retrieval path.
export function isWeeklyScheduleQuestion(question: string): boolean {
  const text = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (
    /\b(?:s\d+|sesion\s*\d+|\d+|fecha|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|hoy|manana|proxim[oa]|siguiente|mes)\b/.test(
      text,
    )
  )
    return false;
  if (
    /\bclases?\s+(?:de|sobre|con)\s+(?!este\s+curso\b|el\s+curso\b|curso\b|nuestro\s+curso\b|mi\s+grupo\b)/.test(
      text,
    )
  )
    return false;
  return (
    /\b(?:que|cuales|en que)\s+(?:son\s+)?(?:los\s+)?dias?(?:\s+de\s+la\s+semana)?\b.*\bclases?\b/.test(
      text,
    ) ||
    /\bdias?\s+de\s+(?:las\s+)?clases?\b/.test(text) ||
    /\bhorario\s+(?:habitual\s+)?(?:de\s+)?(?:las?\s+)?clases?\b/.test(text)
  );
}
export function calendarOverviewId(audience: Audience, corpusVersion: string): string | null {
  return audience === "program"
    ? null
    : `${corpusVersion}:calendario-${audience === "L/X" ? "lx" : "mj"}:00`;
}
export function calendarOverviewOutcome(input: {
  question: string;
  audience: Audience;
  corpusVersion: string;
  chunk: IndexedChunk | null;
}): RetrievalOutcome {
  const expectedId = calendarOverviewId(input.audience, input.corpusVersion);
  const chunk = input.chunk;
  const valid =
    !!chunk &&
    chunk.chunkId === expectedId &&
    chunk.corpusVersion === input.corpusVersion &&
    chunk.audience === input.audience &&
    chunk.documentId === (input.audience === "L/X" ? "calendario-lx" : "calendario-mj") &&
    chunk.text.trim().length > 0;
  return {
    decision: valid ? "answer" : "refuse",
    evidence: valid ? [chunk] : [],
    trace: {
      query: input.question,
      queryRewrite: "pending",
      corpusVersion: input.corpusVersion,
      embedding: "No ejecutado: búsqueda exacta del calendario por grupo",
      scoreMeaning:
        "Selección por metadatos de grupo, versión y documento. No se ha calculado un coseno ni una probabilidad.",
      retrieved: valid ? [{ chunkId: chunk.chunkId, score: null, selected: true }] : [],
      decision: valid ? "answer" : "refuse",
      generation: valid ? "called" : "skipped",
      status: valid
        ? "Recuperada la ficha de días y horario del calendario del grupo seleccionado."
        : "No hay una ficha de calendario válida para este grupo y versión.",
    },
  };
}
