// GUÍA DE LECTURA · scripts/configure-production.ts
// Genera apps/web/wrangler.jsonc para producción a partir de D1 y de la calibración guardada. Solo lee
// con --read; nunca despliega. Producción usa siempre Claude Haiku 5.5 por la API de Anthropic.
// AVISO: es el generador histórico del primer despliegue. Reescribe el archivo completo en JSON sin
// comentarios y solo conserva el entorno «local» y la protección del chat: el entorno «research» y los
// bindings de S12 (RESEARCH_DB, RESEARCH_MEDIA, Workflow, Tavily) se perderían. Revisa el diff antes de
// aceptar su salida.
// Lectura y escritura de archivos.
import { readFileSync, writeFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Ejecutor de wrangler con un entorno acotado.
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
// Extrae el UUID de D1.
import { databaseUuid } from "./course-executor";
// Parser de JSON de wrangler.
import { parseJsonText } from "./wrangler-parse";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";
// Raíz del repositorio.
const root = path.resolve(import.meta.dirname, "..");
// Ejecutor de wrangler.
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
// Sin --read solo explica qué haría.
if (!process.argv.includes("--read")) {
  // Mensaje.
  console.log("Preparado: --read consulta D1 y genera configuración local; no despliega.");
  // Sale.
  process.exit(0);
}
// Lee la información de D1 con wrangler.
const result = await runner.run(
  ["d1", "info", "thepower-ai-course-rag-d1", "--json"],
  scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
);
// UUID de la base.
const databaseId = databaseUuid(parseJsonText(result.stdout));
// Sin UUID confirmado: error.
if (result.code !== 0 || !databaseId) throw new Error("No hay UUID confirmado de D1");
// Calibración del umbral y del perfil.
const calibration = JSON.parse(
  readFileSync(path.join(root, "activation-receipts/calibration.json"), "utf8"),
);
// Configuración del Worker.
const config = {
  // Esquema para el editor.
  $schema: "./node_modules/wrangler/config-schema.json",
  // Nombre del Worker.
  name: "thepower-rag",
  // Cuenta de Cloudflare.
  account_id: COURSE_DESTINATION.accountId,
  // Fecha de compatibilidad del runtime.
  compatibility_date: "2026-10-02",
  // APIs de Node en Workers.
  compatibility_flags: ["nodejs_compat"],
  // Punto de entrada del Worker.
  main: "../api/src/worker.ts",
  // Archivos estáticos de la web; /api/* pasa antes por el Worker.
  assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
  // Modo por defecto: demo.
  vars: { APP_MODE: "demo" },
  // Entornos.
  env: {
    // Producción.
    production: {
      // Mismo nombre.
      name: "thepower-rag",
      // Sin subdominio workers.dev.
      workers_dev: false,
      // Sin URLs de vista previa.
      preview_urls: false,
      // Variables de producción.
      vars: {
        // Modo real.
        APP_MODE: "real",
        // RAG con el contexto completo del curso.
        RAG_CONTEXT_MODE: "complete",
        // Producción usa siempre Claude por la API de Anthropic.
        LLM_PROVIDER: "anthropic",
        // Modelo generador.
        MODEL_ID: "claude-haiku-5-5",
        // Modelo evaluador de CRAG.
        EVALUATOR_MODEL_ID: "claude-haiku-5-5",
        // Modelo de investigación.
        RESEARCH_MODEL_ID: "claude-haiku-5-5",
        // Modelo de embeddings calibrado.
        EMBEDDING_MODEL: calibration.embeddingModel,
        // Dimensiones.
        EMBEDDING_DIMENSIONS: String(calibration.dimensions),
        // Versión del corpus.
        CORPUS_VERSION: "c3a59a406888b",
        // Perfil del índice.
        INDEX_PROFILE: calibration.profileId,
        // Métrica.
        VECTOR_METRIC: "cosine",
        // Umbral calibrado.
        MIN_RETRIEVAL_SCORE: String(calibration.minScore),
        // Presupuesto público.
        PUBLIC_BUDGET_USD: "4.3",
        // Tarifa de entrada del generador.
        MODEL_INPUT_USD_PER_MILLION: "0.1",
        // Tarifa de salida del generador.
        MODEL_OUTPUT_USD_PER_MILLION: "0.5",
        // Tarifa de entrada del evaluador.
        EVALUATOR_INPUT_USD_PER_MILLION: "0.1",
        // Tarifa de salida del evaluador.
        EVALUATOR_OUTPUT_USD_PER_MILLION: "0.5",
      },
      // Workers AI remoto.
      ai: { binding: "AI", remote: true },
      // Índice Vectorize del perfil.
      vectorize: [
        {
          binding: "VECTORIZE",
          index_name: "thepower-ai-course-rag-" + calibration.profileId.slice(1),
          remote: true,
        },
      ],
      // Base D1 con sus migraciones.
      d1_databases: [
        {
          binding: "DB",
          database_name: "thepower-ai-course-rag-d1",
          database_id: databaseId,
          migrations_dir: "../api/migrations",
          remote: true,
        },
      ],
      // Bucket R2 del corpus.
      r2_buckets: [
        { binding: "CORPUS", bucket_name: "thepower-ai-course-rag-corpus", remote: true },
      ],
      // Archivos estáticos.
      assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
    },
  },
};
// Configuración anterior. Se quitan los comentarios «//» de línea completa y las comas finales
// porque JSON.parse solo entiende JSON estricto, no JSONC.
const previous = JSON.parse(
  readFileSync(path.join(root, "apps/web/wrangler.jsonc"), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1"),
) as { env?: { production?: { vars?: Record<string, string>; ratelimits?: unknown } } };
// Variables de protección anteriores.
const protectionVars = previous.env?.production?.vars;
// Si había Turnstile y origen público.
if (protectionVars?.TURNSTILE_SITE_KEY && protectionVars.PUBLIC_ORIGIN) {
  // Se conservan.
  Object.assign(config.env.production.vars, {
    TURNSTILE_SITE_KEY: protectionVars.TURNSTILE_SITE_KEY,
    PUBLIC_ORIGIN: protectionVars.PUBLIC_ORIGIN,
  });
  // Y los límites de peticiones.
  Object.assign(config.env.production, { ratelimits: previous.env?.production?.ratelimits });
}
// Entorno local anterior.
const priorLocal = (previous.env as Record<string, unknown> | undefined)?.local;
// Se conserva.
if (priorLocal) Object.assign(config.env, { local: priorLocal });
// Escribe wrangler.jsonc.
writeFileSync(path.join(root, "apps/web/wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n");
// Resumen sin secretos.
console.log({
  databaseId,
  profileId: calibration.profileId,
  minScore: calibration.minScore,
  domain: "rag-thepower.josenuevo.dev",
});
