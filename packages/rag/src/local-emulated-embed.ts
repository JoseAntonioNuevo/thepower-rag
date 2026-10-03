export const LOCAL_EMULATED_EMBEDDING_MODEL = "local-emulated-token-hash-v1";
export const LOCAL_EMULATED_DIMENSIONS = 32;
export const LOCAL_EMULATED_MIN_SCORE = 0.55;

const STOPWORDS = new Set([
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
]);

export function localEmulatedEmbed(text: string): number[] {
  const vector = Array.from({ length: LOCAL_EMULATED_DIMENSIONS }, () => 0);
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const tokens = (normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((token) => !STOPWORDS.has(token));
  for (const token of tokens) {
    let hash = 2166136289;
    for (const char of token) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    const index = Math.abs(hash) % LOCAL_EMULATED_DIMENSIONS;
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
