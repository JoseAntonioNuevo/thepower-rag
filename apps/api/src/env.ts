import {
  CRAG_VARIABLES,
  GENERATION_VARIABLES,
  MEDIA_LIMITS,
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  RESEARCH_SPEND_TOKEN,
  RESEARCH_VARIABLES,
  isConfiguredValue,
  isVisionModel,
  type CapabilityStatus,
} from "@thepower-rag/contracts";
import { parseAllowedDomains } from "@thepower-rag/research";

export interface WorkerEnv {
  APP_MODE?: string;
  RAG_CONTEXT_MODE?: string;
  PUBLIC_ORIGIN?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  CHAT_IP_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  CHAT_SESSION_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  PUBLIC_BUDGET_USD?: string;
  MODEL_INPUT_USD_PER_MILLION?: string;
  MODEL_OUTPUT_USD_PER_MILLION?: string;
  EVALUATOR_INPUT_USD_PER_MILLION?: string;
  EVALUATOR_OUTPUT_USD_PER_MILLION?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  MODEL_ID?: string;
  EVALUATOR_MODEL_ID?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: string;
  CORPUS_VERSION?: string;
  INDEX_PROFILE?: string;
  VECTOR_METRIC?: string;
  MIN_RETRIEVAL_SCORE?: string;
  RESEARCH_MODEL_ID?: string;
  FIRECRAWL_API_KEY?: string;
  RESEARCH_SEARCH_PROVIDER?: string;
  TAVILY_API_KEY?: string;
  TAVILY_USD_PER_CREDIT?: string;
  RESEARCH_ALLOWED_DOMAINS?: string;
  RESEARCH_SPEND_AUTHORIZATION?: string;
  RESEARCH_BUDGET_USD?: string;
  RESEARCH_JOB_LIMIT_USD?: string;
  RESEARCH_FIXTURE_BUDGET_USD?: string;
  RESEARCH_FIXTURE_JOB_LIMIT_USD?: string;
  RESEARCH_INPUT_USD_PER_MILLION?: string;
  RESEARCH_OUTPUT_USD_PER_MILLION?: string;
  RESEARCH_SEARCH_USD?: string;
  RESEARCH_READ_USD?: string;
  FIRECRAWL_USD_PER_CREDIT?: string;
  RESEARCH_OWNER_SECRET?: string;
  AI?: unknown;
  VECTORIZE?: unknown;
  DB?: unknown;
  CORPUS?: unknown;
  RESEARCH_DB?: unknown;
  RESEARCH_WORKFLOW?: unknown;
  RESEARCH_MEDIA?: unknown;
  RESEARCH_VISION_MODEL_ID?: string;
  RESEARCH_STT_MODEL_ID?: string;
  RESEARCH_TTS_MODEL_ID?: string;
}

export interface CapabilityReport {
  status: CapabilityStatus;
  missing: string[];
}

export interface GenerationSettings {
  apiKey: string;
  modelId: string;
  workspaceId?: string;
}

export interface RetrievalSettings {
  embeddingModel: string;
  dimensions: number;
  corpusVersion: string;
  indexProfile: string;
  metric: "cosine";
  minScore: number;
}

export interface Assessment {
  execution: "demo" | "real" | "misconfigured";
  message: string | null;
  generation: GenerationSettings | null;
  retrieval: RetrievalSettings | null;
  capabilities: {
    "sin-rag": CapabilityReport;
    rag: CapabilityReport;
    crag: CapabilityReport;
    research: CapabilityReport;
  };
}

export interface ResearchSettings {
  searchProvider?: "firecrawl" | "tavily";
  tavilyApiKey?: string;
  tavilyUsdPerCredit?: number;
  plannerModelId: string;
  firecrawlApiKey: string;
  allowedDomains: string[];
  budgetUsd: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  firecrawlUsdPerCredit: number;
}

function positiveNumber(value: string | undefined): number | null {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

/**
 * Ajustes de la investigación real. Una autorización de gasto propia de S12,
 * un tope y precios explícitos. No reutiliza el presupuesto del RAG.
 */
export function researchSettings(
  env: WorkerEnv,
): { ok: true; settings: ResearchSettings } | { ok: false; missing: string[] } {
  const missing = new Set<string>(absent(env, RESEARCH_VARIABLES));
  const provider = env.RESEARCH_SEARCH_PROVIDER?.trim() || "firecrawl";
  if (provider !== "firecrawl" && provider !== "tavily") missing.add("RESEARCH_SEARCH_PROVIDER");
  if (provider === "tavily") {
    missing.delete("FIRECRAWL_API_KEY");
    if (!isConfiguredValue(env.TAVILY_API_KEY)) missing.add("TAVILY_API_KEY");
  }
  if (
    isConfiguredValue(env.RESEARCH_SPEND_AUTHORIZATION) &&
    env.RESEARCH_SPEND_AUTHORIZATION?.trim() !== RESEARCH_SPEND_TOKEN
  ) {
    missing.add("RESEARCH_SPEND_AUTHORIZATION");
  }
  const domains = parseAllowedDomains(env.RESEARCH_ALLOWED_DOMAINS);
  if (!domains.ok) {
    missing.add("RESEARCH_ALLOWED_DOMAINS");
  }
  const budgetUsd = positiveNumber(env.RESEARCH_BUDGET_USD);
  const inputUsdPerMillion = positiveNumber(env.RESEARCH_INPUT_USD_PER_MILLION);
  const outputUsdPerMillion = positiveNumber(env.RESEARCH_OUTPUT_USD_PER_MILLION);
  const firecrawlUsdPerCredit =
    provider === "tavily"
      ? positiveNumber(env.TAVILY_USD_PER_CREDIT)
      : positiveNumber(env.FIRECRAWL_USD_PER_CREDIT);
  if (budgetUsd === null) missing.add("RESEARCH_BUDGET_USD");
  if (inputUsdPerMillion === null) missing.add("RESEARCH_INPUT_USD_PER_MILLION");
  if (outputUsdPerMillion === null) missing.add("RESEARCH_OUTPUT_USD_PER_MILLION");
  if (firecrawlUsdPerCredit === null)
    missing.add(provider === "tavily" ? "TAVILY_USD_PER_CREDIT" : "FIRECRAWL_USD_PER_CREDIT");
  if (
    missing.size > 0 ||
    !domains.ok ||
    budgetUsd === null ||
    inputUsdPerMillion === null ||
    outputUsdPerMillion === null ||
    firecrawlUsdPerCredit === null
  ) {
    return { ok: false, missing: [...missing] };
  }
  return {
    ok: true,
    settings: {
      searchProvider: provider === "tavily" ? "tavily" : "firecrawl",
      ...(provider === "tavily"
        ? {
            tavilyApiKey: env.TAVILY_API_KEY?.trim() ?? "",
            tavilyUsdPerCredit: firecrawlUsdPerCredit,
          }
        : {}),
      plannerModelId: env.RESEARCH_MODEL_ID?.trim() ?? "",
      firecrawlApiKey: env.FIRECRAWL_API_KEY?.trim() ?? "",
      allowedDomains: domains.domains,
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
  const turnstileOwner =
    env.APP_MODE === "real" &&
    env.PUBLIC_BUDGET_USD !== undefined &&
    isConfiguredValue(env.TURNSTILE_SECRET_KEY) &&
    isConfiguredValue(env.PUBLIC_ORIGIN);
  return turnstileOwner || isConfiguredValue(env.RESEARCH_OWNER_SECRET);
}

/** Bindings y propietario del perfil durable. No autoriza gasto. */
export function durableResearchConfigured(env: WorkerEnv): boolean {
  return env.RESEARCH_DB != null && env.RESEARCH_WORKFLOW != null && researchOwnerReady(env);
}

export interface MediaReadiness {
  storage: "ready" | "missing";
  vision: "fixture" | "configured" | "missing";
  transcription: "fixture" | "configured" | "missing";
  speech: "fixture" | "configured" | "missing";
  note: string;
}

/** No llama a ningún proveedor. Solo mira bindings y nombres. */
export function mediaReadiness(env: WorkerEnv): MediaReadiness {
  const storage = env.RESEARCH_MEDIA == null ? "missing" : "ready";
  if (env.APP_MODE !== "real") {
    return {
      storage,
      vision: "fixture",
      transcription: "fixture",
      speech: "fixture",
      note: "Los medios de la demostración usan guiones y un tono local. No hay llamada de pago.",
    };
  }
  const visionId = env.RESEARCH_VISION_MODEL_ID?.trim() || env.RESEARCH_MODEL_ID?.trim() || "";
  const ai = env.AI != null;
  return {
    storage,
    vision:
      isVisionModel(visionId) && isConfiguredValue(env.ANTHROPIC_API_KEY)
        ? "configured"
        : "missing",
    transcription:
      ai && (env.RESEARCH_STT_MODEL_ID?.trim() || MEDIA_LIMITS.sttModelId).length > 0
        ? "configured"
        : "missing",
    speech:
      ai && (env.RESEARCH_TTS_MODEL_ID?.trim() || MEDIA_LIMITS.ttsModelId).length > 0
        ? "configured"
        : "missing",
    note: "Configurar no ejecuta visión, transcripción ni voz.",
  };
}

export function mediaMissing(
  env: WorkerEnv,
  request: { image: boolean; audio: boolean; voice: boolean },
): string[] {
  const ready = mediaReadiness(env);
  const missing: string[] = [];
  if ((request.image || request.audio || request.voice) && ready.storage !== "ready") {
    missing.push("RESEARCH_MEDIA");
  }
  if (env.APP_MODE !== "real") return missing;
  if (request.image && ready.vision !== "configured") {
    const visionId = env.RESEARCH_VISION_MODEL_ID?.trim() || env.RESEARCH_MODEL_ID?.trim() || "";
    if (!isVisionModel(visionId)) missing.push("RESEARCH_VISION_MODEL_ID");
    if (!isConfiguredValue(env.ANTHROPIC_API_KEY)) missing.push("ANTHROPIC_API_KEY");
  }
  if ((request.audio || request.voice) && env.AI == null) {
    missing.push("AI");
  }
  return [...new Set(missing)];
}

/**
 * La investigación real exige almacenamiento, flujo, tarifas, presupuesto
 * propio y autorización de gasto. No hereda el presupuesto del RAG.
 */
function researchCapability(env: WorkerEnv, ragMissing: readonly string[]): CapabilityReport {
  const settings = researchSettings(env);
  const missing = new Set<string>([...ragMissing, ...(settings.ok ? [] : settings.missing)]);
  if (env.RESEARCH_DB == null) {
    missing.add("RESEARCH_DB");
  }
  if (env.RESEARCH_WORKFLOW == null) {
    missing.add("RESEARCH_WORKFLOW");
  }
  if (!researchOwnerReady(env)) {
    missing.add("RESEARCH_OWNER_SECRET");
  }
  if (!isConfiguredValue(env.RESEARCH_JOB_LIMIT_USD)) {
    missing.add("RESEARCH_JOB_LIMIT_USD");
  }
  return {
    status: missing.size === 0 ? "ready" : "blocked",
    missing: [...missing],
  };
}

function text(env: WorkerEnv, name: keyof WorkerEnv): string | undefined {
  const value = env[name];
  return typeof value === "string" ? value : undefined;
}

function absent(env: WorkerEnv, names: readonly string[]): string[] {
  return names.filter((name) => !isConfiguredValue(text(env, name as keyof WorkerEnv)));
}

function positiveInteger(value: string | undefined): number | null {
  if (!isConfiguredValue(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value: string | undefined): number | null {
  if (!isConfiguredValue(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bindingNames(env: WorkerEnv): string[] {
  return RAG_BINDING_NAMES.filter((name) => env[name] == null);
}

function retrievalMissing(env: WorkerEnv): string[] {
  const missing = new Set<string>([
    ...absent(env, GENERATION_VARIABLES),
    ...absent(env, RAG_SETTING_VARIABLES),
    ...bindingNames(env),
  ]);
  if (
    isConfiguredValue(env.EMBEDDING_DIMENSIONS) &&
    positiveInteger(env.EMBEDDING_DIMENSIONS) === null
  ) {
    missing.add("EMBEDDING_DIMENSIONS");
  }
  if (
    isConfiguredValue(env.MIN_RETRIEVAL_SCORE) &&
    finiteNumber(env.MIN_RETRIEVAL_SCORE) === null
  ) {
    missing.add("MIN_RETRIEVAL_SCORE");
  }
  if (isConfiguredValue(env.VECTOR_METRIC) && env.VECTOR_METRIC?.trim() !== "cosine") {
    missing.add("VECTOR_METRIC");
  }
  return [...missing];
}

export function assessWorker(env: WorkerEnv): Assessment {
  const requested = env.APP_MODE?.trim();
  const generationMissing = absent(env, GENERATION_VARIABLES);
  const ragMissing = retrievalMissing(env);
  if (requested !== undefined && requested !== "demo" && requested !== "real") {
    return {
      execution: "misconfigured",
      message: "APP_MODE debe ser demo o real.",
      generation: null,
      retrieval: null,
      capabilities: {
        "sin-rag": { status: "blocked", missing: ["APP_MODE"] },
        rag: { status: "blocked", missing: ["APP_MODE"] },
        crag: { status: "blocked", missing: ["APP_MODE"] },
        research: { status: "blocked", missing: ["APP_MODE"] },
      },
    };
  }

  const generation =
    generationMissing.length === 0
      ? {
          apiKey: text(env, "ANTHROPIC_API_KEY")?.trim() ?? "",
          modelId: text(env, "MODEL_ID")?.trim() ?? "",
          ...(isConfiguredValue(text(env, "ANTHROPIC_WORKSPACE_ID"))
            ? { workspaceId: text(env, "ANTHROPIC_WORKSPACE_ID")?.trim() }
            : {}),
        }
      : null;
  const dimensions = positiveInteger(env.EMBEDDING_DIMENSIONS);
  const minScore = finiteNumber(env.MIN_RETRIEVAL_SCORE);
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

  if (requested === undefined || requested === "demo") {
    return {
      execution: "demo",
      message: null,
      generation: null,
      retrieval: null,
      capabilities: {
        "sin-rag": { status: "offline-demo", missing: [] },
        rag: { status: "offline-fixture", missing: [] },
        crag: { status: "offline-fixture", missing: [] },
        research: { status: "offline-fixture", missing: [] },
      },
    };
  }

  return {
    execution: "real",
    message:
      generation === null
        ? "El modo real necesita la configuración de generación. No hay demostración de sustitución."
        : null,
    generation,
    retrieval,
    capabilities: {
      "sin-rag": { status: generation ? "ready" : "blocked", missing: generationMissing },
      rag: { status: retrieval ? "ready" : "blocked", missing: ragMissing },
      crag: {
        status:
          retrieval !== null && absent(env, CRAG_VARIABLES).length === 0 ? "ready" : "blocked",
        missing: [...new Set([...ragMissing, ...absent(env, CRAG_VARIABLES)])],
      },
      research: researchCapability(env, ragMissing),
    },
  };
}
