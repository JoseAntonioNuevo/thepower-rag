// GUÍA DE LECTURA · packages/rag/src/calendar.ts
// Atajo del RAG para la pregunta general «¿qué días y a qué hora son las clases?»: en lugar de
// buscar por embeddings, toma directamente la ficha del calendario del grupo por sus metadatos.
// Tipo de audiencia (programa o cohorte).
import type { Audience } from "@thepower-rag/contracts";
// Tipos del fragmento indexado y del resultado de una recuperación.
import type { IndexedChunk, RetrievalOutcome } from "./pipeline";

// Only a general weekly timetable is an exact metadata lookup. Specific dates,
// sessions, teachers and topics keep their normal retrieval path.
export function isWeeklyScheduleQuestion(question: string): boolean {
  // Quita tildes (NFD separa letra y tilde, y la expresión borra las tildes) y pasa a minúsculas.
  const text = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Fechas, sesiones, números o meses concretos no son el horario general: búsqueda normal.
  if (
    /\b(?:s\d+|sesion\s*\d+|\d+|fecha|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|hoy|manana|proxim[oa]|siguiente|mes)\b/.test(
      text,
    )
  )
    return false;
  // «Clases de/sobre X» habla de un tema, salvo que X sea el propio curso o el grupo.
  if (
    /\bclases?\s+(?:de|sobre|con)\s+(?!este\s+curso\b|el\s+curso\b|curso\b|nuestro\s+curso\b|mi\s+grupo\b)/.test(
      text,
    )
  )
    return false;
  // Solo cuenta como horario general si pregunta por los días o el horario de las clases.
  return (
    /\b(?:que|cuales|en que)\s+(?:son\s+)?(?:los\s+)?dias?(?:\s+de\s+la\s+semana)?\b.*\bclases?\b/.test(
      text,
    ) ||
    /\bdias?\s+de\s+(?:las\s+)?clases?\b/.test(text) ||
    /\bhorario\s+(?:habitual\s+)?(?:de\s+)?(?:las?\s+)?clases?\b/.test(text)
  );
}
// Identificador del fragmento de calendario del grupo; el programa completo no tiene uno.
export function calendarOverviewId(audience: Audience, corpusVersion: string): string | null {
  // Programa: no hay ficha; cohorte: id con la versión y el calendario lx o mj.
  return audience === "program"
    ? null
    : `${corpusVersion}:calendario-${audience === "L/X" ? "lx" : "mj"}:00`;
}
// Resultado de la búsqueda exacta del calendario, con su traza explicable.
export function calendarOverviewOutcome(input: {
  // Pregunta del alumno.
  question: string;
  // Grupo seleccionado.
  audience: Audience;
  // Versión del corpus consultada.
  corpusVersion: string;
  // Fragmento leído de la base de datos, o null si no se encontró.
  chunk: IndexedChunk | null;
}): RetrievalOutcome {
  // Identificador que debería tener la ficha.
  const expectedId = calendarOverviewId(input.audience, input.corpusVersion);
  // Fragmento recibido.
  const chunk = input.chunk;
  // Solo es válido si coincide id, versión, grupo y documento, y tiene texto.
  const valid =
    !!chunk &&
    chunk.chunkId === expectedId &&
    chunk.corpusVersion === input.corpusVersion &&
    chunk.audience === input.audience &&
    chunk.documentId === (input.audience === "L/X" ? "calendario-lx" : "calendario-mj") &&
    chunk.text.trim().length > 0;
  // Responder con la ficha si es válida; si no, rechazar sin llamar al modelo.
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
