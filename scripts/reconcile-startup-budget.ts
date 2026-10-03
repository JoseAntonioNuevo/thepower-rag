import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
import { COURSE_DESTINATION } from "./course-destination";
import { parseJsonText } from "./wrangler-parse";
const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--execute")) {
  console.log(
    "Preparado: reconciliar el consumo conocido de OpenRouter y conservar 0,10 USD para cargos desconocidos. Sin --execute no hay red.",
  );
  process.exit(0);
}
const auth = JSON.parse(readFileSync(path.join(root, "apps/web/.activation.json"), "utf8"));
if (
  auth.accountId !== COURSE_DESTINATION.accountId ||
  auth.maxSpendUsd !== 5 ||
  !auth.allowOpenRouter
)
  throw new Error("La autorización no coincide.");
const receiptPath = path.join(root, "activation-receipts/startup-budget-reconciled.json");
try {
  readFileSync(receiptPath);
  throw new Error("La puesta en marcha ya se reconcilió; no se repite automáticamente.");
} catch (error) {
  if ((error as { code?: string }).code !== "ENOENT") throw error;
}
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
async function sql(command: string) {
  const result = await runner.run(
    [
      "d1",
      "execute",
      "thepower-ai-course-rag-d1",
      "--remote",
      "--config",
      path.join(root, "apps/web/dist/thepower_rag/wrangler.json"),
      "--json",
      "--command",
      command,
    ],
    scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
  );
  if (result.code !== 0) throw new Error("La operación de presupuesto falló");
  return parseJsonText(result.stdout) as {
    results: Record<string, number>[];
    meta: { changes: number };
  }[];
}
const before = (
  await sql("SELECT reserved_usd,turns FROM public_budget WHERE id='course-2026'")
)[0]!.results[0]!;
const key = parse(
  readFileSync(path.join(root, "apps/web/.dev.vars.production"), "utf8"),
).OPENROUTER_API_KEY;
const response = await fetch("https://openrouter.ai/api/v1/key", {
  headers: { Authorization: "Bearer " + key },
});
const data = (await response.json()) as {
  data?: { usage?: number; limit?: number; limit_reset?: string | null };
};
const usage = data.data?.usage;
if (
  !response.ok ||
  typeof usage !== "number" ||
  !Number.isFinite(usage) ||
  usage < 0 ||
  data.data?.limit !== 4.5 ||
  data.data.limit_reset !== null
)
  throw new Error("No hay lectura de consumo y límite verificable.");
// Keep an explicit reserve for unknown Cloudflare/provider adjustments. Never report it as actual cost.
const retainedUnknownReserveUsd = 0.1;
const after = usage * 1.25 + retainedUnknownReserveUsd;
if (after > before.reserved_usd!) throw new Error("No existe reserva sobrante demostrable.");
const changed = await sql(
  `UPDATE public_budget SET reserved_usd=${after} WHERE id='course-2026' AND turns=${before.turns} AND reserved_usd=${before.reserved_usd}`,
);
if (changed[0]!.meta.changes !== 1)
  throw new Error("Hubo otro turno durante la lectura. No se repite.");
const receipt = {
  at: new Date().toISOString(),
  accountId: COURSE_DESTINATION.accountId,
  before,
  knownOpenRouterUsageUsd: usage,
  retainedUnknownReserveUsd,
  after,
  method:
    "one-time startup reconciliation using dedicated-key reported total usage; 25% margin and 0.10 USD unknown reserve retained; turn counter preserved; conditional SQL prevents concurrent-turn loss",
};
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
console.log(receipt);
