import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { formatPreflight, loadLocalWorkerConfig } from "./local-worker-config";

const root = path.resolve(import.meta.dirname, "..");

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8")) as unknown;
}

function packageVersion(file: string): string {
  const parsed = readJson(file);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "version" in parsed &&
    typeof parsed.version === "string"
  ) {
    return parsed.version;
  }
  return "desconocida";
}

function dependencyVersion(manifest: string, name: string): string {
  const parsed = readJson(manifest);
  if (typeof parsed !== "object" || parsed === null) {
    return "ausente";
  }
  for (const section of ["dependencies", "devDependencies", "overrides"]) {
    const bucket = (parsed as Record<string, unknown>)[section];
    if (typeof bucket === "object" && bucket !== null && name in bucket) {
      const value = (bucket as Record<string, unknown>)[name];
      if (typeof value === "string") {
        return value;
      }
    }
  }
  return "ausente";
}

const argv = process.argv.slice(2);
let capability: "sin-rag" | "rag" | "crag" | undefined;
let environment: string | null = null;
let configPath: string | undefined;
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index];
  const value = argv[index + 1];
  if (flag === "--capability" && (value === "sin-rag" || value === "rag" || value === "crag")) {
    capability = value;
    index += 1;
  } else if (flag === "--env" && value !== undefined) {
    environment = value;
    index += 1;
  } else if (flag === "--config" && value !== undefined) {
    configPath = path.resolve(root, value);
    index += 1;
  } else if (flag === "--capability") {
    console.log("capacidad no reconocida");
    process.exit(2);
  }
}
const selection = { capability, environment, configPath };
const report = formatPreflight(loadLocalWorkerConfig(root, selection), process.env, selection);
console.log(report.lines.join("\n"));
console.log(`bun: ${process.versions.bun ?? "ausente"}`);
try {
  console.log(
    `node del sistema: ${execFileSync("node", ["--version"], { encoding: "utf8" }).trim()}`,
  );
} catch {
  console.log("node del sistema: no se pudo ejecutar");
}
console.log(`node informado por Bun: ${process.versions.node}`);
console.log(
  `vite-plus instalado: ${packageVersion(path.join(root, "node_modules/vite-plus/package.json"))}`,
);
try {
  const version = execFileSync(path.join(root, "node_modules/.bin/vp"), ["--version"], {
    encoding: "utf8",
    cwd: root,
  }).trim();
  console.log(`vp local: ${version.split("\n")[0] ?? version}`);
} catch (error) {
  const message = error instanceof Error ? error.message : "no se pudo ejecutar";
  console.log(`vp local: error (${message.split("\n")[0] ?? message})`);
}
console.log("versiones directas declaradas:");
const rootManifest = path.join(root, "package.json");
for (const [manifest, name] of [
  [rootManifest, "vite-plus"],
  [rootManifest, "typescript"],
  [rootManifest, "dotenv"],
  [path.join(root, "apps/web/package.json"), "react"],
  [path.join(root, "apps/web/package.json"), "@ai-sdk/react"],
  [path.join(root, "apps/api/package.json"), "hono"],
  [path.join(root, "apps/api/package.json"), "ai"],
  [path.join(root, "apps/api/package.json"), "@openrouter/ai-sdk-provider"],
  [path.join(root, "apps/api/package.json"), "@langchain/langgraph"],
  [path.join(root, "apps/api/package.json"), "@langchain/core"],
  [path.join(root, "packages/contracts/package.json"), "zod"],
  [path.join(root, "apps/web/package.json"), "wrangler"],
  [path.join(root, "apps/web/package.json"), "@cloudflare/vite-plugin"],
] as const) {
  console.log(`  ${name}: ${dependencyVersion(manifest, name)}`);
}
process.exitCode = report.code;
