import { RESEARCH_LIMITS } from "@thepower-rag/contracts";

/** Every choice remains a consecutive span of the exact shown source text. */
export function excerptChoices(text: string): string[] {
  const choices: string[] = [];
  const cap = RESEARCH_LIMITS.maxExcerptChars;
  let start = 0;
  const ends = [...text.matchAll(/[.!?;](?=\s|$)/g)].map((match) => match.index + 1);
  if (ends.at(-1) !== text.length) ends.push(text.length);
  for (const end of ends) {
    const choice = text.slice(start, end).trim();
    // Omit an oversized sentence rather than starting inside its negation or
    // qualifier. Model-selected blocks never invent a suffix of that sentence.
    if (choice && choice.length <= cap) choices.push(choice);
    start = end;
  }
  return choices;
}

export interface ExcerptReference {
  sourceId: string;
  excerptIndex: number;
}

/** No fallback, fuzzy matching, translation or model-authored text. */
export function resolveExcerpt(
  reference: ExcerptReference,
  sources: readonly { sourceId: string; excerpts: readonly string[] }[],
): { text: string; sourceIds: string[] } {
  const source = sources.find((item) => item.sourceId === reference.sourceId);
  const text = source?.excerpts[reference.excerptIndex];
  if (!Number.isInteger(reference.excerptIndex) || reference.excerptIndex < 0 || !text) {
    throw new Error("research-excerpt-reference");
  }
  return { text, sourceIds: [reference.sourceId] };
}
