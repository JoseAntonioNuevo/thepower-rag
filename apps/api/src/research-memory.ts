// GUÍA DE LECTURA · apps/api/src/research-memory.ts
// Memoria de la conversación de investigación: resume turnos anteriores para resolver referencias
// («ese pedido», «lo anterior») sin convertirlos en evidencia de la tienda.
// Límites de la investigación.
import { RESEARCH_LIMITS } from "@thepower-rag/contracts";

/** Tope de turnos de usuario que entran en la memoria contextual. */
export const RESEARCH_MEMORY_TURNS = 8;
// Caracteres máximos de la memoria.
export const RESEARCH_MEMORY_CHARS = 1_200;
// Turnos del usuario admitidos en una conversación.
export const RESEARCH_MAX_USER_TURNS = 12;
// Cabecera que marca la memoria como contexto, no como evidencia.
export const RESEARCH_MEMORY_HEADER =
  "Contexto de esta conversación (no es evidencia de la tienda ni sustituye fuentes):\n";

// Turno de la memoria.
export interface MemoryTurn {
  // Usuario o investigación.
  role: "user" | "assistant";
  // Texto del turno.
  text: string;
}

// Pregunta original y su versión con contexto.
export interface ContextualQuestion {
  // Pregunta tal como la escribió el usuario.
  original: string;
  /** Null cuando no hay turnos previos. No es evidencia de la tienda. */
  contextualized: string | null;
}

/**
 * La memoria resuelve referencias. No crea hechos de la tienda ni sustituye
 * una fuente. La pregunta actual no se recorta para hacer sitio al contexto.
 */
/** Texto de turno para la memoria. No incluye bytes ni base64. */
export function admittedTurnText(input: {
  // Texto escrito.
  typed: string;
  // Lectura de la imagen.
  image: { id: string; text: string } | null;
  // Transcripción del audio.
  audio: { id: string; text: string } | null;
}): string {
  // Partes del turno.
  const parts: string[] = [];
  // Texto escrito sin espacios.
  const typed = input.typed.trim();
  // Hasta 400 caracteres de texto escrito.
  if (typed.length > 0) parts.push(typed.slice(0, 400));
  // Lectura de la imagen, si la hay.
  if (input.image && input.image.text.trim().length > 0) {
    // Con su id y recortada.
    parts.push(`Imagen ${input.image.id}: ${input.image.text.trim().slice(0, 400)}`);
  }
  // Transcripción, si la hay.
  if (input.audio && input.audio.text.trim().length > 0) {
    // Con su id y recortada.
    parts.push(`Audio ${input.audio.id}: ${input.audio.text.trim().slice(0, 400)}`);
  }
  // Turno con el tope de la memoria.
  return parts.join("\n").slice(0, RESEARCH_MEMORY_CHARS);
}

// Añade a la pregunta el contexto de los turnos recientes.
export function contextualize(
  history: readonly MemoryTurn[],
  question: string,
): ContextualQuestion {
  // Pregunta sin espacios a los lados.
  const original = question.trim();
  // Sin historial no hay contexto.
  if (history.length === 0) {
    // Solo la original.
    return { original, contextualized: null };
  }
  // Turnos recientes.
  const recent = history.slice(-RESEARCH_MEMORY_TURNS);
  // Primero los del usuario y después los de la investigación.
  const ranked = [
    ...recent.filter((turn) => turn.role === "user"),
    ...recent.filter((turn) => turn.role !== "user"),
  ];
  // Turnos elegidos.
  const chosen = new Set<MemoryTurn>();
  // Línea de cada turno elegido.
  const lineOf = new Map<MemoryTurn, string>();
  // Caracteres usados.
  let used = 0;
  // Revisa los turnos en ese orden de prioridad.
  for (const turn of ranked) {
    // El usuario admite más texto que la investigación.
    const cap = turn.role === "user" ? 500 : 160;
    // Texto compactado y recortado.
    const text = turn.text.replace(/\s+/g, " ").trim().slice(0, cap);
    // Vacío: se salta.
    if (text.length === 0)
      // Omite el resto de esta iteración y pasa al siguiente elemento.
      continue;
    // Línea con el papel.
    const line = `${turn.role === "user" ? "Usuario" : "Investigación"}: ${text}`;
    // Si no cabe, se salta.
    if (used + line.length > RESEARCH_MEMORY_CHARS)
      // Omite el resto de esta iteración y pasa al siguiente elemento.
      continue;
    // Se elige.
    chosen.add(turn);
    // Guarda su línea.
    lineOf.set(turn, line);
    // Suma los caracteres.
    used += line.length;
  }
  // Líneas en orden cronológico.
  const lines = recent.flatMap((turn) => {
    // Línea del turno.
    const line = lineOf.get(turn);
    // Solo los elegidos.
    return chosen.has(turn) && line !== undefined ? [line] : [];
  });
  // Nada elegido.
  if (lines.length === 0) {
    // Sin contexto.
    return { original, contextualized: null };
  }
  // Cabecera.
  const prefix = RESEARCH_MEMORY_HEADER;
  // Pregunta actual al final.
  const suffix = `\n\nPregunta actual:\n${original}`;
  // Contexto.
  let body = lines.join("\n");
  // Espacio que queda para el contexto.
  const room = RESEARCH_LIMITS.maxQuestionChars - prefix.length - suffix.length;
  // Sin espacio.
  if (room < 1) {
    // Sin contexto.
    return { original, contextualized: null };
  }
  // Si no cabe, se conserva el final (lo más reciente).
  if (body.length > room) {
    // Recorta por el principio.
    body = body.slice(body.length - room);
  }
  // Pregunta con contexto.
  return { original, contextualized: `${prefix}${body}${suffix}` };
}
