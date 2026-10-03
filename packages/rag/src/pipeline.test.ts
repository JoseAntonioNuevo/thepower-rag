import { describe, expect, it } from "vite-plus/test";
import { fixtureEmbed } from "./fixture-embed";
import { ingestionPhase } from "./ingest";
import { retrieveBasic, splitCitationBuffer, suppressUnknownCitations } from "./pipeline";
import type { IndexedChunk } from "./pipeline";

function chunk(id: string, text: string, audience: IndexedChunk["audience"]): IndexedChunk {
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

describe("RAG básico", () => {
  const chunks = [
    chunk("programa", "LangGraph modela un agente con estado y nodos.", "program"),
    chunk("lx", "La cohorte L/X tiene clase el 2026-10-05.", "L/X"),
    chunk("mj", "La cohorte M/J tiene clase el 2026-10-22.", "M/J"),
  ];

  it("recupera una vez el contexto de la audiencia pedida", () => {
    let embeddings = 0;
    const outcome = retrieveBasic({
      question: "¿Cómo modela LangGraph un agente?",
      audience: "L/X",
      chunks,
      embed: (text) => {
        embeddings += 1;
        return fixtureEmbed(text);
      },
      minScore: 0.2,
      embeddingLabel: "fixture-token-hash-v1",
      corpusVersion: "v1",
      scoreMeaning: "coseno de prueba",
    });
    expect(embeddings).toBe(1);
    expect(outcome.evidence.map((item) => item.chunkId)).toContain("programa");
    expect(outcome.evidence.map((item) => item.chunkId)).not.toContain("mj");
    expect(outcome.trace.retrieved.some((item) => item.chunkId === "mj")).toBe(false);
  });

  it("no genera cuando el umbral descarta el contexto", () => {
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
    expect(outcome.decision).toBe("refuse");
    expect(outcome.trace.generation).toBe("skipped");
  });

  it("pide cohorte antes de recuperar un calendario", () => {
    let embeddings = 0;
    const outcome = retrieveBasic({
      question: "¿Cuándo es la clase?",
      audience: "program",
      chunks,
      embed: () => {
        embeddings += 1;
        return fixtureEmbed("no");
      },
      minScore: 0.2,
      embeddingLabel: "fixture-token-hash-v1",
      corpusVersion: "v1",
      scoreMeaning: "coseno de prueba",
    });
    expect(outcome.decision).toBe("clarify");
    expect(embeddings).toBe(0);
  });

  it("reúne una cita partida y no retiene un corchete indefinidamente", () => {
    const allowed = new Set(["ok"]);
    const first = splitCitationBuffer("antes [ci", allowed);
    expect(first.emit).toBe("antes ");
    const second = splitCitationBuffer(`${first.rest}te:ok] items[0]`, allowed);
    expect(second.emit).toBe("[cite:ok] items[0]");
    const huge = splitCitationBuffer(`[${"x".repeat(200)}`, allowed);
    expect(huge.rest).toBe("");
    expect(huge.emit).toContain("[xxx");
  });

  it("solo valida la cita explícita y conserva los corchetes ordinarios", () => {
    expect(
      suppressUnknownCitations(
        "Ver [cite:programa] y [cite:fantasma]. items[0].",
        new Set(["programa"]),
      ),
    ).toBe("Ver [cite:programa] y . items[0].");
  });

  it("no marca una versión lista sin lectura de vuelta", () => {
    const item = (
      store: "r2" | "d1" | "vectorize",
      key: string,
      outcome: "succeeded" | "pending" | "failed",
    ) => ({
      store,
      versionId: "v2",
      profileId: "p2",
      key,
      outcome,
      ok: outcome === "succeeded",
      error: outcome === "failed" ? "r2-write-failed" : null,
      mutationId: store === "vectorize" ? "mut-1" : null,
    });
    const base = {
      versionId: "v2",
      profileId: "p2",
      expectedDocuments: 1,
      expectedChunks: 1,
      journal: [item("r2", "doc", "succeeded")],
    };
    expect(ingestionPhase(base)).toBe("partial");
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
    expect(
      ingestionPhase({
        ...base,
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
    expect(
      ingestionPhase({
        ...base,
        journal: [item("r2", "doc", "failed")],
      }),
    ).toBe("failed");
  });
});
