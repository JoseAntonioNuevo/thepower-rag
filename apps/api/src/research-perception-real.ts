// GUÍA DE LECTURA · apps/api/src/research-perception-real.ts
// Percepción real de S12: lectura de imagen con el modelo de visión del proveedor elegido, y
// transcripción (Whisper) y voz (Aura) con Workers AI. Una llamada cada una, sin reintentos.
// Límites de medios.
import { MEDIA_LIMITS } from "@thepower-rag/contracts";
// Tipo del resultado de un puerto.
import type { PortResult } from "@thepower-rag/research";
// Generación de texto del AI SDK y tipo de modelo.
import { generateText, type LanguageModel } from "ai";
// Tipo de las tarifas.
import type { TokenPrices } from "./env";
// Consumo estimado a partir de los tokens.
import { tokenEstimateConsumption } from "./provider-cost";
// Instrucciones de visión y adaptadores de Whisper y Aura.
import {
  VISION_SYSTEM,
  auraInput,
  bytesFromAiOutput,
  parseWhisper,
  visionUserPrompt,
  whisperInput,
  type ImageRead,
  type TranscriptRead,
  type WorkersAi,
} from "./research-perception";

// Consumo estimado de la llamada de visión.
function observedTokens(
  usage: { inputTokens?: number | null; outputTokens?: number | null } | undefined,
  prices?: TokenPrices,
) {
  // Tokens por tarifa (la de la investigación si se indica).
  return tokenEstimateConsumption(usage, prices);
}

/**
 * Una llamada, sin reintentos del SDK. Un fallo después de salir la petición
 * deja el consumo desconocido: abortar en local no demuestra que no hubiera cargo.
 */
export async function visionImage(
  model: LanguageModel,
  bytes: Uint8Array,
  mime: "image/png" | "image/jpeg",
  signal: AbortSignal,
  prices?: TokenPrices,
): Promise<PortResult<ImageRead>> {
  // Un fallo del proveedor se devuelve como resultado, no como excepción.
  try {
    // Una llamada con la imagen como parte de archivo.
    const result = await generateText({
      model,
      system: VISION_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: visionUserPrompt() },
            { type: "file", mediaType: mime, data: bytes },
          ],
        },
      ],
      maxOutputTokens: MEDIA_LIMITS.visionOutputTokens,
      maxRetries: 0,
      abortSignal: signal,
    });
    // Lee el JSON pedido del texto.
    const parsed = parseVisionJson(result.text);
    // Sin JSON válido.
    if (parsed === null) {
      // Resultado inválido con su consumo.
      return {
        ok: false,
        error: "invalid",
        detail: "La visión no devolvió el JSON pedido.",
        consumption: observedTokens(result.usage, prices),
      };
    }
    // Lectura correcta.
    return { ok: true, value: parsed, consumption: observedTokens(result.usage, prices) };
  } catch {
    // Fallo o cancelación: consumo desconocido.
    return {
      ok: false,
      error: signal.aborted ? "aborted" : "provider",
      detail: signal.aborted ? "La visión se canceló." : "La visión no completó la llamada.",
      consumption: { kind: "unknown" },
    };
  }
}

// Extrae y valida el JSON de la respuesta de visión.
export function parseVisionJson(text: string): ImageRead | null {
  // Primera llave.
  const start = text.indexOf("{");
  // Última llave.
  const end = text.lastIndexOf("}");
  // Sin objeto JSON.
  if (start < 0 || end <= start) return null;
  // JSON mal formado devuelve null.
  try {
    // Analiza el objeto.
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      // Texto leído en la imagen.
      observedText?: unknown;
      // Notas.
      notes?: unknown;
      // Si el modelo no está seguro.
      uncertain?: unknown;
    };
    // El texto leído es obligatorio.
    if (typeof parsed.observedText !== "string") return null;
    // Lectura recortada a los límites.
    return {
      observedText: parsed.observedText.trim().slice(0, MEDIA_LIMITS.maxObservedChars),
      notes: typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 500) : "",
      uncertain: parsed.uncertain === true,
    };
  } catch {
    // JSON inválido.
    return null;
  }
}

// Transcribe un audio con Whisper de Workers AI.
export async function workersTranscript(
  ai: WorkersAi,
  modelId: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<PortResult<TranscriptRead>> {
  // Cancelado antes de llamar.
  if (signal.aborted) {
    // Resultado cancelado.
    return {
      ok: false,
      error: "aborted",
      detail:
        "La transcripción se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo.",
      consumption: { kind: "unknown" },
    };
  }
  // Un fallo se devuelve como resultado.
  try {
    // Llamada a Workers AI.
    const raw = await ai.run(modelId, whisperInput(bytes));
    // Cancelado mientras esperaba.
    if (signal.aborted) {
      // No se publica.
      return {
        ok: false,
        error: "aborted",
        detail:
          "La transcripción llegó después de cancelar la espera. No se publica y el cargo queda desconocido.",
        consumption: { kind: "unknown" },
      };
    }
    // Texto de la transcripción.
    const parsed = parseWhisper(raw);
    // Sin texto.
    if (parsed === null) {
      // Resultado inválido.
      return {
        ok: false,
        error: "invalid",
        detail: "La transcripción no trajo texto.",
        consumption: { kind: "reported", usd: null, credits: null },
      };
    }
    // Transcripción correcta (el binding no informa el importe).
    return {
      ok: true,
      value: parsed,
      consumption: { kind: "reported", usd: null, credits: null },
    };
  } catch {
    // Fallo o cancelación.
    return {
      ok: false,
      error: signal.aborted ? "aborted" : "provider",
      detail: signal.aborted
        ? "La transcripción se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo."
        : "La transcripción no completó la llamada. El binding no expone reintentos y esta capa no los añade.",
      consumption: { kind: "unknown" },
    };
  }
}

// Genera voz con Aura de Workers AI.
export async function workersSpeech(
  ai: WorkersAi,
  modelId: string,
  text: string,
  signal: AbortSignal,
): Promise<PortResult<Uint8Array>> {
  // Cancelado antes de llamar.
  if (signal.aborted) {
    // Resultado cancelado.
    return {
      ok: false,
      error: "aborted",
      detail:
        "La voz se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo.",
      consumption: { kind: "unknown" },
    };
  }
  // Un fallo se devuelve como resultado.
  try {
    // Llamada a Workers AI.
    const raw = await ai.run(modelId, auraInput(text));
    // Cancelado mientras esperaba.
    if (signal.aborted) {
      // No se publica.
      return {
        ok: false,
        error: "aborted",
        detail:
          "La voz llegó después de cancelar la espera. No se publica y el cargo queda desconocido.",
        consumption: { kind: "unknown" },
      };
    }
    // Bytes del audio devuelto.
    const bytes = await bytesFromAiOutput(raw, signal);
    // Cancelado durante la lectura.
    if (signal.aborted) {
      // No se publica.
      return {
        ok: false,
        error: "aborted",
        detail:
          "La lectura del audio se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo.",
        consumption: { kind: "unknown" },
      };
    }
    // Audio vacío o demasiado grande.
    if (bytes === null || bytes.byteLength < 32 || bytes.byteLength > MEDIA_LIMITS.maxAudioBytes) {
      // Resultado inválido.
      return {
        ok: false,
        error: "invalid",
        detail: "La voz no devolvió audio dentro del límite.",
        consumption: { kind: "reported", usd: null, credits: null },
      };
    }
    // Audio correcto.
    return {
      ok: true,
      value: bytes,
      consumption: { kind: "reported", usd: null, credits: null },
    };
  } catch {
    // Fallo o cancelación.
    return {
      ok: false,
      error: signal.aborted ? "aborted" : "provider",
      detail: signal.aborted
        ? "La voz se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo."
        : "La síntesis de voz no completó la llamada. No hay reintento en esta capa.",
      consumption: { kind: "unknown" },
    };
  }
}
