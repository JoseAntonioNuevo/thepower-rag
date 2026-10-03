import { describe, expect, it } from "vite-plus/test";
import { planReformulation, planRetrieval } from "./limits";

describe("límites futuros de CRAG", () => {
  it("permite tres recuperaciones y rechaza la cuarta", () => {
    const plans = [];
    let count = 0;

    for (;;) {
      const plan = planRetrieval(count);
      plans.push(plan);
      if (!plan.allowed) {
        break;
      }
      count = plan.nextCount;
    }

    expect(plans.flatMap((plan) => (plan.allowed ? [plan.nextCount] : []))).toEqual([1, 2, 3]);
    expect(plans.filter((plan) => !plan.allowed)).toEqual([
      { allowed: false, reason: expect.stringContaining("recuperaciones") },
    ]);
  });

  it("permite dos reformulaciones y rechaza la tercera", () => {
    const plans = [];
    let count = 0;

    for (;;) {
      const plan = planReformulation(count);
      plans.push(plan);
      if (!plan.allowed) {
        break;
      }
      count = plan.nextCount;
    }

    expect(plans.flatMap((plan) => (plan.allowed ? [plan.nextCount] : []))).toEqual([1, 2]);
    expect(plans.filter((plan) => !plan.allowed)).toEqual([
      { allowed: false, reason: expect.stringContaining("reformulaciones") },
    ]);
  });

  it("rechaza un contador inválido", () => {
    expect(planRetrieval(-1).allowed).toBe(false);
    expect(planReformulation(1.5).allowed).toBe(false);
  });
});
