import type { RunMetadata } from "@thepower-rag/contracts";
import { HAIKU_INPUT_USD_PER_MILLION, HAIKU_OUTPUT_USD_PER_MILLION } from "./model";

export function providerCost(
  usage:
    | {
        inputTokens?: number | null;
        outputTokens?: number | null;
      }
    | null
    | undefined,
): RunMetadata["cost"] {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  const inputOk = typeof input === "number" && Number.isFinite(input) && input >= 0;
  const outputOk = typeof output === "number" && Number.isFinite(output) && output >= 0;
  if ((typeof input === "number" && !inputOk) || (typeof output === "number" && !outputOk)) {
    return null;
  }
  if (!inputOk && !outputOk) {
    return null;
  }
  return {
    amount:
      ((inputOk ? input : 0) * HAIKU_INPUT_USD_PER_MILLION +
        (outputOk ? output : 0) * HAIKU_OUTPUT_USD_PER_MILLION) /
      1_000_000,
    currency: "USD",
    source: "Anthropic",
    method: "published Claude Haiku 5.5 rates for prompts up to 100,000 tokens; excludes retrieval",
  };
}
