import {
  chatRequestSchema,
  healthResponseSchema,
  issuesFrom,
  LIMITS,
  messageText,
  type Citation,
  type ErrorResponse,
  type HealthResponse,
  type RunMetadata,
} from "@thepower-rag/contracts";
import {
  allowsAudience,
  isWeeklyScheduleQuestion,
  calendarOverviewId,
  calendarOverviewOutcome,
  citationsFor,
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  gateScoredChunks,
  isScheduleQuestion,
  retrieveBasic,
  type CragPorts,
  type AllowanceLedger,
  type IndexedChunk,
  type RetrievalOutcome,
} from "@thepower-rag/core";
import type { LanguageModel } from "ai";
import { Hono } from "hono";
import { dependencyCompatibility } from "./compat";
import { cragHttpResponse } from "./crag-http";
import {
  PUBLIC_PROVIDER_MESSAGE,
  streamFixedCourseResponse,
  streamProviderCourseResponse,
} from "./course-stream";
import { offlineDemoResponse } from "./demo-stream";
import { assessWorker, type WorkerEnv } from "./env";
import {
  fixtureChunks,
  fixtureContentVersion,
  fixtureCorpusVersion,
  fixtureCoverage,
  fixtureProfile,
} from "./fixture";
import { readCourseContext, completeContextOutcome, CourseContextError } from "./course-context";
import { protectChat } from "./chat-protection";
import { reservePublicTurn } from "./public-budget";
import { createGenerationModel } from "./model";
import {
  RAG_PROMPT,
  SIN_RAG_PROMPT,
  ragSystem,
  COMPLETE_RAG_PROMPT,
  completeRagSystem,
} from "./prompts";
import {
  profileReady,
  queryVectorize,
  readChunk,
  readIndexProfile,
  type IndexProfileRow,
  type SqlDatabase,
  type VectorIndex,
} from "./stores";
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";

export interface AppDeps {
  allowance?: AllowanceLedger;
  onProviderCall?: () => void;
  languageModel?: LanguageModel;
  chunks?: readonly IndexedChunk[];
  embed?: (text: string) => readonly number[];
  profile?: IndexProfileRow | null;
  cragPorts?: CragPorts;
}

function jsonError(body: ErrorResponse, status: 400 | 409 | 501 | 502): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function runtimeLabel(): string {
  return navigator.userAgent || "runtime-desconocido";
}

function modelMessages(
  messages: { role: "user" | "assistant"; parts: { type: string; text?: string }[] }[],
) {
  return messages
    .map((message) => ({ role: message.role, content: messageText(message as never) }))
    .filter((message) => message.content.trim().length > 0);
}

function fixtureAnswer(evidence: readonly IndexedChunk[]): string {
  const lines = evidence.map(
    (chunk) =>
      `Según [cite:${chunk.chunkId}] (${chunk.section}): ${chunk.text.replace(/\s+/g, " ").slice(0, 280)}`,
  );
  return `Respuesta de la canalización local de prueba. No es un modelo ni un índice de Vectorize.\n${lines.join("\n")}`;
}

const CLARIFY =
  "La pregunta parece de calendario. Elige el grupo con clases los lunes y miércoles o el grupo con clases los martes y jueves. La selección general no muestra los dos calendarios.";
const REFUSE =
  "No hay contexto utilizable en el corpus seleccionado. No consta en los documentos recuperados y no se ha llamado a un modelo.";

function metadata(
  origin: RunMetadata["origin"],
  modelId: string | null,
  promptId: string,
  completion: RunMetadata["completion"],
): RunMetadata {
  return {
    runId: crypto.randomUUID(),
    origin,
    modelId,
    promptId,
    completion,
    usage: null,
    cost: null,
  };
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Bindings: WorkerEnv }>();

  app.get("/api/health", async (context) => {
    const assessment = assessWorker(context.env);
    const compatibility = await dependencyCompatibility();
    const demoCorpus = assessment.execution === "demo";
    const bundled = fixtureCorpusVersion();
    const configuredVersion = assessment.retrieval?.corpusVersion ?? null;
    const sourceKnown = demoCorpus || configuredVersion === bundled;
    const unknownCoverage = {
      curriculum: "unknown" as const,
      calendarLx: "unknown" as const,
      calendarMj: "unknown" as const,
      exerciseDetail: "unknown" as const,
      remote: "not-verified" as const,
    };
    const body: HealthResponse = {
      app: "thepower-rag",
      phase: "crag",
      execution: assessment.execution,
      runtime: runtimeLabel(),
      capabilities: assessment.capabilities,
      corpus: {
        version: demoCorpus ? bundled : configuredVersion,
        contentVersion: sourceKnown ? fixtureContentVersion() : null,
        profileId: demoCorpus ? fixtureProfile().id : (assessment.retrieval?.indexProfile ?? null),
        profileFamily: demoCorpus ? "fixture" : assessment.retrieval ? "workers-ai" : "unknown",
        coverage: sourceKnown ? fixtureCoverage() : unknownCoverage,
        embedding: demoCorpus
          ? FIXTURE_EMBEDDING_MODEL
          : (assessment.retrieval?.embeddingModel ?? "sin configurar"),
        dimensions: demoCorpus ? FIXTURE_DIMENSIONS : (assessment.retrieval?.dimensions ?? null),
        remoteRevision: null,
      },
      compatibility,
    };
    if (!demoCorpus && assessment.retrieval && context.env.DB) {
      try {
        const row = await readIndexProfile(
          context.env.DB as SqlDatabase,
          assessment.retrieval.indexProfile,
          assessment.retrieval.corpusVersion,
        );
        if (profileReady(row, assessment.retrieval).ok)
          body.corpus.coverage.remote = "index-verified";
      } catch {
        /* Connectivity is not inferred from the binding declaration. */
      }
    }
    return Response.json(healthResponseSchema.parse(body), {
      headers: { "cache-control": "no-store" },
    });
  });

  app.post("/api/chat", async (context) => {
    const rejected = await protectChat(context.req.raw, context.env ?? {});
    if (rejected) return rejected;
    const raw = await context.req.text();
    if (raw.length > LIMITS.maxBodyChars) {
      return jsonError(
        {
          error: "invalid_request",
          message: "El cuerpo supera el límite de la solicitud.",
          issues: [{ path: "", message: `Máximo ${String(LIMITS.maxBodyChars)} caracteres.` }],
        },
        400,
      );
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return jsonError(
        { error: "invalid_request", message: "El cuerpo no es JSON válido.", issues: [] },
        400,
      );
    }
    const parsed = chatRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return jsonError(
        {
          error: "invalid_request",
          message: "La solicitud no cumple el contrato.",
          issues: issuesFrom(parsed.error),
        },
        400,
      );
    }
    const assessment = assessWorker(context.env);
    if (assessment.execution === "misconfigured") {
      return jsonError(
        {
          error: "configuration",
          message: assessment.message ?? "APP_MODE no es válido.",
          missing: ["APP_MODE"],
        },
        409,
      );
    }
    const question = messageText(
      parsed.data.messages.at(-1) ?? { id: "", role: "user", parts: [] },
    );
    const history = modelMessages(parsed.data.messages);
    const signal = context.req.raw.signal;

    const publicBudget =
      assessment.execution === "real" && context.env.PUBLIC_BUDGET_USD !== undefined;
    const allowance = publicBudget
      ? await reservePublicTurn(context.env, parsed.data.mode)
      : deps.allowance;
    if (publicBudget && !allowance)
      return Response.json(
        {
          error: "configuration",
          message: "Se ha alcanzado el presupuesto de esta demo. Contacta con el profesor.",
          missing: ["PUBLIC_BUDGET_USD"],
        },
        { status: 429 },
      );
    if (parsed.data.mode === "crag") {
      const crag = await cragHttpResponse({
        env: context.env,
        assessment,
        request: parsed.data,
        question,
        history,
        signal,
        deps,
        allowance: allowance ?? undefined,
      });
      if (!(crag instanceof Response)) {
        return jsonError(
          { error: "configuration", message: crag.message, missing: crag.missing },
          409,
        );
      }
      return crag;
    }

    const capability = assessment.capabilities[parsed.data.mode];
    if (assessment.execution === "real" && capability.status === "blocked") {
      return jsonError(
        {
          error: "configuration",
          message: "La capacidad pedida no está configurada. No hay vuelta a la demostración.",
          missing: capability.missing,
        },
        409,
      );
    }

    if (parsed.data.mode === "sin-rag") {
      if (assessment.execution === "demo") {
        return offlineDemoResponse(signal);
      }
      const settings = assessment.generation;
      if (settings === null) {
        return jsonError(
          { error: "configuration", message: "Falta la generación.", missing: capability.missing },
          409,
        );
      }
      try {
        const model = deps.languageModel ?? createGenerationModel(settings, deps.onProviderCall);
        return streamProviderCourseResponse({
          model,
          system: SIN_RAG_PROMPT.text,
          messages: history,
          metadata: metadata("provider", settings.modelId, SIN_RAG_PROMPT.id, "complete"),
          validateCitations: false,
          trace: {
            query: question,
            queryRewrite: "pending",
            corpusVersion: null,
            embedding: "ninguno",
            scoreMeaning: "Sin RAG no calcula puntuaciones.",
            retrieved: [],
            decision: "answer",
            generation: "called",
            status: "Generación sin recuperación.",
          },
          sources: [],
          signal,
        });
      } catch {
        return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
      }
    }

    const chunks = deps.chunks ?? fixtureChunks();
    const embed = deps.embed ?? fixtureEmbed;
    const useFixture = assessment.execution === "demo" || deps.chunks !== undefined;
    let outcome: RetrievalOutcome;
    if (useFixture && assessment.execution === "demo") {
      outcome = retrieveBasic({
        question,
        audience: parsed.data.audience,
        chunks,
        embed,
        minScore: FIXTURE_MIN_SCORE,
        embeddingLabel: FIXTURE_EMBEDDING_MODEL,
        corpusVersion: chunks[0]?.corpusVersion ?? fixtureCorpusVersion(),
        scoreMeaning:
          "Coseno del índice de prueba por tokens. No es una probabilidad ni un embedding de BGE-M3.",
      });
    } else if (deps.chunks !== undefined) {
      const retrieval = assessment.retrieval;
      if (retrieval === null) {
        return jsonError(
          {
            error: "configuration",
            message: "Falta la recuperación.",
            missing: capability.missing,
          },
          409,
        );
      }
      if (isScheduleQuestion(question) && parsed.data.audience === "program") {
        outcome = {
          decision: "clarify",
          evidence: [],
          trace: {
            query: question,
            queryRewrite: "pending",
            corpusVersion: retrieval.corpusVersion,
            embedding: retrieval.embeddingModel,
            scoreMeaning: "Coseno del índice inyectado en la prueba. No es Vectorize.",
            retrieved: [],
            decision: "clarify",
            generation: "skipped",
            status: "Falta el grupo para una pregunta de calendario.",
          },
        };
      } else {
        const gate = profileReady(deps.profile ?? null, retrieval);
        if (!gate.ok) {
          return jsonError(
            {
              error: "configuration",
              message: "El índice configurado no está listo o no coincide con el perfil.",
              missing: gate.missing,
            },
            409,
          );
        }
        outcome = retrieveBasic({
          question,
          audience: parsed.data.audience,
          chunks,
          embed,
          minScore: retrieval.minScore,
          embeddingLabel: retrieval.embeddingModel,
          corpusVersion: retrieval.corpusVersion,
          scoreMeaning: "Coseno del índice inyectado en la prueba. No es Vectorize.",
        });
      }
    } else {
      const retrieval = assessment.retrieval;
      if (retrieval === null) {
        return jsonError(
          {
            error: "configuration",
            message: "Falta la recuperación.",
            missing: capability.missing,
          },
          409,
        );
      }
      const runner = context.env.AI as EmbeddingRunner | undefined;
      const index = context.env.VECTORIZE as VectorIndex | undefined;
      const database = context.env.DB as SqlDatabase | undefined;
      if (!runner || !index || !database) {
        return jsonError(
          {
            error: "configuration",
            message: "Faltan bindings de recuperación.",
            missing: capability.missing,
          },
          409,
        );
      }
      if (isScheduleQuestion(question) && parsed.data.audience === "program") {
        outcome = {
          decision: "clarify",
          evidence: [],
          trace: {
            query: question,
            queryRewrite: "pending",
            corpusVersion: retrieval.corpusVersion,
            embedding: retrieval.embeddingModel,
            scoreMeaning: "Puntuación devuelta por Vectorize. No es una probabilidad de acierto.",
            retrieved: [],
            decision: "clarify",
            generation: "skipped",
            status: "Falta el grupo para una pregunta de calendario.",
          },
        };
      } else {
        const row =
          deps.profile !== undefined
            ? deps.profile
            : await readIndexProfile(database, retrieval.indexProfile, retrieval.corpusVersion);
        const gate = profileReady(row, retrieval);
        if (!gate.ok) {
          return jsonError(
            {
              error: "configuration",
              message: "El índice configurado no está listo o no coincide con el perfil.",
              missing: gate.missing,
            },
            409,
          );
        }
        try {
          if (context.env.RAG_CONTEXT_MODE === "complete") {
            const contextChunks = await readCourseContext(
              database,
              retrieval.corpusVersion,
              parsed.data.audience,
              signal,
            );
            outcome = completeContextOutcome(question, retrieval.corpusVersion, contextChunks);
          } else if (isWeeklyScheduleQuestion(question)) {
            const id = calendarOverviewId(parsed.data.audience, retrieval.corpusVersion);
            const record =
              id === null ? null : await readChunk(database, retrieval.corpusVersion, id);
            outcome = calendarOverviewOutcome({
              question,
              audience: parsed.data.audience,
              corpusVersion: retrieval.corpusVersion,
              chunk: record ? { ...record, vector: [] } : null,
            });
          } else {
            const [vector] = await embedWithWorkersAi(
              runner,
              retrieval.embeddingModel,
              [question],
              retrieval.dimensions,
              signal,
            );
            if (vector === undefined) {
              return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
            }
            const hits = await queryVectorize(
              index,
              {
                vector,
                audience: parsed.data.audience,
                corpusVersion: retrieval.corpusVersion,
                profileId: retrieval.indexProfile,
                limit: LIMITS.retrievalTopK,
              },
              signal,
            );
            const ranked: { chunk: IndexedChunk; score: number | null }[] = [];
            for (const hit of hits) {
              const record = await readChunk(database, retrieval.corpusVersion, hit.chunkId);
              if (record === null || !allowsAudience(record.audience, parsed.data.audience)) {
                continue;
              }
              ranked.push({
                chunk: { ...record, vector: [] },
                score: hit.score,
              });
            }
            outcome = gateScoredChunks({
              question,
              audience: parsed.data.audience,
              corpusVersion: retrieval.corpusVersion,
              embeddingLabel: retrieval.embeddingModel,
              scoreMeaning: "Puntuación devuelta por Vectorize. No es una probabilidad de acierto.",
              minScore: retrieval.minScore,
              ranked,
            });
          }
        } catch (error) {
          if (error instanceof CourseContextError)
            return jsonError(
              {
                error: "configuration",
                message:
                  "No se pudo verificar todo el contexto del curso. No se responde con documentos incompletos.",
                missing: ["COURSE_CONTEXT"],
              },
              409,
            );
          if (error instanceof DOMException && error.name === "AbortError") {
            return new Response(null, { status: 499 });
          }
          return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
        }
      }
    }

    const sources: Citation[] = citationsFor(outcome.evidence);
    if (outcome.decision !== "answer") {
      const text = outcome.decision === "clarify" ? CLARIFY : REFUSE;
      const origin = assessment.execution === "demo" ? "offline-fixture" : "pipeline";
      return streamFixedCourseResponse({
        metadata: metadata(
          origin,
          null,
          "rag-control-v1",
          outcome.decision === "clarify" ? "clarified" : "refused",
        ),
        trace: outcome.trace,
        sources,
        text,
        signal,
        validateCitations: false,
      });
    }

    if (assessment.execution === "demo") {
      return streamFixedCourseResponse({
        metadata: metadata("offline-fixture", null, "rag-fixture-v1", "complete"),
        validateCitations: true,
        trace: {
          ...outcome.trace,
          generation: "skipped",
          status: "Respuesta plantilla de la canalización de prueba. No hay llamada a un modelo.",
        },
        sources,
        text: fixtureAnswer(outcome.evidence),
        signal,
      });
    }

    const settings = assessment.generation;
    if (settings === null) {
      return jsonError(
        { error: "configuration", message: "Falta la generación.", missing: capability.missing },
        409,
      );
    }
    try {
      const model = deps.languageModel ?? createGenerationModel(settings, deps.onProviderCall);
      return streamProviderCourseResponse({
        model,
        system:
          context.env.RAG_CONTEXT_MODE === "complete"
            ? completeRagSystem(outcome.evidence, parsed.data.audience)
            : ragSystem(outcome.evidence),
        messages: history,
        metadata: metadata(
          "provider",
          settings.modelId,
          context.env.RAG_CONTEXT_MODE === "complete" ? COMPLETE_RAG_PROMPT.id : RAG_PROMPT.id,
          "complete",
        ),
        trace: outcome.trace,
        sources,
        signal,
        validateCitations: true,
        onlyCitedSources: context.env.RAG_CONTEXT_MODE === "complete",
        maxOutputTokens: context.env.RAG_CONTEXT_MODE === "complete" ? 1200 : undefined,
      });
    } catch {
      return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
    }
  });

  return app;
}
