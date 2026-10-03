import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { COURSE_D1_NAME } from "@thepower-rag/core";
import type { ActivationCommand } from "./activation";
import { databaseUuid } from "./course-executor";
import {
  spawnWranglerBridge,
  startLoopbackBridge,
  type BridgeRole,
  type BridgeSpec,
} from "./loopback-bridge";
import { scopedWranglerEnv, type ProcessRunner } from "./process-runner";
import { loopbackFetch } from "./loopback-fetch";
import { parseJsonText, parseVectorizeIndex, parseMetadataIndexNames } from "./wrangler-parse";

const DATA_COMMANDS = new Set<ActivationCommand>([
  "probe-embeddings",
  "ingest",
  "resume",
  "select-active",
  "verify",
]);

export function shouldStartRuntime(command: string, execute: boolean, read: boolean): boolean {
  return execute && !read && DATA_COMMANDS.has(command as ActivationCommand);
}

export function bridgeRoleFor(command: string): BridgeRole {
  if (command === "probe-embeddings") {
    return "probe";
  }
  if (command === "verify") {
    return "verify";
  }
  return "storage";
}

async function confirmedDatabaseId(
  runner: ProcessRunner,
  accountId: string,
): Promise<string | null> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-d1-"));
  const config = path.join(dir, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "thepower-rag-activation",
      account_id: accountId,
      compatibility_date: "2026-10-02",
    }),
  );
  try {
    const result = await runner.run(
      ["d1", "info", COURSE_D1_NAME, "--json", "--config", config],
      scopedWranglerEnv(process.env, accountId),
    );
    if (result.code !== 0) {
      return null;
    }
    return databaseUuid(parseJsonText(result.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function startOwnedBridge(input: {
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
  runner: ProcessRunner;
  offline: boolean;
}): Promise<{ origin: string; token: string; shutdown: () => Promise<void> }> {
  if (input.remote && input.offline) {
    throw new Error("La ruta offline no puede activar bindings remotos.");
  }
  if (input.role === "verify" && input.remote && input.minScore === undefined) {
    throw new Error(
      "Falta el umbral semántico observado. No se usa 0,33 ni se llama al proveedor.",
    );
  }
  let databaseId = input.databaseId;
  if (input.remote && input.role !== "probe") {
    databaseId = (await confirmedDatabaseId(input.runner, input.accountId)) ?? undefined;
    if (databaseId === undefined) {
      throw new Error("d1 info no trajo el uuid de la base. No se inventa uno.");
    }
  }
  await mkdir(input.persistDir, { recursive: true });
  let metric: string | undefined;
  let metadataIndexes: string[] | undefined;
  if (input.remote && input.role !== "probe") {
    const env = scopedWranglerEnv(process.env, input.accountId);
    const indexResult = await input.runner.run(
      ["vectorize", "get", input.indexName ?? "", "--json"],
      env,
    );
    const parsed = parseVectorizeIndex(parseJsonText(indexResult.stdout), input.indexName ?? "");
    const metadataResult = await input.runner.run(
      ["vectorize", "list-metadata-index", input.indexName ?? "", "--json"],
      env,
    );
    const metadata = parseMetadataIndexNames(parseJsonText(metadataResult.stdout));
    if (
      indexResult.code !== 0 ||
      !parsed.ok ||
      metadataResult.code !== 0 ||
      !metadata.ok ||
      parsed.index.dimensions !== input.dimensions
    ) {
      throw new Error("No se confirmó la configuración administrativa del índice remoto.");
    }
    metric = parsed.index.metric;
    metadataIndexes = metadata.names;
  }
  const spec: BridgeSpec = {
    accountId: input.accountId,
    port: input.port,
    inspectorPort: input.inspectorPort,
    token: input.token,
    projectRoot: input.projectRoot,
    role: input.role,
    remote: input.remote,
    persistDir: input.persistDir,
    indexName: input.indexName,
    databaseId,
    modelId: input.modelId,
    evaluatorModelId: input.evaluatorModelId,
    profileId: input.profileId,
    corpusVersion: input.corpusVersion,
    dimensions: input.dimensions,
    minScore: input.minScore,
    apiKey: input.apiKey,
    metric,
    metadataIndexes,
  };
  const wranglerPath = path.join(
    input.projectRoot,
    "apps/web/node_modules/wrangler/bin/wrangler.js",
  );
  const started = await startLoopbackBridge(spec, {
    timeoutMs: 60_000,
    command: wranglerPath,
    spawn: spawnWranglerBridge(wranglerPath, input.projectRoot, input.accountId),
    fetch: async (url, init) => {
      const response = await loopbackFetch(url, init);
      const body = (await response.json().catch(() => null)) as {
        ok?: boolean;
        bind?: string;
      } | null;
      return { status: response.status, body: body ?? undefined };
    },
  });
  return {
    origin: `http://127.0.0.1:${String(input.port)}`,
    token: input.token,
    shutdown: started.shutdown,
  };
}
