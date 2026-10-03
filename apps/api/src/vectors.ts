import { LIMITS } from "@thepower-rag/contracts";

export function assertEmbeddingMatrix(
  rows: readonly (readonly number[])[],
  expectedCount: number,
  expectedDimensions: number,
): number[][] {
  if (rows.length !== expectedCount) {
    throw new Error("El número de embeddings no coincide con los textos.");
  }
  return rows.map((row) => {
    if (row.length !== expectedDimensions) {
      throw new Error(
        `La dimensión observada es ${String(row.length)} y la configurada es ${String(expectedDimensions)}.`,
      );
    }
    if (row.some((value) => !Number.isFinite(value))) {
      throw new Error("El embedding contiene un valor no finito.");
    }
    return [...row];
  });
}

export const BGE_M3_MODEL = "@cf/baai/bge-m3";

export interface EmbeddingRunner {
  run(model: typeof BGE_M3_MODEL, input: { text: string[] }): Promise<unknown>;
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

export async function embedWithWorkersAi(
  runner: EmbeddingRunner,
  model: string,
  texts: readonly string[],
  expectedDimensions: number,
  signal: AbortSignal,
  timeoutMs: number = LIMITS.embeddingTimeoutMs,
): Promise<number[][]> {
  if (model !== BGE_M3_MODEL) {
    throw new Error("El adaptador solo implementa la interfaz documentada de @cf/baai/bge-m3.");
  }
  if (signal.aborted) {
    throw abortError();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      runner.run(BGE_M3_MODEL, { text: [...texts] }),
      new Promise<never>((_, reject) => {
        onAbort = () => {
          reject(abortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("embedding-timeout"));
        }, timeoutMs);
      }),
    ]);
    if (
      typeof result !== "object" ||
      result === null ||
      !("data" in result) ||
      !Array.isArray(result.data)
    ) {
      throw new Error("La respuesta de embeddings no trae una matriz data.");
    }
    const rows = result.data.filter(
      (row): row is number[] =>
        Array.isArray(row) && row.every((value) => typeof value === "number"),
    );
    if (rows.length !== result.data.length) {
      throw new Error("La respuesta de embeddings mezcla filas que no son numéricas.");
    }
    return assertEmbeddingMatrix(rows, texts.length, expectedDimensions);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (onAbort !== undefined) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
