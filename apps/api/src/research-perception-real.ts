import { MEDIA_LIMITS } from "@thepower-rag/contracts";
import type { PortResult } from "@thepower-rag/research";
import { generateText, type LanguageModel } from "ai";
import type { TokenPrices } from "./env";
import { tokenEstimateConsumption } from "./provider-cost";
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

function observedTokens(
  usage: { inputTokens?: number | null; outputTokens?: number | null } | undefined,
  prices?: TokenPrices,
) {
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
  try {
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
    const parsed = parseVisionJson(result.text);
    if (parsed === null) {
      return {
        ok: false,
        error: "invalid",
        detail: "La visión no devolvió el JSON pedido.",
        consumption: observedTokens(result.usage, prices),
      };
    }
    return { ok: true, value: parsed, consumption: observedTokens(result.usage, prices) };
  } catch {
    return {
      ok: false,
      error: signal.aborted ? "aborted" : "provider",
      detail: signal.aborted ? "La visión se canceló." : "La visión no completó la llamada.",
      consumption: { kind: "unknown" },
    };
  }
}

export function parseVisionJson(text: string): ImageRead | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      observedText?: unknown;
      notes?: unknown;
      uncertain?: unknown;
    };
    if (typeof parsed.observedText !== "string") return null;
    return {
      observedText: parsed.observedText.trim().slice(0, MEDIA_LIMITS.maxObservedChars),
      notes: typeof parsed.notes === "string" ? parsed.notes.trim().slice(0, 500) : "",
      uncertain: parsed.uncertain === true,
    };
  } catch {
    return null;
  }
}

export async function workersTranscript(
  ai: WorkersAi,
  modelId: string,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<PortResult<TranscriptRead>> {
  if (signal.aborted) {
    return {
      ok: false,
      error: "aborted",
      detail:
        "La transcripción se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo.",
      consumption: { kind: "unknown" },
    };
  }
  try {
    const raw = await ai.run(modelId, whisperInput(bytes));
    if (signal.aborted) {
      return {
        ok: false,
        error: "aborted",
        detail:
          "La transcripción llegó después de cancelar la espera. No se publica y el cargo queda desconocido.",
        consumption: { kind: "unknown" },
      };
    }
    const parsed = parseWhisper(raw);
    if (parsed === null) {
      return {
        ok: false,
        error: "invalid",
        detail: "La transcripción no trajo texto.",
        consumption: { kind: "reported", usd: null, credits: null },
      };
    }
    return {
      ok: true,
      value: parsed,
      consumption: { kind: "reported", usd: null, credits: null },
    };
  } catch {
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

export async function workersSpeech(
  ai: WorkersAi,
  modelId: string,
  text: string,
  signal: AbortSignal,
): Promise<PortResult<Uint8Array>> {
  if (signal.aborted) {
    return {
      ok: false,
      error: "aborted",
      detail:
        "La voz se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo.",
      consumption: { kind: "unknown" },
    };
  }
  try {
    const raw = await ai.run(modelId, auraInput(text));
    if (signal.aborted) {
      return {
        ok: false,
        error: "aborted",
        detail:
          "La voz llegó después de cancelar la espera. No se publica y el cargo queda desconocido.",
        consumption: { kind: "unknown" },
      };
    }
    const bytes = await bytesFromAiOutput(raw, signal);
    if (signal.aborted) {
      return {
        ok: false,
        error: "aborted",
        detail:
          "La lectura del audio se detuvo en local. Eso no demuestra que el proveedor haya cancelado el cargo.",
        consumption: { kind: "unknown" },
      };
    }
    if (bytes === null || bytes.byteLength < 32 || bytes.byteLength > MEDIA_LIMITS.maxAudioBytes) {
      return {
        ok: false,
        error: "invalid",
        detail: "La voz no devolvió audio dentro del límite.",
        consumption: { kind: "reported", usd: null, credits: null },
      };
    }
    return {
      ok: true,
      value: bytes,
      consumption: { kind: "reported", usd: null, credits: null },
    };
  } catch {
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
