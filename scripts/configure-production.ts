import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
import { databaseUuid } from "./course-executor";
import { parseJsonText } from "./wrangler-parse";
import { COURSE_DESTINATION } from "./course-destination";
const root = path.resolve(import.meta.dirname, "..");
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
if (!process.argv.includes("--read")) {
  console.log("Preparado: --read consulta D1 y genera configuración local; no despliega.");
  process.exit(0);
}
const result = await runner.run(
  ["d1", "info", "thepower-ai-course-rag-d1", "--json"],
  scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
);
const databaseId = databaseUuid(parseJsonText(result.stdout));
if (result.code !== 0 || !databaseId) throw new Error("No hay UUID confirmado de D1");
const calibration = JSON.parse(
  readFileSync(path.join(root, "activation-receipts/calibration.json"), "utf8"),
);
const config = {
  $schema: "./node_modules/wrangler/config-schema.json",
  name: "thepower-rag",
  account_id: COURSE_DESTINATION.accountId,
  compatibility_date: "2026-10-02",
  compatibility_flags: ["nodejs_compat"],
  main: "../api/src/worker.ts",
  assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
  vars: { APP_MODE: "demo" },
  env: {
    production: {
      name: "thepower-rag",
      workers_dev: false,
      preview_urls: false,
      vars: {
        APP_MODE: "real",
        RAG_CONTEXT_MODE: "complete",
        // Producción usa siempre Claude por la API de Anthropic.
        LLM_PROVIDER: "anthropic",
        MODEL_ID: "claude-haiku-5-5",
        EVALUATOR_MODEL_ID: "claude-haiku-5-5",
        RESEARCH_MODEL_ID: "claude-haiku-5-5",
        EMBEDDING_MODEL: calibration.embeddingModel,
        EMBEDDING_DIMENSIONS: String(calibration.dimensions),
        CORPUS_VERSION: "c3a59a406888b",
        INDEX_PROFILE: calibration.profileId,
        VECTOR_METRIC: "cosine",
        MIN_RETRIEVAL_SCORE: String(calibration.minScore),
        PUBLIC_BUDGET_USD: "4.3",
        MODEL_INPUT_USD_PER_MILLION: "0.1",
        MODEL_OUTPUT_USD_PER_MILLION: "0.5",
        EVALUATOR_INPUT_USD_PER_MILLION: "0.1",
        EVALUATOR_OUTPUT_USD_PER_MILLION: "0.5",
      },
      ai: { binding: "AI", remote: true },
      vectorize: [
        {
          binding: "VECTORIZE",
          index_name: "thepower-ai-course-rag-" + calibration.profileId.slice(1),
          remote: true,
        },
      ],
      d1_databases: [
        {
          binding: "DB",
          database_name: "thepower-ai-course-rag-d1",
          database_id: databaseId,
          migrations_dir: "../api/migrations",
          remote: true,
        },
      ],
      r2_buckets: [
        { binding: "CORPUS", bucket_name: "thepower-ai-course-rag-corpus", remote: true },
      ],
      assets: { not_found_handling: "single-page-application", run_worker_first: ["/api/*"] },
    },
  },
};
const previous = JSON.parse(
  readFileSync(path.join(root, "apps/web/wrangler.jsonc"), "utf8").replace(/,\s*([}\]])/g, "$1"),
) as { env?: { production?: { vars?: Record<string, string>; ratelimits?: unknown } } };
const protectionVars = previous.env?.production?.vars;
if (protectionVars?.TURNSTILE_SITE_KEY && protectionVars.PUBLIC_ORIGIN) {
  Object.assign(config.env.production.vars, {
    TURNSTILE_SITE_KEY: protectionVars.TURNSTILE_SITE_KEY,
    PUBLIC_ORIGIN: protectionVars.PUBLIC_ORIGIN,
  });
  Object.assign(config.env.production, { ratelimits: previous.env?.production?.ratelimits });
}
const priorLocal = (previous.env as Record<string, unknown> | undefined)?.local;
if (priorLocal) Object.assign(config.env, { local: priorLocal });
writeFileSync(path.join(root, "apps/web/wrangler.jsonc"), JSON.stringify(config, null, 2) + "\n");
console.log({
  databaseId,
  profileId: calibration.profileId,
  minScore: calibration.minScore,
  domain: "rag-thepower.josenuevo.dev",
});
