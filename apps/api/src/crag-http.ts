import {
  cragSummarySchema,
  type ChatRequest,
  type CragStep,
  type RunMetadata,
} from "@thepower-rag/contracts";
import {
  citationsFor,
  isScheduleQuestion,
  suppressUnknownCitations,
  type CragPorts,
  type AllowanceLedger,
  type IndexedChunk,
} from "@thepower-rag/core";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { createDemoCragPorts, resolveDemoScenario } from "./crag-demo";
import { runCragTurn } from "./crag-graph";
import { createRealCragPorts } from "./crag-real";
import { PUBLIC_PROVIDER_MESSAGE } from "./course-stream";
import type { Assessment, WorkerEnv } from "./env";
import { fixtureCorpusVersion, fixtureProfile } from "./fixture";
import { createEvaluatorModel, createGenerationModel } from "./model";
import { CRAG_PROMPT } from "./prompts";
import {
  profileReady,
  readIndexProfile,
  type IndexProfileRow,
  type SqlDatabase,
  type VectorIndex,
} from "./stores";
import type { EmbeddingRunner } from "./vectors";

export interface CragHttpDeps {
  onProviderCall?: () => void;
  cragPorts?: CragPorts;
  profile?: IndexProfileRow | null;
}

function completionFor(terminal: RunMetadata["completion"]): RunMetadata["completion"] {
  return terminal;
}

function inertPorts(signal: AbortSignal): CragPorts {
  return {
    measured: false,
    now: () => Date.now(),
    signal,
    reserve: () => ({ ok: true }),
    retrieve: () => Promise.resolve({ ok: false, reason: "La aclaración no busca." }),
    rankAndAssess: () =>
      Promise.resolve({ ok: false, reason: "La aclaración no evalúa.", providerCall: false }),
    reformulate: () =>
      Promise.resolve({ ok: false, reason: "La aclaración no reformula.", providerCall: false }),
    generate: () =>
      Promise.resolve({ ok: false, reason: "La aclaración no genera.", providerCall: false }),
  };
}

export async function cragHttpResponse(input: {
  env: WorkerEnv;
  assessment: Assessment;
  request: ChatRequest;
  question: string;
  history: readonly { role: "user" | "assistant"; content: string }[];
  signal: AbortSignal;
  deps: CragHttpDeps;
  allowance?: AllowanceLedger;
}): Promise<Response | { status: 409; missing: string[]; message: string }> {
  const clarify = input.request.audience === "program" && isScheduleQuestion(input.question);
  if (input.assessment.execution === "real" && !clarify) {
    const capability = input.assessment.capabilities.crag;
    if (capability.status !== "ready") {
      return {
        status: 409,
        missing: capability.missing,
        message: "CRAG real no está configurado. No se usa la demostración ni RAG básico.",
      };
    }
    const retrieval = input.assessment.retrieval;
    const runner = input.env.AI as EmbeddingRunner | undefined;
    const index = input.env.VECTORIZE as VectorIndex | undefined;
    const database = input.env.DB as SqlDatabase | undefined;
    if (
      !runner ||
      !index ||
      !database ||
      retrieval === null ||
      input.assessment.generation === null
    ) {
      return {
        status: 409,
        missing: capability.missing,
        message: "Faltan bindings o ajustes de CRAG.",
      };
    }
    if (input.deps.cragPorts === undefined) {
      const row =
        input.deps.profile !== undefined
          ? input.deps.profile
          : await readIndexProfile(database, retrieval.indexProfile, retrieval.corpusVersion);
      const gate = profileReady(row, retrieval);
      if (!gate.ok) {
        return {
          status: 409,
          missing: gate.missing,
          message: "El índice configurado no está listo o no coincide con el perfil.",
        };
      }
    }
  }

  const demo = input.assessment.execution !== "real";
  const scenarioId = demo ? resolveDemoScenario(input.request.demoScenario, input.question) : null;
  const retrieval = input.assessment.retrieval;
  const scope = {
    runId: crypto.randomUUID(),
    audience: input.request.audience,
    corpusVersion: demo
      ? fixtureCorpusVersion()
      : (retrieval?.corpusVersion ?? fixtureCorpusVersion()),
    profileId: demo ? fixtureProfile().id : (retrieval?.indexProfile ?? fixtureProfile().id),
    embeddingLabel: demo
      ? "fixture-token-hash-v1"
      : (retrieval?.embeddingModel ?? "sin configurar"),
  };
  const ports =
    input.deps.cragPorts ??
    (demo
      ? createDemoCragPorts({ signal: input.signal, scenarioId })
      : clarify
        ? inertPorts(input.signal)
        : createRealCragPorts({
            signal: input.signal,
            scope,
            embedder: input.env.AI as EmbeddingRunner,
            index: input.env.VECTORIZE as VectorIndex,
            database: input.env.DB as SqlDatabase,
            evaluator: createEvaluatorModel(
              {
                apiKey: input.assessment.generation?.apiKey ?? "",
                modelId: input.assessment.generation?.modelId ?? "",
                evaluatorModelId: input.env.EVALUATOR_MODEL_ID?.trim() ?? "",
              },
              input.deps.onProviderCall,
            ),
            generator: createGenerationModel(
              {
                apiKey: input.assessment.generation?.apiKey ?? "",
                modelId: input.assessment.generation?.modelId ?? "",
              },
              input.deps.onProviderCall,
            ),
            messages: input.history,
            embeddingModel: retrieval?.embeddingModel ?? "",
            dimensions: retrieval?.dimensions ?? 0,
            allowance: input.allowance,
          }));

  const metadata: RunMetadata = {
    runId: scope.runId,
    origin: demo ? "offline-fixture" : "pipeline",
    modelId: demo ? null : (input.assessment.generation?.modelId ?? null),
    promptId: CRAG_PROMPT.id,
    completion: "streaming",
    usage: null,
    cost: null,
  };

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: metadata });
      const result = await runCragTurn({
        question: input.question,
        scope,
        ports,
        fixture: demo,
        scenarioId,
        onStep: (step: CragStep) => {
          writer.write({ type: "data-step", data: step, transient: true });
        },
      });
      const summary = cragSummarySchema.parse(result.summary);
      writer.write({ type: "data-crag", id: "crag", data: summary });
      const sources =
        result.terminal === "answer"
          ? citationsFor(
              result.evidence.map((chunk): IndexedChunk => ({
                ...chunk,
                vector: [],
              })),
            )
          : [];
      for (const source of sources) {
        writer.write({ type: "data-source", id: source.chunkId, data: source });
      }
      const allowed = new Set(sources.map((source) => source.chunkId));
      const text =
        result.terminal === "answer"
          ? suppressUnknownCitations(result.answerText, allowed)
          : result.answerText;
      writer.write({ type: "text-start", id: "answer" });
      const size = 160;
      for (let index = 0; index < text.length; index += size) {
        writer.write({ type: "text-delta", id: "answer", delta: text.slice(index, index + size) });
      }
      writer.write({ type: "text-end", id: "answer" });
      const completion = completionFor(
        result.terminal === "answer"
          ? "complete"
          : result.terminal === "refuse"
            ? "refused"
            : result.terminal === "clarify"
              ? "clarified"
              : result.terminal === "aborted"
                ? "aborted"
                : "error",
      );
      writer.write({
        type: "finish",
        messageMetadata: {
          ...metadata,
          origin: demo
            ? "offline-fixture"
            : summary.calls.generation.providerCalls
              ? "provider"
              : "pipeline",
          completion,
          usage: summary.usage,
          cost: summary.cost,
        },
      });
    },
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": demo ? "offline-fixture" : "pipeline",
    },
  });
}
