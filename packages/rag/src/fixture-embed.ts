// GUÍA DE LECTURA · packages/rag/src/fixture-embed.ts
// Embedding léxico de la demostración (128 dimensiones): cada palabra suma ±1 en una posición
// elegida por un hash FNV-1a. No es semántico ni Vectorize; solo permite enseñar el flujo offline.
// Nombre del modelo de la demo.
export const FIXTURE_EMBEDDING_MODEL = "fixture-token-hash-v1";
// Dimensiones del vector de la demo.
export const FIXTURE_DIMENSIONS = 128;
// Umbral de similitud de la demo; solo vale para este coseno léxico.
export const FIXTURE_MIN_SCORE = 0.33;

// Palabras frecuentes que no aportan significado y se ignoran.
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

// Convierte un texto en un vector normalizado de 128 posiciones.
export function fixtureEmbed(text: string): number[] {
  // Vector inicial a cero.
  const vector = Array.from({ length: FIXTURE_DIMENSIONS }, () => 0);
  // Sin tildes y en minúsculas.
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  // Palabras de al menos tres letras o cifras, sin las palabras vacías.
  const tokens = (normalized.match(/[a-z0-9]{3,}/g) ?? []).filter(
    (token) => !FIXTURE_STOPWORDS.has(token),
  );
  // Cada palabra suma o resta 1 en una posición.
  for (const token of tokens) {
    // Hash FNV-1a de 32 bits: valor inicial estándar.
    let hash = 2166136261;
    // Recorre las letras.
    for (const char of token) {
      // XOR con el código de la letra.
      hash ^= char.charCodeAt(0);
      // Multiplica por el primo de FNV (Math.imul trabaja en 32 bits).
      hash = Math.imul(hash, 16777619);
    }
    // Posición del vector de esta palabra.
    const index = Math.abs(hash) % FIXTURE_DIMENSIONS;
    // Signo según el último bit.
    const sign = (hash & 1) === 0 ? 1 : -1;
    // Valor actual de la posición.
    const current = vector[index] ?? 0;
    // Suma o resta 1.
    vector[index] = current + sign;
  }
  // Norma euclídea del vector.
  const norm = Math.hypot(...vector);
  // Vector nulo si no hay palabras útiles.
  if (norm === 0) {
    // Se devuelve sin normalizar.
    return vector;
  }
  // Normaliza a longitud 1.
  return vector.map((value) => value / norm);
}

// Similitud coseno de dos vectores ya normalizados: basta con el producto escalar.
export function cosine(left: readonly number[], right: readonly number[]): number {
  // Longitudes distintas o vacías no se pueden comparar.
  if (left.length !== right.length || left.length === 0) {
    // Similitud cero.
    return 0;
  }
  // Acumulador del producto escalar.
  let dot = 0;
  // Recorre las posiciones.
  for (let index = 0; index < left.length; index += 1) {
    // Suma el producto de cada par de valores.
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }
  // Con vectores de longitud 1, el producto escalar es el coseno.
  return dot;
}
