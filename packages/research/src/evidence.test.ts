import { describe, expect, it } from "vite-plus/test";
import { reconcileCoverage, type AcceptedEvidence, type CoverageEntry } from "./evidence";
import type { PlanItem } from "./plan";
import type { WebEvidence } from "./ports";

const sub: PlanItem = {
  id: "q1",
  text: "Qué significa el desajuste de dimensión.",
  kind: "technical",
  external: true,
  query: "dimension mismatch",
};

function accepted(sourceId: string): AcceptedEvidence {
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
  return {
    item,
    subquestionIds: ["q1"],
    excerpts: ["La dimensión del índice no se puede cambiar después de crearlo."],
    reason: "Explica la dimensión fija.",
    round: 1,
  };
}

const previous: CoverageEntry = {
  subquestionId: "q1",
  status: "covered",
  gap: null,
  followUp: false,
  sourceIds: ["web-a"],
};

describe("reconciliación de cobertura", () => {
  it("mantiene cubierta una subpregunta cuyo apoyo sigue admitido", () => {
    const result = reconcileCoverage(
      [{ ...previous, status: "uncovered", gap: "El evaluador no la vio.", followUp: true }],
      [previous],
      [accepted("web-a")],
      [sub],
      new Set(["web-a"]),
    );
    expect(result[0]?.status).toBe("covered");
    expect(result[0]?.sourceIds).toEqual(["web-a"]);
  });

  it("acepta una bajada a parcial cuando el evaluador la propone con apoyo", () => {
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
    expect(result[0]?.status).toBe("partial");
    expect(result[0]?.followUp).toBe(true);
  });

  it("deja sin cubrir la subpregunta si la evidencia anterior se rechazó", () => {
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
    expect(result[0]?.status).toBe("uncovered");
    expect(result[0]?.sourceIds).toEqual([]);
  });
});
