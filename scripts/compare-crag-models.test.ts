// GUÍA DE LECTURA · scripts/compare-crag-models.test.ts
// El plan del comparador no usa credenciales ni red; evita perfiles duplicados y calcula una cota
// que incluya evaluación, reformulación y generación, también cuando el evaluador es más caro.
import { describe, expect, it } from "vite-plus/test";
import { modelComparisonPlan } from "./compare-crag-models";

// Agrupa las comprobaciones de plan de comparación de modelos.
describe("plan de comparación de modelos", () => {
  // Verifica este escenario: cotiza cada lote y mantiene separada la comparación de solo evaluador.
  it("cotiza cada lote y mantiene separada la comparación de solo evaluador", () => {
    // Calcula el plan de un solo perfil para comprobar llamadas y reserva sin leer claves.
    const quality = modelComparisonPlan(["sonnet"]);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(quality.calls).toBe(7);
    // Contrasta el cálculo numérico con el valor esperado admitiendo la precisión indicada.
    expect(quality.worstCaseUsd).toBeCloseTo(0.48);
    // Repite el cálculo con todos los perfiles, incluido el caso que cambia solo el evaluador.
    const all = modelComparisonPlan(["haiku", "sonnet-evaluator", "sonnet", "opus"]);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(all.calls).toBe(28);
    // Contrasta el cálculo numérico con el valor esperado admitiendo la precisión indicada.
    expect(all.worstCaseUsd).toBeCloseTo(3.84);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(modelComparisonPlan(["sonnet-evaluator"]).inputPrice).toBe(2);
  });
  // Verifica este escenario: rechaza un perfil desconocido y los lotes duplicados antes de llamar a ningún proveedor.
  it("rechaza un perfil desconocido y los lotes duplicados antes de llamar a ningún proveedor", () => {
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => modelComparisonPlan([])).toThrow("Perfiles inválidos");
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => modelComparisonPlan(["sonnet", "sonnet"])).toThrow("Perfiles inválidos");
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => modelComparisonPlan(["inventado"])).toThrow("Perfiles inválidos");
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => modelComparisonPlan(["constructor"])).toThrow("Perfiles inválidos");
  });
});
