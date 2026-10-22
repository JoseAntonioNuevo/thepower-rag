// GUÍA DE LECTURA · apps/api/src/crag-graph.ts
// Grafo LangGraph de CRAG (RAG correctivo) para un turno: validar → buscar → evaluar → conservar o
// descartar → reformular → buscar otra vez… hasta responder con evidencia suficiente o rechazar.
// Como mucho 3 búsquedas y 2 reformulaciones; cada paso se emite para la traza visible del chat.
// Esquemas y tipos del paso y del resumen de CRAG.
import {
  cragStepSchema,
  cragSummarySchema,
  type CragStep,
  type CragSummary,
} from "@thepower-rag/contracts";
// Reglas puras del núcleo: cotas, alcance, duplicados, retención y validación de salidas del modelo.
import {
  // Topes del grafo y comprobación de presupuesto.
  CRAG_BOUNDS,
  budgetOpen,
  // Alcance (grupo, corpus, perfil), duplicados y evidencia para responder.
  chunkInScope,
  dedupeChunks,
  evidenceForAnswer,
  // Calendario, plazo restante, retención y ruta tras evaluar.
  isScheduleQuestion,
  remainingBudgetMs,
  retainEvidence,
  routeAfterAssessment,
  // Validadores estrictos de las salidas del modelo (reordenamiento, suficiencia y reformulación).
  validateAssessment,
  validateRanking,
  validateReformulation,
  // Tipos de la evaluación, fragmento, puertos, alcance y resultado ordenado.
  type CragAssessment,
  type CragChunk,
  type CragPorts,
  type CragScope,
  type RankedHit,
} from "@thepower-rag/core";
// LangGraph: estado, nodos de inicio y fin y grafo.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

// Estado final del turno, o pending mientras sigue.
type Terminal = CragSummary["terminal"] | "pending";

// Fragmento descartado con su motivo e intento.
interface Discarded {
  // Id del fragmento.
  chunkId: string;
  // Motivo.
  reason: string;
  // Búsqueda en la que se descartó.
  attempt: number;
}

// Contadores de llamadas, tiempos, consumo y coste del turno.
interface Ledger {
  // Búsquedas ejecutadas.
  retrievalExecutions: number;
  // Evaluaciones ejecutadas.
  evaluationExecutions: number;
  // Reformulaciones ejecutadas.
  reformulationExecutions: number;
  // Generaciones ejecutadas.
  generationExecutions: number;
  // Búsquedas que llamaron al proveedor (null si no se mide).
  retrievalProviderCalls: number | null;
  // Evaluaciones que llamaron al proveedor.
  evaluationProviderCalls: number | null;
  // Reformulaciones que llamaron al proveedor.
  reformulationProviderCalls: number | null;
  // Generaciones que llamaron al proveedor.
  generationProviderCalls: number | null;
  // Milisegundos en búsquedas.
  retrievalMs: number | null;
  // Milisegundos en evaluaciones.
  evaluationMs: number | null;
  // Milisegundos en reformulaciones.
  reformulationMs: number | null;
  // Milisegundos en generación.
  generationMs: number | null;
  // Medición parcial: no incluye todo el coste.
  partial: boolean;
  // Tokens de la respuesta final.
  usage: CragSummary["usage"];
  // Coste de la respuesta final.
  cost: CragSummary["cost"];
}

// Estado del grafo durante el turno.
interface GraphState {
  // Pregunta original del alumno.
  originalQuestion: string;
  // Consulta de búsqueda actual (cambia al reformular).
  currentQuery: string;
  // Ámbito: audiencia, corpus y perfil.
  scope: CragScope;
  // Búsquedas hechas.
  retrievalCount: number;
  // Reformulaciones hechas.
  reformulationCount: number;
  // Consultas ya usadas.
  seenQueries: string[];
  // Fragmentos de la última búsqueda.
  candidates: CragChunk[];
  // Evidencia útil conservada.
  retained: CragChunk[];
  // Fragmentos descartados.
  discarded: Discarded[];
  // Fragmentos que se enseñaron al evaluador.
  shown: CragChunk[];
  // Orden del evaluador.
  ranking: RankedHit[];
  // Salida bruta de una llamada unificada rankAndAssess pendiente de valorar en assess.
  rawEvaluation: unknown;
  // Decisión del evaluador.
  decision: CragAssessment | null;
  // Estado final o pending.
  terminal: Terminal;
  // Motivo del final.
  terminalReason: string;
  // Texto de la respuesta.
  answerText: string;
  // Evidencia citada en la respuesta.
  evidence: CragChunk[];
  // Contadores.
  ledger: Ledger;
  // Inicio del turno.
  startedAt: number;
  // Plazo único de este turno; no se reinicia entre recuperaciones ni llamadas.
  executionBudgetMs: number;
  // Si son datos de prueba.
  fixture: boolean;
  // Escenario de prueba.
  scenarioId: string | null;
}

// Canales del estado para LangGraph (cada nodo sustituye los campos que devuelve).
const CragGraphState = Annotation.Root({
  // Pregunta del alumno (nunca se sustituye) y consulta de búsqueda actual.
  originalQuestion: Annotation<string>,
  currentQuery: Annotation<string>,
  // Alcance del turno: grupo, corpus, perfil y id de ejecución.
  scope: Annotation<CragScope>,
  // Contadores de búsquedas y reformulaciones, y consultas ya usadas.
  retrievalCount: Annotation<number>,
  reformulationCount: Annotation<number>,
  seenQueries: Annotation<string[]>,
  // Candidatos de la pasada, conservados, descartados y mostrados al evaluador.
  candidates: Annotation<CragChunk[]>,
  retained: Annotation<CragChunk[]>,
  discarded: Annotation<Discarded[]>,
  shown: Annotation<CragChunk[]>,
  // Orden validado, salida bruta pendiente y última decisión del evaluador.
  ranking: Annotation<RankedHit[]>,
  rawEvaluation: Annotation<unknown>,
  decision: Annotation<CragAssessment | null>,
  // Final del recorrido, motivo, texto de la respuesta y evidencia usada.
  terminal: Annotation<Terminal>,
  terminalReason: Annotation<string>,
  answerText: Annotation<string>,
  evidence: Annotation<CragChunk[]>,
  // Libro de llamadas, inicio del turno (para el plazo de 20 s) y guion de demo.
  ledger: Annotation<Ledger>,
  startedAt: Annotation<number>,
  executionBudgetMs: Annotation<number>,
  fixture: Annotation<boolean>,
  scenarioId: Annotation<string | null>,
});

// Respuesta cuando falta el grupo en una pregunta de calendario.
const CLARIFY =
  "La pregunta parece de calendario. Elige el grupo con clases los lunes y miércoles o el grupo con clases los martes y jueves. La selección general no muestra los dos calendarios.";
// Respuesta cuando no hay evidencia suficiente.
const REFUSE =
  "No hay evidencia suficiente en el corpus del curso. No se responde con fragmentos rechazados ni con una búsqueda agotada.";

// Entrada de un turno CRAG.
export interface CragTurnInput {
  // Pregunta.
  question: string;
  // Ámbito.
  scope: CragScope;
  // Puertos: búsqueda, evaluador, reformulación y generación.
  ports: CragPorts;
  // Si son datos de prueba.
  fixture: boolean;
  // Escenario.
  scenarioId: string | null;
  // Plazo opcional del perfil; la demo y las referencias anteriores conservan 20 segundos.
  executionBudgetMs?: number;
  // Callback de cada paso.
  onStep?: (step: CragStep) => void;
}

// Resultado de un turno.
export interface CragTurnResult {
  // Estado final.
  terminal: CragSummary["terminal"];
  // Texto.
  answerText: string;
  // Evidencia.
  evidence: CragChunk[];
  // Resumen.
  summary: CragSummary;
  // Pasos emitidos.
  steps: CragStep[];
}

// Contadores a cero (null si no se mide al proveedor).
function emptyLedger(measured: boolean): Ledger {
  // Libro inicial.
  return {
    // Ejecuciones de cada paso (las cuenta el grafo).
    retrievalExecutions: 0,
    evaluationExecutions: 0,
    reformulationExecutions: 0,
    generationExecutions: 0,
    // Llamadas de pago: 0 si se miden; null si no se pueden medir (demo).
    retrievalProviderCalls: measured ? 0 : null,
    evaluationProviderCalls: measured ? 0 : null,
    reformulationProviderCalls: measured ? 0 : null,
    generationProviderCalls: measured ? 0 : null,
    // Duraciones desconocidas hasta medirlas.
    retrievalMs: null,
    evaluationMs: null,
    reformulationMs: null,
    generationMs: null,
    // El consumo siempre es parcial: no hay un total inventado.
    partial: true,
    usage: null,
    cost: null,
  };
}

// Suma una llamada al libro: ejecuciones, llamadas al proveedor y milisegundos.
function noteCall(
  ledger: Ledger,
  kind: "retrieval" | "evaluation" | "reformulation" | "generation",
  measured: boolean,
  providerCall: boolean,
  started: number,
  now: number,
): Ledger {
  // Copia del libro.
  const next = { ...ledger, partial: true };
  // Duración de la llamada o null si el reloj no es fiable.
  const elapsed =
    Number.isFinite(now - started) && now >= started ? Math.round(now - started) : null;
  // Búsqueda.
  if (kind === "retrieval") {
    // Una más.
    next.retrievalExecutions += 1;
    // Si se mide.
    if (measured) {
      // Llamada al proveedor.
      next.retrievalProviderCalls = (next.retrievalProviderCalls ?? 0) + (providerCall ? 1 : 0);
      // Tiempo.
      next.retrievalMs = (next.retrievalMs ?? 0) + (elapsed ?? 0);
    }
  } else if (kind === "evaluation") {
    // Evaluación.
    next.evaluationExecutions += 1;
    // Si se mide.
    if (measured) {
      // Llamada al proveedor.
      next.evaluationProviderCalls = (next.evaluationProviderCalls ?? 0) + (providerCall ? 1 : 0);
      // Tiempo.
      next.evaluationMs = (next.evaluationMs ?? 0) + (elapsed ?? 0);
    }
  } else if (kind === "reformulation") {
    // Reformulación.
    next.reformulationExecutions += 1;
    // Si se mide.
    if (measured) {
      // Llamada al proveedor.
      next.reformulationProviderCalls =
        (next.reformulationProviderCalls ?? 0) + (providerCall ? 1 : 0);
      // Tiempo.
      next.reformulationMs = (next.reformulationMs ?? 0) + (elapsed ?? 0);
    }
  } else {
    // Generación.
    next.generationExecutions += 1;
    // Si se mide.
    if (measured) {
      // Llamada al proveedor.
      next.generationProviderCalls = (next.generationProviderCalls ?? 0) + (providerCall ? 1 : 0);
      // Tiempo.
      next.generationMs = (next.generationMs ?? 0) + (elapsed ?? 0);
    }
  }
  // Libro actualizado.
  return next;
}

// Construye un paso visible validado y lo emite.
function emitStep(
  state: GraphState,
  emit: (step: CragStep) => void,
  step: Omit<CragStep, "runId" | "query" | "retrieval" | "reformulation" | "retainedIds"> & {
    // Consulta del paso.
    query?: string;
    // Ids conservados.
    retainedIds?: string[];
  },
): CragStep {
  // Paso recortado y validado con el esquema.
  const built = cragStepSchema.parse({
    // Id de ejecución, tipo de paso y contadores en ese momento.
    runId: state.scope.runId,
    kind: step.kind,
    retrieval: state.retrievalCount,
    reformulation: state.reformulationCount,
    // Consulta y estado recortados a los límites del contrato.
    query: (step.query ?? state.currentQuery).slice(0, CRAG_BOUNDS.maxQueryChars),
    status: step.status.slice(0, CRAG_BOUNDS.maxReasonChars),
    // Estado de la evidencia, ids conservados (como mucho maxRetained) y descartados.
    evidenceStatus: step.evidenceStatus,
    retainedIds: (step.retainedIds ?? state.retained.map((chunk) => chunk.chunkId)).slice(
      0,
      CRAG_BOUNDS.maxRetained,
    ),
    discardedIds: step.discardedIds.slice(0, 10),
  });
  // Lo emite.
  emit(built);
  // Lo devuelve.
  return built;
}

// Para el turno si se canceló o se agotó el tiempo; null si puede seguir.
function blocked(
  state: GraphState,
  ports: CragPorts,
  emit: (step: CragStep) => void,
): Partial<GraphState> | null {
  // Cancelado.
  if (ports.signal.aborted) {
    // Paso abort.
    emitStep(state, emit, {
      kind: "abort",
      status: "La petición se ha detenido. No empieza trabajo nuevo.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    // Final aborted.
    return {
      terminal: "aborted",
      terminalReason:
        "La espera local se ha detenido. Eso no cancela un cómputo que ya haya salido.",
      answerText: "La petición se ha detenido. No se inicia otra búsqueda ni otra llamada.",
    };
  }
  // Sin tiempo.
  if (!budgetOpen(state.startedAt, ports.now(), state.executionBudgetMs)) {
    // Paso error.
    emitStep(state, emit, {
      kind: "error",
      status: "Se agotó el tiempo local antes de la siguiente operación.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    // Final error.
    return {
      terminal: "error",
      terminalReason: "Se agotó el tiempo local del recorrido.",
      answerText: "Se agotó el tiempo local. No se inicia otra recuperación.",
    };
  }
  // Puede seguir.
  return null;
}

// Tiempo restante para la siguiente llamada.
function callBudget(state: GraphState, ports: CragPorts): { remainingMs: number } {
  // Milisegundos.
  return {
    remainingMs: remainingBudgetMs(state.startedAt, ports.now(), state.executionBudgetMs),
  };
}

// Tras una llamada: rechaza el resultado si llegó cancelado o tarde.
function finishedLate(
  state: GraphState,
  ports: CragPorts,
  emit: (step: CragStep) => void,
  ledger: Ledger,
): Partial<GraphState> | null {
  // Cancelado mientras tanto.
  if (ports.signal.aborted) {
    // Paso abort.
    emitStep({ ...state, ledger }, emit, {
      kind: "abort",
      status: "La operación ya contaba y la petición se detuvo. No empieza otra.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    // Final aborted sin evidencia.
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
  // Fuera de tiempo.
  if (!budgetOpen(state.startedAt, ports.now(), state.executionBudgetMs)) {
    // Paso error.
    emitStep({ ...state, ledger }, emit, {
      kind: "error",
      status: "La operación terminó fuera del tiempo local. El resultado no se acepta.",
      evidenceStatus: state.decision?.status ?? null,
      discardedIds: [],
    });
    // Final error sin evidencia.
    return {
      ledger,
      evidence: [],
      terminal: "error",
      terminalReason: "La operación terminó fuera del tiempo local.",
      answerText:
        "La operación terminó fuera del tiempo local. No se acepta el resultado. Parar la espera no cancela un cómputo ya enviado.",
    };
  }
  // Resultado aceptable.
  return null;
}

// Separa los fragmentos en alcance de los que no lo están.
function acceptChunks(
  chunks: readonly CragChunk[],
  scope: CragScope,
): {
  // Aceptados.
  accepted: CragChunk[];
  // Descartados con motivo.
  dropped: { chunkId: string; reason: string }[];
} {
  // Aceptados.
  const accepted: CragChunk[] = [];
  // Descartados.
  const dropped: { chunkId: string; reason: string }[] = [];
  // Cada fragmento.
  for (const chunk of chunks) {
    // Fuera de audiencia, corpus o perfil.
    if (!chunkInScope(chunk, scope)) {
      // Se descarta.
      dropped.push({
        chunkId: chunk.chunkId || "sin-id",
        reason: "Fuera de la audiencia, el corpus o el perfil de esta consulta.",
      });
      // Siguiente.
      continue;
    }
    // Se acepta.
    accepted.push(chunk);
  }
  // Sin duplicados y con tope.
  return { accepted: dedupeChunks(accepted).slice(0, CRAG_BOUNDS.maxCandidates), dropped };
}

// Ejecuta un turno CRAG completo y devuelve respuesta, evidencia, resumen y pasos.
export async function runCragTurn(input: CragTurnInput): Promise<CragTurnResult> {
  // Pasos emitidos.
  const steps: CragStep[] = [];
  // Guarda cada paso y avisa al llamador.
  const emit = (step: CragStep) => {
    // Guarda.
    steps.push(step);
    // Avisa.
    input.onStep?.(step);
  };
  // Pregunta sin espacios.
  const question = input.question.trim();
  // Estado inicial.
  const initial: GraphState = {
    // La pregunta original y la consulta empiezan iguales; la primera consulta cuenta como vista.
    originalQuestion: question,
    currentQuery: question,
    scope: input.scope,
    // Contadores a cero.
    retrievalCount: 0,
    reformulationCount: 0,
    seenQueries: [question],
    // Sin candidatos, conservados, descartados ni decisión.
    candidates: [],
    retained: [],
    discarded: [],
    shown: [],
    ranking: [],
    rawEvaluation: null,
    decision: null,
    // «pending»: aún sin final.
    terminal: "pending",
    terminalReason: "",
    answerText: "",
    evidence: [],
    // Libro inicial, reloj para el plazo único y datos de la demo.
    ledger: emptyLedger(input.ports.measured),
    startedAt: input.ports.now(),
    executionBudgetMs: input.executionBudgetMs ?? CRAG_BOUNDS.executionBudgetMs,
    fixture: input.fixture,
    scenarioId: input.scenarioId,
  };

  // Grafo: un nodo por etapa y aristas condicionales según el estado.
  const graph = new StateGraph(CragGraphState)
    // Nodo validate: calendario sin grupo pide aclaración.
    .addNode("validate", (state) => {
      // Parada.
      const stop = blocked(state, input.ports, emit);
      // Si toca.
      if (stop) {
        // Devuelve.
        return stop;
      }
      // Calendario en la vista general.
      if (state.scope.audience === "program" && isScheduleQuestion(state.originalQuestion)) {
        // Paso clarify.
        emitStep(state, emit, {
          kind: "clarify",
          status: "Falta el grupo. No hay búsqueda ni evaluación.",
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final clarify.
        return {
          terminal: "clarify" as const,
          terminalReason: "Falta elegir el grupo.",
          answerText: CLARIFY,
        };
      }
      // Sigue.
      return { terminal: "pending" as const };
    })
    // Nodo retrieve: busca en Vectorize con la consulta actual.
    .addNode("retrieve", async (state) => {
      // Parada.
      const stop = blocked(state, input.ports, emit);
      // Si toca.
      if (stop) {
        // Devuelve.
        return stop;
      }
      // Reserva de gasto de la búsqueda.
      const reservation = input.ports.reserve("retrieval");
      // Sin reserva.
      if (!reservation.ok) {
        // Paso error.
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva del intento no permite otra búsqueda.",
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final error.
        return {
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se inicia la búsqueda porque la reserva del intento no está disponible.",
        };
      }
      // Inicio.
      const started = input.ports.now();
      // Resultado.
      let result: Awaited<ReturnType<CragPorts["retrieve"]>>;
      // Un fallo se convierte en resultado.
      try {
        // Busca.
        result = await input.ports.retrieve({
          query: state.currentQuery,
          scope: state.scope,
          limit: CRAG_BOUNDS.maxCandidates,
          attempt: state.retrievalCount + 1,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        // Fallo.
        result = { ok: false, reason: "La recuperación ha fallado." };
      }
      // Anota la llamada.
      const ledger = noteCall(
        state.ledger,
        "retrieval",
        input.ports.measured,
        result.ok ? result.providerCall : true,
        started,
        input.ports.now(),
      );
      // Una búsqueda más.
      const retrievalCount = state.retrievalCount + 1;
      // ¿Cancelado o tarde?
      const late = finishedLate({ ...state, retrievalCount }, input.ports, emit, ledger);
      // Si es así.
      if (late) {
        // Final.
        return { ...late, retrievalCount };
      }
      // Fallo de búsqueda.
      if (!result.ok) {
        // Estado.
        const next = { ...state, ledger, retrievalCount };
        // Paso error.
        emitStep(next, emit, {
          kind: "error",
          status: "La recuperación ha fallado. No es una falta de evidencia.",
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final error: no es falta de evidencia.
        return {
          ledger,
          retrievalCount,
          terminal: "error" as const,
          terminalReason: "La recuperación ha fallado.",
          answerText: "La recuperación ha fallado. No se interpreta como ausencia de evidencia.",
        };
      }
      // Filtra por alcance.
      const filtered = acceptChunks(result.chunks, state.scope);
      // Añade los descartados.
      const discarded = [
        ...state.discarded,
        ...filtered.dropped.map((item) => ({ ...item, attempt: retrievalCount })),
      ].slice(0, CRAG_BOUNDS.maxDiscarded);
      // Estado siguiente.
      const next = {
        ...state,
        ledger,
        retrievalCount,
        candidates: filtered.accepted,
        discarded,
      };
      // Paso retrieve.
      emitStep(next, emit, {
        kind: "retrieve",
        status:
          filtered.accepted.length === 0
            ? "La búsqueda no dejó fragmentos de este corpus y audiencia."
            : `Búsqueda ${String(retrievalCount)}. ${String(filtered.accepted.length)} fragmentos en alcance.`,
        evidenceStatus: null,
        discardedIds: filtered.dropped.map((item) => item.chunkId),
      });
      // Candidatos.
      return {
        ledger,
        retrievalCount,
        candidates: filtered.accepted,
        discarded,
        terminal: "pending" as const,
      };
    })
    // Nodo rank: reordena los fragmentos mostrados y valida la escala [0, 1].
    .addNode("rank", async (state) => {
      // Evidencia conservada más candidatos, sin duplicados.
      const shown = dedupeChunks([...state.retained, ...state.candidates]).slice(
        0,
        CRAG_BOUNDS.maxCandidates,
      );
      // Sin fragmentos.
      if (shown.length === 0) {
        // Paso rank sin fragmentos.
        emitStep(state, emit, {
          kind: "rank",
          status: "Sin fragmentos para reordenar.",
          evidenceStatus: null,
          discardedIds: [],
        });
        // Deja el veredicto vacío para que assess cierre sin llamar al proveedor.
        return {
          shown,
          ranking: [],
          rawEvaluation: null,
          terminal: "pending" as const,
        };
      }
      // Parada.
      const stop = blocked(state, input.ports, emit);
      // Si toca.
      if (stop) {
        // Devuelve.
        return { ...stop, shown };
      }
      // Reserva de la evaluación.
      const reservation = input.ports.reserve("evaluation");
      // Sin reserva.
      if (!reservation.ok) {
        // Paso error.
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva no permite evaluar esta búsqueda.",
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final error.
        return {
          shown,
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se evalúa la búsqueda porque la reserva del intento no está disponible.",
        };
      }
      // Inicio.
      const started = input.ports.now();
      // Si el puerto ofrece rerank dedicado, se usa; si no, rankAndAssess unificado.
      const useDedicatedRerank = typeof input.ports.rerank === "function";
      // Resultado.
      let result: Awaited<ReturnType<CragPorts["rankAndAssess"]>>;
      // Un fallo se convierte en resultado.
      try {
        // Reordena (o reordena y evalúa en una sola llamada estructurada).
        result = useDedicatedRerank
          ? await input.ports.rerank!({
              question: state.originalQuestion,
              query: state.currentQuery,
              chunks: shown,
              attempt: state.retrievalCount,
              remainingMs: callBudget(state, input.ports).remainingMs,
            })
          : await input.ports.rankAndAssess({
              question: state.originalQuestion,
              query: state.currentQuery,
              chunks: shown,
              attempt: state.retrievalCount,
              remainingMs: callBudget(state, input.ports).remainingMs,
            });
      } catch {
        // Fallo.
        result = { ok: false, reason: "El evaluador ha fallado.", providerCall: true };
      }
      // Anota la llamada.
      const ledger = noteCall(
        state.ledger,
        "evaluation",
        input.ports.measured,
        result.providerCall,
        started,
        input.ports.now(),
      );
      // ¿Cancelado o tarde?
      const late = finishedLate(state, input.ports, emit, ledger);
      // Si es así.
      if (late) {
        // Final.
        return { ...late, shown };
      }
      // Fallo del evaluador.
      if (!result.ok) {
        // Paso error.
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: "El evaluador ha fallado. No se reintenta.",
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final error sin reintento.
        return {
          shown,
          ledger,
          terminal: "error" as const,
          terminalReason: "El evaluador ha fallado.",
          answerText:
            "El evaluador no ha completado la decisión. No se reintenta ni se cambia de etapa.",
        };
      }
      // Valida únicamente el reordenamiento en la escala [0, 1].
      const parsed = validateRanking(shown, result.raw);
      // Inválido.
      if (!parsed.ok) {
        // Paso error.
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: parsed.reason,
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final error.
        return {
          shown,
          ledger,
          terminal: "error" as const,
          terminalReason: parsed.reason,
          answerText: "El evaluador devolvió una salida que no se puede usar. No se reintenta.",
        };
      }
      // Orden de todos los fragmentos reordenados con su puntuación en [0, 1].
      const order = parsed.ranking
        .map((hit) => `${hit.chunkId} ${hit.score.toFixed(3)}`)
        .join(", ");
      // Paso rank.
      emitStep({ ...state, ledger }, emit, {
        kind: "rank",
        status: `Orden: ${order || "sin fragmentos"}.`.slice(0, CRAG_BOUNDS.maxReasonChars),
        evidenceStatus: null,
        discardedIds: [],
      });
      // Pasa el ranking validado y la salida bruta al nodo assess.
      return {
        shown,
        ranking: parsed.ranking,
        rawEvaluation: useDedicatedRerank ? null : result.raw,
        ledger,
        terminal: "pending" as const,
      };
    })
    // Nodo assess: valora la suficiencia de los fragmentos ya reordenados.
    .addNode("assess", async (state) => {
      // Sin fragmentos mostrados: insuficiente sin llamar al proveedor.
      if (state.shown.length === 0) {
        // Decisión insuficiente.
        const decision: CragAssessment = {
          status: "insufficient",
          reason: "No hay fragmentos utilizables en esta búsqueda.",
          gaps: [],
          usefulIds: [],
        };
        // Paso assess.
        emitStep(state, emit, {
          kind: "assess",
          status: "Sin fragmentos. No se llama al evaluador.",
          evidenceStatus: "insufficient",
          discardedIds: [],
        });
        // Decisión.
        return { decision, terminal: "pending" as const };
      }
      // Parada.
      const stop = blocked(state, input.ports, emit);
      // Si toca.
      if (stop) {
        // Devuelve.
        return stop;
      }
      // Salida bruta a validar: de rankAndAssess o de una llamada dedicada a ports.assess.
      let raw = state.rawEvaluation;
      // Libro actual.
      let ledger = state.ledger;
      // Si no vino de rankAndAssess y existe ports.assess, se ejecuta ahora.
      if (raw === null && typeof input.ports.assess === "function") {
        // Inicio.
        const started = input.ports.now();
        // Resultado.
        let result: Awaited<ReturnType<NonNullable<CragPorts["assess"]>>>;
        // try/catch.
        try {
          // Valora suficiencia.
          result = await input.ports.assess({
            question: state.originalQuestion,
            query: state.currentQuery,
            chunks: state.shown,
            ranking: state.ranking,
            attempt: state.retrievalCount,
            remainingMs: callBudget(state, input.ports).remainingMs,
          });
        } catch {
          // Fallo.
          result = { ok: false, reason: "El evaluador ha fallado.", providerCall: true };
        }
        // Si hubo llamada de pago adicional en assess, anota su duración.
        if (input.ports.measured && result.providerCall) {
          // Duración.
          const elapsed = Math.max(0, Math.round(input.ports.now() - started));
          // Suma milisegundos de evaluación.
          ledger = {
            ...ledger,
            evaluationMs: (ledger.evaluationMs ?? 0) + elapsed,
          };
        }
        // ¿Cancelado o tarde?
        const late = finishedLate(state, input.ports, emit, ledger);
        // Si es así.
        if (late) {
          // Final.
          return late;
        }
        // Fallo.
        if (!result.ok) {
          // Paso error.
          emitStep({ ...state, ledger }, emit, {
            kind: "error",
            status: "El evaluador ha fallado. No se reintenta.",
            evidenceStatus: null,
            discardedIds: [],
          });
          // Final error.
          return {
            ledger,
            terminal: "error" as const,
            terminalReason: "El evaluador ha fallado.",
            answerText:
              "El evaluador no ha completado la decisión. No se reintenta ni se cambia de etapa.",
          };
        }
        // Salida bruta.
        raw = result.raw;
      }
      // Valida la valoración de suficiencia contra los fragmentos mostrados.
      const parsed = validateAssessment(state.shown, raw);
      // Inválida.
      if (!parsed.ok) {
        // Paso error.
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: parsed.reason,
          evidenceStatus: null,
          discardedIds: [],
        });
        // Final error.
        return {
          ledger,
          terminal: "error" as const,
          terminalReason: parsed.reason,
          answerText: "El evaluador devolvió una salida que no se puede usar. No se reintenta.",
        };
      }
      // Orden de los útiles con su puntuación.
      const order = state.ranking
        .filter((hit) => parsed.assessment.usefulIds.includes(hit.chunkId))
        .map((hit) => `${hit.chunkId} ${hit.score.toFixed(3)}`)
        .join(", ");
      // Texto del paso.
      const status = `${parsed.assessment.reason} Orden: ${order || "sin evidencia útil"}.`.slice(
        0,
        CRAG_BOUNDS.maxReasonChars,
      );
      // Paso assess.
      emitStep({ ...state, ledger, decision: parsed.assessment }, emit, {
        kind: "assess",
        status,
        evidenceStatus: parsed.assessment.status,
        discardedIds: [],
        retainedIds: parsed.assessment.usefulIds,
      });
      // Decisión validada.
      return {
        ledger,
        rawEvaluation: null,
        decision: parsed.assessment,
        terminal: "pending" as const,
      };
    })
    // Nodo retain: conserva la evidencia útil de una pasada parcial.
    .addNode("retain", (state) => {
      // Retención en el orden validado.
      const keptResult = retainEvidence({
        retained: state.retained,
        shown: state.shown,
        usefulIds: state.decision?.usefulIds ?? [],
        ranking: state.ranking,
      });
      // Ranking incoherente.
      if (!keptResult.ok) {
        // Paso error.
        emitStep(state, emit, {
          kind: "error",
          status: keptResult.reason,
          evidenceStatus: "partial",
          discardedIds: [],
        });
        // Final error.
        return {
          terminal: "error" as const,
          terminalReason: keptResult.reason,
          answerText: "No se conserva evidencia porque la ordenación no cubre los ids útiles.",
          evidence: [],
        };
      }
      // Conservados.
      const kept = keptResult.chunks;
      // Ids conservados.
      const keptIds = new Set(kept.map((chunk) => chunk.chunkId));
      // Rechazados.
      const rejected = state.shown.filter((chunk) => !keptIds.has(chunk.chunkId));
      // Añade los rechazados.
      const discarded = [
        ...state.discarded,
        ...rejected.map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "No forma parte de la evidencia útil de esta pasada.",
          attempt: Math.max(1, state.retrievalCount),
        })),
      ].slice(0, CRAG_BOUNDS.maxDiscarded);
      // Paso retain.
      emitStep({ ...state, retained: kept, discarded }, emit, {
        kind: "retain",
        status: state.decision?.gaps[0] ?? "Se conserva solo la evidencia útil.",
        evidenceStatus: "partial",
        discardedIds: rejected.map((chunk) => chunk.chunkId),
        retainedIds: kept.map((chunk) => chunk.chunkId),
      });
      // Estado.
      return { retained: kept, discarded, candidates: [] };
    })
    // Nodo discard: descarta la pasada insuficiente.
    .addNode("discard", (state) => {
      // Rechazados.
      const rejected = state.shown.filter(
        (chunk) => !state.retained.some((kept) => kept.chunkId === chunk.chunkId),
      );
      // Añade los rechazados.
      const discarded = [
        ...state.discarded,
        ...rejected.map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "La pasada lo rechazó y no entra en la respuesta.",
          attempt: Math.max(1, state.retrievalCount),
        })),
      ].slice(0, CRAG_BOUNDS.maxDiscarded);
      // Paso discard.
      emitStep({ ...state, discarded }, emit, {
        kind: "discard",
        status: "Se descarta el contexto de esta pasada.",
        evidenceStatus: "insufficient",
        discardedIds: rejected.map((chunk) => chunk.chunkId),
      });
      // Estado.
      return { discarded, candidates: [], decision: state.decision };
    })
    // Nodo reformulate: pide otra consulta para cubrir la laguna.
    .addNode("reformulate", async (state) => {
      // Parada.
      const stop = blocked(state, input.ports, emit);
      // Si toca.
      if (stop) {
        // Devuelve.
        return stop;
      }
      // Reserva de la reformulación.
      const reservation = input.ports.reserve("reformulation");
      // Sin reserva.
      if (!reservation.ok) {
        // Paso error.
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva no permite reformular.",
          evidenceStatus: state.decision?.status ?? null,
          discardedIds: [],
        });
        // Final error.
        return {
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se reformula porque la reserva del intento no está disponible.",
        };
      }
      // Inicio.
      const started = input.ports.now();
      // Resultado.
      let result: Awaited<ReturnType<CragPorts["reformulate"]>>;
      // Un fallo se convierte en resultado.
      try {
        // Reformula.
        result = await input.ports.reformulate({
          question: state.originalQuestion,
          query: state.currentQuery,
          gaps: state.decision?.gaps ?? [],
          attempt: state.reformulationCount + 1,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        // Fallo.
        result = { ok: false, reason: "La reformulación ha fallado.", providerCall: true };
      }
      // Anota la llamada.
      const ledger = noteCall(
        state.ledger,
        "reformulation",
        input.ports.measured,
        result.ok ? result.providerCall : true,
        started,
        input.ports.now(),
      );
      // Una reformulación más.
      const reformulationCount = state.reformulationCount + 1;
      // ¿Cancelado o tarde?
      const late = finishedLate({ ...state, reformulationCount }, input.ports, emit, ledger);
      // Si es así.
      if (late) {
        // Final.
        return { ...late, reformulationCount };
      }
      // Fallo.
      if (!result.ok) {
        // Motivo.
        const reason = input.ports.signal.aborted
          ? "La reformulación se interrumpió."
          : "La reformulación no se pudo usar.";
        // Paso abort o refuse.
        emitStep({ ...state, ledger, reformulationCount }, emit, {
          kind: input.ports.signal.aborted ? "abort" : "refuse",
          status: reason,
          evidenceStatus: state.decision?.status ?? null,
          discardedIds: [],
        });
        // Final aborted o refuse.
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
      // Valida la consulta: nueva y distinta de las anteriores.
      const parsed = validateReformulation(result.raw, state.seenQueries);
      // Inválida.
      if (!parsed.ok) {
        // Paso refuse.
        emitStep({ ...state, ledger, reformulationCount }, emit, {
          kind: "refuse",
          status: parsed.reason,
          evidenceStatus: state.decision?.status ?? null,
          discardedIds: [],
        });
        // Final refuse.
        return {
          ledger,
          reformulationCount,
          terminal: "refuse" as const,
          terminalReason: parsed.reason,
          answerText: `${REFUSE} ${parsed.reason}`,
        };
      }
      // Paso reformulate.
      emitStep({ ...state, ledger, reformulationCount, currentQuery: parsed.query }, emit, {
        kind: "reformulate",
        query: parsed.query,
        status: "Nueva consulta de búsqueda. La pregunta original no cambia.",
        evidenceStatus: state.decision?.status ?? null,
        discardedIds: [],
      });
      // Nueva consulta: vuelve a buscar.
      return {
        ledger,
        reformulationCount,
        currentQuery: parsed.query,
        seenQueries: [...state.seenQueries, parsed.query],
        candidates: [],
        terminal: "pending" as const,
      };
    })
    // Nodo answer: genera la respuesta solo con la evidencia aceptada.
    .addNode("answer", async (state) => {
      // Evidencia en el orden validado.
      const resolved = evidenceForAnswer(
        state.shown,
        state.decision?.usefulIds ?? [],
        state.ranking,
      );
      // Sin evidencia utilizable.
      if (!resolved.ok) {
        // Paso error.
        emitStep(state, emit, {
          kind: "error",
          status: resolved.reason,
          evidenceStatus: "sufficient",
          discardedIds: [],
        });
        // Final error.
        return {
          terminal: "error" as const,
          terminalReason: resolved.reason,
          answerText: "La etiqueta de evidencia suficiente no tenía fragmentos utilizables.",
          evidence: [],
        };
      }
      // Parada.
      const stop = blocked(state, input.ports, emit);
      // Si toca.
      if (stop) {
        // Devuelve sin evidencia.
        return { ...stop, evidence: [] };
      }
      // Reserva de la generación.
      const reservation = input.ports.reserve("generation");
      // Sin reserva.
      if (!reservation.ok) {
        // Paso error.
        emitStep(state, emit, {
          kind: "error",
          status: "La reserva no permite generar la respuesta.",
          evidenceStatus: "sufficient",
          discardedIds: [],
        });
        // Final error.
        return {
          terminal: "error" as const,
          terminalReason: reservation.reason,
          answerText: "No se genera porque la reserva del intento no está disponible.",
          evidence: [],
        };
      }
      // Inicio.
      const started = input.ports.now();
      // Resultado.
      let result: Awaited<ReturnType<CragPorts["generate"]>>;
      // Un fallo se convierte en resultado.
      try {
        // Genera.
        result = await input.ports.generate({
          question: state.originalQuestion,
          evidence: resolved.chunks,
          remainingMs: callBudget(state, input.ports).remainingMs,
        });
      } catch {
        // Fallo.
        result = { ok: false, reason: "La generación ha fallado.", providerCall: true };
      }
      // Anota la llamada.
      const ledger = noteCall(
        state.ledger,
        "generation",
        input.ports.measured,
        result.ok ? result.providerCall : true,
        started,
        input.ports.now(),
      );
      // ¿Cancelado o tarde?
      const late = finishedLate(state, input.ports, emit, ledger);
      // Tarde o fallo.
      if (late || !result.ok) {
        // Tarde.
        if (late) {
          // Final.
          return late;
        }
        // Paso error.
        emitStep({ ...state, ledger }, emit, {
          kind: "error",
          status: "La generación ha fallado.",
          evidenceStatus: "sufficient",
          discardedIds: [],
          retainedIds: resolved.chunks.map((chunk) => chunk.chunkId),
        });
        // Final error sin sustituir la etapa.
        return {
          ledger,
          evidence: [],
          terminal: "error" as const,
          terminalReason: "La generación ha fallado.",
          answerText: "La generación ha fallado. No se sustituye por otra etapa.",
        };
      }
      // Libro con consumo y coste.
      const ledgerWithUsage = {
        ...ledger,
        usage: result.usage,
        cost: result.cost,
        partial: true,
      };
      // Paso answer.
      emitStep({ ...state, ledger: ledgerWithUsage }, emit, {
        kind: "answer",
        status: "Respuesta solo con la evidencia aceptada.",
        evidenceStatus: "sufficient",
        discardedIds: [],
        retainedIds: resolved.chunks.map((chunk) => chunk.chunkId),
      });
      // Respuesta.
      return {
        ledger: ledgerWithUsage,
        retained: resolved.chunks,
        evidence: resolved.chunks,
        answerText: result.text,
        terminal: "answer" as const,
        terminalReason: state.decision?.reason ?? "Evidencia suficiente.",
      };
    })
    // Nodo refuse: intentos agotados sin evidencia suficiente.
    .addNode("refuse", (state) => {
      // Descartes ya registrados.
      const seen = new Set(
        state.discarded.map((item) => `${String(item.attempt)}:${item.chunkId}`),
      );
      // Última búsqueda.
      const attempt = Math.max(1, state.retrievalCount);
      // Rechazados de la última pasada aún sin registrar.
      const extra = state.shown
        .filter((chunk) => !state.retained.some((kept) => kept.chunkId === chunk.chunkId))
        .filter((chunk) => !seen.has(`${String(attempt)}:${chunk.chunkId}`))
        .map((chunk) => ({
          chunkId: chunk.chunkId,
          reason: "La última pasada lo rechazó y no entra en la respuesta.",
          attempt,
        }));
      // Descartados con tope.
      const discarded = [...state.discarded, ...extra].slice(0, CRAG_BOUNDS.maxDiscarded);
      // Paso refuse.
      emitStep({ ...state, discarded }, emit, {
        kind: "refuse",
        status: "Los intentos se agotaron sin evidencia suficiente.",
        evidenceStatus: state.decision?.status ?? "insufficient",
        discardedIds: discarded.slice(-10).map((item) => item.chunkId),
      });
      // Final refuse.
      return {
        discarded,
        terminal: "refuse" as const,
        terminalReason: "Se agotaron los intentos sin evidencia suficiente.",
        answerText: REFUSE,
        evidence: [],
      };
    })
    // Aristas: validate → retrieve → rank → assess y, según la decisión, retain/discard/answer/refuse.
    .addEdge(START, "validate")
    .addConditionalEdges("validate", (state) => (state.terminal === "pending" ? "retrieve" : END))
    .addConditionalEdges("retrieve", (state) => (state.terminal === "pending" ? "rank" : END))
    .addConditionalEdges("rank", (state) => (state.terminal === "pending" ? "assess" : END))
    .addConditionalEdges("assess", (state) => {
      // Ya terminó.
      if (state.terminal !== "pending") {
        // Fin.
        return END;
      }
      // Siguiente nodo según estado y contadores.
      const next = routeAfterAssessment({
        status: state.decision?.status ?? null,
        retrievalCount: state.retrievalCount,
        reformulationCount: state.reformulationCount,
      });
      // Sin intentos.
      if (next === "stop") {
        // Rechazo.
        return "refuse";
      }
      // retain, discard o answer.
      return next;
    })
    // Tras retener, reformula.
    .addConditionalEdges("retain", (state) => (state.terminal === "pending" ? "reformulate" : END))
    // Tras descartar, reformula.
    .addEdge("discard", "reformulate")
    // Tras reformular, busca otra vez.
    .addConditionalEdges("reformulate", (state) =>
      state.terminal === "pending" ? "retrieve" : END,
    )
    // answer termina.
    .addEdge("answer", END)
    // refuse termina.
    .addEdge("refuse", END);

  // Estado final.
  let finalState: GraphState;
  // Un fallo interno del grafo da un error controlado.
  try {
    // Ejecuta el grafo con un límite de pasos.
    finalState = await graph.compile().invoke(initial, { recursionLimit: 30 });
  } catch {
    // Paso error.
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
    // Estado de error.
    finalState = {
      ...initial,
      terminal: "error",
      terminalReason: "El grafo se detuvo por un límite interno.",
      answerText: "El recorrido se detuvo por un límite interno. No se lanza otra búsqueda.",
    };
  }

  // Estado final o error.
  const terminal = finalState.terminal === "pending" ? "error" : finalState.terminal;
  // Resumen validado.
  const summary = summaryFrom(
    {
      ...finalState,
      terminal,
      terminalReason: finalState.terminalReason || "El recorrido no terminó en un estado usable.",
      answerText: finalState.answerText || "El recorrido no produjo una respuesta controlada.",
    },
    input.fixture,
  );
  // Resultado del turno.
  return {
    terminal: summary.terminal,
    answerText: finalState.answerText || summary.reason,
    evidence: terminal === "answer" ? finalState.evidence : [],
    summary,
    steps,
  };
}

// Contador de llamadas para el resumen.
function callCount(executions: number, providerCalls: number | null, durationMs: number | null) {
  // Ejecuciones (máximo 3), llamadas y duración.
  return {
    executions: Math.min(3, Math.max(0, executions)),
    providerCalls,
    durationMs,
  };
}

// Resumen del turno según el contrato.
function summaryFrom(state: GraphState, fixture: boolean): CragSummary {
  // Estado final.
  const terminal = state.terminal === "pending" ? "error" : state.terminal;
  // Borrador del resumen.
  const draft = {
    // Identidad de la ejecución y si es medible.
    runId: state.scope.runId,
    fixture,
    scenarioId: state.scenarioId,
    measured: state.ledger.retrievalProviderCalls !== null,
    partial: true,
    // Alcance: grupo, corpus y perfil.
    audience: state.scope.audience,
    corpusVersion: state.scope.corpusVersion,
    profileId: state.scope.profileId,
    // Pregunta y consulta recortadas.
    originalQuestion: state.originalQuestion.slice(0, 2_000),
    currentQuery: state.currentQuery.slice(0, CRAG_BOUNDS.maxQueryChars),
    // Contadores y lo que queda, siempre dentro de los topes.
    retrievalCount: Math.min(CRAG_BOUNDS.maxRetrievals, state.retrievalCount),
    reformulationCount: Math.min(CRAG_BOUNDS.maxReformulations, state.reformulationCount),
    attemptsRemaining: Math.max(0, CRAG_BOUNDS.maxRetrievals - state.retrievalCount),
    rewritesRemaining: Math.max(0, CRAG_BOUNDS.maxReformulations - state.reformulationCount),
    // Última decisión, final y motivo.
    evidenceStatus: state.decision?.status ?? null,
    terminal,
    reason: (state.terminalReason || "Recorrido terminado.").slice(0, CRAG_BOUNDS.maxReasonChars),
    // Fragmentos conservados con su puntuación, en el orden validado.
    retained: state.retained.slice(0, CRAG_BOUNDS.maxRetained).map((chunk) => ({
      chunkId: chunk.chunkId,
      reason: `Puntuación ${chunk.score === null ? "desconocida" : chunk.score.toFixed(3)}. Conservado en el orden validado.`,
      score: chunk.score,
    })),
    // Descartados con su motivo y en qué intento.
    discarded: state.discarded.slice(0, CRAG_BOUNDS.maxDiscarded).map((item) => ({
      chunkId: item.chunkId.slice(0, CRAG_BOUNDS.maxIdChars) || "sin-id",
      reason: item.reason.slice(0, CRAG_BOUNDS.maxReasonChars),
      attempt: Math.min(CRAG_BOUNDS.maxRetrievals, Math.max(1, item.attempt)),
    })),
    // Llamadas por paso: ejecuciones, llamadas de pago y duración.
    calls: {
      // Búsquedas.
      retrieval: callCount(
        state.ledger.retrievalExecutions,
        state.ledger.retrievalProviderCalls,
        state.ledger.retrievalMs,
      ),
      // Evaluaciones.
      evaluation: callCount(
        state.ledger.evaluationExecutions,
        state.ledger.evaluationProviderCalls,
        state.ledger.evaluationMs,
      ),
      // Reformulaciones.
      reformulation: callCount(
        state.ledger.reformulationExecutions,
        state.ledger.reformulationProviderCalls,
        state.ledger.reformulationMs,
      ),
      // Generación final.
      generation: callCount(
        state.ledger.generationExecutions,
        state.ledger.generationProviderCalls,
        state.ledger.generationMs,
      ),
    },
    // Consumo y coste conocidos (o null).
    usage: state.ledger.usage,
    cost: state.ledger.cost,
  };
  // Valida.
  const parsed = cragSummarySchema.safeParse(draft);
  // Válido.
  if (parsed.success) {
    // Se devuelve.
    return parsed.data;
  }
  // Si no, resumen mínimo de error.
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
