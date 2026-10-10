import {
  DEMO_RESEARCH_QUESTION,
  RESEARCH_LIMITS,
  researchSummarySchema,
  type Audience,
  type ResearchScenarioId,
} from "@thepower-rag/contracts";
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { fixtureCorpusVersion } from "./fixture";
import { createFixtureResearchPorts, MAIN_Q1_QUERY } from "./research-fixture";
import { initialResearchState, runResearchGraph } from "./research-graph";
import { addConsumption, emptyLedger } from "./research-state";
import { citedSources, researchSummary } from "./research-summary";

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error("red no permitida en pruebas deterministas");
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const corpus = fixtureCorpusVersion();

function request(
  question: string,
  scenarioId: ResearchScenarioId | null,
  audience: Audience = "program",
): ResearchRequest {
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

interface Calls {
  model: string[];
  search: number;
  read: string[];
  course: number;
  tool: number;
}

/** Envuelve los puertos para contar llamadas sin cambiar su comportamiento. */
function counted(ports: ResearchPorts): { ports: ResearchPorts; calls: Calls } {
  const calls: Calls = { model: [], search: 0, read: [], course: 0, tool: 0 };
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

async function run(
  scenario: ResearchScenarioId | null,
  question = DEMO_RESEARCH_QUESTION,
  audience: Audience = "program",
  tweak?: (ports: ResearchPorts) => ResearchPorts,
) {
  const controller = new AbortController();
  const base = createFixtureResearchPorts({
    signal: controller.signal,
    scenarioId: scenario,
    audience,
    corpusVersion: corpus,
  });
  const { ports, calls } = counted(tweak ? tweak(base) : base);
  const state = await runResearchGraph(request(question, scenario, audience), ports);
  const summary = researchSummarySchema.parse(researchSummary(state, ports));
  return { state, summary, calls, sources: citedSources(state), controller };
}

describe("grafo de investigación con adaptadores de prueba", () => {
  it("1. evidencia suficiente en la primera ronda produce un informe completo", async () => {
    const { summary, sources, state, calls } = await run("sufficient-first-round");
    expect(summary.route).toBe("investigate");
    expect(summary.subquestions).toHaveLength(3);
    expect(summary.originalQuestion).toBe(DEMO_RESEARCH_QUESTION);
    expect(summary.searches.map((item) => item.query)).not.toContain(DEMO_RESEARCH_QUESTION);
    expect(summary.rounds).toBe(1);
    expect(summary.outcome).toBe("complete");
    expect(summary.stop).toBe("all-covered");
    expect(summary.coverage.every((entry) => entry.status === "covered")).toBe(true);
    expect(summary.counters.searchCalls).toBe(2);
    expect(summary.counters.pagesRead).toBe(4);
    expect(calls.model).toEqual(["plan", "assess", "synthesize"]);
    const kinds = new Set(sources.map((source) => source.kind));
    expect(kinds).toEqual(new Set(["course", "web"]));
    expect(sources.map((source) => source.sourceId).sort()).toEqual(
      [...summary.citedSourceIds].sort(),
    );
    const webSources = sources.filter((source) => source.kind === "web");
    expect(webSources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(state.reportText).toContain(`[cite:${source.sourceId}]`);
    }
    for (const source of webSources) {
      expect(source.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(source.publishedAt).toBeNull();
      expect(source.fixture).toBe(true);
      expect(summary.pagesRead.some((page) => page.sourceId === source.sourceId)).toBe(true);
    }
    expect(summary.accounting.measured).toBe(false);
    expect(summary.accounting.totalComplete).toBe(false);
    expect(state.reportText).toContain("Informe de prueba");
  });

  it("2. una laguna concreta justifica una sola ronda de seguimiento", async () => {
    const { summary, calls } = await run("partial-follow-up");
    expect(summary.rounds).toBe(2);
    expect(summary.followUp?.queries).toEqual([
      { subquestionId: "q2", query: "wrangler vectorize get index dimensions" },
    ]);
    expect(summary.outcome).toBe("complete");
    expect(summary.counters.searchCalls).toBe(3);
    expect(summary.discovered.some((item) => item.decision === "already-read")).toBe(true);
    expect(calls.model).toEqual(["plan", "assess", "followUp", "assess", "synthesize"]);
    expect(summary.counters.modelCalls).toBeLessThanOrEqual(RESEARCH_LIMITS.maxModelCalls);
  });

  it("3. descarta evidencia irrelevante, dominios no permitidos e instrucciones embebidas", async () => {
    const { summary, sources, calls } = await run("irrelevant-discarded");
    expect(summary.discovered.find((item) => item.domain === "blog.example.com")?.decision).toBe(
      "not-allowed",
    );
    expect(calls.read.some((url) => url.includes("blog.example.com"))).toBe(false);
    expect(calls.read.some((url) => url.includes("evil.example"))).toBe(false);
    const injected = summary.pagesRead.find((page) => page.instructionsFlagged);
    expect(injected?.status).toBe("ok");
    expect(summary.rejected.map((item) => item.reason).join(" ")).toContain("instrucciones");
    expect(summary.rejected.map((item) => item.reason).join(" ")).toContain("D1");
    expect(summary.rejected.some((item) => item.kind === "course")).toBe(true);
    expect(sources.some((source) => source.sourceId === injected?.sourceId)).toBe(false);
    expect(summary.counters.searchCalls).toBeLessThanOrEqual(RESEARCH_LIMITS.maxSearchCalls);
    expect(summary.outcome).toBe("complete");
  });

  it("4. un dato interno sin documentar queda sin responder y la web no lo rellena", async () => {
    const question =
      "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?";
    const { summary, sources, state } = await run("internal-fact-missing", question);
    const q1 = summary.coverage.find((entry) => entry.subquestionId === "q1");
    expect(q1?.status).toBe("uncovered");
    expect(summary.searches.every((item) => item.subquestionId === "q2")).toBe(true);
    const web = summary.accepted.find((item) => item.kind === "web");
    expect(web?.subquestionIds).toEqual(["q2"]);
    expect(summary.outcome).toBe("partial");
    expect(summary.stop).toBe("no-specific-gap");
    expect(state.reportText).toContain("Puntos sin resolver");
    expect(state.reportText).toContain("nota mínima");
    expect(sources.every((source) => !source.subquestionIds.includes("q1"))).toBe(true);
  });

  it("5. un fallo del buscador y de una lectura no se confunde con falta de evidencia", async () => {
    const { summary, state, calls } = await run("provider-failure");
    expect(summary.searches.find((item) => item.subquestionId === "q1")?.status).toBe("error");
    expect(summary.pagesRead.some((page) => page.status === "timeout")).toBe(true);
    expect(summary.coverage.find((entry) => entry.subquestionId === "q1")?.cause).toBe(
      "operational-failure",
    );
    expect(summary.stop).toBe("provider-failure");
    expect(summary.followUp).toBeNull();
    expect(summary.counters.searchCalls).toBe(2);
    expect(calls.search).toBe(2);
    expect(summary.outcome).toBe("partial");
    expect(state.reportText).toContain("fallo operativo, no por falta de evidencia");
  });

  it("6. sin progreso se detiene sin otra operación de pago", async () => {
    const { summary, calls } = await run("no-progress-stop");
    expect(summary.rounds).toBe(2);
    expect(summary.stop).toBe("no-progress");
    expect(summary.searches).toHaveLength(3);
    expect(summary.searches.filter((item) => item.query.trim() === MAIN_Q1_QUERY)).toHaveLength(1);
    expect(calls.read).toHaveLength(2);
    expect(calls.model).toEqual(["plan", "assess", "followUp", "synthesize"]);
    expect(summary.outcome).toBe("partial");
  });

  it("7. una cita inválida o una conclusión sin apoyo no deja un informe completo", async () => {
    const { summary, state } = await run("invalid-citation");
    expect(summary.outcome).toBe("partial");
    const reasons = summary.claimCheck.dropped.map((item) => item.reason).join(" | ");
    expect(reasons).toContain("no admitido");
    expect(reasons).toContain("no comparte contenido");
    expect(reasons).toContain("no apoya esa subpregunta");
    expect(state.reportText).not.toContain("web-000000000000");
    expect(state.reportText).not.toContain("reiniciar el navegador");
  });

  it("8. un dato interno usa la herramienta de solo lectura sin búsquedas externas", async () => {
    const question = "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?";
    const { summary, sources, calls } = await run("course-tool", question, "M/J");
    expect(summary.route).toBe("tool");
    expect(calls.search).toBe(0);
    expect(calls.read).toHaveLength(0);
    expect(summary.toolCalls).toHaveLength(1);
    expect(summary.toolCalls[0]?.args).toEqual({ sessionId: "S12", audience: "M/J" });
    const tool = sources.find((source) => source.kind === "tool");
    expect(tool?.kind === "tool" ? tool.backingSourceIds : []).toContain(
      `${corpus}:calendario-mj:12`,
    );
    expect(tool?.excerpts.join(" ")).toContain("2026-10-29");
    expect(summary.stop).toBe("course-answer");
    expect(summary.outcome).toBe("complete");
  });

  it("pide grupo para una pregunta de calendario en General sin planificar", async () => {
    const { summary, calls } = await run(
      null,
      "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?",
    );
    expect(summary.outcome).toBe("clarify");
    expect(calls.model).toEqual([]);
  });

  it("una pregunta libre del curso no fuerza búsquedas externas", async () => {
    const { summary, calls } = await run(
      null,
      "¿Cómo modela LangGraph un agente con estado y nodos?",
    );
    expect(summary.route).toBe("course");
    expect(calls.search).toBe(0);
    expect(["complete", "partial"]).toContain(summary.outcome);
  });

  it("no muestra una nota inventada citada solo con una página técnica", async () => {
    const question =
      "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?";
    const { summary, state } = await run("internal-fact-missing", question, "program", (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        synthesize: async (input, context) => {
          const base = await ports.model.synthesize(input, context);
          const web = input.evidence.find((item) => item.kind === "web");
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
    expect(summary.coverage.find((entry) => entry.subquestionId === "q1")?.status).toBe(
      "uncovered",
    );
    expect(summary.outcome).not.toBe("complete");
    expect(state.reportText).not.toContain("nota mínima 9");
    expect(summary.claimCheck.dropped.some((item) => item.claim.includes("nota mínima 9"))).toBe(
      true,
    );
  });

  it("una contradicción sin resolver no cierra el informe y abre seguimiento", async () => {
    const text =
      "Una fuente dice que la dimensión no se puede cambiar y otra dice que sí se puede.";
    const { summary, state, calls } = await run(
      "sufficient-first-round",
      undefined,
      "program",
      (ports) => ({
        ...ports,
        model: {
          ...ports.model,
          assess: async (input, context) => {
            const base = await ports.model.assess(input, context);
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
    expect(calls.model).toContain("followUp");
    expect(calls.model.length).toBeLessThanOrEqual(RESEARCH_LIMITS.maxModelCalls);
    expect(calls.model.filter((item) => item === "assess").length).toBeLessThanOrEqual(2);
    expect(summary.stop).toBe("unresolved-contradiction");
    expect(summary.outcome).not.toBe("complete");
    expect(state.reportText).toContain(text);
    expect(state.reportText).toContain("No es un informe completo");
  });

  it("la segunda evaluación recibe la evidencia acumulada y la cobertura previa", async () => {
    const seen: { ids: string[]; accepted: string[]; prior: string[] }[] = [];
    const { summary } = await run("partial-follow-up", undefined, "program", (ports) => ({
      ...ports,
      model: {
        ...ports.model,
        assess: async (input, context) => {
          const result = await ports.model.assess(input, context);
          const body =
            result.ok && typeof result.value === "object" && result.value !== null
              ? (result.value as { items?: { sourceId?: string; decision?: string }[] })
              : {};
          seen.push({
            ids: input.evidence.map((item) => item.sourceId),
            accepted: (body.items ?? [])
              .filter((item) => item.decision === "accept" && typeof item.sourceId === "string")
              .map((item) => item.sourceId ?? ""),
            prior: input.priorCoverage.map((item) => `${item.subquestionId}:${item.status}`),
          });
          return result;
        },
      },
    }));
    expect(seen).toHaveLength(2);
    const first = seen[0];
    const second = seen[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.accepted.length).toBeGreaterThan(0);
    expect(second?.prior.some((item) => item.startsWith("q1:"))).toBe(true);
    const missing = (first?.accepted ?? []).filter((id) => !second?.ids.includes(id));
    expect(missing).toEqual([]);
    expect((second?.ids.length ?? 0) > (first?.accepted.length ?? 0)).toBe(true);
    expect(summary.outcome).toBe("complete");
  });

  it("un fallo de la herramienta no se informa como falta de evidencia", async () => {
    const question = "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?";
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
    expect(summary.toolCalls[0]?.status).toBe("error");
    expect(summary.coverage[0]?.cause).toBe("operational-failure");
    expect(summary.stop).toBe("provider-failure");
    expect(summary.outcome).toBe("error");
    expect(state.reportText).toContain("fallo operativo");
    expect(state.reportText).not.toContain("No consta en el material");
  });

  it("una herramienta que responde sin el dato sí es falta de evidencia", async () => {
    const question = "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?";
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
    expect(summary.toolCalls[0]?.status).toBe("rejected");
    expect(summary.coverage[0]?.cause).toBe("missing-evidence");
    expect(summary.outcome).toBe("refused");
    expect(state.reportText).toContain("No consta");
  });

  it("la cancelación no espera a un adaptador que ignora la señal", async () => {
    const controller = new AbortController();
    let resolved = false;
    let entered = false;
    let assessCalls = 0;
    const base = createFixtureResearchPorts({
      signal: controller.signal,
      scenarioId: "sufficient-first-round",
      audience: "program",
      corpusVersion: corpus,
    });
    const ports: ResearchPorts = {
      ...base,
      measured: true,
      model: {
        ...base.model,
        plan: () => {
          entered = true;
          return new Promise((resolve) => {
            setTimeout(() => {
              resolved = true;
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
          assessCalls += 1;
          return base.model.assess(input, context);
        },
      },
    };
    const started = Date.now();
    const pending = runResearchGraph(
      request(DEMO_RESEARCH_QUESTION, "sufficient-first-round"),
      ports,
    );
    while (!entered) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    controller.abort();
    const state = await pending;
    const elapsed = Date.now() - started;
    expect(resolved).toBe(false);
    expect(elapsed).toBeLessThan(180);
    expect(state.outcome).toBe("aborted");
    expect(state.stop).toBe("aborted");
    expect(assessCalls).toBe(0);
    expect(state.ledger.unknownCalls).toBeGreaterThan(0);
    expect(state.ledger.reportedUsd).toBeNull();
  });
});

describe("contabilidad de la investigación", () => {
  function summarize(ledger: ReturnType<typeof emptyLedger>) {
    const state = initialResearchState(request(DEMO_RESEARCH_QUESTION, null), 0);
    state.ledger = ledger;
    state.stop = "all-covered";
    state.outcome = "complete";
    return researchSummary(state, {
      measured: true,
      fixture: false,
      estimatedMaxUsd: 1.25,
      now: () => 20,
    });
  }

  it("los créditos sin USD no completan el total monetario", () => {
    const summary = summarize(
      addConsumption(emptyLedger(), { kind: "reported", usd: null, credits: 2 }),
    );
    expect(summary.accounting.providerReportedUsd).toBeNull();
    expect(summary.accounting.providerReportedCredits).toBe(2);
    expect(summary.accounting.unknownConsumptionCalls).toBe(0);
    expect(summary.accounting.totalComplete).toBe(false);
    expect(summary.accounting.estimatedMaxUsd).toBe(1.25);
  });

  it("mezcla USD conocido, créditos sin conversión y consumo desconocido", () => {
    const ledger = addConsumption(
      addConsumption(
        addConsumption(emptyLedger(), { kind: "reported", usd: 0.02, credits: null }),
        { kind: "reported", usd: null, credits: 2 },
      ),
      { kind: "unknown" },
    );
    const summary = summarize(ledger);
    expect(summary.accounting.providerReportedUsd).toBeCloseTo(0.02);
    expect(summary.accounting.providerReportedCredits).toBe(2);
    expect(summary.accounting.unknownConsumptionCalls).toBe(1);
    expect(summary.accounting.totalComplete).toBe(false);
    expect(summary.accounting.note).toContain("desconocido");
  });
});
