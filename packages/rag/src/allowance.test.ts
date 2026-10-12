// GUÍA DE LECTURA · packages/rag/src/allowance.test.ts
// Pruebas del presupuesto por turno: el peor caso que no cabe bloquea la llamada, un cargo
// desconocido no libera la reserva y un precio desconocido nunca cuenta como cero.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones del presupuesto.
import { createAllowanceLedger, planFits, verificationPlan } from "./allowance";

// Tarifas de prueba en USD por millón de tokens.
const prices = {
  embeddingUsdPerMillionInput: 0.0118,
  generativeUsdPerMillionInput: 1,
  generativeUsdPerMillionOutput: 2,
};

// Grupo de pruebas del presupuesto.
describe("presupuesto de sesión", () => {
  // Sin espacio para el peor caso no se llama; una reserva liquidada sin importe sigue contando.
  it("no llama si el peor caso no cabe y no libera una reserva sin cargo real", () => {
    // Tope de gasto diminuto.
    const ledger = createAllowanceLedger({
      maxSpendUsd: 0.00001,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 2,
      prices,
    });
    // Intenta reservar una generación.
    const blocked = ledger.reserve({ kind: "generation" });
    // No cabe.
    expect(blocked.ok).toBe(false);
    // No queda ninguna reserva.
    expect(ledger.snapshot().reservations).toEqual([]);

    // Tarifas muy caras para llenar el tope con una sola llamada.
    const expensive = {
      embeddingUsdPerMillionInput: 1_000_000,
      generativeUsdPerMillionInput: 1_000_000,
      generativeUsdPerMillionOutput: 2_000_000,
    };
    // Tope que admite exactamente una generación.
    const room = createAllowanceLedger({
      maxSpendUsd: 12_000,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 2,
      prices: expensive,
    });
    // Primera reserva.
    const first = room.reserve({ kind: "generation" });
    // Cabe.
    expect(first.ok).toBe(true);
    // TypeScript necesita esta comprobación para usar first.id.
    if (!first.ok) {
      // Sale si no cupo.
      return;
    }
    // Se liquida sin importe conocido.
    room.settle(first.id, null);
    // La segunda no cabe: la primera sigue contando el peor caso.
    expect(room.reserve({ kind: "generation" }).ok).toBe(false);
    // Restaura el libro desde su estado guardado.
    const restored = createAllowanceLedger({
      maxSpendUsd: 12_000,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 2,
      prices: expensive,
      state: room.snapshot(),
    });
    // Un embedding barato sí cabe.
    expect(restored.reserve({ kind: "embedding" }).ok).toBe(true);
    // Otra generación no.
    expect(restored.reserve({ kind: "generation" }).ok).toBe(false);
  });

  // Sin precio no se reserva; un plan con más llamadas generativas que el tope no cabe.
  it("rechaza un precio desconocido y un plan que pasa de cuatro llamadas generativas", () => {
    // Libro sin tarifas.
    const unknown = createAllowanceLedger({
      maxSpendUsd: 10,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 4,
      prices: {
        embeddingUsdPerMillionInput: null,
        generativeUsdPerMillionInput: null,
        generativeUsdPerMillionOutput: null,
      },
    });
    // No se reserva con precio desconocido.
    expect(unknown.reserve({ kind: "embedding" }).ok).toBe(false);
    // Sin reservas.
    expect(unknown.snapshot().reservations).toEqual([]);
    // El plan de verificación cabe con cuatro llamadas generativas.
    expect(
      planFits({
        maxSpendUsd: 20,
        maxGenerativeCalls: 4,
        maxEmbeddingCalls: 8,
        prices,
      }),
    ).toBe(true);
    // El plan usa exactamente cuatro.
    expect(verificationPlan().reduce((sum, step) => sum + step.generativeCalls, 0)).toBe(4);
    // Con un tope de tres no cabe.
    expect(
      planFits({
        maxSpendUsd: 20,
        maxGenerativeCalls: 3,
        maxEmbeddingCalls: 8,
        prices,
      }),
    ).toBe(false);
  });
});
