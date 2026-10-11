import { RESEARCH_LIMITS } from "@thepower-rag/contracts";

/** Tope de turnos de usuario que entran en la memoria contextual. */
export const RESEARCH_MEMORY_TURNS = 8;
export const RESEARCH_MEMORY_CHARS = 1_200;
export const RESEARCH_MAX_USER_TURNS = 12;
export const RESEARCH_MEMORY_HEADER =
  "Contexto de esta conversación (no es evidencia del curso ni sustituye fuentes):\n";

export interface MemoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ContextualQuestion {
  original: string;
  /** Null cuando no hay turnos previos. No es evidencia del curso. */
  contextualized: string | null;
}

/**
 * La memoria resuelve referencias. No crea hechos del curso ni sustituye
 * una fuente. La pregunta actual no se recorta para hacer sitio al contexto.
 */
/** Texto de turno para la memoria. No incluye bytes ni base64. */
export function admittedTurnText(input: {
  typed: string;
  image: { id: string; text: string } | null;
  audio: { id: string; text: string } | null;
}): string {
  const parts: string[] = [];
  const typed = input.typed.trim();
  if (typed.length > 0) parts.push(typed.slice(0, 400));
  if (input.image && input.image.text.trim().length > 0) {
    parts.push(`Imagen ${input.image.id}: ${input.image.text.trim().slice(0, 400)}`);
  }
  if (input.audio && input.audio.text.trim().length > 0) {
    parts.push(`Audio ${input.audio.id}: ${input.audio.text.trim().slice(0, 400)}`);
  }
  return parts.join("\n").slice(0, RESEARCH_MEMORY_CHARS);
}

export function contextualize(
  history: readonly MemoryTurn[],
  question: string,
): ContextualQuestion {
  const original = question.trim();
  if (history.length === 0) {
    return { original, contextualized: null };
  }
  const recent = history.slice(-RESEARCH_MEMORY_TURNS);
  const ranked = [
    ...recent.filter((turn) => turn.role === "user"),
    ...recent.filter((turn) => turn.role !== "user"),
  ];
  const chosen = new Set<MemoryTurn>();
  const lineOf = new Map<MemoryTurn, string>();
  let used = 0;
  for (const turn of ranked) {
    const cap = turn.role === "user" ? 500 : 160;
    const text = turn.text.replace(/\s+/g, " ").trim().slice(0, cap);
    if (text.length === 0) continue;
    const line = `${turn.role === "user" ? "Usuario" : "Investigación"}: ${text}`;
    if (used + line.length > RESEARCH_MEMORY_CHARS) continue;
    chosen.add(turn);
    lineOf.set(turn, line);
    used += line.length;
  }
  const lines = recent.flatMap((turn) => {
    const line = lineOf.get(turn);
    return chosen.has(turn) && line !== undefined ? [line] : [];
  });
  if (lines.length === 0) {
    return { original, contextualized: null };
  }
  const prefix = RESEARCH_MEMORY_HEADER;
  const suffix = `\n\nPregunta actual:\n${original}`;
  let body = lines.join("\n");
  const room = RESEARCH_LIMITS.maxQuestionChars - prefix.length - suffix.length;
  if (room < 1) {
    return { original, contextualized: null };
  }
  if (body.length > room) {
    body = body.slice(body.length - room);
  }
  return { original, contextualized: `${prefix}${body}${suffix}` };
}
