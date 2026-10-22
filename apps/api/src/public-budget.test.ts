// GUÍA DE LECTURA · apps/api/src/public-budget.test.ts
// Pruebas del presupuesto público: configuración incompleta, reservas concurrentes que no exceden el
// tope y tarifa del evaluador distinto aplicada a todo el turno de CRAG.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Función que se prueba.
import { reservePublicTurn } from "./public-budget";
// Tipo del entorno.
import type { WorkerEnv } from "./env";

// Grupo de pruebas del presupuesto público.
describe("presupuesto público", () => {
  // Sin configuración no se toca D1.
  it("rechaza una configuración incompleta antes de acceder a D1", async () => {
    // Devuelve null.
    expect(await reservePublicTurn({}, "crag")).toBeNull();
  });
  // Dos reservas a la vez: solo una cabe.
  it("serializa reservas concurrentes sin reiniciar el gasto de otros turnos", async () => {
    // Importe reservado en la D1 simulada.
    let reserved = 0;
    // Entorno con un tope de 0,1 USD.
    const env: WorkerEnv = {
      PUBLIC_BUDGET_USD: "0.1",
      MODEL_INPUT_USD_PER_MILLION: "0.2",
      MODEL_OUTPUT_USD_PER_MILLION: "1",
      DB: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare: () => ({
          // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
          bind: (quote: number, _: number, limit: number) => ({
            // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
            first: async () => {
              // La sentencia condicional rechaza si no cabe.
              if (reserved + quote > limit)
                // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
                return null;
              // Suma la reserva.
              reserved += quote;
              // Fila actualizada.
              return { id: "course-2026" };
            },
          }),
        }),
      },
    };
    // Dos reservas simultáneas.
    const outcomes = await Promise.all([
      reservePublicTurn(env, "crag"),
      reservePublicTurn(env, "crag"),
    ]);
    // Solo una se aceptó.
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    // Libro de la reserva aceptada.
    const ledger = outcomes.find(Boolean)!;
    // Seis evaluaciones caben.
    for (let n = 0; n < 6; n++)
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(ledger.reserve({ kind: "evaluation" }).ok).toBe(true);
    // Una séptima llamada no.
    expect(ledger.reserve({ kind: "generation" }).ok).toBe(false);
    // Otra reserva tampoco cabe.
    expect(await reservePublicTurn(env, "crag")).toBeNull();
  });
  // Con un evaluador distinto hacen falta sus tarifas y se usa la más cara.
  it("exige la tarifa del evaluador distinto y reserva la más cara sin alterar RAG", async () => {
    // Importes reservados.
    const quotes: number[] = [];
    // Entorno con modelos distintos sin tarifas del evaluador.
    const env: WorkerEnv = {
      PUBLIC_BUDGET_USD: "4.3",
      MODEL_ID: "openai/gpt-6-luna",
      EVALUATOR_MODEL_ID: "google/gemini-3.8-flash",
      MODEL_INPUT_USD_PER_MILLION: "0.2",
      MODEL_OUTPUT_USD_PER_MILLION: "1",
      DB: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare: () => ({
          // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
          bind: (quote: number) => ({
            // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
            first: async () => {
              // Guarda el importe.
              quotes.push(quote);
              // Fila actualizada.
              return { id: "course-2026" };
            },
          }),
        }),
      },
    };
    // Sin tarifas del evaluador: no se reserva.
    expect(await reservePublicTurn(env, "crag")).toBeNull();
    // Nada reservado.
    expect(quotes).toHaveLength(0);
    // Tarifa de entrada del evaluador.
    env.EVALUATOR_INPUT_USD_PER_MILLION = "0.75";
    // Tarifa de salida del evaluador.
    env.EVALUATOR_OUTPUT_USD_PER_MILLION = "3.75";
    // Ahora sí se reserva.
    const ledger = await reservePublicTurn(env, "crag");
    // Con la tarifa más alta.
    expect(ledger!.snapshot().prices.generativeUsdPerMillionInput).toBe(0.75);
    // Importe peor caso de CRAG.
    expect(quotes[0]).toBeCloseTo(0.3375885);
    // RAG no usa la tarifa del evaluador.
    await reservePublicTurn(env, "rag");
    // Importe peor caso de RAG.
    expect(quotes[1]).toBeCloseTo(0.0150295);
  });
});
