// GUÍA DE LECTURA · apps/api/src/vectors.ts
// Embeddings con Workers AI (BGE-M3): llamada con plazo y cancelación, y validación de la matriz
// devuelta (número de filas, dimensión observada y valores finitos).
// Límites (plazo de embeddings).
import { LIMITS } from "@thepower-rag/contracts";

// Valida una matriz de embeddings.
export function assertEmbeddingMatrix(
  rows: readonly (readonly number[])[],
  expectedCount: number,
  expectedDimensions: number,
): number[][] {
  // Una fila por texto.
  if (rows.length !== expectedCount) {
    // Error si no.
    throw new Error("El número de embeddings no coincide con los textos.");
  }
  // Revisa cada fila.
  return rows.map((row) => {
    // Dimensión configurada.
    if (row.length !== expectedDimensions) {
      // Error con la dimensión observada.
      throw new Error(
        `La dimensión observada es ${String(row.length)} y la configurada es ${String(expectedDimensions)}.`,
      );
    }
    // Solo números finitos.
    if (row.some((value) => !Number.isFinite(value))) {
      // Error.
      throw new Error("El embedding contiene un valor no finito.");
    }
    // Copia de la fila.
    return [...row];
  });
}

// Único modelo de embeddings que implementa este adaptador.
export const BGE_M3_MODEL = "@cf/baai/bge-m3";

// Forma mínima del binding AI de Workers AI.
export interface EmbeddingRunner {
  // Ejecuta un modelo con una lista de textos.
  run(model: typeof BGE_M3_MODEL, input: { text: string[] }): Promise<unknown>;
}

// Error estándar de cancelación.
function abortError(): DOMException {
  // DOMException con nombre AbortError.
  return new DOMException("The operation was aborted.", "AbortError");
}

// Calcula los embeddings de varios textos con plazo y cancelación.
export async function embedWithWorkersAi(
  runner: EmbeddingRunner,
  model: string,
  texts: readonly string[],
  expectedDimensions: number,
  signal: AbortSignal,
  timeoutMs: number = LIMITS.embeddingTimeoutMs,
): Promise<number[][]> {
  // Solo BGE-M3.
  if (model !== BGE_M3_MODEL) {
    // Error si se pide otro.
    throw new Error("El adaptador solo implementa la interfaz documentada de @cf/baai/bge-m3.");
  }
  // Ya cancelado.
  if (signal.aborted) {
    // Error de cancelación.
    throw abortError();
  }
  // Temporizador del plazo.
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Función que escucha la cancelación.
  let onAbort: (() => void) | undefined;
  // try/finally: el temporizador y el oyente se limpian siempre.
  try {
    // Gana lo primero que ocurra: respuesta, cancelación o plazo.
    const result = await Promise.race([
      runner.run(BGE_M3_MODEL, { text: [...texts] }),
      new Promise<never>((_, reject) => {
        // Rechaza al cancelar.
        onAbort = () => {
          // Error de cancelación.
          reject(abortError());
        };
        // Escucha la cancelación una vez.
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      new Promise<never>((_, reject) => {
        // Rechaza al agotar el plazo.
        timer = setTimeout(() => {
          // Error de plazo.
          reject(new Error("embedding-timeout"));
        }, timeoutMs);
      }),
    ]);
    // La respuesta debe traer data como lista.
    if (
      typeof result !== "object" ||
      result === null ||
      !("data" in result) ||
      !Array.isArray(result.data)
    ) {
      // Error.
      throw new Error("La respuesta de embeddings no trae una matriz data.");
    }
    // Filas numéricas.
    const rows = result.data.filter(
      (row): row is number[] =>
        Array.isArray(row) && row.every((value) => typeof value === "number"),
    );
    // Todas las filas deben ser numéricas.
    if (rows.length !== result.data.length) {
      // Error.
      throw new Error("La respuesta de embeddings mezcla filas que no son numéricas.");
    }
    // Valida la matriz.
    return assertEmbeddingMatrix(rows, texts.length, expectedDimensions);
  } finally {
    // Hay temporizador.
    if (timer !== undefined) {
      // Se cancela.
      clearTimeout(timer);
    }
    // Hay oyente.
    if (onAbort !== undefined) {
      // Se quita.
      signal.removeEventListener("abort", onAbort);
    }
  }
}
