import { RESEARCH_LIMITS, type Audience, type ResearchRoute } from "@thepower-rag/contracts";
import { normalizeQuery } from "@thepower-rag/core";
import type { SessionToolArgs } from "./ports";

export interface PlanItem {
  id: "q1" | "q2" | "q3";
  text: string;
  kind: "course" | "session" | "technical";
  external: boolean;
  /** Consulta externa generada. Nunca sustituye a la pregunta original. */
  query: string | null;
}

export interface ResearchPlan {
  route: ResearchRoute;
  rationale: string;
  subquestions: PlanItem[];
  tool: SessionToolArgs | null;
  clarification: string | null;
}

const IDS = ["q1", "q2", "q3"] as const;
const SESSION = /^S(?:[1-9]|1\d|20)$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string };

export function validateSessionArgs(raw: unknown, audience: Audience): Verdict<SessionToolArgs> {
  const body = record(raw);
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim().toUpperCase() : "";
  if (!SESSION.test(sessionId)) {
    return { ok: false, reason: "La herramienta solo admite sesiones S1 a S20." };
  }
  if (body?.audience !== audience) {
    return {
      ok: false,
      reason: "La herramienta solo consulta el grupo seleccionado en la petición.",
    };
  }
  return { ok: true, value: { sessionId, audience } };
}

/**
 * Valida el plan del modelo. El plan es acotado: de una a tres subpreguntas,
 * ids q1..qN en orden, hechos internos sin búsqueda externa y una ruta
 * coherente con lo que pide cada subpregunta.
 */
export function validatePlan(raw: unknown, audience: Audience): Verdict<ResearchPlan> {
  const body = record(raw);
  if (body === null) {
    return { ok: false, reason: "El plan no tiene la forma esperada." };
  }
  const route = body.route;
  if (route !== "course" && route !== "tool" && route !== "investigate" && route !== "clarify") {
    return { ok: false, reason: "La ruta del plan no es válida." };
  }
  const rationale = boundedText(body.rationale, RESEARCH_LIMITS.maxReasonChars);
  if (rationale === null) {
    return { ok: false, reason: "El plan no explica su decisión." };
  }
  const list = body.subquestions;
  if (!Array.isArray(list)) {
    return { ok: false, reason: "El plan no trae subpreguntas." };
  }
  if (route === "clarify") {
    const clarification = boundedText(body.clarification, RESEARCH_LIMITS.maxReasonChars);
    if (list.length > 0 || clarification === null) {
      return { ok: false, reason: "Una aclaración no lleva subpreguntas y necesita el motivo." };
    }
    return {
      ok: true,
      value: { route, rationale, subquestions: [], tool: null, clarification },
    };
  }
  if (list.length === 0 || list.length > RESEARCH_LIMITS.maxSubquestions) {
    return {
      ok: false,
      reason: `El plan necesita de 1 a ${String(RESEARCH_LIMITS.maxSubquestions)} subpreguntas.`,
    };
  }
  const items: PlanItem[] = [];
  const seenText = new Set<string>();
  for (const [index, entry] of list.entries()) {
    const row = record(entry);
    const id = IDS[index];
    if (row === null || id === undefined || row.id !== id) {
      return { ok: false, reason: "Los ids de las subpreguntas deben ser q1, q2 y q3 en orden." };
    }
    const text = boundedText(row.text, RESEARCH_LIMITS.maxSubquestionChars);
    const kind = row.kind;
    if (text === null || (kind !== "course" && kind !== "session" && kind !== "technical")) {
      return { ok: false, reason: "Una subpregunta tiene texto o tipo inválido." };
    }
    if (typeof row.external !== "boolean") {
      return { ok: false, reason: "Cada subpregunta indica si necesita fuentes externas." };
    }
    if (row.external && kind !== "technical") {
      return {
        ok: false,
        reason: "Un hecho interno del curso no se investiga en fuentes externas.",
      };
    }
    const normalized = normalizeQuery(text);
    if (seenText.has(normalized)) {
      return { ok: false, reason: "El plan repite una subpregunta." };
    }
    seenText.add(normalized);
    let query: string | null = null;
    if (row.external) {
      query = boundedText(row.query, RESEARCH_LIMITS.maxQueryChars);
      if (query === null) {
        return { ok: false, reason: "Una subpregunta externa necesita su consulta de búsqueda." };
      }
    }
    items.push({ id, text, kind, external: row.external, query });
  }
  const external = items.some((item) => item.external);
  const session = items.some((item) => item.kind === "session");
  if (route === "investigate" && !external) {
    return { ok: false, reason: "Investigar exige al menos una subpregunta técnica externa." };
  }
  if ((route === "course" || route === "tool") && external) {
    return { ok: false, reason: "Una respuesta del curso no lanza búsquedas externas." };
  }
  if (route === "tool" && !session) {
    return { ok: false, reason: "La ruta de herramienta necesita una subpregunta de sesión." };
  }
  let tool: SessionToolArgs | null = null;
  if (session) {
    const args = validateSessionArgs(body.tool, audience);
    if (!args.ok) {
      return args;
    }
    tool = args.value;
  } else if (body.tool !== null && body.tool !== undefined) {
    return { ok: false, reason: "El plan pide la herramienta sin una subpregunta de sesión." };
  }
  return { ok: true, value: { route, rationale, subquestions: items, tool, clarification: null } };
}

export interface FollowUpQuery {
  subquestionId: string;
  query: string;
}

/**
 * Valida las consultas de seguimiento. Solo para subpreguntas con una laguna
 * elegible. Las consultas repetidas (normalizadas) se descartan y se informan.
 */
export function validateFollowUp(
  raw: unknown,
  eligible: readonly string[],
  previousQueries: readonly string[],
): Verdict<{ queries: FollowUpQuery[]; repeated: FollowUpQuery[] }> {
  const body = record(raw);
  if (body === null || !Array.isArray(body.queries)) {
    return { ok: false, reason: "El seguimiento no tiene la forma esperada." };
  }
  if (body.queries.length === 0 || body.queries.length > eligible.length) {
    return { ok: false, reason: "El seguimiento propone un número de consultas no válido." };
  }
  const seen = new Set(previousQueries.map((item) => normalizeQuery(item)));
  const used = new Set<string>();
  const queries: FollowUpQuery[] = [];
  const repeated: FollowUpQuery[] = [];
  for (const entry of body.queries) {
    const row = record(entry);
    const subquestionId = typeof row?.subquestionId === "string" ? row.subquestionId : "";
    const query = boundedText(row?.query, RESEARCH_LIMITS.maxQueryChars);
    if (!eligible.includes(subquestionId) || used.has(subquestionId) || query === null) {
      return { ok: false, reason: "Una consulta de seguimiento no corresponde a una laguna." };
    }
    used.add(subquestionId);
    const normalized = normalizeQuery(query);
    if (seen.has(normalized)) {
      repeated.push({ subquestionId, query });
      continue;
    }
    seen.add(normalized);
    queries.push({ subquestionId, query });
  }
  return { ok: true, value: { queries, repeated } };
}
