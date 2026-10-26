// GUÍA DE LECTURA · apps/api/src/env.ts
// Lectura de la configuración del Worker: variables y bindings, proveedor y ajustes de generación,
// ajustes del RAG y de la investigación, y el diagnóstico por etapa que usan /api/health y /api/chat.
// Nunca llama a la red: solo mira nombres, valores y bindings.
// Nombres de variables, límites y reglas compartidas del contrato.
import {
  // Variables de CRAG, proveedor por defecto, límites de medios y credencial de cada proveedor.
  CRAG_VARIABLES,
  DEFAULT_LLM_PROVIDER,
  MEDIA_LIMITS,
  PROVIDER_CREDENTIAL,
  // Bindings y variables del RAG, autorización y variables de la investigación.
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  RESEARCH_SPEND_TOKEN,
  RESEARCH_VARIABLES,
  // Reglas: variables de generación, valor configurado, proveedor, razonamiento y visión.
  generationVariables,
  isConfiguredValue,
  llmProvider,
  reasoningEffort,
  visionModelAccepted,
  // Tipos del estado de capacidad, proveedor y razonamiento.
  type CapabilityStatus,
  type LlmProvider,
  type ReasoningEffort,
} from "@thepower-rag/contracts";
// Lectura de la lista de dominios permitidos de la investigación.
import { parseAllowedDomains } from "@thepower-rag/research";
// Tipo del corpus del chat.
import type { ChatCorpusId } from "@thepower-rag/contracts";
// Corpus del chat: lectura de CHAT_CORPUS y variables y bindings propios de la tienda.
import {
  SHARED_RETRIEVAL_VARIABLES,
  STORE_BINDING_NAMES,
  STORE_SETTING_VARIABLES,
  chatCorpusId,
} from "./chat-corpus";

// Variables y bindings que recibe el Worker (todas opcionales).
export interface WorkerEnv {
  // demo o real.
  APP_MODE?: string;
  // complete para el RAG con contexto completo.
  RAG_CONTEXT_MODE?: string;
  // Corpus del chat: course (por defecto) o thepower-shop. La investigación usa siempre la tienda.
  CHAT_CORPUS?: string;
  // Versión del corpus de la tienda ThePower Shop.
  STORE_CORPUS_VERSION?: string;
  // Perfil del índice de la tienda.
  STORE_INDEX_PROFILE?: string;
  // Umbral de similitud del RAG básico sobre la tienda (calibrado con BGE-M3).
  STORE_MIN_RETRIEVAL_SCORE?: string;
  // Origen público (para Turnstile).
  PUBLIC_ORIGIN?: string;
  // Clave pública de Turnstile.
  TURNSTILE_SITE_KEY?: string;
  // Secreto de Turnstile.
  TURNSTILE_SECRET_KEY?: string;
  // Limitador de peticiones por IP.
  CHAT_IP_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  // Limitador de peticiones por sesión.
  CHAT_SESSION_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  // Presupuesto público en USD.
  PUBLIC_BUDGET_USD?: string;
  // Tarifa de entrada del generador.
  MODEL_INPUT_USD_PER_MILLION?: string;
  // Tarifa de salida del generador.
  MODEL_OUTPUT_USD_PER_MILLION?: string;
  // Tarifa de entrada del evaluador.
  EVALUATOR_INPUT_USD_PER_MILLION?: string;
  // Tarifa de salida del evaluador.
  EVALUATOR_OUTPUT_USD_PER_MILLION?: string;
  // Proveedor de los modelos generativos.
  LLM_PROVIDER?: string;
  // Nivel de razonamiento (opcional).
  LLM_REASONING_EFFORT?: string;
  // Clave de Anthropic.
  ANTHROPIC_API_KEY?: string;
  // Espacio de trabajo de Anthropic (opcional).
  ANTHROPIC_WORKSPACE_ID?: string;
  // Clave de OpenAI.
  OPENAI_API_KEY?: string;
  // Clave de OpenRouter.
  OPENROUTER_API_KEY?: string;
  // Clave de la Gemini API.
  GEMINI_API_KEY?: string;
  // URL de la API compatible.
  COMPAT_BASE_URL?: string;
  // Clave de la API compatible (opcional).
  COMPAT_API_KEY?: string;
  // Modelo generador.
  MODEL_ID?: string;
  // Modelo evaluador de CRAG.
  EVALUATOR_MODEL_ID?: string;
  // Plazo total de CRAG por turno, entre 1 y 120 segundos. Ausente conserva 20 segundos.
  CRAG_EXECUTION_BUDGET_MS?: string;
  // Mismo plazo por llamada para el generador de RAG y CRAG. Ausente conserva 20 segundos.
  MODEL_TIMEOUT_MS?: string;
  // Modelo de embeddings de Workers AI.
  EMBEDDING_MODEL?: string;
  // Dimensión observada.
  EMBEDDING_DIMENSIONS?: string;
  // Versión del corpus.
  CORPUS_VERSION?: string;
  // Perfil del índice.
  INDEX_PROFILE?: string;
  // Métrica (cosine).
  VECTOR_METRIC?: string;
  // Umbral de similitud.
  MIN_RETRIEVAL_SCORE?: string;
  // Modelo de la investigación.
  RESEARCH_MODEL_ID?: string;
  // Clave de Firecrawl.
  FIRECRAWL_API_KEY?: string;
  // Buscador de la investigación: firecrawl o tavily.
  RESEARCH_SEARCH_PROVIDER?: string;
  // Clave de Tavily.
  TAVILY_API_KEY?: string;
  // Precio de un crédito de Tavily.
  TAVILY_USD_PER_CREDIT?: string;
  // Dominios permitidos de la investigación.
  RESEARCH_ALLOWED_DOMAINS?: string;
  // Autorización de gasto de S12.
  RESEARCH_SPEND_AUTHORIZATION?: string;
  // Presupuesto total de la investigación.
  RESEARCH_BUDGET_USD?: string;
  // Tope por trabajo.
  RESEARCH_JOB_LIMIT_USD?: string;
  // Presupuesto de la demo durable.
  RESEARCH_FIXTURE_BUDGET_USD?: string;
  // Tope por trabajo de la demo durable.
  RESEARCH_FIXTURE_JOB_LIMIT_USD?: string;
  // Tarifa de entrada del modelo de investigación.
  RESEARCH_INPUT_USD_PER_MILLION?: string;
  // Tarifa de salida del modelo de investigación.
  RESEARCH_OUTPUT_USD_PER_MILLION?: string;
  // Precio de una búsqueda.
  RESEARCH_SEARCH_USD?: string;
  // Precio de una lectura.
  RESEARCH_READ_USD?: string;
  // Precio de un crédito de Firecrawl.
  FIRECRAWL_USD_PER_CREDIT?: string;
  // Secreto del propietario en local.
  RESEARCH_OWNER_SECRET?: string;
  // Binding de Workers AI.
  AI?: unknown;
  // Binding de Vectorize del curso.
  VECTORIZE?: unknown;
  // Binding de Vectorize de la tienda ThePower Shop (chat con la tienda e investigación).
  VECTORIZE_STORE?: unknown;
  // Binding de D1 del curso.
  DB?: unknown;
  // Binding de R2 del corpus.
  CORPUS?: unknown;
  // Binding de D1 de la investigación.
  RESEARCH_DB?: unknown;
  // Binding del Workflow de investigación.
  RESEARCH_WORKFLOW?: unknown;
  // Binding de R2 de medios.
  RESEARCH_MEDIA?: unknown;
  // Modelo de visión.
  RESEARCH_VISION_MODEL_ID?: string;
  // Modelo de transcripción.
  RESEARCH_STT_MODEL_ID?: string;
  // Modelo de voz.
  RESEARCH_TTS_MODEL_ID?: string;
}

// Estado de una capacidad y lo que le falta.
export interface CapabilityReport {
  // ready, blocked, offline-demo…
  status: CapabilityStatus;
  // Nombres ausentes.
  missing: string[];
}

/** Tarifa en USD por millón de tokens; sirve para mostrar un coste estimado, no una factura. */
export interface TokenPrices {
  // Entrada.
  inputUsdPerMillion: number;
  // Salida.
  outputUsdPerMillion: number;
}

/** Plazo acotado del turno de CRAG. Un valor escrito pero inválido bloquea CRAG. */
export function cragExecutionBudgetMs(env: WorkerEnv): number | null {
  // Ausente: contrato previo, para no cambiar guiones ni experimentos históricos.
  if (env.CRAG_EXECUTION_BUDGET_MS === undefined) return 20_000;
  // Solo enteros decimales explícitos, sin notación científica o valores infinitos.
  const raw = env.CRAG_EXECUTION_BUDGET_MS.trim();
  if (!/^\d+$/.test(raw))
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  const milliseconds = Number(raw);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 1_000 && milliseconds <= 120_000
    ? milliseconds
    : null;
}

// Plazo por llamada generativa, acotado independientemente del plazo total de CRAG.
export function modelTimeoutMs(env: WorkerEnv): number | null {
  if (env.MODEL_TIMEOUT_MS === undefined) return 20_000;
  const raw = env.MODEL_TIMEOUT_MS.trim();
  if (!/^\d+$/.test(raw))
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  const milliseconds = Number(raw);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 1_000 && milliseconds <= 60_000
    ? milliseconds
    : null;
}

/**
 * Ruta generativa común a chat, RAG, CRAG, investigación y visión. Cada papel cambia solo
 * el modelo (MODEL_ID, EVALUATOR_MODEL_ID, RESEARCH_MODEL_ID…); proveedor y clave son los mismos.
 */
export interface GenerationSettings {
  /** Proveedor de LLM_PROVIDER; sin valor, anthropic. */
  provider?: LlmProvider;
  /** Clave del proveedor. En compatible es opcional y puede quedar vacía. */
  apiKey: string;
  // Modelo en el formato del proveedor.
  modelId: string;
  /** Solo Anthropic: espacio de trabajo opcional. */
  workspaceId?: string;
  /** Solo compatible: URL base de su API (COMPAT_BASE_URL). */
  baseURL?: string;
  /** Razonamiento pedido; undefined usa el valor por defecto del proveedor y null no lo envía. */
  reasoning?: ReasoningEffort | null;
  /** Tarifa de MODEL_*_USD_PER_MILLION para el coste mostrado; null si no está configurada. */
  prices?: TokenPrices | null;
  // Tope de la llamada al generador; CRAG lo recorta además al tiempo restante del turno.
  timeoutMs?: number;
}

// Ajustes del RAG real.
export interface RetrievalSettings {
  // Modelo de embeddings.
  embeddingModel: string;
  // Dimensión.
  dimensions: number;
  // Versión del corpus.
  corpusVersion: string;
  // Perfil de índice.
  indexProfile: string;
  // Métrica.
  metric: "cosine";
  // Umbral.
  minScore: number;
}

// Diagnóstico completo del Worker.
export interface Assessment {
  // Modo de ejecución.
  execution: "demo" | "real" | "misconfigured";
  // Mensaje para el usuario, o null.
  message: string | null;
  // Ajustes de generación, o null.
  generation: GenerationSettings | null;
  // Ajustes del RAG del curso, o null.
  retrieval: RetrievalSettings | null;
  // Ajustes de búsqueda en las políticas de ThePower Shop, o null. Los usa la investigación de S12.
  storeRetrieval: RetrievalSettings | null;
  // Corpus del chat (null si CHAT_CORPUS no es válido).
  chatCorpus: ChatCorpusId | null;
  // Ajustes del RAG del chat: los del curso o los de la tienda, o null.
  chatRetrieval: RetrievalSettings | null;
  // Estado de cada etapa.
  capabilities: {
    // Sin RAG.
    "sin-rag": CapabilityReport;
    // RAG básico.
    rag: CapabilityReport;
    // CRAG.
    crag: CapabilityReport;
    // Investigación.
    research: CapabilityReport;
  };
}

// Ajustes de la investigación real.
export interface ResearchSettings {
  // Buscador.
  searchProvider?: "firecrawl" | "tavily";
  // Clave de Tavily.
  tavilyApiKey?: string;
  // Precio de un crédito de Tavily.
  tavilyUsdPerCredit?: number;
  // Modelo de la investigación.
  plannerModelId: string;
  // Clave de Firecrawl.
  firecrawlApiKey: string;
  // Dominios permitidos.
  allowedDomains: string[];
  // Presupuesto total.
  budgetUsd: number;
  // Tarifa de entrada.
  inputUsdPerMillion: number;
  // Tarifa de salida.
  outputUsdPerMillion: number;
  // Precio de un crédito del buscador.
  firecrawlUsdPerCredit: number;
}

// Número positivo o null.
function positiveNumber(value: string | undefined): number | null {
  // Número finito.
  const parsed = finiteNumber(value);
  // Solo si es mayor que cero.
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Ajustes de la investigación real. Una autorización de gasto propia de S12,
 * un tope y precios explícitos. No reutiliza el presupuesto del RAG.
 */
export function researchSettings(
  env: WorkerEnv,
): { ok: true; settings: ResearchSettings } | { ok: false; missing: string[] } {
  // Variables obligatorias ausentes.
  const missing = new Set<string>(absent(env, RESEARCH_VARIABLES));
  // Buscador elegido (Firecrawl por defecto).
  const provider = env.RESEARCH_SEARCH_PROVIDER?.trim() || "firecrawl";
  // Buscador desconocido.
  if (provider !== "firecrawl" && provider !== "tavily")
    // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
    missing.add("RESEARCH_SEARCH_PROVIDER");
  // Con Tavily.
  if (provider === "tavily") {
    // No hace falta la clave de Firecrawl.
    missing.delete("FIRECRAWL_API_KEY");
    // Pero sí la de Tavily.
    if (!isConfiguredValue(env.TAVILY_API_KEY))
      // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
      missing.add("TAVILY_API_KEY");
  }
  // La autorización tiene que ser exactamente la de S12.
  if (
    isConfiguredValue(env.RESEARCH_SPEND_AUTHORIZATION) &&
    env.RESEARCH_SPEND_AUTHORIZATION?.trim() !== RESEARCH_SPEND_TOKEN
  ) {
    // Autorización incorrecta.
    missing.add("RESEARCH_SPEND_AUTHORIZATION");
  }
  // Dominios permitidos.
  const domains = parseAllowedDomains(env.RESEARCH_ALLOWED_DOMAINS);
  // Lista inválida.
  if (!domains.ok) {
    // Se marca.
    missing.add("RESEARCH_ALLOWED_DOMAINS");
  }
  // Presupuesto.
  const budgetUsd = positiveNumber(env.RESEARCH_BUDGET_USD);
  // Tarifa de entrada.
  const inputUsdPerMillion = positiveNumber(env.RESEARCH_INPUT_USD_PER_MILLION);
  // Tarifa de salida.
  const outputUsdPerMillion = positiveNumber(env.RESEARCH_OUTPUT_USD_PER_MILLION);
  // Precio del crédito del buscador elegido.
  const firecrawlUsdPerCredit =
    provider === "tavily"
      ? positiveNumber(env.TAVILY_USD_PER_CREDIT)
      : positiveNumber(env.FIRECRAWL_USD_PER_CREDIT);
  // Falta el presupuesto.
  if (budgetUsd === null)
    // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
    missing.add("RESEARCH_BUDGET_USD");
  // Falta la tarifa de entrada.
  if (inputUsdPerMillion === null)
    // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
    missing.add("RESEARCH_INPUT_USD_PER_MILLION");
  // Falta la tarifa de salida.
  if (outputUsdPerMillion === null)
    // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
    missing.add("RESEARCH_OUTPUT_USD_PER_MILLION");
  // Falta el precio del crédito.
  if (firecrawlUsdPerCredit === null)
    // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
    missing.add(provider === "tavily" ? "TAVILY_USD_PER_CREDIT" : "FIRECRAWL_USD_PER_CREDIT");
  // Algo falta.
  if (
    missing.size > 0 ||
    !domains.ok ||
    budgetUsd === null ||
    inputUsdPerMillion === null ||
    outputUsdPerMillion === null ||
    firecrawlUsdPerCredit === null
  ) {
    // Lista de lo que falta.
    return { ok: false, missing: [...missing] };
  }
  // Ajustes completos.
  return {
    ok: true,
    // Buscador elegido y, si es Tavily, su clave y precio por crédito.
    settings: {
      searchProvider: provider === "tavily" ? "tavily" : "firecrawl",
      ...(provider === "tavily"
        ? {
            tavilyApiKey: env.TAVILY_API_KEY?.trim() ?? "",
            // firecrawlUsdPerCredit ya contiene el precio del crédito del buscador elegido (Tavily
            // aquí).
            tavilyUsdPerCredit: firecrawlUsdPerCredit,
          }
        : {}),
      // Modelo del planificador, clave de Firecrawl y dominios permitidos.
      plannerModelId: env.RESEARCH_MODEL_ID?.trim() ?? "",
      firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() ?? "",
      allowedDomains: domains.domains,
      // Presupuesto y tarifas.
      budgetUsd,
      inputUsdPerMillion,
      outputUsdPerMillion,
      firecrawlUsdPerCredit,
    },
  };
}

/**
 * Turnstile identifica al propietario solo en real, con presupuesto público,
 * secreto y origen. En cualquier otro caso hace falta el secreto local.
 */
export function researchOwnerReady(env: WorkerEnv): boolean {
  // Propietario por Turnstile: modo real con presupuesto público, secreto y origen.
  const turnstileOwner =
    env.APP_MODE === "real" &&
    env.PUBLIC_BUDGET_USD !== undefined &&
    isConfiguredValue(env.TURNSTILE_SECRET_KEY) &&
    isConfiguredValue(env.PUBLIC_ORIGIN);
  // O el secreto local del propietario.
  return turnstileOwner || isConfiguredValue(env.RESEARCH_OWNER_SECRET);
}

/** Bindings y propietario del perfil durable. No autoriza gasto. */
export function durableResearchConfigured(env: WorkerEnv): boolean {
  // Base de datos, Workflow y propietario.
  return env.RESEARCH_DB != null && env.RESEARCH_WORKFLOW != null && researchOwnerReady(env);
}

// Estado de los medios de S12.
export interface MediaReadiness {
  // Almacenamiento R2.
  storage: "ready" | "missing";
  // Visión.
  vision: "fixture" | "configured" | "missing";
  // Transcripción.
  transcription: "fixture" | "configured" | "missing";
  // Voz.
  speech: "fixture" | "configured" | "missing";
  // Nota legible.
  note: string;
}

/** No llama a ningún proveedor. Solo mira bindings y nombres. */
export function mediaReadiness(env: WorkerEnv): MediaReadiness {
  // ¿Hay bucket de medios?
  const storage = env.RESEARCH_MEDIA == null ? "missing" : "ready";
  // En demo, todo son guiones.
  if (env.APP_MODE !== "real") {
    // Estado de la demo.
    return {
      storage,
      vision: "fixture",
      transcription: "fixture",
      speech: "fixture",
      note: "Los medios de la demostración usan guiones y un tono local. No hay llamada de pago.",
    };
  }
  // Modelo de visión: el específico o el de la investigación.
  const visionId = env.RESEARCH_VISION_MODEL_ID?.trim() || env.RESEARCH_MODEL_ID?.trim() || "";
  // Proveedor elegido.
  const provider = llmProvider(env.LLM_PROVIDER);
  // ¿Hay binding de Workers AI?
  const ai = env.AI != null;
  // Estado real.
  return {
    // Almacenamiento de medios (R2 y D1).
    storage,
    // Visión: proveedor válido, modelo que acepta imágenes y clave presente.
    vision:
      provider !== null &&
      visionModelAccepted(provider, visionId) &&
      isConfiguredValue(text(env, PROVIDER_CREDENTIAL[provider] as keyof WorkerEnv))
        ? "configured"
        : "missing",
    // Transcripción y voz: binding AI y modelo (el configurado o el de por defecto).
    transcription:
      ai && (env.RESEARCH_STT_MODEL_ID?.trim() || MEDIA_LIMITS.sttModelId).length > 0
        ? "configured"
        : "missing",
    speech:
      ai && (env.RESEARCH_TTS_MODEL_ID?.trim() || MEDIA_LIMITS.ttsModelId).length > 0
        ? "configured"
        : "missing",
    // Configurado no significa comprobado: no se llama a ningún proveedor.
    note: "Configurar no ejecuta visión, transcripción ni voz.",
  };
}

// Qué falta para los medios pedidos.
export function mediaMissing(
  env: WorkerEnv,
  request: { image: boolean; audio: boolean; voice: boolean },
): string[] {
  // Estado de los medios.
  const ready = mediaReadiness(env);
  // Lo que falta.
  const missing: string[] = [];
  // Cualquier medio necesita el bucket.
  if ((request.image || request.audio || request.voice) && ready.storage !== "ready") {
    // Falta R2.
    missing.push("RESEARCH_MEDIA");
  }
  // En demo no hace falta nada más.
  if (env.APP_MODE !== "real") return missing;
  // Imagen sin visión configurada.
  if (request.image && ready.vision !== "configured") {
    // Modelo de visión.
    const visionId = env.RESEARCH_VISION_MODEL_ID?.trim() || env.RESEARCH_MODEL_ID?.trim() || "";
    // Proveedor.
    const provider = llmProvider(env.LLM_PROVIDER);
    // Proveedor desconocido.
    if (provider === null) {
      // Se marca.
      missing.push("LLM_PROVIDER");
    } else {
      // Modelo de visión no admitido.
      if (!visionModelAccepted(provider, visionId))
        // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
        missing.push("RESEARCH_VISION_MODEL_ID");
      // Credencial del proveedor.
      const credential = PROVIDER_CREDENTIAL[provider];
      // Sin credencial.
      if (!isConfiguredValue(text(env, credential as keyof WorkerEnv)))
        // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
        missing.push(credential);
    }
  }
  // Audio o voz sin Workers AI.
  if ((request.audio || request.voice) && env.AI == null) {
    // Falta AI.
    missing.push("AI");
  }
  // Sin repetidos.
  return [...new Set(missing)];
}

/**
 * La investigación real exige almacenamiento, flujo, tarifas, presupuesto
 * propio y autorización de gasto. No hereda el presupuesto del RAG.
 */
function researchCapability(env: WorkerEnv, storeMissing: readonly string[]): CapabilityReport {
  // Ajustes de la investigación.
  const settings = researchSettings(env);
  // Lo que falta de la búsqueda en la tienda y de la investigación.
  const missing = new Set<string>([...storeMissing, ...(settings.ok ? [] : settings.missing)]);
  // Sin base de datos de investigación.
  if (env.RESEARCH_DB == null) {
    // Se marca.
    missing.add("RESEARCH_DB");
  }
  // Sin Workflow.
  if (env.RESEARCH_WORKFLOW == null) {
    // Se marca.
    missing.add("RESEARCH_WORKFLOW");
  }
  // Sin propietario.
  if (!researchOwnerReady(env)) {
    // Se marca.
    missing.add("RESEARCH_OWNER_SECRET");
  }
  // Sin tope por trabajo.
  if (!isConfiguredValue(env.RESEARCH_JOB_LIMIT_USD)) {
    // Se marca.
    missing.add("RESEARCH_JOB_LIMIT_USD");
  }
  // Estado de la investigación.
  return {
    status: missing.size === 0 ? "ready" : "blocked",
    missing: [...missing],
  };
}

// Valor de texto de una variable, o undefined si no es texto.
function text(env: WorkerEnv, name: keyof WorkerEnv): string | undefined {
  // Valor.
  const value = env[name];
  // Solo texto.
  return typeof value === "string" ? value : undefined;
}

// Nombres sin un valor configurado.
function absent(env: WorkerEnv, names: readonly string[]): string[] {
  // Filtra los ausentes o con marcador.
  return names.filter((name) => !isConfiguredValue(text(env, name as keyof WorkerEnv)));
}

// Entero positivo o null.
function positiveInteger(value: string | undefined): number | null {
  // Sin valor.
  if (!isConfiguredValue(value)) {
    // null.
    return null;
  }
  // Número.
  const parsed = Number(value);
  // Entero mayor que cero.
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Número finito o null.
function finiteNumber(value: string | undefined): number | null {
  // Sin valor.
  if (!isConfiguredValue(value)) {
    // null.
    return null;
  }
  // Número.
  const parsed = Number(value);
  // Finito.
  return Number.isFinite(parsed) ? parsed : null;
}

// Bindings del RAG que faltan.
function bindingNames(env: WorkerEnv): string[] {
  // Los que no están definidos.
  return RAG_BINDING_NAMES.filter((name) => env[name] == null);
}

/**
 * Lo que falta para generar con el proveedor de LLM_PROVIDER: el nombre del proveedor si no
 * existe, su credencial, MODEL_ID, un razonamiento que no existe o una URL compatible insegura.
 */
export function generationMissing(env: WorkerEnv): string[] {
  // Proveedor elegido.
  const provider = llmProvider(env.LLM_PROVIDER);
  // Proveedor desconocido.
  if (provider === null) {
    // Se informa junto con el modelo si falta.
    return ["LLM_PROVIDER", ...absent(env, ["MODEL_ID"])];
  }
  // Credencial y modelo del proveedor.
  const missing = absent(env, generationVariables(provider));
  // Un plazo inválido escrito no se ignora: bloquea antes de llamar al modelo.
  if (modelTimeoutMs(env) === null)
    // Añade el requisito ausente al diagnóstico para bloquear una capacidad incompleta.
    missing.push("MODEL_TIMEOUT_MS");
  // Nivel de razonamiento inválido.
  if (reasoningEffort(env.LLM_REASONING_EFFORT, provider) === "invalid") {
    // Se informa.
    missing.push("LLM_REASONING_EFFORT");
  }
  // URL compatible insegura.
  if (
    provider === "compatible" &&
    isConfiguredValue(env.COMPAT_BASE_URL) &&
    !compatibleUrlAllowed(env.COMPAT_BASE_URL ?? "")
  ) {
    // Se informa.
    missing.push("COMPAT_BASE_URL");
  }
  // Lo que falta.
  return missing;
}

/**
 * La clave de una API compatible solo viaja cifrada: https, o http hacia este mismo equipo
 * (Ollama o vLLM en localhost). Así una URL mal escrita no envía la clave en claro por la red.
 */
export function compatibleUrlAllowed(value: string): boolean {
  // URL analizada.
  let url: URL;
  // new URL falla con texto que no es una URL.
  try {
    // Analiza.
    url = new URL(value.trim());
  } catch {
    // No es una URL.
    return false;
  }
  // https siempre vale.
  if (url.protocol === "https:")
    // Confirma la condición de esta rama y comunica el resultado positivo al llamador.
    return true;
  // http solo hacia este mismo equipo.
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

/** Tarifa por millón de tokens de dos variables; null si falta alguna o no es positiva. */
export function tokenPrices(
  input: string | undefined,
  output: string | undefined,
): TokenPrices | null {
  // Tarifa de entrada.
  const inputUsdPerMillion = positiveNumber(input);
  // Tarifa de salida.
  const outputUsdPerMillion = positiveNumber(output);
  // Las dos o ninguna.
  return inputUsdPerMillion === null || outputUsdPerMillion === null
    ? null
    : { inputUsdPerMillion, outputUsdPerMillion };
}

/**
 * Ajustes de generación del proveedor elegido, o null si falta algo. Construirlos no llama a
 * la red. Los papeles que usan otro modelo copian estos ajustes y cambian solo modelId.
 */
export function generationSettings(env: WorkerEnv): GenerationSettings | null {
  // Proveedor elegido (anthropic por defecto).
  const provider = llmProvider(env.LLM_PROVIDER) ?? DEFAULT_LLM_PROVIDER;
  // Si falta algo, no hay ajustes.
  if (generationMissing(env).length > 0) {
    // null.
    return null;
  }
  // Nivel de razonamiento.
  const reasoning = reasoningEffort(env.LLM_REASONING_EFFORT, provider);
  // Credencial del proveedor (en compatible, la URL).
  const credential = text(env, PROVIDER_CREDENTIAL[provider] as keyof WorkerEnv)?.trim() ?? "";
  // Ajustes de generación.
  return {
    // Proveedor y clave. En «compatible» la clave es opcional.
    provider,
    apiKey:
      provider === "compatible"
        ? isConfiguredValue(env.COMPAT_API_KEY)
          ? (env.COMPAT_API_KEY?.trim() ?? "")
          : ""
        : credential,
    // Modelo generativo.
    modelId: text(env, "MODEL_ID")?.trim() ?? "",
    // Espacio de trabajo de Anthropic, solo si está configurado.
    ...(provider === "anthropic" && isConfiguredValue(text(env, "ANTHROPIC_WORKSPACE_ID"))
      ? { workspaceId: text(env, "ANTHROPIC_WORKSPACE_ID")?.trim() }
      : {}),
    // En «compatible», la URL base del servidor.
    ...(provider === "compatible" ? { baseURL: credential } : {}),
    // Solo un LLM_REASONING_EFFORT escrito fija el nivel; sin él decide cada proveedor.
    ...(isConfiguredValue(env.LLM_REASONING_EFFORT) && reasoning !== "invalid"
      ? { reasoning }
      : {}),
    prices: tokenPrices(env.MODEL_INPUT_USD_PER_MILLION, env.MODEL_OUTPUT_USD_PER_MILLION),
    timeoutMs: modelTimeoutMs(env) ?? undefined,
  };
}

// Lo que falta para el RAG real.
function retrievalMissing(env: WorkerEnv): string[] {
  // Generación, ajustes del RAG y bindings.
  const missing = new Set<string>([
    ...generationMissing(env),
    ...absent(env, RAG_SETTING_VARIABLES),
    ...bindingNames(env),
  ]);
  // Dimensión no válida.
  if (
    isConfiguredValue(env.EMBEDDING_DIMENSIONS) &&
    positiveInteger(env.EMBEDDING_DIMENSIONS) === null
  ) {
    // Se marca.
    missing.add("EMBEDDING_DIMENSIONS");
  }
  // Umbral no válido.
  if (
    isConfiguredValue(env.MIN_RETRIEVAL_SCORE) &&
    finiteNumber(env.MIN_RETRIEVAL_SCORE) === null
  ) {
    // Se marca.
    missing.add("MIN_RETRIEVAL_SCORE");
  }
  // Métrica distinta de coseno.
  if (isConfiguredValue(env.VECTOR_METRIC) && env.VECTOR_METRIC?.trim() !== "cosine") {
    // Se marca.
    missing.add("VECTOR_METRIC");
  }
  // Lista sin repetidos.
  return [...missing];
}

// Lo que falta para buscar en las políticas de la tienda: generación, embeddings compartidos, sus
// variables y su índice. Lo usan el chat con la tienda y la investigación de S12.
function storeSettingsMissing(env: WorkerEnv): string[] {
  // Generación, ajustes compartidos, variables de la tienda y bindings.
  const missing = new Set<string>([
    ...generationMissing(env),
    ...absent(env, SHARED_RETRIEVAL_VARIABLES),
    ...absent(env, STORE_SETTING_VARIABLES),
    ...STORE_BINDING_NAMES.filter((name) => env[name] == null),
  ]);
  // Dimensión no válida.
  if (
    isConfiguredValue(env.EMBEDDING_DIMENSIONS) &&
    positiveInteger(env.EMBEDDING_DIMENSIONS) === null
  )
    // Se marca.
    missing.add("EMBEDDING_DIMENSIONS");
  // Umbral de la tienda no válido.
  if (
    isConfiguredValue(env.STORE_MIN_RETRIEVAL_SCORE) &&
    finiteNumber(env.STORE_MIN_RETRIEVAL_SCORE) === null
  )
    // Se marca.
    missing.add("STORE_MIN_RETRIEVAL_SCORE");
  // Métrica distinta de coseno.
  if (isConfiguredValue(env.VECTOR_METRIC) && env.VECTOR_METRIC?.trim() !== "cosine")
    // Se marca.
    missing.add("VECTOR_METRIC");
  // Lista sin repetidos.
  return [...missing];
}

// Lo que falta para que el chat use la tienda. Con la tienda el contexto completo no está
// disponible: se pide el recorrido semántico.
function storeRetrievalMissing(env: WorkerEnv): string[] {
  // Ajustes de la tienda.
  const missing = new Set(storeSettingsMissing(env));
  // El contexto completo lee el manifiesto del curso: con la tienda no se sustituye en silencio.
  if (env.RAG_CONTEXT_MODE === "complete")
    // Se marca.
    missing.add("RAG_CONTEXT_MODE");
  // Lista sin repetidos.
  return [...missing];
}

// Diagnóstico completo del Worker.
export function assessWorker(env: WorkerEnv): Assessment {
  // Modo pedido.
  const requested = env.APP_MODE?.trim();
  // Lo que falta para generar.
  const generationGaps = generationMissing(env);
  // Lo que falta para el RAG.
  const ragMissing = retrievalMissing(env);
  // Modo desconocido.
  if (requested !== undefined && requested !== "demo" && requested !== "real") {
    // Todo bloqueado.
    return {
      // Valor desconocido: no se adivina el modo, se bloquean todas las etapas.
      execution: "misconfigured",
      message: "APP_MODE debe ser demo o real.",
      generation: null,
      retrieval: null,
      storeRetrieval: null,
      chatCorpus: chatCorpusId(env.CHAT_CORPUS),
      chatRetrieval: null,
      // Cada etapa dice qué falta: APP_MODE.
      capabilities: {
        "sin-rag": { status: "blocked", missing: ["APP_MODE"] },
        rag: { status: "blocked", missing: ["APP_MODE"] },
        crag: { status: "blocked", missing: ["APP_MODE"] },
        research: { status: "blocked", missing: ["APP_MODE"] },
      },
    };
  }

  // Ajustes de generación.
  const generation = generationSettings(env);
  // Dimensión.
  const dimensions = positiveInteger(env.EMBEDDING_DIMENSIONS);
  // Umbral.
  const minScore = finiteNumber(env.MIN_RETRIEVAL_SCORE);
  // Ajustes del RAG si no falta nada.
  const retrieval =
    ragMissing.length === 0 && generation !== null && dimensions !== null && minScore !== null
      ? {
          embeddingModel: text(env, "EMBEDDING_MODEL")?.trim() ?? "",
          dimensions,
          corpusVersion: text(env, "CORPUS_VERSION")?.trim() ?? "",
          indexProfile: text(env, "INDEX_PROFILE")?.trim() ?? "",
          metric: "cosine" as const,
          minScore,
        }
      : null;

  // Corpus del chat pedido (null si el valor no es válido).
  const chatCorpus = chatCorpusId(env.CHAT_CORPUS);
  // Lo que falta para el chat: el del curso, el de la tienda o el propio CHAT_CORPUS.
  const chatMissing =
    chatCorpus === null
      ? ["CHAT_CORPUS"]
      : chatCorpus === "course"
        ? ragMissing
        : storeRetrievalMissing(env);
  // Umbral de la tienda.
  const storeMinScore = finiteNumber(env.STORE_MIN_RETRIEVAL_SCORE);
  // Lo que falta para buscar en la tienda.
  const storeMissing = storeSettingsMissing(env);
  // Ajustes de búsqueda en la tienda si no falta nada, sea cual sea el corpus del chat.
  const storeRetrieval =
    storeMissing.length === 0 &&
    generation !== null &&
    dimensions !== null &&
    storeMinScore !== null
      ? {
          embeddingModel: text(env, "EMBEDDING_MODEL")?.trim() ?? "",
          dimensions,
          corpusVersion: text(env, "STORE_CORPUS_VERSION")?.trim() ?? "",
          indexProfile: text(env, "STORE_INDEX_PROFILE")?.trim() ?? "",
          metric: "cosine" as const,
          minScore: storeMinScore,
        }
      : null;
  // Ajustes del RAG del chat si no falta nada.
  const chatRetrieval =
    chatCorpus === "course"
      ? retrieval
      : chatCorpus === "thepower-shop" && chatMissing.length === 0
        ? storeRetrieval
        : null;

  // Modo demo (o sin modo): todo con guiones.
  if (requested === undefined || requested === "demo") {
    // Diagnóstico de la demo.
    return {
      // Demo: nada que configurar; todo funciona sin red ni claves.
      execution: "demo",
      message: null,
      generation: null,
      retrieval: null,
      storeRetrieval: null,
      // La demo usa el corpus preparado que pide CHAT_CORPUS (sin valor, el del curso).
      chatCorpus: chatCorpus ?? "course",
      chatRetrieval: null,
      // Estados «offline-*»: la interfaz los muestra como demostración, no como servicio real.
      capabilities: {
        "sin-rag": { status: "offline-demo", missing: [] },
        rag: { status: "offline-fixture", missing: [] },
        crag: { status: "offline-fixture", missing: [] },
        research: { status: "offline-fixture", missing: [] },
      },
    };
  }

  // Diagnóstico del modo real por etapa.
  return {
    // Modo real: cada etapa se habilita por separado según lo que esté configurado.
    execution: "real",
    // Mensaje global si falta lo mínimo (generación). No se cae a la demo.
    message:
      generation === null
        ? "El modo real necesita la configuración de generación. No hay demostración de sustitución."
        : null,
    // Ajustes resueltos de generación y recuperación (o null): el curso, la tienda y el del chat.
    generation,
    retrieval,
    storeRetrieval,
    chatCorpus,
    chatRetrieval,
    // Sin RAG necesita generación; RAG, la recuperación del chat; CRAG, además el evaluador.
    capabilities: {
      "sin-rag": {
        status: generation && chatCorpus !== null ? "ready" : "blocked",
        missing: chatCorpus === null ? [...generationGaps, "CHAT_CORPUS"] : generationGaps,
      },
      rag: { status: chatRetrieval ? "ready" : "blocked", missing: chatMissing },
      crag: {
        status:
          chatRetrieval !== null &&
          absent(env, CRAG_VARIABLES).length === 0 &&
          cragExecutionBudgetMs(env) !== null
            ? "ready"
            : "blocked",
        missing: [
          ...new Set([
            ...chatMissing,
            ...absent(env, CRAG_VARIABLES),
            ...(cragExecutionBudgetMs(env) === null ? ["CRAG_EXECUTION_BUDGET_MS"] : []),
          ]),
        ],
      },
      // La investigación tiene su propio diagnóstico y lee siempre las políticas de la tienda.
      research: researchCapability(env, storeMissing),
    },
  };
}
