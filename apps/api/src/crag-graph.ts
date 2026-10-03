import {
  cragStepSchema,
  cragSummarySchema,
  type CragStep,
  type CragSummary,
} from "@thepower-rag/contracts";
import {
  CRAG_BOUNDS,
  budgetOpen,
  chunkInScope,
  dedupeChunks,
  evidenceForAnswer,
  isScheduleQuestion,
  remainingBudgetMs,
  retainEvidence,
  routeAfterAssessment,
  validateRankingAndAssessment,
  validateReformulation,
  type CragAssessment,
  type CragChunk,
  type CragPorts,
  type CragScope,
  type RankedHit,
} from "@thepower-rag/core";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

type Terminal = CragSummary["terminal"] | "pending";

interface Discarded {
  chunkId: string;
  reason: string;
  attempt: number;
}

interface Ledger {
  retrievalExecutions: number;
  evaluationExecutions: number;
  reformulationExecutions: number;
  generationExecutions: number;
  retrievalProviderCalls: number | null;
  evaluationProviderCalls: number | null;
  reformulationProviderCalls: number | null;
  generationProviderCalls: number | null;
  retrievalMs: number | null;
  evaluationMs: number | null;
  reformulationMs: number | null;
  generationMs: number | null;
  partial: boolean;
  usage: CragSummary["usage"];
  cost: CragSummary["cost"];
}

interface GraphState {
  originalQuestion: string;
  currentQuery: string;
  scope: CragScope;
  retrievalCount: number;
  reformulationCount: number;
  seenQueries: string[];
  candidates: CragChunk[];
  retained: CragChunk[];
  discarded: Discarded[];
  shown: CragChunk[];
  ranking: RankedHit[];
  decision: CragAssessment | null;
  terminal: Terminal;
  terminalReason: string;
  answerText: string;
  evidence: CragChunk[];
  ledger: Ledger;
  startedAt: number;
  fixture: boolean;
  scenarioId: string | null;
}

const CragGraphState = Annotation.Root({
  originalQuestion: Annotation<string>,
  currentQuery: Annotation<string>,
  scope: Annotation<CragScope>,
  retrievalCount: Annotation<number>,
  reformulationCount: Annotation<number>,
  seenQueries: Annotation<string[]>,
  candidates: Annotation<CragChunk[]>,
  retained: Annotation<CragChunk[]>,
  discarded: Annotation<Discarded[]>,
  shown: Annotation<CragChunk[]>,
  ranking: Annotation<RankedHit[]>,
  decision: Annotation<CragAssessment | null>,
  terminal: Annotation<Terminal>,
  terminalReason: Annotation<string>,
  answerText: Annotation<string>,
  evidence: Annotation<CragChunk[]>,
  ledger: Annotation<Ledger>,
  startedAt: Annotation<number>,
  fixture: Annotation<boolean>,
  scenarioId: Annotation<string | null>,
});

const CLARIFY =
  "La pregunta parece de calendario. Elige el grupo con clases los lunes y miércoles o el grupo con clases los martes y jueves. La selección general no muestra los dos calendarios.";
const REFUSE =
  "No hay evidencia suficiente en el corpus del curso. No se responde con fragmentos rechazados ni con una búsqueda agotada.";

export interface CragTurnInput {
  question: string;
  scope: CragScope;
  ports: CragPorts;
  fixture: boolean;
  scenarioId: string | null;
  onStep?: (step: CragStep) => void;
}

export interface CragTurnResult {
  terminal: CragSummary["terminal"];
  answerText: string;
  evidence: CragChunk[];
  summary: CragSummary;
  steps: CragStep[];
}

function emptyLedger(measured: boolean): Ledger {
  return {
    retrievalExecutions: 0,
    evaluationExecutions: 0,
    reformulationExecutions: 0,
    generationExecutions: 0,
    retrievalProviderCalls: measured ? 0 : null,
    evaluationProviderCalls: measured ? 0 : null,
    reformulationProviderCalls: measured ? 0 : null,
    generationProviderCalls: measured ? 0 : null,
    retrievalMs: null,
    evaluationMs: null,
    reformulationMs: null,
    generationMs: null,
    partial: true,
    usage: null,
    cost: null,
  };
}

function noteCall(
  ledger: Ledger,
  kind: "retrieval" | "evaluation" | "reformulation" | "generation",
  measured: boolean,
  providerCall: boolean,
  started: number,
  now: number,
): Ledger {
  const next = { ...ledger, partial: true };
  const elapsed =
    Number.isFinite(now - started) && now >= started ? Math.round(now - started) : null;
  if (kind === "retrieval") {
    next.retrievalExecutions += 1;
    if (measured) {
      next.retrievalProviderCalls = (next.retrievalProviderCalls ?? 0) + (providerCall ? 1 : 0);
      next.retrievalMs = (next.retrievalMs ?? 0) + (elapsed ?? 0);
    }
  } else if (kind === "evaluation") {
    next.evaluationExecutions += 1;
    if (measured) {
      next.evaluationProviderCalls = (next.evaluationProviderCalls ?? 0) + (providerCall ? 1 : 0);
      next.evaluationMs = (next.evaluationMs ?? 0) + (elapsed ?? 0);
    }
  } else if (kind === "reformulation") {
    next.reformulationExecutions += 1;
    if (measured) {
      next.reformulationProviderCalls =
        (next.reformulationProviderCalls ?? 0) + (providerCall ? 1 : 0);
      next.reformulationMs = (next.reformulationMs ?? 0) + (elapsed ?? 0);
    }
  } else {
    next.generationExecutions += 1;
    if (measured) {
      next.generationProviderCalls = (next.generationProviderCalls ?? 0) + (providerCall ? 1 : 0);
      next.generationMs = (next.generationMs ?? 0) + (elapsed ?? 0);
    }
  }
  return next;
}

function emitStep(
  state: GraphState,
  emit: (step: CragStep) => void,
  step: Omit<CragStep, "runId" | "query" | "retrieval" | "reformulation" | "retainedIds"> & {
    query?: string;
    retainedIds?: string[];
  },
): CragStep {
  const built = cragStepSchema.parse({
    runId: state.scope.runId,
    kind: step.kind,
    retrieval: state.retrievalCount,
    reformulation: state.reformulationCount,
    query: (step.query ?? state.currentQuery).slice(0, CRAG_BOUNDS.maxQueryChars),
    status: step.status.slice(0, CRAG_BOUNDS.maxReasonChars),
    evidenceStatus: step.evidenceStatus,
    retainedIds: (step.retainedIds ?? state.retained.map((chunk) => chunk.chunkId)).slice(
      0,
      CRAG_BOUNDS.maxRetained,
    ),
    discardedIds: step.discardedIds.slice(0, 10),
  });
  emit(built);
  return built;
}

function blocked(
  state: GraphState,
  ports: CragPorts,
  emit: (step: CragStep) => void,
): Partial<GraphState> | null {
  if (ports.signal.aborted) {
    emitStep(state, emit, {
      kind: "abort",
      status: "La petición se ha detenido. No empieza trabajo nuevo.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    return {
      terminal: "aborted",
      terminalReason:
        "La espera local se ha detenido. Eso no cancela un cómputo que ya haya salido.",
      answerText: "La petición se ha detenido. No se inicia otra búsqueda ni otra llamada.",
    };
  }
  if (!budgetOpen(state.startedAt, ports.now())) {
    emitStep(state, emit, {
      kind: "error",
      status: "Se agotó el tiempo local antes de la siguiente operación.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    return {
      terminal: "error",
      terminalReason: "Se agotó el tiempo local del recorrido.",
      answerText: "Se agotó el tiempo local. No se inicia otra recuperación.",
    };
  }
  return null;
}

function callBudget(state: GraphState, ports: CragPorts): { remainingMs: number } {
  return { remainingMs: remainingBudgetMs(state.startedAt, ports.now()) };
}

function finishedLate(
  state: GraphState,
  ports: CragPorts,
  emit: (step: CragStep) => void,
  ledger: Ledger,
): Partial<GraphState> | null {
  if (ports.signal.aborted) {
    emitStep({ ...state, ledger }, emit, {
      kind: "abort",
      status: "La operación ya contaba y la petición se detuvo. No empieza otra.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    return {
      ledger,
      evidence: [],
      terminal: "aborted",
      terminalReason:
        "La espera local se ha detenido. Eso no cancela un cómputo que ya haya salido.",
      answerText:
        "La petición se ha detenido. No se acepta un resultado tardío ni se inicia otra llamada.",
    };
  }
  if (!budgetOpen(state.startedAt, ports.now())) {
    emitStep({ ...state, ledger }, emit, {
      kind: "error",
      status: "La operación terminó fuera del tiempo local. El resultado no se acepta.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    return {
      ledger,
      evidence: [],
      terminal: "error",
      terminalReason: "La operación terminó fuera del tiempo local.",
      answerText:
        "La operación terminó fuera del tiempo local. No se acepta el resultado. Parar la espera no cancela un cómputo ya enviado.",
    };
  }
  return null;
}

function acceptChunks(
  chunks: readonly CragChunk[],
  scope: CragScope,
): {
  accepted: CragChunk[];
  dropped: { chunkId: string; reason: string }[];
} {
  const accepted: CragChunk[] = [];
  const dropped: { chunkId: string; reason: string }[] = [];
  for (const chunk of chunks) {
    if (!chunkInScope(chunk, scope)) {
      dropped.push({
        chunkId: chunk.chunkId || "sin-id",
        reason: "Fuera de la audiencia, el corpus o el perfil de esta consulta.",
      });
      continue;
    }
    accepted.push(chunk);
  }
  return { accepted: dedupeChunks(accepted).slice(0, CRAG_BOUNDS.maxCandidates), dropped };
}

export async function runCragTurn(input: CragTurnInput): Promise<CragTurnResult> {
  const steps: CragStep[] = [];
  const emit = (step: CragStep) => {
    steps.push(step);
    input.onStep?.(step);
  };
  const question = input.question.trim();
  const initial: GraphState = {
    originalQuestion: question,
    currentQuery: question,
    scope: input.scope,
    retrievalCount: 0,
    reformulationCount: 0,
    seenQueries: [question],
    candidates: [],
    retained: [],
    discarded: [],
    shown: [],
    ranking: [],
    decision: null,
    terminal: "pending",
    terminalReason: "",
    answerText: "",
    evidence: [],
    ledger: emptyLedger(input.ports.measured),
    startedAt: input.ports.now(),
    fixture: input.fixture,
    scenarioId: input.scenarioId,
  };

  const graph = new StateGraph(CragGraphState)
    .addNode("validate", (state) => {
      const stop = blocked(state, input.ports, emit);
      if (stop) {
        return stop;
      }
      if (state.scope.audience === "program" && isScheduleQuestion(state.originalQuestion)) {
        emitStep(state, emit, {
          kind: "clarify",
          status: "Falta el grupo. No hay búsqueda ni evaluación.",
          evidenceStatus: null,
          discardedIds: [],
        });
        return {
          terminal: "clarify" as const,
          terminalReason: "Falta elegir el grupo.",
          answerText: CLARIFY,
        };
      }
      return { terminal: "pending" as const };
    })
    .addNode("retrieve", async (state) => {
      const stop = blocked(state, input.ports, emit);
      if (stop) {
        return stop;
      }
      const reservation = input.ports.reserve("retrieval");
      if (!reservation.ok) {
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva del intento no permite otra búsqueda.",
          evidenceStatus: null,
          discardedIds: [],
        });
        return {
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se inicia la búsqueda porque la reserva del intento no está disponible.",
        };
      }
      const started = input.ports.now();
      let result: Awaited<ReturnType<CragPorts["retrieve"]>>;
      try {
        result = await input.ports.retrieve({
          query: state.currentQuery,
          scope: state.scope,
          limit: CRAG_BOUNDS.maxCandidates,
          attempt: state.retrievalCount + 1,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        result = { ok: false, reason: "La recuperación ha fallado." };
      }
      const ledger = noteCall(
        state.ledger,
        "retrieval",
        input.ports.measured,
        result.ok ? result.providerCall : true,
        started,
        input.ports.now(),
      );
      const retrievalCount = state.retrievalCount + 1;
      const late = finishedLate({ ...state, retrievalCount }, input.ports, emit, ledger);
      if (late) {
        return { ...late, retrievalCount };
      }
      if (!result.ok) {
        const next = { ...state, ledger, retrievalCount };
        emitStep(next, emit, {
          kind: "error",
          status: "La recuperación ha fallado. No es una falta de evidencia.",
          evidenceStatus: null,
          discardedIds: [],
        });
        return {
          ledger,
          retrievalCount,
          terminal: "error" as const,
          terminalReason: "La recuperación ha fallado.",
          answerText: "La recuperación ha fallado. No se interpreta como ausencia de evidencia.",
        };
      }
      const filtered = acceptChunks(result.chunks, state.scope);
      const discarded = [
        ...state.discarded,
        ...filtered.dropped.map((item) => ({ ...item, attempt: retrievalCount })),
      ].slice(0, CRAG_BOUNDS.maxDiscarded);
      const next = {
        ...state,
        ledger,
        retrievalCount,
        candidates: filtered.accepted,
        discarded,
      };
      emitStep(next, emit, {
        kind: "retrieve",
        status:
          filtered.accepted.length === 0
            ? "La búsqueda no dejó fragmentos de este corpus y audiencia."
            : `Búsqueda ${String(retrievalCount)}. ${String(filtered.accepted.length)} fragmentos en alcance.`,
        evidenceStatus: null,
        discardedIds: filtered.dropped.map((item) => item.chunkId),
      });
      return {
        ledger,
        retrievalCount,
        candidates: filtered.accepted,
        discarded,
        terminal: "pending" as const,
      };
    })
    .addNode("rank", async (state) => {
      const shown = dedupeChunks([...state.retained, ...state.candidates]).slice(
        0,
        CRAG_BOUNDS.maxCandidates,
      );
      if (shown.length === 0) {
        const decision: CragAssessment = {
          status: "insufficient",
          reason: "No hay fragmentos utilizables en esta búsqueda.",
          gaps: [],
          usefulIds: [],
        };
        emitStep(state, emit, {
          kind: "rank",
          status: "Sin fragmentos. No se llama al evaluador.",
          evidenceStatus: "insufficient",
          discardedIds: [],
        });
        return { shown, decision, terminal: "pending" as const };
      }
      const stop = blocked(state, input.ports, emit);
      if (stop) {
        return { ...stop, shown };
      }
      const reservation = input.ports.reserve("evaluation");
      if (!reservation.ok) {
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva no permite evaluar esta búsqueda.",
          evidenceStatus: null,
          discardedIds: [],
        });
        return {
          shown,
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se evalúa la búsqueda porque la reserva del intento no está disponible.",
        };
      }
      const started = input.ports.now();
      let result: Awaited<ReturnType<CragPorts["rankAndAssess"]>>;
      try {
        result = await input.ports.rankAndAssess({
          question: state.originalQuestion,
          query: state.currentQuery,
          chunks: shown,
          attempt: state.retrievalCount,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        result = { ok: false, reason: "El evaluador ha fallado.", providerCall: true };
      }
      const ledger = noteCall(
        state.ledger,
        "evaluation",
        input.ports.measured,
        result.providerCall,
        started,
        input.ports.now(),
      );
      const late = finishedLate(state, input.ports, emit, ledger);
      if (late) {
        return { ...late, shown };
      }
      if (!result.ok) {
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: "El evaluador ha fallado. No se reintenta.",
          evidenceStatus: null,
          discardedIds: [],
        });
        return {
          shown,
          ledger,
          terminal: "error" as const,
          terminalReason: "El evaluador ha fallado.",
          answerText:
            "El evaluador no ha completado la decisión. No se reintenta ni se cambia de etapa.",
        };
      }
      const parsed = validateRankingAndAssessment(shown, result.raw);
      if (!parsed.ok) {
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: parsed.reason,
          evidenceStatus: null,
          discardedIds: [],
        });
        return {
          shown,
          ledger,
          terminal: "error" as const,
          terminalReason: parsed.reason,
          answerText: "El evaluador devolvió una salida que no se puede usar. No se reintenta.",
        };
      }
      const order = parsed.ranking
        .filter((hit) => parsed.assessment.usefulIds.includes(hit.chunkId))
        .map((hit) => `${hit.chunkId} ${hit.score.toFixed(3)}`)
        .join(", ");
      const status = `${parsed.assessment.reason} Orden: ${order || "sin evidencia útil"}.`.slice(
        0,
        CRAG_BOUNDS.maxReasonChars,
      );
      emitStep({ ...state, ledger, decision: parsed.assessment }, emit, {
        kind: "rank",
        status,
        evidenceStatus: parsed.assessment.status,
        discardedIds: [],
        retainedIds: parsed.assessment.usefulIds,
      });
      return {
        shown,
        ranking: parsed.ranking,
        ledger,
        decision: parsed.assessment,
        terminal: "pending" as const,
      };
    })
    .addNode("retain", (state) => {
      const keptResult = retainEvidence({
        retained: state.retained,
        shown: state.shown,
        usefulIds: state.decision?.usefulIds ?? [],
        ranking: state.ranking,
      });
      if (!keptResult.ok) {
        emitStep(state, emit, {
          kind: "error",
          status: keptResult.reason,
          evidenceStatus: "partial",
          discardedIds: [],
        });
        return {
          terminal: "error" as const,
          terminalReason: keptResult.reason,
          answerText: "No se conserva evidencia porque la ordenación no cubre los ids útiles.",
          evidence: [],
        };
      }
      const kept = keptResult.chunks;
      const keptIds = new Set(kept.map((chunk) => chunk.chunkId));
      const rejected = state.shown.filter((chunk) => !keptIds.has(chunk.chunkId));
      const discarded = [
        ...state.discarded,
        ...rejected.map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "No forma parte de la evidencia útil de esta pasada.",
          attempt: Math.max(1, state.retrievalCount),
        })),
      ].slice(0, CRAG_BOUNDS.maxDiscarded);
      emitStep({ ...state, retained: kept, discarded }, emit, {
        kind: "retain",
        status: state.decision?.gaps[0] ?? "Se conserva solo la evidencia útil.",
        evidenceStatus: "partial",
        discardedIds: rejected.map((chunk) => chunk.chunkId),
        retainedIds: kept.map((chunk) => chunk.chunkId),
      });
      return { retained: kept, discarded, candidates: [] };
    })
    .addNode("discard", (state) => {
      const rejected = state.shown.filter(
        (chunk) => !state.retained.some((kept) => kept.chunkId === chunk.chunkId),
      );
      const discarded = [
        ...state.discarded,
        ...rejected.map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "La pasada lo rechazó y no entra en la respuesta.",
          attempt: Math.max(1, state.retrievalCount),
        })),
      ].slice(0, CRAG_BOUNDS.maxDiscarded);
      emitStep({ ...state, discarded }, emit, {
        kind: "discard",
        status: "Se descarta el contexto de esta pasada.",
        evidenceStatus: "insufficient",
        discardedIds: rejected.map((chunk) => chunk.chunkId),
      });
      return { discarded, candidates: [], decision: state.decision };
    })
    .addNode("reformulate", async (state) => {
      const stop = blocked(state, input.ports, emit);
      if (stop) {
        return stop;
      }
      const reservation = input.ports.reserve("reformulation");
      if (!reservation.ok) {
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva no permite reformular.",
          evidenceStatus: state.decision?.status ?? null,
          discardedIds: [],
        });
        return {
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se reformula porque la reserva del intento no está disponible.",
        };
      }
      const started = input.ports.now();
      let result: Awaited<ReturnType<CragPorts["reformulate"]>>;
      try {
        result = await input.ports.reformulate({
          question: state.originalQuestion,
          query: state.currentQuery,
          gaps: state.decision?.gaps ?? [],
          attempt: state.reformulationCount + 1,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        result = { ok: false, reason: "La reformulación ha fallado.", providerCall: true };
      }
      const ledger = noteCall(
        state.ledger,
        "reformulation",
        input.ports.measured,
        result.ok ? result.providerCall : true,
        started,
        input.ports.now(),
      );
      const reformulationCount = state.reformulationCount + 1;
      const late = finishedLate({ ...state, reformulationCount }, input.ports, emit, ledger);
      if (late) {
        return { ...late, reformulationCount };
      }
      if (!result.ok) {
        const reason = input.ports.signal.aborted
          ? "La reformulación se interrumpió."
          : "La reformulación no se pudo usar.";
        emitStep({ ...state, ledger, reformulationCount }, emit, {
          kind: input.ports.signal.aborted ? "abort" : "refuse",
          status: reason,
          evidenceStatus: state.decision?.status ?? null,
          discardedIds: [],
        });
        return {
          ledger,
          reformulationCount,
          terminal: input.ports.signal.aborted ? ("aborted" as const) : ("refuse" as const),
          terminalReason: reason,
          answerText: input.ports.signal.aborted
            ? "La petición se ha detenido durante la reformulación."
            : REFUSE,
        };
      }
      const parsed = validateReformulation(result.raw, state.seenQueries);
      if (!parsed.ok) {
        emitStep({ ...state, ledger, reformulationCount }, emit, {
          kind: "refuse",
          status: parsed.reason,
          evidenceStatus: state.decision?.status ?? null,
          discardedIds: [],
        });
        return {
          ledger,
          reformulationCount,
          terminal: "refuse" as const,
          terminalReason: parsed.reason,
          answerText: `${REFUSE} ${parsed.reason}`,
        };
      }
      emitStep({ ...state, ledger, reformulationCount, currentQuery: parsed.query }, emit, {
        kind: "reformulate",
        query: parsed.query,
        status: "Nueva consulta de búsqueda. La pregunta original no cambia.",
        evidenceStatus: state.decision?.status ?? null,
        discardedIds: [],
      });
      return {
        ledger,
        reformulationCount,
        currentQuery: parsed.query,
        seenQueries: [...state.seenQueries, parsed.query],
        candidates: [],
        terminal: "pending" as const,
      };
    })
    .addNode("answer", async (state) => {
      const resolved = evidenceForAnswer(
        state.shown,
        state.decision?.usefulIds ?? [],
        state.ranking,
      );
      if (!resolved.ok) {
        emitStep(state, emit, {
          kind: "error",
          status: resolved.reason,
          evidenceStatus: "sufficient",
          discardedIds: [],
        });
        return {
          terminal: "error" as const,
          terminalReason: resolved.reason,
          answerText: "La etiqueta de evidencia suficiente no tenía fragmentos utilizables.",
          evidence: [],
        };
      }
      const stop = blocked(state, input.ports, emit);
      if (stop) {
        return { ...stop, evidence: [] };
      }
      const reservation = input.ports.reserve("generation");
      if (!reservation.ok) {
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva no permite generar la respuesta.",
          evidenceStatus: "sufficient",
          discardedIds: [],
        });
        return {
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se genera porque la reserva del intento no está disponible.",
          evidence: [],
        };
      }
      const started = input.ports.now();
      let result: Awaited<ReturnType<CragPorts["generate"]>>;
      try {
        result = await input.ports.generate({
          question: state.originalQuestion,
          evidence: resolved.chunks,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        result = { ok: false, reason: "La generación ha fallado.", providerCall: true };
      }
      const ledger = noteCall(
        state.ledger,
        "generation",
        input.ports.measured,
        result.ok ? result.providerCall : true,
        started,
        input.ports.now(),
      );
      const late = finishedLate(state, input.ports, emit, ledger);
      if (late || !result.ok) {
        if (late) {
          return late;
        }
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: "La generación ha fallado.",
          evidenceStatus: "sufficient",
          discardedIds: [],
          retainedIds: resolved.chunks.map((chunk) => chunk.chunkId),
        });
        return {
          ledger,
          evidence: [],
          terminal: "error" as const,
          terminalReason: "La generación ha fallado.",
          answerText: "La generación ha fallado. No se sustituye por otra etapa.",
        };
      }
      const ledgerWithUsage = {
        ...ledger,
        usage: result.usage,
        cost: result.cost,
        partial: true,
      };
      emitStep({ ...state, ledger: ledgerWithUsage }, emit, {
        kind: "answer",
        status: "Respuesta solo con la evidencia aceptada.",
        evidenceStatus: "sufficient",
        discardedIds: [],
        retainedIds: resolved.chunks.map((chunk) => chunk.chunkId),
      });
      return {
        ledger: ledgerWithUsage,
        retained: resolved.chunks,
        evidence: resolved.chunks,
        answerText: result.text,
        terminal: "answer" as const,
        terminalReason: state.decision?.reason ?? "Evidencia suficiente.",
      };
    })
    .addNode("refuse", (state) => {
      const seen = new Set(
        state.discarded.map((item) => `${String(item.attempt)}:${item.chunkId}`),
      );
      const attempt = Math.max(1, state.retrievalCount);
      const extra = state.shown
        .filter((chunk) => !state.retained.some((kept) => kept.chunkId === chunk.chunkId))
        .filter((chunk) => !seen.has(`${String(attempt)}:${chunk.chunkId}`))
        .map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "La última pasada lo rechazó y no entra en la respuesta.",
          attempt,
        }));
      const discarded = [...state.discarded, ...extra].slice(0, CRAG_BOUNDS.maxDiscarded);
      emitStep({ ...state, discarded }, emit, {
        kind: "refuse",
        status: "Los intentos se agotaron sin evidencia suficiente.",
        evidenceStatus: state.decision?.status ?? "insufficient",
        discardedIds: discarded.slice(-10).map((item) => item.chunkId),
      });
      return {
        discarded,
        terminal: "refuse" as const,
        terminalReason: "Se agotaron los intentos sin evidencia suficiente.",
        answerText: REFUSE,
        evidence: [],
      };
    })
    .addEdge(START, "validate")
    .addConditionalEdges("validate", (state) => (state.terminal === "pending" ? "retrieve" : END))
    .addConditionalEdges("retrieve", (state) => (state.terminal === "pending" ? "rank" : END))
    .addConditionalEdges("rank", (state) => {
      if (state.terminal !== "pending") {
        return END;
      }
      const next = routeAfterAssessment({
        status: state.decision?.status ?? null,
        retrievalCount: state.retrievalCount,
        reformulationCount: state.reformulationCount,
      });
      if (next === "stop") {
        return "refuse";
      }
      return next;
    })
    .addConditionalEdges("retain", (state) => (state.terminal === "pending" ? "reformulate" : END))
    .addEdge("discard", "reformulate")
    .addConditionalEdges("reformulate", (state) =>
      state.terminal === "pending" ? "retrieve" : END,
    )
    .addEdge("answer", END)
    .addEdge("refuse", END);

  let finalState: GraphState;
  try {
    finalState = await graph.compile().invoke(initial, { recursionLimit: 20 });
  } catch {
    emit({
      runId: input.scope.runId,
      kind: "error",
      retrieval: initial.retrievalCount,
      reformulation: initial.reformulationCount,
      query: question.slice(0, CRAG_BOUNDS.maxQueryChars),
      status: "El grafo se detuvo por un límite interno.",
      evidenceStatus: null,
      retainedIds: [],
      discardedIds: [],
    });
    finalState = {
      ...initial,
      terminal: "error",
      terminalReason: "El grafo se detuvo por un límite interno.",
      answerText: "El recorrido se detuvo por un límite interno. No se lanza otra búsqueda.",
    };
  }

  const terminal = finalState.terminal === "pending" ? "error" : finalState.terminal;
  const summary = summaryFrom(
    {
      ...finalState,
      terminal,
      terminalReason: finalState.terminalReason || "El recorrido no terminó en un estado usable.",
      answerText: finalState.answerText || "El recorrido no produjo una respuesta controlada.",
    },
    input.fixture,
  );
  return {
    terminal: summary.terminal,
    answerText: finalState.answerText || summary.reason,
    evidence: terminal === "answer" ? finalState.evidence : [],
    summary,
    steps,
  };
}

function callCount(executions: number, providerCalls: number | null, durationMs: number | null) {
  return {
    executions: Math.min(3, Math.max(0, executions)),
    providerCalls,
    durationMs,
  };
}

function summaryFrom(state: GraphState, fixture: boolean): CragSummary {
  const terminal = state.terminal === "pending" ? "error" : state.terminal;
  const draft = {
    runId: state.scope.runId,
    fixture,
    scenarioId: state.scenarioId,
    measured: state.ledger.retrievalProviderCalls !== null,
    partial: true,
    audience: state.scope.audience,
    corpusVersion: state.scope.corpusVersion,
    profileId: state.scope.profileId,
    originalQuestion: state.originalQuestion.slice(0, 2_000),
    currentQuery: state.currentQuery.slice(0, CRAG_BOUNDS.maxQueryChars),
    retrievalCount: Math.min(CRAG_BOUNDS.maxRetrievals, state.retrievalCount),
    reformulationCount: Math.min(CRAG_BOUNDS.maxReformulations, state.reformulationCount),
    attemptsRemaining: Math.max(0, CRAG_BOUNDS.maxRetrievals - state.retrievalCount),
    rewritesRemaining: Math.max(0, CRAG_BOUNDS.maxReformulations - state.reformulationCount),
    evidenceStatus: state.decision?.status ?? null,
    terminal,
    reason: (state.terminalReason || "Recorrido terminado.").slice(0, CRAG_BOUNDS.maxReasonChars),
    retained: state.retained.slice(0, CRAG_BOUNDS.maxRetained).map((chunk) => ({
      chunkId: chunk.chunkId,
      reason: `Puntuación ${chunk.score === null ? "desconocida" : chunk.score.toFixed(3)}. Conservado en el orden validado.`,
      score: chunk.score,
    })),
    discarded: state.discarded.slice(0, CRAG_BOUNDS.maxDiscarded).map((item) => ({
      chunkId: item.chunkId.slice(0, CRAG_BOUNDS.maxIdChars) || "sin-id",
      reason: item.reason.slice(0, CRAG_BOUNDS.maxReasonChars),
      attempt: Math.min(CRAG_BOUNDS.maxRetrievals, Math.max(1, item.attempt)),
    })),
    calls: {
      retrieval: callCount(
        state.ledger.retrievalExecutions,
        state.ledger.retrievalProviderCalls,
        state.ledger.retrievalMs,
      ),
      evaluation: callCount(
        state.ledger.evaluationExecutions,
        state.ledger.evaluationProviderCalls,
        state.ledger.evaluationMs,
      ),
      reformulation: callCount(
        state.ledger.reformulationExecutions,
        state.ledger.reformulationProviderCalls,
        state.ledger.reformulationMs,
      ),
      generation: callCount(
        state.ledger.generationExecutions,
        state.ledger.generationProviderCalls,
        state.ledger.generationMs,
      ),
    },
    usage: state.ledger.usage,
    cost: state.ledger.cost,
  };
  const parsed = cragSummarySchema.safeParse(draft);
  if (parsed.success) {
    return parsed.data;
  }
  return cragSummarySchema.parse({
    ...draft,
    scenarioId: null,
    retained: [],
    discarded: [],
    reason: "El resumen del recorrido no cumplió el contrato.",
    terminal: "error",
    evidenceStatus: null,
  });
}
