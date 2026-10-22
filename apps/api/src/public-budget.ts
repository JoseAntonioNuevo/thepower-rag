// GUÍA DE LECTURA · apps/api/src/public-budget.ts
// Reserva del presupuesto público por turno de chat en la URL publicada: calcula el peor caso con
// las tarifas configuradas y lo descuenta de una fila de D1 en una sola sentencia condicional.
// Libro de cuentas del turno y su tipo.
import { createAllowanceLedger, type AllowanceLedger } from "@thepower-rag/core";
// Tipo de las variables del Worker.
import { cragExecutionBudgetMs, modelTimeoutMs, type WorkerEnv } from "./env";
// Tipo de la base de datos D1.
import type { SqlDatabase } from "./stores";

// Un UPDATE condicional de D1 ordena las reservas entre instancias del Worker.
// Una reserva no se devuelve si el cargo del proveedor es desconocido, tampoco si hubo error.
export async function reservePublicTurn(
  env: WorkerEnv,
  mode: string,
): Promise<AllowanceLedger | null> {
  // También se valida aquí: un consumidor distinto del router no puede reservar con plazos inválidos.
  if (modelTimeoutMs(env) === null || (mode === "crag" && cragExecutionBudgetMs(env) === null)) {
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  }
  // Tope total del presupuesto público.
  const limit = Number(env.PUBLIC_BUDGET_USD);
  // Tarifa de entrada del modelo generador.
  let inputPrice = Number(env.MODEL_INPUT_USD_PER_MILLION);
  // Tarifa de salida del modelo generador.
  let outputPrice = Number(env.MODEL_OUTPUT_USD_PER_MILLION);
  // Sin D1 o con valores no válidos no se reserva (la consulta se rechaza).
  if (
    !env.DB ||
    !(limit > 0) ||
    !(inputPrice > 0) ||
    !(outputPrice > 0) ||
    ![limit, inputPrice, outputPrice].every(Number.isFinite)
  )
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // En CRAG con un evaluador distinto también hacen falta sus tarifas.
  if (mode === "crag" && env.EVALUATOR_MODEL_ID !== env.MODEL_ID) {
    // Tarifa de entrada del evaluador.
    const evaluatorInput = Number(env.EVALUATOR_INPUT_USD_PER_MILLION);
    // Tarifa de salida del evaluador.
    const evaluatorOutput = Number(env.EVALUATOR_OUTPUT_USD_PER_MILLION);
    // Valores no válidos: no se reserva.
    if (
      !(evaluatorInput > 0) ||
      !(evaluatorOutput > 0) ||
      !Number.isFinite(evaluatorInput) ||
      !Number.isFinite(evaluatorOutput)
    )
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // La sesión de gasto tiene una sola tarifa: se usa la más alta para todas las llamadas, también
    // para la salida de razonamiento. Reserva de más a propósito en vez de quedarse corta.
    inputPrice = Math.max(inputPrice, evaluatorInput);
    // Se usa la tarifa más alta de las dos para todas las llamadas.
    outputPrice = Math.max(outputPrice, evaluatorOutput);
  }
  // Llamadas generativas del turno: 6 en CRAG (evaluaciones, reformulaciones y respuesta) y 1 en el resto.
  const generative = mode === "crag" ? 6 : 1;
  // Embeddings del turno: ninguno sin RAG, 3 en CRAG y 1 en RAG.
  const embedding = mode === "sin-rag" ? 0 : mode === "crag" ? 3 : 1;
  // El contrato limita el historial a 20.000 caracteres y la evidencia a 6 × 900 caracteres;
  // 50.000 tokens de entrada por llamada es una cota superior prudente.
  const quote =
    (1.25 *
      (generative * (50_000 * inputPrice + 2_000 * outputPrice) + embedding * 2_000 * 0.0118)) /
    1_000_000;
  // Base de datos D1.
  const db = env.DB as SqlDatabase;
  // Suma la reserva solo si cabe en el tope; RETURNING devuelve la fila si se actualizó.
  const result = await db
    .prepare(
      `UPDATE public_budget SET reserved_usd = reserved_usd + ?, turns = turns + 1 WHERE id = 'course-2026' AND reserved_usd + ? <= ? RETURNING id`,
    )
    .bind(quote, quote, limit)
    .first<{ id: string }>();
  // No cabía: sin reserva.
  if (!result)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Libro de cuentas limitado a esta reserva.
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
