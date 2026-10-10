import { describe, expect, it } from "vite-plus/test";
import type { CoverageEntry } from "./evidence";
import type { PlanItem } from "./plan";
import { attributeCause, decideNext, emptyCounters } from "./policy";

const session: PlanItem = {
  id: "q1",
  text: "Fecha y ejercicio de la sesión 12.",
  kind: "session",
  external: false,
  query: null,
};

const technical: PlanItem = {
  id: "q1",
  text: "Qué dimensión tiene el índice.",
  kind: "technical",
  external: true,
  query: "vectorize dimensions",
};

const covered: CoverageEntry = {
  subquestionId: "q1",
  status: "covered",
  gap: null,
  followUp: false,
  sourceIds: ["s"],
};

describe("causa de una laguna", () => {
  it("un fallo de la herramienta de sesión es operativo aunque no haya consulta al curso", () => {
    expect(
      attributeCause(session, "uncovered", {
        searches: [],
        reads: [],
        course: [],
        tools: [{ status: "error" }],
      }),
    ).toBe("operational-failure");
  });

  it("una herramienta que responde sin el dato es falta de evidencia", () => {
    expect(
      attributeCause(session, "uncovered", {
        searches: [],
        reads: [],
        course: [],
        tools: [{ status: "rejected" }],
      }),
    ).toBe("missing-evidence");
  });
});

describe("contradicciones y parada", () => {
  const base = {
    subquestions: [technical],
    coverage: [covered],
    causes: { q1: "evidence" as const },
    counters: { ...emptyCounters(), modelCalls: 2 },
    remaining: 90_000,
    newAccepted: 1,
  };

  it("con todo cubierto y una contradicción pide seguimiento dentro del presupuesto", () => {
    const next = decideNext({ ...base, round: 1, contradictions: ["Las fuentes discrepan."] });
    expect(next.kind).toBe("follow-up");
  });

  it("en la última ronda una contradicción no se declara como cobertura completa", () => {
    const next = decideNext({ ...base, round: 2, contradictions: ["Las fuentes discrepan."] });
    expect(next).toMatchObject({ kind: "stop", stop: "unresolved-contradiction" });
  });

  it("sin contradicción, la cobertura completa sí cierra", () => {
    const next = decideNext({ ...base, round: 1, contradictions: [] });
    expect(next).toMatchObject({ kind: "stop", stop: "all-covered" });
  });
});
