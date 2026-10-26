// GUÍA DE LECTURA · packages/research/src/policy.test.ts
// Pruebas de la política: causa de una laguna cuando falla la herramienta, y decisiones de parada
// o seguimiento con contradicciones.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Tipo de cobertura.
import type { CoverageEntry } from "./evidence";
// Tipo de subpregunta.
import type { PlanItem } from "./plan";
// Funciones de la política.
import { attributeCause, decideNext, emptyCounters } from "./policy";

// Subpregunta sobre un pedido.
const order: PlanItem = {
  id: "q1",
  text: "Pago y fecha de entrega del pedido TPS-20481.",
  kind: "order",
  external: false,
  query: null,
};

// Subpregunta externa.
const external: PlanItem = {
  id: "q1",
  text: "Qué dice la normativa europea sobre el desistimiento.",
  kind: "external",
  external: true,
  query: "derecho de desistimiento UE",
};

// Cobertura completa de q1.
const covered: CoverageEntry = {
  subquestionId: "q1",
  status: "covered",
  gap: null,
  followUp: false,
  sourceIds: ["s"],
};

// Grupo de pruebas de la causa de una laguna.
describe("causa de una laguna", () => {
  // Un error de la herramienta es un fallo operativo.
  it("un fallo de la herramienta de pedidos es operativo aunque no haya consulta a las políticas", () => {
    // Herramienta con error.
    expect(
      attributeCause(order, "uncovered", {
        searches: [],
        reads: [],
        store: [],
        tools: [{ status: "error" }],
      }),
    ).toBe("operational-failure");
  });

  // Una herramienta que rechaza la petición no es un fallo: falta el dato.
  it("una herramienta que responde sin el dato es falta de evidencia", () => {
    // Herramienta que rechaza.
    expect(
      attributeCause(order, "uncovered", {
        searches: [],
        reads: [],
        store: [],
        tools: [{ status: "rejected" }],
      }),
    ).toBe("missing-evidence");
  });
});

// Grupo de pruebas de contradicciones y parada.
describe("contradicciones y parada", () => {
  // Datos comunes: todo cubierto, dos llamadas al modelo y tiempo de sobra.
  const base = {
    subquestions: [external],
    coverage: [covered],
    causes: { q1: "evidence" as const },
    counters: { ...emptyCounters(), modelCalls: 2 },
    remaining: 90_000,
    newAccepted: 1,
  };

  // Con todo cubierto y una contradicción, hay seguimiento si queda margen.
  it("con todo cubierto y una contradicción pide seguimiento dentro del presupuesto", () => {
    // Primera ronda con contradicción.
    const next = decideNext({ ...base, round: 1, contradictions: ["Las fuentes discrepan."] });
    // Seguimiento.
    expect(next.kind).toBe("follow-up");
  });

  // En la última ronda no se cierra como completa.
  it("en la última ronda una contradicción no se declara como cobertura completa", () => {
    // Segunda ronda con contradicción.
    const next = decideNext({ ...base, round: 2, contradictions: ["Las fuentes discrepan."] });
    // Parada por contradicción.
    expect(next).toMatchObject({ kind: "stop", stop: "unresolved-contradiction" });
  });

  // Sin contradicción, todo cubierto cierra la investigación.
  it("sin contradicción, la cobertura completa sí cierra", () => {
    // Primera ronda sin contradicción.
    const next = decideNext({ ...base, round: 1, contradictions: [] });
    // Parada con éxito.
    expect(next).toMatchObject({ kind: "stop", stop: "all-covered" });
  });
});
