import { expect, it, vi } from "vite-plus/test";
import { isWeeklyScheduleQuestion, calendarOverviewOutcome, calendarOverviewId } from "./calendar";
import { retrieveBasic, type IndexedChunk } from "./pipeline";
function chunk(audience: "L/X" | "M/J", version = "course-v1"): IndexedChunk {
  return {
    chunkId: calendarOverviewId(audience, version)!,
    documentId: audience === "L/X" ? "calendario-lx" : "calendario-mj",
    title: "Calendario",
    section: "Calendario",
    text:
      audience === "L/X"
        ? "Clases lunes y miércoles, 18:30-20:00; no hay clase el 12 de octubre ni el 2 de noviembre."
        : "Clases martes y jueves, 18:30-20:00.",
    audience,
    corpusVersion: version,
    vector: [],
  };
}
it("reconoce consultas semanales generales, con o sin tildes", () => {
  for (const q of [
    "que dias hay clase?",
    "¿Qué días de la semana tenemos clases?",
    "¿Cuáles son los días de clase?",
    "¿Cuál es el horario de las clases?",
  ])
    expect(isWeeklyScheduleQuestion(q)).toBe(true);
  for (const q of [
    "¿Qué día es la clase S10?",
    "¿Qué días hay clase en octubre?",
    "¿Qué día hay clase de LangGraph?",
    "¿Cuál es el correo de Ignacio?",
    "¿Qué beca de 1991 hay?",
  ])
    expect(isWeeklyScheduleQuestion(q)).toBe(false);
});
it("recupera una fuente del grupo exacto sin inventar puntuación ni ejecutar embeddings", () => {
  const embed = vi.fn<(text: string) => number[]>(() => {
    throw new Error("must not embed this metadata query");
  });
  for (const audience of ["L/X", "M/J"] as const) {
    const result = retrieveBasic({
      question: "que dias hay clase?",
      audience,
      chunks: [chunk("L/X"), chunk("M/J")],
      embed,
      minScore: 0.99,
      embeddingLabel: "model",
      corpusVersion: "course-v1",
      scoreMeaning: "cosine",
    });
    expect(result.decision).toBe("answer");
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]?.audience).toBe(audience);
    expect(result.trace.retrieved[0]).toMatchObject({ score: null, selected: true });
  }
  expect(embed).not.toHaveBeenCalled();
});
it("sin grupo pide aclaración sin buscar; un calendario ausente se rechaza", () => {
  const embed = vi.fn<(text: string) => number[]>(() => []);
  const input = {
    question: "que dias hay clase?",
    chunks: [chunk("L/X")],
    embed,
    minScore: 0.5,
    embeddingLabel: "model",
    corpusVersion: "course-v1",
    scoreMeaning: "cosine",
  };
  expect(retrieveBasic({ ...input, audience: "program" }).decision).toBe("clarify");
  expect(retrieveBasic({ ...input, audience: "M/J" }).decision).toBe("refuse");
  expect(embed).not.toHaveBeenCalled();
});
it("rechaza otro grupo, otra versión, documento falso o texto vacío", () => {
  for (const bad of [
    chunk("M/J"),
    chunk("L/X", "other-v"),
    { ...chunk("L/X"), documentId: "unknown" },
    { ...chunk("L/X"), text: "" },
  ])
    expect(
      calendarOverviewOutcome({
        question: "que dias hay clase?",
        audience: "L/X",
        corpusVersion: "course-v1",
        chunk: bad,
      }).decision,
    ).toBe("refuse");
});
