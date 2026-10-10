import { RESEARCH_LIMITS, type ResearchNode, type ResearchStep } from "@thepower-rag/contracts";
import { normalizeQuery } from "@thepower-rag/core";
import {
  checkUrl,
  courseInScope,
  dedupeEvidence,
  flagEmbeddedInstructions,
  flatten,
  normalizeUrl,
  pagesLeft,
  remainingMs,
  searchesLeft,
  validateSessionArgs,
  webSourceId,
  type CourseEvidence,
  type EvidenceItem,
  type ResearchPorts,
  type WebEvidence,
} from "@thepower-rag/research";
import {
  addConsumption,
  guardedCall,
  statusOf,
  traced,
  type DiscoveredLog,
  type ReadLog,
  type ResearchState,
} from "./research-state";

export interface NodeDeps {
  ports: ResearchPorts;
  emit: (step: ResearchStep) => void;
}

/** Máximo de fragmentos del curso que entran como candidatos en una ronda. */
export const COURSE_CANDIDATES_PER_ROUND = 6;

/** Corta el recorrido si la petición se abortó o se agotó el plazo total. */
export function halt(
  state: ResearchState,
  deps: NodeDeps,
  node: ResearchNode,
): Partial<ResearchState> | null {
  if (deps.ports.signal.aborted) {
    return {
      outcome: "aborted",
      stop: "aborted",
      stopDetail: "La petición se ha detenido. No empieza trabajo nuevo.",
      trace: traced(state, deps.emit, node, "Petición detenida. No empieza trabajo nuevo."),
    };
  }
  if (remainingMs(state.startedAt, deps.ports.now()) === 0) {
    return {
      outcome: "error",
      stop: "deadline",
      stopDetail: "Se agotó el plazo total de la investigación.",
      trace: traced(state, deps.emit, node, "Plazo total agotado. No empieza otra llamada."),
    };
  }
  return null;
}

/** Utilidad local para ir acumulando la traza dentro de un nodo. */
function tracer(state: ResearchState, deps: NodeDeps, node: ResearchNode) {
  let trace = state.trace;
  return {
    log(status: string) {
      trace = traced({ ...state, trace }, deps.emit, node, status);
    },
    get trace() {
      return trace;
    },
  };
}

function knownIds(state: ResearchState): Set<string> {
  return new Set([
    ...state.accepted.map((entry) => entry.item.sourceId),
    ...state.rejected.map((entry) => entry.sourceId),
    ...state.candidates.map((item) => item.sourceId),
  ]);
}

export async function courseNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  const stop = halt(state, deps, "course");
  if (stop) {
    return stop;
  }
  const t = tracer(state, deps, "course");
  const counters = { ...state.counters };
  const logs = [...state.courseQueries];
  let ledger = state.ledger;
  const known = knownIds(state);
  const found: CourseEvidence[] = [];
  for (const pending of state.pendingCourse) {
    if (counters.courseQueries >= RESEARCH_LIMITS.maxCourseQueries) {
      t.log("Tope de consultas al material del curso alcanzado.");
      break;
    }
    counters.courseQueries += 1;
    const result = await guardedCall(
      deps.ports,
      state.startedAt,
      RESEARCH_LIMITS.timeouts.courseMs,
      (context) =>
        deps.ports.course.retrieve(
          {
            query: pending.query,
            audience: state.audience,
            corpusVersion: state.corpusVersion,
            limit: RESEARCH_LIMITS.maxCourseFragmentsPerQuery,
          },
          context,
        ),
    );
    ledger = addConsumption(ledger, result.consumption);
    if (!result.ok) {
      logs.push({
        round: state.round,
        subquestionId: pending.subquestionId,
        query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
        status: statusOf(result),
        sourceIds: [],
      });
      t.log(`Material del curso para ${pending.subquestionId}: fallo (${result.detail})`);
      if (result.error === "aborted") {
        return {
          ...halt(state, deps, "course"),
          counters,
          courseQueries: logs,
          ledger,
          trace: t.trace,
        };
      }
      continue;
    }
    const rows = result.value.slice(0, RESEARCH_LIMITS.maxCourseFragmentsPerQuery);
    const inScope = rows.filter((chunk) =>
      courseInScope(chunk, { corpusVersion: state.corpusVersion, audience: state.audience }),
    );
    logs.push({
      round: state.round,
      subquestionId: pending.subquestionId,
      query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
      status: "ok",
      sourceIds: inScope.map((chunk) => chunk.sourceId),
    });
    const outside = rows.length - inScope.length;
    t.log(
      `Material del curso para ${pending.subquestionId}: ${String(inScope.length)} fragmentos en alcance${outside > 0 ? `, ${String(outside)} fuera de grupo o versión` : ""}.`,
    );
    found.push(...inScope.filter((chunk) => !known.has(chunk.sourceId)));
  }
  const course = dedupeEvidence(found).slice(0, COURSE_CANDIDATES_PER_ROUND);
  return {
    counters,
    courseQueries: logs,
    ledger,
    candidates: [...state.candidates, ...course],
    trace: t.trace,
  };
}

export async function toolNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  const requested = state.researchPlan?.tool ?? null;
  if (requested === null || state.round !== 1) {
    return {};
  }
  const stop = halt(state, deps, "tool");
  if (stop) {
    return stop;
  }
  const t = tracer(state, deps, "tool");
  if (state.counters.toolCalls >= RESEARCH_LIMITS.maxToolCalls) {
    t.log("Tope de llamadas a la herramienta alcanzado.");
    return { trace: t.trace };
  }
  const args = validateSessionArgs(requested, state.audience);
  const counters = { ...state.counters, toolCalls: state.counters.toolCalls + 1 };
  if (!args.ok) {
    t.log(`get_course_session rechazada: ${args.reason}`);
    return {
      counters,
      toolCalls: [
        ...state.toolCalls,
        {
          round: state.round,
          name: "get_course_session",
          args: { sessionId: requested.sessionId.slice(0, 8), audience: state.audience },
          status: "rejected",
          detail: args.reason,
          sourceIds: [],
        },
      ],
      trace: t.trace,
    };
  }
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.toolMs,
    (context) => deps.ports.tool.getCourseSession(args.value, context),
  );
  const ledger = addConsumption(state.ledger, result.consumption);
  if (!result.ok) {
    t.log(`get_course_session falló: ${result.detail}`);
    const toolCalls = [
      ...state.toolCalls,
      {
        round: state.round,
        name: "get_course_session" as const,
        args: args.value,
        status: "error" as const,
        detail: result.detail.slice(0, RESEARCH_LIMITS.maxReasonChars),
        sourceIds: [],
      },
    ];
    if (result.error === "aborted") {
      return {
        ...halt(state, deps, "tool"),
        counters,
        ledger,
        toolCalls,
        trace: t.trace,
      };
    }
    return { counters, ledger, toolCalls, trace: t.trace };
  }
  const evidence = result.value;
  const valid =
    evidence !== null &&
    evidence.audience === state.audience &&
    evidence.corpusVersion === state.corpusVersion &&
    evidence.backingSourceIds.every((id) => id.startsWith(`${state.corpusVersion}:`));
  t.log(
    valid
      ? `get_course_session(${args.value.sessionId}, ${args.value.audience}) devolvió datos con ${String(evidence.backingSourceIds.length)} fuentes del curso.`
      : "get_course_session no encontró datos documentados en este alcance.",
  );
  return {
    counters,
    ledger,
    toolCalls: [
      ...state.toolCalls,
      {
        round: state.round,
        name: "get_course_session",
        args: args.value,
        status: valid ? "ok" : "rejected",
        detail: valid ? "Datos documentados del curso." : "Sin datos documentados para esa sesión.",
        sourceIds: valid ? evidence.backingSourceIds.slice(0, 4) : [],
      },
    ],
    candidates: valid ? [...state.candidates, evidence] : state.candidates,
    trace: t.trace,
  };
}

function readUrls(state: ResearchState): Set<string> {
  const urls = new Set<string>();
  for (const page of state.pagesRead) {
    urls.add(page.url);
    if (page.finalUrl !== null) {
      urls.add(page.finalUrl);
    }
  }
  return urls;
}

export async function searchNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  if (state.pendingSearch.length === 0) {
    return {};
  }
  const stop = halt(state, deps, "search");
  if (stop) {
    return stop;
  }
  const t = tracer(state, deps, "search");
  const counters = { ...state.counters };
  const searches = [...state.searches];
  const discovered = [...state.discovered];
  const seenQueries = [...state.seenQueries];
  let ledger = state.ledger;
  const alreadyRead = readUrls(state);
  for (const pending of state.pendingSearch) {
    if (searchesLeft(counters) === 0) {
      t.log("Tope global de búsquedas externas alcanzado.");
      break;
    }
    const normalized = normalizeQuery(pending.query);
    if (seenQueries.some((item) => normalizeQuery(item) === normalized)) {
      t.log(`Consulta repetida para ${pending.subquestionId}. No se vuelve a buscar.`);
      continue;
    }
    seenQueries.push(pending.query);
    counters.searchCalls += 1;
    const result = await guardedCall(
      deps.ports,
      state.startedAt,
      RESEARCH_LIMITS.timeouts.searchMs,
      (context) =>
        deps.ports.search.search(
          {
            query: pending.query,
            allowedDomains: deps.ports.allowedDomains,
            limit: RESEARCH_LIMITS.maxResultsPerSearch,
          },
          context,
        ),
    );
    ledger = addConsumption(ledger, result.consumption);
    if (!result.ok) {
      searches.push({
        round: state.round,
        subquestionId: pending.subquestionId,
        query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
        status: statusOf(result),
        resultCount: 0,
        detail: result.detail.slice(0, RESEARCH_LIMITS.maxReasonChars),
      });
      t.log(`Búsqueda ${String(counters.searchCalls)} falló y cuenta: ${result.detail}`);
      if (result.error === "aborted") {
        return { ...halt(state, deps, "search"), counters, searches, ledger, trace: t.trace };
      }
      continue;
    }
    const hits = result.value.slice(0, RESEARCH_LIMITS.maxResultsPerSearch);
    searches.push({
      round: state.round,
      subquestionId: pending.subquestionId,
      query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
      status: "ok",
      resultCount: hits.length,
      detail: "Resultados de descubrimiento. Un resultado no es una página leída.",
    });
    for (const hit of hits) {
      if (discovered.length >= RESEARCH_LIMITS.maxDiscovered) {
        break;
      }
      const verdict = checkUrl(hit.url, deps.ports.allowedDomains);
      const url = verdict.ok ? verdict.url : hit.url.slice(0, RESEARCH_LIMITS.maxUrlChars);
      const decision: DiscoveredLog["decision"] = !verdict.ok
        ? "not-allowed"
        : alreadyRead.has(url)
          ? "already-read"
          : discovered.some((item) => item.url === url && item.round === state.round)
            ? "duplicate"
            : "candidate";
      discovered.push({
        round: state.round,
        subquestionId: pending.subquestionId,
        url,
        title: flatten(hit.title).slice(0, RESEARCH_LIMITS.maxTitleChars),
        domain: verdict.domain.slice(0, 253),
        decision,
      });
    }
    t.log(
      `Búsqueda ${String(counters.searchCalls)} para ${pending.subquestionId}: ${String(hits.length)} resultados de descubrimiento.`,
    );
  }
  return { counters, searches, discovered, seenQueries, ledger, trace: t.trace };
}

/** Elige páginas reales para leer: permitidas, nuevas y dentro del tope global. */
export function selectNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  const fresh = state.discovered.filter(
    (item) => item.round === state.round && item.decision === "candidate",
  );
  if (fresh.length === 0) {
    if (state.pendingSearch.length === 0) {
      return {};
    }
    return {
      trace: traced(state, deps.emit, "select", "Ningún resultado nuevo y permitido para leer."),
    };
  }
  const budget = Math.min(RESEARCH_LIMITS.maxPagesPerRound, pagesLeft(state.counters));
  const order = [...new Set(fresh.map((item) => item.subquestionId))];
  const queues = order.map((id) => fresh.filter((item) => item.subquestionId === id));
  const chosen = new Set<DiscoveredLog>();
  while (chosen.size < budget && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined && chosen.size < budget) {
        chosen.add(next);
      }
    }
  }
  const discovered = state.discovered.map((item): DiscoveredLog => {
    if (item.round !== state.round || item.decision !== "candidate") {
      return item;
    }
    return { ...item, decision: chosen.has(item) ? "selected" : "over-budget" };
  });
  const skipped = fresh.length - chosen.size;
  return {
    discovered,
    trace: traced(
      state,
      deps.emit,
      "select",
      `Se leerán ${String(chosen.size)} páginas${skipped > 0 ? `; ${String(skipped)} quedan fuera por el tope` : ""}.`,
    ),
  };
}

const HASH = /^sha256:[0-9a-f]{64}$/;

export async function readNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  const selected = state.discovered.filter(
    (item) => item.round === state.round && item.decision === "selected",
  );
  if (selected.length === 0) {
    return {};
  }
  const t = tracer(state, deps, "read");
  const counters = { ...state.counters };
  const pagesRead = [...state.pagesRead];
  const candidates: EvidenceItem[] = [...state.candidates];
  let ledger = state.ledger;
  const known = knownIds(state);
  for (const page of selected) {
    const stop = halt({ ...state, trace: t.trace }, deps, "read");
    if (stop) {
      return { ...stop, counters, pagesRead, candidates, ledger };
    }
    if (pagesLeft(counters) === 0) {
      t.log("Tope global de páginas leídas alcanzado.");
      break;
    }
    counters.pagesRead += 1;
    const base: ReadLog = {
      round: state.round,
      subquestionId: page.subquestionId,
      url: page.url,
      finalUrl: null,
      sourceId: null,
      status: "error",
      detail: "",
      chars: 0,
      contentHash: null,
      instructionsFlagged: false,
    };
    const result = await guardedCall(
      deps.ports,
      state.startedAt,
      RESEARCH_LIMITS.timeouts.readMs,
      (context) => deps.ports.reader.read({ url: page.url }, context),
    );
    ledger = addConsumption(ledger, result.consumption);
    if (!result.ok) {
      const status = statusOf(result);
      pagesRead.push({
        ...base,
        status: status === "skipped" || status === "ok" ? "error" : status,
        detail: result.detail.slice(0, RESEARCH_LIMITS.maxReasonChars),
      });
      t.log(`Lectura de ${page.domain} falló y cuenta: ${result.detail}`);
      if (result.error === "aborted") {
        return {
          ...halt({ ...state, trace: t.trace }, deps, "read"),
          counters,
          pagesRead,
          candidates,
          ledger,
        };
      }
      continue;
    }
    const snapshot = result.value;
    const final = checkUrl(snapshot.finalUrl, deps.ports.allowedDomains);
    const text = flatten(snapshot.text).slice(0, RESEARCH_LIMITS.maxPageChars);
    const reject = (detail: string, finalUrl: string | null) => {
      pagesRead.push({ ...base, finalUrl, status: "rejected", detail, chars: 0 });
      t.log(`Página rechazada: ${detail}`);
    };
    if (!final.ok) {
      reject(`La URL final no está permitida (${final.domain || "desconocida"}).`, null);
      continue;
    }
    if (!HASH.test(snapshot.contentHash)) {
      reject("La lectura no trae una identidad de contenido válida.", final.url);
      continue;
    }
    if (text.length === 0) {
      reject("La página no tiene texto extraído.", final.url);
      continue;
    }
    const sourceId = webSourceId(final.url);
    if (known.has(sourceId)) {
      reject("La URL final es una página ya leída.", final.url);
      continue;
    }
    known.add(sourceId);
    const flagged = flagEmbeddedInstructions(text);
    const evidence: WebEvidence = {
      kind: "web",
      sourceId,
      requestedUrl: page.url,
      url: normalizeUrl(final.url),
      domain: final.domain,
      title: (flatten(snapshot.title) || page.title || final.domain).slice(
        0,
        RESEARCH_LIMITS.maxTitleChars,
      ),
      text,
      retrievedAt: snapshot.retrievedAt,
      publishedAt: snapshot.publishedAt,
      contentHash: snapshot.contentHash,
      fixture: deps.ports.fixture,
    };
    candidates.push(evidence);
    pagesRead.push({
      ...base,
      finalUrl: evidence.url,
      sourceId,
      status: "ok",
      detail: flagged
        ? "Leída. Contiene texto con apariencia de instrucciones: se trata como dato."
        : "Leída y acotada.",
      chars: text.length,
      contentHash: snapshot.contentHash,
      instructionsFlagged: flagged,
    });
    t.log(
      `Leída ${final.domain}: ${String(text.length)} caracteres${flagged ? ", con instrucciones embebidas tratadas como dato" : ""}.`,
    );
  }
  return { counters, pagesRead, candidates, ledger, trace: t.trace };
}
