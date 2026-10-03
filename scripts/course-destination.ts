export const COURSE_DESTINATION = {
  accountId: "9c1493e94ba21f2c6872a9dd17ba19f7",
  accountName: "Joseantonionuevo@gmail.com's Account",
  loginEmail: "joseantonionuevo@gmail.com",
} as const;

export const BGE_M3_MODEL = "@cf/baai/bge-m3";
export const BGE_M3_USD_PER_MILLION_INPUT_TOKENS = 0.0118;

export function estimateEmbeddingUsd(textChars: number): number {
  const tokens = Math.max(1, textChars);
  return (tokens / 1_000_000) * BGE_M3_USD_PER_MILLION_INPUT_TOKENS;
}
