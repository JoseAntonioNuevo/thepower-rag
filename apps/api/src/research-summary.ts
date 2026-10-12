// GUÍA DE LECTURA · apps/api/src/research-summary.ts
// Resumen público de una investigación: convierte el estado del grafo en el esquema del contrato,
// con las fuentes citadas y una nota honesta sobre la contabilidad.
// Límites y esquemas del contrato.
import {
  RESEARCH_LIMITS,
  researchSourceSchema,
  researchSummarySchema,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
// Método de comprobación y fuentes públicas.
import { CLAIM_CHECK_METHOD, sourceFor, type ResearchPorts } from "@thepower-rag/research";
// Tipo del estado del grafo.
import type { ResearchState } from "./research-state";

// Ids de subpregunta válidos.
type Sid = "q1" | "q2" | "q3";

// Normaliza un id de subpregunta.
function sid(value: string): Sid {
  // q2 o q3 se conservan; cualquier otro es q1.
  return value === "q2" || value === "q3" ? value : "q1";
}

// Nota de contabilidad según lo que se pudo medir.
function accountingNote(
  measured: boolean,
  unknown: number,
  unpriced: number,
  estimate: boolean,
): string {
  // Adaptadores de prueba: nada que medir.
  if (!measured) {
    // Nota.
    return "Adaptadores de prueba: no hay consumo que medir. No medido no significa cero.";
  }
  // Hay estimaciones.
  if (estimate) {
    // Nota.
    return "Hay USD calculado con tarifas publicadas. No es un importe del proveedor y el total no está completo.";
  }
  // Hay llamadas con consumo desconocido.
  if (unknown > 0) {
    // Nota con el recuento.
    return `Hay ${String(unknown)} llamadas con consumo desconocido. El total no está completo y desconocido no es cero.`;
  }
  // Hay créditos sin convertir.
  if (unpriced > 0) {
    // Nota.
    return "Hay créditos u observaciones sin USD verificado. Los créditos no se convierten en un total. El total no está completo.";
  }
  // Todo informado por los proveedores.
  return "Consumo en USD informado por los proveedores. La reserva estimada es un tope, no un cargo.";
}

/** Fuentes publicables: solo las admitidas que el informe cita. */
export function citedSources(state: ResearchState): ResearchSource[] {
  // Ids citados en el informe.
  const cited = new Set(state.citedSourceIds);
  // Solo las aceptadas y citadas, validadas con el esquema.
  return state.accepted
    .filter((entry) => cited.has(entry.item.sourceId))
    .map((entry) => researchSourceSchema.parse(sourceFor(entry)));
}

// Construye el resumen público a partir del estado y de los puertos usados.
export function researchSummary(
  state: ResearchState,
  ports: Pick<ResearchPorts, "measured" | "fixture" | "estimatedMaxUsd" | "now">,
): ResearchSummary {
  // Plan de la investigación.
  const plan = state.researchPlan;
  // Milisegundos transcurridos.
  const elapsed = ports.now() - state.startedAt;
  // Contabilidad.
  const ledger = state.ledger;
  // Resumen completo campo a campo.
  const summary: ResearchSummary = {
    runId: state.runId,
    fixture: ports.fixture,
    scenarioId: state.scenarioId,
    measured: ports.measured,
    audience: state.audience,
    corpusVersion: state.corpusVersion,
    originalQuestion: (state.originalQuestion || state.question).slice(
      0,
      RESEARCH_LIMITS.maxQuestionChars,
    ),
    threadId: state.threadId,
    jobId: state.jobId,
    contextualizedQuestion:
      state.originalQuestion && state.originalQuestion !== state.question
        ? state.question.slice(0, RESEARCH_LIMITS.maxQuestionChars)
        : null,
    route: plan?.route ?? null,
    planRationale: plan?.rationale ?? null,
    subquestions: (plan?.subquestions ?? []).map((item) => ({
      id: item.id,
      text: item.text,
      kind: item.kind,
      external: item.external,
    })),
    rounds: state.round,
    courseQueries: state.courseQueries.map((item) => ({
      ...item,
      subquestionId: sid(item.subquestionId),
    })),
    toolCalls: state.toolCalls,
    searches: state.searches.map((item) => ({ ...item, subquestionId: sid(item.subquestionId) })),
    discovered: state.discovered.map((item) => ({
      round: item.round,
      url: item.url,
      title: item.title,
      domain: item.domain,
      decision: item.decision === "candidate" ? "over-budget" : item.decision,
    })),
    pagesRead: state.pagesRead.map((item) => ({
      round: item.round,
      url: item.url,
      finalUrl: item.finalUrl,
      sourceId: item.sourceId,
      status: item.status,
      detail: item.detail || "Sin detalle.",
      chars: item.chars,
      contentHash: item.contentHash,
      instructionsFlagged: item.instructionsFlagged,
    })),
    accepted: state.accepted.map((entry) => ({
      sourceId: entry.item.sourceId,
      kind: entry.item.kind,
      subquestionIds: entry.subquestionIds.map(sid),
      reason: entry.reason,
    })),
    rejected: state.rejected,
    coverage: state.coverage.map((entry) => ({
      subquestionId: sid(entry.subquestionId),
      status: entry.status,
      cause: state.causes[entry.subquestionId] ?? "missing-evidence",
      gap: entry.gap,
      sourceIds: entry.sourceIds,
    })),
    contradictions: state.contradictions,
    followUp:
      state.followUp === null
        ? null
        : {
            reason: state.followUp.reason,
            queries: state.followUp.queries.map((item) => ({
              subquestionId: sid(item.subquestionId),
              query: item.query,
            })),
          },
    stop: state.stop ?? "invalid-output",
    stopDetail: state.stopDetail || "Sin detalle.",
    outcome: state.outcome ?? "error",
    claimCheck: {
      method: CLAIM_CHECK_METHOD.slice(0, RESEARCH_LIMITS.maxReasonChars),
      checked: state.claimChecked,
      dropped: state.claimDropped.map((item) => ({
        claim: item.claim.slice(0, RESEARCH_LIMITS.maxClaimChars),
        reason: item.reason.slice(0, RESEARCH_LIMITS.maxReasonChars),
      })),
    },
    citedSourceIds: state.citedSourceIds,
    counters: {
      ...state.counters,
      elapsedMs:
        ports.measured && Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null,
    },
    limits: {
      maxSubquestions: RESEARCH_LIMITS.maxSubquestions,
      maxRounds: RESEARCH_LIMITS.maxRounds,
      maxSearchCalls: RESEARCH_LIMITS.maxSearchCalls,
      maxPagesRead: RESEARCH_LIMITS.maxPagesRead,
      deadlineMs: RESEARCH_LIMITS.deadlineMs,
    },
    accounting: {
      measured: ports.measured,
      estimatedMaxUsd: ports.estimatedMaxUsd,
      providerReportedUsd: ledger.reportedUsd,
      providerReportedCredits: ledger.reportedCredits,
      estimatedUsd: ledger.estimatedUsd ?? null,
      estimateProvenance: ledger.estimateProvenance ?? null,
      estimateComplete:
        (ledger.estimatedUsd ?? null) === null ? null : ledger.estimateIncomplete !== true,
      unknownConsumptionCalls: ledger.unknownCalls,
      finalAnswerUsd: ledger.finalAnswerUsd,
      totalComplete:
        ports.measured &&
        ledger.unknownCalls === 0 &&
        ledger.unpricedCalls === 0 &&
        (ledger.estimatedUsd ?? null) === null &&
        ledger.estimateIncomplete !== true,
      note: accountingNote(
        ports.measured,
        ledger.unknownCalls,
        ledger.unpricedCalls,
        (ledger.estimatedUsd ?? null) !== null || ledger.estimateIncomplete === true,
      ),
    },
    trace: state.trace,
  };
  // Valida el resumen con el esquema antes de devolverlo.
  return researchSummarySchema.parse(summary);
}
