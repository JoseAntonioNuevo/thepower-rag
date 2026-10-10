import {
  OPERATION_BOUNDS,
  fixtureEmbed,
  type AllowanceLedger,
  type CragChunk,
  type CragPorts,
} from "@thepower-rag/core";
import { simulateReadableStream, type LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createApp } from "./app";
import type { WorkerEnv } from "./env";
import { fixtureChunks, fixtureCorpusVersion } from "./fixture";

export interface VerificationReport {
  ok: boolean;
  provenance: "fixture";
  live: false;
  syntheticError: boolean;
  generativeCalls: number;
  embeddingCalls: number;
  turns: { id: string; ok: boolean; detail: string }[];
}

function textOf(body: string): string {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => {
      const event = JSON.parse(line.slice(6)) as { type?: string; delta?: string };
      return event.type === "text-delta" ? (event.delta ?? "") : "";
    })
    .join("");
}

export async function runVerificationSession(input: {
  ledger: AllowanceLedger;
  profileId: string;
}): Promise<VerificationReport> {
  const calls = { generative: 0, embedding: 0 };
  const model: LanguageModel = new MockLanguageModelV4({
    doStream: async () => {
      const reserved = input.ledger.reserve({ kind: "generation" });
      if (!reserved.ok) {
        throw new Error(reserved.reason);
      }
      calls.generative += 1;
      input.ledger.settle(reserved.id, null);
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "text-1" },
            { type: "text-delta", id: "text-1", delta: "Respuesta de verificación local." },
            { type: "text-end", id: "text-1" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 2, text: 2, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
  const chunk = fixtureChunks().find((item) => item.chunkId.includes("s05-langgraph"));
  const evidence: CragChunk[] =
    chunk === undefined
      ? []
      : [
          {
            documentId: chunk.documentId,
            chunkId: chunk.chunkId,
            title: chunk.title,
            section: chunk.section,
            text: chunk.text,
            audience: chunk.audience,
            corpusVersion: chunk.corpusVersion,
            profileId: input.profileId,
            score: 0.8,
          },
        ];
  const ports: CragPorts = {
    measured: true,
    now: () => 0,
    signal: { aborted: false },
    reserve: (kind) => {
      const reserved = input.ledger.reserve({ kind, ...OPERATION_BOUNDS[kind] });
      if (!reserved.ok) {
        return reserved;
      }
      if (kind === "retrieval") {
        calls.embedding += 1;
      } else {
        calls.generative += 1;
      }
      input.ledger.settle(reserved.id, null);
      return { ok: true };
    },
    retrieve: async () => ({ ok: true, providerCall: true, chunks: evidence }),
    rankAndAssess: async ({ chunks }) => ({
      ok: true,
      providerCall: true,
      raw: {
        ranking: chunks.map((item) => ({
          chunkId: item.chunkId,
          score: 0.8,
          reason: "cubre la pregunta en la verificación",
        })),
        status: "sufficient",
        reason: "basta una fuente del curso",
        gaps: [],
        usefulIds: chunks.map((item) => item.chunkId),
      },
    }),
    reformulate: async () => ({ ok: false, reason: "no hace falta", providerCall: false }),
    generate: async ({ evidence: accepted }) => ({
      ok: true,
      providerCall: true,
      text: `Verificación local [cite:${accepted[0]?.chunkId ?? "ninguna"}]`,
      usage: null,
      cost: null,
    }),
  };
  const env = {
    APP_MODE: "real",
    ANTHROPIC_API_KEY: "local-test-key",
    MODEL_ID: "example/generator",
    EVALUATOR_MODEL_ID: "example/evaluator",
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    EMBEDDING_DIMENSIONS: "32",
    CORPUS_VERSION: fixtureCorpusVersion(),
    INDEX_PROFILE: input.profileId,
    VECTOR_METRIC: "cosine",
    MIN_RETRIEVAL_SCORE: "0.33",
    AI: {},
    VECTORIZE: {},
    DB: {},
    CORPUS: {},
  } as WorkerEnv;
  const app = createApp({
    languageModel: model,
    chunks: fixtureChunks(),
    embed: (text) => {
      const reserved = input.ledger.reserve({ kind: "embedding" });
      if (!reserved.ok) {
        throw new Error(reserved.reason);
      }
      calls.embedding += 1;
      input.ledger.settle(reserved.id, null);
      return fixtureEmbed(text);
    },
    profile: {
      id: input.profileId,
      corpusVersion: fixtureCorpusVersion(),
      embeddingModel: "@cf/baai/bge-m3",
      dimensions: 32,
      metric: "cosine",
      family: "workers-ai",
      status: "ready",
      providerRevision: null,
    },
    cragPorts: ports,
  });
  const turns: VerificationReport["turns"] = [];
  const post = async (id: string, body: unknown, expectText: (value: string) => boolean) => {
    const response = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
    const raw = await response.text();
    const ok = response.status === 200 && expectText(textOf(raw) + raw);
    turns.push({ id, ok, detail: ok ? "ok" : `${String(response.status)} ${raw.slice(0, 180)}` });
  };
  const user = (text: string) => ({
    id: "u",
    role: "user",
    parts: [{ type: "text", text }],
  });
  await post(
    "sin-rag",
    { mode: "sin-rag", audience: "program", messages: [user("¿Qué es un embedding?")] },
    (value) => value.includes("verificación local"),
  );
  await post(
    "rag",
    { mode: "rag", audience: "M/J", messages: [user("¿Cuándo es la clase de RAG S10?")] },
    (value) => value.includes("2026-10-22") && !value.includes("calendario-lx"),
  );
  await post(
    "crag",
    {
      mode: "crag",
      audience: "program",
      messages: [user("¿Cómo modela LangGraph un agente con estado?")],
    },
    (value) => value.includes("[cite:") && value.includes("s05-langgraph"),
  );
  await post(
    "clarify",
    { mode: "rag", audience: "program", messages: [user("¿Cuándo es la clase de RAG?")] },
    (value) => value.includes("grupo"),
  );
  await post(
    "refuse",
    {
      mode: "rag",
      audience: "program",
      messages: [user("¿Qué beca interna del año 1991 cubre este programa?")],
    },
    (value) => value.includes("No hay contexto utilizable") && !value.includes("[cite:"),
  );
  const broken = await app.request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  turns.push({
    id: "local-error",
    ok: broken.status === 400,
    detail: "error sintético local, no es evidencia del proveedor",
  });
  return {
    ok: turns.every((turn) => turn.ok) && calls.generative <= 4,
    provenance: "fixture",
    live: false,
    syntheticError: true,
    generativeCalls: calls.generative,
    embeddingCalls: calls.embedding,
    turns,
  };
}
