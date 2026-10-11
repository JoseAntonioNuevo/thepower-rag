import { describe, expect, it } from "vite-plus/test";
import { spokenScript } from "./speech-script";

const excerpt = "La dimensión del índice no se puede cambiar después de crearlo.";

describe("guion hablado", () => {
  it("lee la frase completa del informe y excluye lagunas aunque simulen una cita", () => {
    const course =
      "Objetivo para el alumno: construir un agente con imagen y audio, y que también pueda producir voz.";
    const invented = "El curso exige nota mínima 9.";
    const text = spokenScript({
      outcome: "complete",
      reportText: `**Respuesta directa.** ${excerpt} [cite:web]\n\n**Hallazgos con evidencia**\n- q2 · ${course} [cite:tool]\n\n**Puntos sin resolver**\n- ${invented} [cite:web]`,
      excerpts: [excerpt, course, invented],
      conflict: null,
      perceptionFailed: false,
    });
    expect(text).toContain(course);
    expect(text).not.toContain("q2");
    expect(text).not.toContain("cite:");
    expect(text).not.toContain(invented);
    expect(text).not.toMatch(/^que también/);
    const refused = spokenScript({
      outcome: "refused",
      reportText: `**Sin informe.** Sin afirmaciones.\n\n**Puntos sin resolver**\n- ${invented} [cite:web]`,
      excerpts: [invented],
      conflict: null,
      perceptionFailed: false,
    });
    expect(refused).not.toContain(invented);
    expect(refused).toContain("Consulta el informe");
  });
  it("lee una cláusula admitida y no parafrasea", () => {
    const text = spokenScript({
      outcome: "complete",
      reportText: `${excerpt} Basta con reiniciar el navegador.`,
      excerpts: [excerpt],
      conflict: null,
      perceptionFailed: false,
    });
    expect(text).toContain(excerpt);
    expect(text).not.toContain("reiniciar el navegador");
    expect(text.split(/[.!?]/).filter((part) => part.trim().length > 0).length).toBeLessThanOrEqual(
      3,
    );
  });

  it("manda a consultar el informe si no hay cláusula segura", () => {
    const text = spokenScript({
      outcome: "partial",
      reportText: "Según el modelo, la nota mínima es un cinco.",
      excerpts: [excerpt],
      conflict: null,
      perceptionFailed: false,
    });
    expect(text).toContain("Consulta el informe");
    expect(text).not.toContain("nota mínima");
  });
});
