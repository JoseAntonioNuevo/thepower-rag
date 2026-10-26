// GUÍA DE LECTURA · scripts/production-quality-config.ts
// Aplica Sonnet conservando entornos, bindings, protección, investigación y límites de gasto.
import { COURSE_QUALITY_PROFILE } from "../apps/api/src/course-models";

// Objeto JSON o error antes de producir una configuración incompleta.
function object(value: unknown, name: string): Record<string, unknown> {
  // Solo acepta un objeto de configuración; null y los arrays no contienen las claves esperadas.
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    // Nombra la sección ausente para evitar generar un destino parcial.
    throw new Error(`Falta ${name} en la configuración existente.`);
  }
  // Tras la comprobación de forma, permite leer las propiedades de esa sección.
  return value as Record<string, unknown>;
}

// Solo modifica los dos modelos, sus tarifas y el plazo. No autoriza despliegue ni más gasto.
export function withCourseQualityProfile(previous: unknown): Record<string, unknown> {
  // Clona la configuración para que el llamador conserve intacto su objeto original.
  const config = structuredClone(object(previous, "configuración"));
  // Exige el mapa de entornos ya existente en Wrangler.
  const environments = object(config.env, "env");
  // Aplica el perfil solo a los destinos production y local.
  for (const name of ["production", "local"]) {
    // Si local no existe, continúa sin inventar un entorno nuevo.
    if (name === "local" && environments.local === undefined) continue;
    // Comprueba que el destino actual tenga una configuración de objeto.
    const environment = object(environments[name], `env.${name}`);
    // Lee sus variables conservando el resto de bindings y recursos del entorno.
    const vars = object(environment.vars, `env.${name}.vars`);
    // Permite Anthropic o un proveedor aún no indicado y rechaza sustituir uno diferente.
    if (vars.LLM_PROVIDER !== undefined && vars.LLM_PROVIDER !== "anthropic") {
      // Obliga a resolver explícitamente un proveedor ajeno antes de aplicar este perfil.
      throw new Error(`El perfil ${name} usa otro proveedor; no se sustituye automáticamente.`);
    }
    // Actualiza los roles generativos, sus tarifas y plazos sobre las variables existentes.
    Object.assign(vars, {
      LLM_PROVIDER: "anthropic",
      MODEL_ID: COURSE_QUALITY_PROFILE.generator.modelId,
      EVALUATOR_MODEL_ID: COURSE_QUALITY_PROFILE.evaluator.modelId,
      CRAG_EXECUTION_BUDGET_MS: String(COURSE_QUALITY_PROFILE.cragBudgetMs),
      MODEL_TIMEOUT_MS: "30000",
      MODEL_INPUT_USD_PER_MILLION: String(COURSE_QUALITY_PROFILE.generator.inputUsdPerMillion),
      MODEL_OUTPUT_USD_PER_MILLION: String(COURSE_QUALITY_PROFILE.generator.outputUsdPerMillion),
      EVALUATOR_INPUT_USD_PER_MILLION: String(COURSE_QUALITY_PROFILE.evaluator.inputUsdPerMillion),
      EVALUATOR_OUTPUT_USD_PER_MILLION: String(
        COURSE_QUALITY_PROFILE.evaluator.outputUsdPerMillion,
      ),
    });
  }
  // Devuelve la copia preparada; esta función no escribe archivos ni despliega el Worker.
  return config;
}
