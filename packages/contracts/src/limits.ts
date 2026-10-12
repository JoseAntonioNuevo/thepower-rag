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
  maxOutputTokens: 1_600,
  generationTimeoutMs: 20_000,
  embeddingTimeoutMs: 15_000,
  retrievalTimeoutMs: 10_000,
  maxRetries: 0,
  retrievalTopK: 4,
} as const;

/** Variables de generación de la ruta por defecto (Anthropic). Con otro proveedor usa generationVariables. */
export const GENERATION_VARIABLES = ["ANTHROPIC_API_KEY", "MODEL_ID"] as const;

/**
 * Proveedores de los modelos generativos: chat, RAG, evaluador de CRAG, investigación y visión.
 * LLM_PROVIDER elige uno para todos esos papeles; sin valor se usa anthropic, la ruta publicada.
 * openrouter da acceso a cientos de modelos con una sola clave; compatible, a cualquier API
 * compatible con Chat Completions (Groq, Mistral, DeepSeek, Ollama, vLLM…).
 */
export const LLM_PROVIDERS = ["anthropic", "openai", "openrouter", "gemini", "compatible"] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const DEFAULT_LLM_PROVIDER: LlmProvider = "anthropic";

/** Variable que habilita cada proveedor. En compatible es la URL; su clave es opcional. */
export const PROVIDER_CREDENTIAL: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
  compatible: "COMPAT_BASE_URL",
};

/**
 * Nombres que el desarrollo local copia del .env de la raíz al Worker cuando su
 * configuración no los trae. Solo eligen proveedor y credenciales: nunca APP_MODE ni bindings.
 */
export const PROVIDER_ENV_VARIABLES = [
  "LLM_PROVIDER",
  "LLM_REASONING_EFFORT",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_WORKSPACE_ID",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "COMPAT_BASE_URL",
  "COMPAT_API_KEY",
] as const;

/** Proveedor de LLM_PROVIDER; vacío equivale a anthropic y un nombre desconocido devuelve null. */
export function llmProvider(value: string | undefined): LlmProvider | null {
  const name = isConfiguredValue(value) ? (value ?? "").trim().toLowerCase() : DEFAULT_LLM_PROVIDER;
  return (LLM_PROVIDERS as readonly string[]).includes(name) ? (name as LlmProvider) : null;
}

/** Credencial del proveedor y MODEL_ID: lo mínimo para generar en modo real. */
export function generationVariables(provider: LlmProvider): readonly string[] {
  return [PROVIDER_CREDENTIAL[provider], "MODEL_ID"];
}

/** Niveles de razonamiento comunes del AI SDK; cada proveedor los traduce a su parámetro. */
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Razonamiento pedido a los modelos. Vacío usa low, salvo en compatible, donde no se envía
 * porque un servidor desconocido puede rechazar el parámetro. «omitir» no lo envía nunca y
 * deja el valor por defecto del modelo. Un valor que no existe devuelve "invalid".
 */
export function reasoningEffort(
  value: string | undefined,
  provider: LlmProvider,
): ReasoningEffort | null | "invalid" {
  if (!isConfiguredValue(value)) {
    return provider === "compatible" ? null : "low";
  }
  const name = (value ?? "").trim().toLowerCase();
  if (name === "omitir") {
    return null;
  }
  return (REASONING_EFFORTS as readonly string[]).includes(name)
    ? (name as ReasoningEffort)
    : "invalid";
}

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
