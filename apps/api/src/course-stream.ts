import { refusedByModel } from "./model";
import { providerCost, type CostPricing } from "./provider-cost";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type LanguageModel,
} from "ai";
import {
  LIMITS,
  runMetadataSchema,
  type Citation,
  type CourseUIMessage,
  type RunMetadata,
  type TraceEvent,
} from "@thepower-rag/contracts";
import { splitCitationBuffer, suppressUnknownCitations } from "@thepower-rag/core";

export const PUBLIC_PROVIDER_MESSAGE =
  "El proveedor no ha completado la respuesta. El detalle interno no se muestra.";

export function usageFrom(
  usage:
    | {
        inputTokens?: number | undefined;
        outputTokens?: number | undefined;
        totalTokens?: number | undefined;
      }
    | undefined,
): RunMetadata["usage"] {
  if (usage === undefined) {
    return null;
  }
  const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : null;
  const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : null;
  const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : null;
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    return null;
  }
  return { inputTokens, outputTokens, totalTokens };
}

export function streamFixedCourseResponse(input: {
  metadata: RunMetadata;
  trace: TraceEvent | null;
  sources: readonly Citation[];
  text: string;
  signal: AbortSignal;
  validateCitations: boolean;
}): Response {
  const stream = createUIMessageStream<CourseUIMessage>({
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageMetadata: { ...input.metadata, completion: "streaming" },
      });
      if (input.trace) {
        writer.write({ type: "data-trace", id: "trace", data: input.trace });
      }
      for (const source of input.sources)
        writer.write({ type: "data-source", id: source.chunkId, data: source });
      writer.write({ type: "text-start", id: "answer" });
      const allowed = new Set(input.sources.map((source) => source.chunkId));
      writer.write({
        type: "text-delta",
        id: "answer",
        delta: input.validateCitations ? suppressUnknownCitations(input.text, allowed) : input.text,
      });
      if (input.signal.aborted) {
        writer.write({
          type: "finish",
          messageMetadata: { ...input.metadata, completion: "aborted" },
        });
        return;
      }
      writer.write({ type: "text-end", id: "answer" });
      writer.write({ type: "finish", messageMetadata: input.metadata });
    },
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": input.metadata.origin,
    },
  });
}

export function streamProviderCourseResponse(input: {
  model: LanguageModel;
  system: string;
  messages: readonly { role: "user" | "assistant"; content: string }[];
  metadata: RunMetadata;
  trace: TraceEvent;
  sources: readonly Citation[];
  signal: AbortSignal;
  validateCitations: boolean;
  onlyCitedSources?: boolean;
  maxOutputTokens?: number;
  /** Tarifa del coste mostrado; null lo deja desconocido y sin valor usa la de Claude Haiku 5.5. */
  costPricing?: CostPricing | null;
}): Response {
  const allowed = new Set(input.sources.map((source) => source.chunkId));
  const stream = createUIMessageStream<CourseUIMessage>({
    execute: async ({ writer }) => {
      writer.write({
        type: "start",
        messageMetadata: { ...input.metadata, completion: "streaming" },
      });
      writer.write({ type: "data-trace", id: "trace", data: input.trace });
      const shown = new Set<string>();
      const sourceMap = new Map(input.sources.map((source) => [source.chunkId, source]));
      function showCited(text: string) {
        for (const match of text.matchAll(/\[cite:([A-Za-z0-9:_-]{1,128})\]/g)) {
          const source = sourceMap.get(match[1]!);
          if (source && !shown.has(source.chunkId)) {
            shown.add(source.chunkId);
            writer.write({ type: "data-source", id: source.chunkId, data: source });
          }
        }
      }
      if (!input.onlyCitedSources)
        for (const source of input.sources) {
          writer.write({ type: "data-source", id: source.chunkId, data: source });
        }
      try {
        const result = streamText({
          model: input.model,
          system: input.system,
          messages: [...input.messages],
          maxOutputTokens: input.maxOutputTokens ?? LIMITS.maxOutputTokens,
          maxRetries: LIMITS.maxRetries,
          abortSignal: input.signal,
          timeout: { totalMs: LIMITS.generationTimeoutMs },
        });
        writer.write({ type: "text-start", id: "answer" });
        let pending = "";
        for await (const delta of result.textStream) {
          if (!input.validateCitations) {
            writer.write({ type: "text-delta", id: "answer", delta });
            continue;
          }
          const split = splitCitationBuffer(pending + delta, allowed);
          pending = split.rest;
          if (split.emit.length > 0) {
            if (input.onlyCitedSources) showCited(split.emit);
            writer.write({ type: "text-delta", id: "answer", delta: split.emit });
          }
        }
        if (pending.length > 0) {
          if (input.onlyCitedSources) showCited(pending);
          writer.write({
            type: "text-delta",
            id: "answer",
            delta: input.validateCitations ? suppressUnknownCitations(pending, allowed) : pending,
          });
        }
        if (input.signal.aborted) {
          writer.write({
            type: "finish",
            messageMetadata: { ...input.metadata, completion: "aborted", usage: null, cost: null },
          });
          return;
        }
        const reason = await result.finishReason;
        const rawReason = await result.rawFinishReason;
        if (refusedByModel(reason, rawReason)) {
          throw new Error("provider-failed");
        }
        const usage = await result.totalUsage;
        writer.write({ type: "text-end", id: "answer" });
        writer.write({
          type: "finish",
          messageMetadata: runMetadataSchema.parse({
            ...input.metadata,
            completion: "complete",
            usage: usageFrom(usage),
            cost: providerCost(usage, input.costPricing),
          }),
        });
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        writer.write({
          type: "finish",
          messageMetadata: {
            ...input.metadata,
            completion: aborted ? "aborted" : "error",
            usage: null,
            cost: null,
          },
        });
        if (!aborted) {
          throw new Error("provider-failed");
        }
      }
    },
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": input.metadata.origin,
    },
  });
}

export { suppressUnknownCitations };
