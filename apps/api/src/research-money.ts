import { MEDIA_LIMITS, RESEARCH_LIMITS, maxVisionInputTokens } from "@thepower-rag/contracts";

/** Instantánea de la fase 2. Se lee y no se recalcula. */
export const RESEARCH_PRICE_VERSION_V1 = "research-prices-v1";
/** Instantánea multimodal anterior, que usaba Firecrawl como buscador. */
export const RESEARCH_PRICE_VERSION_V2 = "research-prices-v2";
/** Instantánea multimodal que fija también el proveedor de búsqueda. */
export const RESEARCH_PRICE_VERSION = "research-prices-v3";

/** El trabajo tiene que empezar dentro de este plazo de cola. No alarga el plazo total. */
export const RESEARCH_QUEUE_MS = 60_000;

/** Tope de entrada por llamada: memoria, prompt, evidencia y salida estructurada. */
const INPUT_TOKEN_CAP = 8_000;
const OUTPUT_TOKEN_CAP = 1_800;
/** 0,0118 USD por millón de tokens de embedding, 2.000 tokens, redondeo al alza. */
export const COURSE_EMBED_MICROS = 24;

interface PriceFields {
  budgetMicros: number;
  jobLimitMicros: number;
  modelCallMicros: number;
  searchMicros: number;
  readMicros: number;
  courseMicros: number;
  holdMicros: number;
  searchProvider?: "firecrawl" | "tavily";
}

export interface PriceSnapshotV1 extends PriceFields {
  version: typeof RESEARCH_PRICE_VERSION_V1;
}

export interface PriceSnapshotV2 extends PriceFields {
  version: typeof RESEARCH_PRICE_VERSION_V2;
  visionCallMicros: number;
  sttMicrosPerMinute: number;
  ttsMicrosPerChar: number;
  speechCapMicros: number;
}

export interface PriceSnapshotV3 extends PriceFields {
  version: typeof RESEARCH_PRICE_VERSION;
  searchProvider: "firecrawl" | "tavily";
  visionCallMicros: number;
  sttMicrosPerMinute: number;
  ttsMicrosPerChar: number;
  speechCapMicros: number;
}

export type PriceSnapshot = PriceSnapshotV1 | PriceSnapshotV2 | PriceSnapshotV3;

function hasMediaRates(prices: PriceSnapshot): prices is PriceSnapshotV2 | PriceSnapshotV3 {
  return prices.version === RESEARCH_PRICE_VERSION_V2 || prices.version === RESEARCH_PRICE_VERSION;
}

/** Las instantáneas anteriores a v3 se crearon con Firecrawl. */
export function searchProviderForSnapshot(prices: PriceSnapshot): "firecrawl" | "tavily" {
  return prices.version === RESEARCH_PRICE_VERSION ? prices.searchProvider : "firecrawl";
}

export interface PriceInput {
  budgetUsd: string;
  jobLimitUsd: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  searchUsd?: string;
  readUsd?: string;
  firecrawlUsdPerCredit?: string;
  searchProvider?: "firecrawl" | "tavily";
  tavilyUsdPerCredit?: string;
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

export function sttMicros(durationMs: number, microsPerMinute: number): number | null {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || microsPerMinute <= 0) {
    return null;
  }
  const amount = Math.ceil((durationMs * microsPerMinute) / 60_000);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

export function speechMicros(chars: number, microsPerChar: number): number | null {
  if (!Number.isSafeInteger(chars) || chars <= 0 || microsPerChar <= 0) {
    return null;
  }
  const amount = chars * microsPerChar;
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/**
 * La visión, la transcripción y la voz no caen en cero. Una instantánea v1
 * no tiene esas tarifas: la operación se rechaza en vez de reservar nada.
 */
export function reservationFor(
  kind: string,
  prices: PriceSnapshot,
  detail?: { durationMs?: number; speechChars?: number },
): number | null {
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
  if (!hasMediaRates(prices)) {
    return kind === "vision" || kind === "transcribe" || kind === "speech" ? null : 0;
  }
  if (kind === "vision") {
    return prices.visionCallMicros > 0 ? prices.visionCallMicros : null;
  }
  if (kind === "transcribe") {
    return sttMicros(detail?.durationMs ?? 0, prices.sttMicrosPerMinute);
  }
  if (kind === "speech") {
    return speechMicros(detail?.speechChars ?? 0, prices.ttsMicrosPerChar);
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
  const searchProvider = input.searchProvider ?? "firecrawl";
  const credit = decimalToMicros(
    searchProvider === "tavily" ? input.tavilyUsdPerCredit : input.firecrawlUsdPerCredit,
  );
  const creditCount = searchProvider === "tavily" ? 1 : 2;
  const searchMicros =
    credit !== null && credit > 0 ? credit * creditCount : decimalToMicros(input.searchUsd);
  const readMicros =
    credit !== null && credit > 0 ? credit * creditCount : decimalToMicros(input.readUsd);
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
  const sttRate = decimalToMicros(MEDIA_LIMITS.sttUsdPerMinute);
  const ttsRate = decimalToMicros(MEDIA_LIMITS.ttsUsdPerThousandChars);
  const visionCallMicros =
    tokenMicros(maxVisionInputTokens(), inputRate) +
    tokenMicros(MEDIA_LIMITS.visionOutputTokens, outputRate);
  const ttsMicrosPerChar = ttsRate === null ? null : Math.ceil(ttsRate / 1_000);
  const speechCap =
    ttsMicrosPerChar === null ? null : ttsMicrosPerChar * MEDIA_LIMITS.maxSpeechChars;
  const textHold =
    RESEARCH_LIMITS.maxModelCalls * modelCallMicros +
    RESEARCH_LIMITS.maxSearchCalls * searchMicros +
    RESEARCH_LIMITS.maxPagesRead * readMicros +
    RESEARCH_LIMITS.maxCourseQueries * COURSE_EMBED_MICROS;
  if (
    sttRate === null ||
    ttsMicrosPerChar === null ||
    speechCap === null ||
    visionCallMicros <= 0 ||
    textHold > jobLimitMicros ||
    textHold > budgetMicros
  ) {
    return null;
  }
  return {
    version: RESEARCH_PRICE_VERSION,
    searchProvider,
    budgetMicros,
    jobLimitMicros,
    modelCallMicros,
    searchMicros,
    readMicros,
    courseMicros: COURSE_EMBED_MICROS,
    holdMicros: textHold,
    visionCallMicros,
    sttMicrosPerMinute: sttRate,
    ttsMicrosPerChar,
    speechCapMicros: speechCap,
  };
}

/** Suma el peor caso de los medios admitidos. No recalcula una instantánea ya guardada. */
export function holdForJob(
  prices: PriceSnapshot,
  media: { image: boolean; audioDurationMs: number | null; voice: boolean },
): number | null {
  if (!media.image && media.audioDurationMs === null && !media.voice) {
    return prices.holdMicros;
  }
  if (!hasMediaRates(prices)) {
    return null;
  }
  let hold = prices.holdMicros;
  if (media.image) {
    hold += prices.visionCallMicros;
  }
  if (media.audioDurationMs !== null) {
    const audio = sttMicros(media.audioDurationMs, prices.sttMicrosPerMinute);
    if (audio === null) {
      return null;
    }
    hold += audio;
  }
  if (media.voice) {
    hold += prices.speechCapMicros;
  }
  if (hold > prices.jobLimitMicros || hold > prices.budgetMicros || !Number.isSafeInteger(hold)) {
    return null;
  }
  return hold;
}

function moneyOk(parsed: {
  budgetMicros?: number;
  jobLimitMicros?: number;
  modelCallMicros?: number;
  searchMicros?: number;
  readMicros?: number;
  courseMicros?: number;
  holdMicros?: number;
}): boolean {
  return (
    Number.isSafeInteger(parsed.holdMicros) &&
    Number.isSafeInteger(parsed.budgetMicros) &&
    Number.isSafeInteger(parsed.jobLimitMicros) &&
    Number.isSafeInteger(parsed.modelCallMicros) &&
    Number.isSafeInteger(parsed.searchMicros) &&
    Number.isSafeInteger(parsed.readMicros) &&
    Number.isSafeInteger(parsed.courseMicros)
  );
}

export function parsePriceSnapshot(value: string): PriceSnapshot | null {
  try {
    const parsed = JSON.parse(value) as {
      version?: string;
      budgetMicros?: number;
      jobLimitMicros?: number;
      modelCallMicros?: number;
      searchMicros?: number;
      readMicros?: number;
      courseMicros?: number;
      holdMicros?: number;
      visionCallMicros?: number;
      sttMicrosPerMinute?: number;
      ttsMicrosPerChar?: number;
      speechCapMicros?: number;
      searchProvider?: string;
    };
    if (
      !moneyOk(parsed) ||
      parsed.budgetMicros === undefined ||
      parsed.jobLimitMicros === undefined ||
      parsed.modelCallMicros === undefined ||
      parsed.searchMicros === undefined ||
      parsed.readMicros === undefined ||
      parsed.courseMicros === undefined ||
      parsed.holdMicros === undefined
    ) {
      return null;
    }
    const base = {
      budgetMicros: parsed.budgetMicros,
      jobLimitMicros: parsed.jobLimitMicros,
      modelCallMicros: parsed.modelCallMicros,
      searchMicros: parsed.searchMicros,
      readMicros: parsed.readMicros,
      courseMicros: parsed.courseMicros,
      holdMicros: parsed.holdMicros,
    };
    if (parsed.version === RESEARCH_PRICE_VERSION_V1) {
      return { version: RESEARCH_PRICE_VERSION_V1, ...base };
    }
    const visionCallMicros = parsed.visionCallMicros ?? 0;
    const sttMicrosPerMinute = parsed.sttMicrosPerMinute ?? 0;
    const ttsMicrosPerChar = parsed.ttsMicrosPerChar ?? 0;
    const speechCapMicros = parsed.speechCapMicros ?? 0;
    if (
      !Number.isSafeInteger(visionCallMicros) ||
      visionCallMicros <= 0 ||
      !Number.isSafeInteger(sttMicrosPerMinute) ||
      sttMicrosPerMinute <= 0 ||
      !Number.isSafeInteger(ttsMicrosPerChar) ||
      ttsMicrosPerChar <= 0 ||
      !Number.isSafeInteger(speechCapMicros) ||
      speechCapMicros <= 0
    ) {
      return null;
    }
    const media = { visionCallMicros, sttMicrosPerMinute, ttsMicrosPerChar, speechCapMicros };
    if (parsed.version === RESEARCH_PRICE_VERSION_V2) {
      return { version: RESEARCH_PRICE_VERSION_V2, ...base, ...media };
    }
    if (
      parsed.version === RESEARCH_PRICE_VERSION &&
      (parsed.searchProvider === "firecrawl" || parsed.searchProvider === "tavily")
    ) {
      return {
        version: RESEARCH_PRICE_VERSION,
        ...base,
        ...media,
        searchProvider: parsed.searchProvider,
      };
    }
    return null;
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
