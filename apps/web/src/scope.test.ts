// GUÍA DE LECTURA · apps/web/src/scope.test.ts
// Prueba de la clave de conversación.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Función que se prueba.
import { conversationKey } from "./scope";

// Grupo.
describe("aislamiento de la conversación", () => {
  // Cambiar cualquier dato da otra clave.
  it("cambia la clave al cambiar etapa, audiencia o conversación", () => {
    // Clave base.
    const first = conversationKey("sin-rag", "program", 0);
    // Otro modo.
    expect(conversationKey("rag", "program", 0)).not.toBe(first);
    // Otra audiencia.
    expect(conversationKey("sin-rag", "L/X", 0)).not.toBe(first);
    // Otro reinicio.
    expect(conversationKey("sin-rag", "program", 1)).not.toBe(first);
  });
});
