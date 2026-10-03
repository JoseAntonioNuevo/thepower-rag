import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { semanticIdentity, type PreparedCorpus } from "@thepower-rag/core";
import { describe, expect, it } from "vite-plus/test";
import { COURSE_DESTINATION } from "./course-destination";
import { spawnWranglerBridge, startLoopbackBridge } from "./loopback-bridge";

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
      server.close(() => resolve(address.port));
    });
  });
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function runActivate(
  args: readonly string[],
  extra: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const env = { ...process.env, ...extra };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.OPENROUTER_API_KEY;
  return new Promise((resolve, reject) => {
    const child = spawn("bun", ["scripts/activate.ts", ...args], {
      cwd: root,
      env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
      reject(new Error(`activate superó el tiempo: ${args.join(" ")}`));
    }, 90_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

describe("entrypoint offline", () => {
  it("la simulación no abre el puente", async () => {
    const port = await freePort();
    const started = Date.now();
    const dry = await runActivate(["plan"], {
      THEPOWER_OFFLINE_ENTRY: "emulated",
      THEPOWER_BRIDGE_PORT: String(port),
    });
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("simulación");
    expect(Date.now() - started).toBeLessThan(8_000);
    const unread = await runActivate(["probe-embeddings"], {
      THEPOWER_OFFLINE_ENTRY: "emulated",
      THEPOWER_BRIDGE_PORT: String(port),
    });
    expect(unread.code, unread.stdout).toBe(0);
    expect(unread.stdout).toContain("simulación");
    expect(await listening(port)).toBe(false);
  });

  it("el workerd real exige el testigo y se apaga", async () => {
    const port = await freePort();
    const directory = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-entry-"));
    const token = "testigo-entrypoint-local-1";
    const wrangler = path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js");
    const started = await startLoopbackBridge(
      {
        accountId: COURSE_DESTINATION.accountId,
        port,
        inspectorPort: port + 1,
        token,
        projectRoot: root,
        role: "probe",
        remote: false,
        persistDir: path.join(directory, "state"),
      },
      {
        timeoutMs: 60_000,
        command: wrangler,
        spawn: spawnWranglerBridge(wrangler, root, COURSE_DESTINATION.accountId),
        fetch: async (url, init) => {
          const response = await fetch(url, init);
          const body = (await response.json().catch(() => null)) as {
            ok?: boolean;
            bind?: string;
          } | null;
          return { status: response.status, body: body ?? undefined };
        },
      },
    );
    expect(started.attempts).toBeGreaterThan(1);
    const wrong = await fetch(`http://127.0.0.1:${String(port)}/bridge/ready`, {
      headers: { "x-thepower-bridge": "otro-testigo-que-no-sirve" },
    });
    expect(wrong.status).toBe(404);
    const right = await fetch(`http://127.0.0.1:${String(port)}/bridge/ready`, {
      headers: { "x-thepower-bridge": token },
    });
    expect(right.status).toBe(200);
    await started.shutdown();
    expect(await listening(port)).toBe(false);
    await rm(directory, { recursive: true, force: true });
  }, 90_000);

  it("el CLI recorre sonda, ingesta, reanudación, selección y verificación", async () => {
    const corpus = JSON.parse(
      await readFile(path.join(root, "corpus/prepared/corpus.json"), "utf8"),
    ) as PreparedCorpus;
    const profileId = semanticIdentity(corpus, 32).id;
    const port = await freePort();
    const authDir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-auth-"));
    const authPath = path.join(authDir, "auth.json");
    await writeFile(
      authPath,
      `${JSON.stringify(
        {
          accountId: COURSE_DESTINATION.accountId,
          accountName: COURSE_DESTINATION.accountName,
          loginEmail: COURSE_DESTINATION.loginEmail,
          allowCreateD1: true,
          allowCreateR2: false,
          allowCreateVectorize: false,
          allowWorkersAi: true,
          allowOpenRouter: true,
          modelId: "local-emulated-generator",
          maxSpendUsd: 5,
          allowPlanChange: false,
          observedDimensions: 32,
        },
        null,
        2,
      )}\n`,
    );
    const base = {
      THEPOWER_OFFLINE_ENTRY: "emulated",
      THEPOWER_OFFLINE_AUTH: authPath,
      THEPOWER_BRIDGE_PORT: String(port),
    };
    const probeDir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-probe-"));
    const first = await runActivate(["probe-embeddings", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: probeDir,
      THEPOWER_SESSION_LIMITS: "probe",
    });
    expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
    const receiptPath = path.join(probeDir, "probe-embeddings.json");
    const receiptText = await readFile(receiptPath, "utf8");
    const receipt = JSON.parse(receiptText) as {
      provenance: string;
      live: boolean | null;
      usableForRemoteIndex: boolean;
      dimensions: number;
      providerRevision: string | null;
      measuredChargeUsd: number | null;
    };
    expect(receipt).toMatchObject({
      provenance: "local-native-emulation",
      live: false,
      usableForRemoteIndex: false,
      dimensions: 32,
      providerRevision: null,
      measuredChargeUsd: null,
    });
    expect(first.stdout).not.toContain("BRIDGE_TOKEN");
    const second = await runActivate(["probe-embeddings", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: probeDir,
      THEPOWER_SESSION_LIMITS: "probe",
    });
    expect(second.code, second.stdout).toBe(2);
    expect(second.stdout).toContain("tope");
    expect(await readFile(receiptPath, "utf8")).toBe(receiptText);
    expect(await listening(port)).toBe(false);

    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-ingest-"));
    const ingested = await runActivate(["ingest", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    expect(ingested.code, `${ingested.stdout}\n${ingested.stderr}`).toBe(0);
    expect(ingested.stdout).toContain("ingesta");
    const resumed = await runActivate(["resume", "--execute", `--profile=${profileId}`], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    expect(resumed.code, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    expect(resumed.stdout).not.toContain("lectura administrativa");
    const selected = await runActivate(["select-active", "--execute", `--profile=${profileId}`], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    expect(selected.code, `${selected.stdout}\n${selected.stderr}`).toBe(0);
    expect(selected.stdout).toContain(profileId);
    const verified = await runActivate(["verify", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    expect(verified.code, `${verified.stdout}\n${verified.stderr}`).toBe(0);
    const verifyBody = JSON.parse(await readFile(path.join(sessionDir, "verify.json"), "utf8")) as {
      provenance: string;
      live: boolean | null;
      receipt: {
        generativeCalls: number;
        syntheticError: boolean;
        turns: { id: string; ok: boolean }[];
      };
    };
    expect(verifyBody.provenance).toBe("local-native-emulation");
    expect(verifyBody.live).toBe(false);
    expect(verifyBody.receipt.syntheticError).toBe(true);
    expect(verifyBody.receipt.generativeCalls).toBeLessThanOrEqual(4);
    expect(verifyBody.receipt.turns.every((turn) => turn.ok)).toBe(true);
    const cachePath = path.join(sessionDir, "cache", `${profileId}.json`);
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { provenance: string };
    cache.provenance = "fixture";
    await writeFile(cachePath, JSON.stringify(cache));
    const mismatched = await runActivate(["resume", "--execute", `--profile=${profileId}`], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    expect(mismatched.code, mismatched.stdout).toBe(2);
    expect(mismatched.stdout).toContain("procedencia");
    expect(await listening(port)).toBe(false);
    await rm(authDir, { recursive: true, force: true });
    await rm(probeDir, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
  }, 180_000);
});
