import {
  CRAG_VARIABLES,
  GENERATION_VARIABLES,
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  RESEARCH_ACCOUNTING_MISSING,
  RESEARCH_SPEND_TOKEN,
  RESEARCH_VARIABLES,
  isConfiguredValue,
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
  RESEARCH_ALLOWED_DOMAINS?: string;
  RESEARCH_SPEND_AUTHORIZATION?: string;
  RESEARCH_BUDGET_USD?: string;
  RESEARCH_INPUT_USD_PER_MILLION?: string;
  RESEARCH_OUTPUT_USD_PER_MILLION?: string;
  FIRECRAWL_USD_PER_CREDIT?: string;
  AI?: unknown;
  VECTORIZE?: unknown;
  DB?: unknown;
  CORPUS?: unknown;
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
  const firecrawlUsdPerCredit = positiveNumber(env.FIRECRAWL_USD_PER_CREDIT);
  if (budgetUsd === null) missing.add("RESEARCH_BUDGET_USD");
  if (inputUsdPerMillion === null) missing.add("RESEARCH_INPUT_USD_PER_MILLION");
  if (outputUsdPerMillion === null) missing.add("RESEARCH_OUTPUT_USD_PER_MILLION");
  if (firecrawlUsdPerCredit === null) missing.add("FIRECRAWL_USD_PER_CREDIT");
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
 * La investigación real queda bloqueada en la fase 1: falta un libro de cuentas
 * durable del coste total. La lista de ausentes lo nombra siempre.
 */
function researchCapability(env: WorkerEnv, ragMissing: readonly string[]): CapabilityReport {
  const settings = researchSettings(env);
  return {
    status: "blocked",
    missing: [
      ...new Set([
        ...ragMissing,
        ...(settings.ok ? [] : settings.missing),
        RESEARCH_ACCOUNTING_MISSING,
      ]),
    ],
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
