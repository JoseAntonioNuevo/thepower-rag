import { RESEARCH_LIMITS, type ResearchSource } from "@thepower-rag/contracts";
import { allowsAudience } from "@thepower-rag/core";
import { boundedText, type PlanItem } from "./plan";
import type { CourseEvidence, EvidenceItem, ShownEvidence } from "./ports";

export interface AcceptedEvidence {
  item: EvidenceItem;
  subquestionIds: string[];
  excerpts: string[];
  reason: string;
  round: number;
}

export interface RejectedEvidence {
  sourceId: string;
  kind: EvidenceItem["kind"];
  round: number;
  reason: string;
}

export type CoverageStatus = "covered" | "partial" | "uncovered";

export interface CoverageEntry {
  subquestionId: string;
  status: CoverageStatus;
  gap: string | null;
  /** Sugerencia del evaluador. La política del núcleo decide si hay seguimiento. */
  followUp: boolean;
  sourceIds: string[];
}

const PER_KIND_CHARS = { course: 1_500, tool: 1_200, web: 4_000 } as const;
const DEFAULT_GAP = "Sin laguna concreta nombrada.";

export function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Fuera de alcance: otra versión del corpus, otra audiencia o texto vacío. */
export function courseInScope(
  chunk: CourseEvidence,
  scope: { corpusVersion: string; audience: CourseEvidence["audience"] },
): boolean {
  return (
    chunk.corpusVersion === scope.corpusVersion &&
    chunk.sourceId.startsWith(`${scope.corpusVersion}:`) &&
    chunk.text.trim().length > 0 &&
    allowsAudience(chunk.audience, scope.audience)
  );
}

/** Deduplica por sourceId conservando el primer orden. */
export function dedupeEvidence<T extends { sourceId: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.sourceId)) {
      seen.add(item.sourceId);
      result.push(item);
    }
  }
  return result;
}

/**
 * Texto que se enseña al evaluador. Cada pieza recibe un tope por tipo y una
 * parte proporcional del contexto total. El recorte es determinista.
 */
export function buildShown(items: readonly EvidenceItem[]): ShownEvidence[] {
  const bounded = items.slice(0, RESEARCH_LIMITS.maxEvidenceItems);
  if (bounded.length === 0) {
    return [];
  }
  const share = Math.floor(RESEARCH_LIMITS.maxContextChars / bounded.length);
  return bounded.map((item) => ({
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title.slice(0, RESEARCH_LIMITS.maxTitleChars),
    text: flatten(item.text).slice(0, Math.min(PER_KIND_CHARS[item.kind], share)),
  }));
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Una página externa no apoya fechas, profesores, ejercicios ni requisitos del curso. */
export function authorityAllows(kind: EvidenceItem["kind"], subquestion: PlanItem): boolean {
  return subquestion.kind === "technical" || kind === "course" || kind === "tool";
}

function supportFor(
  subquestion: PlanItem,
  accepted: readonly AcceptedEvidence[],
): AcceptedEvidence[] {
  return accepted.filter(
    (entry) =>
      entry.subquestionIds.includes(subquestion.id) &&
      authorityAllows(entry.item.kind, subquestion),
  );
}

export interface AssessmentResult {
  accepted: AcceptedEvidence[];
  rejected: RejectedEvidence[];
  coverage: CoverageEntry[];
  contradictions: string[];
  authorityRejections: number;
}

/**
 * Valida la evaluación de evidencia de una ronda.
 * - Cada candidato aparece una vez, aceptado o rechazado.
 * - Un aceptado nombra subpreguntas y extractos literales del texto mostrado.
 * - Una página externa no cubre un hecho interno: se rechaza esa asignación.
 * - Una cobertura sin evidencia admitida se rebaja a `uncovered`.
 */
export function validateAssessment(
  raw: unknown,
  input: {
    shown: readonly ShownEvidence[];
    items: readonly EvidenceItem[];
    subquestions: readonly PlanItem[];
    prior: readonly AcceptedEvidence[];
    round: number;
  },
): { ok: true; value: AssessmentResult } | { ok: false; reason: string } {
  const body = record(raw);
  if (body === null || !Array.isArray(body.items) || !Array.isArray(body.coverage)) {
    return { ok: false, reason: "La evaluación no tiene la forma esperada." };
  }
  const shownById = new Map(input.shown.map((entry) => [entry.sourceId, entry]));
  const itemById = new Map(input.items.map((item) => [item.sourceId, item]));
  const subById = new Map<string, PlanItem>(input.subquestions.map((item) => [item.id, item]));
  if (body.items.length !== input.shown.length) {
    return { ok: false, reason: "La evaluación no cubre toda la evidencia mostrada." };
  }
  const seen = new Set<string>();
  const accepted: AcceptedEvidence[] = [];
  const rejected: RejectedEvidence[] = [];
  let authorityRejections = 0;
  for (const entry of body.items) {
    const row = record(entry);
    const sourceId = typeof row?.sourceId === "string" ? row.sourceId : "";
    const shown = shownById.get(sourceId);
    const item = itemById.get(sourceId);
    const reason = boundedText(row?.reason, RESEARCH_LIMITS.maxReasonChars);
    if (shown === undefined || item === undefined || seen.has(sourceId) || reason === null) {
      return {
        ok: false,
        reason: "La evaluación trae un id desconocido, repetido o sin motivo.",
      };
    }
    seen.add(sourceId);
    if (row?.decision === "reject") {
      rejected.push({ sourceId, kind: item.kind, round: input.round, reason });
      continue;
    }
    if (row?.decision !== "accept") {
      return { ok: false, reason: "Cada evidencia se acepta o se rechaza." };
    }
    const ids = Array.isArray(row.subquestionIds) ? row.subquestionIds : [];
    const excerpts = Array.isArray(row.excerpts) ? row.excerpts : [];
    if (
      ids.length === 0 ||
      excerpts.length === 0 ||
      excerpts.length > RESEARCH_LIMITS.maxExcerptsPerSource
    ) {
      return { ok: false, reason: "Una evidencia aceptada necesita subpreguntas y extractos." };
    }
    const text = flatten(shown.text);
    const verified: string[] = [];
    for (const excerpt of excerpts) {
      const clean = boundedText(excerpt, RESEARCH_LIMITS.maxExcerptChars);
      if (clean === null || !text.includes(clean)) {
        return {
          ok: false,
          reason: "Un extracto no aparece literalmente en la evidencia mostrada.",
        };
      }
      if (!verified.includes(clean)) {
        verified.push(clean);
      }
    }
    const allowed: string[] = [];
    for (const id of ids) {
      const sub = typeof id === "string" ? subById.get(id) : undefined;
      if (sub === undefined) {
        return { ok: false, reason: "Una evidencia apunta a una subpregunta inexistente." };
      }
      if (!authorityAllows(item.kind, sub)) {
        authorityRejections += 1;
        continue;
      }
      if (!allowed.includes(sub.id)) {
        allowed.push(sub.id);
      }
    }
    if (allowed.length === 0) {
      rejected.push({
        sourceId,
        kind: item.kind,
        round: input.round,
        reason: "Una página externa no documenta hechos internos del curso.",
      });
      continue;
    }
    accepted.push({
      item,
      subquestionIds: allowed,
      excerpts: verified,
      reason,
      round: input.round,
    });
  }
  const all = [...input.prior, ...accepted];
  const coverage: CoverageEntry[] = [];
  const covered = new Set<string>();
  for (const entry of body.coverage) {
    const row = record(entry);
    const sub = typeof row?.subquestionId === "string" ? subById.get(row.subquestionId) : undefined;
    const status = row?.status;
    if (
      sub === undefined ||
      covered.has(sub.id) ||
      (status !== "covered" && status !== "partial" && status !== "uncovered")
    ) {
      return { ok: false, reason: "La cobertura no corresponde a las subpreguntas del plan." };
    }
    covered.add(sub.id);
    const support = supportFor(sub, all);
    const sourceIds = support.map((item) => item.item.sourceId);
    if (status !== "uncovered" && support.length === 0) {
      coverage.push({
        subquestionId: sub.id,
        status: "uncovered",
        gap: "La etiqueta de cobertura no tenía evidencia admitida.",
        followUp: false,
        sourceIds: [],
      });
      continue;
    }
    const gap =
      status === "covered"
        ? null
        : (boundedText(row?.gap, RESEARCH_LIMITS.maxReasonChars) ?? DEFAULT_GAP);
    coverage.push({
      subquestionId: sub.id,
      status,
      gap,
      followUp: status !== "covered" && row?.followUp === true && gap !== DEFAULT_GAP,
      sourceIds,
    });
  }
  if (covered.size !== input.subquestions.length) {
    return { ok: false, reason: "La cobertura omite una subpregunta." };
  }
  const contradictions: string[] = [];
  if (Array.isArray(body.contradictions)) {
    for (const item of body.contradictions.slice(0, 3)) {
      const text = boundedText(item, RESEARCH_LIMITS.maxReasonChars);
      if (text !== null) {
        contradictions.push(text);
      }
    }
  }
  return {
    ok: true,
    value: { accepted, rejected, coverage, contradictions, authorityRejections },
  };
}

/**
 * La cobertura propuesta no borra una subpregunta que sigue teniendo evidencia
 * admitida. Un rechazo que deja la subpregunta sin apoyo sí la deja sin cubrir.
 * Una bajada explícita a parcial se conserva: es un cambio deliberado.
 */
export function reconcileCoverage(
  proposed: readonly CoverageEntry[],
  previous: readonly CoverageEntry[],
  accepted: readonly AcceptedEvidence[],
  subquestions: readonly PlanItem[],
  shownSourceIds: ReadonlySet<string>,
): CoverageEntry[] {
  return subquestions.map((sub) => {
    const proposal = proposed.find((entry) => entry.subquestionId === sub.id);
    const before = previous.find((entry) => entry.subquestionId === sub.id);
    const sourceIds = supportFor(sub, accepted).map((entry) => entry.item.sourceId);
    if (sourceIds.length === 0) {
      return {
        subquestionId: sub.id,
        status: "uncovered" as const,
        gap: proposal?.gap ?? before?.gap ?? "Sin evidencia admitida.",
        followUp:
          proposal?.status !== "covered" &&
          proposal?.followUp === true &&
          proposal.gap !== null &&
          proposal.gap !== DEFAULT_GAP,
        sourceIds: [],
      };
    }
    if (proposal?.status === "covered") {
      return {
        subquestionId: sub.id,
        status: "covered" as const,
        gap: null,
        followUp: false,
        sourceIds,
      };
    }
    if (proposal?.status === "partial") {
      return {
        subquestionId: sub.id,
        status: "partial" as const,
        gap: proposal.gap ?? before?.gap ?? DEFAULT_GAP,
        followUp:
          proposal.followUp === true && proposal.gap !== null && proposal.gap !== DEFAULT_GAP,
        sourceIds,
      };
    }
    const unseen = sourceIds.some((id) => !shownSourceIds.has(id));
    if (unseen && (before?.status === "covered" || before?.status === "partial")) {
      return {
        subquestionId: sub.id,
        status: before.status,
        gap: before.gap,
        followUp: false,
        sourceIds,
      };
    }
    if (before?.status === "covered") {
      return {
        subquestionId: sub.id,
        status: "covered" as const,
        gap: null,
        followUp: false,
        sourceIds,
      };
    }
    return {
      subquestionId: sub.id,
      status: "partial" as const,
      gap: before?.gap ?? "La evidencia admitida sigue apoyando la subpregunta.",
      followUp: false,
      sourceIds,
    };
  });
}

/** Cobertura sin evidencia nueva: se conserva la anterior y no se llama al modelo. */
export function carryCoverage(
  previous: readonly CoverageEntry[],
  subquestions: readonly PlanItem[],
  accepted: readonly AcceptedEvidence[],
): CoverageEntry[] {
  return subquestions.map((sub) => {
    const before = previous.find((entry) => entry.subquestionId === sub.id);
    const sourceIds = supportFor(sub, accepted).map((entry) => entry.item.sourceId);
    return {
      subquestionId: sub.id,
      status: before?.status ?? "uncovered",
      gap: before?.gap ?? "Sin evidencia recuperada.",
      followUp: false,
      sourceIds,
    };
  });
}

/** Fuente pública de una evidencia admitida. Solo se publica si el informe la cita. */
export function sourceFor(entry: AcceptedEvidence): ResearchSource {
  const item = entry.item;
  const excerpts = entry.excerpts
    .map((text) => text.slice(0, RESEARCH_LIMITS.maxExcerptChars))
    .slice(0, RESEARCH_LIMITS.maxExcerptsPerSource);
  const subquestionIds = entry.subquestionIds.filter(
    (id): id is "q1" | "q2" | "q3" => id === "q1" || id === "q2" || id === "q3",
  );
  if (item.kind === "course") {
    return {
      kind: "course",
      sourceId: item.sourceId,
      documentId: item.documentId,
      title: item.title.slice(0, RESEARCH_LIMITS.maxTitleChars),
      section: item.section.slice(0, RESEARCH_LIMITS.maxTitleChars),
      excerpts,
      corpusVersion: item.corpusVersion,
      audience: item.audience,
      subquestionIds,
    };
  }
  if (item.kind === "tool") {
    return {
      kind: "tool",
      sourceId: item.sourceId,
      toolName: item.toolName,
      title: item.title.slice(0, RESEARCH_LIMITS.maxTitleChars),
      excerpts,
      backingSourceIds: item.backingSourceIds.slice(0, 4),
      corpusVersion: item.corpusVersion,
      audience: item.audience,
      subquestionIds,
    };
  }
  return {
    kind: "web",
    sourceId: item.sourceId,
    url: item.url,
    domain: item.domain,
    title: item.title.slice(0, RESEARCH_LIMITS.maxTitleChars),
    retrievedAt: item.retrievedAt,
    publishedAt: item.publishedAt,
    contentHash: item.contentHash,
    excerpts,
    subquestionIds,
    fixture: item.fixture,
  };
}
