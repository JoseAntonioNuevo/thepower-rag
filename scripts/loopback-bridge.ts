import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { COURSE_D1_NAME, COURSE_R2_NAME, COURSE_VECTORIZE_PREFIX } from "@thepower-rag/core";
import { COURSE_DESTINATION } from "./course-destination";
import { scopedWranglerEnv } from "./process-runner";

export type BridgeRole = "probe" | "storage" | "verify";

export interface BridgeSpec {
  accountId: string;
  port: number;
  inspectorPort: number;
  token: string;
  projectRoot: string;
  role: BridgeRole;
  remote: boolean;
  persistDir: string;
  indexName?: string;
  databaseId?: string;
  modelId?: string;
  evaluatorModelId?: string;
  profileId?: string;
  corpusVersion?: string;
  dimensions?: number;
  minScore?: number;
  apiKey?: string;
  metric?: string;
  metadataIndexes?: string[];
}

export interface SpawnedBridge {
  pid: number;
  kill: () => void;
  hasExited: () => boolean;
  waitForExit: () => Promise<number | null>;
}

export function assertLoopbackHost(ip: string): boolean {
  return ip === "127.0.0.1";
}

export function bridgeMainPath(projectRoot: string): string {
  return path.resolve(projectRoot, "apps/api/src/bridge-worker.ts");
}

export function bridgeWranglerConfig(spec: BridgeSpec): Record<string, unknown> {
  if (spec.accountId !== COURSE_DESTINATION.accountId) {
    throw new Error("La cuenta del puente no es la del curso.");
  }
  if (!assertLoopbackHost("127.0.0.1") || spec.port < 1 || spec.port > 65535) {
    throw new Error("El puerto del puente no es válido.");
  }
  if (spec.token.length < 16 || spec.token.includes("\n") || spec.token.includes(" ")) {
    throw new Error("El testigo del puente no es válido.");
  }
  const main = bridgeMainPath(spec.projectRoot);
  const config: Record<string, unknown> = {
    name: "thepower-rag-bridge",
    account_id: spec.accountId,
    compatibility_date: "2026-10-02",
    compatibility_flags: ["nodejs_compat"],
    main,
    workers_dev: false,
    preview_urls: false,
    dev: {
      ip: "127.0.0.1",
      port: spec.port,
      local_protocol: "http",
      inspector_ip: "127.0.0.1",
    },
    vars: {
      BRIDGE_ROLE: spec.role,
      BRIDGE_REMOTE: spec.remote ? "true" : "false",
    },
  };
  if (spec.role === "probe") {
    if (spec.remote) {
      config.ai = { binding: "AI", remote: true };
    }
    return config;
  }
  if (spec.indexName === undefined || !spec.indexName.startsWith(COURSE_VECTORIZE_PREFIX)) {
    throw new Error("El índice del puente no es el del curso.");
  }
  if (spec.remote && (spec.databaseId === undefined || spec.databaseId.length < 32)) {
    throw new Error("No hay un uuid real de D1. No se inventa uno.");
  }
  const vars = config.vars as Record<string, string>;
  vars.BRIDGE_INDEX_NAME = spec.indexName;
  if (spec.dimensions !== undefined) vars.EMBEDDING_DIMENSIONS = String(spec.dimensions);
  if (spec.metric !== undefined) vars.BRIDGE_VERIFIED_METRIC = spec.metric;
  if (spec.metadataIndexes !== undefined)
    vars.BRIDGE_METADATA_INDEXES = JSON.stringify(spec.metadataIndexes);
  const d1: Record<string, unknown> = {
    binding: "DB",
    database_name: COURSE_D1_NAME,
    remote: spec.remote,
  };
  if (spec.databaseId !== undefined) {
    d1.database_id = spec.databaseId;
  }
  config.d1_databases = [d1];
  config.r2_buckets = [{ binding: "CORPUS", bucket_name: COURSE_R2_NAME, remote: spec.remote }];
  if (spec.remote) {
    config.vectorize = [{ binding: "VECTORIZE", index_name: spec.indexName, remote: true }];
    config.ai = { binding: "AI", remote: true };
  }
  if (spec.role === "verify") {
    if (
      spec.modelId === undefined ||
      spec.evaluatorModelId === undefined ||
      spec.profileId === undefined ||
      spec.corpusVersion === undefined ||
      spec.dimensions === undefined ||
      spec.minScore === undefined ||
      (spec.remote && !spec.apiKey)
    ) {
      throw new Error("La verificación no tiene modelo, perfil o umbral explícitos.");
    }
    Object.assign(vars, {
      APP_MODE: spec.remote ? "real" : "real",
      MODEL_ID: spec.modelId,
      EVALUATOR_MODEL_ID: spec.evaluatorModelId,
      EMBEDDING_MODEL: "@cf/baai/bge-m3",
      EMBEDDING_DIMENSIONS: String(spec.dimensions),
      CORPUS_VERSION: spec.corpusVersion,
      INDEX_PROFILE: spec.profileId,
      VECTOR_METRIC: "cosine",
      MIN_RETRIEVAL_SCORE: String(spec.minScore),
    });
  }
  return config;
}

function backoff(attempt: number): number {
  return Math.min(200, 40 * attempt);
}

export async function startLoopbackBridge(
  spec: BridgeSpec,
  deps: {
    spawn: (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => SpawnedBridge;
    fetch: (
      url: string,
      init: RequestInit,
    ) => Promise<{ status: number; body?: { ok?: boolean; bind?: string } }>;
    timeoutMs: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    command?: string;
    maxAttempts?: number;
  },
): Promise<{
  pid: number;
  attempts: number;
  shutdown: () => Promise<void>;
  config: Record<string, unknown>;
}> {
  if (!assertLoopbackHost("127.0.0.1")) {
    throw new Error("El puente solo puede escuchar en 127.0.0.1.");
  }
  const main = bridgeMainPath(spec.projectRoot);
  await access(main);
  const config = bridgeWranglerConfig(spec);
  const serialized = JSON.stringify(config);
  if (
    serialized.includes(spec.token) ||
    serialized.includes("--remote") ||
    serialized.includes("0.0.0.0")
  ) {
    throw new Error("La configuración del puente no puede publicar ni incluir el testigo.");
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-bridge-"));
  const configPath = path.join(dir, "wrangler.json");
  const varsPath = path.join(dir, ".dev.vars");
  await writeFile(configPath, serialized, { mode: 0o600 });
  const extra =
    spec.role === "verify" && !spec.remote
      ? "ANTHROPIC_API_KEY=local-emulated-not-a-provider\n"
      : spec.role === "verify" && spec.remote
        ? `ANTHROPIC_API_KEY=${JSON.stringify(spec.apiKey)}\n`
        : "";
  await writeFile(varsPath, `BRIDGE_TOKEN=${spec.token}\n${extra}`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  await chmod(varsPath, 0o600);
  const args = [
    "dev",
    "--config",
    configPath,
    "--ip",
    "127.0.0.1",
    "--port",
    String(spec.port),
    "--inspector-port",
    String(spec.inspectorPort),
    "--local-protocol",
    "http",
    "--inspector-ip",
    "127.0.0.1",
    "--persist-to",
    spec.persistDir,
    "--no-show-interactive-dev-session",
    "--log-level",
    "error",
  ];
  if (!spec.remote) {
    args.push("--local");
  }
  if (
    args.includes("--remote") ||
    args.includes("--tunnel") ||
    args.join(" ").includes(spec.token)
  ) {
    throw new Error("El arranque del puente no puede publicar ni mostrar el testigo.");
  }
  const child = deps.spawn(deps.command ?? "wrangler", args, {});
  const started = deps.now?.() ?? Date.now();
  const maxAttempts = deps.maxAttempts ?? 300;
  let attempts = 0;
  let ready = false;
  let terminal: string | null = null;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  try {
    while (attempts < maxAttempts) {
      if (child.hasExited()) {
        terminal = "El proceso del puente terminó antes de estar listo.";
        break;
      }
      const elapsed = (deps.now?.() ?? Date.now()) - started;
      if (attempts > 0 && elapsed >= deps.timeoutMs) {
        break;
      }
      attempts += 1;
      try {
        const response = await deps.fetch(`http://127.0.0.1:${String(spec.port)}/bridge/ready`, {
          headers: { "x-thepower-bridge": spec.token },
        });
        if (
          response.status === 200 &&
          response.body?.ok === true &&
          response.body.bind === "127.0.0.1"
        ) {
          ready = true;
          break;
        }
        if (response.status === 404 || (response.status === 200 && response.body?.ok !== true)) {
          terminal = "El testigo del puente no fue aceptado.";
          break;
        }
      } catch {
        // ECONNREFUSED mientras workerd abre el puerto.
      }
      if (attempts < maxAttempts) {
        await sleep(backoff(attempts));
      }
    }
  } catch (error) {
    terminal = error instanceof Error ? error.message : "El puente no pudo arrancar.";
  }
  const shutdown = async () => {
    child.kill();
    await child.waitForExit();
    await rm(dir, { recursive: true, force: true });
  };
  if (!ready) {
    await shutdown();
    throw new Error(
      terminal ?? "El puente local no estuvo listo a tiempo. El proceso se ha detenido.",
    );
  }
  return { pid: child.pid, attempts, config, shutdown };
}

function nodeBinary(): string {
  if (process.execPath.endsWith("/node") || process.execPath.endsWith("\\node.exe")) {
    return process.execPath;
  }
  return execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
}

export function spawnWranglerBridge(
  wranglerPath: string,
  cwd: string,
  accountId: string,
): (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => SpawnedBridge {
  return (_command, args) => {
    const child: ChildProcess = spawn(nodeBinary(), [wranglerPath, ...args], {
      cwd,
      env: {
        ...scopedWranglerEnv(process.env, accountId),
        WRANGLER_SEND_METRICS: "false",
        CI: "1",
        BROWSER: "none",
      },
      shell: false,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let exited = false;
    let exitCode: number | null = null;
    const exitPromise = new Promise<number | null>((resolve) => {
      child.on("exit", (code) => {
        exited = true;
        exitCode = code;
        resolve(code);
      });
      child.on("error", () => {
        exited = true;
        resolve(1);
      });
    });
    return {
      pid: child.pid ?? -1,
      hasExited: () => exited,
      kill: () => {
        const pid = child.pid;
        if (pid === undefined) {
          return;
        }
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      },
      waitForExit: async () => {
        const result = await Promise.race([
          exitPromise,
          new Promise<number | null>((resolve) => {
            setTimeout(() => {
              const pid = child.pid;
              if (pid !== undefined) {
                try {
                  process.kill(-pid, "SIGKILL");
                } catch {
                  child.kill("SIGKILL");
                }
              }
              resolve(exitCode);
            }, 2_000);
          }),
        ]);
        return result;
      },
    };
  };
}
