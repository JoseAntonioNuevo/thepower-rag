import { RESEARCH_LIMITS } from "@thepower-rag/contracts";

/** Versión de precios copiada en cada trabajo. No se recalcula al reanudar. */
export const RESEARCH_PRICE_VERSION = "research-prices-v1";

/** El trabajo tiene que empezar dentro de este plazo de cola. No alarga el plazo total. */
export const RESEARCH_QUEUE_MS = 60_000;

/** Tope de entrada por llamada: memoria, prompt, evidencia y salida estructurada. */
const INPUT_TOKEN_CAP = 8_000;
const OUTPUT_TOKEN_CAP = 1_800;
/** 0,0118 USD por millón de tokens de embedding, 2.000 tokens, redondeo al alza. */
export const COURSE_EMBED_MICROS = 24;

export interface PriceSnapshot {
  version: typeof RESEARCH_PRICE_VERSION;
  budgetMicros: number;
  jobLimitMicros: number;
  modelCallMicros: number;
  searchMicros: number;
  readMicros: number;
  courseMicros: number;
  holdMicros: number;
}

export interface PriceInput {
  budgetUsd: string;
  jobLimitUsd: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  searchUsd?: string;
  readUsd?: string;
  firecrawlUsdPerCredit?: string;
}

/** Convierte un decimal no negativo de hasta 6 cifras a microdólares. */
export function decimalToMicros(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const micros = Number(whole) * 1_000_000 + Number((fraction + "000000").slice(0, 6));
  return Number.isSafeInteger(micros) ? micros : null;
}

function ceilDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}

export function tokenMicros(tokens: number, microsPerMillion: number): number {
  return ceilDiv(tokens * microsPerMillion, 1_000_000);
}

export function reservationFor(kind: string, prices: PriceSnapshot): number {
  if (kind === "plan" || kind === "assess" || kind === "follow-up" || kind === "synthesize") {
    return prices.modelCallMicros;
  }
  if (kind === "search") {
    return prices.searchMicros;
  }
  if (kind === "read") {
    return prices.readMicros;
  }
  if (kind === "course") {
    return prices.courseMicros;
  }
  return 0;
}

/**
 * Instantánea de tarifas. El crédito de Firecrawl, si existe, manda sobre un
 * precio fijo de búsqueda: no se aplica la tarifa más barata.
 */
export function priceSnapshot(input: PriceInput): PriceSnapshot | null {
  const budgetMicros = decimalToMicros(input.budgetUsd);
  const jobLimitMicros = decimalToMicros(input.jobLimitUsd);
  const inputRate = decimalToMicros(input.inputUsdPerMillion);
  const outputRate = decimalToMicros(input.outputUsdPerMillion);
  const credit = decimalToMicros(input.firecrawlUsdPerCredit);
  const searchMicros =
    credit !== null && credit > 0 ? credit * 2 : decimalToMicros(input.searchUsd);
  const readMicros = credit !== null && credit > 0 ? credit * 2 : decimalToMicros(input.readUsd);
  if (
    budgetMicros === null ||
    budgetMicros <= 0 ||
    jobLimitMicros === null ||
    jobLimitMicros <= 0 ||
    inputRate === null ||
    inputRate <= 0 ||
    outputRate === null ||
    outputRate <= 0 ||
    searchMicros === null ||
    searchMicros <= 0 ||
    readMicros === null ||
    readMicros <= 0
  ) {
    return null;
  }
  const modelCallMicros =
    tokenMicros(INPUT_TOKEN_CAP, inputRate) + tokenMicros(OUTPUT_TOKEN_CAP, outputRate);
  const holdMicros =
    RESEARCH_LIMITS.maxModelCalls * modelCallMicros +
    RESEARCH_LIMITS.maxSearchCalls * searchMicros +
    RESEARCH_LIMITS.maxPagesRead * readMicros +
    RESEARCH_LIMITS.maxCourseQueries * COURSE_EMBED_MICROS;
  if (holdMicros > jobLimitMicros || holdMicros > budgetMicros) {
    return null;
  }
  return {
    version: RESEARCH_PRICE_VERSION,
    budgetMicros,
    jobLimitMicros,
    modelCallMicros,
    searchMicros,
    readMicros,
    courseMicros: COURSE_EMBED_MICROS,
    holdMicros,
  };
}

export function parsePriceSnapshot(value: string): PriceSnapshot | null {
  try {
    const parsed = JSON.parse(value) as Partial<PriceSnapshot>;
    if (parsed.version !== RESEARCH_PRICE_VERSION || parsed.holdMicros === undefined) {
      return null;
    }
    if (
      !Number.isSafeInteger(parsed.holdMicros) ||
      !Number.isSafeInteger(parsed.modelCallMicros) ||
      !Number.isSafeInteger(parsed.searchMicros) ||
      !Number.isSafeInteger(parsed.readMicros) ||
      !Number.isSafeInteger(parsed.courseMicros)
    ) {
      return null;
    }
    return parsed as PriceSnapshot;
  } catch {
    return null;
  }
}

/** Micros a texto fijo. No usa el flotante como autoridad de admisión. */
export function formatMicros(micros: number): string {
  const sign = micros < 0 ? "-" : "";
  const absolute = Math.abs(micros);
  const whole = Math.floor(absolute / 1_000_000);
  const fraction = String(absolute % 1_000_000).padStart(6, "0");
  return `${sign}${String(whole)}.${fraction} USD`;
}
