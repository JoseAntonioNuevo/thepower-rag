/**
 * Límites de la fase 3. La imagen sigue el cálculo de parches de Claude
 * (ceil(ancho/28) × ceil(alto/28)) y el borde largo de 1.600 px queda por
 * debajo del máximo de 2.576 px / 4.784 tokens visuales de Haiku 5.5.
 * El audio de entrada es PCM WAV 16 kHz mono 16 bit, el formato estrecho que
 * Whisper acepta sin conversión. La voz de salida se reserva por caracteres,
 * que es la unidad publicada de Aura-2.
 */
export const MEDIA_LIMITS = {
  maxImageBytes: 1_500_000,
  maxAudioBytes: 1_048_576,
  maxImageEdge: 1_600,
  minImageEdge: 8,
  audioSampleRate: 16_000,
  audioChannels: 1,
  audioBitDepth: 16,
  maxAudioMs: 30_000,
  minAudioMs: 200,
  maxSpeechChars: 600,
  maxSpeechSentences: 3,
  maxObservedChars: 1_000,
  maxTranscriptChars: 1_000,
  visionPromptTokens: 2_000,
  visionOutputTokens: 1_800,
  patchPixels: 28,
  /** Tarifa más alta de las dos publicadas: 0,00051 USD por minuto de audio. */
  sttUsdPerMinute: "0.000510",
  /** 0,030 USD por 1.000 caracteres de entrada. */
  ttsUsdPerThousandChars: "0.030000",
  sttModelId: "@cf/openai/whisper-large-v3-turbo",
  ttsModelId: "@cf/deepgram/aura-2-es",
  ttsSpeaker: "aquila",
  orphanAfterMs: 24 * 60 * 60 * 1000,
} as const;

/** Modelos de Claude con entrada de imagen documentada. No se cambia de proveedor. */
export const VISION_MODEL_IDS = ["claude-haiku-5-5"] as const;

export type VisionModelId = (typeof VISION_MODEL_IDS)[number];

export function isVisionModel(modelId: string): modelId is VisionModelId {
  return (VISION_MODEL_IDS as readonly string[]).includes(modelId);
}

/**
 * Modelo de visión admitido para el proveedor elegido. Con anthropic se mantiene la lista de
 * Claude con imagen documentada. Con otro proveedor vale cualquier ID configurado: quien lo
 * elige debe usar un modelo que acepte imágenes, y una llamada fallida queda como error de
 * visión sin cambiar de modelo. El tope de tokens visuales sigue el cálculo de Claude, que
 * para el tamaño máximo admitido suele superar al de GPT o Gemini: la reserva sigue siendo
 * prudente, pero conviene comprobar la tarifa de imagen del modelo elegido.
 */
export function visionModelAccepted(provider: string, modelId: string): boolean {
  if (provider === "anthropic") {
    return isVisionModel(modelId);
  }
  return modelId.trim().length > 0;
}

export function visualTokens(width: number, height: number): number {
  const patch = MEDIA_LIMITS.patchPixels;
  return Math.ceil(width / patch) * Math.ceil(height / patch);
}

/** Tope de tokens de visión para el peor caso admitido, más el prompt de extracción. */
export function maxVisionInputTokens(): number {
  return (
    visualTokens(MEDIA_LIMITS.maxImageEdge, MEDIA_LIMITS.maxImageEdge) +
    MEDIA_LIMITS.visionPromptTokens
  );
}
