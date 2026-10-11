import {
  RESEARCH_LIMITS,
  researchSourceSchema,
  researchSummarySchema,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
import { CLAIM_CHECK_METHOD, sourceFor, type ResearchPorts } from "@thepower-rag/research";
import type { ResearchState } from "./research-state";

type Sid = "q1" | "q2" | "q3";

function sid(value: string): Sid {
  return value === "q2" || value === "q3" ? value : "q1";
}

function accountingNote(
  measured: boolean,
  unknown: number,
  unpriced: number,
  estimate: boolean,
): string {
  if (!measured) {
    return "Adaptadores de prueba: no hay consumo que medir. No medido no significa cero.";
  }
  if (estimate) {
    return "Hay USD calculado con tarifas publicadas. No es un importe del proveedor y el total no está completo.";
  }
  if (unknown > 0) {
    return `Hay ${String(unknown)} llamadas con consumo desconocido. El total no está completo y desconocido no es cero.`;
  }
  if (unpriced > 0) {
    return "Hay créditos u observaciones sin USD verificado. Los créditos no se convierten en un total. El total no está completo.";
  }
  return "Consumo en USD informado por los proveedores. La reserva estimada es un tope, no un cargo.";
}

/** Fuentes publicables: solo las admitidas que el informe cita. */
export function citedSources(state: ResearchState): ResearchSource[] {
  const cited = new Set(state.citedSourceIds);
  return state.accepted
    .filter((entry) => cited.has(entry.item.sourceId))
    .map((entry) => researchSourceSchema.parse(sourceFor(entry)));
}

export function researchSummary(
  state: ResearchState,
  ports: Pick<ResearchPorts, "measured" | "fixture" | "estimatedMaxUsd" | "now">,
): ResearchSummary {
  const plan = state.researchPlan;
  const elapsed = ports.now() - state.startedAt;
  const ledger = state.ledger;
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
  return researchSummarySchema.parse(summary);
}
