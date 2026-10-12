// GUÍA DE LECTURA · packages/research/src/evidence.test.ts
// Pruebas de la reconciliación de cobertura: una subpregunta con apoyo admitido no se pierde, una
// bajada a parcial con apoyo se respeta y sin evidencia la subpregunta queda sin cubrir.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Función y tipos de evidencia.
import { reconcileCoverage, type AcceptedEvidence, type CoverageEntry } from "./evidence";
// Tipo de subpregunta.
import type { PlanItem } from "./plan";
// Tipo de evidencia web.
import type { WebEvidence } from "./ports";

// Subpregunta técnica de prueba.
const sub: PlanItem = {
  id: "q1",
  text: "Qué significa el desajuste de dimensión.",
  kind: "technical",
  external: true,
  query: "dimension mismatch",
};

// Evidencia web aceptada de prueba.
function accepted(sourceId: string): AcceptedEvidence {
  // Página leída de prueba.
  const item: WebEvidence = {
    kind: "web",
    sourceId,
    requestedUrl: "https://developers.cloudflare.com/vectorize/",
    url: "https://developers.cloudflare.com/vectorize/",
    domain: "developers.cloudflare.com",
    title: "Vectorize",
    text: "La dimensión del índice no se puede cambiar después de crearlo.",
    retrievedAt: "2026-10-10T00:00:00.000Z",
    publishedAt: null,
    contentHash: `sha256:${"b".repeat(64)}`,
    fixture: true,
  };
  // Evidencia aceptada con su extracto literal.
  return {
    item,
    subquestionIds: ["q1"],
    excerpts: ["La dimensión del índice no se puede cambiar después de crearlo."],
    reason: "Explica la dimensión fija.",
    round: 1,
  };
}

// Cobertura anterior: cubierta por web-a.
const previous: CoverageEntry = {
  subquestionId: "q1",
  status: "covered",
  gap: null,
  followUp: false,
  sourceIds: ["web-a"],
};

// Grupo de pruebas de la reconciliación.
describe("reconciliación de cobertura", () => {
  // Si el apoyo sigue admitido, sigue cubierta aunque el evaluador diga lo contrario.
  it("mantiene cubierta una subpregunta cuyo apoyo sigue admitido", () => {
    // Propuesta sin cubrir con la evidencia aún admitida.
    const result = reconcileCoverage(
      [{ ...previous, status: "uncovered", gap: "El evaluador no la vio.", followUp: true }],
      [previous],
      [accepted("web-a")],
      [sub],
      new Set(["web-a"]),
    );
    // Sigue cubierta.
    expect(result[0]?.status).toBe("covered");
    // Con su fuente.
    expect(result[0]?.sourceIds).toEqual(["web-a"]);
  });

  // Una bajada a parcial propuesta con apoyo se acepta.
  it("acepta una bajada a parcial cuando el evaluador la propone con apoyo", () => {
    // Propuesta parcial con laguna concreta.
    const result = reconcileCoverage(
      [
        {
          subquestionId: "q1",
          status: "partial",
          gap: "Falta el comando de lectura.",
          followUp: true,
          sourceIds: ["web-a"],
        },
      ],
      [previous],
      [accepted("web-a")],
      [sub],
      new Set(["web-a"]),
    );
    // Parcial.
    expect(result[0]?.status).toBe("partial");
    // Con seguimiento.
    expect(result[0]?.followUp).toBe(true);
  });

  // Sin evidencia admitida queda sin cubrir.
  it("deja sin cubrir la subpregunta si la evidencia anterior se rechazó", () => {
    // Ninguna evidencia aceptada.
    const result = reconcileCoverage(
      [
        {
          subquestionId: "q1",
          status: "uncovered",
          gap: "La página ya no apoya la pregunta.",
          followUp: false,
          sourceIds: [],
        },
      ],
      [previous],
      [],
      [sub],
      new Set(["web-a"]),
    );
    // Sin cubrir.
    expect(result[0]?.status).toBe("uncovered");
    // Sin fuentes.
    expect(result[0]?.sourceIds).toEqual([]);
  });
});
