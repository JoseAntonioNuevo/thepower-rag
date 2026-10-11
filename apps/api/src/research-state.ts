import {
  RESEARCH_LIMITS,
  researchStepSchema,
  type Audience,
  type ResearchNode,
  type ResearchOutcome,
  type ResearchScenarioId,
  type ResearchStep,
  type ResearchStop,
} from "@thepower-rag/contracts";
import {
  callTimeoutMs,
  remainingMs,
  type AcceptedEvidence,
  type Consumption,
  type Counters,
  type CoverageEntry,
  type EvidenceItem,
  type GapCause,
  type PortResult,
  type RejectedEvidence,
  type ResearchPlan,
  type ResearchPorts,
} from "@thepower-rag/research";
import { Annotation } from "@langchain/langgraph";

export type CallStatus = "ok" | "error" | "timeout" | "late" | "skipped";

/** Señal de control del ejecutor durable. No es un fallo de informe. */
export class ResearchControlError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export class ResearchAttention extends ResearchControlError {
  constructor(readonly operationId: string) {
    super("ResearchAttention", "research-attention");
  }
}

export class ResearchStepCrash extends ResearchControlError {
  constructor() {
    super("ResearchStepCrash", "research-step-crash");
  }
}

/** LangGraph puede envolver la señal. Se recorre la causa sin perder el tipo. */
export function controlError(error: unknown): ResearchControlError | null {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof ResearchControlError) {
      return current;
    }
    if (!(current instanceof Error)) {
      return null;
    }
    current = current.cause;
  }
  return null;
}

export interface CourseQueryLog {
  round: number;
  subquestionId: string;
  query: string;
  status: CallStatus;
  sourceIds: string[];
}

export interface ToolCallLog {
  round: number;
  name: "get_course_session";
  args: { sessionId: string; audience: Audience };
  status: "ok" | "rejected" | "error";
  detail: string;
  sourceIds: string[];
}

export interface SearchLog {
  round: number;
  subquestionId: string;
  query: string;
  status: CallStatus;
  resultCount: number;
  detail: string;
}

export interface DiscoveredLog {
  round: number;
  subquestionId: string;
  url: string;
  title: string;
  domain: string;
  decision: "candidate" | "selected" | "not-allowed" | "duplicate" | "already-read" | "over-budget";
}

export interface ReadLog {
  round: number;
  subquestionId: string;
  url: string;
  finalUrl: string | null;
  sourceId: string | null;
  status: "ok" | "error" | "timeout" | "late" | "rejected";
  detail: string;
  chars: number;
  contentHash: string | null;
  instructionsFlagged: boolean;
}

export interface Ledger {
  reportedUsd: number | null;
  reportedCredits: number | null;
  /** USD calculado con tarifas. Ausente en checkpoints anteriores a esta distinción. */
  estimatedUsd?: number | null;
  estimateProvenance?: string | null;
  estimateIncomplete?: boolean;
  unknownCalls: number;
  /** Observación reportada sin USD. Los créditos no son una conversión. */
  unpricedCalls: number;
  finalAnswerUsd: number | null;
}

export interface PendingQuery {
  subquestionId: string;
  query: string;
}

/** Estado serializable del grafo: sin funciones ni mapas, apto para un checkpointer. */
export interface ResearchState {
  runId: string;
  question: string;
  originalQuestion: string;
  threadId: string | null;
  jobId: string | null;
  audience: Audience;
  corpusVersion: string;
  scenarioId: ResearchScenarioId | null;
  startedAt: number;
  round: number;
  researchPlan: ResearchPlan | null;
  counters: Counters;
  courseQueries: CourseQueryLog[];
  toolCalls: ToolCallLog[];
  searches: SearchLog[];
  discovered: DiscoveredLog[];
  pagesRead: ReadLog[];
  pendingCourse: PendingQuery[];
  pendingSearch: PendingQuery[];
  seenQueries: string[];
  candidates: EvidenceItem[];
  accepted: AcceptedEvidence[];
  rejected: RejectedEvidence[];
  coverage: CoverageEntry[];
  causes: Record<string, GapCause>;
  contradictions: string[];
  followUp: { reason: string; queries: PendingQuery[] } | null;
  eligible: string[];
  newAccepted: number;
  draft: unknown;
  stop: ResearchStop | null;
  stopDetail: string;
  outcome: ResearchOutcome | null;
  reportText: string;
  citedSourceIds: string[];
  claimChecked: number;
  claimDropped: { claim: string; reason: string }[];
  ledger: Ledger;
  trace: ResearchStep[];
}

function last<T>() {
  return Annotation<T>({ reducer: (_left: T, right: T) => right, default: () => undefined as T });
}

export const ResearchGraphState = Annotation.Root({
  runId: last<string>(),
  question: last<string>(),
  originalQuestion: last<string>(),
  threadId: last<string | null>(),
  jobId: last<string | null>(),
  audience: last<Audience>(),
  corpusVersion: last<string>(),
  scenarioId: last<ResearchScenarioId | null>(),
  startedAt: last<number>(),
  round: last<number>(),
  researchPlan: last<ResearchPlan | null>(),
  counters: last<Counters>(),
  courseQueries: last<CourseQueryLog[]>(),
  toolCalls: last<ToolCallLog[]>(),
  searches: last<SearchLog[]>(),
  discovered: last<DiscoveredLog[]>(),
  pagesRead: last<ReadLog[]>(),
  pendingCourse: last<PendingQuery[]>(),
  pendingSearch: last<PendingQuery[]>(),
  seenQueries: last<string[]>(),
  candidates: last<EvidenceItem[]>(),
  accepted: last<AcceptedEvidence[]>(),
  rejected: last<RejectedEvidence[]>(),
  coverage: last<CoverageEntry[]>(),
  causes: last<Record<string, GapCause>>(),
  contradictions: last<string[]>(),
  followUp: last<{ reason: string; queries: PendingQuery[] } | null>(),
  eligible: last<string[]>(),
  newAccepted: last<number>(),
  draft: last<unknown>(),
  stop: last<ResearchStop | null>(),
  stopDetail: last<string>(),
  outcome: last<ResearchOutcome | null>(),
  reportText: last<string>(),
  citedSourceIds: last<string[]>(),
  claimChecked: last<number>(),
  claimDropped: last<{ claim: string; reason: string }[]>(),
  ledger: last<Ledger>(),
  trace: last<ResearchStep[]>(),
});

export function emptyLedger(): Ledger {
  return {
    reportedUsd: null,
    reportedCredits: null,
    estimatedUsd: null,
    estimateProvenance: null,
    estimateIncomplete: false,
    unknownCalls: 0,
    unpricedCalls: 0,
    finalAnswerUsd: null,
  };
}

function finiteAmount(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function addConsumption(ledger: Ledger, consumption: Consumption): Ledger {
  if (consumption.kind === "none") {
    return ledger;
  }
  if (consumption.kind === "unknown") {
    return { ...ledger, unknownCalls: ledger.unknownCalls + 1 };
  }
  if (consumption.kind === "estimated") {
    const usd = finiteAmount(consumption.usd) ? consumption.usd : null;
    const incomplete = consumption.complete !== true || usd === null;
    return {
      ...ledger,
      estimatedUsd: usd === null ? (ledger.estimatedUsd ?? null) : (ledger.estimatedUsd ?? 0) + usd,
      estimateProvenance: consumption.provenance || ledger.estimateProvenance || null,
      estimateIncomplete: ledger.estimateIncomplete === true || incomplete,
      unknownCalls: ledger.unknownCalls + 1,
      unpricedCalls: incomplete ? ledger.unpricedCalls + 1 : ledger.unpricedCalls,
    };
  }
  const usd = finiteAmount(consumption.usd) ? consumption.usd : null;
  const credits = finiteAmount(consumption.credits) ? consumption.credits : null;
  return {
    ...ledger,
    reportedUsd: usd === null ? ledger.reportedUsd : (ledger.reportedUsd ?? 0) + usd,
    reportedCredits:
      credits === null ? ledger.reportedCredits : (ledger.reportedCredits ?? 0) + credits,
    unknownCalls: usd === null && credits === null ? ledger.unknownCalls + 1 : ledger.unknownCalls,
    unpricedCalls: usd === null ? ledger.unpricedCalls + 1 : ledger.unpricedCalls,
  };
}

/** Añade un paso a la traza acotada y lo emite. El paso final siempre cabe. */
export function traced(
  state: ResearchState,
  emit: (step: ResearchStep) => void,
  node: ResearchNode,
  status: string,
  round = state.round,
): ResearchStep[] {
  const step = researchStepSchema.parse({
    runId: state.runId,
    node,
    round: Math.min(Math.max(0, round), RESEARCH_LIMITS.maxRounds),
    status: status.slice(0, RESEARCH_LIMITS.maxReasonChars),
  });
  emit(step);
  const room = RESEARCH_LIMITS.maxTraceEntries - (node === "finish" ? 0 : 1);
  return state.trace.length >= room ? state.trace : [...state.trace, step];
}

export type Guarded<T> =
  | PortResult<T>
  | { ok: false; error: "late" | "deadline"; detail: string; consumption: Consumption };

/**
 * Ejecuta una llamada de puerto con el plazo restante, nunca con un plazo nuevo.
 * La cancelación de la petición gana la carrera aunque el adaptador ignore la
 * señal. Parar la espera local no cancela un cargo remoto ya enviado: si el
 * consumo no se llegó a observar, queda desconocido. No reintenta.
 */
export async function guardedCall<T>(
  ports: ResearchPorts,
  startedAt: number,
  capMs: number,
  run: (context: { signal: AbortSignal; timeoutMs: number }) => Promise<PortResult<T>>,
): Promise<Guarded<T>> {
  const timeoutMs = callTimeoutMs(capMs, remainingMs(startedAt, ports.now()));
  if (ports.signal.aborted) {
    return {
      ok: false,
      error: "aborted",
      detail: "La petición se ha detenido.",
      consumption: { kind: "none" },
    };
  }
  if (timeoutMs === 0) {
    return {
      ok: false,
      error: "deadline",
      detail: "No queda plazo para empezar esta llamada.",
      consumption: { kind: "none" },
    };
  }
  const controller = new AbortController();
  const sent: Consumption = ports.measured ? { kind: "unknown" } : { kind: "none" };
  const stopped = (): PortResult<T> => ({
    ok: false,
    error: "aborted",
    detail:
      "La petición se detuvo durante la llamada. La espera local termina; un cargo ya enviado puede seguir siendo desconocido.",
    consumption: sent,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const pending = run({ signal: controller.signal, timeoutMs });
  const settled = pending.then(
    (value): PortResult<T> => value,
    (error: unknown): PortResult<T> => {
      if (error instanceof ResearchControlError) {
        throw error;
      }
      return {
        ok: false,
        error: controller.signal.aborted || ports.signal.aborted ? "aborted" : "provider",
        detail: "La llamada lanzó una excepción.",
        consumption: sent,
      };
    },
  );
  try {
    const result = await new Promise<PortResult<T>>((resolve, reject) => {
      let done = false;
      const finish = (value: PortResult<T>) => {
        if (done) {
          return;
        }
        done = true;
        resolve(value);
      };
      const fail = (error: unknown) => {
        if (done) {
          return;
        }
        done = true;
        reject(error);
      };
      onAbort = () => {
        controller.abort();
        finish(stopped());
      };
      if (ports.signal.aborted) {
        controller.abort();
        finish(stopped());
        return;
      }
      ports.signal.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => {
        controller.abort();
        finish({
          ok: false,
          error: "timeout",
          detail: "La llamada superó su plazo.",
          consumption: sent,
        });
      }, timeoutMs);
      void settled.then(
        (value) => {
          if (ports.signal.aborted) {
            finish(stopped());
            return;
          }
          finish(value);
        },
        (error: unknown) => {
          fail(error);
        },
      );
    });
    if (result.ok && ports.signal.aborted) {
      return stopped();
    }
    if (result.ok && remainingMs(startedAt, ports.now()) === 0) {
      return {
        ok: false,
        error: "late",
        detail: "El resultado llegó fuera del plazo total y no se acepta.",
        consumption: result.consumption,
      };
    }
    return result;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    if (onAbort !== undefined) {
      ports.signal.removeEventListener("abort", onAbort);
    }
  }
}

export function statusOf(result: Guarded<unknown>): CallStatus {
  if (result.ok) {
    return "ok";
  }
  if (result.error === "timeout") {
    return "timeout";
  }
  if (result.error === "late") {
    return "late";
  }
  if (result.error === "deadline") {
    return "skipped";
  }
  return "error";
}
