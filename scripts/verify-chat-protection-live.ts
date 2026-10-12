// GUÍA DE LECTURA · scripts/verify-chat-protection-live.ts
// Comprueba en producción que el chat rechaza peticiones sin origen, cookie o token y aplica el límite de
// sesión, sin gastar presupuesto. Solo con --execute; guarda la evidencia en docs/evidence.
// Escritura de archivos.
import { writeFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Ejecutor de wrangler.
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";
// Parser de JSON.
import { parseJsonText } from "./wrangler-parse";
// Sin --execute no hay red.
if (!process.argv.includes("--execute")) {
  // Mensaje.
  console.log("Verificación de rechazos preparada; sin --execute no hay red.");
  // Sale.
  process.exit(0);
}
// Raíz.
const root = path.resolve(import.meta.dirname, "..");
// Origen publicado.
const origin = "https://rag-thepower.josenuevo.dev";
// Ejecutor.
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
// Lee el presupuesto público de D1.
async function budget() {
  // Consulta con wrangler.
  const run = await runner.run(
    // d1 execute en remoto con el config del build de producción.
    [
      "d1",
      "execute",
      "thepower-ai-course-rag-d1",
      "--remote",
      "--config",
      path.join(root, "apps/web/dist/thepower_rag/wrangler.json"),
      // Salida JSON y lectura del contador del presupuesto.
      "--json",
      "--command",
      "SELECT reserved_usd,turns FROM public_budget WHERE id='course-2026'",
    ],
    scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
  );
  // Fallo.
  if (run.code !== 0) throw new Error("No se pudo leer el presupuesto.");
  // Fila del presupuesto.
  return (parseJsonText(run.stdout) as { results: { reserved_usd: number; turns: number }[] }[])[0]!
    .results[0]!;
}
// Presupuesto antes.
const before = await budget();
// Sesión de seguridad.
const bootstrap = await fetch(origin + "/api/security");
// Cookie.
const cookieHeader = bootstrap.headers.get("set-cookie");
// Sin sesión: error.
if (!bootstrap.ok || !cookieHeader) throw new Error("No hay sesión de prueba.");
// Configuración.
const config = (await bootstrap.json()) as { enabled: boolean; siteKey: string };
// Protección desactivada: error.
if (!config.enabled) throw new Error("Protección desactivada.");
// Cookie nombre=valor.
const cookie = cookieHeader.split(";")[0]!;
// Cuerpo de prueba.
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
// Observaciones.
const observations = [];
// Cada caso que debe rechazarse.
for (const name of ["no-origin", "no-cookie", "tampered-cookie", "no-token", "invalid-token"]) {
  // Cabeceras.
  const headers: Record<string, string> = { "content-type": "application/json" };
  // Con origen salvo en no-origin.
  if (name !== "no-origin") headers.origin = origin;
  // Con cookie salvo en no-cookie; alterada en tampered-cookie.
  if (name !== "no-cookie")
    headers.cookie =
      name === "tampered-cookie"
        ? cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a")
        : cookie;
  // Token inválido.
  if (name === "invalid-token") headers["x-turnstile-token"] = "synthetic-invalid-token";
  // Envía.
  const response = await fetch(origin + "/api/chat", { method: "POST", headers, body });
  // Cuerpo.
  const value = (await response.json()) as { message?: string };
  // Registra.
  observations.push({ name, status: response.status, message: value.message });
  // Debe ser 403.
  if (response.status !== 403) throw new Error("No se rechazó " + name);
}
// ¿Se vio el límite?
let limited = false;
// Hasta 15 envíos sin token.
for (let n = 0; n < 15; n++) {
  // Envía.
  const response = await fetch(origin + "/api/chat", {
    method: "POST",
    headers: { origin, cookie, "content-type": "application/json" },
    body,
  });
  // Registra.
  observations.push({
    name: "session-rate-" + n,
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
  });
  // Límite alcanzado.
  if (response.status === 429) {
    // Visto.
    limited = true;
    // Sale.
    break;
  }
  // El resto deben ser 403.
  if (response.status !== 403) throw new Error("Un envío sin token no fue rechazado.");
}
// Debe verse el límite.
if (!limited) throw new Error("No se observó el límite de sesión en la prueba acotada.");
// Presupuesto después.
const after = await budget();
// Evidencia.
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
// Guarda la evidencia.
writeFileSync(
  path.join(root, "docs/evidence/chat-protection/rejections-live.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
// Muestra.
console.log(receipt);
// Si cambió el presupuesto, error.
if (!receipt.noBudgetChange)
  throw new Error(
    "El presupuesto cambió durante la prueba; revisar concurrencia antes de atribuirlo.",
  );
