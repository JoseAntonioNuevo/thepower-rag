// GUÍA DE LECTURA · scripts/lab-aula.ts
// Arranca la consola docente solo en loopback. Compila su React con Bun, sin añadir otro
// servidor de desarrollo, tocar el Worker publicado o entregar lab/.env al navegador.
import path from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { AulaService } from "../lab/aula/service";
import { aulaAllowed, aulaHeaders, createAulaHandler } from "../lab/aula/http";

// Interfaz de las APIs instaladas de Bun que utiliza exclusivamente este ejecutable local.
interface AulaBun {
  build(options: {
    entrypoints: string[];
    outdir: string;
    target: "browser";
    minify: boolean;
    define: Record<string, string>;
  }): Promise<{ success: boolean; logs: unknown[] }>;
  file(file: string): Blob;
  serve(options: {
    hostname: string;
    port: number;
    idleTimeout: number;
    maxRequestBodySize: number;
    fetch: (request: Request) => Promise<Response>;
  }): { url: URL; stop(force: boolean): void };
}

// Directorios y opciones pertenecen a este clon y al presupuesto del laboratorio existente.
const root = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const port = Number(option("--port") ?? 5192);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Puerto del Aula no válido.");
const enabled = args.includes("--execute");
const limit = Number(option("--max-spend-usd") ?? 1);
if (enabled && !option("--max-spend-usd"))
  throw new Error(
    "Para ejecutar modelos indica --execute --max-spend-usd con el tope existente del laboratorio.",
  );
const moduleName = "bun";
const runtime = (await import(moduleName)) as AulaBun;
const assets = path.join(root, "lab/.local/aula-assets");
mkdirSync(assets, { recursive: true });
const build = await runtime.build({
  entrypoints: [path.join(root, "lab/ui/src/main.tsx")],
  outdir: assets,
  target: "browser",
  minify: false,
  define: { "process.env.NODE_ENV": JSON.stringify("development") },
});
if (!build.success) {
  console.error(build.logs);
  throw new Error("No se pudo compilar la consola del Aula.");
}
const service = new AulaService(root, enabled, limit);
let ready = false;
const api = createAulaHandler(service, port);
const server = runtime.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 0,
  maxRequestBodySize: 16_384,
  fetch: async (request) => {
    if (!ready)
      return new Response("Preparando el laboratorio", { status: 503, headers: aulaHeaders() });
    if (!aulaAllowed(request, port))
      return new Response("Origen no permitido", { status: 403, headers: aulaHeaders() });
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request);
    if (url.pathname === "/favicon.ico")
      return new Response(null, { status: 204, headers: aulaHeaders() });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Método no permitido", { status: 405 });
    if (url.pathname === "/")
      return new Response(readFileSync(path.join(root, "lab/ui/index.html"), "utf8"), {
        headers: { ...aulaHeaders(), "content-type": "text/html; charset=utf-8" },
      });
    const asset = { "/assets/main.js": "main.js", "/assets/main.css": "main.css" }[url.pathname];
    if (asset)
      return new Response(runtime.file(path.join(assets, asset)), { headers: aulaHeaders() });
    return new Response("No encontrado", { status: 404, headers: aulaHeaders() });
  },
});
try {
  await service.initialize();
  ready = true;
} catch (error) {
  server.stop(true);
  await service.close();
  throw error;
}
console.log(
  `Aula / Inspector: ${server.url.href}\nPostgreSQL: 127.0.0.1:54329/aether_rag\nLlamadas reales: ${enabled ? "activadas" : "desactivadas"}; tope acumulativo ${String(limit)} USD.`,
);
// Un cierre ordenado conserva reservas y rechaza cualquier pausa antes de liberar el bloqueo.
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await service.close();
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
