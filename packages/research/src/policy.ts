// GUÍA DE LECTURA · packages/research/src/policy.ts
// Política de la investigación: contadores, plazos, causa de cada laguna y decisión de abrir otra
// ronda o parar. Una ronda de seguimiento exige una laguna concreta y margen en todos los límites.
// Límites y motivos de parada.
import { RESEARCH_LIMITS, type ResearchStop } from "@thepower-rag/contracts";
// Tipo de una entrada de cobertura.
import type { CoverageEntry } from "./evidence";
// Tipo de una subpregunta del plan.
import type { PlanItem } from "./plan";

// Causa de una laguna: hay evidencia, falta evidencia, falló un servicio o no está permitido.
export type GapCause = "evidence" | "missing-evidence" | "operational-failure" | "not-allowed";

/** Tiempo mínimo que tiene que quedar para abrir otra ronda completa. */
export const FOLLOW_UP_MIN_MS = 40_000;

/** Llamadas de modelo que necesita otra ronda: seguimiento, evaluación y síntesis. */
const FOLLOW_UP_MODEL_CALLS = 3;

// Contadores de uso de una investigación.
export interface Counters {
  // Búsquedas externas hechas.
  searchCalls: number;
  // Páginas leídas.
  pagesRead: number;
  // Llamadas al modelo.
  modelCalls: number;
  // Llamadas a la herramienta de sesiones.
  toolCalls: number;
  // Consultas al corpus del curso.
  courseQueries: number;
}

// Contadores a cero.
export function emptyCounters(): Counters {
  // Todo empieza en cero.
  return { searchCalls: 0, pagesRead: 0, modelCalls: 0, toolCalls: 0, courseQueries: 0 };
}

// Búsquedas que quedan.
export function searchesLeft(counters: Counters): number {
  // Tope menos las hechas, nunca negativo.
  return Math.max(0, RESEARCH_LIMITS.maxSearchCalls - counters.searchCalls);
}

// Lecturas que quedan.
export function pagesLeft(counters: Counters): number {
  // Tope menos las hechas, nunca negativo.
  return Math.max(0, RESEARCH_LIMITS.maxPagesRead - counters.pagesRead);
}

// Milisegundos que quedan del plazo total.
export function remainingMs(startedAt: number, now: number): number {
  // Relojes inválidos: no queda tiempo.
  if (!Number.isFinite(startedAt) || !Number.isFinite(now) || now < startedAt) {
    // Cero.
    return 0;
  }
  // Plazo menos lo transcurrido.
  return Math.max(0, RESEARCH_LIMITS.deadlineMs - (now - startedAt));
}

/** Plazo de una llamada: su tope, acotado por lo que queda del plazo total. */
export function callTimeoutMs(capMs: number, remaining: number): number {
  // Si queda menos del mínimo, no se empieza otra llamada.
  if (!Number.isFinite(remaining) || remaining < RESEARCH_LIMITS.minCallMs) {
    // Plazo cero.
    return 0;
  }
  // El menor entre el tope de la llamada y lo que queda.
  return Math.min(capMs, Math.floor(remaining));
}

// Registro de intentos por subpregunta.
export interface AttemptLog {
  // Búsquedas y su estado.
  searches: readonly { subquestionId: string; status: string }[];
  // Lecturas y su estado.
  reads: readonly { subquestionId: string; status: string }[];
  // Consultas al curso y su estado.
  course: readonly { subquestionId: string; status: string }[];
  // Llamadas a la herramienta y su estado.
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
  // Cubierta: la causa es la evidencia.
  if (status === "covered") {
    // Evidencia.
    return "evidence";
  }
  // ¿Cuenta un estado como fallo operativo?
  const failed = (value: string) => value === "error" || value === "timeout" || value === "late";
  // Pregunta de sesión con la herramienta fallida: fallo operativo.
  if (sub.kind === "session" && log.tools.some((item) => failed(item.status))) {
    // Fallo operativo.
    return "operational-failure";
  }
  // Consultas al curso de esta subpregunta.
  const course = log.course.filter((item) => item.subquestionId === sub.id);
  // Subpregunta del curso (no externa).
  if (!sub.external) {
    // Si todas las consultas fallaron, fallo operativo; si no, falta evidencia.
    return course.length > 0 && course.every((item) => failed(item.status))
      ? "operational-failure"
      : "missing-evidence";
  }
  // Búsquedas de esta subpregunta.
  const searches = log.searches.filter((item) => item.subquestionId === sub.id);
  // Lecturas de esta subpregunta.
  const reads = log.reads.filter((item) => item.subquestionId === sub.id);
  // Todas las búsquedas fallaron.
  if (searches.length > 0 && searches.every((item) => failed(item.status))) {
    // Fallo operativo.
    return "operational-failure";
  }
  // Todas las lecturas fallaron.
  if (reads.length > 0 && reads.every((item) => failed(item.status))) {
    // Fallo operativo.
    return "operational-failure";
  }
  // Lo demás: falta evidencia.
  return "missing-evidence";
}

// Siguiente paso: otra ronda con las subpreguntas elegibles, o parar con su motivo.
export type NextStep =
  | { kind: "follow-up"; eligible: string[]; reason: string }
  | { kind: "stop"; stop: ResearchStop; detail: string };

/**
 * Política de parada de la investigación. Una ronda de seguimiento exige una
 * laguna concreta, posibilidad de progreso y margen en todos los límites.
 */
function contradictionStop(detail: string): NextStep {
  // Parada por contradicción, con el detalle recortado.
  return {
    kind: "stop",
    stop: "unresolved-contradiction",
    detail: detail.slice(0, 240) || "Hay una contradicción sin resolver.",
  };
}

/** Una contradicción con todo cubierto no cierra el informe. El seguimiento usa la ronda ya prevista. */
function contradictionStep(input: {
  // Ronda actual.
  round: number;
  // Subpreguntas del plan.
  subquestions: readonly PlanItem[];
  // Contadores.
  counters: Counters;
  // Tiempo restante.
  remaining: number;
  // Contradicciones detectadas.
  contradictions: readonly string[];
}): NextStep {
  // Primera contradicción.
  const detail = input.contradictions[0] ?? "Hay una contradicción sin resolver.";
  // ¿Hay margen de rondas, llamadas y tiempo para otra ronda?
  const room =
    input.round < RESEARCH_LIMITS.maxRounds &&
    input.counters.modelCalls + FOLLOW_UP_MODEL_CALLS <= RESEARCH_LIMITS.maxModelCalls &&
    input.remaining >= FOLLOW_UP_MIN_MS;
  // ¿Hay subpreguntas externas?
  const external = input.subquestions.some((sub) => sub.external);
  // Si las hay, hacen falta búsquedas y lecturas.
  const canSearch =
    !external || (searchesLeft(input.counters) > 0 && pagesLeft(input.counters) > 0);
  // Sin margen, se para por la contradicción.
  if (!room || !canSearch) {
    // Parada.
    return contradictionStop(detail);
  }
  // Con margen, otra ronda con todas las subpreguntas.
  return {
    kind: "follow-up",
    eligible: input.subquestions.map((sub) => sub.id),
    reason: `Contradicción sin resolver: ${detail}`,
  };
}

// Decide si se abre otra ronda o se para, y por qué.
export function decideNext(input: {
  // Ronda actual.
  round: number;
  // Subpreguntas del plan.
  subquestions: readonly PlanItem[];
  // Cobertura de cada subpregunta.
  coverage: readonly CoverageEntry[];
  // Causa de cada laguna.
  causes: Readonly<Record<string, GapCause>>;
  // Contadores.
  counters: Counters;
  // Tiempo restante.
  remaining: number;
  // Evidencias nuevas aceptadas en esta ronda.
  newAccepted: number;
  // Contradicciones.
  contradictions: readonly string[];
}): NextStep {
  // Subpreguntas sin cubrir.
  const open = input.coverage.filter((entry) => entry.status !== "covered");
  // ¿Hay contradicciones?
  const contradicted = input.contradictions.length > 0;
  // Todo cubierto y sin contradicciones: parar.
  if (open.length === 0 && !contradicted) {
    // Parada con éxito.
    return {
      kind: "stop",
      stop: "all-covered",
      detail: "Todas las subpreguntas tienen evidencia.",
    };
  }
  // Todo cubierto pero contradictorio.
  if (open.length === 0 && contradicted) {
    // Decide según el margen.
    return contradictionStep(input);
  }
  // Una ronda de seguimiento sin evidencia nueva: parar.
  if (input.round > 1 && input.newAccepted === 0) {
    // Sin progreso.
    return {
      kind: "stop",
      stop: "no-progress",
      detail: "La ronda de seguimiento no añadió evidencia nueva.",
    };
  }
  // Máximo de rondas alcanzado.
  if (input.round >= RESEARCH_LIMITS.maxRounds) {
    // Parada.
    return {
      kind: "stop",
      stop: "max-rounds",
      detail: `Se alcanzó el máximo de ${String(RESEARCH_LIMITS.maxRounds)} rondas.`,
    };
  }
  // No quedan llamadas al modelo para otra ronda.
  if (input.counters.modelCalls + FOLLOW_UP_MODEL_CALLS > RESEARCH_LIMITS.maxModelCalls) {
    // Parada.
    return {
      kind: "stop",
      stop: "max-rounds",
      detail: "No quedan llamadas de modelo para otra ronda.",
    };
  }
  // No queda tiempo suficiente.
  if (input.remaining < FOLLOW_UP_MIN_MS) {
    // Parada por plazo.
    return { kind: "stop", stop: "deadline", detail: "No queda tiempo para otra ronda." };
  }
  // Subpreguntas por id.
  const byId = new Map<string, PlanItem>(input.subquestions.map((item) => [item.id, item]));
  // Subpreguntas elegibles para seguimiento.
  const eligible: string[] = [];
  // Bloqueada por falta de búsquedas.
  let blockedBySearch = false;
  // Bloqueada por falta de lecturas.
  let blockedByPages = false;
  // Alguna laguna es operativa.
  let operational = false;
  // Revisa cada subpregunta abierta.
  for (const entry of open) {
    // Subpregunta de la entrada.
    const sub = byId.get(entry.subquestionId as PlanItem["id"]);
    // Desconocida: se salta.
    if (sub === undefined) {
      // Siguiente.
      continue;
    }
    // Causa de la laguna.
    const cause = input.causes[sub.id] ?? "missing-evidence";
    // Fallo operativo: no se reintenta.
    if (cause === "operational-failure") {
      // Se recuerda.
      operational = true;
      // Siguiente.
      continue;
    }
    // Sin laguna concreta o por otra causa: no es elegible.
    if (!entry.followUp || cause !== "missing-evidence") {
      // Siguiente.
      continue;
    }
    // Subpregunta externa.
    if (sub.external) {
      // Sin búsquedas.
      if (searchesLeft(input.counters) === 0) {
        // Bloqueada.
        blockedBySearch = true;
        // Siguiente.
        continue;
      }
      // Sin lecturas.
      if (pagesLeft(input.counters) === 0) {
        // Bloqueada.
        blockedByPages = true;
        // Siguiente.
        continue;
      }
    } else if (input.counters.courseQueries >= RESEARCH_LIMITS.maxCourseQueries) {
      // Del curso sin consultas disponibles: no es elegible.
      continue;
    }
    // Elegible.
    eligible.push(sub.id);
  }
  // Hay elegibles: otra ronda.
  if (eligible.length > 0) {
    // Seguimiento con su motivo.
    return {
      kind: "follow-up",
      eligible,
      reason: contradicted
        ? `Laguna concreta en ${eligible.join(", ")}. También hay una contradicción sin resolver.`
        : `Laguna concreta en ${eligible.join(", ")} y margen en los límites.`,
    };
  }
  // Solo quedaban fallos operativos.
  if (operational) {
    // Parada sin reintentar.
    return {
      kind: "stop",
      stop: "provider-failure",
      detail: "Las lagunas restantes vienen de un fallo operativo. No se reintenta.",
    };
  }
  // Faltaron búsquedas.
  if (blockedBySearch) {
    // Parada.
    return { kind: "stop", stop: "search-budget", detail: "No quedan búsquedas externas." };
  }
  // Faltaron lecturas.
  if (blockedByPages) {
    // Parada.
    return { kind: "stop", stop: "page-budget", detail: "No quedan lecturas de páginas." };
  }
  // Lagunas sin búsqueda concreta.
  return {
    kind: "stop",
    stop: "no-specific-gap",
    detail: "Las lagunas restantes no tienen una búsqueda concreta que pueda cerrarlas.",
  };
}
