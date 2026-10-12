// GUÍA DE LECTURA · packages/research/src/plan.ts
// Validadores del plan de investigación y de las consultas de seguimiento que propone el modelo.
// El plan es acotado y coherente: 1 a 3 subpreguntas q1..q3, hechos del curso sin búsqueda externa
// y argumentos de la herramienta limitados a la sesión y al grupo de la petición.
// Límites y tipos del contrato.
import { RESEARCH_LIMITS, type Audience, type ResearchRoute } from "@thepower-rag/contracts";
// Normalización de consultas para detectar repetidas.
import { normalizeQuery } from "@thepower-rag/core";
// Tipo de los argumentos de la herramienta.
import type { SessionToolArgs } from "./ports";

// Subpregunta validada del plan.
export interface PlanItem {
  // Identificador en orden.
  id: "q1" | "q2" | "q3";
  // Texto.
  text: string;
  // Del curso, de una sesión o técnica.
  kind: "course" | "session" | "technical";
  // Si necesita fuentes externas.
  external: boolean;
  /** Consulta externa generada. Nunca sustituye a la pregunta original. */
  query: string | null;
}

// Plan validado.
export interface ResearchPlan {
  // Ruta: curso, herramienta, investigar o aclarar.
  route: ResearchRoute;
  // Explicación de la decisión.
  rationale: string;
  // Subpreguntas.
  subquestions: PlanItem[];
  // Argumentos de la herramienta, o null.
  tool: SessionToolArgs | null;
  // Aclaración que se pide, o null.
  clarification: string | null;
}

// Ids admitidos en orden.
const IDS = ["q1", "q2", "q3"] as const;
// Sesiones S1 a S20.
const SESSION = /^S(?:[1-9]|1\d|20)$/;

// Objeto plano o null.
function record(value: unknown): Record<string, unknown> | null {
  // Rechaza null, arrays y no objetos.
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Texto con espacios compactados y un tope, o null.
export function boundedText(value: unknown, max: number): string | null {
  // Tiene que ser texto.
  if (typeof value !== "string") {
    // No lo es.
    return null;
  }
  // Junta espacios y recorta.
  const trimmed = value.replace(/\s+/g, " ").trim();
  // Vacío o largo: null.
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
}

// Resultado de una validación: valor o motivo del rechazo.
type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string };

// Valida los argumentos de la herramienta de sesiones.
export function validateSessionArgs(raw: unknown, audience: Audience): Verdict<SessionToolArgs> {
  // Argumentos como objeto.
  const body = record(raw);
  // Sesión en mayúsculas sin espacios.
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim().toUpperCase() : "";
  // Solo S1 a S20.
  if (!SESSION.test(sessionId)) {
    // Rechazo.
    return { ok: false, reason: "La herramienta solo admite sesiones S1 a S20." };
  }
  // Solo el grupo de la petición.
  if (body?.audience !== audience) {
    // Rechazo.
    return {
      ok: false,
      reason: "La herramienta solo consulta el grupo seleccionado en la petición.",
    };
  }
  // Argumentos válidos.
  return { ok: true, value: { sessionId, audience } };
}

/**
 * Valida el plan del modelo. El plan es acotado: de una a tres subpreguntas,
 * ids q1..qN en orden, hechos internos sin búsqueda externa y una ruta
 * coherente con lo que pide cada subpregunta.
 */
export function validatePlan(raw: unknown, audience: Audience): Verdict<ResearchPlan> {
  // Salida como objeto.
  const body = record(raw);
  // Forma incorrecta.
  if (body === null) {
    // Rechazo.
    return { ok: false, reason: "El plan no tiene la forma esperada." };
  }
  // Ruta propuesta.
  const route = body.route;
  // Debe ser una de las cuatro.
  if (route !== "course" && route !== "tool" && route !== "investigate" && route !== "clarify") {
    // Rechazo.
    return { ok: false, reason: "La ruta del plan no es válida." };
  }
  // Explicación con tope.
  const rationale = boundedText(body.rationale, RESEARCH_LIMITS.maxReasonChars);
  // Sin explicación.
  if (rationale === null) {
    // Rechazo.
    return { ok: false, reason: "El plan no explica su decisión." };
  }
  // Lista de subpreguntas.
  const list = body.subquestions;
  // Debe ser una lista.
  if (!Array.isArray(list)) {
    // Rechazo.
    return { ok: false, reason: "El plan no trae subpreguntas." };
  }
  // Ruta de aclaración.
  if (route === "clarify") {
    // Motivo de la aclaración.
    const clarification = boundedText(body.clarification, RESEARCH_LIMITS.maxReasonChars);
    // Sin subpreguntas y con motivo.
    if (list.length > 0 || clarification === null) {
      // Rechazo.
      return { ok: false, reason: "Una aclaración no lleva subpreguntas y necesita el motivo." };
    }
    // Plan de aclaración válido.
    return {
      ok: true,
      value: { route, rationale, subquestions: [], tool: null, clarification },
    };
  }
  // Entre 1 y 3 subpreguntas.
  if (list.length === 0 || list.length > RESEARCH_LIMITS.maxSubquestions) {
    // Rechazo.
    return {
      ok: false,
      reason: `El plan necesita de 1 a ${String(RESEARCH_LIMITS.maxSubquestions)} subpreguntas.`,
    };
  }
  // Subpreguntas validadas.
  const items: PlanItem[] = [];
  // Textos ya vistos.
  const seenText = new Set<string>();
  // Revisa cada subpregunta con su posición.
  for (const [index, entry] of list.entries()) {
    // Fila como objeto.
    const row = record(entry);
    // Id que le corresponde por posición.
    const id = IDS[index];
    // Tiene que coincidir con q1, q2, q3 en orden.
    if (row === null || id === undefined || row.id !== id) {
      // Rechazo.
      return { ok: false, reason: "Los ids de las subpreguntas deben ser q1, q2 y q3 en orden." };
    }
    // Texto con tope.
    const text = boundedText(row.text, RESEARCH_LIMITS.maxSubquestionChars);
    // Tipo.
    const kind = row.kind;
    // Texto y tipo válidos.
    if (text === null || (kind !== "course" && kind !== "session" && kind !== "technical")) {
      // Rechazo.
      return { ok: false, reason: "Una subpregunta tiene texto o tipo inválido." };
    }
    // external tiene que ser booleano.
    if (typeof row.external !== "boolean") {
      // Rechazo.
      return { ok: false, reason: "Cada subpregunta indica si necesita fuentes externas." };
    }
    // Solo lo técnico se busca fuera.
    if (row.external && kind !== "technical") {
      // Rechazo.
      return {
        ok: false,
        reason: "Un hecho interno del curso no se investiga en fuentes externas.",
      };
    }
    // Texto normalizado.
    const normalized = normalizeQuery(text);
    // Sin subpreguntas repetidas.
    if (seenText.has(normalized)) {
      // Rechazo.
      return { ok: false, reason: "El plan repite una subpregunta." };
    }
    // Marca el texto.
    seenText.add(normalized);
    // Consulta externa.
    let query: string | null = null;
    // Solo las externas llevan consulta.
    if (row.external) {
      // Consulta con tope.
      query = boundedText(row.query, RESEARCH_LIMITS.maxQueryChars);
      // Falta la consulta.
      if (query === null) {
        // Rechazo.
        return { ok: false, reason: "Una subpregunta externa necesita su consulta de búsqueda." };
      }
    }
    // Guarda la subpregunta.
    items.push({ id, text, kind, external: row.external, query });
  }
  // ¿Alguna externa?
  const external = items.some((item) => item.external);
  // ¿Alguna de sesión?
  const session = items.some((item) => item.kind === "session");
  // Investigar exige algo externo.
  if (route === "investigate" && !external) {
    // Rechazo.
    return { ok: false, reason: "Investigar exige al menos una subpregunta técnica externa." };
  }
  // Curso o herramienta no buscan fuera.
  if ((route === "course" || route === "tool") && external) {
    // Rechazo.
    return { ok: false, reason: "Una respuesta del curso no lanza búsquedas externas." };
  }
  // La herramienta necesita una subpregunta de sesión.
  if (route === "tool" && !session) {
    // Rechazo.
    return { ok: false, reason: "La ruta de herramienta necesita una subpregunta de sesión." };
  }
  // Argumentos de la herramienta.
  let tool: SessionToolArgs | null = null;
  // Con subpregunta de sesión se validan.
  if (session) {
    // Validación.
    const args = validateSessionArgs(body.tool, audience);
    // Inválidos.
    if (!args.ok) {
      // Se devuelve el rechazo.
      return args;
    }
    // Válidos.
    tool = args.value;
  } else if (body.tool !== null && body.tool !== undefined) {
    // Pide la herramienta sin subpregunta de sesión.
    return { ok: false, reason: "El plan pide la herramienta sin una subpregunta de sesión." };
  }
  // Plan válido.
  return { ok: true, value: { route, rationale, subquestions: items, tool, clarification: null } };
}

// Consulta de seguimiento.
export interface FollowUpQuery {
  // Subpregunta a la que pertenece.
  subquestionId: string;
  // Consulta.
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
  // Salida como objeto.
  const body = record(raw);
  // Debe traer la lista queries.
  if (body === null || !Array.isArray(body.queries)) {
    // Rechazo.
    return { ok: false, reason: "El seguimiento no tiene la forma esperada." };
  }
  // Entre 1 y tantas como lagunas elegibles.
  if (body.queries.length === 0 || body.queries.length > eligible.length) {
    // Rechazo.
    return { ok: false, reason: "El seguimiento propone un número de consultas no válido." };
  }
  // Consultas anteriores normalizadas.
  const seen = new Set(previousQueries.map((item) => normalizeQuery(item)));
  // Subpreguntas ya usadas.
  const used = new Set<string>();
  // Consultas nuevas.
  const queries: FollowUpQuery[] = [];
  // Consultas repetidas.
  const repeated: FollowUpQuery[] = [];
  // Revisa cada consulta.
  for (const entry of body.queries) {
    // Fila como objeto.
    const row = record(entry);
    // Subpregunta.
    const subquestionId = typeof row?.subquestionId === "string" ? row.subquestionId : "";
    // Consulta con tope.
    const query = boundedText(row?.query, RESEARCH_LIMITS.maxQueryChars);
    // Debe ser elegible, única por subpregunta y no vacía.
    if (!eligible.includes(subquestionId) || used.has(subquestionId) || query === null) {
      // Rechazo.
      return { ok: false, reason: "Una consulta de seguimiento no corresponde a una laguna." };
    }
    // Marca la subpregunta.
    used.add(subquestionId);
    // Consulta normalizada.
    const normalized = normalizeQuery(query);
    // Ya se hizo antes.
    if (seen.has(normalized)) {
      // Se informa como repetida.
      repeated.push({ subquestionId, query });
      // Siguiente.
      continue;
    }
    // Marca la consulta.
    seen.add(normalized);
    // Consulta nueva.
    queries.push({ subquestionId, query });
  }
  // Consultas validadas.
  return { ok: true, value: { queries, repeated } };
}
