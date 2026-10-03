import { describe, expect, it } from "vite-plus/test";
import { createAllowanceLedger, planFits, verificationPlan } from "./allowance";

const prices = {
  embeddingUsdPerMillionInput: 0.0118,
  generativeUsdPerMillionInput: 1,
  generativeUsdPerMillionOutput: 2,
};

describe("presupuesto de sesión", () => {
  it("no llama si el peor caso no cabe y no libera una reserva sin cargo real", () => {
    const ledger = createAllowanceLedger({
      maxSpendUsd: 0.00001,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 2,
      prices,
    });
    const blocked = ledger.reserve({ kind: "generation" });
    expect(blocked.ok).toBe(false);
    expect(ledger.snapshot().reservations).toEqual([]);

    const expensive = {
      embeddingUsdPerMillionInput: 1_000_000,
      generativeUsdPerMillionInput: 1_000_000,
      generativeUsdPerMillionOutput: 2_000_000,
    };
    const room = createAllowanceLedger({
      maxSpendUsd: 8_000,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 2,
      prices: expensive,
    });
    const first = room.reserve({ kind: "generation" });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    room.settle(first.id, null);
    expect(room.reserve({ kind: "generation" }).ok).toBe(false);
    const restored = createAllowanceLedger({
      maxSpendUsd: 8_000,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 2,
      prices: expensive,
      state: room.snapshot(),
    });
    expect(restored.reserve({ kind: "embedding" }).ok).toBe(true);
    expect(restored.reserve({ kind: "generation" }).ok).toBe(false);
  });

  it("rechaza un precio desconocido y un plan que pasa de cuatro llamadas generativas", () => {
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
    expect(unknown.reserve({ kind: "embedding" }).ok).toBe(false);
    expect(unknown.snapshot().reservations).toEqual([]);
    expect(
      planFits({
        maxSpendUsd: 20,
        maxGenerativeCalls: 4,
        maxEmbeddingCalls: 8,
        prices,
      }),
    ).toBe(true);
    expect(verificationPlan().reduce((sum, step) => sum + step.generativeCalls, 0)).toBe(4);
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
