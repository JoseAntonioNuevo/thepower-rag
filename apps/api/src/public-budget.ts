import { createAllowanceLedger, type AllowanceLedger } from "@thepower-rag/core";
import type { WorkerEnv } from "./env";
import type { SqlDatabase } from "./stores";

// A conditional D1 UPDATE serializes reservations across Worker instances.
// Reservations remain consumed when provider charge is unknown, including errors.
export async function reservePublicTurn(
  env: WorkerEnv,
  mode: string,
): Promise<AllowanceLedger | null> {
  const limit = Number(env.PUBLIC_BUDGET_USD);
  let inputPrice = Number(env.MODEL_INPUT_USD_PER_MILLION);
  let outputPrice = Number(env.MODEL_OUTPUT_USD_PER_MILLION);
  if (
    !env.DB ||
    !(limit > 0) ||
    !(inputPrice > 0) ||
    !(outputPrice > 0) ||
    ![limit, inputPrice, outputPrice].every(Number.isFinite)
  )
    return null;
  if (mode === "crag" && env.EVALUATOR_MODEL_ID !== env.MODEL_ID) {
    const evaluatorInput = Number(env.EVALUATOR_INPUT_USD_PER_MILLION);
    const evaluatorOutput = Number(env.EVALUATOR_OUTPUT_USD_PER_MILLION);
    if (
      !(evaluatorInput > 0) ||
      !(evaluatorOutput > 0) ||
      !Number.isFinite(evaluatorInput) ||
      !Number.isFinite(evaluatorOutput)
    )
      return null;
    // The ledger has one tariff: use the higher rate for every call, including
    // reasoning output. Deliberately over-reserves rather than understating cost.
    inputPrice = Math.max(inputPrice, evaluatorInput);
    outputPrice = Math.max(outputPrice, evaluatorOutput);
  }
  const generative = mode === "crag" ? 6 : 1;
  const embedding = mode === "sin-rag" ? 0 : mode === "crag" ? 3 : 1;
  // Contract caps history at 20,000 chars, evidence at 6 x 900 chars;
  // 50,000 input tokens per call is a conservative upper bound.
  const quote =
    (1.25 *
      (generative * (50_000 * inputPrice + 2_000 * outputPrice) + embedding * 2_000 * 0.0118)) /
    1_000_000;
  const db = env.DB as SqlDatabase;
  const result = await db
    .prepare(
      `UPDATE public_budget SET reserved_usd = reserved_usd + ?, turns = turns + 1 WHERE id = 'course-2026' AND reserved_usd + ? <= ? RETURNING id`,
    )
    .bind(quote, quote, limit)
    .first<{ id: string }>();
  if (!result) return null;
  return createAllowanceLedger({
    maxSpendUsd: quote,
    maxGenerativeCalls: generative,
    maxEmbeddingCalls: embedding,
    prices: {
      embeddingUsdPerMillionInput: 0.0118,
      generativeUsdPerMillionInput: inputPrice,
      generativeUsdPerMillionOutput: outputPrice,
    },
  });
}
