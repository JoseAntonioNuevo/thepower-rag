import { RESEARCH_LIMITS } from "@thepower-rag/contracts";

/** Tope de turnos de usuario que entran en la memoria contextual. */
export const RESEARCH_MEMORY_TURNS = 8;
export const RESEARCH_MEMORY_CHARS = 1_200;
export const RESEARCH_MAX_USER_TURNS = 12;

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
export function contextualize(
  history: readonly MemoryTurn[],
  question: string,
): ContextualQuestion {
  const original = question.trim();
  if (history.length === 0) {
    return { original, contextualized: null };
  }
  const lines: string[] = [];
  let used = 0;
  for (const turn of history.slice(-RESEARCH_MEMORY_TURNS)) {
    const text = turn.text.replace(/\s+/g, " ").trim().slice(0, 280);
    if (text.length === 0) {
      continue;
    }
    const line = `${turn.role === "user" ? "Usuario" : "Investigación"}: ${text}`;
    if (used + line.length > RESEARCH_MEMORY_CHARS) {
      break;
    }
    lines.push(line);
    used += line.length;
  }
  if (lines.length === 0) {
    return { original, contextualized: null };
  }
  const prefix =
    "Contexto de esta conversación (no es evidencia del curso ni sustituye fuentes):\n";
  const suffix = `\n\nPregunta actual:\n${original}`;
  let body = lines.join("\n");
  const room = RESEARCH_LIMITS.maxQuestionChars - prefix.length - suffix.length;
  if (room < 1) {
    return { original, contextualized: null };
  }
  if (body.length > room) {
    body = body.slice(0, room);
  }
  return { original, contextualized: `${prefix}${body}${suffix}` };
}
