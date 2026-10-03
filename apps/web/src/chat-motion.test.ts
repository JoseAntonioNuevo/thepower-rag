import { describe, expect, it } from "vite-plus/test";
import {
  THINK_SIZER,
  conversationStatus,
  matrixDotPlan,
  splitStreamTokens,
  type ChatStage,
} from "./chat-motion";

describe("movimiento del chat", () => {
  it("mantiene el texto partido y usa el estado más largo como ancho", () => {
    const source = "Línea uno.\nLínea  dos.";
    expect(
      splitStreamTokens(source)
        .map((token) => token.text)
        .join(""),
    ).toBe(source);
    expect(splitStreamTokens("")).toEqual([]);
    const modes: ChatStage[] = ["sin-rag", "rag", "crag"];
    const labels = new Set(
      ["ready", "submitted", "streaming", "error"].flatMap((status) =>
        modes.map((mode) => conversationStatus(status, mode)),
      ),
    );
    expect(labels.has(THINK_SIZER)).toBe(true);
    for (const label of labels) {
      expect(label.length).toBeLessThanOrEqual(THINK_SIZER.length);
    }
    expect(conversationStatus("submitted", "rag")).toBe("Enviando");
    expect(conversationStatus("streaming", "crag")).toBe("Recorriendo el grafo");
  });

  it("reparte los retardos de la matriz como el catálogo", () => {
    expect(matrixDotPlan("scan", 2, 1200, false).delayMs).toBe(240);
    expect(matrixDotPlan("twinkle", 0, 1200, false).delayMs).toBe(525);
    expect(matrixDotPlan("orbit", 5, 1200, false).steady).toBe(true);
    expect(matrixDotPlan("orbit", 1, 1200, false).delayMs).toBe(0);
    expect(matrixDotPlan("pulse", 0, 1200, false).delayMs).toBe(192);
    expect(matrixDotPlan("pulse", 5, 1200, false).delayMs).toBe(0);
    expect(matrixDotPlan("scan", 0, 1200, true).gap).toBe(true);
  });
});
