// GUÍA DE LECTURA · apps/api/src/research-graph.test.ts
// Pruebas del grafo de investigación con los puertos de prueba: los ocho escenarios de la demo, preguntas
// libres, contradicciones, fallos de la herramienta, cancelación y contabilidad del consumo.
// Pregunta de demo, límites, esquema y tipos.
import {
  DEMO_RESEARCH_QUESTION,
  RESEARCH_LIMITS,
  researchSummarySchema,
  type Audience,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
// Tipos de puertos y petición.
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
// Funciones de prueba.
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
// Versión del corpus de ejemplo.
import { fixtureCorpusVersion } from "./fixture";
// Puertos de prueba y consulta principal.
import { createFixtureResearchPorts, MAIN_Q1_QUERY } from "./research-fixture";
// Grafo y estado inicial.
import { initialResearchState, runResearchGraph } from "./research-graph";
// Libro de consumo.
import { addConsumption, emptyLedger } from "./research-state";
// Resumen y fuentes citadas.
import { citedSources, researchSummary } from "./research-summary";

// fetch original.
const originalFetch = globalThis.fetch;
// Antes de cada prueba prohíbe la red.
beforeEach(() => {
  // fetch que siempre falla.
  globalThis.fetch = (() => {
    // Error.
    throw new Error("red no permitida en pruebas deterministas");
  }) as typeof fetch;
});
// Después restaura fetch.
afterEach(() => {
  // Original.
  globalThis.fetch = originalFetch;
});

// Versión del corpus.
const corpus = fixtureCorpusVersion();

// Petición de investigación de prueba.
function request(
  question: string,
  scenarioId: ResearchScenarioId | null,
  audience: Audience = "program",
): ResearchRequest {
  // Campos de la petición.
  return {
    runId: "run-test",
    threadId: null,
    question,
    observations: [{ kind: "text", text: question }],
    audience,
    corpusVersion: corpus,
    scenarioId,
  };
}

// Llamadas contadas por puerto.
interface Calls {
  // Etapas del modelo en orden.
  model: string[];
  // Búsquedas.
  search: number;
  // URL leídas.
  read: string[];
  // Consultas al curso.
  course: number;
  // Llamadas a la herramienta.
  tool: number;
}

/** Envuelve los puertos para contar llamadas sin cambiar su comportamiento. */
function counted(ports: ResearchPorts): { ports: ResearchPorts; calls: Calls } {
  // Contadores vacíos.
  const calls: Calls = { model: [], search: 0, read: [], course: 0, tool: 0 };
  // Puertos que registran cada llamada y delegan.
  return {
    calls,
    ports: {
      ...ports,
      model: {
        plan: (i, c) => (calls.model.push("plan"), ports.model.plan(i, c)),
        assess: (i, c) => (calls.model.push("assess"), ports.model.assess(i, c)),
        followUp: (i, c) => (calls.model.push("followUp"), ports.model.followUp(i, c)),
        synthesize: (i, c) => (calls.model.push("synthesize"), ports.model.synthesize(i, c)),
      },
      search: { search: (i, c) => ((calls.search += 1), ports.search.search(i, c)) },
      reader: { read: (i, c) => (calls.read.push(i.url), ports.reader.read(i, c)) },
      course: { retrieve: (i, c) => ((calls.course += 1), ports.course.retrieve(i, c)) },
      tool: { getCourseSession: (i, c) => ((calls.tool += 1), ports.tool.getCourseSession(i, c)) },
    },
  };
}

// Ejecuta el grafo con un escenario y devuelve estado, resumen y llamadas.
async function run(
  scenario: ResearchScenarioId | null,
  question = DEMO_RESEARCH_QUESTION,
  audience: Audience = "program",
  tweak?: (ports: ResearchPorts) => ResearchPorts,
) {
  // Controlador de cancelación.
  const controller = new AbortController();
  // Puertos de prueba.
  const base = createFixtureResearchPorts({
    signal: controller.signal,
    scenarioId: scenario,
    audience,
    corpusVersion: corpus,
  });
  // Puertos contados, con un cambio opcional.
  const { ports, calls } = counted(tweak ? tweak(base) : base);
  // Ejecuta el grafo.
  const state = await runResearchGraph(request(question, scenario, audience), ports);
  // Resumen validado.
  const summary = researchSummarySchema.parse(researchSummary(state, ports));
  // Resultado.
  return { state, summary, calls, sources: citedSources(state), controller };
}

// Grupo: grafo con puertos de prueba.
describe("grafo de investigación con adaptadores de prueba", () => {
  // Escenario 1: basta la primera ronda.
  it("1. evidencia suficiente en la primera ronda produce un informe completo", async () => {
    // Ejecuta.
    const { summary, sources, state, calls } = await run("sufficient-first-round");
    // Ruta investigate.
    expect(summary.route).toBe("investigate");
    // Tres subpreguntas.
    expect(summary.subquestions).toHaveLength(3);
    // Conserva la pregunta original.
    expect(summary.originalQuestion).toBe(DEMO_RESEARCH_QUESTION);
    // No busca la pregunta literal.
    expect(summary.searches.map((item) => item.query)).not.toContain(DEMO_RESEARCH_QUESTION);
    // Una ronda.
    expect(summary.rounds).toBe(1);
    // Completo.
    expect(summary.outcome).toBe("complete");
    // Todo cubierto.
    expect(summary.stop).toBe("all-covered");
    // Cubierto.
    expect(summary.coverage.every((entry) => entry.status === "covered")).toBe(true);
    // Dos búsquedas.
    expect(summary.counters.searchCalls).toBe(2);
    // Cuatro páginas.
    expect(summary.counters.pagesRead).toBe(4);
    // Plan, evaluación y síntesis.
    expect(calls.model).toEqual(["plan", "assess", "synthesize"]);
    // Tipos de fuente.
    const kinds = new Set(sources.map((source) => source.kind));
    // Curso y web.
    expect(kinds).toEqual(new Set(["course", "web"]));
    // Las fuentes son las citadas.
    expect(sources.map((source) => source.sourceId).sort()).toEqual(
      [...summary.citedSourceIds].sort(),
    );
    // Fuentes web.
    const webSources = sources.filter((source) => source.kind === "web");
    // Hay alguna.
    expect(webSources.length).toBeGreaterThan(0);
    // Cada fuente.
    for (const source of sources) {
      // Aparece citada en el informe.
      expect(state.reportText).toContain(`[cite:${source.sourceId}]`);
    }
    // Cada fuente web.
    for (const source of webSources) {
      // Hash válido.
      expect(source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      // Sin fecha de publicación.
      expect(source.publishedAt).toBeNull();
      // Datos de prueba.
      expect(source.fixture).toBe(true);
      // Se leyó.
      expect(summary.pagesRead.some((page) => page.sourceId === source.sourceId)).toBe(true);
    }
    // Sin medir.
    expect(summary.accounting.measured).toBe(false);
    // Total incompleto.
    expect(summary.accounting.totalComplete).toBe(false);
    // Informe de prueba.
    expect(state.reportText).toContain("Informe de prueba");
  });

  // Escenario 2: una laguna justifica un seguimiento.
  it("2. una laguna concreta justifica una sola ronda de seguimiento", async () => {
    // Ejecuta.
    const { summary, calls } = await run("partial-follow-up");
    // Dos rondas.
    expect(summary.rounds).toBe(2);
    // Consulta de seguimiento.
    expect(summary.followUp?.queries).toEqual([
      { subquestionId: "q2", query: "wrangler vectorize get index dimensions" },
    ]);
    // Completo.
    expect(summary.outcome).toBe("complete");
    // Tres búsquedas.
    expect(summary.counters.searchCalls).toBe(3);
    // Una URL ya leída no se repite.
    expect(summary.discovered.some((item) => item.decision === "already-read")).toBe(true);
    // Etapas del modelo.
    expect(calls.model).toEqual(["plan", "assess", "followUp", "assess", "synthesize"]);
    // Dentro del tope.
    expect(summary.counters.modelCalls).toBeLessThanOrEqual(RESEARCH_LIMITS.maxModelCalls);
  });

  // Escenario 3: descarta lo irrelevante y lo no permitido.
  it("3. descarta evidencia irrelevante, dominios no permitidos e instrucciones embebidas", async () => {
    // Ejecuta.
    const { summary, sources, calls } = await run("irrelevant-discarded");
    // Blog no permitido.
    expect(summary.discovered.find((item) => item.domain === "blog.example.com")?.decision).toBe(
      "not-allowed",
    );
    // No se lee el blog.
    expect(calls.read.some((url) => url.includes("blog.example.com"))).toBe(false);
    // Ni el dominio malicioso.
    expect(calls.read.some((url) => url.includes("evil.example"))).toBe(false);
    // Página con instrucciones embebidas.
    const injected = summary.pagesRead.find((page) => page.instructionsFlagged);
    // Se leyó como dato.
    expect(injected?.status).toBe("ok");
    // Se rechaza por las instrucciones.
    expect(summary.rejected.map((item) => item.reason).join(" ")).toContain("instrucciones");
    // Y D1 por no tratar el tema.
    expect(summary.rejected.map((item) => item.reason).join(" ")).toContain("D1");
    // También se rechaza curso.
    expect(summary.rejected.some((item) => item.kind === "course")).toBe(true);
    // La página inyectada no se cita.
    expect(sources.some((source) => source.sourceId === injected?.sourceId)).toBe(false);
    // Dentro del tope.
    expect(summary.counters.searchCalls).toBeLessThanOrEqual(RESEARCH_LIMITS.maxSearchCalls);
    // Completo.
    expect(summary.outcome).toBe("complete");
  });

  // Escenario 4: un dato interno que falta no se rellena con la web.
  it("4. un dato interno sin documentar queda sin responder y la web no lo rellena", async () => {
    // Pregunta mixta.
    const question =
      "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?";
    // Ejecuta.
    const { summary, sources, state } = await run("internal-fact-missing", question);
    // Cobertura de q1.
    const q1 = summary.coverage.find((entry) => entry.subquestionId === "q1");
    // Sin cubrir.
    expect(q1?.status).toBe("uncovered");
    // Solo se busca q2.
    expect(summary.searches.every((item) => item.subquestionId === "q2")).toBe(true);
    // Fuente web.
    const web = summary.accepted.find((item) => item.kind === "web");
    // Solo apoya q2.
    expect(web?.subquestionIds).toEqual(["q2"]);
    // Parcial.
    expect(summary.outcome).toBe("partial");
    // Sin laguna concreta.
    expect(summary.stop).toBe("no-specific-gap");
    // Lista lo que falta.
    expect(state.reportText).toContain("Puntos sin resolver");
    // Menciona la nota.
    expect(state.reportText).toContain("nota mínima");
    // Ninguna fuente apoya q1.
    expect(sources.every((source) => !source.subquestionIds.includes("q1"))).toBe(true);
  });

  // Escenario 5: un fallo operativo no es falta de evidencia.
  it("5. un fallo del buscador y de una lectura no se confunde con falta de evidencia", async () => {
    // Ejecuta.
    const { summary, state, calls } = await run("provider-failure");
    // Búsqueda de q1 con error.
    expect(summary.searches.find((item) => item.subquestionId === "q1")?.status).toBe("error");
    // Lectura con timeout.
    expect(summary.pagesRead.some((page) => page.status === "timeout")).toBe(true);
    // Causa: fallo operativo.
    expect(summary.coverage.find((entry) => entry.subquestionId === "q1")?.cause).toBe(
      "operational-failure",
    );
    // Parada por el proveedor.
    expect(summary.stop).toBe("provider-failure");
    // Sin seguimiento.
    expect(summary.followUp).toBeNull();
    // Dos búsquedas.
    expect(summary.counters.searchCalls).toBe(2);
    // Dos llamadas.
    expect(calls.search).toBe(2);
    // Parcial.
    expect(summary.outcome).toBe("partial");
    // El informe lo explica.
    expect(state.reportText).toContain("fallo operativo, no por falta de evidencia");
  });

  // Escenario 6: sin progreso se detiene.
  it("6. sin progreso se detiene sin otra operación de pago", async () => {
    // Ejecuta.
    const { summary, calls } = await run("no-progress-stop");
    // Dos rondas.
    expect(summary.rounds).toBe(2);
    // Parada sin progreso.
    expect(summary.stop).toBe("no-progress");
    // Tres búsquedas.
    expect(summary.searches).toHaveLength(3);
    // La repetida no se busca otra vez.
    expect(summary.searches.filter((item) => item.query.trim() === MAIN_Q1_QUERY)).toHaveLength(1);
    // Dos lecturas.
    expect(calls.read).toHaveLength(2);
    // Sin segunda evaluación.
    expect(calls.model).toEqual(["plan", "assess", "followUp", "synthesize"]);
    // Parcial.
    expect(summary.outcome).toBe("partial");
  });

  // Escenario 7: citas inválidas no dejan un informe completo.
  it("7. una cita inválida o una conclusión sin apoyo no deja un informe completo", async () => {
    // Ejecuta.
    const { summary, state } = await run("invalid-citation");
    // Parcial.
    expect(summary.outcome).toBe("partial");
    // Motivos de las retiradas.
    const reasons = summary.claimCheck.dropped.map((item) => item.reason).join(" | ");
    // Fuente no admitida.
    expect(reasons).toContain("no admitido");
    // Texto sin relación.
    expect(reasons).toContain("no comparte contenido");
    // Fuente de otra subpregunta.
    expect(reasons).toContain("no apoya esa subpregunta");
    // Sin la fuente inventada.
    expect(state.reportText).not.toContain("web-000000000000");
    // Sin la afirmación falsa.
    expect(state.reportText).not.toContain("reiniciar el navegador");
  });

  // Escenario 8: la herramienta responde sin búsquedas.
  it("8. un dato interno usa la herramienta de solo lectura sin búsquedas externas", async () => {
    // Pregunta de sesión.
    const question = "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?";
    // Ejecuta con M/J.
    const { summary, sources, calls } = await run("course-tool", question, "M/J");
    // Ruta tool.
    expect(summary.route).toBe("tool");
    // Sin búsquedas.
    expect(calls.search).toBe(0);
    // Sin lecturas.
    expect(calls.read).toHaveLength(0);
    // Una llamada.
    expect(summary.toolCalls).toHaveLength(1);
    // Argumentos.
    expect(summary.toolCalls[0]?.args).toEqual({ sessionId: "S12", audience: "M/J" });
    // Fuente de la herramienta.
    const tool = sources.find((source) => source.kind === "tool");
    // Respaldada por el calendario.
    expect(tool?.kind === "tool" ? tool.backingSourceIds : []).toContain(
      `${corpus}:calendario-mj:12`,
    );
    // Con la fecha.
    expect(tool?.excerpts.join(" ")).toContain("2026-10-29");
    // Respuesta del curso.
    expect(summary.stop).toBe("course-answer");
    // Completo.
    expect(summary.outcome).toBe("complete");
  });

  // Calendario sin grupo: aclaración sin plan.
  it("pide grupo para una pregunta de calendario en General sin planificar", async () => {
    // Ejecuta.
    const { summary, calls } = await run(
      null,
      "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?",
    );
    // Aclaración.
    expect(summary.outcome).toBe("clarify");
    // Sin modelo.
    expect(calls.model).toEqual([]);
  });

  // Pregunta libre: solo el curso.
  it("una pregunta libre del curso no fuerza búsquedas externas", async () => {
    // Ejecuta.
    const { summary, calls } = await run(
      null,
      "¿Cómo modela LangGraph un agente con estado y nodos?",
    );
    // Ruta course.
    expect(summary.route).toBe("course");
    // Sin búsquedas.
    expect(calls.search).toBe(0);
    // Completo o parcial.
    expect(["complete", "partial"]).toContain(summary.outcome);
  });

  // Una nota inventada se retira aunque cite una página técnica.
  it("no muestra una nota inventada citada solo con una página técnica", async () => {
    // Pregunta mixta.
    const question =
      "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?";
    // Síntesis que inventa la nota.
    const { summary, state } = await run("internal-fact-missing", question, "program", (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        synthesize: async (input, context) => {
          // Informe original.
          const base = await ports.model.synthesize(input, context);
          // Fuente web.
          const web = input.evidence.find((item) => item.kind === "web");
          // Sustituye la respuesta por una inventada.
          return base.ok
            ? {
                ...base,
                value: {
                  ...(base.value as Record<string, unknown>),
                  answer: {
                    text: "El curso exige nota mínima 9 para el ejercicio con LangGraph checkpointer.",
                    sourceIds: web === undefined ? [] : [web.sourceId],
                  },
                },
              }
            : base;
        },
      },
    }));
    // q1 sigue sin cubrir.
    expect(summary.coverage.find((entry) => entry.subquestionId === "q1")?.status).toBe(
      "uncovered",
    );
    // No completo.
    expect(summary.outcome).not.toBe("complete");
    // Sin la nota inventada.
    expect(state.reportText).not.toContain("nota mínima 9");
    // Retirada en la verificación.
    expect(summary.claimCheck.dropped.some((item) => item.claim.includes("nota mínima 9"))).toBe(
      true,
    );
  });

  // Una contradicción abre seguimiento y no cierra el informe.
  it("una contradicción sin resolver no cierra el informe y abre seguimiento", async () => {
    // Texto de la contradicción.
    const text =
      "Una fuente dice que la dimensión no se puede cambiar y otra dice que sí se puede.";
    // Evaluación que siempre la añade.
    const { summary, state, calls } = await run(
      "sufficient-first-round",
      undefined,
      "program",
      (ports) => ({
        ...ports,
        model: {
          ...ports.model,
          assess: async (input, context) => {
            // Evaluación original.
            const base = await ports.model.assess(input, context);
            // Con la contradicción.
            return base.ok
              ? {
                  ...base,
                  value: { ...(base.value as Record<string, unknown>), contradictions: [text] },
                }
              : base;
          },
        },
      }),
    );
    // Hubo seguimiento.
    expect(calls.model).toContain("followUp");
    // Dentro del tope.
    expect(calls.model.length).toBeLessThanOrEqual(RESEARCH_LIMITS.maxModelCalls);
    // Como mucho dos evaluaciones.
    expect(calls.model.filter((item) => item === "assess").length).toBeLessThanOrEqual(2);
    // Parada por contradicción.
    expect(summary.stop).toBe("unresolved-contradiction");
    // No completo.
    expect(summary.outcome).not.toBe("complete");
    // El informe la muestra.
    expect(state.reportText).toContain(text);
    // Avisa de que no es completo.
    expect(state.reportText).toContain("No es un informe completo");
  });

  // La segunda evaluación ve la evidencia acumulada.
  it("la segunda evaluación recibe la evidencia acumulada y la cobertura previa", async () => {
    // Lo que vio cada evaluación.
    const seen: { ids: string[]; accepted: string[]; prior: string[] }[] = [];
    // Evaluación que registra su entrada.
    const { summary } = await run("partial-follow-up", undefined, "program", (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        assess: async (input, context) => {
          // Evaluación original.
          const result = await ports.model.assess(input, context);
          // Cuerpo de la evaluación.
          const body =
            result.ok && typeof result.value === "object" && result.value !== null
              ? (result.value as { items?: { sourceId?: string; decision?: string }[] })
              : {};
          // Registra ids, aceptados y cobertura previa.
          seen.push({
            ids: input.evidence.map((item) => item.sourceId),
            accepted: (body.items ?? [])
              .filter((item) => item.decision === "accept" && typeof item.sourceId === "string")
              .map((item) => item.sourceId ?? ""),
            prior: input.priorCoverage.map((item) => `${item.subquestionId}:${item.status}`),
          });
          // Resultado.
          return result;
        },
      },
    }));
    // Dos evaluaciones.
    expect(seen).toHaveLength(2);
    // Primera.
    const first = seen[0];
    // Segunda.
    const second = seen[1];
    // Existe.
    expect(first).toBeDefined();
    // Existe.
    expect(second).toBeDefined();
    // La primera aceptó algo.
    expect(first?.accepted.length).toBeGreaterThan(0);
    // La segunda recibe la cobertura previa.
    expect(second?.prior.some((item) => item.startsWith("q1:"))).toBe(true);
    // Aceptados que no vio la segunda.
    const missing = (first?.accepted ?? []).filter((id) => !second?.ids.includes(id));
    // Ninguno.
    expect(missing).toEqual([]);
    // La segunda ve más.
    expect((second?.ids.length ?? 0) > (first?.accepted.length ?? 0)).toBe(true);
    // Completo.
    expect(summary.outcome).toBe("complete");
  });

  // Fallo de la herramienta: error operativo.
  it("un fallo de la herramienta no se informa como falta de evidencia", async () => {
    // Pregunta de sesión.
    const question = "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?";
    // Herramienta que falla.
    const { summary, state } = await run("course-tool", question, "M/J", (ports) => ({
      ...ports,
      tool: {
        getCourseSession: () =>
          Promise.resolve({
            ok: false as const,
            error: "provider" as const,
            detail: "catalog unavailable",
            consumption: { kind: "none" as const },
          }),
      },
    }));
    // Error.
    expect(summary.toolCalls[0]?.status).toBe("error");
    // Causa operativa.
    expect(summary.coverage[0]?.cause).toBe("operational-failure");
    // Parada por el proveedor.
    expect(summary.stop).toBe("provider-failure");
    // Error.
    expect(summary.outcome).toBe("error");
    // Lo dice.
    expect(state.reportText).toContain("fallo operativo");
    // No lo presenta como falta de evidencia.
    expect(state.reportText).not.toContain("No consta en el material");
  });

  // Herramienta sin el dato: falta de evidencia.
  it("una herramienta que responde sin el dato sí es falta de evidencia", async () => {
    // Pregunta de sesión.
    const question = "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?";
    // Herramienta que no encuentra la ficha.
    const { summary, state } = await run("course-tool", question, "M/J", (ports) => ({
      ...ports,
      tool: {
        getCourseSession: () =>
          Promise.resolve({
            ok: true as const,
            value: null,
            consumption: { kind: "none" as const },
          }),
      },
    }));
    // Rechazada.
    expect(summary.toolCalls[0]?.status).toBe("rejected");
    // Causa: falta de evidencia.
    expect(summary.coverage[0]?.cause).toBe("missing-evidence");
    // Rechazo.
    expect(summary.outcome).toBe("refused");
    // No consta.
    expect(state.reportText).toContain("No consta");
  });

  // La cancelación no espera a un adaptador lento.
  it("la cancelación no espera a un adaptador que ignora la señal", async () => {
    // Controlador.
    const controller = new AbortController();
    // Si el plan llegó a resolverse.
    let resolved = false;
    // Si se llamó al plan.
    let entered = false;
    // Evaluaciones.
    let assessCalls = 0;
    // Puertos de prueba.
    const base = createFixtureResearchPorts({
      signal: controller.signal,
      scenarioId: "sufficient-first-round",
      audience: "program",
      corpusVersion: corpus,
    });
    // Puertos medidos con un plan lento que ignora la señal.
    const ports: ResearchPorts = {
      ...base,
      measured: true,
      model: {
        ...base.model,
        plan: () => {
          // Marca la entrada.
          entered = true;
          // Promesa que tarda 220 ms.
          return new Promise((resolve) => {
            // Temporizador.
            setTimeout(() => {
              // Marca.
              resolved = true;
              // Resuelve tarde.
              resolve({
                ok: true,
                value: {
                  route: "clarify",
                  rationale: "tarde",
                  clarification: "tarde",
                  subquestions: [],
                  tool: null,
                },
                consumption: { kind: "reported", usd: 1, credits: null },
              });
            }, 220);
          });
        },
        assess: (input, context) => {
          // Cuenta.
          assessCalls += 1;
          // Evaluación normal.
          return base.model.assess(input, context);
        },
      },
    };
    // Inicio.
    const started = Date.now();
    // Ejecuta el grafo.
    const pending = runResearchGraph(
      request(DEMO_RESEARCH_QUESTION, "sufficient-first-round"),
      ports,
    );
    // Espera a que entre en el plan.
    while (!entered) {
      // 1 ms.
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    // Cancela.
    controller.abort();
    // Espera el resultado.
    const state = await pending;
    // Tiempo transcurrido.
    const elapsed = Date.now() - started;
    // No esperó al plan.
    expect(resolved).toBe(false);
    // Menos de 180 ms.
    expect(elapsed).toBeLessThan(180);
    // Cancelado.
    expect(state.outcome).toBe("aborted");
    // Parada aborted.
    expect(state.stop).toBe("aborted");
    // Sin evaluar.
    expect(assessCalls).toBe(0);
    // Cargo desconocido.
    expect(state.ledger.unknownCalls).toBeGreaterThan(0);
    // Sin importe informado.
    expect(state.ledger.reportedUsd).toBeNull();
  });
});

// Grupo: contabilidad.
describe("contabilidad de la investigación", () => {
  // Resumen con un libro concreto.
  function summarize(ledger: ReturnType<typeof emptyLedger>) {
    // Estado inicial.
    const state = initialResearchState(request(DEMO_RESEARCH_QUESTION, null), 0);
    // Libro.
    state.ledger = ledger;
    // Parada.
    state.stop = "all-covered";
    // Completo.
    state.outcome = "complete";
    // Resumen medido.
    return researchSummary(state, {
      measured: true,
      fixture: false,
      estimatedMaxUsd: 1.25,
      now: () => 20,
    });
  }

  // Créditos sin USD: total incompleto.
  it("los créditos sin USD no completan el total monetario", () => {
    // Libro con créditos.
    const summary = summarize(
      addConsumption(emptyLedger(), { kind: "reported", usd: null, credits: 2 }),
    );
    // Sin USD.
    expect(summary.accounting.providerReportedUsd).toBeNull();
    // 2 créditos.
    expect(summary.accounting.providerReportedCredits).toBe(2);
    // Sin desconocidos.
    expect(summary.accounting.unknownConsumptionCalls).toBe(0);
    // Incompleto.
    expect(summary.accounting.totalComplete).toBe(false);
    // Tope estimado.
    expect(summary.accounting.estimatedMaxUsd).toBe(1.25);
  });

  // USD, créditos y desconocido juntos.
  it("mezcla USD conocido, créditos sin conversión y consumo desconocido", () => {
    // Libro con tres consumos.
    const ledger = addConsumption(
      addConsumption(
        addConsumption(emptyLedger(), { kind: "reported", usd: 0.02, credits: null }),
        { kind: "reported", usd: null, credits: 2 },
      ),
      { kind: "unknown" },
    );
    // Resumen.
    const summary = summarize(ledger);
    // 0,02 USD.
    expect(summary.accounting.providerReportedUsd).toBeCloseTo(0.02);
    // 2 créditos.
    expect(summary.accounting.providerReportedCredits).toBe(2);
    // Un desconocido.
    expect(summary.accounting.unknownConsumptionCalls).toBe(1);
    // Incompleto.
    expect(summary.accounting.totalComplete).toBe(false);
    // La nota lo explica.
    expect(summary.accounting.note).toContain("desconocido");
  });
});
