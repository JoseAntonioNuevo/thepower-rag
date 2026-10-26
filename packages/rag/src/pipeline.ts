// GUÍA DE LECTURA · packages/rag/src/pipeline.ts
// Recuperación del RAG básico: filtra por grupo y versión, ordena por similitud, aplica el umbral
// y decide responder, rechazar o pedir aclaración. También filtra las citas [cite:id] del stream.
// Tipos de audiencia, cita y traza.
import type { Audience, Citation, TraceEvent } from "@thepower-rag/contracts";
// Límites compartidos (número de fragmentos recuperados).
import { LIMITS } from "@thepower-rag/contracts";
// Atajo exacto del horario semanal.
import { isWeeklyScheduleQuestion, calendarOverviewId, calendarOverviewOutcome } from "./calendar";
// Similitud coseno de la demostración.
import { cosine } from "./fixture-embed";

// Fragmento del índice con su vector.
export interface IndexedChunk {
  // Documento al que pertenece.
  documentId: string;
  // Identificador del fragmento.
  chunkId: string;
  // Título del documento.
  title: string;
  // Sección.
  section: string;
  // Texto.
  text: string;
  // Audiencia del fragmento.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Vector de embeddings.
  vector: readonly number[];
}

// Resultado de una recuperación.
export interface RetrievalOutcome {
  // Responder, rechazar o pedir aclaración.
  decision: "answer" | "refuse" | "clarify";
  // Fragmentos que se usarán como evidencia.
  evidence: IndexedChunk[];
  // Traza que se enseña en la interfaz.
  trace: TraceEvent;
}

// ¿Puede ver este fragmento quien pregunta con esta audiencia?
export function allowsAudience(chunkAudience: Audience, requested: Audience): boolean {
  // Quien pregunta por el programa completo solo ve fragmentos del programa.
  if (requested === "program") {
    // Nada de calendarios de cohorte.
    return chunkAudience === "program";
  }
  // Una cohorte ve el programa y su propio calendario.
  return chunkAudience === "program" || chunkAudience === requested;
}

// Extracto corto de un fragmento para la cita.
function excerpt(text: string): string {
  // Junta los espacios y saltos de línea en un solo espacio.
  const flat = text.replace(/\s+/g, " ").trim();
  // Como mucho 280 caracteres, con puntos suspensivos si se recorta.
  return flat.length > 280 ? `${flat.slice(0, 277)}...` : flat;
}

// Convierte fragmentos en citas para el navegador.
export function citationsFor(chunks: readonly IndexedChunk[]): Citation[] {
  // Una cita por fragmento con su extracto.
  return chunks.map((chunk) => ({
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    title: chunk.title,
    section: chunk.section,
    excerpt: excerpt(chunk.text),
    corpusVersion: chunk.corpusVersion,
  }));
}

// Comienzo de una marca de cita en el texto del modelo.
const CITE_OPEN = "[cite:";
// Marca completa: [cite:id] con un id de hasta 128 caracteres válidos.
const CITE_ID = /^\[cite:([A-Za-z0-9:_-]{1,128})\]/;
// Caracteres máximos que puede ocupar una marca sin cerrar.
const MAX_CITE_BUFFER = CITE_OPEN.length + 128 + 1;

// ¿Podría este final del texto ser el comienzo de una marca de cita?
function isCitationPrefix(tail: string): boolean {
  // Demasiado largo o ya cerrado: no es una marca a medias.
  if (tail.length > MAX_CITE_BUFFER || tail.includes("]")) {
    // No hay que esperar más texto.
    return false;
  }
  // Es un prefijo de «[cite:» o empieza por él.
  return CITE_OPEN.startsWith(tail) || tail.startsWith(CITE_OPEN);
}

// Quita del texto las citas a fragmentos que no se recuperaron (el modelo no puede inventarlas).
export function suppressUnknownCitations(text: string, allowed: ReadonlySet<string>): string {
  // replace con función: cada marca se conserva solo si su id está permitido.
  return text.replace(/\[cite:([A-Za-z0-9:_-]{1,128})\]/g, (match, id: string) =>
    allowed.has(id) ? match : "",
  );
}

// Divide el texto recibido en streaming: lo que ya se puede mostrar y lo que hay que esperar.
export function splitCitationBuffer(
  pending: string,
  allowed: ReadonlySet<string>,
): { emit: string; rest: string } {
  // Posición del último corchete abierto.
  const open = pending.lastIndexOf("[");
  // Sin corchetes: todo se puede mostrar.
  if (open === -1) {
    // Se emite filtrando citas desconocidas.
    return { emit: suppressUnknownCitations(pending, allowed), rest: "" };
  }
  // Texto desde el último corchete.
  const tail = pending.slice(open);
  // Si no puede ser una marca o ya está completa, se emite todo.
  if (!isCitationPrefix(tail) || CITE_ID.test(tail)) {
    // Se emite filtrando citas desconocidas.
    return { emit: suppressUnknownCitations(pending, allowed), rest: "" };
  }
  // Puede ser una marca a medias: se emite lo anterior y se guarda el resto.
  return {
    emit: suppressUnknownCitations(pending.slice(0, open), allowed),
    rest: tail,
  };
}

// ¿Pregunta por fechas, horarios o profesores? Entonces necesita saber la cohorte.
export function isScheduleQuestion(question: string): boolean {
  // Sin tildes y en minúsculas.
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Entregas, plazos y rúbricas no son preguntas de calendario.
  if (/\b(?:entrega|plazo|rubrica)\b/.test(normalized))
    // Rechaza esta condición y comunica el resultado negativo al llamador.
    return false;
  // «Cuándo conviene/usar…» habla de técnica, no de fechas.
  if (/\bcuando\s+(?:conviene|compensa|plantea|usar|se usa|necesito)\b/.test(normalized))
    // Rechaza esta condición y comunica el resultado negativo al llamador.
    return false;
  // Horario semanal, fechas, calendario, «cuándo es…» o quién imparte.
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

// Aplica el umbral a fragmentos ya puntuados y construye la traza.
export function gateScoredChunks(input: {
  // Pregunta.
  question: string;
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Nombre del embedding usado.
  embeddingLabel: string;
  // Qué significa la puntuación de ese índice.
  scoreMeaning: string;
  // Puntuación mínima para usar un fragmento.
  minScore: number;
  // Fragmentos con su puntuación, ya ordenados.
  ranked: readonly { chunk: IndexedChunk; score: number | null }[];
}): RetrievalOutcome {
  // Campos comunes de la traza.
  const base = {
    query: input.question,
    queryRewrite: "pending" as const,
    corpusVersion: input.corpusVersion,
    embedding: input.embeddingLabel,
    scoreMeaning: input.scoreMeaning,
  };
  // Solo los de la versión pedida y visibles para esa audiencia.
  const visible = input.ranked.filter(
    (item) =>
      item.chunk.corpusVersion === input.corpusVersion &&
      allowsAudience(item.chunk.audience, input.audience),
  );
  // Traza de lo recuperado: cada fragmento con su puntuación y si supera el umbral.
  const retrieved = visible.map((item) => ({
    chunkId: item.chunk.chunkId,
    score: item.score,
    selected: item.score !== null && item.score >= input.minScore,
  }));
  // Fragmentos que superan el umbral.
  const selected = visible.filter((item) => item.score !== null && item.score >= input.minScore);
  // Ninguno supera el umbral: se rechaza sin llamar al modelo.
  if (selected.length === 0) {
    // Respuesta de rechazo con su traza.
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
  // Hay contexto suficiente: se responde con esos fragmentos.
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

// Recuperación completa del RAG básico de la demostración.
export function retrieveBasic(input: {
  // Pregunta.
  question: string;
  // Audiencia.
  audience: Audience;
  // Fragmentos del índice.
  chunks: readonly IndexedChunk[];
  // Función que convierte un texto en vector.
  embed: (text: string) => readonly number[];
  // Umbral.
  minScore: number;
  // Nombre del embedding.
  embeddingLabel: string;
  // Versión del corpus.
  corpusVersion: string;
  // Qué significa la puntuación.
  scoreMeaning: string;
  // Si el corpus tiene grupos y calendario. Sin valor, sí (curso); la tienda no los tiene.
  groups?: boolean;
}): RetrievalOutcome {
  // Campos comunes de la traza.
  const base = {
    query: input.question,
    queryRewrite: "pending" as const,
    corpusVersion: input.corpusVersion,
    embedding: input.embeddingLabel,
    scoreMeaning: input.scoreMeaning,
  };
  // ¿Corpus con grupos y calendario?
  const groups = input.groups !== false;
  // Pregunta de calendario sin cohorte: se pide aclaración antes de buscar.
  if (groups && input.audience === "program" && isScheduleQuestion(input.question)) {
    // Aclaración sin llamar al modelo.
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
  // Horario semanal: atajo exacto por metadatos (solo con calendarios).
  if (groups && isWeeklyScheduleQuestion(input.question)) {
    // Id de la ficha del calendario del grupo.
    const id = calendarOverviewId(input.audience, input.corpusVersion);
    // Busca esa ficha entre los fragmentos.
    const chunk = input.chunks.find((item) => item.chunkId === id) ?? null;
    // Resultado del atajo.
    return calendarOverviewOutcome({
      question: input.question,
      audience: input.audience,
      corpusVersion: input.corpusVersion,
      chunk,
    });
  }
  // Vector de la pregunta.
  const queryVector = input.embed(input.question);
  // Filtra por audiencia y versión, puntúa con el coseno, ordena de mayor a menor y se queda con los primeros.
  const ranked = input.chunks
    .filter((chunk) => allowsAudience(chunk.audience, input.audience))
    .filter((chunk) => chunk.corpusVersion === input.corpusVersion)
    .map((chunk) => ({ chunk, score: cosine(queryVector, chunk.vector) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, LIMITS.retrievalTopK);
  // Aplica el umbral y construye la traza.
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
