// GUÍA DE LECTURA · lab/src/embeddings.ts
// Generación y validación de embeddings de 768 dimensiones para documentos y consultas del laboratorio,
// con cálculo de distancia coseno (<=> de pgvector) y similitud coseno (1 - distancia).
// Huella FNV-1a del paquete core.
import { fnv1a64 } from "@thepower-rag/core";
// Dimensión fija de 768 exigida por el ejercicio.
import { LAB_EMBEDDING_DIMENSIONS } from "./config";

// Interfaz del proveedor de embeddings de 768 dimensiones.
export interface LabEmbeddingProvider {
  // Identificador del modelo de embeddings (debe coincidir entre ingesta y consulta).
  readonly modelId: string;
  // Dimensión vectorial fija (768).
  readonly dimensions: 768;
  // Calcula el vector de 768 dimensiones para uno o varios textos.
  embed(texts: readonly string[]): Promise<number[][]>;
}

// Palabras vacías frecuentes en español que no deben dominar la similitud vectorial.
const STOPWORDS = new Set([
  "el",
  "la",
  "los",
  "las",
  "un",
  "una",
  "unos",
  "unas",
  "de",
  "del",
  "al",
  "a",
  "en",
  "con",
  "por",
  "para",
  "sin",
  "sobre",
  "entre",
  "hacia",
  "hasta",
  "desde",
  "que",
  "como",
  "cual",
  "cuales",
  "quien",
  "donde",
  "cuando",
  "cuanto",
  "cuantos",
  "cuantas",
  "es",
  "son",
  "esta",
  "estan",
  "fue",
  "ser",
  "se",
  "su",
  "sus",
  "o",
  "u",
  "y",
  "e",
  "ni",
  "no",
  "si",
  "mas",
  "pero",
  "este",
  "esta",
  "estos",
  "estas",
  "ese",
  "esa",
  "hay",
  "tiene",
  "tienen",
  "puede",
  "pueden",
  "hace",
  "cada",
  "todo",
  "toda",
  "todos",
  "todas",
  // Término común a todos los documentos del corpus ficticio y verbos genéricos de enunciado.
  "aethercloud",
  "maximo",
  "maxima",
  "minimo",
  "minima",
  "exige",
  "aplica",
  "ofrece",
  "permite",
  "incluye",
  "debe",
  "segun",
  "cual",
  "cuales",
  "cuanto",
  "cuantos",
  "cuantas",
  "tiempo",
  "periodo",
  "sistema",
]);

// Normaliza texto en español quitando tildes, pasando a minúsculas y separando tokens alfanuméricos.
export function tokenizeSpanish(text: string): string[] {
  // Descompone diacríticos Unicode, filtra marcas combinantes y extrae tokens útiles.
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

// Raíz aproximada en español para acercar singular/plural y derivados técnicos en el vector de 768 d.
function stemToken(token: string): string {
  // Números o siglas cortas se conservan tal cual.
  if (token.length <= 4 || /^\d+$/.test(token)) {
    // Sin recorte.
    return token;
  }
  // Quita terminaciones plurales y verbales comunes para alinear consulta y documento.
  return token.replace(/(ciones|siones|miento|mientos|idades|mente|adores|adoras|es|s)$/, "");
}

// Comprueba que un vector tenga exactamente 768 números finitos.
export function assertVector768(vector: readonly number[], context = "vector"): void {
  // Verifica la longitud exacta.
  if (vector.length !== LAB_EMBEDDING_DIMENSIONS) {
    // Error de dimensión.
    throw new Error(
      `${context}: se esperaban ${String(LAB_EMBEDDING_DIMENSIONS)} dimensiones y llegaron ${String(vector.length)}.`,
    );
  }
  // Verifica que cada componente sea un número finito.
  for (let index = 0; index < vector.length; index += 1) {
    // Componente actual.
    const value = vector[index];
    // No finito.
    if (typeof value !== "number" || !Number.isFinite(value)) {
      // Error de componente inválido.
      throw new Error(`${context}: componente no finito en la posición ${String(index)}.`);
    }
  }
}

// Calcula el embedding determinista de 768 dimensiones normalizado en L2.
export function embedLabText768(text: string): number[] {
  // Vector acumulador de 768 posiciones inicializado a cero.
  const vector = new Array<number>(LAB_EMBEDDING_DIMENSIONS).fill(0);
  // Tokens filtrados sin palabras vacías.
  const tokens = tokenizeSpanish(text);
  // Si no hay tokens útiles, devuelve el vector nulo de 768 dimensiones.
  if (tokens.length === 0) {
    // 768 ceros.
    return vector;
  }
  // Tokens únicos por raíz para que la longitud del párrafo no diluya la norma L2.
  const uniqueTokens = [...new Set(tokens)];
  // Proyecta cada token y su raíz sobre las 768 dimensiones.
  for (let position = 0; position < uniqueTokens.length; position += 1) {
    // Token original.
    const token = uniqueTokens[position]!;
    // Raíz léxica.
    const stem = stemToken(token);
    // Características con peso: raíz léxica (1.0), token exacto (0.7) y prefijo de 4 caracteres (0.5).
    const features: { key: string; weight: number }[] = [
      { key: `stem:${stem}`, weight: 1.0 },
      { key: `tok:${token}`, weight: 0.7 },
    ];
    // Si el token tiene al menos 4 letras, añade prefijo de 4 caracteres para familias léxicas.
    if (stem.length >= 4) {
      // Prefijo con peso moderado.
      features.push({ key: `pre:${stem.slice(0, 4)}`, weight: 0.5 });
    }
    // Proyecta cada característica en dos coordenadas con signo a partir de su hash FNV-1a.
    for (const feature of features) {
      // Huella de 64 bits en hexadecimal.
      const hash = fnv1a64(feature.key);
      // Coordenada primaria en [0, 767].
      const idxA = Number.parseInt(hash.slice(0, 8), 16) % LAB_EMBEDDING_DIMENSIONS;
      // Coordenada secundaria en [0, 767].
      const idxB = Number.parseInt(hash.slice(8, 16), 16) % LAB_EMBEDDING_DIMENSIONS;
      // Signos +1 o -1.
      const signA = (Number.parseInt(hash.slice(0, 2), 16) & 1) === 0 ? 1 : -1;
      // Obtiene del hash un segundo signo reproducible para distribuir la característica léxica.
      const signB = (Number.parseInt(hash.slice(2, 4), 16) & 1) === 0 ? 1 : -1;
      // Acumula en las dos coordenadas.
      vector[idxA] = (vector[idxA] ?? 0) + signA * feature.weight;
      // Añade una contribución secundaria de menor peso a otra posición del vector de demostración.
      vector[idxB] = (vector[idxB] ?? 0) + signB * (feature.weight * 0.5);
    }
  }
  // Norma L2 del vector.
  const norm = Math.hypot(...vector);
  // Si la norma es positiva, normaliza a longitud unitaria.
  if (norm > 0) {
    // Divide cada componente por la norma.
    for (let index = 0; index < vector.length; index += 1) {
      // Normaliza cada componente y fija seis decimales para obtener resultados reproducibles.
      vector[index] = Number(((vector[index] ?? 0) / norm).toFixed(6));
    }
  }
  // Comprueba que cumple el contrato de 768 dimensiones.
  assertVector768(vector, "embedLabText768");
  // Vector unitario de 768 dimensiones.
  return vector;
}

// Similitud coseno entre dos vectores de 768 dimensiones en [-1, 1].
export function cosineSimilarity768(left: readonly number[], right: readonly number[]): number {
  // Verifica ambas dimensiones.
  assertVector768(left, "cosineSimilarity768(left)");
  // Valida también el segundo vector antes de calcular la similitud coseno.
  assertVector768(right, "cosineSimilarity768(right)");
  // Producto escalar y normas.
  let dot = 0;
  // Acumula por separado el cuadrado de la norma del vector izquierdo.
  let normLeft = 0;
  // Mantiene otro acumulador para la norma del vector derecho.
  let normRight = 0;
  // Recorre las 768 posiciones.
  for (let index = 0; index < LAB_EMBEDDING_DIMENSIONS; index += 1) {
    // Componentes.
    const a = left[index] ?? 0;
    // Lee la componente correspondiente del segundo vector.
    const b = right[index] ?? 0;
    // Suma los productos de componentes para obtener el producto escalar.
    dot += a * b;
    // Suma el cuadrado de la componente izquierda para calcular después su norma.
    normLeft += a * a;
    // Hace lo mismo con la componente derecha antes de normalizar el producto escalar.
    normRight += b * b;
  }
  // Si alguno es el vector cero, la similitud es 0.
  if (normLeft === 0 || normRight === 0) {
    // Sin similitud.
    return 0;
  }
  // Coseno acotado a [-1, 1].
  const raw = dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
  return Math.max(-1, Math.min(1, Number(raw.toFixed(6))));
}

// Distancia coseno de pgvector (<=>): 1 - similitud_coseno, en [0, 2] (menor = más próximo).
export function cosineDistance768(left: readonly number[], right: readonly number[]): number {
  // 1 menos la similitud coseno.
  return Number((1 - cosineSimilarity768(left, right)).toFixed(6));
}

// Crea el proveedor de embeddings determinista de 768 dimensiones para el laboratorio reproducible.
export function createDeterministic768EmbeddingProvider(
  modelId = "gemini-embedding-2",
): LabEmbeddingProvider {
  // Proveedor que genera vectores de 768 dimensiones con el modelo configurado.
  return {
    modelId,
    dimensions: LAB_EMBEDDING_DIMENSIONS,
    // Convierte los textos en vectores mediante el proveedor que implementa este puerto.
    async embed(texts: readonly string[]): Promise<number[][]> {
      // Embebe cada texto validando las 768 dimensiones.
      return texts.map((text) => embedLabText768(text));
    },
  };
}
