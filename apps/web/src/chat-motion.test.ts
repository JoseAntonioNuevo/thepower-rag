// GUÍA DE LECTURA · apps/web/src/chat-motion.test.ts
// Pruebas del movimiento del chat: trocear el texto en streaming, etiquetas de estado y retardos de la matriz.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que se prueban.
import {
  THINK_SIZER,
  conversationStatus,
  matrixDotPlan,
  splitStreamTokens,
  type ChatStage,
} from "./chat-motion";

// Grupo.
describe("movimiento del chat", () => {
  // Texto partido sin pérdidas y etiqueta más larga como ancho.
  it("mantiene el texto partido y usa el estado más largo como ancho", () => {
    // Texto con salto y espacios dobles.
    const source = "Línea uno.\nLínea  dos.";
    // Unir los trozos devuelve el original.
    expect(
      splitStreamTokens(source)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
    // Vacío: sin trozos.
    expect(splitStreamTokens("")).toEqual([]);
    // Modos.
    const modes: ChatStage[] = ["sin-rag", "rag", "crag"];
    // Todas las etiquetas posibles.
    const labels = new Set(
      ["ready", "submitted", "streaming", "error"].flatMap((status) =>
        modes.map((mode) => conversationStatus(status, mode)),
      ),
    );
    // Incluye la más larga.
    expect(labels.has(THINK_SIZER)).toBe(true);
    // Cada etiqueta.
    for (const label of labels) {
      // No supera su longitud.
      expect(label.length).toBeLessThanOrEqual(THINK_SIZER.length);
    }
    // Enviando.
    expect(conversationStatus("submitted", "rag")).toBe("Enviando");
    // Recorriendo el grafo.
    expect(conversationStatus("streaming", "crag")).toBe("Recorriendo el grafo");
  });

  // Retardos por patrón de la matriz.
  it("reparte los retardos de la matriz como el catálogo", () => {
    // scan.
    expect(matrixDotPlan("scan", 2, 1200, false).delayMs).toBe(240);
    // twinkle.
    expect(matrixDotPlan("twinkle", 0, 1200, false).delayMs).toBe(525);
    // orbit fijo.
    expect(matrixDotPlan("orbit", 5, 1200, false).steady).toBe(true);
    // orbit sin retardo.
    expect(matrixDotPlan("orbit", 1, 1200, false).delayMs).toBe(0);
    // pulse.
    expect(matrixDotPlan("pulse", 0, 1200, false).delayMs).toBe(192);
    // pulse sin retardo.
    expect(matrixDotPlan("pulse", 5, 1200, false).delayMs).toBe(0);
    // Hueco con movimiento reducido.
    expect(matrixDotPlan("scan", 0, 1200, true).gap).toBe(true);
  });
});
