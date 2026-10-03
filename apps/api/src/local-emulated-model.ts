import type { AdapterRecord } from "@thepower-rag/core";
import { simulateReadableStream, type LanguageModel } from "ai";

export function localEmulatedLanguageModel(input: {
  note(adapter: AdapterRecord): void;
  reservationOk(): boolean;
}): LanguageModel {
  return {
    specificationVersion: "v4",
    provider: "local-emulated",
    modelId: "local-emulated-generator",
    supportedUrls: {},
    async doStream() {
      if (!input.reservationOk()) {
        throw new Error("No hay reserva para la generación emulada.");
      }
      input.note({ id: "local-emulated-generator", remote: false, binding: null });
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Respuesta de verificación local." },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              usage: {
                inputTokens: {
                  total: undefined,
                  noCache: undefined,
                  cacheRead: undefined,
                  cacheWrite: undefined,
                },
                outputTokens: { total: undefined, text: undefined, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  } as unknown as LanguageModel;
}
