// GUÍA DE LECTURA · packages/rag/src/crag.test.ts
// Pruebas de los validadores de CRAG: ids inventados, evidencias incoherentes, reformulaciones que
// no avanzan, orden según el ranking validado y decisión final en el último intento.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones y tipos de CRAG que se prueban.
import {
  CRAG_SCORE_THRESHOLDS,
  assessCoverageByThresholds,
  orderByRanking,
  retainEvidence,
  routeAfterAssessment,
  validateAssessment,
  validateRanking,
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

  // Escala [0, 1] y distinción entre relevancia de un fragmento y cobertura de toda la pregunta.
  it("valida la escala [0, 1] y separa relevancia individual de cobertura de la pregunta", () => {
    // Candidatos de prueba.
    const candidates = [chunk("s5"), chunk("s6")];
    // Fuera de la escala (> 1): rechazado en validateRanking y validateRankingAndAssessment.
    expect(
      validateRanking(candidates, [
        { chunkId: "s5", score: 1.2, reason: "fuera de escala" },
        { chunkId: "s6", score: 0.4, reason: "dentro" },
      ]).ok,
    ).toBe(false);
    // Fuera de la escala (< 0): rechazado.
    expect(
      validateRankingAndAssessment(candidates, {
        ranking: [
          { chunkId: "s5", score: -0.1, reason: "negativa" },
          { chunkId: "s6", score: 0.4, reason: "dentro" },
        ],
        status: "partial",
        reason: "parcial",
        gaps: ["falta algo"],
        usefulIds: ["s6"],
      }).ok,
    ).toBe(false);
    // Relevancia alta en un fragmento (0,85 >= 0,50) pero cobertura global incompleta (0,50 < 0,75): partial.
    const partial = assessCoverageByThresholds({
      ranking: [
        { chunkId: "s5", score: 0.85, reason: "cubre estado y nodos" },
        { chunkId: "s6", score: 0.2, reason: "no cubre observabilidad aquí" },
      ],
      coverageScore: 0.5,
      gaps: ["Falta cómo observar la ejecución con Langfuse y LangSmith."],
    });
    // Conserva s5 como útil pero declara la cobertura parcial.
    expect(partial.status).toBe("partial");
    expect(partial.usefulIds).toEqual(["s5"]);
    expect(partial.gaps).toEqual(["Falta cómo observar la ejecución con Langfuse y LangSmith."]);
    // Cuando ambos fragmentos superan 0,50 y la cobertura llega a >= 0,75 sin lagunas: sufficient.
    const sufficient = assessCoverageByThresholds({
      ranking: [
        { chunkId: "s5", score: 0.85, reason: "cubre estado" },
        { chunkId: "s6", score: 0.88, reason: "cubre observabilidad" },
      ],
      coverageScore: CRAG_SCORE_THRESHOLDS.sufficientCoverageMin,
      gaps: [],
    });
    // Suficiente con ambos fragmentos.
    expect(sufficient.status).toBe("sufficient");
    expect(sufficient.usefulIds).toEqual(["s5", "s6"]);
    // También pasa validateAssessment por separado.
    expect(validateAssessment(candidates, sufficient).ok).toBe(true);
  });
});
