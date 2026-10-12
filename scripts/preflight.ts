// GUÍA DE LECTURA · scripts/preflight.ts
// Comprobación previa sin red: qué proveedor, modelos y bindings ve el Worker para cada capacidad y qué
// versiones de Bun, Node, Vite+ y dependencias hay instaladas. Nunca imprime claves.
// Ejecuta comandos.
import { execFileSync } from "node:child_process";
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Informe de configuración del Worker local.
import { formatPreflight, loadLocalWorkerConfig } from "./local-worker-config";

// Raíz del repositorio.
const root = path.resolve(import.meta.dirname, "..");

// Lee un JSON.
function readJson(file: string): unknown {
  // Parseado.
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

// Versión de un package.json.
function packageVersion(file: string): string {
  // JSON.
  const parsed = readJson(file);
  // Tiene version.
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    // Versión.
    return parsed.version;
  }
  // Sin versión.
  return "desconocida";
}

// Versión declarada de una dependencia en un package.json.
function dependencyVersion(manifest: string, name: string): string {
  // JSON.
  const parsed = readJson(manifest);
  // No es objeto.
  if (typeof parsed !== "object" || parsed === null) {
    // Ausente.
    return "ausente";
  }
  // Busca en dependencias, de desarrollo y overrides.
  for (const section of ["dependencies", "devDependencies", "overrides"]) {
    // Sección.
    const bucket = (parsed as Record<string, unknown>)[section];
    // Si la contiene.
    if (typeof bucket === "object" && bucket !== null && name in bucket) {
      // Valor.
      const value = (bucket as Record<string, unknown>)[name];
      // Si es texto.
      if (typeof value === "string") {
        // Versión.
        return value;
      }
    }
  }
  // No declarada.
  return "ausente";
}

// Argumentos.
const argv = process.argv.slice(2);
// Capacidad pedida.
let capability: "sin-rag" | "rag" | "crag" | "research" | undefined;
// Entorno de wrangler.
let environment: string | null = null;
// Configuración alternativa.
let configPath: string | undefined;
// Lee los argumentos.
for (let index = 0; index < argv.length; index += 1) {
  // Opción.
  const flag = argv[index];
  // Valor.
  const value = argv[index + 1];
  // --capability con un valor válido.
  if (
    flag === "--capability" &&
    (value === "sin-rag" || value === "rag" || value === "crag" || value === "research")
  ) {
    // Capacidad.
    capability = value;
    // Salta el valor.
    index += 1;
  } else if (flag === "--env" && value !== undefined) {
    // --env.
    environment = value;
    // Salta.
    index += 1;
  } else if (flag === "--config" && value !== undefined) {
    // --config.
    configPath = path.resolve(root, value);
    // Salta.
    index += 1;
  } else if (flag === "--capability") {
    // Capacidad desconocida.
    console.log("capacidad no reconocida");
    // Código 2.
    process.exit(2);
  }
}
// Selección.
const selection = { capability, environment, configPath };
// Informe.
const report = formatPreflight(loadLocalWorkerConfig(root, selection), process.env, selection);
// Lo imprime.
console.log(report.lines.join("\n"));
// Versión de Bun.
console.log(`bun: ${process.versions.bun ?? "ausente"}`);
// Node del sistema.
try {
  // Versión.
  console.log(
    `node del sistema: ${execFileSync("node", ["--version"], { encoding: "utf8" }).trim()}`,
  );
} catch {
  // No disponible.
  console.log("node del sistema: no se pudo ejecutar");
}
// Node de Bun.
console.log(`node informado por Bun: ${process.versions.node}`);
// Vite+ instalado.
console.log(
  `vite-plus instalado: ${packageVersion(path.join(root, "node_modules/vite-plus/package.json"))}`,
);
// vp local.
try {
  // Versión.
  const version = execFileSync(path.join(root, "node_modules/.bin/vp"), ["--version"], {
    encoding: "utf8",
    cwd: root,
  }).trim();
  // Primera línea.
  console.log(`vp local: ${version.split("\n")[0] ?? version}`);
} catch (error) {
  // Error.
  const message = error instanceof Error ? error.message : "no se pudo ejecutar";
  // Mensaje.
  console.log(`vp local: error (${message.split("\n")[0] ?? message})`);
}
// Cabecera.
console.log("versiones directas declaradas:");
// package.json raíz.
const rootManifest = path.join(root, "package.json");
// Dependencias que se muestran.
for (const [manifest, name] of [
  // Herramientas: Vite+, TypeScript y dotenv.
  [rootManifest, "vite-plus"],
  [rootManifest, "typescript"],
  [rootManifest, "dotenv"],
  // Interfaz: React y el cliente de chat del AI SDK.
  [path.join(root, "apps/web/package.json"), "react"],
  [path.join(root, "apps/web/package.json"), "@ai-sdk/react"],
  // API: Hono, AI SDK, Anthropic y LangGraph.
  [path.join(root, "apps/api/package.json"), "hono"],
  [path.join(root, "apps/api/package.json"), "ai"],
  [path.join(root, "apps/api/package.json"), "@ai-sdk/anthropic"],
  [path.join(root, "apps/api/package.json"), "@langchain/langgraph"],
  [path.join(root, "apps/api/package.json"), "@langchain/core"],
  // Contratos y Cloudflare.
  [path.join(root, "packages/contracts/package.json"), "zod"],
  [path.join(root, "apps/web/package.json"), "wrangler"],
  [path.join(root, "apps/web/package.json"), "@cloudflare/vite-plugin"],
] as const) {
  // Versión declarada.
  console.log(`  ${name}: ${dependencyVersion(manifest, name)}`);
}
// Código del informe: 0 si todo está listo.
process.exitCode = report.code;
