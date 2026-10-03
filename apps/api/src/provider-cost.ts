import type { RunMetadata } from "@thepower-rag/contracts";
export function providerCost(metadata: unknown): RunMetadata["cost"] {
  const amount = (metadata as { openrouter?: { usage?: { cost?: unknown } } } | null)?.openrouter
    ?.usage?.cost;
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? {
        amount,
        currency: "USD",
        source: "OpenRouter",
        method:
          "provider-reported generation cost; excludes retrieval and CRAG evaluation/reformulation",
      }
    : null;
}
