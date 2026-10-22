// GUÍA DE LECTURA · apps/api/src/provider-cost.ts
// Coste estimado de una respuesta y consumo estimado de la investigación: tokens por la tarifa
// configurada del modelo elegido, o la publicada de Claude Haiku 5.5. Nunca es una factura.
// Tipo de los metadatos de una ejecución.
import type { RunMetadata } from "@thepower-rag/contracts";
// Tipo del consumo de la investigación.
import type { Consumption } from "@thepower-rag/research";
// Tipos de ajustes y tarifas.
import type { GenerationSettings, TokenPrices } from "./env";
// Tarifas comprobadas de los perfiles de calidad y comparación del curso.
import { COURSE_MODEL_PROFILES } from "./course-models";
// Tarifas publicadas de Haiku y nombres de proveedor.
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
  // Tarifa en USD por millón de tokens.
  prices: TokenPrices;
  // Quién aporta la tarifa.
  source: string;
  // Cómo se calcula.
  method: string;
}

// Coste con la tarifa publicada de Claude Haiku 5.5.
const HAIKU_PRICING: CostPricing = {
  prices: HAIKU_PRICES,
  source: "Anthropic",
  method: "published Claude Haiku 5.5 rates for prompts up to 100,000 tokens; excludes retrieval",
};

/**
 * Tarifa del coste mostrado para una ruta generativa. Primero la de MODEL_*_USD_PER_MILLION;
 * sin ella se usan solo las tarifas publicadas de los perfiles Anthropic conocidos.
 * Cualquier otro modelo sin tarifa deja el coste en null: desconocido, no gratis.
 */
export function generationPricing(settings: GenerationSettings): CostPricing | null {
  // Proveedor elegido.
  const provider = settings.provider ?? "anthropic";
  // Con tarifa configurada, se usa esa.
  if (settings.prices) {
    // Tarifa, proveedor y método.
    return {
      prices: settings.prices,
      source: PROVIDER_LABELS[provider],
      method:
        "MODEL_INPUT_USD_PER_MILLION and MODEL_OUTPUT_USD_PER_MILLION configured rates; excludes retrieval",
    };
  }
  // Sin tarifa explícita se comprueba el catálogo acotado; un modelo ajeno queda desconocido.
  if (provider === "anthropic" && settings.modelId === HAIKU_MODEL_ID) return HAIKU_PRICING;
  // Sonnet/Opus usan sus propias tarifas, nunca las de Haiku por omisión.
  const known = [COURSE_MODEL_PROFILES.sonnet, COURSE_MODEL_PROFILES.opus].find(
    (profile) => profile.modelId === settings.modelId,
  );
  return provider === "anthropic" && known
    ? {
        prices: {
          inputUsdPerMillion: known.inputUsdPerMillion,
          outputUsdPerMillion: known.outputUsdPerMillion,
        },
        source: "Anthropic",
        method: `Published ${known.modelId} rates checked 2026-10-18; excludes retrieval`,
      }
    : null;
}

// ¿Es un número de tokens válido?
function finiteToken(value: number | null | undefined): value is number {
  // Número finito y no negativo.
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
        // Tokens de entrada observados.
        inputTokens?: number | null;
        // Tokens de salida observados.
        outputTokens?: number | null;
      }
    | null
    | undefined,
  prices?: TokenPrices,
): Consumption {
  // Tokens de entrada.
  const input = usage?.inputTokens;
  // Tokens de salida.
  const output = usage?.outputTokens;
  // ¿Entrada válida?
  const inputOk = finiteToken(input);
  // ¿Salida válida?
  const outputOk = finiteToken(output);
  // Un valor numérico inválido deja el consumo desconocido.
  if ((typeof input === "number" && !inputOk) || (typeof output === "number" && !outputOk)) {
    // Desconocido.
    return { kind: "unknown" };
  }
  // Sin ningún dato, desconocido.
  if (!inputOk && !outputOk) {
    // Desconocido.
    return { kind: "unknown" };
  }
  // Tarifa explícita o la publicada de Haiku.
  const rates = prices ?? HAIKU_PRICES;
  // Importe en USD.
  const usd =
    ((inputOk ? input : 0) * rates.inputUsdPerMillion +
      (outputOk ? output : 0) * rates.outputUsdPerMillion) /
    1_000_000;
  // Consumo estimado con su procedencia.
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
        // Tokens de entrada.
        inputTokens?: number | null;
        // Tokens de salida.
        outputTokens?: number | null;
      }
    | null
    | undefined,
  pricing: CostPricing | null = HAIKU_PRICING,
): RunMetadata["cost"] {
  // Sin tarifa, coste desconocido.
  if (pricing === null) {
    // null.
    return null;
  }
  // Tokens de entrada.
  const input = usage?.inputTokens;
  // Tokens de salida.
  const output = usage?.outputTokens;
  // ¿Entrada válida?
  const inputOk = typeof input === "number" && Number.isFinite(input) && input >= 0;
  // ¿Salida válida?
  const outputOk = typeof output === "number" && Number.isFinite(output) && output >= 0;
  // Valor inválido: desconocido.
  if ((typeof input === "number" && !inputOk) || (typeof output === "number" && !outputOk)) {
    // null.
    return null;
  }
  // Sin datos: desconocido.
  if (!inputOk && !outputOk) {
    // null.
    return null;
  }
  // Coste con su moneda, origen y método.
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
