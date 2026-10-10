import type { ResearchScenarioId } from "@thepower-rag/contracts";
import type { Consumption, PortResult, ResearchPorts } from "@thepower-rag/research";
import type { ResearchDatabase } from "./research-db";
import {
  beginOperation,
  completeOperation,
  holdDispatched,
  markDispatched,
  type JobRow,
} from "./research-store";
import { reservationFor, type PriceSnapshot } from "./research-money";
import { ResearchAttention, ResearchStepCrash } from "./research-state";

async function fingerprint(kind: string, payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}:${JSON.stringify(payload)}`),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Envuelve los puertos del grafo con el diario. Una operación completada se
 * reutiliza. Una operación enviada sin resultado no se reenvía.
 */
export function journalPorts(
  database: ResearchDatabase,
  job: JobRow,
  prices: PriceSnapshot,
  inner: ResearchPorts,
  scenario: ResearchScenarioId | null,
): ResearchPorts {
  const call = async <T>(
    kind: string,
    payload: unknown,
    invoke: () => Promise<PortResult<T>>,
  ): Promise<PortResult<T>> => {
    const digest = await fingerprint(kind, payload);
    const reservation = reservationFor(kind, prices);
    const operation = await beginOperation(database, {
      jobId: job.id,
      kind,
      fingerprint: digest,
      reservation,
      fence: job.lease_token,
    });
    if (operation.state === "completed" && operation.result_json) {
      return JSON.parse(operation.result_json) as PortResult<T>;
    }
    if (operation.state === "released") {
      throw new ResearchAttention(operation.id);
    }
    if (job.cancel_requested === 1 || inner.signal.aborted) {
      throw new ResearchAttention(operation.id);
    }
    if (Date.now() > job.deadline_at) {
      throw new ResearchAttention(operation.id);
    }
    const dispatched = await markDispatched(database, operation.id, operation.fence);
    if (!dispatched) {
      throw new ResearchAttention(operation.id);
    }
    if (scenario === "ambiguous-operation" && kind === "plan") {
      await invoke();
      throw new ResearchStepCrash();
    }
    const result = await invoke();
    if (inner.signal.aborted || (!result.ok && result.error === "aborted")) {
      await holdDispatched(database, operation.id, operation.fence);
      throw new ResearchAttention(operation.id);
    }
    const stored = await completeOperation(database, {
      operationId: operation.id,
      fence: operation.fence,
      resultJson: JSON.stringify(result),
      consumption: result.consumption,
      reservation,
    });
    if (!stored) {
      throw new ResearchAttention(operation.id);
    }
    return result;
  };
  return {
    ...inner,
    estimatedMaxUsd: prices.holdMicros / 1_000_000,
    model: {
      plan: (input, context) => call("plan", input, () => inner.model.plan(input, context)),
      assess: (input, context) => call("assess", input, () => inner.model.assess(input, context)),
      followUp: (input, context) =>
        call("follow-up", input, () => inner.model.followUp(input, context)),
      synthesize: (input, context) =>
        call("synthesize", input, () => inner.model.synthesize(input, context)),
    },
    course: {
      retrieve: (input, context) =>
        call("course", input, () => inner.course.retrieve(input, context)),
    },
    tool: {
      getCourseSession: (args, context) =>
        call("tool", args, () => inner.tool.getCourseSession(args, context)),
    },
    search: {
      search: (input, context) => call("search", input, () => inner.search.search(input, context)),
    },
    reader: {
      read: (input, context) => call("read", input, () => inner.reader.read(input, context)),
    },
  };
}

export function consumptionUnknown(consumption: Consumption): boolean {
  if (consumption.kind === "unknown") {
    return true;
  }
  return consumption.kind === "reported" && consumption.usd === null;
}
