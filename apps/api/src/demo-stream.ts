// GUÍA DE LECTURA · apps/api/src/demo-stream.ts
// Respuesta de la demo sin RAG: un stream de texto fijo, sin modelo ni coste, que enseña cómo viaja
// un mensaje por el protocolo UI Message Stream del AI SDK y cómo se cancela.
// Utilidades del AI SDK para crear el stream de mensajes.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
// Esquemas del evento de la demo y de los metadatos.
import { demoEventSchema, runMetadataSchema, type CourseUIMessage } from "@thepower-rag/contracts";

// Pausa entre trozos del texto de la demo.
export const DEMO_CHUNK_DELAY_MS = 90;

// Trozos del texto de la demo.
const DEMO_CHUNKS = [
  "Demostración local sin modelo. ",
  "Este texto no viene de un proveedor ni de documentos del curso. ",
  "El modo sin RAG solo enseña el transporte de la conversación.",
];

// Metadatos de la demo: sin modelo, sin consumo y sin coste.
function metadata(completion: "streaming" | "complete" | "aborted", runId: string) {
  // Validados con el esquema.
  return runMetadataSchema.parse({
    runId,
    origin: "offline-demo",
    modelId: null,
    promptId: "offline-demo-v1",
    completion,
    usage: null,
    cost: null,
  });
}

// Evento que explica que es una demostración.
const demoEvent = demoEventSchema.parse({
  kind: "offline-demo",
  label: "Transporte de demostración. No es una respuesta de un modelo ni una medición de uso.",
  usage: null,
  cost: null,
});

// Espera ms milisegundos o rechaza si se cancela.
function delay(ms: number, signal: AbortSignal): Promise<void> {
  // Promesa que se resuelve tras la pausa.
  return new Promise((resolve, reject) => {
    // Ya cancelado.
    if (signal.aborted) {
      // Rechaza.
      reject(new DOMException("The operation was aborted.", "AbortError"));
      // Termina.
      return;
    }
    // Temporizador de la pausa.
    const timer = setTimeout(() => {
      // Quita el oyente.
      signal.removeEventListener("abort", onAbort);
      // Pausa completada.
      resolve();
    }, ms);
    // Cancelación durante la pausa.
    const onAbort = () => {
      // Detiene el temporizador.
      clearTimeout(timer);
      // Rechaza.
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    // Escucha la cancelación una vez.
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Respuesta HTTP con el stream de la demo.
export function offlineDemoResponse(signal: AbortSignal): Response {
  // Id de la ejecución.
  const runId = crypto.randomUUID();
  // Stream de mensajes.
  const stream = createUIMessageStream<CourseUIMessage>({
    execute: async ({ writer }) => {
      // Inicio con metadatos.
      writer.write({ type: "start", messageMetadata: metadata("streaming", runId) });
      // Inicio del texto.
      writer.write({ type: "text-start", id: "demo-text" });
      // Envía cada trozo.
      for (const [index, chunk] of DEMO_CHUNKS.entries()) {
        // Entre trozos hay una pausa.
        if (index > 0) {
          // Si se cancela durante la pausa.
          try {
            // Pausa.
            await delay(DEMO_CHUNK_DELAY_MS, signal);
          } catch (error) {
            // Cancelación del usuario.
            if (error instanceof DOMException && error.name === "AbortError") {
              // Final como cancelado.
              writer.write({ type: "finish", messageMetadata: metadata("aborted", runId) });
              // Termina.
              return;
            }
            // Otro error.
            throw error;
          }
        }
        // Cancelado entre trozos.
        if (signal.aborted) {
          // Final como cancelado.
          writer.write({ type: "finish", messageMetadata: metadata("aborted", runId) });
          // Termina.
          return;
        }
        // Envía el trozo.
        writer.write({ type: "text-delta", id: "demo-text", delta: chunk });
      }
      // Fin del texto.
      writer.write({ type: "text-end", id: "demo-text" });
      // Evento de la demo.
      writer.write({ type: "data-demo", id: "offline-demo", data: demoEvent });
      // Final completo.
      writer.write({ type: "finish", messageMetadata: metadata("complete", runId) });
    },
  });

  // Respuesta HTTP sin caché y con una cabecera que identifica la demo.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": "offline-demo",
    },
  });
}
