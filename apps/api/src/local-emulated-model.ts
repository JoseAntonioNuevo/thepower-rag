// GUÍA DE LECTURA · apps/api/src/local-emulated-model.ts
// Modelo de lenguaje emulado para la verificación local: devuelve un texto fijo por streaming sin
// llamar a ningún proveedor, solo si hay reserva de presupuesto, y deja constancia del adaptador.
// Tipo del registro de adaptadores usados.
import type { AdapterRecord } from "@thepower-rag/core";
// Utilidad del AI SDK para simular un stream y tipo de modelo.
import { simulateReadableStream, type LanguageModel } from "ai";

// Crea el modelo emulado.
export function localEmulatedLanguageModel(input: {
  // Anota el adaptador usado.
  note(adapter: AdapterRecord): void;
  // Indica si hay reserva para la llamada.
  reservationOk(): boolean;
}): LanguageModel {
  // Objeto con la forma mínima de un modelo de lenguaje del AI SDK (especificación v4).
  return {
    specificationVersion: "v4",
    provider: "local-emulated",
    modelId: "local-emulated-generator",
    supportedUrls: {},
    // Única operación que usa la app: generar en streaming.
    async doStream() {
      // Sin reserva no se genera.
      if (!input.reservationOk()) {
        // Error controlado.
        throw new Error("No hay reserva para la generación emulada.");
      }
      // Anota que se usó el generador emulado.
      input.note({ id: "local-emulated-generator", remote: false, binding: null });
      // Stream simulado: inicio, texto, fin y uso desconocido.
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
