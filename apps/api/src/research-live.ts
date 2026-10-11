import type { Audience } from "@thepower-rag/contracts";
import type { ResearchPorts } from "@thepower-rag/research";
import { assessWorker, researchSettings, type WorkerEnv } from "./env";
import { createGenerationModel } from "./model";
import { createRealResearchPorts } from "./research-real";
import { modelOutputCap, parsePriceSnapshot } from "./research-money";
import type { JobRow } from "./research-store";
import type { SqlDatabase, VectorIndex } from "./stores";
import type { EmbeddingRunner } from "./vectors";

/**
 * Puertos de pago. Solo se construyen si la capacidad real está lista.
 * Construirlos no llama a la red. Si falta algo, no hay caída a los guiones.
 */
export function liveResearchPorts(
  env: WorkerEnv,
  signal: AbortSignal,
  job: JobRow,
  priceSearchProvider: "firecrawl" | "tavily",
): ResearchPorts {
  const assessment = assessWorker(env);
  const settings = researchSettings(env);
  const embedder = env.AI;
  const index = env.VECTORIZE;
  const database = env.DB;
  if (
    assessment.capabilities.research.status !== "ready" ||
    assessment.generation === null ||
    assessment.retrieval === null ||
    !settings.ok ||
    embedder === undefined ||
    typeof embedder !== "object" ||
    embedder === null ||
    !("run" in embedder) ||
    index === undefined ||
    database === undefined
  ) {
    throw new Error("research-not-ready");
  }
  const model = createGenerationModel({
    apiKey: assessment.generation.apiKey,
    modelId: settings.settings.plannerModelId,
    ...(assessment.generation.workspaceId
      ? { workspaceId: assessment.generation.workspaceId }
      : {}),
  });
  const prices = parsePriceSnapshot(job.price_json);
  const outputCap =
    prices &&
    modelOutputCap(
      prices,
      settings.settings.inputUsdPerMillion,
      settings.settings.outputUsdPerMillion,
    );
  if (!outputCap) throw new Error("research-model-reservation-incompatible");
  return createRealResearchPorts({
    signal,
    audience: job.audience as Audience,
    corpusVersion: assessment.retrieval.corpusVersion,
    settings: settings.settings,
    retrieval: assessment.retrieval,
    planner: model,
    generator: model,
    embedder: embedder as EmbeddingRunner,
    index: index as VectorIndex,
    database: database as SqlDatabase,
    priceSearchProvider,
    modelOutputTokenCap: outputCap,
  });
}
