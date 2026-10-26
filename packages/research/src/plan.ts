// GUÍA DE LECTURA · packages/research/src/plan.ts
// Validadores del plan de investigación y de las consultas de seguimiento que propone el modelo.
// El plan es acotado y coherente: 1 a 3 subpreguntas q1..q3, hechos internos de la tienda sin
// búsqueda externa y argumentos de la herramienta limitados a un número de pedido bien formado.
// Límites y tipos del contrato.
import { RESEARCH_LIMITS, type ResearchRoute } from "@thepower-rag/contracts";
// Normalización de consultas para detectar repetidas.
import { normalizeQuery } from "@thepower-rag/core";
// Tipo de los argumentos de la herramienta.
import type { OrderToolArgs } from "./ports";

// Subpregunta validada del plan.
export interface PlanItem {
  // Identificador en orden.
  id: "q1" | "q2" | "q3";
  // Texto.
  text: string;
  // Política de la tienda, dato de un pedido o fuente externa.
  kind: "store" | "order" | "external";
  // Si necesita fuentes externas.
  external: boolean;
  /** Consulta externa generada. Nunca sustituye a la pregunta original. */
  query: string | null;
}

// Plan validado.
export interface ResearchPlan {
  // Ruta: políticas de la tienda, herramienta, investigar o aclarar.
  route: ResearchRoute;
  // Explicación de la decisión.
  rationale: string;
  // Subpreguntas.
  subquestions: PlanItem[];
  // Argumentos de la herramienta, o null.
  tool: OrderToolArgs | null;
  // Aclaración que se pide, o null.
  clarification: string | null;
}

// Ids admitidos en orden.
const IDS = ["q1", "q2", "q3"] as const;
// Número de pedido de ThePower Shop: «TPS-» y cinco cifras.
const ORDER_ID = /^TPS-\d{5}$/;

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

/**
 * Valida los argumentos de la herramienta de pedidos. Solo comprueba la forma
 * del número: a qué cuenta pertenece el pedido lo decide la herramienta, nunca
 * el modelo ni el texto de un adjunto.
 */
export function validateOrderArgs(raw: unknown): Verdict<OrderToolArgs> {
  // Argumentos como objeto.
  const body = record(raw);
  // Pedido en mayúsculas sin espacios.
  const orderId = typeof body?.orderId === "string" ? body.orderId.trim().toUpperCase() : "";
  // Solo «TPS-» y cinco cifras.
  if (!ORDER_ID.test(orderId)) {
    // Rechazo.
    return { ok: false, reason: "La herramienta solo admite pedidos con la forma TPS-12345." };
  }
  // Argumentos válidos.
  return { ok: true, value: { orderId } };
}

/**
 * Valida el plan del modelo. El plan es acotado: de una a tres subpreguntas,
 * ids q1..qN en orden, hechos internos sin búsqueda externa y una ruta
 * coherente con lo que pide cada subpregunta.
 */
export function validatePlan(raw: unknown): Verdict<ResearchPlan> {
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
  if (route !== "store" && route !== "tool" && route !== "investigate" && route !== "clarify") {
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
    if (text === null || (kind !== "store" && kind !== "order" && kind !== "external")) {
      // Rechazo.
      return { ok: false, reason: "Una subpregunta tiene texto o tipo inválido." };
    }
    // external tiene que ser booleano.
    if (typeof row.external !== "boolean") {
      // Rechazo.
      return { ok: false, reason: "Cada subpregunta indica si necesita fuentes externas." };
    }
    // Solo lo externo se busca fuera.
    if (row.external && kind !== "external") {
      // Rechazo.
      return {
        ok: false,
        reason: "Un hecho interno de la tienda no se investiga en fuentes externas.",
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
  // ¿Alguna sobre un pedido?
  const order = items.some((item) => item.kind === "order");
  // Investigar exige algo externo.
  if (route === "investigate" && !external) {
    // Rechazo.
    return { ok: false, reason: "Investigar exige al menos una subpregunta externa." };
  }
  // Políticas o herramienta no buscan fuera.
  if ((route === "store" || route === "tool") && external) {
    // Rechazo.
    return { ok: false, reason: "Una respuesta de la tienda no lanza búsquedas externas." };
  }
  // La herramienta necesita una subpregunta sobre un pedido.
  if (route === "tool" && !order) {
    // Rechazo.
    return { ok: false, reason: "La ruta de herramienta necesita una subpregunta de pedido." };
  }
  // Argumentos de la herramienta.
  let tool: OrderToolArgs | null = null;
  // Con subpregunta de pedido se validan.
  if (order) {
    // Validación.
    const args = validateOrderArgs(body.tool);
    // Inválidos.
    if (!args.ok) {
      // Se devuelve el rechazo.
      return args;
    }
    // Válidos.
    tool = args.value;
  } else if (body.tool !== null && body.tool !== undefined) {
    // Pide la herramienta sin subpregunta de pedido.
    return { ok: false, reason: "El plan pide la herramienta sin una subpregunta de pedido." };
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
