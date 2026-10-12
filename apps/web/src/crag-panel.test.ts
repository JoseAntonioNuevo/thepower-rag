// GUÍA DE LECTURA · apps/web/src/crag-panel.test.ts
// Pruebas de las utilidades del panel CRAG.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que se prueban.
import { acceptScenarioChange, discardedRowKey } from "./crag-panel";

// Grupo.
describe("panel CRAG", () => {
  // Claves únicas y guion bloqueado.
  it("da una clave distinta a cada descarte repetido y no cambia el guion ocupado", () => {
    // Mismo fragmento descartado en tres intentos.
    const rows = [
      { chunkId: "s16", attempt: 1 },
      { chunkId: "s16", attempt: 2 },
      { chunkId: "s16", attempt: 3 },
    ];
    // Claves.
    const keys = rows.map((item, index) => discardedRowKey(item, index));
    // Todas distintas.
    expect(new Set(keys).size).toBe(keys.length);
    // Ocupado: no se cambia.
    expect(acceptScenarioChange(true)).toBe(false);
    // Libre: sí.
    expect(acceptScenarioChange(false)).toBe(true);
  });
});
