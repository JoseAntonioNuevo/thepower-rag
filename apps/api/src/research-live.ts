// GUÍA DE LECTURA · apps/api/src/research-live.ts
// Construye los puertos reales de una investigación (modelo, corpus, herramienta, buscador y lector)
// solo si la capacidad está lista y la reserva del trabajo es compatible. No llama a la red.
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Tipo de los puertos.
import type { ResearchPorts } from "@thepower-rag/research";
// Diagnóstico del entorno y ajustes de la investigación.
import { assessWorker, researchSettings, type WorkerEnv } from "./env";
// Fábrica del modelo del proveedor elegido.
import { createGenerationModel } from "./model";
// Puertos reales.
import { createRealResearchPorts } from "./research-real";
// Tope de salida según la reserva guardada.
import { modelOutputCap, parsePriceSnapshot } from "./research-money";
// Tipo de un trabajo.
import type { JobRow } from "./research-store";
// Tipos de D1 y Vectorize.
import type { SqlDatabase, VectorIndex } from "./stores";
// Tipo del ejecutor de embeddings.
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
  // Diagnóstico del entorno.
  const assessment = assessWorker(env);
  // Ajustes de la investigación.
  const settings = researchSettings(env);
  // Binding de Workers AI.
  const embedder = env.AI;
  // Binding de Vectorize.
  const index = env.VECTORIZE;
  // Binding de D1.
  const database = env.DB;
  // Todo tiene que estar listo; si no, error sin caer a los guiones.
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
    // Error controlado.
    throw new Error("research-not-ready");
  }
  // Mismo proveedor y clave que el chat; la investigación solo cambia a RESEARCH_MODEL_ID.
  const model = createGenerationModel({
    ...assessment.generation,
    modelId: settings.settings.plannerModelId,
  });
  // Precios guardados al crear el trabajo.
  const prices = parsePriceSnapshot(job.price_json);
  // Tope de tokens de salida compatible con la reserva.
  const outputCap =
    prices &&
    modelOutputCap(
      prices,
      settings.settings.inputUsdPerMillion,
      settings.settings.outputUsdPerMillion,
    );
  // Si las tarifas actuales no encajan con la reserva, no se sigue.
  if (!outputCap) throw new Error("research-model-reservation-incompatible");
  // Puertos reales con el modelo de investigación.
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
