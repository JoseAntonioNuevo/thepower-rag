// GUÍA DE LECTURA · packages/rag/src/pipeline.test.ts
// Pruebas del RAG básico: una sola búsqueda por audiencia, rechazo bajo el umbral, aclaración de
// calendario, filtrado de citas en streaming y fases de la ingesta.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Embedding de la demo.
import { fixtureEmbed } from "./fixture-embed";
// Fase de la ingesta.
import { ingestionPhase } from "./ingest";
// Funciones de recuperación y de citas.
import { retrieveBasic, splitCitationBuffer, suppressUnknownCitations } from "./pipeline";
// Tipo de fragmento.
import type { IndexedChunk } from "./pipeline";

// Fragmento de prueba con su vector de la demo.
function chunk(id: string, text: string, audience: IndexedChunk["audience"]): IndexedChunk {
  // Fragmento con texto y audiencia.
  return {
    documentId: id,
    chunkId: id,
    title: id,
    section: id,
    text,
    audience,
    corpusVersion: "v1",
    vector: fixtureEmbed(text),
  };
}

// Grupo de pruebas del RAG básico.
describe("RAG básico", () => {
  // Un fragmento del programa y uno por cohorte.
  const chunks = [
    chunk("programa", "LangGraph modela un agente con estado y nodos.", "program"),
    chunk("lx", "La cohorte L/X tiene clase el 2026-10-05.", "L/X"),
    chunk("mj", "La cohorte M/J tiene clase el 2026-10-22.", "M/J"),
  ];

  // Una sola búsqueda y solo con lo visible para L/X.
  it("recupera una vez el contexto de la audiencia pedida", () => {
    // Contador de embeddings.
    let embeddings = 0;
    // Recupera para L/X.
    const outcome = retrieveBasic({
      question: "¿Cómo modela LangGraph un agente?",
      audience: "L/X",
      chunks,
      embed: (text) => {
        // Cuenta la llamada.
        embeddings += 1;
        // Embedding de la demo.
        return fixtureEmbed(text);
      },
      minScore: 0.2,
      embeddingLabel: "fixture-token-hash-v1",
      corpusVersion: "v1",
      scoreMeaning: "coseno de prueba",
    });
    // Un solo embedding.
    expect(embeddings).toBe(1);
    // Aparece el fragmento del programa.
    expect(outcome.evidence.map((item) => item.chunkId)).toContain("programa");
    // No aparece el de M/J.
    expect(outcome.evidence.map((item) => item.chunkId)).not.toContain("mj");
    // Ni siquiera en la traza.
    expect(outcome.trace.retrieved.some((item) => item.chunkId === "mj")).toBe(false);
  });

  // Bajo el umbral se rechaza sin generar.
  it("no genera cuando el umbral descarta el contexto", () => {
    // Pregunta sin relación con el corpus.
    const outcome = retrieveBasic({
      question: "becas internas del año 1991",
      audience: "program",
      chunks,
      embed: fixtureEmbed,
      minScore: 0.33,
      embeddingLabel: "fixture-token-hash-v1",
      corpusVersion: "v1",
      scoreMeaning: "coseno de prueba",
    });
    // Rechazo.
    expect(outcome.decision).toBe("refuse");
    // Sin generación.
    expect(outcome.trace.generation).toBe("skipped");
  });

  // Una pregunta de calendario sin cohorte pide aclaración sin buscar.
  it("pide cohorte antes de recuperar un calendario", () => {
    // Contador de embeddings.
    let embeddings = 0;
    // Recupera para el programa completo.
    const outcome = retrieveBasic({
      question: "¿Cuándo es la clase?",
      audience: "program",
      chunks,
      embed: () => {
        // Cuenta la llamada.
        embeddings += 1;
        // Embedding cualquiera.
        return fixtureEmbed("no");
      },
      minScore: 0.2,
      embeddingLabel: "fixture-token-hash-v1",
      corpusVersion: "v1",
      scoreMeaning: "coseno de prueba",
    });
    // Aclaración.
    expect(outcome.decision).toBe("clarify");
    // Sin embeddings.
    expect(embeddings).toBe(0);
  });

  // Una cita partida entre dos trozos del stream se une; un corchete enorme no se retiene.
  it("reúne una cita partida y no retiene un corchete indefinidamente", () => {
    // Solo el id ok está permitido.
    const allowed = new Set(["ok"]);
    // Primer trozo con una marca a medias.
    const first = splitCitationBuffer("antes [ci", allowed);
    // Se emite lo anterior y se guarda la marca.
    expect(first.emit).toBe("antes ");
    // Segundo trozo completa la marca.
    const second = splitCitationBuffer(`${first.rest}te:ok] items[0]`, allowed);
    // La cita se emite completa y el corchete normal se conserva.
    expect(second.emit).toBe("[cite:ok] items[0]");
    // Corchete con 200 caracteres: no puede ser una cita.
    const huge = splitCitationBuffer(`[${"x".repeat(200)}`, allowed);
    // No se guarda nada.
    expect(huge.rest).toBe("");
    // Se emite.
    expect(huge.emit).toContain("[xxx");
  });

  // Solo se quitan las citas a fragmentos no recuperados; los demás corchetes quedan.
  it("solo valida la cita explícita y conserva los corchetes ordinarios", () => {
    // La cita a «fantasma» desaparece; items[0] se conserva.
    expect(
      suppressUnknownCitations(
        "Ver [cite:programa] y [cite:fantasma]. items[0].",
        new Set(["programa"]),
      ),
    ).toBe("Ver [cite:programa] y . items[0].");
  });

  // Una versión no está lista sin la lectura de vuelta de los vectores.
  it("no marca una versión lista sin lectura de vuelta", () => {
    // Fabrica una anotación del diario.
    const item = (
      // Parámetros: almacén, clave y resultado.
      store: "r2" | "d1" | "vectorize",
      key: string,
      outcome: "succeeded" | "pending" | "failed",
    ) => ({
      // Misma versión y perfil para todas.
      store,
      versionId: "v2",
      profileId: "p2",
      key,
      // ok y error se derivan del resultado; solo Vectorize lleva mutación.
      outcome,
      ok: outcome === "succeeded",
      error: outcome === "failed" ? "r2-write-failed" : null,
      mutationId: store === "vectorize" ? "mut-1" : null,
    });
    // Datos comunes con solo un documento escrito.
    const base = {
      versionId: "v2",
      profileId: "p2",
      expectedDocuments: 1,
      expectedChunks: 1,
      journal: [item("r2", "doc", "succeeded")],
    };
    // Solo R2: parcial.
    expect(ingestionPhase(base)).toBe("partial");
    // Escrito pero sin visibilidad: pendiente.
    expect(
      ingestionPhase({
        ...base,
        journal: [
          item("r2", "doc", "succeeded"),
          item("d1", "catalog", "succeeded"),
          item("vectorize", "vectors:batch:0", "succeeded"),
          item("vectorize", "vectors:visibility", "pending"),
        ],
      }),
    ).toBe("pending-visibility");
    // Anotaciones de otra versión no cuentan: planificada.
    expect(
      ingestionPhase({
        // Base de la fase.
        ...base,
        // Una anotación correcta, pero de la versión v1.
        journal: [
          {
            store: "r2",
            versionId: "v1",
            profileId: "p1",
            key: "doc",
            outcome: "succeeded",
            ok: true,
            error: null,
            mutationId: null,
          },
        ],
      }),
    ).toBe("planned");
    // Un fallo hace fallar la ingesta.
    expect(
      ingestionPhase({
        ...base,
        journal: [item("r2", "doc", "failed")],
      }),
    ).toBe("failed");
  });
});
