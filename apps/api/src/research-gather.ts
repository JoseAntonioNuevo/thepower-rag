// GUÍA DE LECTURA · apps/api/src/research-gather.ts
// Nodos del grafo que reúnen evidencia: material del curso, herramienta de sesiones, búsqueda web,
// selección de páginas y lectura. Todo pasa por topes globales y por la lista de dominios permitidos.
// Límites, nodo y paso del contrato.
import { RESEARCH_LIMITS, type ResearchNode, type ResearchStep } from "@thepower-rag/contracts";
// Normaliza consultas para detectar repeticiones.
import { normalizeQuery } from "@thepower-rag/core";
// Reglas puras: URL permitidas, alcance, duplicados, instrucciones embebidas y topes.
import {
  // URL permitidas, alcance del curso, deduplicación e instrucciones embebidas.
  checkUrl,
  courseInScope,
  dedupeEvidence,
  flagEmbeddedInstructions,
  // Texto plano, URL canónica y topes restantes.
  flatten,
  normalizeUrl,
  pagesLeft,
  remainingMs,
  searchesLeft,
  // Validación de la herramienta e id de una fuente web.
  validateSessionArgs,
  webSourceId,
  // Tipos de evidencia y de puertos.
  type CourseEvidence,
  type EvidenceItem,
  type ResearchPorts,
  type WebEvidence,
} from "@thepower-rag/research";
// Estado, consumo, llamadas protegidas y traza.
import {
  addConsumption,
  guardedCall,
  statusOf,
  traced,
  type DiscoveredLog,
  type ReadLog,
  type ResearchState,
} from "./research-state";

// Dependencias de cada nodo.
export interface NodeDeps {
  // Puertos (modelo, curso, web…).
  ports: ResearchPorts;
  // Función que emite cada paso.
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
  // Petición cancelada.
  if (deps.ports.signal.aborted) {
    // Termina como aborted.
    return {
      outcome: "aborted",
      stop: "aborted",
      stopDetail: "La petición se ha detenido. No empieza trabajo nuevo.",
      trace: traced(state, deps.emit, node, "Petición detenida. No empieza trabajo nuevo."),
    };
  }
  // Sin plazo total.
  if (remainingMs(state.startedAt, deps.ports.now()) === 0) {
    // Termina como error.
    return {
      outcome: "error",
      stop: "deadline",
      stopDetail: "Se agotó el plazo total de la investigación.",
      trace: traced(state, deps.emit, node, "Plazo total agotado. No empieza otra llamada."),
    };
  }
  // Puede seguir.
  return null;
}

/** Utilidad local para ir acumulando la traza dentro de un nodo. */
function tracer(state: ResearchState, deps: NodeDeps, node: ResearchNode) {
  // Traza actual.
  let trace = state.trace;
  // Objeto con log y la traza acumulada.
  return {
    log(status: string) {
      // Añade un paso.
      trace = traced({ ...state, trace }, deps.emit, node, status);
    },
    get trace() {
      // Traza actual.
      return trace;
    },
  };
}

// Ids ya vistos: aceptados, rechazados y candidatos.
function knownIds(state: ResearchState): Set<string> {
  // Conjunto de ids.
  return new Set([
    ...state.accepted.map((entry) => entry.item.sourceId),
    ...state.rejected.map((entry) => entry.sourceId),
    ...state.candidates.map((item) => item.sourceId),
  ]);
}

// Nodo course: consulta el material del curso por cada subpregunta pendiente.
export async function courseNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  // Parada.
  const stop = halt(state, deps, "course");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Traza local.
  const t = tracer(state, deps, "course");
  // Contadores.
  const counters = { ...state.counters };
  // Registros.
  const logs = [...state.courseQueries];
  // Consumo.
  let ledger = state.ledger;
  // Ids ya vistos.
  const known = knownIds(state);
  // Fragmentos nuevos.
  const found: CourseEvidence[] = [];
  // Cada consulta pendiente.
  for (const pending of state.pendingCourse) {
    // Tope de consultas.
    if (counters.courseQueries >= RESEARCH_LIMITS.maxCourseQueries) {
      // Lo registra.
      t.log("Tope de consultas al material del curso alcanzado.");
      // Sale.
      break;
    }
    // Cuenta la consulta.
    counters.courseQueries += 1;
    // Búsqueda en el curso con plazo.
    const result = await guardedCall(
      // Puertos, inicio del trabajo y plazo de esta llamada.
      deps.ports,
      state.startedAt,
      RESEARCH_LIMITS.timeouts.courseMs,
      (context) =>
        // Consulta al curso: texto, grupo, versión del corpus y número máximo de fragmentos.
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
    // Consumo.
    ledger = addConsumption(ledger, result.consumption);
    // Fallo.
    if (!result.ok) {
      // Registro del fallo.
      logs.push({
        round: state.round,
        subquestionId: pending.subquestionId,
        query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
        status: statusOf(result),
        sourceIds: [],
      });
      // Paso visible.
      t.log(`Material del curso para ${pending.subquestionId}: fallo (${result.detail})`);
      // Cancelado.
      if (result.error === "aborted") {
        // Termina con lo acumulado.
        return {
          ...halt(state, deps, "course"),
          counters,
          courseQueries: logs,
          ledger,
          trace: t.trace,
        };
      }
      // Siguiente consulta.
      continue;
    }
    // Fragmentos con tope.
    const rows = result.value.slice(0, RESEARCH_LIMITS.maxCourseFragmentsPerQuery);
    // Solo de la versión y audiencia correctas.
    const inScope = rows.filter((chunk) =>
      courseInScope(chunk, { corpusVersion: state.corpusVersion, audience: state.audience }),
    );
    // Registro correcto.
    logs.push({
      round: state.round,
      subquestionId: pending.subquestionId,
      query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
      status: "ok",
      sourceIds: inScope.map((chunk) => chunk.sourceId),
    });
    // Fragmentos fuera de alcance.
    const outside = rows.length - inScope.length;
    // Paso visible.
    t.log(
      `Material del curso para ${pending.subquestionId}: ${String(inScope.length)} fragmentos en alcance${outside > 0 ? `, ${String(outside)} fuera de grupo o versión` : ""}.`,
    );
    // Añade los nuevos.
    found.push(...inScope.filter((chunk) => !known.has(chunk.sourceId)));
  }
  // Candidatos sin duplicar y con tope por ronda.
  const course = dedupeEvidence(found).slice(0, COURSE_CANDIDATES_PER_ROUND);
  // Estado actualizado.
  return {
    counters,
    courseQueries: logs,
    ledger,
    candidates: [...state.candidates, ...course],
    trace: t.trace,
  };
}

// Nodo tool: llama a get_course_session si el plan lo pidió.
export async function toolNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  // Herramienta pedida.
  const requested = state.researchPlan?.tool ?? null;
  // Sin herramienta o fuera de la ronda 1: nada.
  if (requested === null || state.round !== 1) {
    // Sin cambios.
    return {};
  }
  // Parada.
  const stop = halt(state, deps, "tool");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Traza local.
  const t = tracer(state, deps, "tool");
  // Tope de llamadas.
  if (state.counters.toolCalls >= RESEARCH_LIMITS.maxToolCalls) {
    // Lo registra.
    t.log("Tope de llamadas a la herramienta alcanzado.");
    // Sale.
    return { trace: t.trace };
  }
  // Valida los argumentos.
  const args = validateSessionArgs(requested, state.audience);
  // Una llamada más.
  const counters = { ...state.counters, toolCalls: state.counters.toolCalls + 1 };
  // Argumentos inválidos.
  if (!args.ok) {
    // Lo registra.
    t.log(`get_course_session rechazada: ${args.reason}`);
    // Llamada rechazada sin ejecutar.
    return {
      // Solo cuenta la llamada; no se ejecuta.
      counters,
      // Registro de la llamada rechazada para la traza.
      toolCalls: [
        ...state.toolCalls,
        {
          round: state.round,
          name: "get_course_session",
          // Argumentos recortados y grupo del estado (el modelo no puede pedir otro grupo).
          args: { sessionId: requested.sessionId.slice(0, 8), audience: state.audience },
          // Estado «rejected», motivo y sin fuentes.
          status: "rejected",
          detail: args.reason,
          sourceIds: [],
        },
      ],
      trace: t.trace,
    };
  }
  // Llamada con plazo.
  const result = await guardedCall(
    deps.ports,
    state.startedAt,
    RESEARCH_LIMITS.timeouts.toolMs,
    (context) => deps.ports.tool.getCourseSession(args.value, context),
  );
  // Consumo.
  const ledger = addConsumption(state.ledger, result.consumption);
  // Fallo.
  if (!result.ok) {
    // Lo registra.
    t.log(`get_course_session falló: ${result.detail}`);
    // Registro del fallo.
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
    // Cancelado.
    if (result.error === "aborted") {
      // Termina.
      return {
        ...halt(state, deps, "tool"),
        counters,
        ledger,
        toolCalls,
        trace: t.trace,
      };
    }
    // Sigue sin la herramienta.
    return { counters, ledger, toolCalls, trace: t.trace };
  }
  // Ficha devuelta.
  const evidence = result.value;
  // Válida si es de la audiencia y versión, con fuentes de esa versión.
  const valid =
    evidence !== null &&
    evidence.audience === state.audience &&
    evidence.corpusVersion === state.corpusVersion &&
    evidence.backingSourceIds.every((id) => id.startsWith(`${state.corpusVersion}:`));
  // Paso visible.
  t.log(
    valid
      ? `get_course_session(${args.value.sessionId}, ${args.value.audience}) devolvió datos con ${String(evidence.backingSourceIds.length)} fuentes del curso.`
      : "get_course_session no encontró datos documentados en este alcance.",
  );
  // Registro y candidato si es válida.
  return {
    // Contadores y consumo.
    counters,
    ledger,
    // Registro de la llamada con su resultado.
    toolCalls: [
      ...state.toolCalls,
      {
        round: state.round,
        name: "get_course_session",
        // Argumentos ya validados.
        args: args.value,
        // ok si devolvió datos documentados; rejected si la sesión no los tiene.
        status: valid ? "ok" : "rejected",
        detail: valid ? "Datos documentados del curso." : "Sin datos documentados para esa sesión.",
        // Fuentes del corpus que respaldan la ficha (como mucho 4).
        sourceIds: valid ? evidence.backingSourceIds.slice(0, 4) : [],
      },
    ],
    // Solo una ficha válida pasa a candidata para el evaluador.
    candidates: valid ? [...state.candidates, evidence] : state.candidates,
    trace: t.trace,
  };
}

// URL ya leídas (pedidas y finales).
function readUrls(state: ResearchState): Set<string> {
  // Conjunto.
  const urls = new Set<string>();
  // Cada lectura.
  for (const page of state.pagesRead) {
    // URL pedida.
    urls.add(page.url);
    // Si hay final.
    if (page.finalUrl !== null) {
      // También.
      urls.add(page.finalUrl);
    }
  }
  // URL leídas.
  return urls;
}

// Nodo search: búsquedas web de la ronda.
export async function searchNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  // Sin búsquedas pendientes.
  if (state.pendingSearch.length === 0) {
    // Nada.
    return {};
  }
  // Parada.
  const stop = halt(state, deps, "search");
  // Si toca.
  if (stop) {
    // Devuelve.
    return stop;
  }
  // Traza local.
  const t = tracer(state, deps, "search");
  // Contadores.
  const counters = { ...state.counters };
  // Búsquedas.
  const searches = [...state.searches];
  // URL descubiertas.
  const discovered = [...state.discovered];
  // Consultas ya usadas.
  const seenQueries = [...state.seenQueries];
  // Consumo.
  let ledger = state.ledger;
  // URL ya leídas.
  const alreadyRead = readUrls(state);
  // Cada búsqueda pendiente.
  for (const pending of state.pendingSearch) {
    // Tope global.
    if (searchesLeft(counters) === 0) {
      // Lo registra.
      t.log("Tope global de búsquedas externas alcanzado.");
      // Sale.
      break;
    }
    // Consulta normalizada.
    const normalized = normalizeQuery(pending.query);
    // Repetida.
    if (seenQueries.some((item) => normalizeQuery(item) === normalized)) {
      // Lo registra.
      t.log(`Consulta repetida para ${pending.subquestionId}. No se vuelve a buscar.`);
      // Siguiente.
      continue;
    }
    // La marca como usada.
    seenQueries.push(pending.query);
    // Cuenta la búsqueda.
    counters.searchCalls += 1;
    // Búsqueda con plazo y dominios permitidos.
    const result = await guardedCall(
      // Puertos, inicio y plazo de la búsqueda.
      deps.ports,
      state.startedAt,
      RESEARCH_LIMITS.timeouts.searchMs,
      (context) =>
        // Búsqueda: consulta, dominios permitidos y número máximo de resultados.
        deps.ports.search.search(
          {
            query: pending.query,
            allowedDomains: deps.ports.allowedDomains,
            limit: RESEARCH_LIMITS.maxResultsPerSearch,
          },
          context,
        ),
    );
    // Consumo.
    ledger = addConsumption(ledger, result.consumption);
    // Fallo.
    if (!result.ok) {
      // Registro del fallo.
      searches.push({
        round: state.round,
        subquestionId: pending.subquestionId,
        query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
        status: statusOf(result),
        resultCount: 0,
        detail: result.detail.slice(0, RESEARCH_LIMITS.maxReasonChars),
      });
      // Paso visible.
      t.log(`Búsqueda ${String(counters.searchCalls)} falló y cuenta: ${result.detail}`);
      // Cancelado.
      if (result.error === "aborted") {
        // Termina.
        return { ...halt(state, deps, "search"), counters, searches, ledger, trace: t.trace };
      }
      // Siguiente.
      continue;
    }
    // Resultados con tope.
    const hits = result.value.slice(0, RESEARCH_LIMITS.maxResultsPerSearch);
    // Registro correcto.
    searches.push({
      round: state.round,
      subquestionId: pending.subquestionId,
      query: pending.query.slice(0, RESEARCH_LIMITS.maxQueryChars),
      status: "ok",
      resultCount: hits.length,
      detail: "Resultados de descubrimiento. Un resultado no es una página leída.",
    });
    // Cada resultado.
    for (const hit of hits) {
      // Tope de descubiertas.
      if (discovered.length >= RESEARCH_LIMITS.maxDiscovered) {
        // Sale.
        break;
      }
      // ¿Dominio permitido?
      const verdict = checkUrl(hit.url, deps.ports.allowedDomains);
      // URL normalizada o recortada.
      const url = verdict.ok ? verdict.url : hit.url.slice(0, RESEARCH_LIMITS.maxUrlChars);
      // Decisión: no permitida, ya leída, duplicada o candidata.
      const decision: DiscoveredLog["decision"] = !verdict.ok
        ? "not-allowed"
        : alreadyRead.has(url)
          ? "already-read"
          : discovered.some((item) => item.url === url && item.round === state.round)
            ? "duplicate"
            : "candidate";
      // Registro de la URL.
      discovered.push({
        round: state.round,
        subquestionId: pending.subquestionId,
        url,
        title: flatten(hit.title).slice(0, RESEARCH_LIMITS.maxTitleChars),
        domain: verdict.domain.slice(0, 253),
        decision,
      });
    }
    // Paso visible.
    t.log(
      `Búsqueda ${String(counters.searchCalls)} para ${pending.subquestionId}: ${String(hits.length)} resultados de descubrimiento.`,
    );
  }
  // Estado actualizado.
  return { counters, searches, discovered, seenQueries, ledger, trace: t.trace };
}

/** Elige páginas reales para leer: permitidas, nuevas y dentro del tope global. */
export function selectNode(state: ResearchState, deps: NodeDeps): Partial<ResearchState> {
  // Candidatas de esta ronda.
  const fresh = state.discovered.filter(
    (item) => item.round === state.round && item.decision === "candidate",
  );
  // Ninguna.
  if (fresh.length === 0) {
    // Sin búsquedas: nada.
    if (state.pendingSearch.length === 0) {
      // Sin cambios.
      return {};
    }
    // Paso visible.
    return {
      trace: traced(state, deps.emit, "select", "Ningún resultado nuevo y permitido para leer."),
    };
  }
  // Páginas que se pueden leer en la ronda.
  const budget = Math.min(RESEARCH_LIMITS.maxPagesPerRound, pagesLeft(state.counters));
  // Subpreguntas en orden.
  const order = [...new Set(fresh.map((item) => item.subquestionId))];
  // Cola de candidatas por subpregunta.
  const queues = order.map((id) => fresh.filter((item) => item.subquestionId === id));
  // Elegidas.
  const chosen = new Set<DiscoveredLog>();
  // Reparte por turnos entre subpreguntas hasta el tope.
  while (chosen.size < budget && queues.some((queue) => queue.length > 0)) {
    // Cada cola.
    for (const queue of queues) {
      // Siguiente candidata.
      const next = queue.shift();
      // Si hay y cabe.
      if (next !== undefined && chosen.size < budget) {
        // La elige.
        chosen.add(next);
      }
    }
  }
  // Marca elegidas o fuera de tope.
  const discovered = state.discovered.map((item): DiscoveredLog => {
    // Otras rondas o decisiones: sin cambio.
    if (item.round !== state.round || item.decision !== "candidate") {
      // Igual.
      return item;
    }
    // selected u over-budget.
    return { ...item, decision: chosen.has(item) ? "selected" : "over-budget" };
  });
  // Fuera por tope.
  const skipped = fresh.length - chosen.size;
  // Estado actualizado.
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

// Formato de hash del contenido.
const HASH = /^sha256:[0-9a-f]{64}$/;

// Nodo read: lee cada página elegida y la convierte en evidencia.
export async function readNode(
  state: ResearchState,
  deps: NodeDeps,
): Promise<Partial<ResearchState>> {
  // Elegidas de esta ronda.
  const selected = state.discovered.filter(
    (item) => item.round === state.round && item.decision === "selected",
  );
  // Ninguna.
  if (selected.length === 0) {
    // Nada.
    return {};
  }
  // Traza local.
  const t = tracer(state, deps, "read");
  // Contadores.
  const counters = { ...state.counters };
  // Lecturas.
  const pagesRead = [...state.pagesRead];
  // Candidatos.
  const candidates: EvidenceItem[] = [...state.candidates];
  // Consumo.
  let ledger = state.ledger;
  // Ids ya vistos.
  const known = knownIds(state);
  // Cada página.
  for (const page of selected) {
    // Parada.
    const stop = halt({ ...state, trace: t.trace }, deps, "read");
    // Si toca.
    if (stop) {
      // Termina con lo acumulado.
      return { ...stop, counters, pagesRead, candidates, ledger };
    }
    // Tope global de páginas.
    if (pagesLeft(counters) === 0) {
      // Lo registra.
      t.log("Tope global de páginas leídas alcanzado.");
      // Sale.
      break;
    }
    // Cuenta la lectura.
    counters.pagesRead += 1;
    // Registro base.
    const base: ReadLog = {
      // Registro de la lectura: empieza como error y se completa si va bien.
      round: state.round,
      subquestionId: page.subquestionId,
      url: page.url,
      // URL final, fuente, estado, detalle, caracteres, hash e instrucciones incrustadas.
      finalUrl: null,
      sourceId: null,
      status: "error",
      detail: "",
      chars: 0,
      contentHash: null,
      instructionsFlagged: false,
    };
    // Lectura con plazo.
    const result = await guardedCall(
      deps.ports,
      state.startedAt,
      RESEARCH_LIMITS.timeouts.readMs,
      (context) => deps.ports.reader.read({ url: page.url }, context),
    );
    // Consumo.
    ledger = addConsumption(ledger, result.consumption);
    // Fallo.
    if (!result.ok) {
      // Estado.
      const status = statusOf(result);
      // Registro del fallo.
      pagesRead.push({
        ...base,
        status: status === "skipped" || status === "ok" ? "error" : status,
        detail: result.detail.slice(0, RESEARCH_LIMITS.maxReasonChars),
      });
      // Paso visible.
      t.log(`Lectura de ${page.domain} falló y cuenta: ${result.detail}`);
      // Cancelado.
      if (result.error === "aborted") {
        // Termina.
        return {
          ...halt({ ...state, trace: t.trace }, deps, "read"),
          counters,
          pagesRead,
          candidates,
          ledger,
        };
      }
      // Siguiente.
      continue;
    }
    // Página leída.
    const snapshot = result.value;
    // ¿URL final permitida?
    const final = checkUrl(snapshot.finalUrl, deps.ports.allowedDomains);
    // Texto en una línea y con tope.
    const text = flatten(snapshot.text).slice(0, RESEARCH_LIMITS.maxPageChars);
    // Registra un rechazo.
    const reject = (detail: string, finalUrl: string | null) => {
      // Registro.
      pagesRead.push({ ...base, finalUrl, status: "rejected", detail, chars: 0 });
      // Paso visible.
      t.log(`Página rechazada: ${detail}`);
    };
    // URL final no permitida.
    if (!final.ok) {
      // Rechazo.
      reject(`La URL final no está permitida (${final.domain || "desconocida"}).`, null);
      // Siguiente.
      continue;
    }
    // Hash inválido.
    if (!HASH.test(snapshot.contentHash)) {
      // Rechazo.
      reject("La lectura no trae una identidad de contenido válida.", final.url);
      // Siguiente.
      continue;
    }
    // Sin texto.
    if (text.length === 0) {
      // Rechazo.
      reject("La página no tiene texto extraído.", final.url);
      // Siguiente.
      continue;
    }
    // Id de la fuente web.
    const sourceId = webSourceId(final.url);
    // Ya leída.
    if (known.has(sourceId)) {
      // Rechazo.
      reject("La URL final es una página ya leída.", final.url);
      // Siguiente.
      continue;
    }
    // La marca como vista.
    known.add(sourceId);
    // ¿Contiene instrucciones embebidas?
    const flagged = flagEmbeddedInstructions(text);
    // Evidencia web.
    const evidence: WebEvidence = {
      // Evidencia web: id, URL pedida y canónica, dominio y título recortado.
      kind: "web",
      sourceId,
      requestedUrl: page.url,
      url: normalizeUrl(final.url),
      domain: final.domain,
      title: (flatten(snapshot.title) || page.title || final.domain).slice(
        0,
        RESEARCH_LIMITS.maxTitleChars,
      ),
      // Texto acotado de la página.
      text,
      // Fechas, hash del contenido y si es una página de la demo.
      retrievedAt: snapshot.retrievedAt,
      publishedAt: snapshot.publishedAt,
      contentHash: snapshot.contentHash,
      fixture: deps.ports.fixture,
    };
    // Candidato.
    candidates.push(evidence);
    // Registro correcto.
    pagesRead.push({
      // Lectura correcta: URL final, fuente y estado «ok».
      ...base,
      finalUrl: evidence.url,
      sourceId,
      status: "ok",
      // El detalle avisa si había texto con apariencia de órdenes: se trata como dato, no se
      // obedece.
      detail: flagged
        ? "Leída. Contiene texto con apariencia de instrucciones: se trata como dato."
        : "Leída y acotada.",
      // Tamaño, hash y marca de instrucciones.
      chars: text.length,
      contentHash: snapshot.contentHash,
      instructionsFlagged: flagged,
    });
    // Paso visible.
    t.log(
      `Leída ${final.domain}: ${String(text.length)} caracteres${flagged ? ", con instrucciones embebidas tratadas como dato" : ""}.`,
    );
  }
  // Estado actualizado.
  return { counters, pagesRead, candidates, ledger, trace: t.trace };
}
