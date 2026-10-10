import {
  researchSummarySchema,
  type ResearchOutcome,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
import { checkpointConfig, checkpointThread, D1CheckpointSaver } from "./research-checkpointer";
import type { ResearchDatabase } from "./research-db";
import { createFixtureResearchPorts } from "./research-fixture";
import { journalPorts } from "./research-journal";
import { runResearchGraph } from "./research-graph";
import { parsePriceSnapshot } from "./research-money";
import {
  appendEvent,
  claimJob,
  finishJob,
  getJob,
  listOperations,
  markAttention,
  markCrashConsumed,
  promoteDispatched,
  recordAssistantMessage,
  releaseReservedOperations,
  setProgress,
  type JobRow,
} from "./research-store";
import { buildStoredResult } from "./research-result";
import { citedSources, researchSummary } from "./research-summary";
import { controlError, ResearchAttention, ResearchStepCrash } from "./research-state";

export interface TickResult {
  done: boolean;
  status: JobRow["execution_status"] | "missing";
}

const EXECUTOR = "research-workflow";
const LEASE_MS = 180_000;

function scenarioOf(job: JobRow): ResearchScenarioId | null {
  return job.scenario_id;
}

/**
 * Un paso del mismo grafo. El flujo de trabajo solo llama a esta función:
 * no reimplementa la investigación.
 */
export async function runResearchTick(
  database: ResearchDatabase,
  jobId: string,
  ownerId: string,
  createPorts: (signal: AbortSignal, job: JobRow) => ResearchPorts = (signal, job) =>
    createFixtureResearchPorts({
      signal,
      scenarioId: scenarioOf(job),
      audience: job.audience,
      corpusVersion: job.corpus_version,
    }),
): Promise<TickResult> {
  const promoted = await promoteDispatched(database, ownerId, jobId);
  if (promoted > 0) {
    return { done: true, status: "attention" };
  }
  const job = await getJob(database, ownerId, jobId);
  if (job === null) {
    return { done: true, status: "missing" };
  }
  if (job.execution_status === "attention") {
    return { done: true, status: "attention" };
  }
  if (
    job.execution_status === "complete" ||
    job.execution_status === "cancelled" ||
    job.execution_status === "failed"
  ) {
    return { done: true, status: job.execution_status };
  }
  const prices = parsePriceSnapshot(job.price_json);
  if (prices === null) {
    await markAttention(database, ownerId, jobId, "price-snapshot");
    return { done: true, status: "attention" };
  }
  const claimed = await claimJob(database, ownerId, jobId, EXECUTOR, Date.now(), LEASE_MS);
  if (claimed === null) {
    const latest = await getJob(database, ownerId, jobId);
    return { done: true, status: latest?.execution_status ?? "missing" };
  }
  if (Date.now() > claimed.deadline_at && claimed.started_at === null) {
    return { done: true, status: "cancelled" };
  }
  const controller = new AbortController();
  let watcher: ReturnType<typeof setInterval> | undefined;
  let ports: ReturnType<typeof journalPorts>;
  try {
    ports = journalPorts(
      database,
      claimed,
      prices,
      createPorts(controller.signal, claimed),
      scenarioOf(claimed),
    );
  } catch {
    await markAttention(database, ownerId, jobId, "ports-unavailable");
    return { done: true, status: "attention" };
  }
  watcher = setInterval(() => {
    void getJob(database, ownerId, jobId).then((row) => {
      if (row?.cancel_requested === 1 || (row && Date.now() > row.deadline_at)) {
        controller.abort();
      }
    });
  }, 200);
  const request: ResearchRequest = {
    runId: claimed.run_id,
    threadId: claimed.conversation_id,
    question: claimed.contextualized_question ?? claimed.original_question,
    observations: [{ kind: "text", text: claimed.original_question }],
    audience: claimed.audience,
    corpusVersion: claimed.corpus_version,
    scenarioId: scenarioOf(claimed),
  };
  try {
    const interrupt = claimed.scenario_id === "crash-after-plan" && claimed.crash_consumed === 0;
    const state = await runResearchGraph(
      request,
      ports,
      (step) => {
        void setProgress(database, jobId, `${step.node}: ${step.status}`);
        void appendEvent(database, jobId, "step", `${step.node}: ${step.status}`, Date.now());
      },
      {
        startedAt: claimed.created_at,
        checkpointer: new D1CheckpointSaver(database),
        threadId: checkpointThread(jobId),
        interruptBefore: interrupt ? "course" : undefined,
        jobId: claimed.id,
        originalQuestion: claimed.original_question,
      },
    );
    if (interrupt && state.outcome === null) {
      await markCrashConsumed(database, jobId);
      throw new ResearchStepCrash();
    }
    const unresolved = (await listOperations(database, jobId)).some(
      (operation) => operation.state === "dispatched",
    );
    if (unresolved) {
      await promoteDispatched(database, ownerId, jobId);
      await markAttention(database, ownerId, jobId, "reconciliation-required");
      return { done: true, status: "attention" };
    }
    const summary = researchSummarySchema.parse(
      researchSummary({ ...state, jobId: claimed.id, threadId: claimed.conversation_id }, ports),
    );
    const storedResult = await buildStoredResult(database, {
      ownerId,
      jobId,
      summary,
      sources: citedSources(state),
      reportText: state.reportText,
      now: Date.now(),
    });
    if (storedResult === null) {
      await markAttention(database, ownerId, jobId, "report-unbounded");
      return { done: true, status: "attention" };
    }
    const stored = await finishOrAttention(database, {
      ownerId,
      jobId,
      leaseToken: claimed.lease_token,
      now: Date.now(),
      execution: "complete",
      outcome: summary.outcome,
      resultJson: JSON.stringify(storedResult),
    });
    if (stored) {
      await recordAssistantMessage(database, {
        conversationId: claimed.conversation_id,
        ownerId,
        jobId,
        text: state.reportText,
        now: Date.now(),
      });
      await appendEvent(database, jobId, "result", summary.outcome, Date.now());
    }
    const latest = await getJob(database, ownerId, jobId);
    return { done: true, status: latest?.execution_status ?? "complete" };
  } catch (error) {
    const control = controlError(error);
    if (control instanceof ResearchStepCrash || control instanceof ResearchAttention) {
      const operations = await listOperations(database, jobId);
      const ambiguous = operations.some(
        (operation) => operation.state === "dispatched" || operation.state === "unknown",
      );
      if (ambiguous) {
        await promoteDispatched(database, ownerId, jobId);
        await markAttention(database, ownerId, jobId, "reconciliation-required");
      } else if (control instanceof ResearchStepCrash) {
        await markAttention(database, ownerId, jobId, "recoverable");
      } else {
        await markAttention(database, ownerId, jobId, "reconciliation-required");
      }
      return { done: true, status: "attention" };
    }
    const latest = await getJob(database, ownerId, jobId);
    if (latest?.cancel_requested === 1) {
      return { done: true, status: "cancelled" };
    }
    await finishOrAttention(database, {
      ownerId,
      jobId,
      leaseToken: claimed.lease_token,
      now: Date.now(),
      execution: "failed",
      outcome: "error",
      resultJson: null,
    });
    const afterFailure = await getJob(database, ownerId, jobId);
    return { done: true, status: afterFailure?.execution_status ?? "failed" };
  } finally {
    if (watcher !== undefined) {
      clearInterval(watcher);
    }
  }
}

async function finishOrAttention(
  database: ResearchDatabase,
  input: {
    ownerId: string;
    jobId: string;
    leaseToken: number;
    now: number;
    execution: "complete" | "failed";
    outcome: ResearchOutcome | null;
    resultJson: string | null;
  },
): Promise<boolean> {
  await releaseReservedOperations(database, input.jobId, input.leaseToken);
  const promoted = await promoteDispatched(database, input.ownerId, input.jobId);
  const operations = await listOperations(database, input.jobId);
  const ambiguous =
    promoted > 0 ||
    operations.some(
      (operation) => operation.state === "dispatched" || operation.state === "unknown",
    );
  if (ambiguous) {
    await markAttention(database, input.ownerId, input.jobId, "reconciliation-required");
    return false;
  }
  return finishJob(database, input);
}

export function checkpointOf(jobId: string) {
  return checkpointConfig(jobId);
}

export async function operationCount(
  database: ResearchDatabase,
  jobId: string,
  kind: string,
  state?: string,
): Promise<number> {
  const rows = await listOperations(database, jobId);
  return rows.filter((row) => row.kind === kind && (state === undefined || row.state === state))
    .length;
}

export function fixturePorts(signal: AbortSignal, job: JobRow): ResearchPorts {
  return createFixtureResearchPorts({
    signal,
    scenarioId: scenarioOf(job),
    audience: job.audience,
    corpusVersion: job.corpus_version,
  });
}
