// GUÍA DE LECTURA · packages/research/src/evidence.ts
// Evidencia de la investigación: qué se enseña al evaluador, cómo se valida su decisión (extractos
// literales, autoridad de cada fuente) y cómo se mantiene la cobertura de cada subpregunta.
// Límites y tipo de fuente pública.
import { RESEARCH_LIMITS, type ResearchSource } from "@thepower-rag/contracts";
// Regla de visibilidad por audiencia.
import { allowsAudience } from "@thepower-rag/core";
// Texto acotado y tipo de subpregunta.
import { boundedText, type PlanItem } from "./plan";
// Tipos de evidencia.
import type { CourseEvidence, EvidenceItem, ShownEvidence } from "./ports";

// Evidencia aceptada en una ronda.
export interface AcceptedEvidence {
  // Fuente aceptada.
  item: EvidenceItem;
  // Subpreguntas que cubre.
  subquestionIds: string[];
  // Extractos literales que la respaldan.
  excerpts: string[];
  // Motivo.
  reason: string;
  // Ronda.
  round: number;
}

// Evidencia rechazada.
export interface RejectedEvidence {
  // Id de la fuente.
  sourceId: string;
  // Tipo.
  kind: EvidenceItem["kind"];
  // Ronda.
  round: number;
  // Motivo.
  reason: string;
}

// Estado de cobertura de una subpregunta.
export type CoverageStatus = "covered" | "partial" | "uncovered";

// Cobertura de una subpregunta.
export interface CoverageEntry {
  // Subpregunta.
  subquestionId: string;
  // Estado.
  status: CoverageStatus;
  // Laguna, o null si está cubierta.
  gap: string | null;
  /** Sugerencia del evaluador. La política del núcleo decide si hay seguimiento. */
  followUp: boolean;
  // Fuentes que la respaldan.
  sourceIds: string[];
}

// Caracteres máximos por tipo de evidencia al enseñarla al modelo.
const PER_KIND_CHARS = { course: 1_500, tool: 1_200, web: 4_000 } as const;
// Laguna por defecto cuando el modelo no nombra ninguna.
const DEFAULT_GAP = "Sin laguna concreta nombrada.";

// Junta espacios y saltos de línea.
export function flatten(text: string): string {
  // Un solo espacio entre palabras.
  return text.replace(/\s+/g, " ").trim();
}

/** Fuera de alcance: otra versión del corpus, otra audiencia o texto vacío. */
export function courseInScope(
  chunk: CourseEvidence,
  scope: { corpusVersion: string; audience: CourseEvidence["audience"] },
): boolean {
  // Misma versión, id con esa versión, texto y audiencia visible.
  return (
    chunk.corpusVersion === scope.corpusVersion &&
    chunk.sourceId.startsWith(`${scope.corpusVersion}:`) &&
    chunk.text.trim().length > 0 &&
    allowsAudience(chunk.audience, scope.audience)
  );
}

/** Deduplica por sourceId conservando el primer orden. */
export function dedupeEvidence<T extends { sourceId: string }>(items: readonly T[]): T[] {
  // Ids vistos.
  const seen = new Set<string>();
  // Resultado.
  const result: T[] = [];
  // Recorre las evidencias.
  for (const item of items) {
    // Primera vez que aparece.
    if (!seen.has(item.sourceId)) {
      // Marca.
      seen.add(item.sourceId);
      // Añade.
      result.push(item);
    }
  }
  // Sin repetidos.
  return result;
}

/**
 * Texto que se enseña al evaluador. Cada pieza recibe un tope por tipo y una
 * parte proporcional del contexto total. El recorte es determinista.
 */
export function buildShown(items: readonly EvidenceItem[]): ShownEvidence[] {
  // Como mucho el máximo de evidencias.
  const bounded = items.slice(0, RESEARCH_LIMITS.maxEvidenceItems);
  // Nada que enseñar.
  if (bounded.length === 0) {
    // Lista vacía.
    return [];
  }
  // Parte del contexto que corresponde a cada pieza.
  const share = Math.floor(RESEARCH_LIMITS.maxContextChars / bounded.length);
  // Cada pieza con título y texto recortados.
  return bounded.map((item) => ({
    sourceId: item.sourceId,
    kind: item.kind,
    title: item.title.slice(0, RESEARCH_LIMITS.maxTitleChars),
    text: flatten(item.text).slice(0, Math.min(PER_KIND_CHARS[item.kind], share)),
  }));
}

// Objeto plano o null.
function record(value: unknown): Record<string, unknown> | null {
  // Rechaza null, arrays y no objetos.
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Una página externa no apoya fechas, profesores, ejercicios ni requisitos del curso. */
export function authorityAllows(kind: EvidenceItem["kind"], subquestion: PlanItem): boolean {
  // Lo técnico admite cualquier fuente; lo interno solo curso o herramienta.
  return subquestion.kind === "technical" || kind === "course" || kind === "tool";
}

// Evidencia aceptada que respalda una subpregunta y tiene autoridad para hacerlo.
function supportFor(
  subquestion: PlanItem,
  accepted: readonly AcceptedEvidence[],
): AcceptedEvidence[] {
  // Filtra por subpregunta y autoridad.
  return accepted.filter(
    (entry) =>
      entry.subquestionIds.includes(subquestion.id) &&
      authorityAllows(entry.item.kind, subquestion),
  );
}

// Resultado de validar una evaluación.
export interface AssessmentResult {
  // Aceptadas.
  accepted: AcceptedEvidence[];
  // Rechazadas.
  rejected: RejectedEvidence[];
  // Cobertura.
  coverage: CoverageEntry[];
  // Contradicciones.
  contradictions: string[];
  // Asignaciones rechazadas por falta de autoridad.
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
    // Texto mostrado al modelo.
    shown: readonly ShownEvidence[];
    // Evidencia completa.
    items: readonly EvidenceItem[];
    // Subpreguntas.
    subquestions: readonly PlanItem[];
    // Aceptadas en rondas anteriores.
    prior: readonly AcceptedEvidence[];
    // Ronda actual.
    round: number;
  },
): { ok: true; value: AssessmentResult } | { ok: false; reason: string } {
  // Salida como objeto.
  const body = record(raw);
  // Debe traer items y coverage.
  if (body === null || !Array.isArray(body.items) || !Array.isArray(body.coverage)) {
    // Rechazo.
    return { ok: false, reason: "La evaluación no tiene la forma esperada." };
  }
  // Evidencia mostrada por id.
  const shownById = new Map(input.shown.map((entry) => [entry.sourceId, entry]));
  // Evidencia completa por id.
  const itemById = new Map(input.items.map((item) => [item.sourceId, item]));
  // Subpreguntas por id.
  const subById = new Map<string, PlanItem>(input.subquestions.map((item) => [item.id, item]));
  // Debe decidir sobre cada pieza mostrada.
  if (body.items.length !== input.shown.length) {
    // Rechazo.
    return { ok: false, reason: "La evaluación no cubre toda la evidencia mostrada." };
  }
  // Ids vistos.
  const seen = new Set<string>();
  // Aceptadas.
  const accepted: AcceptedEvidence[] = [];
  // Rechazadas.
  const rejected: RejectedEvidence[] = [];
  // Rechazos por autoridad.
  let authorityRejections = 0;
  // Revisa cada decisión.
  for (const entry of body.items) {
    // Fila como objeto.
    const row = record(entry);
    // Id de la fuente.
    const sourceId = typeof row?.sourceId === "string" ? row.sourceId : "";
    // Pieza mostrada.
    const shown = shownById.get(sourceId);
    // Pieza completa.
    const item = itemById.get(sourceId);
    // Motivo.
    const reason = boundedText(row?.reason, RESEARCH_LIMITS.maxReasonChars);
    // Id conocido, no repetido y con motivo.
    if (shown === undefined || item === undefined || seen.has(sourceId) || reason === null) {
      // Rechazo.
      return {
        ok: false,
        reason: "La evaluación trae un id desconocido, repetido o sin motivo.",
      };
    }
    // Marca el id.
    seen.add(sourceId);
    // Rechazada por el modelo.
    if (row?.decision === "reject") {
      // Se guarda el rechazo.
      rejected.push({ sourceId, kind: item.kind, round: input.round, reason });
      // Siguiente.
      continue;
    }
    // Solo aceptar o rechazar.
    if (row?.decision !== "accept") {
      // Rechazo.
      return { ok: false, reason: "Cada evidencia se acepta o se rechaza." };
    }
    // Subpreguntas que dice cubrir.
    const ids = Array.isArray(row.subquestionIds) ? row.subquestionIds : [];
    // Extractos que aporta.
    const excerpts = Array.isArray(row.excerpts) ? row.excerpts : [];
    // Necesita subpreguntas y entre 1 y el máximo de extractos.
    if (
      ids.length === 0 ||
      excerpts.length === 0 ||
      excerpts.length > RESEARCH_LIMITS.maxExcerptsPerSource
    ) {
      // Rechazo.
      return { ok: false, reason: "Una evidencia aceptada necesita subpreguntas y extractos." };
    }
    // Texto mostrado compactado.
    const text = flatten(shown.text);
    // Extractos comprobados.
    const verified: string[] = [];
    // Revisa cada extracto.
    for (const excerpt of excerpts) {
      // Extracto con tope.
      const clean = boundedText(excerpt, RESEARCH_LIMITS.maxExcerptChars);
      // Tiene que aparecer literalmente en lo mostrado.
      if (clean === null || !text.includes(clean)) {
        // Rechazo: no se aceptan citas inventadas.
        return {
          ok: false,
          reason: "Un extracto no aparece literalmente en la evidencia mostrada.",
        };
      }
      // Sin repetidos.
      if (!verified.includes(clean)) {
        // Añade.
        verified.push(clean);
      }
    }
    // Subpreguntas permitidas.
    const allowed: string[] = [];
    // Revisa cada subpregunta.
    for (const id of ids) {
      // Subpregunta del plan.
      const sub = typeof id === "string" ? subById.get(id) : undefined;
      // Desconocida.
      if (sub === undefined) {
        // Rechazo.
        return { ok: false, reason: "Una evidencia apunta a una subpregunta inexistente." };
      }
      // Sin autoridad para esa subpregunta.
      if (!authorityAllows(item.kind, sub)) {
        // Se cuenta.
        authorityRejections += 1;
        // Siguiente.
        continue;
      }
      // Sin repetidos.
      if (!allowed.includes(sub.id)) {
        // Añade.
        allowed.push(sub.id);
      }
    }
    // Ninguna permitida: se rechaza la evidencia.
    if (allowed.length === 0) {
      // Rechazo por autoridad.
      rejected.push({
        sourceId,
        kind: item.kind,
        round: input.round,
        reason: "Una página externa no documenta hechos internos del curso.",
      });
      // Siguiente.
      continue;
    }
    // Aceptada.
    accepted.push({
      item,
      subquestionIds: allowed,
      excerpts: verified,
      reason,
      round: input.round,
    });
  }
  // Aceptadas de todas las rondas.
  const all = [...input.prior, ...accepted];
  // Cobertura validada.
  const coverage: CoverageEntry[] = [];
  // Subpreguntas con cobertura.
  const covered = new Set<string>();
  // Revisa cada cobertura.
  for (const entry of body.coverage) {
    // Fila como objeto.
    const row = record(entry);
    // Subpregunta.
    const sub = typeof row?.subquestionId === "string" ? subById.get(row.subquestionId) : undefined;
    // Estado.
    const status = row?.status;
    // Subpregunta conocida, no repetida y con estado válido.
    if (
      sub === undefined ||
      covered.has(sub.id) ||
      (status !== "covered" && status !== "partial" && status !== "uncovered")
    ) {
      // Rechazo.
      return { ok: false, reason: "La cobertura no corresponde a las subpreguntas del plan." };
    }
    // Marca la subpregunta.
    covered.add(sub.id);
    // Evidencia que la respalda.
    const support = supportFor(sub, all);
    // Ids de esa evidencia.
    const sourceIds = support.map((item) => item.item.sourceId);
    // Cubierta o parcial sin evidencia: se rebaja a sin cubrir.
    if (status !== "uncovered" && support.length === 0) {
      // Sin cubrir.
      coverage.push({
        subquestionId: sub.id,
        status: "uncovered",
        gap: "La etiqueta de cobertura no tenía evidencia admitida.",
        followUp: false,
        sourceIds: [],
      });
      // Siguiente.
      continue;
    }
    // Laguna: null si está cubierta; si no, la del modelo o la de defecto.
    const gap =
      status === "covered"
        ? null
        : (boundedText(row?.gap, RESEARCH_LIMITS.maxReasonChars) ?? DEFAULT_GAP);
    // Guarda la cobertura.
    coverage.push({
      subquestionId: sub.id,
      status,
      gap,
      followUp: status !== "covered" && row?.followUp === true && gap !== DEFAULT_GAP,
      sourceIds,
    });
  }
  // Cada subpregunta necesita su cobertura.
  if (covered.size !== input.subquestions.length) {
    // Rechazo.
    return { ok: false, reason: "La cobertura omite una subpregunta." };
  }
  // Contradicciones.
  const contradictions: string[] = [];
  // Si las hay.
  if (Array.isArray(body.contradictions)) {
    // Como mucho tres.
    for (const item of body.contradictions.slice(0, 3)) {
      // Texto con tope.
      const text = boundedText(item, RESEARCH_LIMITS.maxReasonChars);
      // Válida.
      if (text !== null) {
        // Se guarda.
        contradictions.push(text);
      }
    }
  }
  // Evaluación válida.
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
  // Cobertura final de cada subpregunta.
  return subquestions.map((sub) => {
    // Propuesta de esta ronda.
    const proposal = proposed.find((entry) => entry.subquestionId === sub.id);
    // Cobertura anterior.
    const before = previous.find((entry) => entry.subquestionId === sub.id);
    // Evidencia que la respalda.
    const sourceIds = supportFor(sub, accepted).map((entry) => entry.item.sourceId);
    // Sin evidencia: sin cubrir.
    if (sourceIds.length === 0) {
      // Sin cubrir con la laguna disponible.
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
    // Propuesta cubierta con evidencia.
    if (proposal?.status === "covered") {
      // Cubierta.
      return {
        subquestionId: sub.id,
        status: "covered" as const,
        gap: null,
        followUp: false,
        sourceIds,
      };
    }
    // Propuesta parcial.
    if (proposal?.status === "partial") {
      // Parcial con su laguna.
      return {
        subquestionId: sub.id,
        status: "partial" as const,
        gap: proposal.gap ?? before?.gap ?? DEFAULT_GAP,
        followUp:
          proposal.followUp === true && proposal.gap !== null && proposal.gap !== DEFAULT_GAP,
        sourceIds,
      };
    }
    // ¿Alguna evidencia no se mostró en esta ronda?
    const unseen = sourceIds.some((id) => !shownSourceIds.has(id));
    // Si no se pudo reevaluar, se conserva lo anterior.
    if (unseen && (before?.status === "covered" || before?.status === "partial")) {
      // Estado anterior.
      return {
        subquestionId: sub.id,
        status: before.status,
        gap: before.gap,
        followUp: false,
        sourceIds,
      };
    }
    // Antes estaba cubierta.
    if (before?.status === "covered") {
      // Sigue cubierta.
      return {
        subquestionId: sub.id,
        status: "covered" as const,
        gap: null,
        followUp: false,
        sourceIds,
      };
    }
    // Lo demás: parcial.
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
  // Cobertura de cada subpregunta.
  return subquestions.map((sub) => {
    // Anterior.
    const before = previous.find((entry) => entry.subquestionId === sub.id);
    // Evidencia que la respalda.
    const sourceIds = supportFor(sub, accepted).map((entry) => entry.item.sourceId);
    // Se conserva sin seguimiento.
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
  // Evidencia.
  const item = entry.item;
  // Extractos recortados y como mucho el máximo.
  const excerpts = entry.excerpts
    .map((text) => text.slice(0, RESEARCH_LIMITS.maxExcerptChars))
    .slice(0, RESEARCH_LIMITS.maxExcerptsPerSource);
  // Solo ids q1, q2 o q3.
  const subquestionIds = entry.subquestionIds.filter(
    (id): id is "q1" | "q2" | "q3" => id === "q1" || id === "q2" || id === "q3",
  );
  // Fuente del curso.
  if (item.kind === "course") {
    // Fuente pública del curso.
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
  // Fuente de la herramienta.
  if (item.kind === "tool") {
    // Fuente pública de la herramienta.
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
  // Fuente web.
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
