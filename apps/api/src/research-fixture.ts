// GUÍA DE LECTURA · apps/api/src/research-fixture.ts
// Puertos de prueba de la investigación sobre ThePower Shop: un guion por escenario decide plan,
// búsquedas, páginas leídas, evaluación e informe. Sirven para ver el flujo del grafo sin red ni
// modelos; no miden calidad.
// Dominios por defecto, escenarios de demo y tipos.
import {
  DEFAULT_RESEARCH_DOMAINS,
  DEMO_RESEARCH_SCENARIOS,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
// Núcleo RAG: coseno, umbral y embedding de prueba.
import { cosine, FIXTURE_MIN_SCORE, fixtureEmbed, normalizeQuery } from "@thepower-rag/core";
// Utilidades y tipos del paquete de investigación.
import {
  flatten,
  webSourceId,
  withoutHeadings,
  type PortResult,
  type ResearchModelPort,
  type ResearchPorts,
  type SearchHit,
  type ShownEvidence,
  type StoreEvidence,
} from "@thepower-rag/research";
// Fragmentos de las políticas de la tienda con su vector léxico.
import { storeFixtureChunks } from "./fixture";
// Páginas web simuladas.
import { FIXTURE_PAGES, fixturePageByUrl, type FixturePage } from "./research-fixture-data";
// Herramienta de pedidos y sus datos ficticios.
import { createOrderTool, ORDER_DATA } from "./research-tool";
// Hash SHA-256.
import { sha256Hex } from "./snapshot-hash";

/** Hora fija de las lecturas de prueba: la demo es determinista. */
export const FIXTURE_RETRIEVED_AT = "2026-10-26T00:00:00.000Z";

// Subpregunta 1 del escenario principal: la política de la tienda.
export const MAIN_Q1 =
  "¿Qué dice la política de ThePower Shop sobre devolver auriculares intraauditivos abiertos o defectuosos y cuánto tarda el reembolso con Bizum?";
// Subpregunta 2: los datos del pedido.
export const MAIN_Q2 = "¿Qué datos tiene el pedido TPS-20481: pago, fecha de entrega y estado?";
// Subpregunta 3: la normativa europea.
export const MAIN_Q3 =
  "¿Qué dice la normativa europea sobre desistir de un producto precintado y sobre la garantía de un producto defectuoso?";
// Pedido del caso.
export const MAIN_ORDER = "TPS-20481";
// Consulta web de la subpregunta 3.
export const MAIN_Q3_QUERY = "derecho de desistimiento productos precintados higiene garantía UE";
// Consulta de seguimiento.
export const FOLLOW_Q3_QUERY = "garantía legal producto defectuoso reparación sustitución UE";
// Consulta que no avanza.
export const STALL_Q3_QUERY = "devolver auriculares abiertos normativa";
// Fallo del proveedor: la normativa se parte en dos subpreguntas externas.
const FAIL_Q2 = "¿Qué dice la normativa europea sobre desistir de un producto precintado?";
// Su consulta, que falla en el buscador.
const FAIL_Q2_QUERY = "desistimiento productos precintados higiene UE";
// Segunda subpregunta externa.
const FAIL_Q3 = "¿Qué dice la normativa europea sobre la garantía de un producto defectuoso?";
// Su consulta, cuya página no se puede leer.
const FAIL_Q3_QUERY = "garantía legal producto defectuoso UE";
// Dato interno que no consta.
const FACT_Q1 = "¿Qué descuento hace ThePower Shop a los estudiantes?";
// Pregunta externa del mismo escenario.
const FACT_Q2 =
  "¿Quién paga el envío de una devolución por desistimiento según la normativa europea?";
// Su consulta web.
const FACT_Q2_QUERY = "quién paga gastos de devolución desistimiento compra en línea UE";

// Escenarios que usan el plan principal.
const MAIN_SCENARIOS: readonly ResearchScenarioId[] = [
  "sufficient-first-round",
  "partial-follow-up",
  "irrelevant-discarded",
  "provider-failure",
  "no-progress-stop",
  "invalid-citation",
];

// Escenario indicado o el de una pregunta de demo idéntica.
export function resolveResearchScenario(
  explicit: ResearchScenarioId | undefined,
  question: string,
): ResearchScenarioId | null {
  // Indicado: se usa.
  if (explicit !== undefined) {
    // Ese.
    return explicit;
  }
  // Pregunta sin espacios.
  const trimmed = question.trim();
  // Escenario cuya pregunta coincide.
  const match = DEMO_RESEARCH_SCENARIOS.find((item) => item.question === trimmed);
  // Id o null.
  return match?.id ?? null;
}

// Resultado correcto sin consumo.
const ok = <T>(value: T): PortResult<T> => ({ ok: true, value, consumption: { kind: "none" } });

// Resultados de búsqueda a partir de páginas simuladas.
function hits(...pages: FixturePage[]): PortResult<SearchHit[]> {
  // URL, título y extracto.
  return ok(pages.map((page) => ({ url: page.url, title: page.title, snippet: page.snippet })));
}

// Alias corto de las páginas.
const P = FIXTURE_PAGES;
// Id de fuente web de una página.
const webId = (page: FixturePage) => webSourceId(page.finalUrl ?? page.url);
// Id de la fuente de la herramienta para el pedido del caso.
const ORDER_SOURCE = `tool:order:${MAIN_ORDER.toLowerCase()}`;

/** Busca la frase que contiene la palabra clave: siempre es un extracto literal. */
export function pickExcerpt(text: string, keyword: string): string {
  // Texto en una línea.
  const flat = flatten(text);
  // Posición de la palabra clave.
  const index = flat.indexOf(keyword);
  // No aparece.
  if (index === -1) {
    // Primeros 200 caracteres.
    return flat.slice(0, 200).trim();
  }
  // Inicio de la frase.
  const start = Math.max(0, flat.lastIndexOf(". ", index) + 2);
  // Fin de la frase.
  const end = flat.indexOf(".", index + keyword.length);
  // Frase recortada.
  return flat
    .slice(start === 1 ? 0 : start, end === -1 ? undefined : end + 1)
    .slice(0, 300)
    .trim();
}

// Regla del guion para una fuente.
interface Rule {
  // Subpreguntas que cubre.
  subs: string[];
  // Palabras clave de los extractos.
  keywords: string[];
  // Motivo.
  reason: string;
}

// Tabla de reglas: aceptar con regla o rechazar con motivo.
type RuleTable = Record<string, Rule | { reject: string }>;

// Id del fragmento sin la versión.
function storeKey(sourceId: string): string {
  // Quita el prefijo de versión.
  return sourceId.replace(/^[^:]+:/, "");
}

// Reglas del escenario y la ronda.
function rulesFor(scenario: ResearchScenarioId | null, round: number): RuleTable {
  // Reglas del escenario principal.
  const main: RuleTable = {
    // Políticas de la tienda: exclusión por higiene, garantía y plazo de abono con Bizum.
    "03-electronica-y-garantia:01": {
      subs: ["q1"],
      keywords: ["precinto higiénico", "a través de la garantía"],
      reason: "Los intraauditivos abiertos solo se devuelven por la garantía.",
    },
    "03-electronica-y-garantia:03": {
      subs: ["q1"],
      keywords: ["3 años de garantía legal"],
      reason: "Plazo de la garantía legal de un producto nuevo.",
    },
    "06-pagos-y-reembolsos:02": {
      subs: ["q1"],
      keywords: ["2 días hábiles en Bizum"],
      reason: "Plazo de abono de un reembolso con Bizum.",
    },
    // Datos del pedido que devuelve la herramienta.
    [ORDER_SOURCE]: {
      subs: ["q2"],
      keywords: ["Pago:", "Entrega:", "Estado:"],
      reason: "Datos del pedido de la cuenta de la conversación.",
    },
    // Normativa externa.
    [webId(P.withdrawal)]: {
      subs: ["q3"],
      keywords: ["catorce días sin", "precintados por razones"],
      reason: "Plazo legal de desistimiento y excepción por higiene.",
    },
    [webId(P.guarantees)]: {
      subs: ["q3"],
      keywords: ["debe repararlo", "tres años"],
      reason: "Qué hace el vendedor con un producto defectuoso y plazo en España.",
    },
    [webId(P.boeLaw)]: {
      subs: ["q3"],
      keywords: ["desprecintados tras la entrega"],
      reason: "Texto legal de la excepción por higiene.",
    },
    // Reglas de rechazo: el evaluador de prueba las descarta con su motivo.
    "02-devoluciones:00": {
      reject: "Plazo general; los intraauditivos tienen su exclusión propia.",
    },
    "10-productos-prohibidos-y-restringidos:00": {
      reject: "Trata productos prohibidos, no devoluciones.",
    },
    [webId(P.airPassengers)]: { reject: "Trata derechos de pasajeros aéreos, no compras." },
    [webId(P.injected)]: { reject: "Contiene instrucciones embebidas y no aporta a la pregunta." },
  };
  // Dato interno que falta.
  if (scenario === "internal-fact-missing") {
    // Reglas propias.
    return {
      // Se rechazan: las políticas no documentan un descuento para estudiantes (falta a propósito).
      "12-promociones-y-cupones:00": {
        reject: "Cupón de bienvenida para clientes nuevos; no menciona estudiantes.",
      },
      "09-thepower-shop-plus:00": { reject: "Precio de Plus; no hay descuento para estudiantes." },
      // La página europea sí responde a la parte externa.
      [webId(P.withdrawal)]: {
        subs: ["q2"],
        keywords: ["gastos de devolución"],
        reason: "Dice quién paga la devolución por desistimiento.",
      },
    };
  }
  // Seguimiento parcial en la ronda 1: la página de desistimiento no trata la garantía.
  if (scenario === "partial-follow-up" && round === 1) {
    // Solo el desistimiento.
    return {
      ...main,
      [webId(P.withdrawal)]: {
        subs: ["q3"],
        keywords: ["catorce días sin", "precintados por razones"],
        reason: "Cubre el desistimiento, pero no la garantía de un producto defectuoso.",
      },
    };
  }
  // Reglas principales.
  return main;
}

// Cobertura guionizada de una subpregunta.
type Cover = { status: "covered" | "partial" | "uncovered"; gap: string | null; followUp: boolean };

// Cobertura guionizada de cada subpregunta según escenario y ronda; null si no hay guion.
function coverageFor(
  scenario: ResearchScenarioId | null,
  round: number,
): Record<string, Cover> | null {
  // Cubierta.
  const covered: Cover = { status: "covered", gap: null, followUp: false };
  // Todas cubiertas.
  const all = { q1: covered, q2: covered, q3: covered };
  // Según el escenario.
  switch (scenario) {
    // Primera ronda suficiente.
    case "sufficient-first-round":
    // Irrelevantes descartadas.
    case "irrelevant-discarded":
    // Cita inventada.
    case "invalid-citation":
      // Todo cubierto.
      return all;
    // Seguimiento parcial.
    case "partial-follow-up":
      // q3 parcial en la ronda 1.
      return round === 1
        ? {
            ...all,
            q3: {
              status: "partial",
              gap: "Falta lo que dice la normativa sobre la garantía de un producto defectuoso.",
              followUp: true,
            },
          }
        : all;
    // Fallo del proveedor.
    case "provider-failure":
      // q2 sin búsqueda útil y q3 sin lectura: dos fallos operativos.
      return {
        q1: covered,
        q2: {
          status: "uncovered",
          gap: "No hay páginas leídas para esta subpregunta.",
          followUp: true,
        },
        q3: {
          status: "uncovered",
          gap: "No se pudo leer la página sobre la garantía de los productos defectuosos.",
          followUp: true,
        },
      };
    // Sin progreso.
    case "no-progress-stop":
      // q1 y q3 siguen parciales y piden seguimiento; como la ronda no aporta nada nuevo, el
      // grafo para.
      return {
        q1: {
          status: "partial",
          gap: "Falta confirmar si la garantía cubre un defecto de un solo auricular.",
          followUp: true,
        },
        q2: covered,
        q3: {
          status: "partial",
          gap: "Falta lo que dice la normativa sobre la garantía de un producto defectuoso.",
          followUp: true,
        },
      };
    // Dato interno que falta.
    case "internal-fact-missing":
      // q1 sin cubrir.
      return {
        q1: {
          status: "uncovered",
          gap: "Las políticas de ThePower Shop no documentan un descuento para estudiantes.",
          followUp: false,
        },
        q2: covered,
      };
    // Herramienta de pedidos.
    case "order-tool":
      // q1 cubierta.
      return { q1: covered };
    // Otro: sin guion.
    default:
      // null.
      return null;
  }
}

/** El caso de la foto del pedido y la nota de voz. No se aplica a un archivo arbitrario. */
export function classroomFixtureScenario(question: string): ResearchScenarioId | null {
  // Pregunta con el pedido de la foto y la queja de la nota de voz.
  if (/TPS-20481/.test(question) && /no suena/i.test(question)) {
    // Escenario principal.
    return "sufficient-first-round";
  }
  // Otro texto: sin escenario.
  return null;
}

// Plan guionizado según escenario y pregunta.
function planFor(scenario: ResearchScenarioId | null, question: string): unknown {
  // Sin escenario.
  if (scenario === null) {
    // ¿Es el caso de la foto y la nota de voz?
    const classroom = classroomFixtureScenario(question);
    // Usa su escenario.
    if (classroom !== null) return planFor(classroom, question);
  }
  // Fallo del proveedor: la política y dos subpreguntas externas, una por cada fallo.
  if (scenario === "provider-failure") {
    // Tres subpreguntas.
    return {
      route: "investigate",
      rationale: "Política de la tienda y dos preguntas sobre la normativa europea.",
      subquestions: [
        { id: "q1", text: MAIN_Q1, kind: "store", external: false },
        { id: "q2", text: FAIL_Q2, kind: "external", external: true, query: FAIL_Q2_QUERY },
        { id: "q3", text: FAIL_Q3, kind: "external", external: true, query: FAIL_Q3_QUERY },
      ],
      tool: null,
    };
  }
  // Escenario principal.
  if (scenario !== null && MAIN_SCENARIOS.includes(scenario)) {
    // Tres subpreguntas.
    return {
      // Ruta de investigación: política de la tienda, pedido y normativa externa.
      route: "investigate",
      rationale: "Política de la tienda, datos del pedido y normativa europea de consumo.",
      // q1 se responde con las políticas, q2 con la herramienta y q3 busca en la web.
      subquestions: [
        { id: "q1", text: MAIN_Q1, kind: "store", external: false },
        { id: "q2", text: MAIN_Q2, kind: "order", external: false },
        { id: "q3", text: MAIN_Q3, kind: "external", external: true, query: MAIN_Q3_QUERY },
      ],
      // La herramienta lee el pedido de la pregunta.
      tool: { orderId: MAIN_ORDER },
    };
  }
  // Dato interno que falta.
  if (scenario === "internal-fact-missing") {
    // Dos subpreguntas.
    return {
      route: "investigate",
      rationale: "Un dato interno de la tienda y una pregunta sobre la normativa.",
      subquestions: [
        { id: "q1", text: FACT_Q1, kind: "store", external: false },
        { id: "q2", text: FACT_Q2, kind: "external", external: true, query: FACT_Q2_QUERY },
      ],
      tool: null,
    };
  }
  // ¿Menciona un pedido?
  const order = /\bTPS-\d{5}\b/i.exec(question);
  // Escenario de herramienta o pregunta libre sobre un pedido.
  if (scenario === "order-tool" || order !== null) {
    // Número del pedido.
    const orderId =
      scenario === "order-tool" ? MAIN_ORDER : (order?.[0] ?? MAIN_ORDER).toUpperCase();
    // Ruta tool.
    return {
      // Ruta «tool»: basta la herramienta de solo lectura get_order.
      route: "tool",
      rationale: "Dato de un pedido concreto: basta la herramienta de solo lectura.",
      // Una sola subpregunta del tipo «order», sin búsqueda externa.
      subquestions: [
        {
          id: "q1",
          text: `Estado, pago y fecha de entrega del pedido ${orderId}.`,
          kind: "order",
          external: false,
        },
      ],
      // Argumentos de la herramienta: el pedido de la pregunta.
      tool: { orderId },
    };
  }
  // Pregunta libre: solo las políticas.
  return {
    route: "store",
    rationale:
      "Pregunta libre: se responde con las políticas de la tienda, sin búsquedas externas.",
    subquestions: [{ id: "q1", text: question.slice(0, 300), kind: "store", external: false }],
    tool: null,
  };
}

// Evaluación guionizada.
function assessFor(
  scenario: ResearchScenarioId | null,
  round: number,
  evidence: readonly ShownEvidence[],
  scores: ReadonlyMap<string, number | null>,
  subquestions: readonly { id: string }[],
): unknown {
  // Reglas.
  const table = rulesFor(scenario, round);
  // Sin guion: se usa el umbral lexical.
  const free = coverageFor(scenario, round) === null;
  // Decisión por fuente.
  const items = evidence.map((shown) => {
    // Regla de la fuente.
    const rule = table[shown.sourceId] ?? table[storeKey(shown.sourceId)];
    // Herramienta fuera del plan principal (su pedido es la única subpregunta): se acepta para q1
    // con sus líneas de pago, entrega y estado.
    if (shown.kind === "tool" && (scenario === null || !MAIN_SCENARIOS.includes(scenario))) {
      // Aceptada.
      return {
        sourceId: shown.sourceId,
        decision: "accept",
        subquestionIds: ["q1"],
        excerpts: ["Pago:", "Entrega:", "Estado:"].map((key) => pickExcerpt(shown.text, key)),
        reason: "Datos del pedido devueltos por la herramienta.",
      };
    }
    // Sin guion.
    if (free) {
      // Puntuación.
      const score = scores.get(shown.sourceId) ?? null;
      // Acepta si supera el umbral.
      return score !== null && score >= FIXTURE_MIN_SCORE
        ? // Aceptada: apoya q1 con un extracto literal de 200 caracteres.
          {
            sourceId: shown.sourceId,
            decision: "accept",
            subquestionIds: ["q1"],
            excerpts: [flatten(shown.text).slice(0, 200).trim()],
            reason: "Supera el umbral lexical de prueba. No es un evaluador.",
          }
        : // Rechazada: sin subpreguntas ni extractos.
          {
            sourceId: shown.sourceId,
            decision: "reject",
            subquestionIds: [],
            excerpts: [],
            reason: "No supera el umbral lexical de prueba.",
          };
    }
    // Sin regla o con rechazo.
    if (rule === undefined || "reject" in rule) {
      // Rechazada.
      return {
        sourceId: shown.sourceId,
        decision: "reject",
        subquestionIds: [],
        excerpts: [],
        reason: rule === undefined ? "Guion: no aporta a ninguna subpregunta." : rule.reject,
      };
    }
    // Aceptada con sus extractos.
    return {
      sourceId: shown.sourceId,
      decision: "accept",
      subquestionIds: rule.subs,
      excerpts: rule.keywords.map((keyword) => pickExcerpt(shown.text, keyword)),
      reason: rule.reason,
    };
  });
  // Cobertura guionizada.
  const scripted = coverageFor(scenario, round);
  // ¿Se aceptó algo?
  const anyAccepted = items.some((item) => item.decision === "accept");
  // Cobertura por subpregunta.
  const coverage = subquestions.map((sub) => {
    // Guion o según lo aceptado.
    const cover = scripted?.[sub.id] ?? {
      status: anyAccepted ? "covered" : "uncovered",
      gap: anyAccepted ? null : "Ningún fragmento supera el umbral lexical de prueba.",
      followUp: false,
    };
    // Entrada de cobertura.
    return { subquestionId: sub.id, ...cover };
  });
  // Evaluación.
  return { items, coverage, contradictions: [] };
}

// Evidencia con un id concreto.
function claimFrom(
  evidence: readonly (ShownEvidence & { subquestionIds: string[]; excerpts: string[] })[],
  sourceId: string,
) {
  // Primera coincidencia.
  return evidence.find((item) => item.sourceId === sourceId);
}

// Informe guionizado.
function synthesizeFor(
  scenario: ResearchScenarioId | null,
  evidence: readonly (ShownEvidence & { subquestionIds: string[]; excerpts: string[] })[],
  subquestions: readonly { id: string }[],
): unknown {
  // Hallazgos por subpregunta.
  const findings = subquestions.flatMap((sub) => {
    // Hasta 2 fuentes (1 si hay cita inventada).
    const support = evidence
      .filter((item) => item.subquestionIds.includes(sub.id))
      .slice(0, scenario === "invalid-citation" ? 1 : 2);
    // Extracto con su fuente.
    return support.map((item) => ({
      subquestionId: sub.id,
      text: item.excerpts[0] ?? item.text.slice(0, 200),
      sourceIds: [item.sourceId],
    }));
  });
  // Exclusión por higiene de la tienda.
  const hygiene = evidence.find(
    (item) => storeKey(item.sourceId) === "03-electronica-y-garantia:01",
  );
  // Página de garantías.
  const guarantees = claimFrom(evidence, webId(P.guarantees));
  // Datos del pedido.
  const order = claimFrom(evidence, ORDER_SOURCE);
  // Comprobaciones con esas fuentes.
  const checks = [order, guarantees].flatMap((item) =>
    item?.excerpts[0] === undefined ? [] : [{ text: item.excerpts[0], sourceIds: [item.sourceId] }],
  );
  // Primera evidencia.
  const first = evidence[0];
  // Respuesta directa: la política de la tienda sobre los intraauditivos.
  const answer =
    hygiene?.excerpts[0] !== undefined
      ? { text: hygiene.excerpts[0], sourceIds: [hygiene.sourceId] }
      : {
          text: first?.excerpts[0] ?? "Sin evidencia.",
          sourceIds: first === undefined ? [] : [first.sourceId],
        };
  // Cita inventada.
  if (scenario === "invalid-citation") {
    // Añade afirmaciones falsas que la verificación debe retirar.
    findings.push(
      // Afirmación que el extracto citado no sostiene.
      {
        subquestionId: "q1",
        text: "Basta con reiniciar el teléfono para arreglarlo.",
        sourceIds: hygiene ? [hygiene.sourceId] : [],
      },
      // Afirmación que cita una fuente que no existe.
      {
        subquestionId: "q3",
        text: "Según una página que no se ha leído, la garantía dura diez años.",
        sourceIds: ["web-000000000000"],
      },
      // Afirmación de la tienda apoyada en una fuente web: autoridad incorrecta.
      {
        subquestionId: "q1",
        text: "En España la garantía legal de los bienes nuevos es de tres años.",
        sourceIds: guarantees ? [guarantees.sourceId] : [],
      },
    );
  }
  // Informe.
  return { answer, findings: findings.slice(0, 6), checks, unresolved: [] };
}

// Seguimiento guionizado.
function followUpFor(
  scenario: ResearchScenarioId | null,
  gaps: readonly { subquestionId: string; text: string }[],
): unknown {
  // Seguimiento parcial: una consulta sobre la garantía.
  if (scenario === "partial-follow-up") {
    // Una consulta.
    return { queries: [{ subquestionId: "q3", query: FOLLOW_Q3_QUERY }] };
  }
  // Sin progreso.
  if (scenario === "no-progress-stop") {
    // Consultas repetidas o que no avanzan.
    return {
      queries: [
        { subquestionId: "q1", query: `  ${MAIN_Q1.toUpperCase()}   ` },
        { subquestionId: "q3", query: STALL_Q3_QUERY },
      ],
    };
  }
  // Otro: una consulta por laguna.
  return {
    queries: gaps.map((gap) => ({
      subquestionId: gap.subquestionId,
      query: `${gap.text} normativa oficial`.slice(0, 300),
    })),
  };
}

// Búsqueda guionizada.
function searchFor(scenario: ResearchScenarioId | null, query: string): PortResult<SearchHit[]> {
  // Consulta normalizada.
  const q = normalizeQuery(query);
  // ¿Coincide con una consulta?
  const is = (value: string) => q === normalizeQuery(value);
  // Según el escenario.
  switch (scenario) {
    // Primera ronda suficiente.
    case "sufficient-first-round":
    // Cita inventada.
    case "invalid-citation":
      // q3.
      if (is(MAIN_Q3_QUERY)) return hits(P.withdrawal, P.guarantees, P.boeLaw);
      // Fin.
      break;
    // Seguimiento parcial.
    case "partial-follow-up":
      // q3 incompleta.
      if (is(MAIN_Q3_QUERY)) return hits(P.withdrawal);
      // Seguimiento.
      if (is(FOLLOW_Q3_QUERY)) return hits(P.guarantees, P.withdrawal);
      // Fin.
      break;
    // Irrelevantes.
    case "irrelevant-discarded":
      // Con una página ajena, un blog fuera de la lista y una página con instrucciones.
      if (is(MAIN_Q3_QUERY)) return hits(P.withdrawal, P.blog, P.airPassengers, P.injected);
      // Fin.
      break;
    // Fallo del proveedor.
    case "provider-failure":
      // q2: el buscador falla.
      if (is(FAIL_Q2_QUERY)) {
        // HTTP 503.
        return {
          ok: false,
          error: "provider",
          detail: "El buscador de prueba devolvió HTTP 503.",
          consumption: { kind: "none" },
        };
      }
      // q3: la página de garantías no se podrá leer.
      if (is(FAIL_Q3_QUERY)) return hits(P.guarantees);
      // Fin.
      break;
    // Sin progreso.
    case "no-progress-stop":
      // q3.
      if (is(MAIN_Q3_QUERY)) return hits(P.withdrawal);
      // Consulta que no avanza.
      if (is(STALL_Q3_QUERY)) return hits(P.withdrawal, P.blog);
      // Fin.
      break;
    // Dato interno.
    case "internal-fact-missing":
      // Gastos de devolución.
      if (is(FACT_Q2_QUERY)) return hits(P.withdrawal);
      // Fin.
      break;
    // Otro.
    default:
      // Fin.
      break;
  }
  // Sin resultados.
  return ok([]);
}

// Fragmentos de las políticas guionizados por consulta.
function storeIdsFor(scenario: ResearchScenarioId | null, query: string): string[] | null {
  // Escenario principal.
  if (scenario !== null && MAIN_SCENARIOS.includes(scenario)) {
    // q1: la política de devoluciones de los intraauditivos.
    if (query === MAIN_Q1)
      return scenario === "irrelevant-discarded"
        ? [
            "10-productos-prohibidos-y-restringidos:00",
            "03-electronica-y-garantia:01",
            "03-electronica-y-garantia:03",
            "06-pagos-y-reembolsos:02",
          ]
        : [
            "03-electronica-y-garantia:01",
            "03-electronica-y-garantia:03",
            "06-pagos-y-reembolsos:02",
            "02-devoluciones:00",
          ];
    // Otra.
    return [];
  }
  // Dato interno.
  if (scenario === "internal-fact-missing") {
    // q1.
    if (query === FACT_Q1) return ["12-promociones-y-cupones:00", "09-thepower-shop-plus:00"];
    // Otra.
    return [];
  }
  // Sin guion: búsqueda lexical.
  return null;
}

// Opciones de los puertos de prueba.
export interface FixtureResearchOptions {
  // Señal.
  signal: AbortSignal;
  // Escenario.
  scenarioId: ResearchScenarioId | null;
  // Versión del corpus de la tienda.
  corpusVersion: string;
  // Reloj.
  now?: () => number;
}

/**
 * Puertos de prueba. Demuestran el flujo de control del grafo: no miden la
 * calidad de un modelo ni hacen una investigación real en internet.
 */
function waitFor(signal: AbortSignal, ms: number): Promise<void> {
  // Espera unos milisegundos o hasta cancelar.
  return new Promise((resolve) => {
    // Temporizador.
    const timer = setTimeout(resolve, ms);
    // Termina.
    const finish = () => {
      // Cancela el temporizador.
      clearTimeout(timer);
      // Resuelve.
      resolve();
    };
    // Ya cancelada.
    if (signal.aborted) {
      // Termina.
      finish();
      // Sale.
      return;
    }
    // Escucha la cancelación.
    signal.addEventListener("abort", finish, { once: true });
  });
}

// Permite fijar el escenario cuando se conoce la pregunta final.
export interface FixtureScenarioLatch {
  // Recibe la pregunta.
  noteFixtureQuestion(question: string): void;
}

// Crea los puertos de prueba.
export function createFixtureResearchPorts(
  options: FixtureResearchOptions,
): ResearchPorts & FixtureScenarioLatch {
  // Escenario pedido.
  const requested = options.scenarioId;
  // Escenarios de control usan el guion principal.
  let scenario: ResearchScenarioId | null =
    requested === "slow-search" ||
    requested === "ambiguous-operation" ||
    requested === "crash-after-plan"
      ? "sufficient-first-round"
      : requested;
  // Si no hay escenario, lo deduce del caso de la foto y la nota de voz.
  const noteFixtureQuestion = (question: string) => {
    // Ya hay uno.
    if (scenario !== null)
      // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
      return;
    // ¿Es el caso de la demo?
    const classroom = classroomFixtureScenario(question);
    // Lo fija.
    if (classroom !== null) scenario = classroom;
  };
  // Fragmentos de las políticas.
  const library = storeFixtureChunks();
  // Puntuaciones vistas.
  const scores = new Map<string, number | null>();
  // Convierte un fragmento en evidencia de las políticas.
  const toStore = (chunkId: string, score: number | null): StoreEvidence | null => {
    // Fragmento.
    const chunk = library.find((item) => item.chunkId === chunkId);
    // Evidencia o null.
    return chunk === undefined
      ? null
      : // Evidencia de la tienda con los mismos campos que la del puerto real.
        {
          kind: "store",
          sourceId: chunk.chunkId,
          documentId: chunk.documentId,
          title: chunk.title,
          section: chunk.section,
          text: withoutHeadings(chunk.text),
          corpusVersion: chunk.corpusVersion,
          score,
        };
  };
  // Modelo guionizado.
  const model: ResearchModelPort = {
    // Construye el plan de investigación que consumen los nodos posteriores.
    plan: ({ question }) => {
      // Deduce el escenario.
      noteFixtureQuestion(question);
      // Plan.
      return Promise.resolve(ok(planFor(scenario, question)));
    },
    // Valora la suficiencia de la evidencia y las carencias que quedan por cubrir.
    assess: ({ evidence, round, subquestions }) =>
      Promise.resolve(ok(assessFor(scenario, round, evidence, scores, subquestions))),
    // Propone consultas adicionales a partir de las carencias del intento anterior.
    followUp: ({ gaps }) => Promise.resolve(ok(followUpFor(scenario, gaps))),
    // Compone el informe a partir de la evidencia reunida y las subpreguntas del plan.
    synthesize: ({ evidence, subquestions }) =>
      Promise.resolve(ok(synthesizeFor(scenario, evidence, subquestions))),
  };
  // Puertos completos.
  return {
    noteFixtureQuestion,
    measured: false,
    fixture: true,
    now: options.now ?? Date.now,
    signal: options.signal,
    allowedDomains: [...DEFAULT_RESEARCH_DOMAINS],
    estimatedMaxUsd: null,
    model,
    store: {
      // Recupera fragmentos de las políticas para la consulta del recorrido.
      retrieve({ query, corpusVersion, limit }) {
        // Fragmentos guionizados.
        const scripted = storeIdsFor(scenario, query);
        // Con guion.
        if (scripted !== null) {
          // Evidencia con puntuación 0,9.
          const rows = scripted
            .map((key) => toStore(`${corpusVersion}:${key}`, 0.9))
            .filter((item): item is StoreEvidence => item !== null);
          // Hasta el límite.
          return Promise.resolve(ok(rows.slice(0, limit)));
        }
        // Sin guion: embedding de prueba.
        const vector = fixtureEmbed(query);
        // Fragmentos por similitud.
        const rows = library
          .filter((chunk) => chunk.corpusVersion === corpusVersion)
          .map((chunk) => ({ chunk, score: cosine(vector, chunk.vector) }))
          .sort((left, right) => right.score - left.score)
          .slice(0, limit)
          .map(({ chunk, score }) => {
            // Guarda la puntuación.
            scores.set(chunk.chunkId, score);
            // Evidencia.
            return toStore(chunk.chunkId, score);
          })
          .filter((item): item is StoreEvidence => item !== null);
        // Resultados.
        return Promise.resolve(ok(rows));
      },
    },
    // Herramienta de pedidos sobre los datos ficticios, con la cuenta de la demo.
    tool: createOrderTool({ data: ORDER_DATA, customerId: ORDER_DATA.customerId }),
    search: {
      // Busca candidatos para la consulta con los límites y el transporte de este adaptador.
      async search({ query }) {
        // Búsqueda lenta.
        if (requested === "slow-search") {
          // Espera 12 s o cancelación.
          await waitFor(options.signal, 12_000);
          // Cancelada.
          if (options.signal.aborted) {
            // Error aborted.
            return {
              ok: false,
              error: "aborted",
              detail: "La búsqueda de prueba se detuvo.",
              consumption: { kind: "none" },
            };
          }
        }
        // Resultados guionizados.
        return searchFor(scenario, query);
      },
    },
    reader: {
      // Lee el recurso solicitado y devuelve el resultado de este adaptador al consumidor.
      async read({ url }) {
        // Página simulada.
        const page = fixturePageByUrl(url);
        // No existe.
        if (page === null) {
          // Error.
          return {
            ok: false,
            error: "provider",
            detail: "La página no existe en el guion.",
            consumption: { kind: "none" },
          };
        }
        // Fallo del proveedor al leer la página de garantías.
        if (scenario === "provider-failure" && page.key === "guarantees") {
          // timeout.
          return {
            ok: false,
            error: "timeout",
            detail: "La lectura de prueba superó su plazo.",
            consumption: { kind: "none" },
          };
        }
        // Página leída con hash.
        return ok({
          // Página leída: URL pedida y final, título, texto y fechas fijas de la demo.
          requestedUrl: url,
          finalUrl: page.finalUrl ?? page.url,
          title: page.title,
          text: page.text,
          retrievedAt: FIXTURE_RETRIEVED_AT,
          publishedAt: null,
          // Hash SHA-256 del texto, igual que con un lector real.
          contentHash: `sha256:${await sha256Hex(page.text)}`,
        });
      },
    },
  };
}
