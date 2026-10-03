import { describe, expect, it } from "vite-plus/test";
import { conversationKey } from "./scope";

describe("aislamiento de la conversación", () => {
  it("cambia la clave al cambiar etapa, audiencia o conversación", () => {
    const first = conversationKey("sin-rag", "program", 0);
    expect(conversationKey("rag", "program", 0)).not.toBe(first);
    expect(conversationKey("sin-rag", "L/X", 0)).not.toBe(first);
    expect(conversationKey("sin-rag", "program", 1)).not.toBe(first);
  });
});
