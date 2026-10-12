// GUÍA DE LECTURA · apps/api/src/model.test.ts
// Prueba de las opciones de Anthropic de la ruta publicada: effort low y sin parámetros de muestreo.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Opciones que se comprueban.
import { anthropicProviderOptions } from "./model";

// Grupo de pruebas de las opciones de Claude Haiku 5.5.
describe("opciones de Claude Haiku 5.5", () => {
  // Solo effort low; sin temperatura.
  it("fija effort low y no envía muestreo", () => {
    // Opciones exactas.
    expect(anthropicProviderOptions).toEqual({ anthropic: { effort: "low" } });
    // Sin temperatura.
    expect(anthropicProviderOptions).not.toHaveProperty("temperature");
  });
});
