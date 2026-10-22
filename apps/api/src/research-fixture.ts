// GUÍA DE LECTURA · apps/api/src/research-fixture.ts
// Puertos de prueba de la investigación: un guion por escenario decide plan, búsquedas, páginas leídas,
// evaluación e informe. Sirven para ver el flujo del grafo sin red ni modelos; no miden calidad.
// Dominios por defecto, escenarios de demo y tipos.
import {
  DEFAULT_RESEARCH_DOMAINS,
  DEMO_RESEARCH_SCENARIOS,
  type Audience,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
// Núcleo RAG: audiencias, coseno, umbral y embedding de prueba.
import {
  allowsAudience,
  cosine,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  normalizeQuery,
} from "@thepower-rag/core";
// Utilidades y tipos del paquete de investigación.
import {
  flatten,
  webSourceId,
  type CourseEvidence,
  type PortResult,
  type ResearchModelPort,
  type ResearchPorts,
  type SearchHit,
  type ShownEvidence,
} from "@thepower-rag/research";
// Fragmentos de ejemplo del corpus.
import { fixtureChunks } from "./fixture";
// Páginas web simuladas.
import { FIXTURE_PAGES, fixturePageByUrl, type FixturePage } from "./research-fixture-data";
// Herramienta de sesiones del curso.
import { createCourseSessionTool } from "./research-tool";
// Hash SHA-256.
import { sha256Hex } from "./snapshot-hash";

/** Hora fija de las lecturas de prueba: la demo es determinista. */
export const FIXTURE_RETRIEVED_AT = "2026-10-10T00:00:00.000Z";

// Subpregunta 1 del escenario principal.
export const MAIN_Q1 =
  "¿Qué significa «Dimension mismatch: expected 1024, got 768» en un índice vectorial?";
// Subpregunta 2.
export const MAIN_Q2 =
  "¿Cómo se comprueban las dimensiones del índice y las del modelo de embeddings?";
// Subpregunta 3 (curso).
export const MAIN_Q3 = "¿Qué se vio en el curso sobre embeddings y sus dimensiones?";
// Consulta web de la subpregunta 1.
export const MAIN_Q1_QUERY = "vector index dimension mismatch expected 1024 got 768 embeddings";
// Consulta web de la subpregunta 2.
export const MAIN_Q2_QUERY = "check vectorize index dimensions wrangler embedding vector length";
// Consulta de seguimiento.
export const FOLLOW_Q2_QUERY = "wrangler vectorize get index dimensions";
// Consulta que no avanza.
export const STALL_Q2_QUERY = "vectorize index dimensions command";
// Dato interno que no consta.
const FACT_Q1 = "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12?";
// Pregunta técnica del mismo escenario.
const FACT_Q2 = "¿Para qué sirve un checkpointer en LangGraph?";
// Su consulta web.
const FACT_Q2_QUERY = "LangGraph checkpointer persistence thread_id";

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
  // Palabra clave del extracto.
  keyword: string;
  // Motivo.
  reason: string;
}

// Tabla de reglas: aceptar con regla o rechazar con motivo.
type RuleTable = Record<string, Rule | { reject: string }>;

// Id del fragmento sin la versión.
function courseKey(sourceId: string): string {
  // Quita el prefijo de versión.
  return sourceId.replace(/^[^:]+:/, "");
}

// Reglas del escenario y la ronda.
function rulesFor(scenario: ResearchScenarioId | null, round: number): RuleTable {
  // Reglas del escenario principal.
  const main: RuleTable = {
    // Cada regla: subpreguntas que apoya, palabra clave que debe aparecer en el extracto y motivo.
    [webId(P.vectorizeCreate)]: {
      subs: ["q1"],
      keyword: "no se puede cambiar",
      reason: "Explica que la dimensión del índice es fija.",
    },
    [webId(P.langchainEmbeddings)]: {
      subs: ["q1"],
      keyword: "no son comparables",
      reason: "Explica por qué hay que reindexar.",
    },
    [webId(P.vectorizeGet)]: {
      subs: ["q2"],
      keyword: "wrangler vectorize get",
      reason: "Da el comando que lee la dimensión del índice.",
    },
    [webId(P.bgeM3)]: {
      subs: ["q2"],
      keyword: "longitud del vector",
      reason: "Indica cómo medir la dimensión del modelo.",
    },
    // Fragmento del corpus del curso (S10) que aporta el dato interno.
    "s10-rag:01": {
      subs: ["q3"],
      keyword: "768 dimensiones",
      reason: "El ejercicio de S10 citaba embeddings de 768 dimensiones.",
    },
    // Reglas de rechazo: el evaluador de prueba las descarta con su motivo.
    "s10-rag:00": { reject: "Habla de embeddings en general, no de su dimensión." },
    [webId(P.d1Overview)]: { reject: "Trata D1, no índices vectoriales." },
    [webId(P.injected)]: { reject: "Contiene instrucciones embebidas y no aporta a la pregunta." },
    "s16-cloud-aws:00": { reject: "Despliegue en AWS; no trata embeddings." },
  };
  // Dato interno que falta.
  if (scenario === "internal-fact-missing") {
    // Reglas propias.
    return {
      // Se rechaza: el curso no documenta una nota mínima (es el dato que falta a propósito).
      "s12-deep-research:01": {
        reject: "Describe el ejercicio de S12, pero no menciona una nota mínima.",
      },
      "s19-evaluacion:00": { reject: "Trata la evaluación de sistemas de IA, no calificaciones." },
      // S5 y la página web sí apoyan la parte técnica.
      "s05-langgraph:00": {
        subs: ["q2"],
        keyword: "checkpointer",
        reason: "S5 menciona la memoria guardada por un checkpointer.",
      },
      [webId(P.checkpointer)]: {
        subs: ["q1", "q2"],
        keyword: "guarda el estado",
        reason: "Describe qué guarda un checkpointer.",
      },
    };
  }
  // Seguimiento parcial en la ronda 1.
  if (scenario === "partial-follow-up" && round === 1) {
    // bgeM3 solo cubre en parte.
    return {
      ...main,
      [webId(P.bgeM3)]: {
        subs: ["q2"],
        keyword: "longitud del vector",
        reason: "Mide el modelo, pero no lee el índice.",
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
      // q2 parcial en la ronda 1.
      return round === 1
        ? {
            ...all,
            q2: {
              status: "partial",
              gap: "Falta el comando que lee las dimensiones configuradas del índice existente.",
              followUp: true,
            },
          }
        : all;
    // Fallo del proveedor.
    case "provider-failure":
      // q1 sin cubrir.
      return {
        ...all,
        q1: {
          status: "uncovered",
          gap: "No hay páginas leídas para esta subpregunta.",
          followUp: true,
        },
      };
    // Sin progreso.
    case "no-progress-stop":
      // Dos parciales.
      return {
        // q1 y q2 siguen parciales y piden seguimiento; como la ronda no aporta nada nuevo, el
        // grafo para.
        q1: {
          status: "partial",
          gap: "Falta confirmar si basta con cambiar el modelo de consulta.",
          followUp: true,
        },
        q2: {
          status: "partial",
          gap: "Falta el comando que lee las dimensiones del índice existente.",
          followUp: true,
        },
        // q3 ya está cubierta.
        q3: covered,
      };
    // Dato interno que falta.
    case "internal-fact-missing":
      // q1 sin cubrir.
      return {
        q1: {
          status: "uncovered",
          gap: "El material del curso no documenta una nota mínima para el ejercicio.",
          followUp: false,
        },
        q2: covered,
      };
    // Herramienta del curso.
    case "course-tool":
      // q1 cubierta.
      return { q1: covered };
    // Otro: sin guion.
    default:
      // null.
      return null;
  }
}

/** El aula de la captura y el audio. No se aplica a un archivo arbitrario. */
export function classroomFixtureScenario(question: string): ResearchScenarioId | null {
  // Pregunta con el error de la imagen y la transcripción del audio.
  if (
    /expected 1024,\s*got 768/i.test(question) &&
    /he cambiado el modelo de embeddings/i.test(question)
  ) {
    // Escenario principal.
    return "sufficient-first-round";
  }
  // Otro texto: sin escenario.
  return null;
}

// Plan guionizado según escenario y pregunta.
function planFor(
  scenario: ResearchScenarioId | null,
  question: string,
  audience: Audience,
): unknown {
  // Sin escenario.
  if (scenario === null) {
    // ¿Es la pregunta del aula?
    const classroom = classroomFixtureScenario(question);
    // Usa su escenario.
    if (classroom !== null) return planFor(classroom, question, audience);
  }
  // Escenario principal.
  if (scenario !== null && MAIN_SCENARIOS.includes(scenario)) {
    // Tres subpreguntas.
    return {
      // Ruta de investigación con dos subpreguntas técnicas externas y una del curso.
      route: "investigate",
      rationale:
        "Pregunta técnica con relación al curso: dos subpreguntas externas y una del curso.",
      // q1 y q2 buscan en la web con su consulta; q3 se responde con el corpus.
      subquestions: [
        { id: "q1", text: MAIN_Q1, kind: "technical", external: true, query: MAIN_Q1_QUERY },
        { id: "q2", text: MAIN_Q2, kind: "technical", external: true, query: MAIN_Q2_QUERY },
        { id: "q3", text: MAIN_Q3, kind: "course", external: false },
      ],
      // Sin herramienta de sesión.
      tool: null,
    };
  }
  // Dato interno que falta.
  if (scenario === "internal-fact-missing") {
    // Dos subpreguntas.
    return {
      route: "investigate",
      rationale: "Un dato interno del curso y una explicación técnica separada.",
      subquestions: [
        { id: "q1", text: FACT_Q1, kind: "course", external: false },
        { id: "q2", text: FACT_Q2, kind: "technical", external: true, query: FACT_Q2_QUERY },
      ],
      tool: null,
    };
  }
  // ¿Menciona una sesión?
  const session = /\bs(?:esi[oó]n)?\s*(\d{1,2})\b/i.exec(question);
  // Escenario de herramienta o sesión con grupo.
  if (scenario === "course-tool" || (session !== null && audience !== "program")) {
    // Número de sesión.
    const number = scenario === "course-tool" ? 12 : Number(session?.[1] ?? 0);
    // Ruta tool.
    return {
      // Ruta «tool»: basta la herramienta de solo lectura get_course_session.
      route: "tool",
      rationale: "Dato interno de una sesión: basta la herramienta de solo lectura.",
      // Una sola subpregunta del tipo «session», sin búsqueda externa.
      subquestions: [
        {
          id: "q1",
          text: `Fecha, profesor y ejercicio de la sesión ${String(number)} del grupo seleccionado.`,
          kind: "session",
          external: false,
        },
      ],
      // Argumentos de la herramienta: sesión pedida y grupo del alumno.
      tool: { sessionId: `S${String(number)}`, audience },
    };
  }
  // Pregunta libre: solo curso.
  return {
    route: "course",
    rationale: "Pregunta libre: se responde con el material del curso, sin búsquedas externas.",
    subquestions: [{ id: "q1", text: question.slice(0, 300), kind: "technical", external: false }],
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
    const rule = table[shown.sourceId] ?? table[courseKey(shown.sourceId)];
    // Herramienta: se acepta.
    if (shown.kind === "tool") {
      // Aceptada.
      return {
        sourceId: shown.sourceId,
        decision: "accept",
        subquestionIds: ["q1"],
        excerpts: [pickExcerpt(shown.text, "Grupo")],
        reason: "Resultado de la herramienta con fuentes del curso.",
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
    // Aceptada con su extracto.
    return {
      sourceId: shown.sourceId,
      decision: "accept",
      subquestionIds: rule.subs,
      excerpts: [pickExcerpt(shown.text, rule.keyword)],
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
  // Fuente vectorizeCreate.
  const create = claimFrom(evidence, webId(P.vectorizeCreate));
  // Fuente vectorizeGet.
  const get = claimFrom(evidence, webId(P.vectorizeGet));
  // Fuente de LangChain.
  const lc = claimFrom(evidence, webId(P.langchainEmbeddings));
  // Comprobaciones con esas fuentes.
  const checks = [get, create, lc].flatMap((item) =>
    item?.excerpts[0] === undefined ? [] : [{ text: item.excerpts[0], sourceIds: [item.sourceId] }],
  );
  // Primera evidencia.
  const first = evidence[0];
  // Respuesta.
  const answer =
    create?.excerpts[0] !== undefined
      ? { text: create.excerpts[0], sourceIds: [create.sourceId] }
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
        text: "Basta con reiniciar el navegador para que desaparezca el aviso.",
        sourceIds: create ? [create.sourceId] : [],
      },
      // Afirmación que cita una fuente que no existe.
      {
        subquestionId: "q2",
        text: "Según una página que no se ha leído, el error se corrige solo.",
        sourceIds: ["web-000000000000"],
      },
      // Afirmación del curso apoyada en una fuente web: autoridad incorrecta.
      {
        subquestionId: "q3",
        text: "En el curso se vio que el índice no se puede cambiar después de crearlo.",
        sourceIds: create ? [create.sourceId] : [],
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
  // Seguimiento parcial.
  if (scenario === "partial-follow-up") {
    // Una consulta.
    return { queries: [{ subquestionId: "q2", query: FOLLOW_Q2_QUERY }] };
  }
  // Sin progreso.
  if (scenario === "no-progress-stop") {
    // Consultas repetidas o que no avanzan.
    return {
      queries: [
        { subquestionId: "q1", query: `  ${MAIN_Q1_QUERY.toUpperCase()}   ` },
        { subquestionId: "q2", query: STALL_Q2_QUERY },
      ],
    };
  }
  // Otro: una consulta por laguna.
  return {
    queries: gaps.map((gap) => ({
      subquestionId: gap.subquestionId,
      query: `${gap.text} documentación oficial`.slice(0, 300),
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
      // q1.
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate, P.langchainEmbeddings);
      // q2.
      if (is(MAIN_Q2_QUERY)) return hits(P.vectorizeGet, P.bgeM3);
      // Fin.
      break;
    // Seguimiento parcial.
    case "partial-follow-up":
      // q1.
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate);
      // q2 incompleto.
      if (is(MAIN_Q2_QUERY)) return hits(P.bgeM3);
      // Seguimiento.
      if (is(FOLLOW_Q2_QUERY)) return hits(P.vectorizeGet, P.bgeM3);
      // Fin.
      break;
    // Irrelevantes.
    case "irrelevant-discarded":
      // Con páginas ajenas.
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate, P.blog, P.d1Overview);
      // Con instrucciones embebidas.
      if (is(MAIN_Q2_QUERY)) return hits(P.vectorizeGet, P.injected);
      // Fin.
      break;
    // Fallo del proveedor.
    case "provider-failure":
      // q1 falla.
      if (is(MAIN_Q1_QUERY)) {
        // HTTP 503.
        return {
          ok: false,
          error: "provider",
          detail: "El buscador de prueba devolvió HTTP 503.",
          consumption: { kind: "none" },
        };
      }
      // q2.
      if (is(MAIN_Q2_QUERY)) return hits(P.vectorizeGet, P.bgeM3);
      // Fin.
      break;
    // Sin progreso.
    case "no-progress-stop":
      // q1.
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate);
      // q2.
      if (is(MAIN_Q2_QUERY)) return hits(P.bgeM3);
      // Consulta que no avanza.
      if (is(STALL_Q2_QUERY)) return hits(P.bgeM3, P.blog);
      // Fin.
      break;
    // Dato interno.
    case "internal-fact-missing":
      // checkpointer.
      if (is(FACT_Q2_QUERY)) return hits(P.checkpointer);
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

// Fragmentos del curso guionizados por consulta.
function courseIdsFor(scenario: ResearchScenarioId | null, query: string): string[] | null {
  // Escenario principal.
  if (scenario !== null && MAIN_SCENARIOS.includes(scenario)) {
    // q3.
    if (query === MAIN_Q3) return ["s10-rag:01", "s10-rag:00"];
    // q1.
    if (query === MAIN_Q1)
      return scenario === "irrelevant-discarded" ? ["s16-cloud-aws:00"] : ["s10-rag:00"];
    // Otra.
    return [];
  }
  // Dato interno.
  if (scenario === "internal-fact-missing") {
    // q1.
    if (query === FACT_Q1) return ["s12-deep-research:01", "s19-evaluacion:00"];
    // q2.
    if (query === FACT_Q2) return ["s05-langgraph:00"];
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
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
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
  // Si no hay escenario, lo deduce de la pregunta del aula.
  const noteFixtureQuestion = (question: string) => {
    // Ya hay uno.
    if (scenario !== null)
      // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
      return;
    // ¿Pregunta del aula?
    const classroom = classroomFixtureScenario(question);
    // Lo fija.
    if (classroom !== null) scenario = classroom;
  };
  // Fragmentos de ejemplo.
  const library = fixtureChunks();
  // Puntuaciones vistas.
  const scores = new Map<string, number | null>();
  // Convierte un fragmento en evidencia del curso.
  const toCourse = (chunkId: string, score: number | null): CourseEvidence | null => {
    // Fragmento.
    const chunk = library.find((item) => item.chunkId === chunkId);
    // Evidencia o null.
    return chunk === undefined
      ? null
      : // Evidencia del curso con los mismos campos que la del puerto real.
        {
          kind: "course",
          sourceId: chunk.chunkId,
          documentId: chunk.documentId,
          title: chunk.title,
          section: chunk.section,
          text: chunk.text,
          audience: chunk.audience,
          corpusVersion: chunk.corpusVersion,
          score,
        };
  };
  // Modelo guionizado.
  const model: ResearchModelPort = {
    // Construye el plan de investigación que consumen los nodos posteriores.
    plan: ({ question, audience }) => {
      // Deduce el escenario.
      noteFixtureQuestion(question);
      // Plan.
      return Promise.resolve(ok(planFor(scenario, question, audience)));
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
    course: {
      // Recupera candidatos documentales dentro del ámbito de corpus y consulta del recorrido.
      retrieve({ query, audience, corpusVersion, limit }) {
        // Fragmentos guionizados.
        const scripted = courseIdsFor(scenario, query);
        // Con guion.
        if (scripted !== null) {
          // Evidencia con puntuación 0,9.
          const rows = scripted
            .map((key) => toCourse(`${corpusVersion}:${key}`, 0.9))
            .filter((item): item is CourseEvidence => item !== null);
          // Hasta el límite.
          return Promise.resolve(ok(rows.slice(0, limit)));
        }
        // Sin guion: embedding de prueba.
        const vector = fixtureEmbed(query);
        // Fragmentos por similitud.
        const rows = library
          .filter(
            (chunk) =>
              chunk.corpusVersion === corpusVersion && allowsAudience(chunk.audience, audience),
          )
          .map((chunk) => ({ chunk, score: cosine(vector, chunk.vector) }))
          .sort((left, right) => right.score - left.score)
          .slice(0, limit)
          .map(({ chunk, score }) => {
            // Guarda la puntuación.
            scores.set(chunk.chunkId, score);
            // Evidencia.
            return toCourse(chunk.chunkId, score);
          })
          .filter((item): item is CourseEvidence => item !== null);
        // Resultados.
        return Promise.resolve(ok(rows));
      },
    },
    tool: createCourseSessionTool({
      corpusVersion: options.corpusVersion,
      audience: options.audience,
      // Lee el recurso solicitado y devuelve el resultado de este adaptador al consumidor.
      read: (corpusVersion, chunkId) => {
        // Fragmento de esa versión.
        const chunk = library.find(
          (item) => item.chunkId === chunkId && item.corpusVersion === corpusVersion,
        );
        // Copia o null.
        return Promise.resolve(chunk === undefined ? null : { ...chunk });
      },
    }),
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
        // Fallo del proveedor en bgeM3.
        if (scenario === "provider-failure" && page.key === "bgeM3") {
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
