// GUÍA DE LECTURA · scripts/configure-production.ts
// Prepara Sonnet sobre el archivo existente sin perder S12 ni presupuestos.
// --read confirma D1 y muestra el plan; --read --write escribe el JSON local. Nunca despliega.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
import { databaseUuid } from "./course-executor";
import { parseJsonText } from "./wrangler-parse";
import { COURSE_DESTINATION } from "./course-destination";
import { withCourseQualityProfile } from "./production-quality-config";
import { COURSE_QUALITY_PROFILE } from "../apps/api/src/course-models";

// Sin --read no se inicializa Wrangler ni se consulta la cuenta.
if (!process.argv.includes("--read")) {
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    "Plan Sonnet preparado. --read verifica el destino; --read --write escribe sin desplegar.",
  );
  // Termina el proceso tras completar esta rama del comando.
  process.exit(0);
}
// Ancla el destino al repositorio del script para no reescribir otra configuración por error.
const root = path.resolve(import.meta.dirname, "..");
// Conserva el mismo archivo que utiliza el Worker existente.
const filename = path.join(root, "apps/web/wrangler.jsonc");
// Lee JSONC quitando únicamente los comentarios de línea y las comas finales admitidas aquí.
const previous = JSON.parse(
  readFileSync(filename, "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1"),
);
// Aplica el perfil a una copia y conserva bindings, investigación y límites de presupuesto.
const prepared = withCourseQualityProfile(previous);
// Construye el ejecutor con la dependencia Wrangler del propio proyecto.
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
// La lectura contrasta la base existente con el destino fijado para el curso.
const result = await runner.run(
  ["d1", "info", "thepower-ai-course-rag-d1", "--json"],
  scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
);
// Extrae una identidad de base válida sin asumir que cualquier salida textual sea un éxito.
const databaseId = databaseUuid(parseJsonText(result.stdout));
// Encuentra DB para comparar su id configurado con el recurso leído.
const configured = previous.env?.production?.d1_databases?.find(
  (binding: { binding: string }) => binding.binding === "DB",
);
// Un destino distinto se investiga; no se reemplaza automáticamente.
if (result.code !== 0 || !databaseId || databaseId !== configured?.database_id) {
  // Detiene el recorrido con el diagnóstico: La base leída no coincide con el destino de producción existente.
  throw new Error("La base leída no coincide con el destino de producción existente.");
}
// Solo la opción explícita escribe el archivo local; esta rama no despliega recursos remotos.
if (process.argv.includes("--write")) {
  // Persiste el resultado en la ruta del recorrido para poder revisarlo después.
  writeFileSync(filename, JSON.stringify(prepared, null, 2) + "\n");
}
// Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
console.log({
  model: COURSE_QUALITY_PROFILE.modelId,
  cragBudgetMs: COURSE_QUALITY_PROFILE.cragBudgetMs,
  written: process.argv.includes("--write"),
  deployment: false,
});
