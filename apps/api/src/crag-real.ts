import { refusedByModel } from "./model";
import { providerCost, type CostPricing } from "./provider-cost";
import { LIMITS } from "@thepower-rag/contracts";
import {
  CRAG_BOUNDS,
  OPERATION_BOUNDS,
  type AllowanceLedger,
  type CragChunk,
  type CragPorts,
  type CragScope,
} from "@thepower-rag/core";
import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { cragSystem } from "./prompts";
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";

const evidenceSchema = z.object({
  ranking: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(CRAG_BOUNDS.maxIdChars),
        score: z.number().finite(),
        reason: z.string().min(1).max(CRAG_BOUNDS.maxReasonChars),
      }),
    )
    .max(CRAG_BOUNDS.maxCandidates),
  status: z.enum(["sufficient", "partial", "insufficient"]),
  reason: z.string().min(1).max(CRAG_BOUNDS.maxReasonChars),
  gaps: z.array(z.string().min(1).max(CRAG_BOUNDS.maxGapChars)).max(CRAG_BOUNDS.maxGaps),
  usefulIds: z.array(z.string().min(1).max(CRAG_BOUNDS.maxIdChars)).max(CRAG_BOUNDS.maxRetained),
});

const rewriteSchema = z.object({
  query: z.string().min(1).max(CRAG_BOUNDS.maxQueryChars),
});

const EVALUATOR_PROMPT = [
  "Eres el evaluador del corpus privado del programa AI Engineer.",
  "ranking debe incluir EXACTAMENTE TODOS los fragmentos recibidos, cada id una sola vez, también los irrelevantes. Copia sus ids completos.",
  "Ordena esos fragmentos y decide si bastan para la pregunta original.",
  "sufficient: usefulIds contiene de 1 a 6 ids con texto que responde; gaps es [].",
  "partial: usefulIds conserva de 1 a 6 ids útiles y gaps nombra lo que falta.",
  "insufficient: usefulIds es [] Y gaps es []. El reason explica qué falta.",
  "sufficient exige texto útil. partial conserva esos ids y nombra la laguna. insufficient deja usefulIds vacío.",
  "No inventes ids ni hechos. La puntuación es relevancia, no una probabilidad. No respondas al alumno ni busques fuera del corpus.",
].join("\n");

const REWRITE_PROMPT = [
  "Reformula la búsqueda en el corpus del curso para cubrir la laguna.",
  "Conserva la intención de la pregunta original y no añadas un hecho que no esté pedido.",
  "La consulta tiene que ser distinta de las anteriores.",
].join("\n");

export function providerTimeoutMs(remainingMs: number, capMs: number): number {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return 0;
  }
  return Math.min(capMs, Math.floor(remainingMs));
}

async function withDeadline<T>(
  parent: AbortSignal,
  remainingMs: number,
  capMs: number,
  run: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
): Promise<T> {
  const timeoutMs = providerTimeoutMs(remainingMs, capMs);
  if (parent.aborted || timeoutMs <= 0) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  const controller = new AbortController();
  const onAbort = () => {
    controller.abort();
  };
  parent.addEventListener("abort", onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = run(controller.signal, timeoutMs);
  void pending.catch(() => undefined);
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("crag-timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    parent.removeEventListener("abort", onAbort);
  }
}

function sameScope(left: CragScope, right: CragScope): boolean {
  return (
    left.audience === right.audience &&
    left.corpusVersion === right.corpusVersion &&
    left.profileId === right.profileId
  );
}

export function createRealCragPorts(input: {
  signal: AbortSignal;
  scope: CragScope;
  embedder: EmbeddingRunner;
  index: VectorIndex;
  database: SqlDatabase;
  evaluator: LanguageModel;
  generator: LanguageModel;
  messages: readonly { role: "user" | "assistant"; content: string }[];
  embeddingModel: string;
  dimensions: number;
  allowance?: AllowanceLedger;
  /** Tarifa del coste mostrado de la respuesta final; sin valor, la de Claude Haiku 5.5. */
  costPricing?: CostPricing | null;
}): CragPorts {
  const open = new Map<string, string>();
  const reserveKind = (
    kind: "retrieval" | "evaluation" | "reformulation" | "generation",
  ): { ok: true } | { ok: false; reason: string } => {
    if (input.allowance === undefined) {
      return {
        ok: false,
        reason: "No hay una sesión de gasto autorizada. El chat real no llama al proveedor.",
      };
    }
    const bounds = OPERATION_BOUNDS[kind];
    const reserved = input.allowance.reserve({ kind, ...bounds });
    if (!reserved.ok) {
      return reserved;
    }
    open.set(kind, reserved.id);
    return { ok: true };
  };
  const settle = (kind: string, actualUsd: number | null) => {
    const id = open.get(kind);
    if (id !== undefined) {
      input.allowance?.settle(id, actualUsd);
      open.delete(kind);
    }
  };
  return {
    measured: true,
    now: Date.now,
    signal: input.signal,
    reserve: reserveKind,
    async retrieve({ query, scope, limit, remainingMs }) {
      if (!sameScope(scope, input.scope)) {
        return { ok: false, reason: "La búsqueda cambió de ámbito." };
      }
      if (input.signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      let vector: number[] | undefined;
      try {
        const rows = await withDeadline(
          input.signal,
          remainingMs,
          LIMITS.embeddingTimeoutMs,
          (signal, timeoutMs) =>
            embedWithWorkersAi(
              input.embedder,
              input.embeddingModel,
              [query],
              input.dimensions,
              signal,
              timeoutMs,
            ),
        );
        vector = rows[0];
        settle("retrieval", null);
      } catch (error) {
        settle("retrieval", null);
        throw error;
      }
      if (vector === undefined) {
        return { ok: false, reason: "El embedding no devolvió un vector." };
      }
      const hits = await queryVectorize(
        input.index,
        {
          vector,
          audience: scope.audience,
          corpusVersion: scope.corpusVersion,
          profileId: scope.profileId,
          limit,
        },
        input.signal,
      );
      const chunks: CragChunk[] = [];
      for (const hit of hits) {
        const record = await readChunk(input.database, scope.corpusVersion, hit.chunkId);
        if (record === null) {
          continue;
        }
        chunks.push({ ...record, profileId: scope.profileId, score: hit.score });
      }
      return { ok: true, providerCall: true, chunks };
    },
    async rankAndAssess({ question, query, chunks, remainingMs }) {
      if (input.signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      const packed = chunks
        .map(
          (chunk) =>
            `id: ${chunk.chunkId}\npuntuación: ${chunk.score === null ? "desconocida" : String(chunk.score)}\ntexto:\n${chunk.text}`,
        )
        .join("\n\n");
      try {
        const result = await withDeadline(
          input.signal,
          remainingMs,
          LIMITS.generationTimeoutMs,
          (signal) =>
            generateObject({
              model: input.evaluator,
              schema: evidenceSchema.extend({
                ranking: evidenceSchema.shape.ranking.length(chunks.length),
              }),
              schemaName: "crag-evidence",
              system: EVALUATOR_PROMPT,
              prompt: `Pregunta original:\n${question}\n\nConsulta de búsqueda:\n${query}\n\nFragmentos:\n${packed}`,
              maxOutputTokens: 1600,
              maxRetries: LIMITS.maxRetries,
              abortSignal: signal,
            }),
        );
        settle("evaluation", null);
        return { ok: true, providerCall: true, raw: result.object };
      } catch (error) {
        settle("evaluation", null);
        console.warn(
          "CRAG evaluator failure",
          error instanceof Error
            ? { name: error.name, message: error.message.slice(0, 500) }
            : { name: "unknown" },
        );
        throw error;
      }
    },
    async reformulate({ question, query, gaps, remainingMs }) {
      if (input.signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      try {
        const result = await withDeadline(
          input.signal,
          remainingMs,
          LIMITS.generationTimeoutMs,
          (signal) =>
            generateObject({
              model: input.evaluator,
              schema: rewriteSchema,
              schemaName: "crag-query",
              system: REWRITE_PROMPT,
              prompt: `Pregunta original:\n${question}\n\nConsulta anterior:\n${query}\n\nLagunas:\n${gaps.join("\n") || "sin laguna nombrada"}`,
              maxOutputTokens: 800,
              maxRetries: LIMITS.maxRetries,
              abortSignal: signal,
            }),
        );
        settle("reformulation", null);
        return { ok: true, providerCall: true, raw: result.object };
      } catch (error) {
        settle("reformulation", null);
        throw error;
      }
    },
    async generate({ question, evidence, remainingMs }) {
      if (input.signal.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      let result: Awaited<ReturnType<typeof generateText>>;
      try {
        result = await withDeadline(
          input.signal,
          remainingMs,
          LIMITS.generationTimeoutMs,
          (signal, timeoutMs) =>
            generateText({
              model: input.generator,
              system: cragSystem(evidence),
              messages: [
                ...input.messages.slice(0, -1),
                { role: "user" as const, content: question },
              ],
              maxOutputTokens: LIMITS.maxOutputTokens,
              maxRetries: LIMITS.maxRetries,
              abortSignal: signal,
              timeout: { totalMs: timeoutMs },
            }),
        );
        settle("generation", null);
      } catch (error) {
        settle("generation", null);
        throw error;
      }
      if (refusedByModel(result.finishReason, result.rawFinishReason)) {
        throw new Error("provider-failed");
      }
      const usage = result.totalUsage;
      const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : null;
      const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : null;
      const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : null;
      return {
        ok: true,
        providerCall: true,
        text: result.text,
        usage:
          inputTokens === null && outputTokens === null && totalTokens === null
            ? null
            : { inputTokens, outputTokens, totalTokens },
        cost: providerCost(usage, input.costPricing),
      };
    },
  };
}
