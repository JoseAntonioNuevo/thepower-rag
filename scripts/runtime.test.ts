import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { semanticIdentity, vectorizeIndexName, type PreparedCorpus } from "@thepower-rag/core";
import { describe, expect, it } from "vite-plus/test";
import { createMemoryBindings, createMemoryDataPlane } from "../apps/api/src/memory-bindings";
import { handleBridgeRequest } from "../apps/api/src/bridge-worker";
import type { ActivationAuth } from "./activation";
import { createCourseExecutor } from "./course-executor";
import { createAllowanceLedger } from "@thepower-rag/core";
import { bridgeWranglerConfig, startLoopbackBridge } from "./loopback-bridge";
import { shouldStartRuntime } from "./runtime-plane";
import { COURSE_DESTINATION } from "./course-destination";

const root = path.resolve(import.meta.dirname, "..");

function auth(overrides: Partial<ActivationAuth> = {}): ActivationAuth {
  return {
    accountId: COURSE_DESTINATION.accountId,
    accountName: COURSE_DESTINATION.accountName,
    loginEmail: COURSE_DESTINATION.loginEmail,
    allowCreateD1: false,
    allowCreateR2: false,
    allowCreateVectorize: false,
    allowWorkersAi: true,
    allowOpenRouter: true,
    modelId: "example/generator",
    maxSpendUsd: 5,
    allowPlanChange: false,
    observedDimensions: 32,
    ...overrides,
  };
}

function corpus(): PreparedCorpus {
  return {
    contentVersion: "cc037ef0bb1f7",
    preparationId: "c3a59a406888b",
    version: "test",
    verifiedDate: "2026-10-03",
    embeddingModel: "fixture-token-hash-v1",
    dimensions: 128,
    remoteRevision: null,
    coverage: {
      curriculum: "partial",
      calendarLx: "partial",
      calendarMj: "partial",
      exerciseDetail: "partial",
      remote: "not-verified",
      sessions: [],
    },
    indexProfile: {
      id: "p9e8e8e03627e",
      family: "fixture",
      model: "fixture-token-hash-v1",
      dimensions: 128,
      metric: "cosine",
      chunkMaxChars: 900,
      chunkOverlap: 80,
      providerRevision: null,
      preparationId: "c3a59a406888b",
    },
    documents: [
      {
        id: "s05-langgraph",
        title: "S5",
        audience: "program",
        session: "S5",
        verified: "2026-10-03",
        source: "temario",
        sourcePath: "program/s05-langgraph.md",
        sourceHash: "hash-s5",
        curriculum: "present",
        exerciseDetail: "summary",
        body: "LangGraph modela el estado.",
        chunks: [
          {
            chunkId: "c3a59a406888b:s05-langgraph:00",
            vectorId: "v-s05",
            section: "S5",
            text: "LangGraph modela el estado.",
            ordinal: 0,
          },
        ],
      },
    ],
  };
}

describe("puente y comandos", () => {
  it("no arranca el runtime en simulación ni en lectura", () => {
    expect(shouldStartRuntime("plan", false, false)).toBe(false);
    expect(shouldStartRuntime("probe-embeddings", false, false)).toBe(false);
    expect(shouldStartRuntime("status", false, true)).toBe(false);
    expect(shouldStartRuntime("probe-embeddings", true, false)).toBe(true);
    expect(shouldStartRuntime("verify", true, true)).toBe(false);
  });

  it("sonda, ingesta, reanuda sin reembeber y no activa un perfil a medias", async () => {
    const before = await readFile(path.join(root, "corpus/prepared/corpus.json"), "utf8");
    const prepared = JSON.parse(before) as PreparedCorpus;
    expect(semanticIdentity(prepared, 32).id).not.toBe("p9e8e8e03627e");
    const directory = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-runtime-"));
    const paths = {
      receiptDir: directory,
      cacheDir: path.join(directory, "cache"),
      now: "2026-10-03T12:00:00.000Z",
    };
    const bindings = createMemoryBindings({ dimensions: 32, visibleAfterReads: 2 });
    let embedCalls = 0;
    const profileId = semanticIdentity(corpus(), 32).id;
    const plane = createMemoryDataPlane({
      bindings,
      management: {
        metric: "cosine",
        dimensions: 32,
        name: vectorizeIndexName(profileId),
        metadataIndexes: ["corpusVersion", "audience", "profileId"],
      },
      embed: async (texts) => {
        embedCalls += 1;
        return {
          vectors: texts.map(() => Array.from({ length: 32 }, () => 0.1)),
          providerRevision: null,
        };
      },
    });
    const allowance = createAllowanceLedger({
      maxSpendUsd: 5,
      maxGenerativeCalls: 4,
      maxEmbeddingCalls: 8,
      prices: {
        embeddingUsdPerMillionInput: 0.0118,
        generativeUsdPerMillionInput: 1,
        generativeUsdPerMillionOutput: 2,
      },
    });
    const executor = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      corpus: corpus(),
      plane,
      allowance,
      paths,
      runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    });
    const blocked = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
    });
    expect((await blocked.probeEmbeddings(auth())).summary).toContain("no está conectado");
    const probe = await executor.probeEmbeddings(auth());
    expect(probe.ok).toBe(true);
    expect(probe.receipt).toMatchObject({
      dimensions: 32,
      providerRevision: null,
      measuredChargeUsd: null,
      provenance: "fixture",
      live: false,
      usableForRemoteIndex: false,
    });
    const receipt = JSON.parse(
      await readFile(path.join(directory, "probe-embeddings.json"), "utf8"),
    ) as {
      dimensions: number;
    };
    expect(receipt.dimensions).toBe(32);
    const ingested = await executor.ingest(auth());
    expect(ingested.ok).toBe(true);
    expect(ingested.receipt).toMatchObject({ phase: "ready", embedCalls: 1, upserts: 1 });
    const embedsAfterIngest = embedCalls;
    const resumed = await executor.resume(auth(), profileId);
    expect(resumed.ok).toBe(true);
    expect(resumed.receipt).toMatchObject({ embedCalls: 0, upserts: 0 });
    expect(embedCalls).toBe(embedsAfterIngest);
    const selected = await executor.selectActive(auth(), profileId);
    expect(selected.ok).toBe(true);
    expect(selected.receipt).toMatchObject({ activeId: profileId });
    bindings.tables.index_profiles.push({
      id: "p0123456789ab",
      status: "partial",
      active: 0,
      corpus_version: "c3a59a406888b",
    });
    const rejected = await executor.selectActive(auth(), "p0123456789ab");
    expect(rejected.ok).toBe(false);
    expect(rejected.receipt).toMatchObject({ activeId: profileId });
    const cacheFile = path.join(paths.cacheDir, `${profileId}.json`);
    const cache = JSON.parse(await readFile(cacheFile, "utf8")) as { profileId: string };
    cache.profileId = "p0123456789ab";
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cacheFile, JSON.stringify(cache));
    const mismatch = await executor.resume(auth(), profileId);
    expect(mismatch.ok).toBe(false);
    expect(mismatch.receipt).toMatchObject({ embedCalls: 0 });
    expect(embedCalls).toBe(embedsAfterIngest);
    expect(await readFile(path.join(root, "corpus/prepared/corpus.json"), "utf8")).toBe(before);
    await rm(directory, { recursive: true, force: true });
  });

  it("no llama al proveedor si el plan de verificación no cabe", async () => {
    let calls = 0;
    const executor = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: { run: async () => ({ code: 0, stdout: "", stderr: "" }) },
      sessionPrices: {
        embeddingUsdPerMillionInput: 1,
        generativeUsdPerMillionInput: 1,
        generativeUsdPerMillionOutput: 1,
      },
      sessionLimits: { generative: 3, embedding: 8 },
      verifySession: async () => {
        calls += 1;
        return { ok: true, summary: "no debía llamarse" };
      },
    });
    const result = await executor.verify(auth({ maxSpendUsd: 100 }));
    expect(result.ok).toBe(false);
    expect(result.receipt).toMatchObject({ calls: 0 });
    expect(calls).toBe(0);
  });

  it("arranca y apaga un solo proceso de loopback sin publicarlo", async () => {
    const spec = {
      accountId: COURSE_DESTINATION.accountId,
      port: 9,
      inspectorPort: 10,
      remote: false,
      token: "testigo-local-de-prueba",
      projectRoot: root,
      role: "probe" as const,
      persistDir: "/tmp/thepower-rag-bridge-test",
    };
    const config = bridgeWranglerConfig(spec);
    expect(config.dev).toMatchObject({ ip: "127.0.0.1" });
    expect(config.main).toBe(`${root}/apps/api/src/bridge-worker.ts`);
    expect(JSON.stringify(config)).not.toContain("0.0.0.0");
    expect(config.ai).toBeUndefined();
    expect(config.vectorize).toBeUndefined();
    expect(config.d1_databases).toBeUndefined();
    const remoteProbe = bridgeWranglerConfig({ ...spec, remote: true });
    expect(remoteProbe.ai).toEqual({ binding: "AI", remote: true });
    expect(remoteProbe.vectorize).toBeUndefined();
    expect(() =>
      bridgeWranglerConfig({
        ...spec,
        role: "storage",
        remote: true,
        indexName: "thepower-ai-course-rag-0123456789ab",
      }),
    ).toThrow(/uuid/);
    const killed: number[] = [];
    const started = await startLoopbackBridge(spec, {
      timeoutMs: 1_000,
      now: () => 0,
      sleep: async () => undefined,
      spawn: (_command, args) => {
        expect(args).toContain("--ip");
        expect(args).toContain("127.0.0.1");
        expect(args).toContain("--local");
        expect(args).not.toContain("--remote");
        expect(args.join(" ")).not.toContain(spec.token);
        return {
          pid: 42,
          kill: () => killed.push(42),
          hasExited: () => false,
          waitForExit: async () => 0,
        };
      },
      fetch: async () => ({ status: 200, body: { ok: true, bind: "127.0.0.1" } }),
    });
    expect(started.pid).toBe(42);
    await started.shutdown();
    expect(killed).toEqual([42]);
    let fetches = 0;
    const retried = await startLoopbackBridge(spec, {
      timeoutMs: 1_000,
      now: () => 0,
      sleep: async () => undefined,
      spawn: () => ({
        pid: 8,
        kill: () => undefined,
        hasExited: () => false,
        waitForExit: async () => 0,
      }),
      fetch: async () => {
        fetches += 1;
        if (fetches === 1) {
          throw new Error("connect ECONNREFUSED");
        }
        return { status: 200, body: { ok: true, bind: "127.0.0.1" } };
      },
    });
    expect(fetches).toBe(2);
    expect(retried.attempts).toBe(2);
    await retried.shutdown();
    await expect(
      startLoopbackBridge(spec, {
        timeoutMs: 0,
        now: () => 10,
        sleep: async () => undefined,
        spawn: () => ({
          pid: 7,
          kill: () => killed.push(7),
          hasExited: () => false,
          waitForExit: async () => 0,
        }),
        fetch: async () => ({ status: 503 }),
      }),
    ).rejects.toThrow(/no estuvo listo/);
    expect(killed).toContain(7);
  });

  it("el puente rechaza otro host y devuelve la dimensión observada", async () => {
    const denied = await handleBridgeRequest(new Request("http://example.com/bridge/ready"), {
      BRIDGE_TOKEN: "testigo-local-de-prueba",
    });
    expect(denied.status).toBe(404);
    let remoteCalls = 0;
    const response = await handleBridgeRequest(
      new Request("http://127.0.0.1/bridge", {
        method: "POST",
        headers: { "x-thepower-bridge": "testigo-local-de-prueba" },
        body: JSON.stringify({
          op: "embed",
          reservationId: "r1",
          texts: ["uno", "dos"],
        }),
      }),
      {
        BRIDGE_TOKEN: "testigo-local-de-prueba",
        BRIDGE_REMOTE: "true",
        BRIDGE_ROLE: "probe",
        AI: {
          run: async () => {
            remoteCalls += 1;
            return {
              data: [Array.from({ length: 32 }, () => 0.2), Array.from({ length: 32 }, () => 0.2)],
            };
          },
        },
      },
    );
    const skipped = await handleBridgeRequest(
      new Request("http://127.0.0.1/bridge", {
        method: "POST",
        headers: { "x-thepower-bridge": "testigo-local-de-prueba" },
        body: JSON.stringify({ op: "embed", texts: ["uno", "dos"] }),
      }),
      {
        BRIDGE_TOKEN: "testigo-local-de-prueba",
        BRIDGE_REMOTE: "true",
        AI: {
          run: async () => {
            remoteCalls += 1;
            return { data: [] };
          },
        },
      },
    );
    expect(skipped.status).toBe(400);
    expect(remoteCalls).toBe(1);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      vectors: number[][];
      providerRevision: string | null;
    };
    expect(body.vectors[0]?.length).toBe(32);
    expect(body.providerRevision).toBeNull();
  });
});
