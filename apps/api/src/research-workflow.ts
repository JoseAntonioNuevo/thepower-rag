// GUÍA DE LECTURA · apps/api/src/research-workflow.ts
// Workflow de Cloudflare que ejecuta una investigación durable: prepara el esquema y avanza el grafo
// en pasos guardados («ticks»), con los puertos reales o los de la demo y el contexto de medios.
// Límites de medios, proveedor y regla del modelo de visión.
import { MEDIA_LIMITS, llmProvider, visionModelAccepted } from "@thepower-rag/contracts";
// Clase base de los Workflows.
import { WorkflowEntrypoint } from "cloudflare:workers";
// Tipos del evento y del paso.
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
// Diagnóstico del entorno y tarifas.
import { assessWorker, tokenPrices, type WorkerEnv } from "./env";
// Bucket de medios.
import { asMediaBucket } from "./research-media";
// Fábrica del modelo.
import { createGenerationModel } from "./model";
// Base de datos de la investigación y su esquema.
import { asResearchDatabase, ensureResearchSchema } from "./research-db";
// Puertos de la demo.
import { createFixtureResearchPorts } from "./research-fixture";
// Puertos reales.
import { liveResearchPorts } from "./research-live";
// Precios guardados con el trabajo.
import { priceSnapshot, searchProviderForSnapshot } from "./research-money";
// Tipo de Workers AI.
import type { WorkersAi } from "./research-perception";
// Un paso del grafo.
import { runResearchTick } from "./research-runner";

// Datos con los que se lanza el Workflow.
interface Payload {
  // Trabajo que se ejecuta.
  jobId: string;
  // Dueño del trabajo.
  ownerId: string;
}

// Configuración de cada paso: sin reintentos y 2 minutos como máximo.
const STEP = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "2 minutes",
} as const;

/**
 * Ejecutor durable. Cada paso reanuda el grafo de LangGraph; el flujo no
 * planifica ni evalúa por su cuenta. Los reintentos del paso están en cero.
 */
export class ResearchJobWorkflow extends WorkflowEntrypoint<WorkerEnv, Payload> {
  // Ejecución del Workflow.
  async run(event: Readonly<WorkflowEvent<Payload>>, step: WorkflowStep): Promise<unknown> {
    // Base de datos de la investigación.
    const database = asResearchDatabase(this.env.RESEARCH_DB);
    // Precios y presupuesto de la investigación.
    const prices = priceSnapshot({
      budgetUsd: this.env.RESEARCH_BUDGET_USD ?? this.env.RESEARCH_FIXTURE_BUDGET_USD ?? "",
      jobLimitUsd: this.env.RESEARCH_JOB_LIMIT_USD ?? this.env.RESEARCH_FIXTURE_JOB_LIMIT_USD ?? "",
      inputUsdPerMillion: this.env.RESEARCH_INPUT_USD_PER_MILLION ?? "",
      outputUsdPerMillion: this.env.RESEARCH_OUTPUT_USD_PER_MILLION ?? "",
      searchUsd: this.env.RESEARCH_SEARCH_USD,
      readUsd: this.env.RESEARCH_READ_USD,
      firecrawlUsdPerCredit: this.env.FIRECRAWL_USD_PER_CREDIT,
      searchProvider: this.env.RESEARCH_SEARCH_PROVIDER === "tavily" ? "tavily" : "firecrawl",
      tavilyUsdPerCredit: this.env.TAVILY_USD_PER_CREDIT,
    });
    // Sin base de datos o precios no se puede seguir.
    if (!database || !prices) {
      // Termina con fallo.
      return { done: true, status: "failed" };
    }
    // Paso durable: crea las tablas si faltan.
    await step.do("schema", STEP, async () => {
      // Esquema con el presupuesto.
      await ensureResearchSchema(database, prices.budgetMicros);
      // Resultado del paso.
      return { ready: true };
    });
    // Hasta cuatro pasos del grafo.
    for (let tick = 0; tick < 4; tick += 1) {
      // Cada paso queda guardado; al reanudar no se repite.
      const outcome = await step.do(`tick-${String(tick)}`, STEP, async () =>
        runResearchTick(
          database,
          event.payload.jobId,
          event.payload.ownerId,
          (signal, job, jobPrices) => {
            // En modo real, puertos reales.
            if (this.env.APP_MODE === "real") {
              // Puertos reales con el proveedor de búsqueda de la reserva.
              return liveResearchPorts(this.env, signal, job, searchProviderForSnapshot(jobPrices));
            }
            // En demo, puertos con guiones.
            return createFixtureResearchPorts({
              signal,
              scenarioId: job.scenario_id,
              audience: job.audience,
              corpusVersion: job.corpus_version,
            });
          },
          mediaContext(this.env),
        ),
      );
      // El trabajo terminó.
      if (outcome.done) {
        // Fin.
        return outcome;
      }
    }
    // Tras cuatro pasos sin terminar, necesita atención.
    return { done: true, status: "attention" };
  }
}

// Contexto de medios: bucket, Workers AI, modelo de visión y tarifas.
function mediaContext(env: WorkerEnv) {
  // Diagnóstico del entorno.
  const assessment = assessWorker(env);
  // Modelo de visión: el específico o el de la investigación.
  const visionId = env.RESEARCH_VISION_MODEL_ID?.trim() || env.RESEARCH_MODEL_ID?.trim() || "";
  // Proveedor elegido.
  const provider = llmProvider(env.LLM_PROVIDER);
  // ¿Se admite ese modelo de visión con ese proveedor?
  const accepted = provider !== null && visionModelAccepted(provider, visionId);
  // Mismo proveedor y clave que el chat; la visión solo cambia de modelo.
  const vision =
    env.APP_MODE === "real" && assessment.generation && accepted
      ? createGenerationModel({ ...assessment.generation, modelId: visionId })
      : null;
  // Binding de Workers AI.
  const ai = env.AI;
  // Contexto completo.
  return {
    mode: env.APP_MODE === "real" ? ("real" as const) : ("demo" as const),
    bucket: asMediaBucket(env.RESEARCH_MEDIA),
    ai: typeof ai === "object" && ai !== null && "run" in ai ? (ai as WorkersAi) : null,
    vision,
    visionModelId: accepted ? visionId : null,
    // La visión se reserva con la tarifa de la investigación; su consumo usa la misma.
    visionPrices: tokenPrices(
      env.RESEARCH_INPUT_USD_PER_MILLION,
      env.RESEARCH_OUTPUT_USD_PER_MILLION,
    ),
    sttModelId: env.RESEARCH_STT_MODEL_ID?.trim() || MEDIA_LIMITS.sttModelId,
    ttsModelId: env.RESEARCH_TTS_MODEL_ID?.trim() || MEDIA_LIMITS.ttsModelId,
  };
}
