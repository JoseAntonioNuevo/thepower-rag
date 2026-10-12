import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  DEFAULT_LLM_PROVIDER,
  reasoningEffort,
  type LlmProvider,
  type ReasoningEffort,
} from "@thepower-rag/contracts";
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
import type { GenerationSettings } from "./env";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
export const HAIKU_MODEL_ID = "claude-haiku-5-5";
export const HAIKU_INPUT_USD_PER_MILLION = 0.1;
export const HAIKU_OUTPUT_USD_PER_MILLION = 0.5;

/** Effort low keeps adaptive thinking small so a short course answer still fits maxOutputTokens. */
export const anthropicProviderOptions = {
  anthropic: {
    effort: "low",
  } satisfies AnthropicLanguageModelOptions,
};

/** Niveles que Anthropic acepta como effort. none y minimal pasan por la opción común del SDK. */
const ANTHROPIC_EFFORTS = new Set<ReasoningEffort>(["low", "medium", "high", "xhigh", "max"]);

/** Opción común de razonamiento del AI SDK instalado: llega hasta xhigh. */
type SdkReasoning = Exclude<ReasoningEffort, "max">;

/** max no existe en la opción común; xhigh es el nivel más alto que el SDK traduce. */
function sdkReasoning(effort: ReasoningEffort): SdkReasoning {
  return effort === "max" ? "xhigh" : effort;
}

/** Nombre legible de cada proveedor para el coste mostrado y los registros. */
export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  gemini: "Google Gemini",
  compatible: "API compatible",
};

export function anthropicFactoryLoaded(): boolean {
  return typeof createAnthropic === "function";
}

/** fetch que avisa antes de cada llamada al proveedor; sin aviso usa el fetch normal. */
function countingFetch(onCall?: () => void): typeof fetch | undefined {
  return onCall
    ? async (url, init) => {
        onCall();
        return fetch(url, init);
      }
    : undefined;
}

/**
 * Valores por defecto de cada llamada: el razonamiento común del SDK y opciones del proveedor.
 * Una opción indicada en la propia llamada tiene prioridad sobre estos valores.
 */
function withDefaults(
  model: Exclude<LanguageModel, string>,
  defaults: {
    reasoning?: SdkReasoning;
    providerOptions?: Record<string, Record<string, unknown>>;
  },
): Exclude<LanguageModel, string> {
  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const reasoning = params.reasoning ?? defaults.reasoning;
      // Mezcla por proveedor: una opción de la llamada sustituye solo esa misma clave.
      const providerOptions: Record<string, Record<string, unknown>> = {
        ...defaults.providerOptions,
      };
      for (const [name, options] of Object.entries(params.providerOptions ?? {})) {
        providerOptions[name] = { ...providerOptions[name], ...options };
      }
      return {
        ...params,
        ...(reasoning === undefined ? {} : { reasoning }),
        providerOptions: providerOptions as NonNullable<typeof params.providerOptions>,
      };
    },
  };
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware,
  });
}

/** Catálogo público de OpenRouter: qué parámetros y qué razonamiento admite cada modelo. */
export const OPENROUTER_CATALOG_URL = "https://openrouter.ai/api/v1/models";

/** Razonamiento en el formato de OpenRouter: apagado o un nivel de esfuerzo. */
export type OpenRouterReasoning =
  | { enabled: false }
  | { effort: "xhigh" | "high" | "medium" | "low" | "minimal" | "none" };

interface CatalogEntry {
  supported_parameters?: unknown;
  reasoning?: unknown;
}

let catalogRequest: Promise<Map<string, CatalogEntry>> | null = null;

/**
 * Descarga el catálogo una vez por instancia del Worker (unos 800 KB, sin clave ni coste).
 * Un fallo no se guarda: la siguiente llamada lo vuelve a intentar.
 */
function openRouterCatalog(): Promise<Map<string, CatalogEntry>> {
  catalogRequest ??= (async () => {
    const response = await fetch(OPENROUTER_CATALOG_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`openrouter-catalog-${String(response.status)}`);
    const body = (await response.json()) as { data?: unknown };
    const catalog = new Map<string, CatalogEntry>();
    for (const entry of Array.isArray(body.data) ? body.data : []) {
      if (entry !== null && typeof entry === "object" && typeof entry.id === "string") {
        catalog.set(entry.id, entry as CatalogEntry);
      }
    }
    return catalog;
  })().catch((error: unknown) => {
    catalogRequest = null;
    throw error;
  });
  return catalogRequest;
}

/** Vacía el catálogo guardado. Solo para pruebas. */
export function resetOpenRouterCatalog(): void {
  catalogRequest = null;
}

/**
 * Razonamiento de un modelo de OpenRouter cuando LLM_REASONING_EFFORT no está fijado, según su
 * ficha del catálogo:
 * - no razona (por ejemplo, Llama): no se envía nada;
 * - razona, pero se puede apagar (Claude Haiku, Kimi, GPT-6 Luna, DeepSeek, Qwen…): apagado, que
 *   es más rápido y deja los tokens de salida a la respuesta;
 * - razona siempre (algunos GLM, Grok o GPT): su nivel más bajo; supported_efforts va de mayor a
 *   menor, así que es el último.
 * Si el catálogo no responde o no trae el modelo, se pide el nivel bajo, como en las demás rutas.
 */
export async function openRouterAutoReasoning(
  modelId: string,
): Promise<OpenRouterReasoning | undefined> {
  let entry: CatalogEntry | undefined;
  try {
    const catalog = await openRouterCatalog();
    // Un sufijo de enrutado (:nitro, :floor…) usa la ficha del modelo sin sufijo.
    entry = catalog.get(modelId) ?? catalog.get(modelId.split(":")[0] ?? modelId);
  } catch {
    return { effort: "low" };
  }
  if (entry === undefined) return { effort: "low" };
  const supported = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
  if (!supported.includes("reasoning")) return undefined;
  const info =
    entry.reasoning !== null && typeof entry.reasoning === "object"
      ? (entry.reasoning as { mandatory?: unknown; supported_efforts?: unknown })
      : {};
  if (info.mandatory !== true) return { enabled: false };
  const efforts = (Array.isArray(info.supported_efforts) ? info.supported_efforts : []).filter(
    (value): value is string => typeof value === "string" && value !== "none" && value !== "max",
  );
  const lowest = efforts.at(-1) ?? "low";
  return { effort: lowest as Exclude<OpenRouterReasoning, { enabled: false }>["effort"] };
}

/**
 * Modelo de lenguaje del proveedor de LLM_PROVIDER. Construirlo no llama a la red.
 *
 * Todos los papeles (chat, RAG, evaluador de CRAG, investigación y visión) pasan por aquí y solo
 * cambian `modelId`. Sin LLM_REASONING_EFFORT, el razonamiento queda bajo para dejar sitio a la
 * respuesta dentro de maxOutputTokens y del plazo de CRAG. Cada proveedor lo traduce a su
 * parámetro:
 * - anthropic: `effort` (igual que la ruta publicada con Claude Haiku 5.5);
 * - openai, gemini y compatible: la opción común `reasoning` del AI SDK, que el SDK convierte en
 *   reasoning_effort o thinkingConfig y omite en modelos sin razonamiento;
 * - openrouter: según el catálogo de cada modelo (openRouterAutoReasoning), porque OpenRouter
 *   sube un nivel bajo no admitido al más cercano, y en algunos modelos ese nivel es high.
 * Con LLM_REASONING_EFFORT fijado, todos los proveedores envían ese nivel tal cual.
 */
export function createLanguageModel(
  config: GenerationSettings,
  modelId: string,
  onCall?: () => void,
): Exclude<LanguageModel, string> {
  const provider = config.provider ?? DEFAULT_LLM_PROVIDER;
  const fallback = reasoningEffort(undefined, provider);
  const effort =
    config.reasoning === undefined ? (fallback === "invalid" ? null : fallback) : config.reasoning;
  const providerFetch = countingFetch(onCall);
  switch (provider) {
    case "anthropic": {
      const model = createAnthropic({
        apiKey: config.apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        headers: config.workspaceId ? { "anthropic-workspace-id": config.workspaceId } : undefined,
        fetch: providerFetch,
      }).chat(modelId);
      if (effort === null) return model;
      return ANTHROPIC_EFFORTS.has(effort)
        ? withDefaults(model, { providerOptions: { anthropic: { effort } } })
        : withDefaults(model, { reasoning: sdkReasoning(effort) });
    }
    case "openai": {
      // Responses API: el SDK quita el razonamiento a los modelos que no lo admiten.
      // store=false: OpenAI no guarda la conversación del curso en su plataforma.
      const model = createOpenAI({
        apiKey: config.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: providerFetch,
      }).responses(modelId);
      return withDefaults(model, {
        ...(effort === null ? {} : { reasoning: sdkReasoning(effort) }),
        providerOptions: { openai: { store: false } },
      });
    }
    case "gemini": {
      const model = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: GEMINI_BASE_URL,
        fetch: providerFetch,
      })(modelId);
      return effort === null ? model : withDefaults(model, { reasoning: sdkReasoning(effort) });
    }
    case "openrouter": {
      const client = createOpenRouter({
        apiKey: config.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        compatibility: "strict",
        appName: "thepower-rag",
        fetch: providerFetch,
      });
      if (config.reasoning === undefined) {
        // Sin nivel fijado, cada llamada consulta (una vez por instancia) la ficha del modelo.
        const middleware: LanguageModelMiddleware = {
          specificationVersion: "v4",
          transformParams: async ({ params }) => {
            const reasoning = await openRouterAutoReasoning(modelId);
            const own = params.providerOptions?.openrouter ?? {};
            return {
              ...params,
              providerOptions: {
                ...params.providerOptions,
                openrouter: { ...(reasoning ? { reasoning } : {}), ...own },
              } as NonNullable<typeof params.providerOptions>,
            };
          },
        };
        return wrapLanguageModel({
          model: client.chat(modelId) as Parameters<typeof wrapLanguageModel>[0]["model"],
          middleware,
        });
      }
      // OpenRouter no tiene nivel max; xhigh es el más alto que acepta.
      const openRouterEffort = effort === "max" ? "xhigh" : effort;
      return client.chat(
        modelId,
        openRouterEffort === null ? {} : { reasoning: { effort: openRouterEffort } },
      );
    }
    case "compatible": {
      const model = createOpenAICompatible({
        name: "compatible",
        baseURL: config.baseURL ?? "",
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        // Pide JSON con esquema (response_format json_schema) para CRAG e investigación.
        supportsStructuredOutputs: true,
        fetch: providerFetch,
      }).chatModel(modelId);
      return effort === null ? model : withDefaults(model, { reasoning: sdkReasoning(effort) });
    }
  }
}

export function createGenerationModel(config: GenerationSettings, onCall?: () => void) {
  return createLanguageModel(config, config.modelId, onCall);
}

export function createEvaluatorModel(
  config: GenerationSettings & { evaluatorModelId: string },
  onCall?: () => void,
) {
  return createLanguageModel(config, config.evaluatorModelId, onCall);
}

export function refusedByModel(reason: string | undefined, raw: string | undefined): boolean {
  return reason === "content-filter" || raw === "refusal";
}
