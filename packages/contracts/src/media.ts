// GUÍA DE LECTURA · packages/contracts/src/media.ts
// Límites de imagen, audio y voz de la investigación multimodal (S12) y reglas para elegir
// el modelo de visión. Solo son constantes y funciones puras: no llaman a ningún servicio.
/**
 * Límites de la fase 3. La imagen sigue el cálculo de parches de Claude
 * (ceil(ancho/28) × ceil(alto/28)) y el borde largo de 1.600 px queda por
 * debajo del máximo de 2.576 px / 4.784 tokens visuales de Haiku 5.5.
 * El audio de entrada es PCM WAV 16 kHz mono 16 bit, el formato estrecho que
 * Whisper acepta sin conversión. La voz de salida se reserva por caracteres,
 * que es la unidad publicada de Aura-2.
 */
export const MEDIA_LIMITS = {
  // Tamaño máximo de una imagen subida: 1,5 MB.
  maxImageBytes: 1_500_000,
  // Tamaño máximo de un audio subido: 1 MiB.
  maxAudioBytes: 1_048_576,
  // Borde largo máximo de la imagen en píxeles.
  maxImageEdge: 1_600,
  // Borde mínimo: evita imágenes de un píxel.
  minImageEdge: 8,
  // Frecuencia de muestreo exigida al WAV: 16 kHz.
  audioSampleRate: 16_000,
  // Audio mono.
  audioChannels: 1,
  // 16 bits por muestra.
  audioBitDepth: 16,
  // Duración máxima del audio: 30 segundos.
  maxAudioMs: 30_000,
  // Duración mínima: 0,2 segundos.
  minAudioMs: 200,
  // Caracteres máximos que se convierten en voz.
  maxSpeechChars: 600,
  // Frases máximas de la locución.
  maxSpeechSentences: 3,
  // Caracteres máximos del texto leído en la imagen.
  maxObservedChars: 1_000,
  // Caracteres máximos de la transcripción.
  maxTranscriptChars: 1_000,
  // Tokens reservados para las instrucciones de visión.
  visionPromptTokens: 2_000,
  // Tokens de salida de la lectura de imagen.
  visionOutputTokens: 1_800,
  // Lado del parche en píxeles del cálculo de tokens visuales de Claude.
  patchPixels: 28,
  /** Tarifa más alta de las dos publicadas: 0,00051 USD por minuto de audio. */
  sttUsdPerMinute: "0.000510",
  /** 0,030 USD por 1.000 caracteres de entrada. */
  ttsUsdPerThousandChars: "0.030000",
  // Modelo de Workers AI para transcribir (Whisper).
  sttModelId: "@cf/openai/whisper-large-v3-turbo",
  // Modelo de Workers AI para la voz (Aura-2 en español).
  ttsModelId: "@cf/deepgram/aura-2-es",
  // Voz elegida para la locución.
  ttsSpeaker: "aquila",
  // Un adjunto sin usar se considera huérfano a las 24 horas.
  orphanAfterMs: 24 * 60 * 60 * 1000,
} as const;

/** Modelos de Claude con entrada de imagen documentada. No se cambia de proveedor. */
export const VISION_MODEL_IDS = ["claude-haiku-5-5"] as const;

// Tipo con los IDs de la lista de visión.
export type VisionModelId = (typeof VISION_MODEL_IDS)[number];

// Comprueba si un ID está en la lista de Claude con imagen; «modelId is VisionModelId» informa al compilador.
export function isVisionModel(modelId: string): modelId is VisionModelId {
  // includes busca el ID en la lista.
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
  // Con Anthropic solo vale la lista documentada.
  if (provider === "anthropic") {
    // true si el modelo está en esa lista.
    return isVisionModel(modelId);
  }
  // Con otro proveedor basta con que haya un ID escrito.
  return modelId.trim().length > 0;
}

// Tokens visuales de una imagen con el cálculo de parches de Claude.
export function visualTokens(width: number, height: number): number {
  // Lado del parche (28 px).
  const patch = MEDIA_LIMITS.patchPixels;
  // Parches en horizontal por parches en vertical, redondeando hacia arriba.
  return Math.ceil(width / patch) * Math.ceil(height / patch);
}

/** Tope de tokens de visión para el peor caso admitido, más el prompt de extracción. */
export function maxVisionInputTokens(): number {
  // Peor caso: imagen cuadrada del tamaño máximo más el prompt de extracción.
  return (
    visualTokens(MEDIA_LIMITS.maxImageEdge, MEDIA_LIMITS.maxImageEdge) +
    MEDIA_LIMITS.visionPromptTokens
  );
}
