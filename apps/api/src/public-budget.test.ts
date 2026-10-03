import { describe, expect, it } from "vite-plus/test";
import { reservePublicTurn } from "./public-budget";
import type { WorkerEnv } from "./env";

describe("presupuesto público", () => {
  it("rechaza una configuración incompleta antes de acceder a D1", async () => {
    expect(await reservePublicTurn({}, "crag")).toBeNull();
  });
  it("serializa reservas concurrentes sin reiniciar el gasto de otros turnos", async () => {
    let reserved = 0;
    const env: WorkerEnv = {
      PUBLIC_BUDGET_USD: "0.1",
      MODEL_INPUT_USD_PER_MILLION: "0.2",
      MODEL_OUTPUT_USD_PER_MILLION: "1",
      DB: {
        prepare: () => ({
          bind: (quote: number, _: number, limit: number) => ({
            first: async () => {
              if (reserved + quote > limit) return null;
              reserved += quote;
              return { id: "course-2026" };
            },
          }),
        }),
      },
    };
    const outcomes = await Promise.all([
      reservePublicTurn(env, "crag"),
      reservePublicTurn(env, "crag"),
    ]);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const ledger = outcomes.find(Boolean)!;
    for (let n = 0; n < 6; n++) expect(ledger.reserve({ kind: "evaluation" }).ok).toBe(true);
    expect(ledger.reserve({ kind: "generation" }).ok).toBe(false);
    expect(await reservePublicTurn(env, "crag")).toBeNull();
  });
  it("exige la tarifa del evaluador distinto y reserva la más cara sin alterar RAG", async () => {
    const quotes: number[] = [];
    const env: WorkerEnv = {
      PUBLIC_BUDGET_USD: "4.3",
      MODEL_ID: "openai/gpt-6-luna",
      EVALUATOR_MODEL_ID: "google/gemini-3.8-flash",
      MODEL_INPUT_USD_PER_MILLION: "0.2",
      MODEL_OUTPUT_USD_PER_MILLION: "1",
      DB: {
        prepare: () => ({
          bind: (quote: number) => ({
            first: async () => {
              quotes.push(quote);
              return { id: "course-2026" };
            },
          }),
        }),
      },
    };
    expect(await reservePublicTurn(env, "crag")).toBeNull();
    expect(quotes).toHaveLength(0);
    env.EVALUATOR_INPUT_USD_PER_MILLION = "0.75";
    env.EVALUATOR_OUTPUT_USD_PER_MILLION = "3.75";
    const ledger = await reservePublicTurn(env, "crag");
    expect(ledger!.snapshot().prices.generativeUsdPerMillionInput).toBe(0.75);
    expect(quotes[0]).toBeCloseTo(0.3375885);
    await reservePublicTurn(env, "rag");
    expect(quotes[1]).toBeCloseTo(0.0150295);
  });
});
