import { writeFileSync } from "node:fs";
import path from "node:path";
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
import { COURSE_DESTINATION } from "./course-destination";
import { parseJsonText } from "./wrangler-parse";
if (!process.argv.includes("--execute")) {
  console.log("Verificación de rechazos preparada; sin --execute no hay red.");
  process.exit(0);
}
const root = path.resolve(import.meta.dirname, "..");
const origin = "https://rag-thepower.josenuevo.dev";
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
async function budget() {
  const run = await runner.run(
    [
      "d1",
      "execute",
      "thepower-ai-course-rag-d1",
      "--remote",
      "--config",
      path.join(root, "apps/web/dist/thepower_rag/wrangler.json"),
      "--json",
      "--command",
      "SELECT reserved_usd,turns FROM public_budget WHERE id='course-2026'",
    ],
    scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
  );
  if (run.code !== 0) throw new Error("No se pudo leer el presupuesto.");
  return (parseJsonText(run.stdout) as { results: { reserved_usd: number; turns: number }[] }[])[0]!
    .results[0]!;
}
const before = await budget();
const bootstrap = await fetch(origin + "/api/security");
const cookieHeader = bootstrap.headers.get("set-cookie");
if (!bootstrap.ok || !cookieHeader) throw new Error("No hay sesión de prueba.");
const config = (await bootstrap.json()) as { enabled: boolean; siteKey: string };
if (!config.enabled) throw new Error("Protección desactivada.");
const cookie = cookieHeader.split(";")[0]!;
const body = JSON.stringify({
  mode: "sin-rag",
  audience: "program",
  messages: [
    {
      id: "negative-check",
      role: "user",
      parts: [{ type: "text", text: "Esta petición debe rechazarse antes del modelo." }],
    },
  ],
});
const observations = [];
for (const name of ["no-origin", "no-cookie", "tampered-cookie", "no-token", "invalid-token"]) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (name !== "no-origin") headers.origin = origin;
  if (name !== "no-cookie")
    headers.cookie =
      name === "tampered-cookie"
        ? cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a")
        : cookie;
  if (name === "invalid-token") headers["x-turnstile-token"] = "synthetic-invalid-token";
  const response = await fetch(origin + "/api/chat", { method: "POST", headers, body });
  const value = (await response.json()) as { message?: string };
  observations.push({ name, status: response.status, message: value.message });
  if (response.status !== 403) throw new Error("No se rechazó " + name);
}
let limited = false;
for (let n = 0; n < 15; n++) {
  const response = await fetch(origin + "/api/chat", {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body,
  });
  observations.push({
    name: "session-rate-" + n,
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
  });
  if (response.status === 429) {
    limited = true;
    break;
  }
  if (response.status !== 403) throw new Error("Un envío sin token no fue rechazado.");
}
if (!limited) throw new Error("No se observó el límite de sesión en la prueba acotada.");
const after = await budget();
const receipt = {
  at: new Date().toISOString(),
  origin,
  observations,
  cookieAttributes: {
    secure: cookieHeader.includes("Secure"),
    httpOnly: cookieHeader.includes("HttpOnly"),
    sameSiteStrict: cookieHeader.includes("SameSite=Strict"),
  },
  before,
  after,
  noBudgetChange: before.turns === after.turns && before.reserved_usd === after.reserved_usd,
};
writeFileSync(
  path.join(root, "docs/evidence/chat-protection/rejections-live.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(receipt);
if (!receipt.noBudgetChange)
  throw new Error(
    "El presupuesto cambió durante la prueba; revisar concurrencia antes de atribuirlo.",
  );
