import type { ResearchScenarioId } from "@thepower-rag/contracts";
import type { Consumption, PortResult, ResearchPorts } from "@thepower-rag/research";
import type { ResearchDatabase } from "./research-db";
import {
  beginOperation,
  completeOperation,
  holdDispatched,
  markDispatched,
  releaseReservedOperations,
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
    detail?: { durationMs?: number; speechChars?: number },
  ): Promise<PortResult<T>> => {
    const digest = await fingerprint(kind, payload);
    const reservation = reservationFor(kind, prices, detail);
    if (reservation === null) {
      throw new ResearchAttention(`${kind}:sin-tarifa`);
    }
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

/**
 * Misma regla del diario para visión, transcripción y voz.
 * La espera local termina por cancelación o por el plazo que queda, aunque el
 * adaptador ignore la señal. Parar esa espera no demuestra que el proveedor
 * haya cancelado el cargo: lo ya enviado queda desconocido y no se publica
 * como éxito. Un resultado tardío no completa la operación.
 */
export async function journalMediaCall<T>(
  database: ResearchDatabase,
  job: JobRow,
  prices: PriceSnapshot,
  input: {
    kind: "vision" | "transcribe" | "speech";
    payload: unknown;
    durationMs?: number;
    speechChars?: number;
    signal: AbortSignal;
    invoke: (signal: AbortSignal) => Promise<PortResult<T>>;
  },
): Promise<PortResult<T>> {
  const digest = await fingerprint(input.kind, input.payload);
  const reservation = reservationFor(input.kind, prices, {
    durationMs: input.durationMs,
    speechChars: input.speechChars,
  });
  if (reservation === null) {
    throw new ResearchAttention(`${input.kind}:sin-tarifa`);
  }
  const operation = await beginOperation(database, {
    jobId: job.id,
    kind: input.kind,
    fingerprint: digest,
    reservation,
    fence: job.lease_token,
  });
  if (operation.state === "completed" && operation.result_json) {
    return JSON.parse(operation.result_json) as PortResult<T>;
  }
  if (
    operation.state === "released" ||
    operation.state === "unknown" ||
    operation.state === "dispatched"
  ) {
    throw new ResearchAttention(operation.id);
  }
  if (job.cancel_requested === 1 || input.signal.aborted || Date.now() >= job.deadline_at) {
    await releaseReservedOperations(database, job.id, operation.fence);
    throw new ResearchAttention(operation.id);
  }
  const dispatched = await markDispatched(database, operation.id, operation.fence);
  if (!dispatched) {
    throw new ResearchAttention(operation.id);
  }
  const child = new AbortController();
  const pending = input.invoke(child.signal).then(
    (value) => value,
    (): PortResult<T> => ({
      ok: false,
      error: "provider",
      detail:
        "La llamada de medios falló después de enviarse. La espera local no libera ese cargo.",
      consumption: { kind: "unknown" },
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const outcome = await new Promise<"stop" | PortResult<T>>((resolve) => {
    let settled = false;
    const halt = () => {
      if (settled) return;
      settled = true;
      child.abort();
      resolve("stop");
    };
    const remaining = Math.max(0, job.deadline_at - Date.now());
    timer = setTimeout(halt, remaining);
    onAbort = halt;
    if (input.signal.aborted) {
      halt();
      return;
    }
    input.signal.addEventListener("abort", halt, { once: true });
    void pending.then((value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    });
  }).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
    if (onAbort !== undefined) input.signal.removeEventListener("abort", onAbort);
  });
  const late = outcome === "stop" || input.signal.aborted || Date.now() > job.deadline_at;
  if (late) {
    child.abort();
    await holdDispatched(database, operation.id, operation.fence);
    throw new ResearchAttention(operation.id);
  }
  if (!outcome.ok && (outcome.error === "aborted" || outcome.error === "timeout")) {
    await holdDispatched(database, operation.id, operation.fence);
    throw new ResearchAttention(operation.id);
  }
  const stored = await completeOperation(database, {
    operationId: operation.id,
    fence: operation.fence,
    resultJson: JSON.stringify(outcome),
    consumption: outcome.consumption,
    reservation,
  });
  if (!stored) {
    await holdDispatched(database, operation.id, operation.fence);
    throw new ResearchAttention(operation.id);
  }
  return outcome;
}

export function consumptionUnknown(consumption: Consumption): boolean {
  if (consumption.kind === "unknown" || consumption.kind === "estimated") {
    return true;
  }
  return consumption.kind === "reported" && consumption.usd === null;
}
