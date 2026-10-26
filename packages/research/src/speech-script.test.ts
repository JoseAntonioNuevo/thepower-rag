// GUÍA DE LECTURA · packages/research/src/speech-script.test.ts
// Pruebas del guion de voz: solo frases completas verificadas, sin lagunas ni citas, sin
// paráfrasis y con aviso de consultar el informe cuando no hay nada seguro.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Función del guion.
import { spokenScript } from "./speech-script";

// Extracto admitido de prueba.
const excerpt = "Los auriculares intraauditivos no se pueden devolver después de abrirlos.";

// Grupo de pruebas del guion.
describe("guion hablado", () => {
  // Lee frases completas y excluye los puntos sin resolver aunque citen.
  it("lee la frase completa del informe y excluye lagunas aunque simulen una cita", () => {
    // Frase de la tienda con una coordinación.
    const policy =
      "El reembolso se ordena por el mismo método de pago, y con Bizum tarda 2 días hábiles.";
    // Dato inventado.
    const invented = "ThePower Shop da un cupón del 20 % a los estudiantes.";
    // Guion de un informe completo.
    const text = spokenScript({
      outcome: "complete",
      reportText: `**Respuesta directa.** ${excerpt} [cite:web]\n\n**Hallazgos con evidencia**\n- q2 · ${policy} [cite:store]\n\n**Puntos sin resolver**\n- ${invented} [cite:web]`,
      excerpts: [excerpt, policy, invented],
      conflict: null,
      perceptionFailed: false,
    });
    // Incluye la frase de la tienda entera.
    expect(text).toContain(policy);
    // Sin el id de subpregunta.
    expect(text).not.toContain("q2");
    // Sin marcas de cita.
    expect(text).not.toContain("cite:");
    // Sin el dato inventado.
    expect(text).not.toContain(invented);
    // No empieza a mitad de frase.
    expect(text).not.toMatch(/^que también/);
    // Sin puntuación rota.
    expect(text).not.toContain(".;.");
    // Guion de un informe rechazado.
    const refused = spokenScript({
      outcome: "refused",
      reportText: `**Sin informe.** Sin afirmaciones.\n\n**Puntos sin resolver**\n- ${invented} [cite:web]`,
      excerpts: [invented],
      conflict: null,
      perceptionFailed: false,
    });
    // Sin el dato inventado.
    expect(refused).not.toContain(invented);
    // Remite al informe.
    expect(refused).toContain("Consulta el informe");
  });
  // Lee la frase admitida y descarta la añadida.
  it("lee una cláusula admitida y no parafrasea", () => {
    // Guion con una frase extra no respaldada.
    const text = spokenScript({
      outcome: "complete",
      reportText: `${excerpt} Basta con reiniciar el navegador.`,
      excerpts: [excerpt],
      conflict: null,
      perceptionFailed: false,
    });
    // Incluye la frase admitida.
    expect(text).toContain(excerpt);
    // No incluye la añadida.
    expect(text).not.toContain("reiniciar el navegador");
    // Como mucho tres frases.
    expect(text.split(/[.!?]/).filter((part) => part.trim().length > 0).length).toBeLessThanOrEqual(
      3,
    );
  });

  // Sin frases seguras se remite al informe.
  it("manda a consultar el informe si no hay cláusula segura", () => {
    // Guion con una afirmación sin respaldo.
    const text = spokenScript({
      outcome: "partial",
      reportText: "Según el modelo, el cupón para estudiantes es del 20 %.",
      excerpts: [excerpt],
      conflict: null,
      perceptionFailed: false,
    });
    // Remite al informe.
    expect(text).toContain("Consulta el informe");
    // No lee la afirmación.
    expect(text).not.toContain("cupón para estudiantes");
  });
});
