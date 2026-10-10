import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import type { WorkerEnv } from "./env";
import { asResearchDatabase, ensureResearchSchema } from "./research-db";
import { createFixtureResearchPorts } from "./research-fixture";
import { liveResearchPorts } from "./research-live";
import { priceSnapshot } from "./research-money";
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
        runResearchTick(database, event.payload.jobId, event.payload.ownerId, (signal, job) => {
          if (this.env.APP_MODE === "real") {
            return liveResearchPorts(this.env, signal, job);
          }
          return createFixtureResearchPorts({
            signal,
            scenarioId: job.scenario_id,
            audience: job.audience,
            corpusVersion: job.corpus_version,
          });
        }),
      );
      if (outcome.done) {
        return outcome;
      }
    }
    return { done: true, status: "attention" };
  }
}
