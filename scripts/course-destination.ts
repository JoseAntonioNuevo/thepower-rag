// GUÍA DE LECTURA · scripts/course-destination.ts
// Cuenta de Cloudflare del curso y estimación del coste de los embeddings BGE-M3.
// Cuenta de destino de los despliegues del curso.
export const COURSE_DESTINATION = {
  accountId: "9c1493e94ba21f2c6872a9dd17ba19f7",
  accountName: "Joseantonionuevo@gmail.com's Account",
  loginEmail: "joseantonionuevo@gmail.com",
} as const;

// Modelo de embeddings.
export const BGE_M3_MODEL = "@cf/baai/bge-m3";
// Precio publicado por millón de tokens de entrada.
export const BGE_M3_USD_PER_MILLION_INPUT_TOKENS = 0.0118;

// Coste estimado: un token por carácter como cota superior.
export function estimateEmbeddingUsd(textChars: number): number {
  // Tokens (mínimo 1).
  const tokens = Math.max(1, textChars);
  // USD.
  return (tokens / 1_000_000) * BGE_M3_USD_PER_MILLION_INPUT_TOKENS;
}
