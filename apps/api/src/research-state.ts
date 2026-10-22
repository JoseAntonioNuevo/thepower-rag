// GUÍA DE LECTURA · apps/api/src/research-state.ts
// Estado del grafo de investigación y piezas compartidas por sus nodos: errores de control, registros
// de cada llamada, libro de consumo, traza acotada y guardedCall, que ejecuta un puerto con plazo.
// Límites, esquema del paso y tipos del contrato.
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
// Plazos y tipos del paquete de investigación.
import {
  // Plazo de cada llamada y tiempo restante.
  callTimeoutMs,
  remainingMs,
  // Tipos de evidencia, consumo, contadores y cobertura.
  type AcceptedEvidence,
  type Consumption,
  type Counters,
  type CoverageEntry,
  // Tipos de evidencia, lagunas, resultados, plan y puertos.
  type EvidenceItem,
  type GapCause,
  type PortResult,
  type RejectedEvidence,
  type ResearchPlan,
  type ResearchPorts,
} from "@thepower-rag/research";
// Annotation define los canales del estado en LangGraph.
import { Annotation } from "@langchain/langgraph";

// Estado de una llamada registrada.
export type CallStatus = "ok" | "error" | "timeout" | "late" | "skipped";

/** Señal de control del ejecutor durable. No es un fallo de informe. */
export class ResearchControlError extends Error {
  // Recibe nombre y mensaje del error.
  constructor(name: string, message: string) {
    // Constructor de Error.
    super(message);
    // Nombre visible del error.
    this.name = name;
  }
}

// El trabajo necesita atención: hay una operación enviada sin resultado.
export class ResearchAttention extends ResearchControlError {
  // Guarda el id de la operación.
  constructor(readonly operationId: string) {
    // Nombre y mensaje fijos.
    super("ResearchAttention", "research-attention");
  }
}

// Caída simulada de un paso (escenario de prueba).
export class ResearchStepCrash extends ResearchControlError {
  // Sin argumentos.
  constructor() {
    // Nombre y mensaje fijos.
    super("ResearchStepCrash", "research-step-crash");
  }
}

/** LangGraph puede envolver la señal. Se recorre la causa sin perder el tipo. */
export function controlError(error: unknown): ResearchControlError | null {
  // Errores ya vistos, para evitar ciclos.
  const seen = new Set<unknown>();
  // Error actual.
  let current: unknown = error;
  // Recorre la cadena de causas.
  while (current !== undefined && current !== null && !seen.has(current)) {
    // Lo marca como visto.
    seen.add(current);
    // Es de control.
    if (current instanceof ResearchControlError) {
      // Se devuelve.
      return current;
    }
    // No es un Error: no hay causa que seguir.
    if (!(current instanceof Error)) {
      // null.
      return null;
    }
    // Baja a la causa.
    current = current.cause;
  }
  // Ninguno de control.
  return null;
}

// Registro de una consulta al curso.
export interface CourseQueryLog {
  // Ronda.
  round: number;
  // Subpregunta.
  subquestionId: string;
  // Consulta.
  query: string;
  // Estado.
  status: CallStatus;
  // Fuentes devueltas.
  sourceIds: string[];
}

// Registro de una llamada a la herramienta.
export interface ToolCallLog {
  // Ronda.
  round: number;
  // Nombre de la herramienta.
  name: "get_course_session";
  // Argumentos.
  args: { sessionId: string; audience: Audience };
  // Estado.
  status: "ok" | "rejected" | "error";
  // Detalle.
  detail: string;
  // Fuentes.
  sourceIds: string[];
}

// Registro de una búsqueda web.
export interface SearchLog {
  // Ronda.
  round: number;
  // Subpregunta.
  subquestionId: string;
  // Consulta.
  query: string;
  // Estado.
  status: CallStatus;
  // Resultados.
  resultCount: number;
  // Detalle.
  detail: string;
}

// Registro de una URL descubierta.
export interface DiscoveredLog {
  // Ronda.
  round: number;
  // Subpregunta.
  subquestionId: string;
  // URL.
  url: string;
  // Título.
  title: string;
  // Dominio.
  domain: string;
  // Qué se decidió con ella.
  decision: "candidate" | "selected" | "not-allowed" | "duplicate" | "already-read" | "over-budget";
}

// Registro de una lectura.
export interface ReadLog {
  // Ronda.
  round: number;
  // Subpregunta.
  subquestionId: string;
  // URL pedida.
  url: string;
  // URL final.
  finalUrl: string | null;
  // Fuente creada.
  sourceId: string | null;
  // Estado.
  status: "ok" | "error" | "timeout" | "late" | "rejected";
  // Detalle.
  detail: string;
  // Caracteres leídos.
  chars: number;
  // Hash del contenido.
  contentHash: string | null;
  // Si contenía instrucciones sospechosas.
  instructionsFlagged: boolean;
}

// Libro de consumo de la investigación.
export interface Ledger {
  // USD informado por proveedores.
  reportedUsd: number | null;
  // Créditos informados.
  reportedCredits: number | null;
  /** USD calculado con tarifas. Ausente en checkpoints anteriores a esta distinción. */
  estimatedUsd?: number | null;
  // Procedencia de la estimación.
  estimateProvenance?: string | null;
  // Si a la estimación le faltan datos.
  estimateIncomplete?: boolean;
  // Llamadas con consumo desconocido.
  unknownCalls: number;
  /** Observación reportada sin USD. Los créditos no son una conversión. */
  unpricedCalls: number;
  // USD de la respuesta final.
  finalAnswerUsd: number | null;
}

// Consulta pendiente.
export interface PendingQuery {
  // Subpregunta.
  subquestionId: string;
  // Consulta.
  query: string;
}

/** Estado serializable del grafo: sin funciones ni mapas, apto para un checkpointer. */
export interface ResearchState {
  // Id de ejecución.
  runId: string;
  // Pregunta (puede incluir memoria).
  question: string;
  // Pregunta original.
  originalQuestion: string;
  // Hilo de la conversación.
  threadId: string | null;
  // Trabajo durable.
  jobId: string | null;
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Escenario de prueba.
  scenarioId: ResearchScenarioId | null;
  // Inicio.
  startedAt: number;
  // Ronda.
  round: number;
  // Plan.
  researchPlan: ResearchPlan | null;
  // Contadores.
  counters: Counters;
  // Consultas al curso.
  courseQueries: CourseQueryLog[];
  // Llamadas a la herramienta.
  toolCalls: ToolCallLog[];
  // Búsquedas.
  searches: SearchLog[];
  // URL descubiertas.
  discovered: DiscoveredLog[];
  // Lecturas.
  pagesRead: ReadLog[];
  // Consultas pendientes al curso.
  pendingCourse: PendingQuery[];
  // Búsquedas pendientes.
  pendingSearch: PendingQuery[];
  // Consultas ya usadas.
  seenQueries: string[];
  // Candidatos de la ronda.
  candidates: EvidenceItem[];
  // Evidencia aceptada.
  accepted: AcceptedEvidence[];
  // Evidencia rechazada.
  rejected: RejectedEvidence[];
  // Cobertura.
  coverage: CoverageEntry[];
  // Causas de las lagunas.
  causes: Record<string, GapCause>;
  // Contradicciones.
  contradictions: string[];
  // Seguimiento.
  followUp: { reason: string; queries: PendingQuery[] } | null;
  // Subpreguntas elegibles para seguimiento.
  eligible: string[];
  // Aceptadas nuevas en la ronda.
  newAccepted: number;
  // Borrador del informe.
  draft: unknown;
  // Motivo de parada.
  stop: ResearchStop | null;
  // Detalle de la parada.
  stopDetail: string;
  // Resultado.
  outcome: ResearchOutcome | null;
  // Texto del informe.
  reportText: string;
  // Fuentes citadas.
  citedSourceIds: string[];
  // Afirmaciones comprobadas.
  claimChecked: number;
  // Afirmaciones retiradas.
  claimDropped: { claim: string; reason: string }[];
  // Libro de consumo.
  ledger: Ledger;
  // Traza.
  trace: ResearchStep[];
}

// Canal que conserva el último valor escrito.
function last<T>() {
  // Reducer: el valor nuevo sustituye al anterior.
  return Annotation<T>({
    // Combina la actualización del estado con su valor anterior según esta regla de LangGraph.
    reducer: (_left: T, right: T) => right,
    // Crea el valor inicial independiente del canal de estado de LangGraph.
    default: () => undefined as T,
  });
}

// Estado del grafo: un canal «último valor» por campo.
export const ResearchGraphState = Annotation.Root({
  // Identidad, pregunta, conversación y trabajo.
  runId: last<string>(),
  question: last<string>(),
  originalQuestion: last<string>(),
  threadId: last<string | null>(),
  jobId: last<string | null>(),
  // Grupo, corpus, guion, inicio y ronda.
  audience: last<Audience>(),
  corpusVersion: last<string>(),
  scenarioId: last<ResearchScenarioId | null>(),
  startedAt: last<number>(),
  round: last<number>(),
  // Plan y contadores.
  researchPlan: last<ResearchPlan | null>(),
  counters: last<Counters>(),
  // Registros de cada llamada (para la traza).
  courseQueries: last<CourseQueryLog[]>(),
  toolCalls: last<ToolCallLog[]>(),
  searches: last<SearchLog[]>(),
  discovered: last<DiscoveredLog[]>(),
  pagesRead: last<ReadLog[]>(),
  // Consultas pendientes y ya vistas.
  pendingCourse: last<PendingQuery[]>(),
  pendingSearch: last<PendingQuery[]>(),
  seenQueries: last<string[]>(),
  // Evidencia, cobertura, causas y contradicciones.
  candidates: last<EvidenceItem[]>(),
  accepted: last<AcceptedEvidence[]>(),
  rejected: last<RejectedEvidence[]>(),
  coverage: last<CoverageEntry[]>(),
  causes: last<Record<string, GapCause>>(),
  contradictions: last<string[]>(),
  // Seguimiento y subpreguntas elegibles.
  followUp: last<{ reason: string; queries: PendingQuery[] } | null>(),
  eligible: last<string[]>(),
  newAccepted: last<number>(),
  // Borrador, parada y resultado.
  draft: last<unknown>(),
  stop: last<ResearchStop | null>(),
  stopDetail: last<string>(),
  outcome: last<ResearchOutcome | null>(),
  // Informe y verificación.
  reportText: last<string>(),
  citedSourceIds: last<string[]>(),
  claimChecked: last<number>(),
  claimDropped: last<{ claim: string; reason: string }[]>(),
  // Libro de consumo y traza visible.
  ledger: last<Ledger>(),
  trace: last<ResearchStep[]>(),
});

// Libro vacío.
export function emptyLedger(): Ledger {
  // Sin consumo.
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

// ¿Importe válido?
function finiteAmount(value: number | null): value is number {
  // Número finito no negativo.
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

// Suma un consumo al libro.
export function addConsumption(ledger: Ledger, consumption: Consumption): Ledger {
  // Sin consumo.
  if (consumption.kind === "none") {
    // Igual.
    return ledger;
  }
  // Desconocido.
  if (consumption.kind === "unknown") {
    // Una llamada desconocida más.
    return { ...ledger, unknownCalls: ledger.unknownCalls + 1 };
  }
  // Estimado por tokens.
  if (consumption.kind === "estimated") {
    // Importe válido o null.
    const usd = finiteAmount(consumption.usd) ? consumption.usd : null;
    // ¿Incompleto?
    const incomplete = consumption.complete !== true || usd === null;
    // Suma la estimación; no es un importe informado.
    return {
      ...ledger,
      estimatedUsd: usd === null ? (ledger.estimatedUsd ?? null) : (ledger.estimatedUsd ?? 0) + usd,
      estimateProvenance: consumption.provenance || ledger.estimateProvenance || null,
      estimateIncomplete: ledger.estimateIncomplete === true || incomplete,
      unknownCalls: ledger.unknownCalls + 1,
      unpricedCalls: incomplete ? ledger.unpricedCalls + 1 : ledger.unpricedCalls,
    };
  }
  // Informado: USD.
  const usd = finiteAmount(consumption.usd) ? consumption.usd : null;
  // Créditos.
  const credits = finiteAmount(consumption.credits) ? consumption.credits : null;
  // Suma lo informado.
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
  // Paso validado y recortado.
  const step = researchStepSchema.parse({
    runId: state.runId,
    node,
    round: Math.min(Math.max(0, round), RESEARCH_LIMITS.maxRounds),
    status: status.slice(0, RESEARCH_LIMITS.maxReasonChars),
  });
  // Lo emite.
  emit(step);
  // Hueco: el paso final siempre cabe.
  const room = RESEARCH_LIMITS.maxTraceEntries - (node === "finish" ? 0 : 1);
  // Añade el paso si cabe.
  return state.trace.length >= room ? state.trace : [...state.trace, step];
}

// Resultado de una llamada protegida: también tarde o sin plazo.
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
  // Plazo: el menor entre el de la llamada y lo que queda.
  const timeoutMs = callTimeoutMs(capMs, remainingMs(startedAt, ports.now()));
  // Ya cancelado.
  if (ports.signal.aborted) {
    // Sin consumo.
    return {
      ok: false,
      error: "aborted",
      detail: "La petición se ha detenido.",
      consumption: { kind: "none" },
    };
  }
  // Sin plazo.
  if (timeoutMs === 0) {
    // No empieza.
    return {
      ok: false,
      error: "deadline",
      detail: "No queda plazo para empezar esta llamada.",
      consumption: { kind: "none" },
    };
  }
  // Controlador propio.
  const controller = new AbortController();
  // Consumo de una llamada enviada: desconocido si es real.
  const sent: Consumption = ports.measured ? { kind: "unknown" } : { kind: "none" };
  // Resultado cuando se detiene la espera.
  const stopped = (): PortResult<T> => ({
    ok: false,
    error: "aborted",
    detail:
      "La petición se detuvo durante la llamada. La espera local termina; un cargo ya enviado puede seguir siendo desconocido.",
    consumption: sent,
  });
  // Temporizador.
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Oyente.
  let onAbort: (() => void) | undefined;
  // Lanza la llamada.
  const pending = run({ signal: controller.signal, timeoutMs });
  // Convierte excepciones en resultados, salvo las de control.
  const settled = pending.then(
    (value): PortResult<T> => value,
    (error: unknown): PortResult<T> => {
      // Error de control.
      if (error instanceof ResearchControlError) {
        // Se propaga.
        throw error;
      }
      // Fallo del adaptador.
      return {
        ok: false,
        error: controller.signal.aborted || ports.signal.aborted ? "aborted" : "provider",
        detail: "La llamada lanzó una excepción.",
        consumption: sent,
      };
    },
  );
  // try/finally: limpia temporizador y oyente.
  try {
    // Espera lo primero: resultado, cancelación o plazo.
    const result = await new Promise<PortResult<T>>((resolve, reject) => {
      // Ya resuelto.
      let done = false;
      // Resuelve una vez.
      const finish = (value: PortResult<T>) => {
        // Si ya, nada.
        if (done) {
          // Sale.
          return;
        }
        // Marca.
        done = true;
        // Resuelve.
        resolve(value);
      };
      // Rechaza una vez.
      const fail = (error: unknown) => {
        // Si ya, nada.
        if (done) {
          // Sale.
          return;
        }
        // Marca.
        done = true;
        // Rechaza.
        reject(error);
      };
      // Al cancelar la petición.
      onAbort = () => {
        // Corta la llamada.
        controller.abort();
        // Resultado detenido.
        finish(stopped());
      };
      // Ya cancelada.
      if (ports.signal.aborted) {
        // Corta.
        controller.abort();
        // Detenido.
        finish(stopped());
        // Sale.
        return;
      }
      // Escucha la cancelación.
      ports.signal.addEventListener("abort", onAbort, { once: true });
      // Plazo de la llamada.
      timer = setTimeout(() => {
        // Corta.
        controller.abort();
        // Resultado timeout.
        finish({
          ok: false,
          error: "timeout",
          detail: "La llamada superó su plazo.",
          consumption: sent,
        });
      }, timeoutMs);
      // Cuando llega el resultado.
      void settled.then(
        (value) => {
          // Si se canceló mientras tanto.
          if (ports.signal.aborted) {
            // Detenido.
            finish(stopped());
            // Sale.
            return;
          }
          // Resultado.
          finish(value);
        },
        (error: unknown) => {
          // Error de control.
          fail(error);
        },
      );
    });
    // Correcto pero cancelado.
    if (result.ok && ports.signal.aborted) {
      // Detenido.
      return stopped();
    }
    // Correcto pero fuera del plazo total.
    if (result.ok && remainingMs(startedAt, ports.now()) === 0) {
      // No se acepta.
      return {
        ok: false,
        error: "late",
        detail: "El resultado llegó fuera del plazo total y no se acepta.",
        consumption: result.consumption,
      };
    }
    // Resultado.
    return result;
  } finally {
    // Si hubo temporizador.
    if (timer !== undefined) {
      // Lo cancela.
      clearTimeout(timer);
    }
    // Si hubo oyente.
    if (onAbort !== undefined) {
      // Lo retira.
      ports.signal.removeEventListener("abort", onAbort);
    }
  }
}

// Estado registrado de una llamada protegida.
export function statusOf(result: Guarded<unknown>): CallStatus {
  // Correcto.
  if (result.ok) {
    // ok.
    return "ok";
  }
  // Plazo de la llamada.
  if (result.error === "timeout") {
    // timeout.
    return "timeout";
  }
  // Tarde.
  if (result.error === "late") {
    // late.
    return "late";
  }
  // Sin plazo.
  if (result.error === "deadline") {
    // skipped.
    return "skipped";
  }
  // Otro error.
  return "error";
}
