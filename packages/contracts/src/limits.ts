// GUÍA DE LECTURA · packages/contracts/src/limits.ts
// Límites y nombres de configuración compartidos por el navegador, la API y los scripts.
// LIMITS acota mensajes, historial, salida del modelo y plazos; el resto de constantes nombra
// las variables de entorno que necesita cada etapa (generación, RAG, CRAG) y el proveedor.
// Topes del chat y de las llamadas a modelos; `as const` los deja como valores fijos de solo lectura.
export const LIMITS = {
  // Caracteres máximos de textos cortos del contrato: etiquetas de la demo y extractos de citas.
  maxMessageChars: 2_000,
  // Caracteres máximos de un mensaje del alumno.
  maxUserMessageChars: 2_000,
  // Caracteres máximos de una respuesta del asistente guardada en el historial.
  maxAssistantMessageChars: 6_000,
  // Mensajes del historial admitidos en una petición, contando los dos papeles.
  maxHistoryMessages: 16,
  // Caracteres totales del historial; lo que pase de aquí se rechaza.
  maxHistoryChars: 20_000,
  // Partes (texto u otras) admitidas en un mismo mensaje.
  maxPartsPerMessage: 8,
  // Longitud máxima de un identificador (mensaje, fragmento, ejecución).
  maxIdChars: 128,
  // Caracteres máximos del cuerpo JSON de una petición de chat.
  maxBodyChars: 80_000,
  // Errores de validación que se devuelven como máximo en una respuesta 400.
  maxIssues: 20,
  // Tokens de salida por respuesta del modelo (1.600).
  maxOutputTokens: 1_600,
  // Plazo de una generación: 20 segundos.
  generationTimeoutMs: 20_000,
  // Plazo de una llamada de embeddings: 15 segundos.
  embeddingTimeoutMs: 15_000,
  // Plazo de una búsqueda en el índice: 10 segundos.
  retrievalTimeoutMs: 10_000,
  // Reintentos del SDK: cero; un fallo se muestra como fallo.
  maxRetries: 0,
  // Fragmentos que devuelve la búsqueda vectorial del RAG básico.
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

// Tipo con los cinco nombres de proveedor admitidos.
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

// Proveedor que se usa cuando LLM_PROVIDER está vacío: el de la versión publicada.
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
  // Vacío o marcador: proveedor por defecto; si no, el nombre en minúsculas y sin espacios.
  const name = isConfiguredValue(value) ? (value ?? "").trim().toLowerCase() : DEFAULT_LLM_PROVIDER;
  // Solo devuelve un proveedor de la lista; cualquier otro nombre da null.
  return (LLM_PROVIDERS as readonly string[]).includes(name) ? (name as LlmProvider) : null;
}

/** Credencial del proveedor y MODEL_ID: lo mínimo para generar en modo real. */
export function generationVariables(provider: LlmProvider): readonly string[] {
  // Lista con la variable de la clave de ese proveedor y el modelo.
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

// Tipo con los niveles de razonamiento admitidos.
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
  // Sin valor escrito se aplica el nivel por defecto del proveedor.
  if (!isConfiguredValue(value)) {
    // compatible no envía razonamiento; el resto pide poco (low).
    return provider === "compatible" ? null : "low";
  }
  // Normaliza el texto: sin espacios y en minúsculas.
  const name = (value ?? "").trim().toLowerCase();
  // «omitir» significa no enviar el parámetro.
  if (name === "omitir") {
    // null: la petición no incluirá razonamiento.
    return null;
  }
  // Un nivel conocido se devuelve tal cual; cualquier otro texto es inválido.
  return (REASONING_EFFORTS as readonly string[]).includes(name)
    ? (name as ReasoningEffort)
    : "invalid";
}

// Variables que el RAG real necesita además de la generación.
export const RAG_SETTING_VARIABLES = [
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "CORPUS_VERSION",
  "INDEX_PROFILE",
  "VECTOR_METRIC",
  "MIN_RETRIEVAL_SCORE",
] as const;

// Bindings de Cloudflare del RAG real: Workers AI, Vectorize, D1 y R2.
export const RAG_BINDING_NAMES = ["AI", "VECTORIZE", "DB", "CORPUS"] as const;

// Variable que solo exige CRAG: el modelo evaluador.
export const CRAG_VARIABLES = ["EVALUATOR_MODEL_ID"] as const;

// Tipos con los nombres exactos de cada lista: el compilador rechaza un nombre mal escrito.
// Nombre de una variable de generación de la ruta por defecto.
export type GenerationVariable = (typeof GENERATION_VARIABLES)[number];
// Nombre de una variable de ajuste del RAG.
export type RagSettingVariable = (typeof RAG_SETTING_VARIABLES)[number];
// Nombre de un binding del RAG.
export type RagBindingName = (typeof RAG_BINDING_NAMES)[number];
// Nombre de una variable propia de CRAG.
export type CragVariable = (typeof CRAG_VARIABLES)[number];

// Un valor cuenta como configurado si no está vacío ni es un marcador de las plantillas.
export function isConfiguredValue(value: string | undefined): boolean {
  // Variable ausente: no configurada.
  if (value === undefined) {
    // Devuelve false sin mirar nada más.
    return false;
  }
  // Quita espacios al principio y al final.
  const trimmed = value.trim();
  // Minúsculas para reconocer el marcador sin importar mayúsculas.
  const marker = trimmed.toLowerCase();
  // Configurado si tiene texto y no empieza por replace-with o replace_ (los marcadores de .env.example).
  return trimmed.length > 0 && !marker.startsWith("replace-with") && !marker.startsWith("replace_");
}
