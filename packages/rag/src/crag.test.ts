import { describe, expect, it } from "vite-plus/test";
import {
  orderByRanking,
  retainEvidence,
  routeAfterAssessment,
  validateRankingAndAssessment,
  validateReformulation,
  type CragChunk,
  type RankedHit,
} from "./crag";

function chunk(id: string): CragChunk {
  return {
    documentId: id,
    chunkId: id,
    title: id,
    section: "S",
    text: `texto ${id}`,
    audience: "program",
    corpusVersion: "c-test",
    profileId: "p-test",
    score: 0.4,
  };
}

describe("decisiones de CRAG", () => {
  it("rechaza un id desconocido y una evidencia insuficiente que conserva texto", () => {
    const candidates = [chunk("s5")];
    expect(
      validateRankingAndAssessment(candidates, {
        ranking: [{ chunkId: "otro", score: 0.2, reason: "no está" }],
        status: "insufficient",
        reason: "no sirve",
        gaps: [],
        usefulIds: [],
      }).ok,
    ).toBe(false);
    expect(
      validateRankingAndAssessment(candidates, {
        ranking: [{ chunkId: "s5", score: 0.2, reason: "no sirve" }],
        status: "insufficient",
        reason: "no sirve",
        gaps: [],
        usefulIds: ["s5"],
      }).ok,
    ).toBe(false);
  });

  it("acepta una evidencia parcial con laguna y una reformulación que no avanza", () => {
    const parsed = validateRankingAndAssessment([chunk("s5")], {
      ranking: [{ chunkId: "s5", score: 0.8, reason: "aporta el estado" }],
      status: "partial",
      reason: "falta observabilidad",
      gaps: ["falta observar la ejecución"],
      usefulIds: ["s5"],
    });
    expect(parsed.ok).toBe(true);
    expect(validateReformulation({ query: "la misma" }, ["la misma"]).ok).toBe(false);
    expect(validateReformulation({ query: "" }, []).ok).toBe(false);
  });

  it("aplica la ordenación validada y no el orden de los ids útiles", () => {
    const chunks = [chunk("a"), chunk("b")];
    const ranking: RankedHit[] = [
      { chunkId: "b", score: 0.2, reason: "primero en el ranking" },
      { chunkId: "a", score: 0.9, reason: "segundo en el ranking" },
    ];
    expect(orderByRanking(chunks, ranking, ["a", "b"])).toMatchObject({
      ok: true,
      chunks: [
        { chunkId: "b", score: 0.2 },
        { chunkId: "a", score: 0.9 },
      ],
    });
    expect(
      orderByRanking(
        chunks,
        [
          { chunkId: "b", score: 0.5, reason: "empate" },
          { chunkId: "a", score: 0.5, reason: "empate" },
        ],
        ["a", "b"],
      ),
    ).toMatchObject({
      ok: true,
      chunks: [{ chunkId: "b" }, { chunkId: "a" }],
    });
    expect(orderByRanking(chunks, ranking, ["a", "ausente"]).ok).toBe(false);
    const kept = retainEvidence({
      retained: [{ ...chunk("b"), score: 0.2 }],
      shown: [chunk("b"), chunk("c")],
      usefulIds: ["c"],
      ranking: [
        { chunkId: "c", score: 0.7, reason: "nuevo" },
        { chunkId: "b", score: 0.4, reason: "ya conservado" },
      ],
    });
    expect(kept).toMatchObject({
      ok: true,
      chunks: [
        { chunkId: "c", score: 0.7 },
        { chunkId: "b", score: 0.4 },
      ],
    });
  });

  it("responde si la evidencia es suficiente aunque sea el último intento", () => {
    expect(
      routeAfterAssessment({ status: "sufficient", retrievalCount: 3, reformulationCount: 2 }),
    ).toBe("answer");
    expect(
      routeAfterAssessment({ status: "partial", retrievalCount: 3, reformulationCount: 2 }),
    ).toBe("refuse");
    expect(
      routeAfterAssessment({ status: "partial", retrievalCount: 1, reformulationCount: 0 }),
    ).toBe("retain");
  });
});
