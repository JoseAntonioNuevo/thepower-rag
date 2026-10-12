import type { RunMetadata } from "@thepower-rag/contracts";
import type { Consumption } from "@thepower-rag/research";
import type { GenerationSettings, TokenPrices } from "./env";
import {
  HAIKU_INPUT_USD_PER_MILLION,
  HAIKU_MODEL_ID,
  HAIKU_OUTPUT_USD_PER_MILLION,
  PROVIDER_LABELS,
} from "./model";

/** El importe sale de tarifas publicadas. No es una factura devuelta por el proveedor. */
export const TOKEN_ESTIMATE_PROVENANCE =
  "Tarifas publicadas de Claude Haiku 5.5; no es un importe del proveedor.";

/** Procedencia cuando la tarifa viene de la configuración del modelo elegido. */
export const CONFIGURED_ESTIMATE_PROVENANCE =
  "Tarifas configuradas del modelo; no es un importe del proveedor.";

/** Tarifas publicadas de Claude Haiku 5.5 para prompts de hasta 100.000 tokens. */
export const HAIKU_PRICES: TokenPrices = {
  inputUsdPerMillion: HAIKU_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: HAIKU_OUTPUT_USD_PER_MILLION,
};

/** Tarifa, proveedor y método que acompañan al coste mostrado de una respuesta. */
export interface CostPricing {
  prices: TokenPrices;
  source: string;
  method: string;
}

const HAIKU_PRICING: CostPricing = {
  prices: HAIKU_PRICES,
  source: "Anthropic",
  method: "published Claude Haiku 5.5 rates for prompts up to 100,000 tokens; excludes retrieval",
};

/**
 * Tarifa del coste mostrado para una ruta generativa. Primero la de MODEL_*_USD_PER_MILLION;
 * sin ella, solo Claude Haiku 5.5 por Anthropic tiene una tarifa publicada en el código.
 * Cualquier otro modelo sin tarifa deja el coste en null: desconocido, no gratis.
 */
export function generationPricing(settings: GenerationSettings): CostPricing | null {
  const provider = settings.provider ?? "anthropic";
  if (settings.prices) {
    return {
      prices: settings.prices,
      source: PROVIDER_LABELS[provider],
      method:
        "MODEL_INPUT_USD_PER_MILLION and MODEL_OUTPUT_USD_PER_MILLION configured rates; excludes retrieval",
    };
  }
  return provider === "anthropic" && settings.modelId === HAIKU_MODEL_ID ? HAIKU_PRICING : null;
}

function finiteToken(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Tokens observados no son USD informado por el proveedor. Si falta entrada o
 * salida, la cifra parcial no cierra el cargo: la reserva sigue desconocida.
 * Sin tarifa explícita se usan las publicadas de Claude Haiku 5.5, como hasta ahora.
 */
export function tokenEstimateConsumption(
  usage:
    | {
        inputTokens?: number | null;
        outputTokens?: number | null;
      }
    | null
    | undefined,
  prices?: TokenPrices,
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
  const rates = prices ?? HAIKU_PRICES;
  const usd =
    ((inputOk ? input : 0) * rates.inputUsdPerMillion +
      (outputOk ? output : 0) * rates.outputUsdPerMillion) /
    1_000_000;
  return {
    kind: "estimated",
    usd,
    provenance: prices ? CONFIGURED_ESTIMATE_PROVENANCE : TOKEN_ESTIMATE_PROVENANCE,
    complete: inputOk && outputOk,
    inputTokens: inputOk ? input : null,
    outputTokens: outputOk ? output : null,
  };
}

/**
 * Coste estimado de una respuesta. Sin argumento de tarifa se usa la publicada de Claude Haiku
 * 5.5, como antes; con `null` el coste queda desconocido porque el modelo no tiene tarifa.
 */
export function providerCost(
  usage:
    | {
        inputTokens?: number | null;
        outputTokens?: number | null;
      }
    | null
    | undefined,
  pricing: CostPricing | null = HAIKU_PRICING,
): RunMetadata["cost"] {
  if (pricing === null) {
    return null;
  }
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
      ((inputOk ? input : 0) * pricing.prices.inputUsdPerMillion +
        (outputOk ? output : 0) * pricing.prices.outputUsdPerMillion) /
      1_000_000,
    currency: "USD",
    source: pricing.source,
    method: pricing.method,
  };
}
