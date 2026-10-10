import { RESEARCH_LIMITS, type ResearchStep } from "@thepower-rag/contracts";
import { isScheduleQuestion } from "@thepower-rag/core";
import {
  attributeCause,
  buildShown,
  carryCoverage,
  decideNext,
  dedupeEvidence,
  emptyCounters,
  reconcileCoverage,
  remainingMs,
  validateAssessment,
  validateFollowUp,
  validatePlan,
  verifyReport,
  type AcceptedEvidence,
  type GapCause,
  type ModelSubquestion,
  type PlanItem,
  type ResearchPorts,
  type ResearchRequest,
} from "@thepower-rag/research";
import { END, START, StateGraph } from "@langchain/langgraph";
import {
  courseNode,
  halt,
  readNode,
  searchNode,
  selectNode,
  toolNode,
  type NodeDeps,
} from "./research-gather";
import {
  addConsumption,
  emptyLedger,
  guardedCall,
  ResearchGraphState,
  traced,
  type ResearchState,
} from "./research-state";

export const RESEARCH_CLARIFY =
  "La pregunta parece de calendario. Elige el grupo con clases los lunes y miércoles o el grupo con clases los martes y jueves. La investigación no consulta los dos calendarios.";

function modelSubquestions(items: readonly PlanItem[]): ModelSubquestion[] {
  return items.map((item) => ({
    id: item.id,
    text: item.text,
    kind: item.kind,
    external: item.external,
  }));
}

function causesFor(
  state: ResearchState,
  coverage: ResearchState["coverage"],
): Record<string, GapCause> {
  const causes: Record<string, GapCause> = {};
  for (const sub of state.researchPlan?.subquestions ?? []) {
    const entry = coverage.find((item) => item.subquestionId === sub.id);
    causes[sub.id] = attributeCause(sub, entry?.status ?? "uncovered", {
      searches: state.searches,
      reads: state.pagesRead,
      course: state.courseQueries,
      tools: state.toolCalls,
    });
  }
  return causes;
}

function supported(state: ResearchState): boolean {
  return state.coverage.some((entry) => entry.status !== "uncovered" && entry.sourceIds.length > 0);
}

function failureOutcome(error: string): "aborted" | "error" {
  return error === "aborted" ? "aborted" : "error";
}

function validateNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  const stop = halt(state, deps, "validate");
  if (stop) {
    return stop;
  }
  if (state.audience === "program" && isScheduleQuestion(state.question)) {
    return {
      outcome: "clarify",
      stop: "clarify",
      stopDetail: "Falta el grupo para un dato de calendario.",
      reportText: RESEARCH_CLARIFY,
      trace: traced(state, deps.emit, "validate", "Falta el grupo. No hay plan ni búsquedas."),
    };
  }
  return {
    trace: traced(state, deps.emit, "validate", "Pregunta válida para el grupo seleccionado."),
  };
}

async function planNode(state: ResearchState, deps: NodeDeps): Promise<Partial<ResearchState>> {
  const stop = halt(state, deps, "plan");
  if (stop) {
    return stop;
  }
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.planMs,
    (context) =>
      deps.ports.model.plan({ question: state.question, audience: state.audience }, context),
  );
  const ledger = addConsumption(state.ledger, result.consumption);
  if (!result.ok) {
    return {
      counters,
      ledger,
      outcome: failureOutcome(result.error),
      stop: result.error === "aborted" ? "aborted" : "model-failure",
      stopDetail: "El planificador no completó el plan. No se reintenta.",
      trace: traced(state, deps.emit, "plan", `El planificador falló: ${result.detail}`),
    };
  }
  const plan = validatePlan(result.value, state.audience);
  if (!plan.ok) {
    return {
      counters,
      ledger,
      outcome: "error",
      stop: "invalid-output",
      stopDetail: plan.reason,
      trace: traced(state, deps.emit, "plan", `Plan rechazado: ${plan.reason}`),
    };
  }
  if (plan.value.route === "clarify") {
    return {
      counters,
      ledger,
      researchPlan: plan.value,
      outcome: "clarify",
      stop: "clarify",
      stopDetail: plan.value.clarification ?? "Hace falta aclarar la pregunta.",
      reportText:
        `Necesito una aclaración antes de investigar. ${plan.value.clarification ?? ""}`.trim(),
      trace: traced(state, deps.emit, "plan", "El plan pide una aclaración. No hay búsquedas."),
    };
  }
  const subs = plan.value.subquestions;
  const external = subs.filter((item) => item.external).length;
  return {
    counters,
    ledger,
    researchPlan: plan.value,
    round: 1,
    pendingCourse: subs
      .filter((item) => item.kind !== "session")
      .map((item) => ({ subquestionId: item.id, query: item.text })),
    pendingSearch: subs
      .filter((item) => item.external && item.query !== null)
      .map((item) => ({ subquestionId: item.id, query: item.query ?? item.text })),
    candidates: [],
    trace: traced(
      { ...state, round: 1 },
      deps.emit,
      "plan",
      `Ruta ${plan.value.route}: ${String(subs.length)} subpreguntas, ${String(external)} con fuentes externas${plan.value.tool ? ", herramienta de sesión" : ""}.`,
    ),
  };
}

async function assessNode(state: ResearchState, deps: NodeDeps): Promise<Partial<ResearchState>> {
  const subs = state.researchPlan?.subquestions ?? [];
  if (state.candidates.length === 0) {
    const coverage = carryCoverage(state.coverage, subs, state.accepted);
    return {
      coverage,
      causes: causesFor(state, coverage),
      newAccepted: 0,
      trace: traced(state, deps.emit, "assess", "Sin evidencia nueva. No se llama al evaluador."),
    };
  }
  const stop = halt(state, deps, "assess");
  if (stop) {
    return stop;
  }
  const pool = dedupeEvidence([
    ...state.accepted.map((entry) => entry.item),
    ...state.candidates,
  ]).slice(0, RESEARCH_LIMITS.maxEvidenceItems);
  const shown = buildShown(pool);
  const items = pool.slice(0, shown.length);
  const shownIds = new Set(shown.map((item) => item.sourceId));
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.assessMs,
    (context) =>
      deps.ports.model.assess(
        {
          question: state.question,
          subquestions: modelSubquestions(subs),
          evidence: shown,
          priorCoverage: state.coverage.map((entry) => ({
            subquestionId: entry.subquestionId,
            status: entry.status,
            gap: entry.gap,
          })),
          round: state.round,
        },
        context,
      ),
  );
  const ledger = addConsumption(state.ledger, result.consumption);
  if (!result.ok) {
    return {
      counters,
      ledger,
      outcome: failureOutcome(result.error),
      stop: result.error === "aborted" ? "aborted" : "model-failure",
      stopDetail: "El evaluador de evidencia falló. No se reintenta ni se cambia de etapa.",
      trace: traced(state, deps.emit, "assess", `El evaluador falló: ${result.detail}`),
    };
  }
  const parsed = validateAssessment(result.value, {
    shown,
    items,
    subquestions: subs,
    prior: state.accepted.filter((entry) => !shownIds.has(entry.item.sourceId)),
    round: state.round,
  });
  if (!parsed.ok) {
    return {
      counters,
      ledger,
      outcome: "error",
      stop: "invalid-output",
      stopDetail: parsed.reason,
      trace: traced(state, deps.emit, "assess", `Evaluación rechazada: ${parsed.reason}`),
    };
  }
  const priorIds = new Set(state.accepted.map((entry) => entry.item.sourceId));
  const kept = state.accepted.filter((entry) => !shownIds.has(entry.item.sourceId));
  const renewed = parsed.value.accepted.filter((entry) => priorIds.has(entry.item.sourceId));
  const fresh = parsed.value.accepted.filter((entry) => !priorIds.has(entry.item.sourceId));
  const room = RESEARCH_LIMITS.maxEvidenceItems - kept.length - renewed.length;
  const admitted = fresh.slice(0, Math.max(0, room));
  const overflow = fresh.slice(admitted.length).map((entry) => ({
    sourceId: entry.item.sourceId,
    kind: entry.item.kind,
    round: state.round,
    reason: "Tope de evidencia admitida alcanzado.",
  }));
  const accepted: AcceptedEvidence[] = [...kept, ...renewed, ...admitted];
  const rejected = [...state.rejected, ...parsed.value.rejected, ...overflow].slice(
    0,
    RESEARCH_LIMITS.maxEvidenceItems * 2,
  );
  const coverage = reconcileCoverage(
    parsed.value.coverage,
    state.coverage,
    accepted,
    subs,
    shownIds,
  );
  const covered = coverage.filter((entry) => entry.status === "covered").length;
  return {
    counters,
    ledger,
    accepted,
    rejected,
    coverage,
    causes: causesFor({ ...state, accepted }, coverage),
    contradictions: parsed.value.contradictions,
    newAccepted: admitted.length,
    candidates: [],
    trace: traced(
      state,
      deps.emit,
      "assess",
      `Ronda ${String(state.round)}: ${String(admitted.length)} aceptadas, ${String(parsed.value.rejected.length + overflow.length)} descartadas, ${String(covered)} de ${String(subs.length)} subpreguntas cubiertas${parsed.value.authorityRejections > 0 ? `; ${String(parsed.value.authorityRejections)} asignaciones externas a hechos internos retiradas` : ""}.`,
    ),
  };
}

function decideNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  const next = decideNext({
    round: state.round,
    subquestions: state.researchPlan?.subquestions ?? [],
    coverage: state.coverage,
    causes: state.causes,
    counters: state.counters,
    remaining: remainingMs(state.startedAt, deps.ports.now()),
    newAccepted: state.newAccepted,
    contradictions: state.contradictions,
  });
  if (next.kind === "follow-up") {
    return {
      eligible: next.eligible,
      trace: traced(state, deps.emit, "decide", `Seguimiento justificado. ${next.reason}`),
    };
  }
  const internal = state.researchPlan?.route === "course" || state.researchPlan?.route === "tool";
  const stop = next.stop === "all-covered" && internal ? "course-answer" : next.stop;
  const update: Partial<ResearchState> = {
    eligible: [],
    stop,
    stopDetail: next.detail,
    trace: traced(state, deps.emit, "decide", `Parada: ${stop}. ${next.detail}`),
  };
  if (!supported(state)) {
    const toolFailed = state.toolCalls.some((item) => item.status === "error");
    update.outcome = stop === "provider-failure" ? "error" : "refused";
    update.reportText =
      stop === "provider-failure"
        ? toolFailed
          ? "No se pudo leer el catálogo: la herramienta falló. Es un fallo operativo, no una falta de evidencia, y no se reintenta automáticamente."
          : "La investigación no pudo comprobar las fuentes por un fallo operativo. No es una falta de evidencia y no se reintenta automáticamente."
        : "No hay evidencia admitida para responder. No consta en el material del curso consultado ni en las páginas leídas.";
  }
  return update;
}

async function followUpNode(state: ResearchState, deps: NodeDeps): Promise<Partial<ResearchState>> {
  const stop = halt(state, deps, "follow-up");
  if (stop) {
    return stop;
  }
  const subs = state.researchPlan?.subquestions ?? [];
  const gaps = state.eligible.flatMap((id) => {
    const sub = subs.find((item) => item.id === id);
    const entry = state.coverage.find((item) => item.subquestionId === id);
    const contradiction = state.contradictions[0] ?? "";
    return sub === undefined
      ? []
      : [
          {
            subquestionId: id,
            text: sub.text,
            gap:
              entry?.gap ||
              contradiction ||
              "Contradicción sin resolver entre las fuentes admitidas.",
            external: sub.external,
          },
        ];
  });
  const previousQueries = [...state.seenQueries, ...state.courseQueries.map((item) => item.query)];
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.followUpMs,
    (context) =>
      deps.ports.model.followUp({ question: state.question, gaps, previousQueries }, context),
  );
  const ledger = addConsumption(state.ledger, result.consumption);
  const stopHere = (
    stopReason: "model-failure" | "invalid-output" | "repeated-queries" | "aborted",
    detail: string,
  ): Partial<ResearchState> => ({
    counters,
    ledger,
    stop: stopReason,
    stopDetail: detail,
    ...(stopReason === "aborted"
      ? { outcome: "aborted" as const }
      : supported(state)
        ? {}
        : { outcome: "refused" as const, reportText: "No hay evidencia admitida para responder." }),
    trace: traced(state, deps.emit, "follow-up", detail),
  });
  if (!result.ok) {
    return stopHere(
      result.error === "aborted" ? "aborted" : "model-failure",
      `El seguimiento falló y no se reintenta: ${result.detail}`,
    );
  }
  const parsed = validateFollowUp(result.value, state.eligible, previousQueries);
  if (!parsed.ok) {
    return stopHere("invalid-output", `Seguimiento rechazado: ${parsed.reason}`);
  }
  if (parsed.value.queries.length === 0) {
    return stopHere(
      "repeated-queries",
      "Todas las consultas de seguimiento repetían búsquedas anteriores. No se gasta otra búsqueda.",
    );
  }
  const external = new Set<string>(subs.filter((item) => item.external).map((item) => item.id));
  const round = state.round + 1;
  const repeated = parsed.value.repeated.length;
  return {
    counters,
    ledger,
    round,
    followUp: {
      reason: `Lagunas concretas en ${state.eligible.join(", ")}.`,
      queries: parsed.value.queries,
    },
    pendingSearch: parsed.value.queries.filter((item) => external.has(item.subquestionId)),
    pendingCourse: parsed.value.queries.filter((item) => !external.has(item.subquestionId)),
    candidates: [],
    newAccepted: 0,
    trace: traced(
      { ...state, round },
      deps.emit,
      "follow-up",
      `Ronda ${String(round)} con ${String(parsed.value.queries.length)} consultas nuevas${repeated > 0 ? `; ${String(repeated)} repetidas descartadas` : ""}. La pregunta original no cambia.`,
    ),
  };
}

async function synthesizeNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  const stop = halt(state, deps, "synthesize");
  if (stop) {
    return stop;
  }
  const subs = state.researchPlan?.subquestions ?? [];
  const shown = buildShown(state.accepted.map((entry) => entry.item));
  const evidence = shown.map((item, index) => ({
    ...item,
    subquestionIds: state.accepted[index]?.subquestionIds ?? [],
    excerpts: state.accepted[index]?.excerpts ?? [],
  }));
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.synthesisMs,
    (context) =>
      deps.ports.model.synthesize(
        {
          question: state.question,
          subquestions: modelSubquestions(subs),
          coverage: state.coverage.map((entry) => ({
            subquestionId: entry.subquestionId,
            status: entry.status,
            gap: entry.gap,
          })),
          contradictions: state.contradictions,
          evidence,
        },
        context,
      ),
  );
  const ledger = addConsumption(state.ledger, result.consumption);
  const finalAnswerUsd = result.consumption.kind === "reported" ? result.consumption.usd : null;
  if (!result.ok) {
    return {
      counters,
      ledger: { ...ledger, finalAnswerUsd },
      outcome: failureOutcome(result.error),
      stop: result.error === "aborted" ? "aborted" : "model-failure",
      stopDetail: "La síntesis falló. No se sustituye por otra etapa ni se reintenta.",
      reportText:
        "La síntesis del informe falló. La evidencia reunida queda en la traza, pero no hay un informe verificado.",
      trace: traced(state, deps.emit, "synthesize", `La síntesis falló: ${result.detail}`),
    };
  }
  return {
    counters,
    ledger: { ...ledger, finalAnswerUsd },
    draft: result.value,
    trace: traced(
      state,
      deps.emit,
      "synthesize",
      "Borrador del informe recibido. Falta verificarlo.",
    ),
  };
}

function verifyNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  const failure =
    state.stop === "provider-failure" ||
    state.stop === "model-failure" ||
    state.stop === "deadline";
  const report = verifyReport(state.draft, {
    subquestions: state.researchPlan?.subquestions ?? [],
    coverage: state.coverage,
    causes: state.causes,
    accepted: state.accepted,
    contradictions: state.contradictions,
    fixture: deps.ports.fixture,
    stopIsFailure: failure,
  });
  if (!report.ok) {
    return {
      outcome: "error",
      stop: "invalid-output",
      stopDetail: report.reason,
      reportText: "El borrador del informe no tiene la forma esperada. No se muestra.",
      draft: null,
      trace: traced(state, deps.emit, "verify", `Informe rechazado: ${report.reason}`),
    };
  }
  return {
    outcome: report.value.outcome,
    stop:
      report.value.outcome === "refused"
        ? "nothing-supported"
        : state.contradictions.length > 0 &&
            (state.stop === "all-covered" || state.stop === "course-answer")
          ? "unresolved-contradiction"
          : state.stop,
    reportText: report.value.markdown,
    citedSourceIds: report.value.citedSourceIds,
    claimChecked: report.value.checked,
    claimDropped: report.value.dropped,
    draft: null,
    trace: traced(
      state,
      deps.emit,
      "verify",
      `Resultado ${report.value.outcome}. ${String(report.value.checked)} afirmaciones comprobadas, ${String(report.value.dropped.length)} retiradas.`,
    ),
  };
}

function finishNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  const outcome = state.outcome ?? "error";
  return {
    outcome,
    stop: state.stop ?? "invalid-output",
    stopDetail: state.stopDetail || "El recorrido terminó sin un estado usable.",
    reportText: state.reportText || "El recorrido terminó sin informe.",
    trace: traced(
      state,
      deps.emit,
      "finish",
      `Fin: ${outcome}. Parada: ${state.stop ?? "sin motivo"}.`,
    ),
  };
}

const ended = (state: ResearchState) => state.outcome !== null;

/**
 * Construye el grafo sin compilar. La fase 1 lo compila sin checkpointer y lo
 * ejecuta en primer plano. El estado es serializable para que la fase 2 pueda
 * compilarlo con un checkpointer y un ejecutor durable.
 */
export function createResearchGraph(deps: NodeDeps) {
  return new StateGraph(ResearchGraphState)
    .addNode("validate", (state) => validateNode(state, deps))
    .addNode("plan", (state) => planNode(state, deps))
    .addNode("course", (state) => courseNode(state, deps))
    .addNode("tool", (state) => toolNode(state, deps))
    .addNode("search", (state) => searchNode(state, deps))
    .addNode("select", (state) => selectNode(state, deps))
    .addNode("read", (state) => readNode(state, deps))
    .addNode("assess", (state) => assessNode(state, deps))
    .addNode("decide", (state) => decideNode(state, deps))
    .addNode("follow_up", (state) => followUpNode(state, deps))
    .addNode("synthesize", (state) => synthesizeNode(state, deps))
    .addNode("verify", (state) => verifyNode(state, deps))
    .addNode("finish", (state) => finishNode(state, deps))
    .addEdge(START, "validate")
    .addConditionalEdges("validate", (state) => (ended(state) ? "finish" : "plan"))
    .addConditionalEdges("plan", (state) => (ended(state) ? "finish" : "course"))
    .addConditionalEdges("course", (state) => (ended(state) ? "finish" : "tool"))
    .addConditionalEdges("tool", (state) => (ended(state) ? "finish" : "search"))
    .addConditionalEdges("search", (state) => (ended(state) ? "finish" : "select"))
    .addConditionalEdges("select", (state) => (ended(state) ? "finish" : "read"))
    .addConditionalEdges("read", (state) => (ended(state) ? "finish" : "assess"))
    .addConditionalEdges("assess", (state) => (ended(state) ? "finish" : "decide"))
    .addConditionalEdges("decide", (state) =>
      ended(state) ? "finish" : state.eligible.length > 0 ? "follow_up" : "synthesize",
    )
    .addConditionalEdges("follow_up", (state) =>
      ended(state) ? "finish" : state.stop !== null ? "synthesize" : "course",
    )
    .addConditionalEdges("synthesize", (state) => (ended(state) ? "finish" : "verify"))
    .addEdge("verify", "finish")
    .addEdge("finish", END);
}

export function initialResearchState(request: ResearchRequest, startedAt: number): ResearchState {
  return {
    runId: request.runId,
    question: request.question.trim(),
    audience: request.audience,
    corpusVersion: request.corpusVersion,
    scenarioId: request.scenarioId,
    startedAt,
    round: 0,
    researchPlan: null,
    counters: emptyCounters(),
    courseQueries: [],
    toolCalls: [],
    searches: [],
    discovered: [],
    pagesRead: [],
    pendingCourse: [],
    pendingSearch: [],
    seenQueries: [],
    candidates: [],
    accepted: [],
    rejected: [],
    coverage: [],
    causes: {},
    contradictions: [],
    followUp: null,
    eligible: [],
    newAccepted: 0,
    draft: null,
    stop: null,
    stopDetail: "",
    outcome: null,
    reportText: "",
    citedSourceIds: [],
    claimChecked: 0,
    claimDropped: [],
    ledger: emptyLedger(),
    trace: [],
  };
}

/** Ejecuta el grafo en primer plano, ligado a la petición. No es un trabajo durable. */
export async function runResearchGraph(
  request: ResearchRequest,
  ports: ResearchPorts,
  onStep?: (step: ResearchStep) => void,
): Promise<ResearchState> {
  const emit = (step: ResearchStep) => {
    onStep?.(step);
  };
  const initial = initialResearchState(request, ports.now());
  try {
    return (await createResearchGraph({ ports, emit })
      .compile()
      .invoke(initial, { recursionLimit: 40 })) as ResearchState;
  } catch (error) {
    console.warn(
      "Research graph failure",
      error instanceof Error
        ? { name: error.name, message: error.message.slice(0, 300) }
        : { name: "unknown" },
    );
    return {
      ...initial,
      outcome: "error",
      stop: "invalid-output",
      stopDetail: "El grafo se detuvo por un límite interno.",
      reportText: "La investigación se detuvo por un límite interno. No se lanza otra búsqueda.",
      trace: traced(initial, emit, "finish", "El grafo se detuvo por un límite interno."),
    };
  }
}
