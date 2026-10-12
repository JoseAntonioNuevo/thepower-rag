// GUÍA DE LECTURA · packages/rag/src/limits.test.ts
// Pruebas de los topes de CRAG: tres búsquedas, dos reformulaciones y contadores inválidos.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones que planifican cada paso.
import { planReformulation, planRetrieval } from "./limits";

// Grupo de pruebas de los topes.
describe("límites futuros de CRAG", () => {
  // Tres búsquedas permitidas; la cuarta se rechaza.
  it("permite tres recuperaciones y rechaza la cuarta", () => {
    // Planes obtenidos.
    const plans = [];
    // Contador de búsquedas.
    let count = 0;

    // Bucle hasta que el plan se deniegue.
    for (;;) {
      // Plan del siguiente paso.
      const plan = planRetrieval(count);
      // Se guarda.
      plans.push(plan);
      // Denegado: se termina.
      if (!plan.allowed) {
        // Sale del bucle.
        break;
      }
      // Avanza el contador.
      count = plan.nextCount;
    }

    // Los permitidos llevaron el contador a 1, 2 y 3.
    expect(plans.flatMap((plan) => (plan.allowed ? [plan.nextCount] : []))).toEqual([1, 2, 3]);
    // Solo hay un rechazo y menciona las recuperaciones.
    expect(plans.filter((plan) => !plan.allowed)).toEqual([
      { allowed: false, reason: expect.stringContaining("recuperaciones") },
    ]);
  });

  // Dos reformulaciones permitidas; la tercera se rechaza.
  it("permite dos reformulaciones y rechaza la tercera", () => {
    // Planes obtenidos.
    const plans = [];
    // Contador.
    let count = 0;

    // Bucle hasta el rechazo.
    for (;;) {
      // Plan del siguiente paso.
      const plan = planReformulation(count);
      // Se guarda.
      plans.push(plan);
      // Denegado: se termina.
      if (!plan.allowed) {
        // Sale del bucle.
        break;
      }
      // Avanza el contador.
      count = plan.nextCount;
    }

    // Los permitidos fueron 1 y 2.
    expect(plans.flatMap((plan) => (plan.allowed ? [plan.nextCount] : []))).toEqual([1, 2]);
    // Un rechazo que menciona las reformulaciones.
    expect(plans.filter((plan) => !plan.allowed)).toEqual([
      { allowed: false, reason: expect.stringContaining("reformulaciones") },
    ]);
  });

  // Un contador negativo o con decimales se rechaza.
  it("rechaza un contador inválido", () => {
    // Negativo.
    expect(planRetrieval(-1).allowed).toBe(false);
    // Con decimales.
    expect(planReformulation(1.5).allowed).toBe(false);
  });
});
