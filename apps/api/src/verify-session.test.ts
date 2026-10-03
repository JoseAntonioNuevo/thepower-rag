import { createAllowanceLedger } from "@thepower-rag/core";
import { describe, expect, it } from "vite-plus/test";
import { providerTimeoutMs } from "./crag-real";
import { createRealCragPorts } from "./crag-real";
import { runVerificationSession } from "./verify-session";

describe("verificación local", () => {
  it("recorre la aplicación con dobles y no pasa de cuatro llamadas generativas", async () => {
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
    const report = await runVerificationSession({ ledger, profileId: "p0123456789ab" });
    expect(report.live).toBe(false);
    expect(report.syntheticError).toBe(true);
    expect(report.ok).toBe(true);
    expect(report.generativeCalls).toBeLessThanOrEqual(4);
    expect(report.turns.map((turn) => turn.id)).toEqual([
      "sin-rag",
      "rag",
      "crag",
      "clarify",
      "refuse",
      "local-error",
    ]);
  });

  it("el adaptador real no reserva sin sesión y usa el tiempo restante", () => {
    expect(providerTimeoutMs(1_000, 20_000)).toBe(1_000);
    expect(providerTimeoutMs(50_000, 20_000)).toBe(20_000);
    expect(providerTimeoutMs(0, 20_000)).toBe(0);
    const ports = createRealCragPorts({
      signal: new AbortController().signal,
      scope: {
        runId: "run",
        audience: "program",
        corpusVersion: "c-test",
        profileId: "p-test",
        embeddingLabel: "bge",
      },
      embedder: { run: async () => ({ data: [] }) },
      index: { query: async () => ({ matches: [] }), upsert: async () => ({}) },
      database: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({}),
          }),
        }),
      },
      evaluator: {} as never,
      generator: {} as never,
      messages: [],
      embeddingModel: "@cf/baai/bge-m3",
      dimensions: 32,
    });
    expect(ports.reserve("generation")).toEqual({
      ok: false,
      reason: "No hay una sesión de gasto autorizada. El chat real no llama al proveedor.",
    });
  });
});
