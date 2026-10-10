import { createAnthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { GenerationSettings } from "./env";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
export const HAIKU_MODEL_ID = "claude-haiku-5-5";
export const HAIKU_INPUT_USD_PER_MILLION = 0.1;
export const HAIKU_OUTPUT_USD_PER_MILLION = 0.5;

/** Effort low keeps adaptive thinking small so a short course answer still fits maxOutputTokens. */
export const anthropicProviderOptions = {
  anthropic: {
    effort: "low",
  } satisfies AnthropicLanguageModelOptions,
};

export function anthropicFactoryLoaded(): boolean {
  return typeof createAnthropic === "function";
}

function client(config: GenerationSettings, onCall?: () => void) {
  return createAnthropic({
    apiKey: config.apiKey,
    baseURL: ANTHROPIC_BASE_URL,
    headers: config.workspaceId ? { "anthropic-workspace-id": config.workspaceId } : undefined,
    fetch: onCall
      ? async (url, init) => {
          onCall();
          return fetch(url, init);
        }
      : undefined,
  });
}

export function createGenerationModel(config: GenerationSettings, onCall?: () => void) {
  return client(config, onCall).chat(config.modelId);
}

export function createEvaluatorModel(
  config: GenerationSettings & { evaluatorModelId: string },
  onCall?: () => void,
) {
  return client(config, onCall).chat(config.evaluatorModelId);
}

export function refusedByModel(reason: string | undefined, raw: string | undefined): boolean {
  return reason === "content-filter" || raw === "refusal";
}
