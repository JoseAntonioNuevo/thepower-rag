import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { GenerationSettings } from "./env";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function openRouterFactoryLoaded(): boolean {
  return typeof createOpenRouter === "function";
}

export function createGenerationModel(config: GenerationSettings, onCall?: () => void) {
  return createOpenRouter({
    apiKey: config.apiKey,
    fetch: onCall
      ? async (url, init) => {
          onCall();
          return fetch(url, init);
        }
      : undefined,
    baseURL: OPENROUTER_BASE_URL,
    compatibility: "strict",
    appName: "thepower-rag",
  }).chat(config.modelId, modelOptions(config.modelId));
}

export function createEvaluatorModel(
  config: GenerationSettings & { evaluatorModelId: string },
  onCall?: () => void,
) {
  return createOpenRouter({
    apiKey: config.apiKey,
    fetch: onCall
      ? async (url, init) => {
          onCall();
          return fetch(url, init);
        }
      : undefined,
    baseURL: OPENROUTER_BASE_URL,
    compatibility: "strict",
    appName: "thepower-rag",
  }).chat(config.evaluatorModelId, modelOptions(config.evaluatorModelId));
}

export function modelOptions(modelId: string) {
  if (modelId === "google/gemini-3.8-flash") {
    return {
      reasoning: { effort: "low" as const },
      extraBody: { provider: { only: ["google-ai-studio"], allow_fallbacks: false } },
    };
  }
  return modelId === "openai/gpt-6-luna"
    ? {
        reasoning: { effort: "none" as const },
        extraBody: {
          service_tier: "priority",
          provider: { only: ["openai/fast"], allow_fallbacks: false },
        },
      }
    : {};
}
