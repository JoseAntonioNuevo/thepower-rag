// GUÍA DE LECTURA · apps/web/src/corpus-view.test.ts
// Pruebas de la lógica de la biblioteca: solapamiento entre fragmentos y formatos de cifras y horas.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que se prueban.
import { formatCount, formatReadTime, overlapWithPrevious } from "./corpus-view";

// Grupo.
describe("biblioteca de documentos", () => {
  // Un párrafo partido repite el final del fragmento anterior.
  it("detecta el solapamiento con el fragmento anterior", () => {
    // Párrafo largo partido con 30 caracteres repetidos.
    const shared = "y este trozo se repite entre f";
    const previous = `Primera parte del párrafo ${shared}`;
    const current = `${shared}ragmentos para no perder contexto.`;
    // Solapamiento exacto.
    expect(overlapWithPrevious(previous, current)).toBe(shared.length);
  });

  // Sin anterior, o con coincidencias demasiado cortas, no hay solapamiento.
  it("no inventa solapamientos", () => {
    // Primer fragmento.
    expect(overlapWithPrevious(null, "## Sección\n\nTexto")).toBe(0);
    // Dos secciones distintas.
    expect(overlapWithPrevious("## Plazo\n\nTreinta días.", "## Estado\n\nCompleto.")).toBe(0);
    // Coincidencia de pocas letras.
    expect(overlapWithPrevious("termina en día.", "día. Empieza otra cosa")).toBe(0);
  });

  // Formatos para la pantalla.
  it("formatea cifras y horas", () => {
    // Separador de miles con punto.
    expect(formatCount(12345)).toBe("12.345");
    // Hora no válida: se devuelve tal cual.
    expect(formatReadTime("no-es-una-fecha")).toBe("no-es-una-fecha");
    // Hora válida con segundos.
    expect(formatReadTime("2026-10-26T10:04:31.000Z")).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
