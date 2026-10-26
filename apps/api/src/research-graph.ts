// GUÍA DE LECTURA · apps/api/src/research-graph.ts
// Grafo LangGraph de la investigación: validar, planificar, reunir evidencia (políticas de la tienda,
// herramienta de pedidos, web),
// evaluarla, decidir si hace falta otra ronda, sintetizar el informe y verificarlo. Cada nodo devuelve
// solo los campos del estado que cambia; los nodos de reunir evidencia viven en research-gather.ts.
// Límites y tipo de paso visible.
import { RESEARCH_LIMITS, type ResearchStep } from "@thepower-rag/contracts";
// Reglas puras de la investigación: validar, decidir, verificar y contar.
import {
  // Cobertura, evidencia mostrada, decisión de otra ronda y deduplicación.
  attributeCause,
  buildShown,
  carryCoverage,
  decideNext,
  dedupeEvidence,
  // Contadores, plazos y validadores de cada salida del modelo.
  emptyCounters,
  reconcileCoverage,
  remainingMs,
  validateAssessment,
  validateFollowUp,
  validatePlan,
  // Verificador extractivo del informe.
  verifyReport,
  // Tipos de la evidencia, lagunas, subpreguntas, plan, puertos y petición.
  type AcceptedEvidence,
  type GapCause,
  type ModelSubquestion,
  type PlanItem,
  type ResearchPorts,
  type ResearchRequest,
} from "@thepower-rag/research";
// LangGraph: nodos de inicio y fin, grafo de estado y tipo de checkpointer.
import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
// Nodos que reúnen evidencia y sus dependencias.
import {
  storeNode,
  halt,
  readNode,
  searchNode,
  selectNode,
  toolNode,
  type NodeDeps,
} from "./research-gather";
// Estado del grafo, consumo y llamadas protegidas.
import {
  addConsumption,
  emptyLedger,
  guardedCall,
  ResearchGraphState,
  controlError,
  traced,
  type ResearchState,
} from "./research-state";

// Subpreguntas en la forma que ve el modelo.
function modelSubquestions(items: readonly PlanItem[]): ModelSubquestion[] {
  // Id, texto, tipo y si es externa.
  return items.map((item) => ({
    id: item.id,
    text: item.text,
    kind: item.kind,
    external: item.external,
  }));
}

// Causa de cada laguna según lo que se intentó.
function causesFor(
  state: ResearchState,
  coverage: ResearchState["coverage"],
): Record<string, GapCause> {
  // Causas por subpregunta.
  const causes: Record<string, GapCause> = {};
  // Cada subpregunta del plan.
  for (const sub of state.researchPlan?.subquestions ?? []) {
    // Su cobertura.
    const entry = coverage.find((item) => item.subquestionId === sub.id);
    // Causa según búsquedas, lecturas, políticas y herramienta.
    causes[sub.id] = attributeCause(sub, entry?.status ?? "uncovered", {
      searches: state.searches,
      reads: state.pagesRead,
      store: state.storeQueries,
      tools: state.toolCalls,
    });
  }
  // Causas.
  return causes;
}

// ¿Hay al menos una subpregunta con fuentes?
function supported(state: ResearchState): boolean {
  // Cobertura no vacía con fuentes.
  return state.coverage.some((entry) => entry.status !== "uncovered" && entry.sourceIds.length > 0);
}

// Cancelación o error.
function failureOutcome(error: string): "aborted" | "error" {
  // aborted o error.
  return error === "aborted" ? "aborted" : "error";
}

// Nodo validate: comprueba la pregunta antes de planificar.
function validateNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  // Parada por cancelación o plazo.
  const stop = halt(state, deps, "validate");
  // Si toca parar.
  if (stop) {
    // Devuelve la parada.
    return stop;
  }
  // Aviso si la pregunta viene contextualizada con la memoria.
  const memory =
    state.originalQuestion !== state.question
      ? " La pregunta del grafo está contextualizada; la original se conserva y la memoria no es evidencia."
      : "";
  // Paso de validación.
  return {
    trace: traced(state, deps.emit, "validate", `Pregunta válida.${memory}`),
  };
}

// Nodo plan: el modelo propone ruta y subpreguntas.
async function planNode(state: ResearchState, deps: NodeDeps): Promise<Partial<ResearchState>> {
  // Parada.
  const stop = halt(state, deps, "plan");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Una llamada más al modelo.
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  // Llamada con plazo propio.
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.planMs,
    (context) => deps.ports.model.plan({ question: state.question }, context),
  );
  // Suma el consumo.
  const ledger = addConsumption(state.ledger, result.consumption);
  // Fallo del planificador.
  if (!result.ok) {
    // Termina sin reintentar.
    return {
      counters,
      ledger,
      outcome: failureOutcome(result.error),
      stop: result.error === "aborted" ? "aborted" : "model-failure",
      stopDetail: "El planificador no completó el plan. No se reintenta.",
      trace: traced(state, deps.emit, "plan", `El planificador falló: ${result.detail}`),
    };
  }
  // Valida el plan.
  const plan = validatePlan(result.value);
  // Plan inválido.
  if (!plan.ok) {
    // Termina con invalid-output.
    return {
      counters,
      ledger,
      outcome: "error",
      stop: "invalid-output",
      stopDetail: plan.reason,
      trace: traced(state, deps.emit, "plan", `Plan rechazado: ${plan.reason}`),
    };
  }
  // El plan pide aclaración.
  if (plan.value.route === "clarify") {
    // Termina con la aclaración.
    return {
      // Cada nodo devuelve solo los campos que cambian; LangGraph los funde con el estado.
      counters,
      ledger,
      researchPlan: plan.value,
      // «clarify» termina el recorrido: no hay búsquedas ni informe.
      outcome: "clarify",
      stop: "clarify",
      stopDetail: plan.value.clarification ?? "Hace falta aclarar la pregunta.",
      // Texto que verá el usuario: la aclaración que pide el plan.
      reportText:
        `Necesito una aclaración antes de investigar. ${plan.value.clarification ?? ""}`.trim(),
      // traced añade el paso a la traza visible y lo emite al navegador.
      trace: traced(state, deps.emit, "plan", "El plan pide una aclaración. No hay búsquedas."),
    };
  }
  // Subpreguntas.
  const subs = plan.value.subquestions;
  // Cuántas necesitan fuentes externas.
  const external = subs.filter((item) => item.external).length;
  // Plan aceptado: ronda 1 con consultas pendientes a las políticas y a la web.
  return {
    // Contadores y libro de consumo con la llamada del plan ya sumada.
    counters,
    ledger,
    researchPlan: plan.value,
    round: 1,
    // Consultas a las políticas: todas las subpreguntas que no son de la herramienta de pedidos.
    pendingStore: subs
      .filter((item) => item.kind !== "order")
      .map((item) => ({ subquestionId: item.id, query: item.text })),
    // Consultas a la web: solo las subpreguntas marcadas como externas y con consulta.
    pendingSearch: subs
      .filter((item) => item.external && item.query !== null)
      .map((item) => ({ subquestionId: item.id, query: item.query ?? item.text })),
    // Los candidatos de la ronda anterior se vacían.
    candidates: [],
    trace: traced(
      { ...state, round: 1 },
      deps.emit,
      "plan",
      `Ruta ${plan.value.route}: ${String(subs.length)} subpreguntas, ${String(external)} con fuentes externas${plan.value.tool ? ", herramienta de pedidos" : ""}.`,
    ),
  };
}

// Nodo assess: el modelo decide qué evidencia acepta y qué cubre.
async function assessNode(state: ResearchState, deps: NodeDeps): Promise<Partial<ResearchState>> {
  // Subpreguntas.
  const subs = state.researchPlan?.subquestions ?? [];
  // Sin candidatos nuevos.
  if (state.candidates.length === 0) {
    // Mantiene la cobertura sin llamar al evaluador.
    const coverage = carryCoverage(state.coverage, subs, state.accepted);
    // Cobertura y causas.
    return {
      coverage,
      causes: causesFor(state, coverage),
      newAccepted: 0,
      trace: traced(state, deps.emit, "assess", "Sin evidencia nueva. No se llama al evaluador."),
    };
  }
  // Parada.
  const stop = halt(state, deps, "assess");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Evidencia aceptada más candidatos, sin duplicados y con tope.
  const pool = dedupeEvidence([
    ...state.accepted.map((entry) => entry.item),
    ...state.candidates,
  ]).slice(0, RESEARCH_LIMITS.maxEvidenceItems);
  // Lo que se enseña al modelo.
  const shown = buildShown(pool);
  // Elementos enseñados.
  const items = pool.slice(0, shown.length);
  // Ids enseñados.
  const shownIds = new Set(shown.map((item) => item.sourceId));
  // Una llamada más.
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  // Evaluación con plazo propio.
  const result = await guardedCall(
    // guardedCall: comprueba el plazo global, reserva y ejecuta el puerto con su propio tiempo
    // máximo.
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.assessMs,
    (context) =>
      // El evaluador recibe la pregunta, las subpreguntas, la evidencia mostrada y la cobertura
      // previa.
      deps.ports.model.assess(
        {
          question: state.question,
          subquestions: modelSubquestions(subs),
          evidence: shown,
          // Cobertura previa: así la segunda ronda sabe qué faltaba.
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
  // Consumo.
  const ledger = addConsumption(state.ledger, result.consumption);
  // Fallo.
  if (!result.ok) {
    // Termina sin reintentar.
    return {
      counters,
      ledger,
      outcome: failureOutcome(result.error),
      stop: result.error === "aborted" ? "aborted" : "model-failure",
      stopDetail: "El evaluador de evidencia falló. No se reintenta ni se cambia de etapa.",
      trace: traced(state, deps.emit, "assess", `El evaluador falló: ${result.detail}`),
    };
  }
  // Valida la evaluación contra lo enseñado.
  const parsed = validateAssessment(result.value, {
    shown,
    items,
    subquestions: subs,
    prior: state.accepted.filter((entry) => !shownIds.has(entry.item.sourceId)),
    round: state.round,
  });
  // Evaluación inválida.
  if (!parsed.ok) {
    // Termina.
    return {
      counters,
      ledger,
      outcome: "error",
      stop: "invalid-output",
      stopDetail: parsed.reason,
      trace: traced(state, deps.emit, "assess", `Evaluación rechazada: ${parsed.reason}`),
    };
  }
  // Ids ya aceptados.
  const priorIds = new Set(state.accepted.map((entry) => entry.item.sourceId));
  // Aceptados que no se volvieron a enseñar.
  const kept = state.accepted.filter((entry) => !shownIds.has(entry.item.sourceId));
  // Aceptados que se renuevan.
  const renewed = parsed.value.accepted.filter((entry) => priorIds.has(entry.item.sourceId));
  // Aceptados nuevos.
  const fresh = parsed.value.accepted.filter((entry) => !priorIds.has(entry.item.sourceId));
  // Hueco hasta el tope.
  const room = RESEARCH_LIMITS.maxEvidenceItems - kept.length - renewed.length;
  // Nuevos que caben.
  const admitted = fresh.slice(0, Math.max(0, room));
  // Nuevos que no caben: se rechazan por tope.
  const overflow = fresh.slice(admitted.length).map((entry) => ({
    sourceId: entry.item.sourceId,
    kind: entry.item.kind,
    round: state.round,
    reason: "Tope de evidencia admitida alcanzado.",
  }));
  // Evidencia aceptada.
  const accepted: AcceptedEvidence[] = [...kept, ...renewed, ...admitted];
  // Rechazados acumulados con tope.
  const rejected = [...state.rejected, ...parsed.value.rejected, ...overflow].slice(
    0,
    RESEARCH_LIMITS.maxEvidenceItems * 2,
  );
  // Cobertura reconciliada con la anterior.
  const coverage = reconcileCoverage(
    parsed.value.coverage,
    state.coverage,
    accepted,
    subs,
    shownIds,
  );
  // Subpreguntas cubiertas.
  const covered = coverage.filter((entry) => entry.status === "covered").length;
  // Estado actualizado.
  return {
    // Evidencia aceptada y rechazada, cobertura y causa de cada laguna.
    counters,
    ledger,
    accepted,
    rejected,
    coverage,
    causes: causesFor({ ...state, accepted }, coverage),
    // Contradicciones explícitas: impiden un informe completo.
    contradictions: parsed.value.contradictions,
    // Cuántas evidencias nuevas entraron en esta ronda (decide si hubo progreso).
    newAccepted: admitted.length,
    candidates: [],
    // Paso visible con el balance de la ronda.
    trace: traced(
      state,
      deps.emit,
      "assess",
      `Ronda ${String(state.round)}: ${String(admitted.length)} aceptadas, ${String(parsed.value.rejected.length + overflow.length)} descartadas, ${String(covered)} de ${String(subs.length)} subpreguntas cubiertas${parsed.value.authorityRejections > 0 ? `; ${String(parsed.value.authorityRejections)} asignaciones externas a hechos internos retiradas` : ""}.`,
    ),
  };
}

// Nodo decide: seguir otra ronda o parar.
function decideNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  // Regla pura de decisión.
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
  // Seguimiento.
  if (next.kind === "follow-up") {
    // Subpreguntas elegibles.
    return {
      eligible: next.eligible,
      trace: traced(state, deps.emit, "decide", `Seguimiento justificado. ${next.reason}`),
    };
  }
  // ¿Ruta interna (políticas o herramienta)?
  const internal = state.researchPlan?.route === "store" || state.researchPlan?.route === "tool";
  // Todo cubierto con ruta interna: respuesta de las políticas.
  const stop = next.stop === "all-covered" && internal ? "store-answer" : next.stop;
  // Parada.
  const update: Partial<ResearchState> = {
    eligible: [],
    stop,
    stopDetail: next.detail,
    trace: traced(state, deps.emit, "decide", `Parada: ${stop}. ${next.detail}`),
  };
  // Sin evidencia útil.
  if (!supported(state)) {
    // ¿Falló la herramienta?
    const toolFailed = state.toolCalls.some((item) => item.status === "error");
    // Fallo operativo o rechazo.
    update.outcome = stop === "provider-failure" ? "error" : "refused";
    // Mensaje según la causa.
    update.reportText =
      stop === "provider-failure"
        ? toolFailed
          ? "No se pudo leer el catálogo: la herramienta falló. Es un fallo operativo, no una falta de evidencia, y no se reintenta automáticamente."
          : "La investigación no pudo comprobar las fuentes por un fallo operativo. No es una falta de evidencia y no se reintenta automáticamente."
        : "No hay evidencia admitida para responder. No consta en las políticas de la tienda consultadas ni en las páginas leídas.";
  }
  // Actualización.
  return update;
}

// Nodo follow_up: nuevas consultas para las lagunas.
async function followUpNode(state: ResearchState, deps: NodeDeps): Promise<Partial<ResearchState>> {
  // Parada.
  const stop = halt(state, deps, "follow-up");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Subpreguntas.
  const subs = state.researchPlan?.subquestions ?? [];
  // Lagunas de las subpreguntas elegibles.
  const gaps = state.eligible.flatMap((id) => {
    // Subpregunta.
    const sub = subs.find((item) => item.id === id);
    // Su cobertura.
    const entry = state.coverage.find((item) => item.subquestionId === id);
    // Primera contradicción.
    const contradiction = state.contradictions[0] ?? "";
    // Laguna con su texto.
    return sub === undefined
      ? // Subpregunta desconocida: se ignora.
        []
      : [
          // Laguna: id, texto y el hueco concreto (de la cobertura, de la contradicción o uno
          // genérico).
          {
            subquestionId: id,
            text: sub.text,
            gap:
              entry?.gap ||
              contradiction ||
              "Contradicción sin resolver entre las fuentes admitidas.",
            // Si la subpregunta necesita fuentes externas.
            external: sub.external,
          },
        ];
  });
  // Consultas ya hechas.
  const previousQueries = [...state.seenQueries, ...state.storeQueries.map((item) => item.query)];
  // Una llamada más.
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  // Seguimiento con plazo.
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.followUpMs,
    (context) =>
      deps.ports.model.followUp({ question: state.question, gaps, previousQueries }, context),
  );
  // Consumo.
  const ledger = addConsumption(state.ledger, result.consumption);
  // Parada común del seguimiento.
  const stopHere = (
    stopReason: "model-failure" | "invalid-output" | "repeated-queries" | "aborted",
    detail: string,
  ): Partial<ResearchState> => ({
    // Contadores y consumo con la llamada ya sumada.
    counters,
    ledger,
    // Motivo de la parada y explicación.
    stop: stopReason,
    stopDetail: detail,
    // Abortar marca el resultado como abortado. Si no, sin evidencia aceptada el resultado es un
    // rechazo.
    ...(stopReason === "aborted"
      ? { outcome: "aborted" as const }
      : supported(state)
        ? {}
        : { outcome: "refused" as const, reportText: "No hay evidencia admitida para responder." }),
    // Paso visible del seguimiento.
    trace: traced(state, deps.emit, "follow-up", detail),
  });
  // Fallo.
  if (!result.ok) {
    // Para.
    return stopHere(
      result.error === "aborted" ? "aborted" : "model-failure",
      `El seguimiento falló y no se reintenta: ${result.detail}`,
    );
  }
  // Valida las consultas.
  const parsed = validateFollowUp(result.value, state.eligible, previousQueries);
  // Inválidas.
  if (!parsed.ok) {
    // Para.
    return stopHere("invalid-output", `Seguimiento rechazado: ${parsed.reason}`);
  }
  // Todas repetidas.
  if (parsed.value.queries.length === 0) {
    // Para sin gastar.
    return stopHere(
      "repeated-queries",
      "Todas las consultas de seguimiento repetían búsquedas anteriores. No se gasta otra búsqueda.",
    );
  }
  // Subpreguntas externas.
  const external = new Set<string>(subs.filter((item) => item.external).map((item) => item.id));
  // Siguiente ronda.
  const round = state.round + 1;
  // Consultas repetidas descartadas.
  const repeated = parsed.value.repeated.length;
  // Nueva ronda con consultas a la web o a las políticas.
  return {
    // Nueva ronda: la pregunta original no cambia, solo se añaden consultas.
    counters,
    ledger,
    round,
    // Motivo y consultas del seguimiento, para la traza.
    followUp: {
      reason: `Lagunas concretas en ${state.eligible.join(", ")}.`,
      queries: parsed.value.queries,
    },
    // Las consultas de subpreguntas externas van a la web y el resto a las políticas.
    pendingSearch: parsed.value.queries.filter((item) => external.has(item.subquestionId)),
    pendingStore: parsed.value.queries.filter((item) => !external.has(item.subquestionId)),
    // Se vacían los candidatos y el contador de evidencia nueva.
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

// Nodo synthesize: el modelo redacta el borrador con extractos admitidos.
async function synthesizeNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  // Parada.
  const stop = halt(state, deps, "synthesize");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Subpreguntas.
  const subs = state.researchPlan?.subquestions ?? [];
  // Evidencia enseñada.
  const shown = buildShown(state.accepted.map((entry) => entry.item));
  // Con sus subpreguntas y extractos.
  const evidence = shown.map((item, index) => ({
    ...item,
    subquestionIds: state.accepted[index]?.subquestionIds ?? [],
    excerpts: state.accepted[index]?.excerpts ?? [],
  }));
  // Una llamada más.
  const counters = { ...state.counters, modelCalls: state.counters.modelCalls + 1 };
  // Síntesis con plazo.
  const result = await guardedCall(
    // Síntesis con su propio plazo dentro del plazo total.
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.synthesisMs,
    (context) =>
      // El sintetizador recibe la pregunta, las subpreguntas, la cobertura, las contradicciones y
      // la evidencia.
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
  // Consumo.
  const ledger = addConsumption(state.ledger, result.consumption);
  // Importe informado de la respuesta final.
  const finalAnswerUsd = result.consumption.kind === "reported" ? result.consumption.usd : null;
  // Fallo.
  if (!result.ok) {
    // Termina sin informe.
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
  // Borrador pendiente de verificar.
  return {
    // Contadores y coste de la respuesta final.
    counters,
    ledger: { ...ledger, finalAnswerUsd },
    // Borrador: aún no se enseña. Pasa al verificador extractivo.
    draft: result.value,
    trace: traced(
      state,
      deps.emit,
      "synthesize",
      "Borrador del informe recibido. Falta verificarlo.",
    ),
  };
}

// Nodo verify: comprueba cada afirmación del borrador contra la evidencia.
function verifyNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  // ¿La parada fue un fallo?
  const failure =
    state.stop === "provider-failure" ||
    state.stop === "model-failure" ||
    state.stop === "deadline";
  // Verificación pura.
  const report = verifyReport(state.draft, {
    subquestions: state.researchPlan?.subquestions ?? [],
    coverage: state.coverage,
    causes: state.causes,
    accepted: state.accepted,
    contradictions: state.contradictions,
    fixture: deps.ports.fixture,
    stopIsFailure: failure,
  });
  // Informe inválido.
  if (!report.ok) {
    // No se muestra.
    return {
      outcome: "error",
      stop: "invalid-output",
      stopDetail: report.reason,
      reportText: "El borrador del informe no tiene la forma esperada. No se muestra.",
      draft: null,
      trace: traced(state, deps.emit, "verify", `Informe rechazado: ${report.reason}`),
    };
  }
  // Informe verificado con su resultado y parada.
  return {
    // Resultado del verificador: complete, partial o refused.
    outcome: report.value.outcome,
    // Motivo de parada: rechazo si nada se sostiene; contradicción si quedaba alguna sin resolver.
    stop:
      report.value.outcome === "refused"
        ? "nothing-supported"
        : state.contradictions.length > 0 &&
            (state.stop === "all-covered" || state.stop === "store-answer")
          ? "unresolved-contradiction"
          : state.stop,
    // Informe ya verificado y fuentes realmente citadas.
    reportText: report.value.markdown,
    citedSourceIds: report.value.citedSourceIds,
    // Afirmaciones comprobadas y retiradas, para la traza.
    claimChecked: report.value.checked,
    claimDropped: report.value.dropped,
    // El borrador ya no hace falta.
    draft: null,
    trace: traced(
      state,
      deps.emit,
      "verify",
      `Resultado ${report.value.outcome}. ${String(report.value.checked)} afirmaciones comprobadas, ${String(report.value.dropped.length)} retiradas.`,
    ),
  };
}

// Nodo finish: cierra con resultado, parada y texto.
function finishNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  // Resultado o error.
  const outcome = state.outcome ?? "error";
  // Estado final.
  return {
    // Sin resultado previo es un error.
    outcome,
    // Valores por defecto para que el estado final siempre sea utilizable.
    stop: state.stop ?? "invalid-output",
    stopDetail: state.stopDetail || "El recorrido terminó sin un estado usable.",
    reportText: state.reportText || "El recorrido terminó sin informe.",
    // Último paso visible.
    trace: traced(
      state,
      deps.emit,
      "finish",
      `Fin: ${outcome}. Parada: ${state.stop ?? "sin motivo"}.`,
    ),
  };
}

// ¿Ya hay resultado?
const ended = (state: ResearchState) => state.outcome !== null;

/**
 * Construye el grafo sin compilar. La fase 1 lo compila sin checkpointer y lo
 * ejecuta en primer plano. El estado es serializable para que la fase 2 pueda
 * compilarlo con un checkpointer y un ejecutor durable.
 */
export function createResearchGraph(deps: NodeDeps) {
  // Nodos y aristas: si un nodo termina, se salta a finish.
  return (
    new StateGraph(ResearchGraphState)
      // Un nodo por etapa: validar, planificar, reunir (políticas, herramienta, web, selección y
      // lectura), evaluar, decidir, seguir, sintetizar, verificar y terminar.
      .addNode("validate", (state) => validateNode(state, deps))
      .addNode("plan", (state) => planNode(state, deps))
      .addNode("store", (state) => storeNode(state, deps))
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
      // Aristas: el recorrido es lineal y cualquier nodo que termina salta a finish.
      .addEdge(START, "validate")
      .addConditionalEdges("validate", (state) => (ended(state) ? "finish" : "plan"))
      .addConditionalEdges("plan", (state) => (ended(state) ? "finish" : "store"))
      .addConditionalEdges("store", (state) => (ended(state) ? "finish" : "tool"))
      .addConditionalEdges("tool", (state) => (ended(state) ? "finish" : "search"))
      .addConditionalEdges("search", (state) => (ended(state) ? "finish" : "select"))
      .addConditionalEdges("select", (state) => (ended(state) ? "finish" : "read"))
      .addConditionalEdges("read", (state) => (ended(state) ? "finish" : "assess"))
      .addConditionalEdges("assess", (state) => (ended(state) ? "finish" : "decide"))
      // decide: si hay lagunas elegibles abre otra ronda; si no, sintetiza.
      .addConditionalEdges("decide", (state) =>
        ended(state) ? "finish" : state.eligible.length > 0 ? "follow_up" : "synthesize",
      )
      // follow_up: con una parada va a sintetizar; si no, vuelve a buscar en las políticas.
      .addConditionalEdges("follow_up", (state) =>
        ended(state) ? "finish" : state.stop !== null ? "synthesize" : "store",
      )
      .addConditionalEdges("synthesize", (state) => (ended(state) ? "finish" : "verify"))
      // Tras verificar se termina siempre.
      .addEdge("verify", "finish")
      .addEdge("finish", END)
  );
}

// Estado inicial de una investigación.
export function initialResearchState(request: ResearchRequest, startedAt: number): ResearchState {
  // Campos vacíos y contadores a cero.
  return {
    // Identidad y pregunta. La original se guarda aparte porque question puede contextualizarse.
    runId: request.runId,
    question: request.question.trim(),
    originalQuestion: request.question.trim(),
    threadId: request.threadId,
    // Trabajo, versión del corpus y guion de demo.
    jobId: null,
    corpusVersion: request.corpusVersion,
    scenarioId: request.scenarioId,
    // Inicio (para el plazo global) y ronda 0.
    startedAt,
    round: 0,
    researchPlan: null,
    // Contadores y registros de cada llamada.
    counters: emptyCounters(),
    storeQueries: [],
    toolCalls: [],
    searches: [],
    discovered: [],
    pagesRead: [],
    // Consultas pendientes y ya vistas (para no repetir).
    pendingStore: [],
    pendingSearch: [],
    seenQueries: [],
    // Evidencia: candidatos, aceptada, rechazada, cobertura, causas y contradicciones.
    candidates: [],
    accepted: [],
    rejected: [],
    coverage: [],
    causes: {},
    contradictions: [],
    // Seguimiento y subpreguntas elegibles para otra ronda.
    followUp: null,
    eligible: [],
    newAccepted: 0,
    // Borrador, parada y resultado.
    draft: null,
    stop: null,
    stopDetail: "",
    outcome: null,
    // Informe final y verificación.
    reportText: "",
    citedSourceIds: [],
    claimChecked: 0,
    claimDropped: [],
    // Libro de consumo y traza visible.
    ledger: emptyLedger(),
    trace: [],
  };
}

/** Ejecuta el grafo. Sin checkpointer sigue ligado a la petición. */
export async function runResearchGraph(
  request: ResearchRequest,
  ports: ResearchPorts,
  onStep?: (step: ResearchStep) => void,
  options?: {
    // Momento de inicio.
    startedAt?: number;
    // Checkpointer duradero.
    checkpointer?: BaseCheckpointSaver;
    // Hilo del trabajo.
    threadId?: string;
    // Pausa antes del nodo store.
    interruptBefore?: "store";
    // Id del trabajo.
    jobId?: string | null;
    // Pregunta original.
    originalQuestion?: string;
  },
): Promise<ResearchState> {
  // Reenvía los pasos al llamador.
  const emit = (step: ResearchStep) => {
    // Si hay callback.
    onStep?.(step);
  };
  // Estado inicial.
  const initial = initialResearchState(request, options?.startedAt ?? ports.now());
  // Pregunta original indicada.
  if (options?.originalQuestion) {
    // La guarda.
    initial.originalQuestion = options.originalQuestion;
  }
  // Id del trabajo.
  if (options?.jobId) {
    // Lo guarda.
    initial.jobId = options.jobId;
  }
  // Checkpointer.
  const checkpointer = options?.checkpointer;
  // Hilo.
  const threadId = options?.threadId;
  // try/catch: un fallo interno se convierte en resultado de error.
  try {
    // Compila el grafo con checkpointer y pausa si se piden.
    const compiled = createResearchGraph({ ports, emit }).compile({
      ...(checkpointer ? { checkpointer } : {}),
      ...(options?.interruptBefore ? { interruptBefore: [options.interruptBefore] } : {}),
    });
    // Con checkpointer: reanuda si ya hay un checkpoint.
    if (checkpointer && threadId) {
      // Configuración del hilo y límite de pasos.
      const config = {
        configurable: { thread_id: threadId, checkpoint_ns: "" },
        recursionLimit: 40,
      };
      // Checkpoint existente.
      const existing = await checkpointer.getTuple({
        configurable: { thread_id: threadId, checkpoint_ns: "" },
      });
      // Con checkpoint, sigue desde él; si no, empieza.
      return (await compiled.invoke(existing ? null : initial, config)) as ResearchState;
    }
    // Sin checkpointer: una ejecución en memoria.
    return (await compiled.invoke(initial, { recursionLimit: 40 })) as ResearchState;
  } catch (error) {
    // Errores de control (cancelación, caída) se propagan.
    const control = controlError(error);
    // Si es de control.
    if (control) {
      // Se relanza.
      throw control;
    }
    // Registra el fallo sin datos privados.
    console.warn(
      "Research graph failure",
      error instanceof Error
        ? { name: error.name, message: error.message.slice(0, 300) }
        : { name: "unknown" },
    );
    // Resultado de error.
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
