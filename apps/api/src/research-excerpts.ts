// GUÍA DE LECTURA · apps/api/src/research-excerpts.ts
// Extractos que el modelo puede elegir al citar: frases completas del texto mostrado. El modelo
// solo devuelve índices; el servidor copia el texto exacto, sin traducir ni inventar.
// Límites de la investigación.
import { RESEARCH_LIMITS } from "@thepower-rag/contracts";

/** Every choice remains a consecutive span of the exact shown source text. */
export function excerptChoices(text: string): string[] {
  // Extractos posibles.
  const choices: string[] = [];
  // Longitud máxima de un extracto.
  const cap = RESEARCH_LIMITS.maxExcerptChars;
  // Inicio de la frase actual.
  let start = 0;
  // Posiciones donde termina cada frase (tras . ! ? o ; seguidos de espacio o fin).
  const ends = [...text.matchAll(/[.!?;](?=\s|$)/g)].map((match) => match.index + 1);
  // El final del texto también cierra una frase.
  if (ends.at(-1) !== text.length) ends.push(text.length);
  // Recorre los finales.
  for (const end of ends) {
    // Frase completa sin espacios a los lados.
    const choice = text.slice(start, end).trim();
    // Omit an oversized sentence rather than starting inside its negation or
    // qualifier. Model-selected blocks never invent a suffix of that sentence.
    if (choice && choice.length <= cap) choices.push(choice);
    // La siguiente frase empieza aquí.
    start = end;
  }
  // Lista de extractos.
  return choices;
}

// Referencia a un extracto: fuente y posición.
export interface ExcerptReference {
  // Id de la fuente.
  sourceId: string;
  // Índice del extracto, desde 0.
  excerptIndex: number;
}

/** No fallback, fuzzy matching, translation or model-authored text. */
export function resolveExcerpt(
  reference: ExcerptReference,
  sources: readonly { sourceId: string; excerpts: readonly string[] }[],
): { text: string; sourceIds: string[] } {
  // Fuente referenciada.
  const source = sources.find((item) => item.sourceId === reference.sourceId);
  // Texto del extracto en esa posición.
  const text = source?.excerpts[reference.excerptIndex];
  // Índice no entero, negativo o inexistente: error.
  if (!Number.isInteger(reference.excerptIndex) || reference.excerptIndex < 0 || !text) {
    // Error controlado.
    throw new Error("research-excerpt-reference");
  }
  // Texto exacto y la fuente que lo respalda.
  return { text, sourceIds: [reference.sourceId] };
}
