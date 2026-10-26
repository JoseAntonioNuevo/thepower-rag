// GUÍA DE LECTURA · apps/api/src/research-graph.test.ts
// Pruebas del grafo de investigación con los puertos de prueba sobre ThePower Shop: los ocho escenarios
// de la demo, preguntas libres, pedidos de otra cuenta, contradicciones, fallos de la herramienta,
// cancelación y contabilidad del consumo.
// Pregunta de demo, límites, esquema y tipos.
import {
  DEMO_RESEARCH_QUESTION,
  RESEARCH_LIMITS,
  researchSummarySchema,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
// Tipos de puertos y petición.
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
// Funciones de prueba.
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
// Versión del corpus de la tienda de la demo.
import { storeFixtureCorpusVersion } from "./fixture";
// Puertos de prueba, subpregunta de las políticas y consultas principales.
import {
  createFixtureResearchPorts,
  FOLLOW_Q3_QUERY,
  MAIN_Q1,
  STALL_Q3_QUERY,
} from "./research-fixture";
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
const corpus = storeFixtureCorpusVersion();

// Petición de investigación de prueba.
function request(question: string, scenarioId: ResearchScenarioId | null): ResearchRequest {
  // Campos de la petición.
  return {
    runId: "run-test",
    threadId: null,
    question,
    observations: [{ kind: "text", text: question }],
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
  // Consultas a las políticas.
  store: number;
  // Llamadas a la herramienta.
  tool: number;
}

/** Envuelve los puertos para contar llamadas sin cambiar su comportamiento. */
function counted(ports: ResearchPorts): { ports: ResearchPorts; calls: Calls } {
  // Contadores vacíos.
  const calls: Calls = { model: [], search: 0, read: [], store: 0, tool: 0 };
  // Puertos que registran cada llamada y delegan.
  return {
    // Registro de llamadas por tipo.
    calls,
    ports: {
      ...ports,
      // Cada método anota la llamada y delega en el puerto original.
      model: {
        // Doble de prueba: construye el plan de investigación que consumen los nodos posteriores.
        plan: (i, c) => (calls.model.push("plan"), ports.model.plan(i, c)),
        // Doble de prueba: valora la suficiencia de la evidencia y las carencias que quedan por cubrir.
        assess: (i, c) => (calls.model.push("assess"), ports.model.assess(i, c)),
        // Doble de prueba: propone consultas adicionales a partir de las carencias del intento anterior.
        followUp: (i, c) => (calls.model.push("followUp"), ports.model.followUp(i, c)),
        // Doble de prueba: compone el informe a partir de la evidencia reunida y las subpreguntas del plan.
        synthesize: (i, c) => (calls.model.push("synthesize"), ports.model.synthesize(i, c)),
      },
      // Búsqueda, lectura, políticas y herramienta, con el mismo patrón.
      search: {
        // Doble de prueba: busca candidatos para la consulta con los límites y el transporte de este adaptador.
        search: (i, c) => ((calls.search += 1), ports.search.search(i, c)),
      },
      reader: {
        // Doble de prueba: lee el recurso solicitado y devuelve el resultado de este adaptador al consumidor.
        read: (i, c) => (calls.read.push(i.url), ports.reader.read(i, c)),
      },
      store: {
        // Doble de prueba: recupera fragmentos de las políticas para la consulta del recorrido.
        retrieve: (i, c) => ((calls.store += 1), ports.store.retrieve(i, c)),
      },
      tool: {
        // Doble de prueba: lee un pedido de la cuenta de la conversación.
        getOrder: (i, c) => ((calls.tool += 1), ports.tool.getOrder(i, c)),
      },
    },
  };
}

// Ejecuta el grafo con un escenario y devuelve estado, resumen y llamadas.
async function run(
  scenario: ResearchScenarioId | null,
  question = DEMO_RESEARCH_QUESTION,
  tweak?: (ports: ResearchPorts) => ResearchPorts,
) {
  // Controlador de cancelación.
  const controller = new AbortController();
  // Puertos de prueba.
  const base = createFixtureResearchPorts({
    signal: controller.signal,
    scenarioId: scenario,
    corpusVersion: corpus,
  });
  // Puertos contados, con un cambio opcional.
  const { ports, calls } = counted(tweak ? tweak(base) : base);
  // Ejecuta el grafo.
  const state = await runResearchGraph(request(question, scenario), ports);
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
    // Una búsqueda: solo la subpregunta de la normativa.
    expect(summary.counters.searchCalls).toBe(1);
    // Tres páginas.
    expect(summary.counters.pagesRead).toBe(3);
    // La herramienta lee el pedido de la pregunta.
    expect(summary.toolCalls.map((item) => item.args)).toEqual([{ orderId: "TPS-20481" }]);
    // Plan, evaluación y síntesis.
    expect(calls.model).toEqual(["plan", "assess", "synthesize"]);
    // Tipos de fuente.
    const kinds = new Set(sources.map((source) => source.kind));
    // Políticas, pedido y web.
    expect(kinds).toEqual(new Set(["store", "tool", "web"]));
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
    expect(summary.followUp?.queries).toEqual([{ subquestionId: "q3", query: FOLLOW_Q3_QUERY }]);
    // Completo.
    expect(summary.outcome).toBe("complete");
    // Dos búsquedas: la inicial y la de seguimiento.
    expect(summary.counters.searchCalls).toBe(2);
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
    // Y la de pasajeros aéreos por no tratar el tema.
    expect(summary.rejected.map((item) => item.reason).join(" ")).toContain("pasajeros");
    // También se rechaza una política que no trata devoluciones.
    expect(summary.rejected.some((item) => item.kind === "store")).toBe(true);
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
      "¿Qué descuento hace ThePower Shop a los estudiantes? Y, según la normativa europea, ¿quién paga el envío de una devolución por desistimiento?";
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
    // Menciona el descuento que falta.
    expect(state.reportText).toContain("descuento para estudiantes");
    // Ninguna fuente apoya q1.
    expect(sources.every((source) => !source.subquestionIds.includes("q1"))).toBe(true);
  });

  // Escenario 5: un fallo operativo no es falta de evidencia.
  it("5. un fallo del buscador y de una lectura no se confunde con falta de evidencia", async () => {
    // Ejecuta.
    const { summary, state, calls } = await run("provider-failure");
    // Búsqueda de q2 con error.
    expect(summary.searches.find((item) => item.subquestionId === "q2")?.status).toBe("error");
    // Lectura con timeout.
    expect(summary.pagesRead.some((page) => page.status === "timeout")).toBe(true);
    // Causa: fallo operativo en las dos subpreguntas externas.
    for (const id of ["q2", "q3"]) {
      // Fallo operativo.
      expect(summary.coverage.find((entry) => entry.subquestionId === id)?.cause).toBe(
        "operational-failure",
      );
    }
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
    // Dos búsquedas: la inicial y la que no avanza.
    expect(summary.searches.map((item) => item.query)).toContain(STALL_Q3_QUERY);
    expect(summary.searches).toHaveLength(2);
    // La consulta repetida a las políticas no se hace otra vez.
    expect(summary.storeQueries.filter((item) => item.query.trim() === MAIN_Q1)).toHaveLength(1);
    // Una lectura: la página que vuelve a salir ya estaba leída.
    expect(calls.read).toHaveLength(1);
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
    expect(state.reportText).not.toContain("reiniciar el teléfono");
  });

  // Escenario 8: la herramienta responde sin búsquedas.
  it("8. un dato de un pedido usa la herramienta de solo lectura sin búsquedas externas", async () => {
    // Pregunta sobre un pedido.
    const question = "¿En qué estado está mi pedido TPS-20481 y cómo lo pagué?";
    // Ejecuta.
    const { summary, sources, calls } = await run("order-tool", question);
    // Ruta tool.
    expect(summary.route).toBe("tool");
    // Sin búsquedas.
    expect(calls.search).toBe(0);
    // Sin lecturas.
    expect(calls.read).toHaveLength(0);
    // Una llamada.
    expect(summary.toolCalls).toHaveLength(1);
    // Argumentos.
    expect(summary.toolCalls[0]?.args).toEqual({ orderId: "TPS-20481" });
    // Fuente de la herramienta.
    const tool = sources.find((source) => source.kind === "tool");
    // Con la versión de los datos de pedidos.
    expect(tool?.kind === "tool" ? tool.dataVersion : null).toBe("pedidos-2026-10-26");
    // Con el pago y la entrega.
    expect(tool?.excerpts.join(" ")).toContain("Pago: Bizum.");
    expect(tool?.excerpts.join(" ")).toContain("Entrega: 20/10/2026.");
    // Respuesta de las políticas y la herramienta, sin web.
    expect(summary.stop).toBe("store-answer");
    // Completo.
    expect(summary.outcome).toBe("complete");
  });

  // Pedido de otra cuenta: la herramienta lo rechaza sin enseñar sus datos.
  it("rechaza el pedido de otra cuenta sin enseñar sus datos", async () => {
    // Ejecuta con un pedido que pertenece a otra cuenta.
    const { summary, sources, state, calls } = await run(
      null,
      "¿En qué estado está el pedido TPS-30117?",
    );
    // Una llamada rechazada.
    expect(summary.toolCalls).toHaveLength(1);
    expect(summary.toolCalls[0]?.status).toBe("rejected");
    // El motivo es la cuenta.
    expect(summary.toolCalls[0]?.detail).toContain("no pertenece a la cuenta");
    // Ninguna fuente de la herramienta.
    expect(sources.some((source) => source.kind === "tool")).toBe(false);
    // El informe no enseña el producto de ese pedido.
    expect(state.reportText).not.toContain("Portátil");
    // Sin búsquedas.
    expect(calls.search).toBe(0);
  });

  // Pregunta libre: solo las políticas.
  it("una pregunta libre sobre la tienda no fuerza búsquedas externas", async () => {
    // Ejecuta.
    const { summary, calls } = await run(null, "¿Cuánto cuesta ThePower Shop Plus al año?");
    // Ruta store.
    expect(summary.route).toBe("store");
    // Sin búsquedas.
    expect(calls.search).toBe(0);
    // Completo o parcial.
    expect(["complete", "partial"]).toContain(summary.outcome);
  });

  // Un descuento inventado se retira aunque cite una página externa.
  it("no muestra un descuento inventado citado solo con una página externa", async () => {
    // Pregunta mixta.
    const question =
      "¿Qué descuento hace ThePower Shop a los estudiantes? Y, según la normativa europea, ¿quién paga el envío de una devolución por desistimiento?";
    // Síntesis que inventa el descuento.
    const { summary, state } = await run("internal-fact-missing", question, (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        // Doble de prueba: compone el informe a partir de la evidencia reunida y las subpreguntas del plan.
        synthesize: async (input, context) => {
          // Informe original.
          const base = await ports.model.synthesize(input, context);
          // Fuente web.
          const web = input.evidence.find((item) => item.kind === "web");
          // Sustituye la respuesta por una inventada.
          return base.ok
            ? // Copia el resultado correcto…
              {
                ...base,
                value: {
                  ...(base.value as Record<string, unknown>),
                  // …pero cambia la respuesta por una afirmación inventada que cita la página web.
                  answer: {
                    text: "ThePower Shop hace un 20 % de descuento a los estudiantes en la devolución.",
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
    // Sin el descuento inventado.
    expect(state.reportText).not.toContain("20 % de descuento");
    // Retirado en la verificación.
    expect(
      summary.claimCheck.dropped.some((item) => item.claim.includes("20 % de descuento")),
    ).toBe(true);
  });

  // Una contradicción abre seguimiento y no cierra el informe.
  it("una contradicción sin resolver no cierra el informe y abre seguimiento", async () => {
    // Texto de la contradicción.
    const text =
      "Una fuente dice que el plazo de desistimiento es de 14 días y otra dice que es de 30 días.";
    // Evaluación que siempre la añade.
    const { summary, state, calls } = await run("sufficient-first-round", undefined, (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        // Doble de prueba: valora la suficiencia de la evidencia y las carencias que quedan por cubrir.
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
    }));
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
    const { summary } = await run("partial-follow-up", undefined, (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        // Doble de prueba: valora la suficiencia de la evidencia y las carencias que quedan por cubrir.
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
    // Pregunta sobre un pedido.
    const question = "¿En qué estado está mi pedido TPS-20481 y cómo lo pagué?";
    // Herramienta que falla.
    const { summary, state } = await run("order-tool", question, (ports) => ({
      ...ports,
      tool: {
        // Doble de prueba: lee un pedido de la cuenta de la conversación.
        getOrder: () =>
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
    expect(state.reportText).not.toContain("No consta en las políticas");
  });

  // Herramienta sin el dato: falta de evidencia.
  it("una herramienta que responde sin el dato sí es falta de evidencia", async () => {
    // Pregunta sobre un pedido.
    const question = "¿En qué estado está mi pedido TPS-20481 y cómo lo pagué?";
    // Herramienta que no encuentra el pedido.
    const { summary, state } = await run("order-tool", question, (ports) => ({
      ...ports,
      tool: {
        // Doble de prueba: lee un pedido de la cuenta de la conversación.
        getOrder: () =>
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
      corpusVersion: corpus,
    });
    // Puertos medidos con un plan lento que ignora la señal.
    const ports: ResearchPorts = {
      ...base,
      measured: true,
      model: {
        ...base.model,
        // Doble de prueba: construye el plan de investigación que consumen los nodos posteriores.
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
                // Plan que llega después del plazo: el grafo no debe aceptarlo.
                ok: true,
                value: {
                  route: "clarify",
                  rationale: "tarde",
                  clarification: "tarde",
                  subquestions: [],
                  tool: null,
                },
                // Con un consumo informado de 1 USD.
                consumption: { kind: "reported", usd: 1, credits: null },
              });
            }, 220);
          });
        },
        // Doble de prueba: valora la suficiencia de la evidencia y las carencias que quedan por cubrir.
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
      // Doble de prueba: proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
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
