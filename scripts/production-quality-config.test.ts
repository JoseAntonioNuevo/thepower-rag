// GUÍA DE LECTURA · scripts/production-quality-config.test.ts
// Evita que regenerar la configuración suprima los recursos de S12 o reinicie presupuestos.
import { describe, expect, it } from "vite-plus/test";
import { withCourseQualityProfile } from "./production-quality-config";

// Agrupa las comprobaciones de preparación de configuración de calidad.
describe("preparación de configuración de calidad", () => {
  // Verifica este escenario: conserva recursos y límites sin mutar el original.
  it("conserva recursos y límites sin mutar el original", () => {
    // Construye una configuración con recursos, investigación y presupuestos que deben conservarse.
    const previous = {
      main: "worker",
      env: {
        production: {
          vars: {
            MODEL_ID: "claude-haiku-5-5",
            PUBLIC_BUDGET_USD: "4.3",
            RESEARCH_MODEL_ID: "claude-haiku-5-5",
            RESEARCH_BUDGET_USD: "1",
          },
          workflows: [{ binding: "RESEARCH_WORKFLOW" }],
          d1_databases: [{ binding: "DB" }, { binding: "RESEARCH_DB" }],
          r2_buckets: [{ binding: "RESEARCH_MEDIA" }],
          ratelimits: [{ name: "original" }],
        },
        research: { vars: { APP_MODE: "demo" } },
      },
    };
    // Guarda una copia profunda para detectar cualquier mutación accidental de la entrada.
    const snapshot = structuredClone(previous);
    // Aplica el perfil sobre la copia que construye la función bajo prueba.
    const updated = withCourseQualityProfile(previous) as typeof previous;
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(previous).toEqual(snapshot);
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(updated.env.research).toEqual(previous.env.research);
    for (const key of ["workflows", "d1_databases", "r2_buckets", "ratelimits"] as const) {
      // Compara la estructura y los valores completos con la referencia de la prueba.
      expect(updated.env.production[key]).toEqual(previous.env.production[key]);
    }
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(updated.env.production.vars.PUBLIC_BUDGET_USD).toBe("4.3");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(updated.env.production.vars.RESEARCH_BUDGET_USD).toBe("1");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(updated.env.production.vars.RESEARCH_MODEL_ID).toBe("claude-haiku-5-5");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(updated.env.production.vars.MODEL_ID).toBe("claude-haiku-5-5");
    // El evaluador de CRAG conserva Sonnet y sus tarifas, distintas de las del generador.
    const evaluatorVars = updated.env.production.vars as Record<string, unknown>;
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(evaluatorVars.EVALUATOR_MODEL_ID).toBe("claude-sonnet-5-5");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(evaluatorVars.EVALUATOR_INPUT_USD_PER_MILLION).toBe("2");
  });

  // Verifica este escenario: no inventa un destino ni cambia un proveedor ajeno.
  it("no inventa un destino ni cambia un proveedor ajeno", () => {
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => withCourseQualityProfile({})).toThrow("Falta env");
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() =>
      withCourseQualityProfile({ env: { production: { vars: { LLM_PROVIDER: "gemini" } } } }),
    ).toThrow("usa otro proveedor");
  });
});
