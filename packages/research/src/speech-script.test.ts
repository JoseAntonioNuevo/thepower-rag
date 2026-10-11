import { describe, expect, it } from "vite-plus/test";
import { spokenScript } from "./speech-script";

const excerpt = "La dimensión del índice no se puede cambiar después de crearlo.";

describe("guion hablado", () => {
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
