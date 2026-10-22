// GUÍA DE LECTURA · apps/api/src/model.ts
// Fábrica única de modelos de lenguaje: elige el proveedor de LLM_PROVIDER (Anthropic, OpenAI,
// OpenRouter, Gemini o una API compatible), fija el razonamiento por defecto y cuenta las llamadas.
// Todos los papeles (chat, RAG, CRAG, investigación y visión) se crean aquí; construir no llama a la red.
// SDK oficial de Anthropic y el tipo de sus opciones.
import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
// SDK de la Gemini API de Google.
import { createGoogleGenerativeAI } from "@ai-sdk/google";
// SDK de OpenAI.
import { createOpenAI } from "@ai-sdk/openai";
// SDK para cualquier API compatible con Chat Completions.
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
// SDK de OpenRouter.
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
// Proveedor por defecto, nivel de razonamiento y sus tipos.
import {
  DEFAULT_LLM_PROVIDER,
  reasoningEffort,
  type LlmProvider,
  type ReasoningEffort,
} from "@thepower-rag/contracts";
// Envoltorio de modelos con middleware y tipos del AI SDK.
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from "ai";
// Tipo de los ajustes de generación.
import type { GenerationSettings } from "./env";

// URL base de la API de Anthropic.
export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
// URL base de la API de OpenAI.
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
// URL base de OpenRouter.
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
// URL base de la Gemini API.
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
// Modelo de la versión publicada.
export const HAIKU_MODEL_ID = "claude-haiku-5-5";
// Tarifa publicada de entrada de Haiku 5.5 (USD por millón de tokens).
export const HAIKU_INPUT_USD_PER_MILLION = 0.1;
// Tarifa publicada de salida de Haiku 5.5.
export const HAIKU_OUTPUT_USD_PER_MILLION = 0.5;

/** Esfuerzo bajo: el razonamiento adaptativo queda corto y la respuesta del curso cabe en maxOutputTokens. */
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
  // Convierte max en xhigh; el resto se mantiene.
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

// true si el SDK de Anthropic cargó (lo usa la comprobación de salud).
export function anthropicFactoryLoaded(): boolean {
  // createAnthropic es una función si el paquete cargó.
  return typeof createAnthropic === "function";
}

/** fetch que avisa antes de cada llamada al proveedor; sin aviso usa el fetch normal. */
function countingFetch(onCall?: () => void): typeof fetch | undefined {
  // Con aviso, un fetch que avisa y después llama; sin aviso, undefined (el SDK usa el suyo).
  return onCall
    ? async (url, init) => {
        // Avisa de la llamada (para contar llamadas al proveedor).
        onCall();
        // Llamada real.
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
    // Razonamiento común del SDK.
    reasoning?: SdkReasoning;
    // Opciones propias de cada proveedor.
    providerOptions?: Record<string, Record<string, unknown>>;
  },
): Exclude<LanguageModel, string> {
  // Middleware que completa los parámetros de cada llamada.
  const middleware: LanguageModelMiddleware = {
    specificationVersion: "v4",
    // Ajusta los parámetros de la llamada mediante el middleware del modelo antes de enviarla.
    transformParams: async ({ params }) => {
      // Razonamiento de la llamada o el de por defecto.
      const reasoning = params.reasoning ?? defaults.reasoning;
      // Mezcla por proveedor: una opción de la llamada sustituye solo esa misma clave.
      const providerOptions: Record<string, Record<string, unknown>> = {
        ...defaults.providerOptions,
      };
      // Añade las opciones de la llamada encima de las de por defecto.
      for (const [name, options] of Object.entries(params.providerOptions ?? {})) {
        // Mezcla por proveedor.
        providerOptions[name] = { ...providerOptions[name], ...options };
      }
      // Parámetros completados.
      return {
        ...params,
        ...(reasoning === undefined ? {} : { reasoning }),
        providerOptions: providerOptions as NonNullable<typeof params.providerOptions>,
      };
    },
  };
  // Modelo envuelto con el middleware.
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

// Campos que se usan de una ficha del catálogo.
interface CatalogEntry {
  // Parámetros que admite el modelo.
  supported_parameters?: unknown;
  // Datos de razonamiento (si es obligatorio y qué niveles admite).
  reasoning?: unknown;
}

// Descarga en curso o terminada del catálogo (caché del módulo).
let catalogRequest: Promise<Map<string, CatalogEntry>> | null = null;

/**
 * Descarga el catálogo una vez por instancia del Worker (unos 800 KB, sin clave ni coste).
 * Un fallo no se guarda: la siguiente llamada lo vuelve a intentar.
 */
function openRouterCatalog(): Promise<Map<string, CatalogEntry>> {
  // Solo la primera vez se descarga (??= asigna si está vacío).
  catalogRequest ??= (async () => {
    // Petición con un plazo de 5 segundos.
    const response = await fetch(OPENROUTER_CATALOG_URL, { signal: AbortSignal.timeout(5_000) });
    // Error HTTP.
    if (!response.ok)
      // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
      throw new Error(`openrouter-catalog-${String(response.status)}`);
    // Cuerpo JSON.
    const body = (await response.json()) as { data?: unknown };
    // Mapa id → ficha.
    const catalog = new Map<string, CatalogEntry>();
    // Recorre las fichas.
    for (const entry of Array.isArray(body.data) ? body.data : []) {
      // Solo fichas con id de texto.
      if (entry !== null && typeof entry === "object" && typeof entry.id === "string") {
        // Guarda la ficha.
        catalog.set(entry.id, entry as CatalogEntry);
      }
    }
    // Catálogo listo.
    return catalog;
  })().catch((error: unknown) => {
    // Un fallo vacía la caché para reintentar después.
    catalogRequest = null;
    // Propaga el error.
    throw error;
  });
  // Promesa compartida.
  return catalogRequest;
}

/** Vacía el catálogo guardado. Solo para pruebas. */
export function resetOpenRouterCatalog(): void {
  // Vacía la caché.
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
  // Ficha del modelo.
  let entry: CatalogEntry | undefined;
  // Si el catálogo falla, se usa el nivel bajo.
  try {
    // Catálogo.
    const catalog = await openRouterCatalog();
    // Un sufijo de enrutado (:nitro, :floor…) usa la ficha del modelo sin sufijo.
    entry = catalog.get(modelId) ?? catalog.get(modelId.split(":")[0] ?? modelId);
  } catch {
    // Sin catálogo: nivel bajo.
    return { effort: "low" };
  }
  // Modelo fuera del catálogo: nivel bajo.
  if (entry === undefined) return { effort: "low" };
  // Parámetros admitidos.
  const supported = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
  // Sin parámetro reasoning: no se envía nada.
  if (!supported.includes("reasoning"))
    // Indica que esta rama no ha producido un valor disponible para el llamador.
    return undefined;
  // Datos de razonamiento.
  const info =
    entry.reasoning !== null && typeof entry.reasoning === "object"
      ? (entry.reasoning as { mandatory?: unknown; supported_efforts?: unknown })
      : {};
  // Se puede apagar: apagado.
  if (info.mandatory !== true) return { enabled: false };
  // Niveles admitidos, sin none ni max.
  const efforts = (Array.isArray(info.supported_efforts) ? info.supported_efforts : []).filter(
    (value): value is string => typeof value === "string" && value !== "none" && value !== "max",
  );
  // El último es el más bajo.
  const lowest = efforts.at(-1) ?? "low";
  // Nivel más bajo.
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
  // Proveedor elegido.
  const provider = config.provider ?? DEFAULT_LLM_PROVIDER;
  // Nivel por defecto de ese proveedor.
  const fallback = reasoningEffort(undefined, provider);
  // Nivel de LLM_REASONING_EFFORT o el de por defecto.
  const effort =
    config.reasoning === undefined ? (fallback === "invalid" ? null : fallback) : config.reasoning;
  // fetch que cuenta llamadas, si se pidió.
  const providerFetch = countingFetch(onCall);
  // Un caso por proveedor.
  switch (provider) {
    // Claude por la API de Anthropic.
    case "anthropic": {
      // Cliente con la clave, la URL y el espacio de trabajo opcional.
      const model = createAnthropic({
        apiKey: config.apiKey,
        baseURL: ANTHROPIC_BASE_URL,
        headers: config.workspaceId ? { "anthropic-workspace-id": config.workspaceId } : undefined,
        fetch: providerFetch,
      }).chat(modelId);
      // Sin razonamiento: modelo tal cual.
      if (effort === null) return model;
      // Sonnet 5.5 rechaza thinking=disabled. Sin herramientas, between_tools evita pensamiento
      // inicial y deja todo el tope de salida para el JSON o la respuesta. Los niveles altos usan adaptive.
      if (modelId === "claude-sonnet-5-5") {
        // none/minimal se traducen al mínimo admitido por este modelo, sin enviar disabled.
        const nativeEffort = effort === "none" || effort === "minimal" ? "low" : effort;
        return withDefaults(model, {
          providerOptions: {
            anthropic: {
              effort: nativeEffort,
              thinking: {
                type: ["low", "medium", "high"].includes(nativeEffort)
                  ? "between_tools"
                  : "adaptive",
              },
            },
          },
        });
      }
      // Opus 5.5 exige pensamiento adaptativo. El esfuerzo bajo acota el comparador opcional.
      if (modelId === "claude-opus-5-5") {
        return withDefaults(model, {
          providerOptions: {
            anthropic: {
              effort: effort === "none" || effort === "minimal" ? "low" : effort,
              thinking: { type: "adaptive" },
            },
          },
        });
      }
      // effort nativo si Anthropic lo admite; si no, la opción común.
      return ANTHROPIC_EFFORTS.has(effort)
        ? withDefaults(model, { providerOptions: { anthropic: { effort } } })
        : withDefaults(model, { reasoning: sdkReasoning(effort) });
    }
    // OpenAI.
    case "openai": {
      // Responses API: el SDK quita el razonamiento a los modelos que no lo admiten.
      // store=false: OpenAI no guarda la conversación del curso en su plataforma.
      const model = createOpenAI({
        apiKey: config.apiKey,
        baseURL: OPENAI_BASE_URL,
        fetch: providerFetch,
      }).responses(modelId);
      // Razonamiento común y store=false.
      return withDefaults(model, {
        ...(effort === null ? {} : { reasoning: sdkReasoning(effort) }),
        providerOptions: { openai: { store: false } },
      });
    }
    // Gemini con clave.
    case "gemini": {
      // Cliente de la Gemini API.
      const model = createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: GEMINI_BASE_URL,
        fetch: providerFetch,
      })(modelId);
      // Con razonamiento común, salvo que se omita.
      return effort === null ? model : withDefaults(model, { reasoning: sdkReasoning(effort) });
    }
    // OpenRouter: cualquier modelo de su catálogo.
    case "openrouter": {
      // Cliente de OpenRouter.
      const client = createOpenRouter({
        apiKey: config.apiKey,
        baseURL: OPENROUTER_BASE_URL,
        compatibility: "strict",
        appName: "thepower-rag",
        fetch: providerFetch,
      });
      // Sin nivel fijado, se decide con la ficha del modelo.
      if (config.reasoning === undefined) {
        // Sin nivel fijado, cada llamada consulta (una vez por instancia) la ficha del modelo.
        const middleware: LanguageModelMiddleware = {
          specificationVersion: "v4",
          // Ajusta los parámetros de la llamada mediante el middleware del modelo antes de enviarla.
          transformParams: async ({ params }) => {
            // Razonamiento según la ficha.
            const reasoning = await openRouterAutoReasoning(modelId);
            // Opciones propias de la llamada.
            const own = params.providerOptions?.openrouter ?? {};
            // Añade el razonamiento a las opciones de OpenRouter.
            return {
              ...params,
              providerOptions: {
                ...params.providerOptions,
                openrouter: { ...(reasoning ? { reasoning } : {}), ...own },
              } as NonNullable<typeof params.providerOptions>,
            };
          },
        };
        // Modelo envuelto.
        return wrapLanguageModel({
          model: client.chat(modelId) as Parameters<typeof wrapLanguageModel>[0]["model"],
          middleware,
        });
      }
      // OpenRouter no tiene nivel max; xhigh es el más alto que acepta.
      const openRouterEffort = effort === "max" ? "xhigh" : effort;
      // Con nivel fijado, se envía tal cual.
      return client.chat(
        modelId,
        openRouterEffort === null ? {} : { reasoning: { effort: openRouterEffort } },
      );
    }
    // API compatible con Chat Completions.
    case "compatible": {
      // Cliente con la URL y la clave opcional.
      const model = createOpenAICompatible({
        name: "compatible",
        baseURL: config.baseURL ?? "",
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        // Pide JSON con esquema (response_format json_schema) para CRAG e investigación.
        supportsStructuredOutputs: true,
        fetch: providerFetch,
      }).chatModel(modelId);
      // Razonamiento solo si se fijó.
      return effort === null ? model : withDefaults(model, { reasoning: sdkReasoning(effort) });
    }
  }
}

// Modelo generador (MODEL_ID).
export function createGenerationModel(config: GenerationSettings, onCall?: () => void) {
  // Mismo proveedor con el modelo de generación.
  return createLanguageModel(config, config.modelId, onCall);
}

// Modelo evaluador de CRAG (EVALUATOR_MODEL_ID).
export function createEvaluatorModel(
  config: GenerationSettings & { evaluatorModelId: string },
  onCall?: () => void,
) {
  // Mismo proveedor con el modelo evaluador.
  return createLanguageModel(config, config.evaluatorModelId, onCall);
}

// ¿Rechazó el modelo responder por su política de contenido?
export function refusedByModel(reason: string | undefined, raw: string | undefined): boolean {
  // Filtro de contenido del SDK o motivo refusal de Anthropic.
  return reason === "content-filter" || raw === "refusal";
}
