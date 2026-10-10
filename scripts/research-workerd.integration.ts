import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DEMO_RESEARCH_QUESTION, researchSummarySchema } from "@thepower-rag/contracts";
import { describe, expect, it } from "vite-plus/test";

const root = path.resolve(import.meta.dirname, "..");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("No se pudo reservar un puerto local."));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

function stop(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

describe("investigación en workerd", () => {
  it("el worker de demostración recorre un guion sin proveedor de pago", async () => {
    const port = await freePort();
    const inspector = await freePort();
    const directory = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-research-"));
    const configPath = path.join(directory, "wrangler.json");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "thepower-rag-research-entry",
        compatibility_date: "2026-10-02",
        compatibility_flags: ["nodejs_compat"],
        main: path.join(root, "apps/api/src/worker.ts"),
        vars: { APP_MODE: "demo" },
      }),
    );
    const wrangler = path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CI: "1",
      BROWSER: "none",
      WRANGLER_SEND_METRICS: "false",
    };
    delete env.CLOUDFLARE_API_TOKEN;
    delete env.CLOUDFLARE_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.FIRECRAWL_API_KEY;
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
    let logs = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      logs += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      logs += chunk;
    });
    const base = `http://127.0.0.1:${String(port)}`;
    try {
      interface HealthBody {
        runtime?: string;
        execution?: string;
        capabilities?: { research?: { status?: string } };
      }
      let health: HealthBody | null = null;
      for (let attempt = 0; attempt < 80 && health === null; attempt += 1) {
        if (child.exitCode !== null) {
          throw new Error(`workerd terminó antes de estar listo.\n${logs.slice(-2_000)}`);
        }
        try {
          const response = await fetch(`${base}/api/health`);
          if (response.status === 200) {
            health = (await response.json()) as HealthBody;
          }
        } catch {
          // workerd todavía no escucha.
        }
        if (health === null) {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      expect(health?.runtime).toBe("Cloudflare-Workers");
      expect(health?.execution).toBe("demo");
      expect(health?.capabilities?.research?.status).toBe("offline-fixture");
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
      expect(response.status).toBe(200);
      expect(response.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
      const body = await response.text();
      const events = body
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
        .map(
          (line) => JSON.parse(line.slice("data: ".length)) as { type?: string; data?: unknown },
        );
      const event = events.find((item) => item.type === "data-research");
      if (event === undefined) {
        throw new Error("La respuesta no trae el resumen de investigación.");
      }
      const summary = researchSummarySchema.parse(event.data);
      expect(summary.fixture).toBe(true);
      expect(summary.route).toBe("tool");
      expect(summary.outcome).toBe("complete");
      expect(summary.toolCalls[0]?.args).toEqual({ sessionId: "S12", audience: "M/J" });
      expect(body).not.toContain(DEMO_RESEARCH_QUESTION);
    } finally {
      stop(child);
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
