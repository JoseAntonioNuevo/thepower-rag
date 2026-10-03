export const FIXTURE_EMBEDDING_MODEL = "fixture-token-hash-v1";
export const FIXTURE_DIMENSIONS = 128;
export const FIXTURE_MIN_SCORE = 0.33;

const FIXTURE_STOPWORDS = new Set([
  "para",
  "como",
  "con",
  "una",
  "uno",
  "los",
  "las",
  "del",
  "que",
  "por",
  "sobre",
  "esta",
  "este",
  "alumno",
  "contenido",
  "documentado",
  "objetivo",
  "sesion",
  "sesiones",
]);

export function fixtureEmbed(text: string): number[] {
  const vector = Array.from({ length: FIXTURE_DIMENSIONS }, () => 0);
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const tokens = (normalized.match(/[a-z0-9]{3,}/g) ?? []).filter(
    (token) => !FIXTURE_STOPWORDS.has(token),
  );
  for (const token of tokens) {
    let hash = 2166136261;
    for (const char of token) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % FIXTURE_DIMENSIONS;
    const sign = (hash & 1) === 0 ? 1 : -1;
    const current = vector[index] ?? 0;
    vector[index] = current + sign;
  }
  const norm = Math.hypot(...vector);
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => value / norm);
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0) {
    return 0;
  }
  let dot = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  return dot;
}
