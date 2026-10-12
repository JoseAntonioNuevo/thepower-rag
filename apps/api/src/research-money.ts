// GUÍA DE LECTURA · apps/api/src/research-money.ts
// Dinero de la investigación en micro-USD enteros: tarifas congeladas por trabajo, reserva por llamada
// y tope de salida. Con enteros no hay errores de redondeo al comparar con el presupuesto.
// Límites de medios e investigación y tokens máximos de una imagen.
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
// Tope de salida: el mayor de todas las etapas.
const OUTPUT_TOKEN_CAP = Math.max(...Object.values(RESEARCH_LIMITS.maxOutputTokens));
/** 0,0118 USD por millón de tokens de embedding, 2.000 tokens, redondeo al alza. */
export const COURSE_EMBED_MICROS = 24;

// Campos comunes de todas las versiones.
interface PriceFields {
  // Presupuesto total.
  budgetMicros: number;
  // Tope por trabajo.
  jobLimitMicros: number;
  // Reserva por llamada al modelo.
  modelCallMicros: number;
  // Reserva por búsqueda.
  searchMicros: number;
  // Reserva por lectura.
  readMicros: number;
  // Reserva por consulta al curso.
  courseMicros: number;
  // Reserva total del trabajo de texto.
  holdMicros: number;
  // Buscador.
  searchProvider?: "firecrawl" | "tavily";
}

// Versión 1: solo texto.
export interface PriceSnapshotV1 extends PriceFields {
  // Versión.
  version: typeof RESEARCH_PRICE_VERSION_V1;
}

// Versión 2: con tarifas de medios.
export interface PriceSnapshotV2 extends PriceFields {
  // Versión.
  version: typeof RESEARCH_PRICE_VERSION_V2;
  // Reserva por visión.
  visionCallMicros: number;
  // Micro-USD por minuto de transcripción.
  sttMicrosPerMinute: number;
  // Micro-USD por carácter de voz.
  ttsMicrosPerChar: number;
  // Tope de voz.
  speechCapMicros: number;
}

// Versión 3: también fija el buscador.
export interface PriceSnapshotV3 extends PriceFields {
  // Versión.
  version: typeof RESEARCH_PRICE_VERSION;
  // Buscador.
  searchProvider: "firecrawl" | "tavily";
  // Visión.
  visionCallMicros: number;
  // Transcripción.
  sttMicrosPerMinute: number;
  // Voz.
  ttsMicrosPerChar: number;
  // Tope de voz.
  speechCapMicros: number;
}

// Cualquiera de las tres versiones.
export type PriceSnapshot = PriceSnapshotV1 | PriceSnapshotV2 | PriceSnapshotV3;

// ¿Tiene tarifas de medios? (v2 o v3).
function hasMediaRates(prices: PriceSnapshot): prices is PriceSnapshotV2 | PriceSnapshotV3 {
  // Comparación de versión.
  return prices.version === RESEARCH_PRICE_VERSION_V2 || prices.version === RESEARCH_PRICE_VERSION;
}

/** Las instantáneas anteriores a v3 se crearon con Firecrawl. */
export function searchProviderForSnapshot(prices: PriceSnapshot): "firecrawl" | "tavily" {
  // v3 guarda el buscador; las anteriores eran Firecrawl.
  return prices.version === RESEARCH_PRICE_VERSION ? prices.searchProvider : "firecrawl";
}

// Tarifas como texto, tal como llegan del entorno.
export interface PriceInput {
  // Presupuesto.
  budgetUsd: string;
  // Tope por trabajo.
  jobLimitUsd: string;
  // USD por millón de tokens de entrada.
  inputUsdPerMillion: string;
  // USD por millón de tokens de salida.
  outputUsdPerMillion: string;
  // Precio fijo de búsqueda.
  searchUsd?: string;
  // Precio fijo de lectura.
  readUsd?: string;
  // USD por crédito de Firecrawl.
  firecrawlUsdPerCredit?: string;
  // Buscador.
  searchProvider?: "firecrawl" | "tavily";
  // USD por crédito de Tavily.
  tavilyUsdPerCredit?: string;
}

/** Convierte un decimal no negativo de hasta 6 cifras a microdólares. */
export function decimalToMicros(value: string | undefined): number | null {
  // Sin valor.
  if (value === undefined) {
    // null.
    return null;
  }
  // Sin espacios.
  const trimmed = value.trim();
  // Solo dígitos con hasta 6 decimales.
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    // null.
    return null;
  }
  // Parte entera y decimal.
  const [whole, fraction = ""] = trimmed.split(".");
  // Entero en micro-USD.
  const micros = Number(whole) * 1_000_000 + Number((fraction + "000000").slice(0, 6));
  // Solo enteros seguros.
  return Number.isSafeInteger(micros) ? micros : null;
}

// División entera redondeando hacia arriba.
function ceilDiv(numerator: number, denominator: number): number {
  // Techo de la división.
  return Math.floor((numerator + denominator - 1) / denominator);
}

// Micro-USD de unos tokens, redondeando hacia arriba.
export function tokenMicros(tokens: number, microsPerMillion: number): number {
  // tokens × tarifa / 1.000.000.
  return ceilDiv(tokens * microsPerMillion, 1_000_000);
}

/** Tope de salida que cabe en la reserva por llamada. Un trabajo reanudado conserva su reserva aunque cambien los topes. */
export function modelOutputCap(
  prices: PriceSnapshot,
  inputUsdPerMillion: number,
  outputUsdPerMillion: number,
): number | null {
  // Tarifas inválidas: sin tope.
  if (
    !Number.isFinite(inputUsdPerMillion) ||
    !Number.isFinite(outputUsdPerMillion) ||
    inputUsdPerMillion <= 0 ||
    outputUsdPerMillion <= 0
  )
    return null;
  // Lo que queda de la reserva tras la entrada máxima.
  const remaining =
    prices.modelCallMicros - tokenMicros(INPUT_TOKEN_CAP, inputUsdPerMillion * 1_000_000);
  // Tokens de salida que caben.
  const tokens = Math.floor(remaining / outputUsdPerMillion);
  // Tope o null si no cabe ninguno.
  return tokens > 0 ? Math.min(tokens, OUTPUT_TOKEN_CAP) : null;
}

// Reserva de una transcripción por duración.
export function sttMicros(durationMs: number, microsPerMinute: number): number | null {
  // Duración o tarifa inválidas.
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || microsPerMinute <= 0) {
    // null.
    return null;
  }
  // Redondea hacia arriba por milisegundo.
  const amount = Math.ceil((durationMs * microsPerMinute) / 60_000);
  // Entero seguro y positivo.
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

// Reserva de voz por caracteres.
export function speechMicros(chars: number, microsPerChar: number): number | null {
  // Datos inválidos.
  if (!Number.isSafeInteger(chars) || chars <= 0 || microsPerChar <= 0) {
    // null.
    return null;
  }
  // Caracteres por tarifa.
  const amount = chars * microsPerChar;
  // Entero seguro y positivo.
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
  // Llamadas al modelo.
  if (kind === "plan" || kind === "assess" || kind === "follow-up" || kind === "synthesize") {
    // Reserva por llamada.
    return prices.modelCallMicros;
  }
  // Búsqueda.
  if (kind === "search") {
    // Reserva.
    return prices.searchMicros;
  }
  // Lectura.
  if (kind === "read") {
    // Reserva.
    return prices.readMicros;
  }
  // Curso.
  if (kind === "course") {
    // Reserva.
    return prices.courseMicros;
  }
  // v1 sin tarifas de medios.
  if (!hasMediaRates(prices)) {
    // Medios: se rechazan; otro tipo: 0.
    return kind === "vision" || kind === "transcribe" || kind === "speech" ? null : 0;
  }
  // Visión.
  if (kind === "vision") {
    // Reserva o null.
    return prices.visionCallMicros > 0 ? prices.visionCallMicros : null;
  }
  // Transcripción.
  if (kind === "transcribe") {
    // Por duración.
    return sttMicros(detail?.durationMs ?? 0, prices.sttMicrosPerMinute);
  }
  // Voz.
  if (kind === "speech") {
    // Por caracteres.
    return speechMicros(detail?.speechChars ?? 0, prices.ttsMicrosPerChar);
  }
  // Otro tipo: sin reserva.
  return 0;
}

/**
 * Instantánea de tarifas. El crédito de Firecrawl, si existe, manda sobre un
 * precio fijo de búsqueda: no se aplica la tarifa más barata.
 */
export function priceSnapshot(input: PriceInput): PriceSnapshot | null {
  // Presupuesto en micro-USD.
  const budgetMicros = decimalToMicros(input.budgetUsd);
  // Tope por trabajo.
  const jobLimitMicros = decimalToMicros(input.jobLimitUsd);
  // Tarifa de entrada.
  const inputRate = decimalToMicros(input.inputUsdPerMillion);
  // Tarifa de salida.
  const outputRate = decimalToMicros(input.outputUsdPerMillion);
  // Buscador.
  const searchProvider = input.searchProvider ?? "firecrawl";
  // Precio por crédito del buscador.
  const credit = decimalToMicros(
    searchProvider === "tavily" ? input.tavilyUsdPerCredit : input.firecrawlUsdPerCredit,
  );
  // Créditos por operación: Tavily 1, Firecrawl 2.
  const creditCount = searchProvider === "tavily" ? 1 : 2;
  // Búsqueda: créditos o precio fijo.
  const searchMicros =
    credit !== null && credit > 0 ? credit * creditCount : decimalToMicros(input.searchUsd);
  // Lectura: créditos o precio fijo.
  const readMicros =
    credit !== null && credit > 0 ? credit * creditCount : decimalToMicros(input.readUsd);
  // Algún valor ausente o no positivo.
  if (
    // Presupuesto y tope por trabajo.
    budgetMicros === null ||
    budgetMicros <= 0 ||
    jobLimitMicros === null ||
    jobLimitMicros <= 0 ||
    // Tarifas del modelo.
    inputRate === null ||
    inputRate <= 0 ||
    outputRate === null ||
    outputRate <= 0 ||
    // Precio de búsqueda y de lectura.
    searchMicros === null ||
    searchMicros <= 0 ||
    readMicros === null ||
    readMicros <= 0
  ) {
    // null.
    return null;
  }
  // Reserva por llamada: entrada y salida máximas.
  const modelCallMicros =
    tokenMicros(INPUT_TOKEN_CAP, inputRate) + tokenMicros(OUTPUT_TOKEN_CAP, outputRate);
  // Tarifa de transcripción.
  const sttRate = decimalToMicros(MEDIA_LIMITS.sttUsdPerMinute);
  // Tarifa de voz por mil caracteres.
  const ttsRate = decimalToMicros(MEDIA_LIMITS.ttsUsdPerThousandChars);
  // Reserva de visión.
  const visionCallMicros =
    tokenMicros(maxVisionInputTokens(), inputRate) +
    tokenMicros(MEDIA_LIMITS.visionOutputTokens, outputRate);
  // Tarifa por carácter.
  const ttsMicrosPerChar = ttsRate === null ? null : Math.ceil(ttsRate / 1_000);
  // Tope de voz.
  const speechCap =
    ttsMicrosPerChar === null ? null : ttsMicrosPerChar * MEDIA_LIMITS.maxSpeechChars;
  // Reserva del trabajo de texto en el peor caso.
  const textHold =
    RESEARCH_LIMITS.maxModelCalls * modelCallMicros +
    RESEARCH_LIMITS.maxSearchCalls * searchMicros +
    RESEARCH_LIMITS.maxPagesRead * readMicros +
    RESEARCH_LIMITS.maxCourseQueries * COURSE_EMBED_MICROS;
  // Faltan tarifas o la reserva supera el tope.
  if (
    sttRate === null ||
    ttsMicrosPerChar === null ||
    speechCap === null ||
    visionCallMicros <= 0 ||
    textHold > jobLimitMicros ||
    textHold > budgetMicros
  ) {
    // null.
    return null;
  }
  // Instantánea v3.
  return {
    // Versión y buscador elegido.
    version: RESEARCH_PRICE_VERSION,
    searchProvider,
    // Presupuesto, tope y precio de cada tipo de llamada.
    budgetMicros,
    jobLimitMicros,
    modelCallMicros,
    searchMicros,
    readMicros,
    // Embedding del curso y reserva inicial del texto.
    courseMicros: COURSE_EMBED_MICROS,
    holdMicros: textHold,
    // Precios de visión, transcripción, voz y tope de la voz.
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
  // Sin medios: la reserva de texto.
  if (!media.image && media.audioDurationMs === null && !media.voice) {
    // Reserva.
    return prices.holdMicros;
  }
  // Medios sin tarifas: no se admite.
  if (!hasMediaRates(prices)) {
    // null.
    return null;
  }
  // Reserva base.
  let hold = prices.holdMicros;
  // Con imagen.
  if (media.image) {
    // Suma visión.
    hold += prices.visionCallMicros;
  }
  // Con audio.
  if (media.audioDurationMs !== null) {
    // Reserva de transcripción.
    const audio = sttMicros(media.audioDurationMs, prices.sttMicrosPerMinute);
    // Duración inválida.
    if (audio === null) {
      // null.
      return null;
    }
    // Suma.
    hold += audio;
  }
  // Con voz.
  if (media.voice) {
    // Suma el tope de voz.
    hold += prices.speechCapMicros;
  }
  // Supera los topes.
  if (hold > prices.jobLimitMicros || hold > prices.budgetMicros || !Number.isSafeInteger(hold)) {
    // null.
    return null;
  }
  // Reserva total.
  return hold;
}

// ¿Importes enteros seguros?
function moneyOk(parsed: {
  // Presupuesto.
  budgetMicros?: number;
  // Tope por trabajo.
  jobLimitMicros?: number;
  // Por llamada.
  modelCallMicros?: number;
  // Búsqueda.
  searchMicros?: number;
  // Lectura.
  readMicros?: number;
  // Curso.
  courseMicros?: number;
  // Reserva.
  holdMicros?: number;
}): boolean {
  // Todos enteros seguros.
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

// Lee una instantánea guardada como JSON sin recalcularla.
export function parsePriceSnapshot(value: string): PriceSnapshot | null {
  // JSON inválido: null.
  try {
    // Campos posibles.
    const parsed = JSON.parse(value) as {
      // Versión.
      version?: string;
      // Presupuesto.
      budgetMicros?: number;
      // Tope por trabajo.
      jobLimitMicros?: number;
      // Por llamada.
      modelCallMicros?: number;
      // Búsqueda.
      searchMicros?: number;
      // Lectura.
      readMicros?: number;
      // Curso.
      courseMicros?: number;
      // Reserva.
      holdMicros?: number;
      // Visión.
      visionCallMicros?: number;
      // Transcripción.
      sttMicrosPerMinute?: number;
      // Voz.
      ttsMicrosPerChar?: number;
      // Tope de voz.
      speechCapMicros?: number;
      // Buscador.
      searchProvider?: string;
    };
    // Faltan importes.
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
      // null.
      return null;
    }
    // Importes comunes.
    const base = {
      budgetMicros: parsed.budgetMicros,
      jobLimitMicros: parsed.jobLimitMicros,
      modelCallMicros: parsed.modelCallMicros,
      searchMicros: parsed.searchMicros,
      readMicros: parsed.readMicros,
      courseMicros: parsed.courseMicros,
      holdMicros: parsed.holdMicros,
    };
    // v1.
    if (parsed.version === RESEARCH_PRICE_VERSION_V1) {
      // Instantánea v1.
      return { version: RESEARCH_PRICE_VERSION_V1, ...base };
    }
    // Visión.
    const visionCallMicros = parsed.visionCallMicros ?? 0;
    // Transcripción.
    const sttMicrosPerMinute = parsed.sttMicrosPerMinute ?? 0;
    // Voz.
    const ttsMicrosPerChar = parsed.ttsMicrosPerChar ?? 0;
    // Tope de voz.
    const speechCapMicros = parsed.speechCapMicros ?? 0;
    // Tarifas de medios inválidas.
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
      // null.
      return null;
    }
    // Tarifas de medios.
    const media = { visionCallMicros, sttMicrosPerMinute, ttsMicrosPerChar, speechCapMicros };
    // v2.
    if (parsed.version === RESEARCH_PRICE_VERSION_V2) {
      // Instantánea v2.
      return { version: RESEARCH_PRICE_VERSION_V2, ...base, ...media };
    }
    // v3 con buscador conocido.
    if (
      parsed.version === RESEARCH_PRICE_VERSION &&
      (parsed.searchProvider === "firecrawl" || parsed.searchProvider === "tavily")
    ) {
      // Instantánea v3.
      return {
        version: RESEARCH_PRICE_VERSION,
        ...base,
        ...media,
        searchProvider: parsed.searchProvider,
      };
    }
    // Versión desconocida.
    return null;
  } catch {
    // JSON inválido.
    return null;
  }
}

/** Micros a texto fijo. No usa el flotante como autoridad de admisión. */
export function formatMicros(micros: number): string {
  // Signo.
  const sign = micros < 0 ? "-" : "";
  // Valor absoluto.
  const absolute = Math.abs(micros);
  // Parte entera.
  const whole = Math.floor(absolute / 1_000_000);
  // Seis decimales.
  const fraction = String(absolute % 1_000_000).padStart(6, "0");
  // Texto con USD.
  return `${sign}${String(whole)}.${fraction} USD`;
}
