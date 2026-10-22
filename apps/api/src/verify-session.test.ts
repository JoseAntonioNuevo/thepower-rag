// GUÍA DE LECTURA · apps/api/src/verify-session.test.ts
// Pruebas de la sesión de verificación local: recorre las etapas con dobles sin pasar de cuatro
// llamadas generativas, y el adaptador real no reserva sin sesión de gasto.
// Libro de cuentas del presupuesto.
import { createAllowanceLedger } from "@thepower-rag/core";
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Plazo de una llamada al proveedor.
import { providerTimeoutMs } from "./crag-real";
// Puertos reales de CRAG.
import { createRealCragPorts } from "./crag-real";
// Sesión de verificación.
import { runVerificationSession } from "./verify-session";

// Grupo de pruebas de la verificación local.
describe("verificación local", () => {
  // Recorre todas las etapas con dobles y respeta el tope de llamadas.
  it("recorre la aplicación con dobles y no pasa de cuatro llamadas generativas", async () => {
    // Presupuesto de prueba con cuatro llamadas generativas.
    const ledger = createAllowanceLedger({
      maxSpendUsd: 20,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 8,
      prices: {
        embeddingUsdPerMillionInput: 0.0118,
        generativeUsdPerMillionInput: 1,
        generativeUsdPerMillionOutput: 2,
      },
    });
    // Ejecuta la sesión.
    const report = await runVerificationSession({ ledger, profileId: "p0123456789ab" });
    // No fue en vivo.
    expect(report.live).toBe(false);
    // Incluye un error provocado.
    expect(report.syntheticError).toBe(true);
    // Todo correcto.
    expect(report.ok).toBe(true);
    // Cuatro llamadas como mucho.
    expect(report.generativeCalls).toBeLessThanOrEqual(4);
    // Las seis etapas en orden.
    expect(report.turns.map((turn) => turn.id)).toEqual([
      "sin-rag",
      "rag",
      "crag",
      "clarify",
      "refuse",
      "local-error",
    ]);
  });

  // Sin sesión de gasto no se reserva y el plazo usa el tiempo restante.
  it("el adaptador real no reserva sin sesión y usa el tiempo restante", () => {
    // El plazo es el menor entre el tope y lo que queda.
    expect(providerTimeoutMs(1_000, 20_000)).toBe(1_000);
    // Nunca más de lo que queda.
    expect(providerTimeoutMs(50_000, 20_000)).toBe(20_000);
    // Sin tope: cero.
    expect(providerTimeoutMs(0, 20_000)).toBe(0);
    // Puertos reales con bindings vacíos.
    const ports = createRealCragPorts({
      // Alcance de la prueba.
      signal: new AbortController().signal,
      scope: {
        runId: "run",
        audience: "program",
        corpusVersion: "c-test",
        profileId: "p-test",
        embeddingLabel: "bge",
      },
      // Bindings vacíos: embeddings, índice y D1 sin datos.
      embedder: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ data: [] }),
      },
      index: {
        // Doble de prueba: ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
        query: async () => ({ matches: [] }),
        // Doble de prueba: inserta o actualiza el lote de vectores por sus identificadores.
        upsert: async () => ({}),
      },
      database: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare: () => ({
          // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
          bind: () => ({
            // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
            first: async () => null,
            // Doble de prueba: resuelve el conjunto de filas en el formato que espera el consumidor SQL.
            all: async () => ({ results: [] }),
            // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
            run: async () => ({}),
          }),
        }),
      },
      // Modelos sin usar; la prueba solo mira plazos y bloqueos.
      evaluator: {} as never,
      generator: {} as never,
      messages: [],
      embeddingModel: "@cf/baai/bge-m3",
      dimensions: 32,
    });
    // Sin libro de cuentas, la reserva se deniega.
    expect(ports.reserve("generation")).toEqual({
      ok: false,
      reason: "No hay una sesión de gasto autorizada. El chat real no llama al proveedor.",
    });
  });
});
