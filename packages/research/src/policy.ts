import { RESEARCH_LIMITS, type ResearchStop } from "@thepower-rag/contracts";
import type { CoverageEntry } from "./evidence";
import type { PlanItem } from "./plan";

export type GapCause = "evidence" | "missing-evidence" | "operational-failure" | "not-allowed";

/** Tiempo mínimo que tiene que quedar para abrir otra ronda completa. */
export const FOLLOW_UP_MIN_MS = 40_000;

/** Llamadas de modelo que necesita otra ronda: seguimiento, evaluación y síntesis. */
const FOLLOW_UP_MODEL_CALLS = 3;

export interface Counters {
  searchCalls: number;
  pagesRead: number;
  modelCalls: number;
  toolCalls: number;
  courseQueries: number;
}

export function emptyCounters(): Counters {
  return { searchCalls: 0, pagesRead: 0, modelCalls: 0, toolCalls: 0, courseQueries: 0 };
}

export function searchesLeft(counters: Counters): number {
  return Math.max(0, RESEARCH_LIMITS.maxSearchCalls - counters.searchCalls);
}

export function pagesLeft(counters: Counters): number {
  return Math.max(0, RESEARCH_LIMITS.maxPagesRead - counters.pagesRead);
}

export function remainingMs(startedAt: number, now: number): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt) {
    return 0;
  }
  return Math.max(0, RESEARCH_LIMITS.deadlineMs - (now - startedAt));
}

/** Plazo de una llamada: su tope, acotado por lo que queda del plazo total. */
export function callTimeoutMs(capMs: number, remaining: number): number {
  if (!Number.isFinite(remaining) || remaining < RESEARCH_LIMITS.minCallMs) {
    return 0;
  }
  return Math.min(capMs, Math.floor(remaining));
}

export interface AttemptLog {
  searches: readonly { subquestionId: string; status: string }[];
  reads: readonly { subquestionId: string; status: string }[];
  course: readonly { subquestionId: string; status: string }[];
  tools: readonly { status: string }[];
}

/**
 * Distingue un fallo operativo de la falta de evidencia. Si todas las búsquedas
 * o todas las lecturas de una subpregunta fallaron, la laguna es operativa.
 */
export function attributeCause(
  sub: PlanItem,
  status: CoverageEntry["status"],
  log: AttemptLog,
): GapCause {
  if (status === "covered") {
    return "evidence";
  }
  const failed = (value: string) => value === "error" || value === "timeout" || value === "late";
  if (sub.kind === "session" && log.tools.some((item) => failed(item.status))) {
    return "operational-failure";
  }
  const course = log.course.filter((item) => item.subquestionId === sub.id);
  if (!sub.external) {
    return course.length > 0 && course.every((item) => failed(item.status))
      ? "operational-failure"
      : "missing-evidence";
  }
  const searches = log.searches.filter((item) => item.subquestionId === sub.id);
  const reads = log.reads.filter((item) => item.subquestionId === sub.id);
  if (searches.length > 0 && searches.every((item) => failed(item.status))) {
    return "operational-failure";
  }
  if (reads.length > 0 && reads.every((item) => failed(item.status))) {
    return "operational-failure";
  }
  return "missing-evidence";
}

export type NextStep =
  | { kind: "follow-up"; eligible: string[]; reason: string }
  | { kind: "stop"; stop: ResearchStop; detail: string };

/**
 * Política de parada de la investigación. Una ronda de seguimiento exige una
 * laguna concreta, posibilidad de progreso y margen en todos los límites.
 */
function contradictionStop(detail: string): NextStep {
  return {
    kind: "stop",
    stop: "unresolved-contradiction",
    detail: detail.slice(0, 240) || "Hay una contradicción sin resolver.",
  };
}

/** Una contradicción con todo cubierto no cierra el informe. El seguimiento usa la ronda ya prevista. */
function contradictionStep(input: {
  round: number;
  subquestions: readonly PlanItem[];
  counters: Counters;
  remaining: number;
  contradictions: readonly string[];
}): NextStep {
  const detail = input.contradictions[0] ?? "Hay una contradicción sin resolver.";
  const room =
    input.round < RESEARCH_LIMITS.maxRounds &&
    input.counters.modelCalls + FOLLOW_UP_MODEL_CALLS <= RESEARCH_LIMITS.maxModelCalls &&
    input.remaining >= FOLLOW_UP_MIN_MS;
  const external = input.subquestions.some((sub) => sub.external);
  const canSearch =
    !external || (searchesLeft(input.counters) > 0 && pagesLeft(input.counters) > 0);
  if (!room || !canSearch) {
    return contradictionStop(detail);
  }
  return {
    kind: "follow-up",
    eligible: input.subquestions.map((sub) => sub.id),
    reason: `Contradicción sin resolver: ${detail}`,
  };
}

export function decideNext(input: {
  round: number;
  subquestions: readonly PlanItem[];
  coverage: readonly CoverageEntry[];
  causes: Readonly<Record<string, GapCause>>;
  counters: Counters;
  remaining: number;
  newAccepted: number;
  contradictions: readonly string[];
}): NextStep {
  const open = input.coverage.filter((entry) => entry.status !== "covered");
  const contradicted = input.contradictions.length > 0;
  if (open.length === 0 && !contradicted) {
    return {
      kind: "stop",
      stop: "all-covered",
      detail: "Todas las subpreguntas tienen evidencia.",
    };
  }
  if (open.length === 0 && contradicted) {
    return contradictionStep(input);
  }
  if (input.round > 1 && input.newAccepted === 0) {
    return {
      kind: "stop",
      stop: "no-progress",
      detail: "La ronda de seguimiento no añadió evidencia nueva.",
    };
  }
  if (input.round >= RESEARCH_LIMITS.maxRounds) {
    return {
      kind: "stop",
      stop: "max-rounds",
      detail: `Se alcanzó el máximo de ${String(RESEARCH_LIMITS.maxRounds)} rondas.`,
    };
  }
  if (input.counters.modelCalls + FOLLOW_UP_MODEL_CALLS > RESEARCH_LIMITS.maxModelCalls) {
    return {
      kind: "stop",
      stop: "max-rounds",
      detail: "No quedan llamadas de modelo para otra ronda.",
    };
  }
  if (input.remaining < FOLLOW_UP_MIN_MS) {
    return { kind: "stop", stop: "deadline", detail: "No queda tiempo para otra ronda." };
  }
  const byId = new Map<string, PlanItem>(input.subquestions.map((item) => [item.id, item]));
  const eligible: string[] = [];
  let blockedBySearch = false;
  let blockedByPages = false;
  let operational = false;
  for (const entry of open) {
    const sub = byId.get(entry.subquestionId as PlanItem["id"]);
    if (sub === undefined) {
      continue;
    }
    const cause = input.causes[sub.id] ?? "missing-evidence";
    if (cause === "operational-failure") {
      operational = true;
      continue;
    }
    if (!entry.followUp || cause !== "missing-evidence") {
      continue;
    }
    if (sub.external) {
      if (searchesLeft(input.counters) === 0) {
        blockedBySearch = true;
        continue;
      }
      if (pagesLeft(input.counters) === 0) {
        blockedByPages = true;
        continue;
      }
    } else if (input.counters.courseQueries >= RESEARCH_LIMITS.maxCourseQueries) {
      continue;
    }
    eligible.push(sub.id);
  }
  if (eligible.length > 0) {
    return {
      kind: "follow-up",
      eligible,
      reason: contradicted
        ? `Laguna concreta en ${eligible.join(", ")}. También hay una contradicción sin resolver.`
        : `Laguna concreta en ${eligible.join(", ")} y margen en los límites.`,
    };
  }
  if (operational) {
    return {
      kind: "stop",
      stop: "provider-failure",
      detail: "Las lagunas restantes vienen de un fallo operativo. No se reintenta.",
    };
  }
  if (blockedBySearch) {
    return { kind: "stop", stop: "search-budget", detail: "No quedan búsquedas externas." };
  }
  if (blockedByPages) {
    return { kind: "stop", stop: "page-budget", detail: "No quedan lecturas de páginas." };
  }
  return {
    kind: "stop",
    stop: "no-specific-gap",
    detail: "Las lagunas restantes no tienen una búsqueda concreta que pueda cerrarlas.",
  };
}
