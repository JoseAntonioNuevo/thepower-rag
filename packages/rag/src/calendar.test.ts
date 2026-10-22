// GUÍA DE LECTURA · packages/rag/src/calendar.test.ts
// Pruebas del atajo del horario semanal: qué preguntas lo activan, que no ejecuta embeddings y que
// rechaza fichas de otro grupo, otra versión, otro documento o vacías.
// expect y it de las pruebas; vi crea funciones simuladas.
import { expect, it, vi } from "vite-plus/test";
// Funciones del calendario.
import { isWeeklyScheduleQuestion, calendarOverviewOutcome, calendarOverviewId } from "./calendar";
// Recuperación básica y tipo de fragmento.
import { retrieveBasic, type IndexedChunk } from "./pipeline";
// Ficha de calendario de prueba para un grupo y una versión.
function chunk(audience: "L/X" | "M/J", version = "course-v1"): IndexedChunk {
  // Fragmento con el id, documento y texto esperados.
  return {
    // Id de la ficha de calendario del grupo y su documento.
    chunkId: calendarOverviewId(audience, version)!,
    documentId: audience === "L/X" ? "calendario-lx" : "calendario-mj",
    title: "Calendario",
    section: "Calendario",
    // Texto de cada calendario: L/X con festivos, M/J sin ellos.
    text:
      audience === "L/X"
        ? "Clases lunes y miércoles, 18:30-20:00; no hay clase el 12 de octubre ni el 2 de noviembre."
        : "Clases martes y jueves, 18:30-20:00.",
    // Grupo, versión y vector vacío (el atajo no usa embeddings).
    audience,
    corpusVersion: version,
    vector: [],
  };
}
// Preguntas generales sobre días u horario, con o sin tildes, activan el atajo.
it("reconoce consultas semanales generales, con o sin tildes", () => {
  // Estas sí.
  for (const q of [
    "que dias hay clase?",
    "¿Qué días de la semana tenemos clases?",
    "¿Cuáles son los días de clase?",
    "¿Cuál es el horario de las clases?",
  ])
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(isWeeklyScheduleQuestion(q)).toBe(true);
  // Preguntas con fecha, sesión, tema u otra cosa no lo activan.
  for (const q of [
    "¿Qué día es la clase S10?",
    "¿Qué días hay clase en octubre?",
    "¿Qué día hay clase de LangGraph?",
    "¿Cuál es el correo de Ignacio?",
    "¿Qué beca de 1991 hay?",
  ])
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(isWeeklyScheduleQuestion(q)).toBe(false);
});
// El atajo devuelve la ficha del grupo exacto sin puntuación inventada ni embeddings.
it("recupera una fuente del grupo exacto sin inventar puntuación ni ejecutar embeddings", () => {
  // Embebedor que falla si alguien lo llama.
  const embed = vi.fn<(text: string) => number[]>(() => {
    // Error si se llama.
    throw new Error("must not embed this metadata query");
  });
  // Para cada cohorte.
  for (const audience of ["L/X", "M/J"] as const) {
    // Recupera con la pregunta del horario.
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
    // Responde.
    expect(result.decision).toBe("answer");
    // Una sola evidencia.
    expect(result.evidence).toHaveLength(1);
    // De la cohorte pedida.
    expect(result.evidence[0]?.audience).toBe(audience);
    // Sin puntuación y seleccionada.
    expect(result.trace.retrieved[0]).toMatchObject({ score: null, selected: true });
  }
  // Nunca se calcularon embeddings.
  expect(embed).not.toHaveBeenCalled();
});
// Sin grupo se pide aclaración; si falta la ficha del grupo, se rechaza.
it("sin grupo pide aclaración sin buscar; un calendario ausente se rechaza", () => {
  // Embebedor simulado que no debe llamarse.
  const embed = vi.fn<(text: string) => number[]>(() => []);
  // Datos comunes de la petición.
  const input = {
    question: "que dias hay clase?",
    chunks: [chunk("L/X")],
    embed,
    minScore: 0.5,
    embeddingLabel: "model",
    corpusVersion: "course-v1",
    scoreMeaning: "cosine",
  };
  // Programa completo: aclaración.
  expect(retrieveBasic({ ...input, audience: "program" }).decision).toBe("clarify");
  // M/J sin su ficha: rechazo.
  expect(retrieveBasic({ ...input, audience: "M/J" }).decision).toBe("refuse");
  // Sin embeddings.
  expect(embed).not.toHaveBeenCalled();
});
// Fichas de otro grupo, versión o documento, o vacías, se rechazan.
it("rechaza otro grupo, otra versión, documento falso o texto vacío", () => {
  // Cada caso inválido.
  for (const bad of [
    // Otro grupo.
    chunk("M/J"),
    // Otra versión.
    chunk("L/X", "other-v"),
    // Documento que no es un calendario.
    { ...chunk("L/X"), documentId: "unknown" },
    // Texto vacío.
    { ...chunk("L/X"), text: "" },
  ])
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(
      // Cada caso debe terminar en rechazo.
      calendarOverviewOutcome({
        question: "que dias hay clase?",
        audience: "L/X",
        corpusVersion: "course-v1",
        chunk: bad,
      }).decision,
    ).toBe("refuse");
});
