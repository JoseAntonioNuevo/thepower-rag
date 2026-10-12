// GUÍA DE LECTURA · apps/api/src/verify-session.ts
// Sesión de verificación local: recorre sin RAG, RAG, CRAG, aclaración, rechazo y un error
// sintético contra la app con dobles, y comprueba que no pasa de cuatro llamadas generativas.
// Topes, embedding de la demo y tipos de CRAG y presupuesto.
import {
  OPERATION_BOUNDS,
  fixtureEmbed,
  type AllowanceLedger,
  type CragChunk,
  type CragPorts,
} from "@thepower-rag/core";
// Stream simulado y tipo de modelo.
import { simulateReadableStream, type LanguageModel } from "ai";
// Modelo simulado.
import { MockLanguageModelV4 } from "ai/test";
// Aplicación Hono.
import { createApp } from "./app";
// Tipo del entorno.
import type { WorkerEnv } from "./env";
// Corpus de la demo.
import { fixtureChunks, fixtureCorpusVersion } from "./fixture";

// Informe de la verificación.
export interface VerificationReport {
  // true si todo pasó.
  ok: boolean;
  // Procedencia: datos de prueba.
  provenance: "fixture";
  // No fue en vivo.
  live: false;
  // Incluye un error provocado.
  syntheticError: boolean;
  // Llamadas generativas.
  generativeCalls: number;
  // Llamadas de embeddings.
  embeddingCalls: number;
  // Resultado de cada etapa.
  turns: { id: string; ok: boolean; detail: string }[];
}

// Texto de un stream de la app.
function textOf(body: string): string {
  // Une los text-delta de las líneas data:.
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => {
      // Evento JSON.
      const event = JSON.parse(line.slice(6)) as { type?: string; delta?: string };
      // Texto del evento.
      return event.type === "text-delta" ? (event.delta ?? "") : "";
    })
    .join("");
}

// Ejecuta la verificación con un libro de cuentas.
export async function runVerificationSession(input: {
  // Presupuesto de la sesión.
  ledger: AllowanceLedger;
  // Perfil de índice.
  profileId: string;
}): Promise<VerificationReport> {
  // Contadores.
  const calls = { generative: 0, embedding: 0 };
  // Modelo simulado que reserva y cuenta cada llamada.
  const model: LanguageModel = new MockLanguageModelV4({
    doStream: async () => {
      // Reserva la generación.
      const reserved = input.ledger.reserve({ kind: "generation" });
      // Sin reserva.
      if (!reserved.ok) {
        // Error.
        throw new Error(reserved.reason);
      }
      // Cuenta.
      calls.generative += 1;
      // Liquida sin importe.
      input.ledger.settle(reserved.id, null);
      // Stream fijo.
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
  // Fragmento de S5 del corpus.
  const chunk = fixtureChunks().find((item) => item.chunkId.includes("s05-langgraph"));
  // Evidencia de CRAG.
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
  // Puertos de CRAG simulados que reservan y cuentan.
  const ports: CragPorts = {
    measured: true,
    now: () => 0,
    signal: { aborted: false },
    reserve: (kind) => {
      // Reserva con los topes del tipo.
      const reserved = input.ledger.reserve({ kind, ...OPERATION_BOUNDS[kind] });
      // Sin reserva.
      if (!reserved.ok) {
        // Rechazo.
        return reserved;
      }
      // Búsqueda: embedding.
      if (kind === "retrieval") {
        // Cuenta.
        calls.embedding += 1;
      } else {
        // El resto: generativa.
        calls.generative += 1;
      }
      // Liquida.
      input.ledger.settle(reserved.id, null);
      // Reservada.
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
  // Entorno real con valores de prueba.
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
  // App con los dobles.
  const app = createApp({
    languageModel: model,
    chunks: fixtureChunks(),
    embed: (text) => {
      // Reserva el embedding.
      const reserved = input.ledger.reserve({ kind: "embedding" });
      // Sin reserva.
      if (!reserved.ok) {
        // Error.
        throw new Error(reserved.reason);
      }
      // Cuenta.
      calls.embedding += 1;
      // Liquida.
      input.ledger.settle(reserved.id, null);
      // Vector de la demo.
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
  // Resultado de cada etapa.
  const turns: VerificationReport["turns"] = [];
  // Envía una petición y comprueba el texto.
  const post = async (id: string, body: unknown, expectText: (value: string) => boolean) => {
    // Petición de chat.
    const response = await app.request(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    );
    // Cuerpo.
    const raw = await response.text();
    // 200 y texto esperado.
    const ok = response.status === 200 && expectText(textOf(raw) + raw);
    // Guarda el resultado.
    turns.push({ id, ok, detail: ok ? "ok" : `${String(response.status)} ${raw.slice(0, 180)}` });
  };
  // Mensaje del alumno.
  const user = (text: string) => ({
    id: "u",
    role: "user",
    parts: [{ type: "text", text }],
  });
  // Sin RAG.
  await post(
    "sin-rag",
    { mode: "sin-rag", audience: "program", messages: [user("¿Qué es un embedding?")] },
    (value) => value.includes("verificación local"),
  );
  // RAG con calendario M/J.
  await post(
    "rag",
    { mode: "rag", audience: "M/J", messages: [user("¿Cuándo es la clase de RAG S10?")] },
    (value) => value.includes("2026-10-22") && !value.includes("calendario-lx"),
  );
  // CRAG con cita a S5.
  await post(
    "crag",
    {
      mode: "crag",
      audience: "program",
      messages: [user("¿Cómo modela LangGraph un agente con estado?")],
    },
    (value) => value.includes("[cite:") && value.includes("s05-langgraph"),
  );
  // Pregunta de calendario sin grupo: aclaración.
  await post(
    "clarify",
    { mode: "rag", audience: "program", messages: [user("¿Cuándo es la clase de RAG?")] },
    (value) => value.includes("grupo"),
  );
  // Dato inexistente: rechazo sin citas.
  await post(
    "refuse",
    {
      mode: "rag",
      audience: "program",
      messages: [user("¿Qué beca interna del año 1991 cubre este programa?")],
    },
    (value) => value.includes("No hay contexto utilizable") && !value.includes("[cite:"),
  );
  // JSON roto: error 400.
  const broken = await app.request("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  // Guarda el error sintético.
  turns.push({
    id: "local-error",
    ok: broken.status === 400,
    detail: "error sintético local, no es evidencia del proveedor",
  });
  // Informe final.
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
