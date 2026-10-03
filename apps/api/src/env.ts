import {
  CRAG_VARIABLES,
  GENERATION_VARIABLES,
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  isConfiguredValue,
  type CapabilityStatus,
} from "@thepower-rag/contracts";

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
  OPENROUTER_API_KEY?: string;
  MODEL_ID?: string;
  EVALUATOR_MODEL_ID?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: string;
  CORPUS_VERSION?: string;
  INDEX_PROFILE?: string;
  VECTOR_METRIC?: string;
  MIN_RETRIEVAL_SCORE?: string;
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
      },
    };
  }

  const generation =
    generationMissing.length === 0
      ? {
          apiKey: text(env, "OPENROUTER_API_KEY")?.trim() ?? "",
          modelId: text(env, "MODEL_ID")?.trim() ?? "",
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
    },
  };
}
