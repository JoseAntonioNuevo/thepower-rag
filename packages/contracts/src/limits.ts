export const LIMITS = {
  maxMessageChars: 2_000,
  maxUserMessageChars: 2_000,
  maxAssistantMessageChars: 6_000,
  maxHistoryMessages: 16,
  maxHistoryChars: 20_000,
  maxPartsPerMessage: 8,
  maxIdChars: 128,
  maxBodyChars: 80_000,
  maxIssues: 20,
  maxOutputTokens: 600,
  generationTimeoutMs: 20_000,
  embeddingTimeoutMs: 15_000,
  retrievalTimeoutMs: 10_000,
  maxRetries: 0,
  retrievalTopK: 4,
} as const;

export const GENERATION_VARIABLES = ["OPENROUTER_API_KEY", "MODEL_ID"] as const;

export const RAG_SETTING_VARIABLES = [
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "CORPUS_VERSION",
  "INDEX_PROFILE",
  "VECTOR_METRIC",
  "MIN_RETRIEVAL_SCORE",
] as const;

export const RAG_BINDING_NAMES = ["AI", "VECTORIZE", "DB", "CORPUS"] as const;

export const CRAG_VARIABLES = ["EVALUATOR_MODEL_ID"] as const;

export type GenerationVariable = (typeof GENERATION_VARIABLES)[number];
export type RagSettingVariable = (typeof RAG_SETTING_VARIABLES)[number];
export type RagBindingName = (typeof RAG_BINDING_NAMES)[number];
export type CragVariable = (typeof CRAG_VARIABLES)[number];

export function isConfiguredValue(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  const marker = trimmed.toLowerCase();
  return trimmed.length > 0 && !marker.startsWith("replace-with") && !marker.startsWith("replace_");
}
