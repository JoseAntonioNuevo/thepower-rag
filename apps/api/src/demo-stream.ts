import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { demoEventSchema, runMetadataSchema, type CourseUIMessage } from "@thepower-rag/contracts";

export const DEMO_CHUNK_DELAY_MS = 90;

const DEMO_CHUNKS = [
  "Demostración local sin modelo. ",
  "Este texto no viene de un proveedor ni de documentos del curso. ",
  "El modo sin RAG solo enseña el transporte de la conversación.",
];

function metadata(completion: "streaming" | "complete" | "aborted", runId: string) {
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

const demoEvent = demoEventSchema.parse({
  kind: "offline-demo",
  label: "Transporte de demostración. No es una respuesta de un modelo ni una medición de uso.",
  usage: null,
  cost: null,
});

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function offlineDemoResponse(signal: AbortSignal): Response {
  const runId = crypto.randomUUID();
  const stream = createUIMessageStream<CourseUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: metadata("streaming", runId) });
      writer.write({ type: "text-start", id: "demo-text" });
      for (const [index, chunk] of DEMO_CHUNKS.entries()) {
        if (index > 0) {
          try {
            await delay(DEMO_CHUNK_DELAY_MS, signal);
          } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
              writer.write({ type: "finish", messageMetadata: metadata("aborted", runId) });
              return;
            }
            throw error;
          }
        }
        if (signal.aborted) {
          writer.write({ type: "finish", messageMetadata: metadata("aborted", runId) });
          return;
        }
        writer.write({ type: "text-delta", id: "demo-text", delta: chunk });
      }
      writer.write({ type: "text-end", id: "demo-text" });
      writer.write({ type: "data-demo", id: "offline-demo", data: demoEvent });
      writer.write({ type: "finish", messageMetadata: metadata("complete", runId) });
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": "offline-demo",
    },
  });
}
