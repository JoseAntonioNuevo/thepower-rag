import type { RunMetadata } from "@thepower-rag/contracts";
import type { Consumption } from "@thepower-rag/research";
import { HAIKU_INPUT_USD_PER_MILLION, HAIKU_OUTPUT_USD_PER_MILLION } from "./model";

/** El importe sale de tarifas publicadas. No es una factura devuelta por el proveedor. */
export const TOKEN_ESTIMATE_PROVENANCE =
  "Tarifas publicadas de Claude Haiku 5.5; no es un importe del proveedor.";

function finiteToken(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Tokens observados no son USD informado por el proveedor. Si falta entrada o
 * salida, la cifra parcial no cierra el cargo: la reserva sigue desconocida.
 */
export function tokenEstimateConsumption(
  usage:
    | {
        inputTokens?: number | null;
        outputTokens?: number | null;
      }
    | null
    | undefined,
): Consumption {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens;
  const inputOk = finiteToken(input);
  const outputOk = finiteToken(output);
  if ((typeof input === "number" && !inputOk) || (typeof output === "number" && !outputOk)) {
    return { kind: "unknown" };
  }
  if (!inputOk && !outputOk) {
    return { kind: "unknown" };
  }
  const usd =
    ((inputOk ? input : 0) * HAIKU_INPUT_USD_PER_MILLION +
      (outputOk ? output : 0) * HAIKU_OUTPUT_USD_PER_MILLION) /
    1_000_000;
  return {
    kind: "estimated",
    usd,
    provenance: TOKEN_ESTIMATE_PROVENANCE,
    complete: inputOk && outputOk,
    inputTokens: inputOk ? input : null,
    outputTokens: outputOk ? output : null,
  };
}

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
