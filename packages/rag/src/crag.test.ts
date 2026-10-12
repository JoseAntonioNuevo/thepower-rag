// GUÍA DE LECTURA · packages/rag/src/crag.test.ts
// Pruebas de los validadores de CRAG: ids inventados, evidencias incoherentes, reformulaciones que
// no avanzan, orden según el ranking validado y decisión final en el último intento.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones y tipos de CRAG que se prueban.
import {
  orderByRanking,
  retainEvidence,
  routeAfterAssessment,
  validateRankingAndAssessment,
  validateReformulation,
  type CragChunk,
  type RankedHit,
} from "./crag";

// Fragmento de prueba con un id.
function chunk(id: string): CragChunk {
  // Fragmento con texto y metadatos fijos.
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

// Grupo de pruebas de las decisiones de CRAG.
describe("decisiones de CRAG", () => {
  // Un id que no se recuperó y una evidencia insuficiente que conserva texto se rechazan.
  it("rechaza un id desconocido y una evidencia insuficiente que conserva texto", () => {
    // Un único candidato.
    const candidates = [chunk("s5")];
    // Ranking con un id desconocido: inválido.
    expect(
      validateRankingAndAssessment(candidates, {
        ranking: [{ chunkId: "otro", score: 0.2, reason: "no está" }],
        status: "insufficient",
        reason: "no sirve",
        gaps: [],
        usefulIds: [],
      }).ok,
    ).toBe(false);
    // Insuficiente con un id útil: incoherente.
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

  // Parcial con laguna es válida; repetir o vaciar la consulta no.
  it("acepta una evidencia parcial con laguna y una reformulación que no avanza", () => {
    // Evaluación parcial con su laguna.
    const parsed = validateRankingAndAssessment([chunk("s5")], {
      ranking: [{ chunkId: "s5", score: 0.8, reason: "aporta el estado" }],
      status: "partial",
      reason: "falta observabilidad",
      gaps: ["falta observar la ejecución"],
      usefulIds: ["s5"],
    });
    // Válida.
    expect(parsed.ok).toBe(true);
    // Misma consulta que antes: rechazada.
    expect(validateReformulation({ query: "la misma" }, ["la misma"]).ok).toBe(false);
    // Consulta vacía: rechazada.
    expect(validateReformulation({ query: "" }, []).ok).toBe(false);
  });

  // La evidencia sigue el orden del ranking validado, no el de los ids útiles.
  it("aplica la ordenación validada y no el orden de los ids útiles", () => {
    // Dos fragmentos.
    const chunks = [chunk("a"), chunk("b")];
    // Ranking que pone b antes que a.
    const ranking: RankedHit[] = [
      { chunkId: "b", score: 0.2, reason: "primero en el ranking" },
      { chunkId: "a", score: 0.9, reason: "segundo en el ranking" },
    ];
    // Se ordena como el ranking.
    expect(orderByRanking(chunks, ranking, ["a", "b"])).toMatchObject({
      ok: true,
      chunks: [
        { chunkId: "b", score: 0.2 },
        { chunkId: "a", score: 0.9 },
      ],
    });
    // En un empate se mantiene el orden del ranking.
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
    // Un id útil que no está entre los fragmentos: rechazo.
    expect(orderByRanking(chunks, ranking, ["a", "ausente"]).ok).toBe(false);
    // Une la evidencia conservada con la nueva útil.
    const kept = retainEvidence({
      retained: [{ ...chunk("b"), score: 0.2 }],
      shown: [chunk("b"), chunk("c")],
      usefulIds: ["c"],
      ranking: [
        { chunkId: "c", score: 0.7, reason: "nuevo" },
        { chunkId: "b", score: 0.4, reason: "ya conservado" },
      ],
    });
    // La nueva (c) va antes por su puntuación en el ranking.
    expect(kept).toMatchObject({
      ok: true,
      chunks: [
        { chunkId: "c", score: 0.7 },
        { chunkId: "b", score: 0.4 },
      ],
    });
  });

  // Suficiente responde aunque se hayan agotado los intentos; parcial sin intentos rechaza.
  it("responde si la evidencia es suficiente aunque sea el último intento", () => {
    // Suficiente en el último intento: responder.
    expect(
      routeAfterAssessment({ status: "sufficient", retrievalCount: 3, reformulationCount: 2 }),
    ).toBe("answer");
    // Parcial sin búsquedas restantes: rechazar.
    expect(
      routeAfterAssessment({ status: "partial", retrievalCount: 3, reformulationCount: 2 }),
    ).toBe("refuse");
    // Parcial con margen: conservar y seguir.
    expect(
      routeAfterAssessment({ status: "partial", retrievalCount: 1, reformulationCount: 0 }),
    ).toBe("retain");
  });
});
