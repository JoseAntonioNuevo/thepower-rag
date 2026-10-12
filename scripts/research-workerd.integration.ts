// GUÍA DE LECTURA · scripts/research-workerd.integration.ts
// Prueba de entrada en workerd real: arranca wrangler dev con el Worker de demo, comprueba /api/health, que
// los clientes de Tavily y Firecrawl no siguen redirecciones y que la investigación de demo funciona sin pago.
// Lanzar procesos.
import { spawn, type ChildProcess } from "node:child_process";
// Archivos temporales.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
// Sockets para buscar un puerto libre.
import net from "node:net";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Pregunta de demo y esquema del resumen.
import { DEMO_RESEARCH_QUESTION, researchSummarySchema } from "@thepower-rag/contracts";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");

// Reserva un puerto libre de 127.0.0.1.
function freePort(): Promise<number> {
  // Promesa con el puerto.
  return new Promise((resolve, reject) => {
    // Servidor temporal.
    const server = net.createServer();
    // Escucha en un puerto cualquiera.
    server.listen(0, "127.0.0.1", () => {
      // Dirección.
      const address = server.address();
      // Sin puerto.
      if (address === null || typeof address === "string") {
        // Error.
        reject(new Error("No se pudo reservar un puerto local."));
        // Sale.
        return;
      }
      // Puerto.
      const port = address.port;
      // Cierra y lo devuelve.
      server.close(() => resolve(port));
    });
  });
}

// Para un proceso hijo y su grupo.
function stop(child: ChildProcess): void {
  // Ya terminado.
  if (child.pid === undefined || child.exitCode !== null) {
    // Nada.
    return;
  }
  // Mata el grupo.
  try {
    // SIGTERM al grupo.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Si falla, solo al hijo.
    child.kill("SIGTERM");
  }
}

// Grupo.
describe("investigación en workerd", () => {
  // La demo recorre un guion sin proveedor de pago.
  it("el worker de demostración recorre un guion sin proveedor de pago", async () => {
    // Puerto.
    const port = await freePort();
    // Puerto del inspector.
    const inspector = await freePort();
    // Carpeta temporal.
    const directory = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-research-"));
    // Configuración.
    const configPath = path.join(directory, "wrangler.json");
    // Punto de entrada.
    const entryPath = path.join(directory, "worker.ts");
    // Worker de prueba que reenvía al real y añade una sonda de redirecciones.
    await writeFile(
      entryPath,
      `import worker from ${JSON.stringify(path.join(root, "apps/api/src/worker.ts"))};
import { createTavilySearch, createTavilyReader } from ${JSON.stringify(path.join(root, "apps/api/src/tavily.ts"))};
import { createFirecrawlSearch } from ${JSON.stringify(path.join(root, "apps/api/src/firecrawl.ts"))};
export default { async fetch(request, env, ctx) {
  if (new URL(request.url).pathname !== "/provider-redirect-probe") return worker.fetch(request, env, ctx);
  let calls = 0;
  const fakeFetch = async (url, init) => {
    const outbound = new Request(url, init); // Real workerd Request validation.
    calls++;
    if (outbound.redirect !== "manual") throw new Error("redirect-policy");
    return new Response(null, {status: 302, headers: {location: "https://other.example/"}});
  };
  const input = {apiKey: "test-key", fetch: fakeFetch};
  const context = {signal: new AbortController().signal, timeoutMs: 5000};
  const query = {query: "Vectorize", allowedDomains: ["developers.cloudflare.com"], limit: 1};
  const search = await createTavilySearch(input).search(query, context);
  const read = await createTavilyReader({...input, allowedDomains: query.allowedDomains}).read({url: "https://developers.cloudflare.com/vectorize/"}, context);
  const firecrawl = await createFirecrawlSearch({...input, usdPerCredit: 0.01}).search(query, context);
  return Response.json({calls, search, read, firecrawl});
}};`,
    );
    // Configuración de wrangler en demo.
    await writeFile(
      configPath,
      JSON.stringify({
        name: "thepower-rag-research-entry",
        compatibility_date: "2026-10-02",
        compatibility_flags: ["nodejs_compat"],
        main: entryPath,
        vars: { APP_MODE: "demo" },
      }),
    );
    // Ruta de wrangler.
    const wrangler = path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js");
    // Entorno sin métricas ni navegador.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CI: "1",
      BROWSER: "none",
      WRANGLER_SEND_METRICS: "false",
    };
    // Sin token de Cloudflare.
    delete env.CLOUDFLARE_API_TOKEN;
    // Sin clave de Cloudflare.
    delete env.CLOUDFLARE_API_KEY;
    // Sin clave de Anthropic.
    delete env.ANTHROPIC_API_KEY;
    // Sin clave de Firecrawl.
    delete env.FIRECRAWL_API_KEY;
    // wrangler dev local en 127.0.0.1.
    const child = spawn(
      process.execPath,
      [
        wrangler,
        "dev",
        "--config",
        configPath,
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--inspector-port",
        String(inspector),
        "--inspector-ip",
        "127.0.0.1",
        "--local",
        "--local-protocol",
        "http",
        "--no-show-interactive-dev-session",
        "--log-level",
        "error",
      ],
      { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    // Registros.
    let logs = "";
    // Texto.
    child.stdout?.setEncoding("utf8");
    // Texto.
    child.stderr?.setEncoding("utf8");
    // Acumula la salida.
    child.stdout?.on("data", (chunk: string) => {
      // Suma.
      logs += chunk;
    });
    // Acumula los errores.
    child.stderr?.on("data", (chunk: string) => {
      // Suma.
      logs += chunk;
    });
    // Origen local.
    const base = `http://127.0.0.1:${String(port)}`;
    // try/finally: para el proceso y borra la carpeta.
    try {
      // Forma de /api/health.
      interface HealthBody {
        // Runtime.
        runtime?: string;
        // Modo.
        execution?: string;
        // Capacidades.
        capabilities?: { research?: { status?: string } };
      }
      // Salud.
      let health: HealthBody | null = null;
      // Hasta 80 intentos.
      for (let attempt = 0; attempt < 80 && health === null; attempt += 1) {
        // El proceso terminó.
        if (child.exitCode !== null) {
          // Error con los registros.
          throw new Error(`workerd terminó antes de estar listo.\n${logs.slice(-2_000)}`);
        }
        // Puede no estar listo.
        try {
          // Pide la salud.
          const response = await fetch(`${base}/api/health`);
          // Lista.
          if (response.status === 200) {
            // Guarda.
            health = (await response.json()) as HealthBody;
          }
        } catch {
          // workerd todavía no escucha.
        }
        // Aún no.
        if (health === null) {
          // Espera 250 ms.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      // Runtime de Workers.
      expect(health?.runtime).toBe("Cloudflare-Workers");
      // Demo.
      expect(health?.execution).toBe("demo");
      // Investigación de prueba.
      expect(health?.capabilities?.research?.status).toBe("offline-fixture");
      // Sonda de redirecciones.
      const probe = await fetch(`${base}/provider-redirect-probe`);
      // Tres llamadas y ninguna sigue la redirección.
      expect(await probe.json()).toMatchObject({
        calls: 3,
        search: { ok: false, error: "provider", detail: "Tavily respondió HTTP 302." },
        read: { ok: false, error: "provider", detail: "Tavily respondió HTTP 302." },
        firecrawl: { ok: false, error: "provider", detail: "Firecrawl respondió HTTP 302." },
      });
      // Investigación con la herramienta.
      const response = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: base },
        body: JSON.stringify({
          mode: "research",
          audience: "M/J",
          researchScenario: "course-tool",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?",
                },
              ],
            },
          ],
        }),
      });
      // 200.
      expect(response.status).toBe(200);
      // Origen fixture.
      expect(response.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
      // Cuerpo.
      const body = await response.text();
      // Eventos.
      const events = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map(
          (line) => JSON.parse(line.slice("data: ".length)) as { type?: string; data?: unknown },
        );
      // Resumen.
      const event = events.find((item) => item.type === "data-research");
      // Sin resumen.
      if (event === undefined) {
        // Error.
        throw new Error("La respuesta no trae el resumen de investigación.");
      }
      // Validado.
      const summary = researchSummarySchema.parse(event.data);
      // De prueba.
      expect(summary.fixture).toBe(true);
      // Ruta tool.
      expect(summary.route).toBe("tool");
      // Completo.
      expect(summary.outcome).toBe("complete");
      // Argumentos.
      expect(summary.toolCalls[0]?.args).toEqual({ sessionId: "S12", audience: "M/J" });
      // No repite la pregunta de demo.
      expect(body).not.toContain(DEMO_RESEARCH_QUESTION);
    } finally {
      // Para wrangler.
      stop(child);
      // Borra la carpeta.
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
