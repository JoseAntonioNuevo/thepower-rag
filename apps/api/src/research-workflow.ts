import { MEDIA_LIMITS, llmProvider, visionModelAccepted } from "@thepower-rag/contracts";
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { assessWorker, tokenPrices, type WorkerEnv } from "./env";
import { asMediaBucket } from "./research-media";
import { createGenerationModel } from "./model";
import { asResearchDatabase, ensureResearchSchema } from "./research-db";
import { createFixtureResearchPorts } from "./research-fixture";
import { liveResearchPorts } from "./research-live";
import { priceSnapshot, searchProviderForSnapshot } from "./research-money";
import type { WorkersAi } from "./research-perception";
import { runResearchTick } from "./research-runner";

interface Payload {
  jobId: string;
  ownerId: string;
}

const STEP = {
  retries: { limit: 0, delay: "1 second" },
  timeout: "2 minutes",
} as const;

/**
 * Ejecutor durable. Cada paso reanuda el grafo de LangGraph; el flujo no
 * planifica ni evalúa por su cuenta. Los reintentos del paso están en cero.
 */
export class ResearchJobWorkflow extends WorkflowEntrypoint<WorkerEnv, Payload> {
  async run(event: Readonly<WorkflowEvent<Payload>>, step: WorkflowStep): Promise<unknown> {
    const database = asResearchDatabase(this.env.RESEARCH_DB);
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
    if (!database || !prices) {
      return { done: true, status: "failed" };
    }
    await step.do("schema", STEP, async () => {
      await ensureResearchSchema(database, prices.budgetMicros);
      return { ready: true };
    });
    for (let tick = 0; tick < 4; tick += 1) {
      const outcome = await step.do(`tick-${String(tick)}`, STEP, async () =>
        runResearchTick(
          database,
          event.payload.jobId,
          event.payload.ownerId,
          (signal, job, jobPrices) => {
            if (this.env.APP_MODE === "real") {
              return liveResearchPorts(this.env, signal, job, searchProviderForSnapshot(jobPrices));
            }
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
      if (outcome.done) {
        return outcome;
      }
    }
    return { done: true, status: "attention" };
  }
}

function mediaContext(env: WorkerEnv) {
  const assessment = assessWorker(env);
  const visionId = env.RESEARCH_VISION_MODEL_ID?.trim() || env.RESEARCH_MODEL_ID?.trim() || "";
  const provider = llmProvider(env.LLM_PROVIDER);
  const accepted = provider !== null && visionModelAccepted(provider, visionId);
  // Mismo proveedor y clave que el chat; la visión solo cambia de modelo.
  const vision =
    env.APP_MODE === "real" && assessment.generation && accepted
      ? createGenerationModel({ ...assessment.generation, modelId: visionId })
      : null;
  const ai = env.AI;
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
