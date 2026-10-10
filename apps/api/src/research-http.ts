import {
  researchSummarySchema,
  type ChatRequest,
  type ResearchOutcome,
  type ResearchStep,
  type RunMetadata,
} from "@thepower-rag/contracts";
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { PUBLIC_PROVIDER_MESSAGE } from "./course-stream";
import type { Assessment } from "./env";
import { fixtureCorpusVersion } from "./fixture";
import { createFixtureResearchPorts, resolveResearchScenario } from "./research-fixture";
import { runResearchGraph } from "./research-graph";
import { RESEARCH_PROMPT_ID } from "./research-prompts";
import { citedSources, researchSummary } from "./research-summary";

export interface ResearchHttpDeps {
  /** Solo para pruebas: puertos inyectados con red simulada. */
  researchPorts?: ResearchPorts;
}

function completionFor(outcome: ResearchOutcome): RunMetadata["completion"] {
  switch (outcome) {
    case "complete":
      return "complete";
    case "partial":
      return "partial";
    case "refused":
      return "refused";
    case "clarify":
      return "clarified";
    case "aborted":
      return "aborted";
    default:
      return "error";
  }
}

/**
 * Etapa de investigación en primer plano: el grafo corre mientras la petición
 * sigue conectada. No es un trabajo durable ni usa waitUntil. Sin la petición
 * no hay ejecución en segundo plano.
 */
export async function researchHttpResponse(input: {
  assessment: Assessment;
  request: ChatRequest;
  question: string;
  signal: AbortSignal;
  deps: ResearchHttpDeps;
}): Promise<Response | { status: 409; missing: string[]; message: string }> {
  const real = input.assessment.execution === "real";
  if (real && input.deps.researchPorts === undefined) {
    const capability = input.assessment.capabilities.research;
    if (capability.status !== "ready") {
      return {
        status: 409,
        missing: capability.missing,
        message:
          "La investigación real está bloqueada: necesita su propia autorización de gasto y una contabilidad durable del coste total. No se usan los adaptadores de prueba.",
      };
    }
  }
  const scenarioId = real
    ? null
    : resolveResearchScenario(input.request.researchScenario, input.question);
  const corpusVersion = real
    ? (input.assessment.retrieval?.corpusVersion ?? fixtureCorpusVersion())
    : fixtureCorpusVersion();
  const ports =
    input.deps.researchPorts ??
    createFixtureResearchPorts({
      signal: input.signal,
      scenarioId,
      audience: input.request.audience,
      corpusVersion,
    });
  const request: ResearchRequest = {
    runId: crypto.randomUUID(),
    threadId: null,
    question: input.question,
    observations: [{ kind: "text", text: input.question }],
    audience: input.request.audience,
    corpusVersion,
    scenarioId,
  };
  const metadata: RunMetadata = {
    runId: request.runId,
    origin: ports.fixture ? "offline-fixture" : "pipeline",
    modelId: null,
    promptId: RESEARCH_PROMPT_ID,
    completion: "streaming",
    usage: null,
    cost: null,
  };
  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: metadata });
      const state = await runResearchGraph(request, ports, (step: ResearchStep) => {
        writer.write({ type: "data-research-step", data: step, transient: true });
      });
      const summary = researchSummarySchema.parse(researchSummary(state, ports));
      writer.write({ type: "data-research", id: "research", data: summary });
      for (const source of citedSources(state)) {
        writer.write({ type: "data-research-source", id: source.sourceId, data: source });
      }
      const text = state.reportText;
      writer.write({ type: "text-start", id: "report" });
      for (let index = 0; index < text.length; index += 160) {
        writer.write({ type: "text-delta", id: "report", delta: text.slice(index, index + 160) });
      }
      writer.write({ type: "text-end", id: "report" });
      writer.write({
        type: "finish",
        messageMetadata: { ...metadata, completion: completionFor(summary.outcome) },
      });
    },
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": ports.fixture ? "offline-fixture" : "pipeline",
    },
  });
}
