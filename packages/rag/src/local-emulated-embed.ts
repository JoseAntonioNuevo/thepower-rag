// GUÍA DE LECTURA · packages/rag/src/local-emulated-embed.ts
// Embedding emulado para pruebas locales sin Workers AI: cada palabra suma ±1 en una posición
// elegida por un hash. No es semántico; solo permite recorrer el flujo real del índice en local.
// Nombre del modelo emulado, para no confundirlo con BGE-M3.
export const LOCAL_EMULATED_EMBEDDING_MODEL = "local-emulated-token-hash-v1";
// Dimensiones del vector emulado.
export const LOCAL_EMULATED_DIMENSIONS = 32;
// Umbral de similitud de este emulador; no vale para BGE-M3.
export const LOCAL_EMULATED_MIN_SCORE = 0.55;

// Palabras frecuentes que no aportan significado y se ignoran.
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

// Convierte un texto en un vector normalizado de 32 posiciones.
export function localEmulatedEmbed(text: string): number[] {
  // Vector inicial con todas las posiciones a cero.
  const vector = Array.from({ length: LOCAL_EMULATED_DIMENSIONS }, () => 0);
  // Sin tildes y en minúsculas.
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Palabras de al menos tres letras o cifras, sin las palabras vacías.
  const tokens = (normalized.match(/[a-z0-9]{3,}/g) ?? []).filter((token) => !STOPWORDS.has(token));
  // Cada palabra suma o resta 1 en una posición del vector.
  for (const token of tokens) {
    // Hash de la palabra al estilo FNV-1a de 32 bits, con una semilla propia de este emulador.
    let hash = 2166136289;
    // Recorre las letras de la palabra.
    for (const char of token) {
      // XOR con el código de la letra.
      hash ^= char.charCodeAt(0);
      // Multiplica por el primo de FNV en 32 bits (Math.imul).
      hash = Math.imul(hash, 16777619);
    }
    // Posición del vector que corresponde a la palabra.
    const index = Math.abs(hash) % LOCAL_EMULATED_DIMENSIONS;
    // Signo según el último bit del hash.
    const sign = (hash & 1) === 0 ? 1 : -1;
    // Valor actual de esa posición.
    const current = vector[index] ?? 0;
    // Suma o resta 1.
    vector[index] = current + sign;
  }
  // Longitud del vector (norma euclídea).
  const norm = Math.hypot(...vector);
  // Un texto sin palabras útiles da un vector nulo.
  if (norm === 0) {
    // Se devuelve tal cual: no se puede normalizar.
    return vector;
  }
  // Divide cada posición por la norma: el vector queda con longitud 1.
  return vector.map((value) => value / norm);
}
