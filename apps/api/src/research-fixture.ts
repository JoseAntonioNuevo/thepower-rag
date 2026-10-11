import {
  DEFAULT_RESEARCH_DOMAINS,
  DEMO_RESEARCH_SCENARIOS,
  type Audience,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
import {
  allowsAudience,
  cosine,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  normalizeQuery,
} from "@thepower-rag/core";
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
import { fixtureChunks } from "./fixture";
import { FIXTURE_PAGES, fixturePageByUrl, type FixturePage } from "./research-fixture-data";
import { createCourseSessionTool } from "./research-tool";
import { sha256Hex } from "./snapshot-hash";

/** Hora fija de las lecturas de prueba: la demo es determinista. */
export const FIXTURE_RETRIEVED_AT = "2026-10-10T00:00:00.000Z";

export const MAIN_Q1 =
  "¿Qué significa «Dimension mismatch: expected 1024, got 768» en un índice vectorial?";
export const MAIN_Q2 =
  "¿Cómo se comprueban las dimensiones del índice y las del modelo de embeddings?";
export const MAIN_Q3 = "¿Qué se vio en el curso sobre embeddings y sus dimensiones?";
export const MAIN_Q1_QUERY = "vector index dimension mismatch expected 1024 got 768 embeddings";
export const MAIN_Q2_QUERY = "check vectorize index dimensions wrangler embedding vector length";
export const FOLLOW_Q2_QUERY = "wrangler vectorize get index dimensions";
export const STALL_Q2_QUERY = "vectorize index dimensions command";
const FACT_Q1 = "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12?";
const FACT_Q2 = "¿Para qué sirve un checkpointer en LangGraph?";
const FACT_Q2_QUERY = "LangGraph checkpointer persistence thread_id";

const MAIN_SCENARIOS: readonly ResearchScenarioId[] = [
  "sufficient-first-round",
  "partial-follow-up",
  "irrelevant-discarded",
  "provider-failure",
  "no-progress-stop",
  "invalid-citation",
];

export function resolveResearchScenario(
  explicit: ResearchScenarioId | undefined,
  question: string,
): ResearchScenarioId | null {
  if (explicit !== undefined) {
    return explicit;
  }
  const trimmed = question.trim();
  const match = DEMO_RESEARCH_SCENARIOS.find((item) => item.question === trimmed);
  return match?.id ?? null;
}

const ok = <T>(value: T): PortResult<T> => ({ ok: true, value, consumption: { kind: "none" } });

function hits(...pages: FixturePage[]): PortResult<SearchHit[]> {
  return ok(pages.map((page) => ({ url: page.url, title: page.title, snippet: page.snippet })));
}

const P = FIXTURE_PAGES;
const webId = (page: FixturePage) => webSourceId(page.finalUrl ?? page.url);

/** Busca la frase que contiene la palabra clave: siempre es un extracto literal. */
export function pickExcerpt(text: string, keyword: string): string {
  const flat = flatten(text);
  const index = flat.indexOf(keyword);
  if (index === -1) {
    return flat.slice(0, 200).trim();
  }
  const start = Math.max(0, flat.lastIndexOf(". ", index) + 2);
  const end = flat.indexOf(".", index + keyword.length);
  return flat
    .slice(start === 1 ? 0 : start, end === -1 ? undefined : end + 1)
    .slice(0, 300)
    .trim();
}

interface Rule {
  subs: string[];
  keyword: string;
  reason: string;
}

type RuleTable = Record<string, Rule | { reject: string }>;

function courseKey(sourceId: string): string {
  return sourceId.replace(/^[^:]+:/, "");
}

function rulesFor(scenario: ResearchScenarioId | null, round: number): RuleTable {
  const main: RuleTable = {
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
    "s10-rag:01": {
      subs: ["q3"],
      keyword: "768 dimensiones",
      reason: "El ejercicio de S10 citaba embeddings de 768 dimensiones.",
    },
    "s10-rag:00": { reject: "Habla de embeddings en general, no de su dimensión." },
    [webId(P.d1Overview)]: { reject: "Trata D1, no índices vectoriales." },
    [webId(P.injected)]: { reject: "Contiene instrucciones embebidas y no aporta a la pregunta." },
    "s16-cloud-aws:00": { reject: "Despliegue en AWS; no trata embeddings." },
  };
  if (scenario === "internal-fact-missing") {
    return {
      "s12-deep-research:01": {
        reject: "Describe el ejercicio de S12, pero no menciona una nota mínima.",
      },
      "s19-evaluacion:00": { reject: "Trata la evaluación de sistemas de IA, no calificaciones." },
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
  if (scenario === "partial-follow-up" && round === 1) {
    return {
      ...main,
      [webId(P.bgeM3)]: {
        subs: ["q2"],
        keyword: "longitud del vector",
        reason: "Mide el modelo, pero no lee el índice.",
      },
    };
  }
  return main;
}

type Cover = { status: "covered" | "partial" | "uncovered"; gap: string | null; followUp: boolean };

function coverageFor(
  scenario: ResearchScenarioId | null,
  round: number,
): Record<string, Cover> | null {
  const covered: Cover = { status: "covered", gap: null, followUp: false };
  const all = { q1: covered, q2: covered, q3: covered };
  switch (scenario) {
    case "sufficient-first-round":
    case "irrelevant-discarded":
    case "invalid-citation":
      return all;
    case "partial-follow-up":
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
    case "provider-failure":
      return {
        ...all,
        q1: {
          status: "uncovered",
          gap: "No hay páginas leídas para esta subpregunta.",
          followUp: true,
        },
      };
    case "no-progress-stop":
      return {
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
        q3: covered,
      };
    case "internal-fact-missing":
      return {
        q1: {
          status: "uncovered",
          gap: "El material del curso no documenta una nota mínima para el ejercicio.",
          followUp: false,
        },
        q2: covered,
      };
    case "course-tool":
      return { q1: covered };
    default:
      return null;
  }
}

/** El aula de la captura y el audio. No se aplica a un archivo arbitrario. */
export function classroomFixtureScenario(question: string): ResearchScenarioId | null {
  if (
    /expected 1024,\s*got 768/i.test(question) &&
    /he cambiado el modelo de embeddings/i.test(question)
  ) {
    return "sufficient-first-round";
  }
  return null;
}

function planFor(
  scenario: ResearchScenarioId | null,
  question: string,
  audience: Audience,
): unknown {
  if (scenario === null) {
    const classroom = classroomFixtureScenario(question);
    if (classroom !== null) return planFor(classroom, question, audience);
  }
  if (scenario !== null && MAIN_SCENARIOS.includes(scenario)) {
    return {
      route: "investigate",
      rationale:
        "Pregunta técnica con relación al curso: dos subpreguntas externas y una del curso.",
      subquestions: [
        { id: "q1", text: MAIN_Q1, kind: "technical", external: true, query: MAIN_Q1_QUERY },
        { id: "q2", text: MAIN_Q2, kind: "technical", external: true, query: MAIN_Q2_QUERY },
        { id: "q3", text: MAIN_Q3, kind: "course", external: false },
      ],
      tool: null,
    };
  }
  if (scenario === "internal-fact-missing") {
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
  const session = /\bs(?:esi[oó]n)?\s*(\d{1,2})\b/i.exec(question);
  if (scenario === "course-tool" || (session !== null && audience !== "program")) {
    const number = scenario === "course-tool" ? 12 : Number(session?.[1] ?? 0);
    return {
      route: "tool",
      rationale: "Dato interno de una sesión: basta la herramienta de solo lectura.",
      subquestions: [
        {
          id: "q1",
          text: `Fecha, profesor y ejercicio de la sesión ${String(number)} del grupo seleccionado.`,
          kind: "session",
          external: false,
        },
      ],
      tool: { sessionId: `S${String(number)}`, audience },
    };
  }
  return {
    route: "course",
    rationale: "Pregunta libre: se responde con el material del curso, sin búsquedas externas.",
    subquestions: [{ id: "q1", text: question.slice(0, 300), kind: "technical", external: false }],
    tool: null,
  };
}

function assessFor(
  scenario: ResearchScenarioId | null,
  round: number,
  evidence: readonly ShownEvidence[],
  scores: ReadonlyMap<string, number | null>,
  subquestions: readonly { id: string }[],
): unknown {
  const table = rulesFor(scenario, round);
  const free = coverageFor(scenario, round) === null;
  const items = evidence.map((shown) => {
    const rule = table[shown.sourceId] ?? table[courseKey(shown.sourceId)];
    if (shown.kind === "tool") {
      return {
        sourceId: shown.sourceId,
        decision: "accept",
        subquestionIds: ["q1"],
        excerpts: [pickExcerpt(shown.text, "Grupo")],
        reason: "Resultado de la herramienta con fuentes del curso.",
      };
    }
    if (free) {
      const score = scores.get(shown.sourceId) ?? null;
      return score !== null && score >= FIXTURE_MIN_SCORE
        ? {
            sourceId: shown.sourceId,
            decision: "accept",
            subquestionIds: ["q1"],
            excerpts: [flatten(shown.text).slice(0, 200).trim()],
            reason: "Supera el umbral lexical de prueba. No es un evaluador.",
          }
        : {
            sourceId: shown.sourceId,
            decision: "reject",
            subquestionIds: [],
            excerpts: [],
            reason: "No supera el umbral lexical de prueba.",
          };
    }
    if (rule === undefined || "reject" in rule) {
      return {
        sourceId: shown.sourceId,
        decision: "reject",
        subquestionIds: [],
        excerpts: [],
        reason: rule === undefined ? "Guion: no aporta a ninguna subpregunta." : rule.reject,
      };
    }
    return {
      sourceId: shown.sourceId,
      decision: "accept",
      subquestionIds: rule.subs,
      excerpts: [pickExcerpt(shown.text, rule.keyword)],
      reason: rule.reason,
    };
  });
  const scripted = coverageFor(scenario, round);
  const anyAccepted = items.some((item) => item.decision === "accept");
  const coverage = subquestions.map((sub) => {
    const cover = scripted?.[sub.id] ?? {
      status: anyAccepted ? "covered" : "uncovered",
      gap: anyAccepted ? null : "Ningún fragmento supera el umbral lexical de prueba.",
      followUp: false,
    };
    return { subquestionId: sub.id, ...cover };
  });
  return { items, coverage, contradictions: [] };
}

function claimFrom(
  evidence: readonly (ShownEvidence & { subquestionIds: string[]; excerpts: string[] })[],
  sourceId: string,
) {
  return evidence.find((item) => item.sourceId === sourceId);
}

function synthesizeFor(
  scenario: ResearchScenarioId | null,
  evidence: readonly (ShownEvidence & { subquestionIds: string[]; excerpts: string[] })[],
  subquestions: readonly { id: string }[],
): unknown {
  const findings = subquestions.flatMap((sub) => {
    const support = evidence
      .filter((item) => item.subquestionIds.includes(sub.id))
      .slice(0, scenario === "invalid-citation" ? 1 : 2);
    return support.map((item) => ({
      subquestionId: sub.id,
      text: item.excerpts[0] ?? item.text.slice(0, 200),
      sourceIds: [item.sourceId],
    }));
  });
  const create = claimFrom(evidence, webId(P.vectorizeCreate));
  const get = claimFrom(evidence, webId(P.vectorizeGet));
  const lc = claimFrom(evidence, webId(P.langchainEmbeddings));
  const checks = [get, create, lc].flatMap((item) =>
    item?.excerpts[0] === undefined ? [] : [{ text: item.excerpts[0], sourceIds: [item.sourceId] }],
  );
  const first = evidence[0];
  const answer =
    create?.excerpts[0] !== undefined
      ? { text: create.excerpts[0], sourceIds: [create.sourceId] }
      : {
          text: first?.excerpts[0] ?? "Sin evidencia.",
          sourceIds: first === undefined ? [] : [first.sourceId],
        };
  if (scenario === "invalid-citation") {
    findings.push(
      {
        subquestionId: "q1",
        text: "Basta con reiniciar el navegador para que desaparezca el aviso.",
        sourceIds: create ? [create.sourceId] : [],
      },
      {
        subquestionId: "q2",
        text: "Según una página que no se ha leído, el error se corrige solo.",
        sourceIds: ["web-000000000000"],
      },
      {
        subquestionId: "q3",
        text: "En el curso se vio que el índice no se puede cambiar después de crearlo.",
        sourceIds: create ? [create.sourceId] : [],
      },
    );
  }
  return { answer, findings: findings.slice(0, 6), checks, unresolved: [] };
}

function followUpFor(
  scenario: ResearchScenarioId | null,
  gaps: readonly { subquestionId: string; text: string }[],
): unknown {
  if (scenario === "partial-follow-up") {
    return { queries: [{ subquestionId: "q2", query: FOLLOW_Q2_QUERY }] };
  }
  if (scenario === "no-progress-stop") {
    return {
      queries: [
        { subquestionId: "q1", query: `  ${MAIN_Q1_QUERY.toUpperCase()}   ` },
        { subquestionId: "q2", query: STALL_Q2_QUERY },
      ],
    };
  }
  return {
    queries: gaps.map((gap) => ({
      subquestionId: gap.subquestionId,
      query: `${gap.text} documentación oficial`.slice(0, 300),
    })),
  };
}

function searchFor(scenario: ResearchScenarioId | null, query: string): PortResult<SearchHit[]> {
  const q = normalizeQuery(query);
  const is = (value: string) => q === normalizeQuery(value);
  switch (scenario) {
    case "sufficient-first-round":
    case "invalid-citation":
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate, P.langchainEmbeddings);
      if (is(MAIN_Q2_QUERY)) return hits(P.vectorizeGet, P.bgeM3);
      break;
    case "partial-follow-up":
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate);
      if (is(MAIN_Q2_QUERY)) return hits(P.bgeM3);
      if (is(FOLLOW_Q2_QUERY)) return hits(P.vectorizeGet, P.bgeM3);
      break;
    case "irrelevant-discarded":
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate, P.blog, P.d1Overview);
      if (is(MAIN_Q2_QUERY)) return hits(P.vectorizeGet, P.injected);
      break;
    case "provider-failure":
      if (is(MAIN_Q1_QUERY)) {
        return {
          ok: false,
          error: "provider",
          detail: "El buscador de prueba devolvió HTTP 503.",
          consumption: { kind: "none" },
        };
      }
      if (is(MAIN_Q2_QUERY)) return hits(P.vectorizeGet, P.bgeM3);
      break;
    case "no-progress-stop":
      if (is(MAIN_Q1_QUERY)) return hits(P.vectorizeCreate);
      if (is(MAIN_Q2_QUERY)) return hits(P.bgeM3);
      if (is(STALL_Q2_QUERY)) return hits(P.bgeM3, P.blog);
      break;
    case "internal-fact-missing":
      if (is(FACT_Q2_QUERY)) return hits(P.checkpointer);
      break;
    default:
      break;
  }
  return ok([]);
}

function courseIdsFor(scenario: ResearchScenarioId | null, query: string): string[] | null {
  if (scenario !== null && MAIN_SCENARIOS.includes(scenario)) {
    if (query === MAIN_Q3) return ["s10-rag:01", "s10-rag:00"];
    if (query === MAIN_Q1)
      return scenario === "irrelevant-discarded" ? ["s16-cloud-aws:00"] : ["s10-rag:00"];
    return [];
  }
  if (scenario === "internal-fact-missing") {
    if (query === FACT_Q1) return ["s12-deep-research:01", "s19-evaluacion:00"];
    if (query === FACT_Q2) return ["s05-langgraph:00"];
    return [];
  }
  return null;
}

export interface FixtureResearchOptions {
  signal: AbortSignal;
  scenarioId: ResearchScenarioId | null;
  audience: Audience;
  corpusVersion: string;
  now?: () => number;
}

/**
 * Puertos de prueba. Demuestran el flujo de control del grafo: no miden la
 * calidad de un modelo ni hacen una investigación real en internet.
 */
function waitFor(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) {
      finish();
      return;
    }
    signal.addEventListener("abort", finish, { once: true });
  });
}

export interface FixtureScenarioLatch {
  noteFixtureQuestion(question: string): void;
}

export function createFixtureResearchPorts(
  options: FixtureResearchOptions,
): ResearchPorts & FixtureScenarioLatch {
  const requested = options.scenarioId;
  let scenario: ResearchScenarioId | null =
    requested === "slow-search" ||
    requested === "ambiguous-operation" ||
    requested === "crash-after-plan"
      ? "sufficient-first-round"
      : requested;
  const noteFixtureQuestion = (question: string) => {
    if (scenario !== null) return;
    const classroom = classroomFixtureScenario(question);
    if (classroom !== null) scenario = classroom;
  };
  const library = fixtureChunks();
  const scores = new Map<string, number | null>();
  const toCourse = (chunkId: string, score: number | null): CourseEvidence | null => {
    const chunk = library.find((item) => item.chunkId === chunkId);
    return chunk === undefined
      ? null
      : {
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
  const model: ResearchModelPort = {
    plan: ({ question, audience }) => {
      noteFixtureQuestion(question);
      return Promise.resolve(ok(planFor(scenario, question, audience)));
    },
    assess: ({ evidence, round, subquestions }) =>
      Promise.resolve(ok(assessFor(scenario, round, evidence, scores, subquestions))),
    followUp: ({ gaps }) => Promise.resolve(ok(followUpFor(scenario, gaps))),
    synthesize: ({ evidence, subquestions }) =>
      Promise.resolve(ok(synthesizeFor(scenario, evidence, subquestions))),
  };
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
      retrieve({ query, audience, corpusVersion, limit }) {
        const scripted = courseIdsFor(scenario, query);
        if (scripted !== null) {
          const rows = scripted
            .map((key) => toCourse(`${corpusVersion}:${key}`, 0.9))
            .filter((item): item is CourseEvidence => item !== null);
          return Promise.resolve(ok(rows.slice(0, limit)));
        }
        const vector = fixtureEmbed(query);
        const rows = library
          .filter(
            (chunk) =>
              chunk.corpusVersion === corpusVersion && allowsAudience(chunk.audience, audience),
          )
          .map((chunk) => ({ chunk, score: cosine(vector, chunk.vector) }))
          .sort((left, right) => right.score - left.score)
          .slice(0, limit)
          .map(({ chunk, score }) => {
            scores.set(chunk.chunkId, score);
            return toCourse(chunk.chunkId, score);
          })
          .filter((item): item is CourseEvidence => item !== null);
        return Promise.resolve(ok(rows));
      },
    },
    tool: createCourseSessionTool({
      corpusVersion: options.corpusVersion,
      audience: options.audience,
      read: (corpusVersion, chunkId) => {
        const chunk = library.find(
          (item) => item.chunkId === chunkId && item.corpusVersion === corpusVersion,
        );
        return Promise.resolve(chunk === undefined ? null : { ...chunk });
      },
    }),
    search: {
      async search({ query }) {
        if (requested === "slow-search") {
          await waitFor(options.signal, 12_000);
          if (options.signal.aborted) {
            return {
              ok: false,
              error: "aborted",
              detail: "La búsqueda de prueba se detuvo.",
              consumption: { kind: "none" },
            };
          }
        }
        return searchFor(scenario, query);
      },
    },
    reader: {
      async read({ url }) {
        const page = fixturePageByUrl(url);
        if (page === null) {
          return {
            ok: false,
            error: "provider",
            detail: "La página no existe en el guion.",
            consumption: { kind: "none" },
          };
        }
        if (scenario === "provider-failure" && page.key === "bgeM3") {
          return {
            ok: false,
            error: "timeout",
            detail: "La lectura de prueba superó su plazo.",
            consumption: { kind: "none" },
          };
        }
        return ok({
          requestedUrl: url,
          finalUrl: page.finalUrl ?? page.url,
          title: page.title,
          text: page.text,
          retrievedAt: FIXTURE_RETRIEVED_AT,
          publishedAt: null,
          contentHash: `sha256:${await sha256Hex(page.text)}`,
        });
      },
    },
  };
}
