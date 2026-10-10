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

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    child.once("exit", () => resolve(undefined));
  });
}

function mutateHeaders(base: string, cookie: string): Record<string, string> {
  return {
    "content-type": "application/json",
    cookie,
    origin: new URL(base).origin,
  };
}

function cookieFrom(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const pieces = headers.getSetCookie?.() ?? [];
  const single = response.headers.get("set-cookie");
  const all = pieces.length > 0 ? pieces : single ? [single] : [];
  return all
    .map((item) => item.split(";")[0] ?? "")
    .filter((item) => item.length > 0)
    .join("; ");
}

async function boot(
  persist: string,
  port: number,
  inspector: number,
): Promise<{ child: ChildProcess; logs: () => string }> {
  const configPath = path.join(persist, `wrangler-${String(port)}.json`);
  await writeFile(
    configPath,
    JSON.stringify({
      name: "thepower-research-durable",
      compatibility_date: "2026-10-02",
      compatibility_flags: ["nodejs_compat"],
      main: path.join(root, "apps/api/src/research-worker.ts"),
      vars: {
        APP_MODE: "demo",
        RESEARCH_OWNER_SECRET: "local-loopback-research-owner",
        RESEARCH_BUDGET_USD: "1.000000",
        RESEARCH_JOB_LIMIT_USD: "0.250000",
        RESEARCH_INPUT_USD_PER_MILLION: "0.100000",
        RESEARCH_OUTPUT_USD_PER_MILLION: "0.500000",
        RESEARCH_SEARCH_USD: "0.002000",
        RESEARCH_READ_USD: "0.005000",
      },
      d1_databases: [
        {
          binding: "RESEARCH_DB",
          database_name: "thepower-research-local",
          database_id: "11111111-1111-4111-8111-111111111111",
          migrations_dir: path.join(root, "apps/api/migrations-research"),
        },
      ],
      workflows: [
        {
          name: "thepower-research-job",
          binding: "RESEARCH_WORKFLOW",
          class_name: "ResearchJobWorkflow",
        },
      ],
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
  delete env.CLOUDFLARE_ENV;
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
      "--persist-to",
      persist,
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
  return { child, logs: () => logs };
}

async function ready(base: string, child: ChildProcess, logs: () => string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`workerd terminó.\n${logs().slice(-2_000)}`);
    }
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.status === 200) {
        const body = (await response.json()) as { durableResearch?: boolean; execution?: string };
        if (body.durableResearch === true && body.execution === "demo") {
          return;
        }
      }
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`workerd no estuvo listo.\n${logs().slice(-2_000)}`);
}

describe("investigación durable en workerd", () => {
  it("completa el trabajo tras cerrar la petición y lo recupera con la misma persistencia", async () => {
    const persist = await mkdtemp(path.join(os.tmpdir(), "thepower-research-persist-"));
    const port = await freePort();
    const inspector = await freePort();
    const first = await boot(persist, port, inspector);
    const base = `http://127.0.0.1:${String(port)}`;
    try {
      await ready(base, first.child, first.logs);
      const session = await fetch(`${base}/api/research/session`);
      expect(session.status).toBe(200);
      const cookie = cookieFrom(session);
      expect(cookie).toContain("thepower-research-owner");
      const created = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "M/J" }),
      });
      if (created.status !== 201) {
        throw new Error(
          `${String(created.status)} ${await created.text()}\n${first.logs().slice(-3_000)}`,
        );
      }
      const conversation = (await created.json()) as { id: string };
      const submitted = await fetch(`${base}/api/research/conversations/${conversation.id}/jobs`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({
          idempotencyKey: "idem-workerd-1",
          question: DEMO_RESEARCH_QUESTION,
          scenarioId: "sufficient-first-round",
        }),
      });
      expect(submitted.status).toBe(202);
      const job = (await submitted.json()) as { jobId: string };
      let execution = "queued";
      for (let attempt = 0; attempt < 80 && execution !== "complete"; attempt += 1) {
        const status = await fetch(`${base}/api/research/jobs/${job.jobId}`, {
          headers: { cookie },
        });
        const body = (await status.json()) as {
          execution: string;
          attention: string | null;
          progress: string | null;
          dispatch: string;
        };
        execution = body.execution;
        if (execution === "attention" || execution === "failed" || execution === "cancelled") {
          throw new Error(`${JSON.stringify(body)}\n${first.logs().slice(-2_000)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(execution).toBe("complete");
      const result = await fetch(`${base}/api/research/jobs/${job.jobId}/result`, {
        headers: { cookie },
      });
      expect(result.status).toBe(200);
      const payload = (await result.json()) as {
        summary: unknown;
        report: { text: string } | null;
        reportAvailability: string;
      };
      const summary = researchSummarySchema.parse(payload.summary);
      expect(summary.outcome).toBe("complete");
      expect(summary.fixture).toBe(true);
      expect(payload.reportAvailability).toBe("stored");
      expect(payload.report?.text).toContain("Informe de prueba");
      const ambiguous = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "L/X" }),
      });
      const other = (await ambiguous.json()) as { id: string };
      const ambiguousJob = await fetch(`${base}/api/research/conversations/${other.id}/jobs`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({
          idempotencyKey: "idem-workerd-2",
          question: DEMO_RESEARCH_QUESTION,
          scenarioId: "ambiguous-operation",
        }),
      });
      expect(ambiguousJob.status).toBe(202);
      const ambiguousBody = (await ambiguousJob.json()) as { jobId: string };
      let ambiguousExecution = "queued";
      for (
        let attempt = 0;
        attempt < 80 && (ambiguousExecution === "queued" || ambiguousExecution === "running");
        attempt += 1
      ) {
        const status = await fetch(`${base}/api/research/jobs/${ambiguousBody.jobId}`, {
          headers: { cookie },
        });
        ambiguousExecution = ((await status.json()) as { execution: string }).execution;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(ambiguousExecution).toBe("attention");
      const recover = await fetch(`${base}/api/research/jobs/${ambiguousBody.jobId}/recover`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
      });
      expect(recover.status).toBe(409);
      const crashCreated = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "program" }),
      });
      const crashConversation = (await crashCreated.json()) as { id: string };
      const crashSubmitted = await fetch(
        `${base}/api/research/conversations/${crashConversation.id}/jobs`,
        {
          method: "POST",
          headers: mutateHeaders(base, cookie),
          body: JSON.stringify({
            idempotencyKey: "idem-workerd-crash",
            question: DEMO_RESEARCH_QUESTION,
            scenarioId: "crash-after-plan",
          }),
        },
      );
      expect(crashSubmitted.status).toBe(202);
      const crashJob = (await crashSubmitted.json()) as { jobId: string; runId: string };
      let crashExecution = "queued";
      let crashAttention: string | null = null;
      for (
        let attempt = 0;
        attempt < 80 && (crashExecution === "queued" || crashExecution === "running");
        attempt += 1
      ) {
        const status = await fetch(`${base}/api/research/jobs/${crashJob.jobId}`, {
          headers: { cookie },
        });
        const body = (await status.json()) as { execution: string; attention: string | null };
        crashExecution = body.execution;
        crashAttention = body.attention;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      expect(crashExecution).toBe("attention");
      expect(crashAttention).toBe("recoverable");
      stop(first.child);
      await waitExit(first.child);
      const port2 = await freePort();
      const inspector2 = await freePort();
      const second = await boot(persist, port2, inspector2);
      const base2 = `http://127.0.0.1:${String(port2)}`;
      try {
        await ready(base2, second.child, second.logs);
        const again = await fetch(`${base2}/api/research/jobs/${job.jobId}/result`, {
          headers: { cookie },
        });
        expect(again.status).toBe(200);
        const againPayload = (await again.json()) as {
          summary: unknown;
          report: { text: string } | null;
        };
        const restored = researchSummarySchema.parse(againPayload.summary);
        expect(restored.runId).toBe(summary.runId);
        expect(againPayload.report?.text).toContain("Informe de prueba");
        const sameRequest = await fetch(
          `${base2}/api/research/conversations/${conversation.id}/jobs`,
          {
            method: "POST",
            headers: mutateHeaders(base2, cookie),
            body: JSON.stringify({
              idempotencyKey: "idem-workerd-1",
              question: DEMO_RESEARCH_QUESTION,
              scenarioId: "sufficient-first-round",
            }),
          },
        );
        expect(sameRequest.status).toBe(202);
        expect(((await sameRequest.json()) as { jobId: string }).jobId).toBe(job.jobId);
        const messages = await fetch(`${base2}/api/research/conversations/${conversation.id}`, {
          headers: { cookie },
        });
        expect(messages.status).toBe(200);
        const still = await fetch(`${base2}/api/research/jobs/${ambiguousBody.jobId}/recover`, {
          method: "POST",
          headers: mutateHeaders(base2, cookie),
        });
        expect(still.status).toBe(409);
        const crashRecover = await fetch(`${base2}/api/research/jobs/${crashJob.jobId}/recover`, {
          method: "POST",
          headers: mutateHeaders(base2, cookie),
        });
        if (crashRecover.status !== 202) {
          throw new Error(`${String(crashRecover.status)} ${await crashRecover.text()}`);
        }
        let recovered = "running";
        for (
          let attempt = 0;
          attempt < 80 && (recovered === "queued" || recovered === "running");
          attempt += 1
        ) {
          const status = await fetch(`${base2}/api/research/jobs/${crashJob.jobId}`, {
            headers: { cookie },
          });
          const body = (await status.json()) as {
            execution: string;
            runId: string;
            operations: { kind: string; state: string }[];
            attention: string | null;
          };
          recovered = body.execution;
          if (recovered === "complete") {
            expect(body.runId).toBe(crashJob.runId);
            expect(body.operations.filter((operation) => operation.kind === "plan")).toEqual([
              { kind: "plan", state: "completed" },
            ]);
          }
          if (recovered === "attention" || recovered === "failed" || recovered === "cancelled") {
            throw new Error(`${JSON.stringify(body)}\n${second.logs().slice(-2_000)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        expect(recovered).toBe("complete");
        const crashResult = await fetch(`${base2}/api/research/jobs/${crashJob.jobId}/result`, {
          headers: { cookie },
        });
        const crashPayload = (await crashResult.json()) as { report: { text: string } };
        expect(crashPayload.report.text).toContain("Informe de prueba");
      } finally {
        stop(second.child);
        await waitExit(second.child);
      }
    } finally {
      stop(first.child);
      await rm(persist, { recursive: true, force: true });
    }
  }, 180_000);
});
