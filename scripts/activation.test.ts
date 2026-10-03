import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  missingFor,
  parseActivation,
  runActivation,
  type ActivationAuth,
  type ActivationExecutor,
  type CommandOutcome,
} from "./activation";
import { COURSE_DESTINATION, estimateEmbeddingUsd } from "./course-destination";
import { createCourseExecutor } from "./course-executor";
import { scopedWranglerEnv } from "./process-runner";
import {
  parseEmbeddingMatrix,
  parseMetadataIndexNames,
  parseUpsertMutationIds,
  parseVectorizeIndex,
  parseVectorizeIndexList,
  parseWhoami,
} from "./wrangler-parse";

const root = path.resolve(import.meta.dirname, "..");

function auth(overrides: Partial<ActivationAuth> = {}): ActivationAuth {
  return {
    accountId: "cuenta-de-prueba",
    accountName: "Curso AI Engineer",
    loginEmail: null,
    allowCreateD1: false,
    allowCreateR2: false,
    allowCreateVectorize: false,
    allowWorkersAi: false,
    allowOpenRouter: false,
    modelId: null,
    maxSpendUsd: null,
    allowPlanChange: false,
    observedDimensions: null,
    ...overrides,
  };
}

function executor(overrides: Partial<ActivationExecutor> = {}): ActivationExecutor & {
  calls: string[];
} {
  const calls: string[] = [];
  const refuse = async (): Promise<CommandOutcome> => ({ ok: false, summary: "no llamado" });
  const track = (name: string, result: CommandOutcome) => async (): Promise<CommandOutcome> => {
    calls.push(name);
    return result;
  };
  return {
    calls,
    identify: track("identify", { ok: true, summary: "sesión verificada" }),
    inventory: track("inventory", { ok: true, summary: "inventario" }),
    provision: overrides.provision ?? track("provision", { ok: true, summary: "provisión" }),
    migrate: overrides.migrate ?? refuse,
    probeEmbeddings: overrides.probeEmbeddings ?? track("probe", { ok: true, summary: "sonda" }),
    ingest: overrides.ingest ?? refuse,
    resume: overrides.resume ?? refuse,
    selectActive: overrides.selectActive ?? refuse,
    verify: overrides.verify ?? refuse,
  };
}

describe("activación", () => {
  it("no llama al ejecutor en simulación y observa un fallo asíncrono", async () => {
    let calls = 0;
    const dry = await runActivation({
      command: "ingest",
      execute: false,
      read: false,
      authorization: auth({ allowWorkersAi: true, maxSpendUsd: 2, observedDimensions: 32 }),
      executor: executor({
        ingest: async () => {
          calls += 1;
          return { ok: true, summary: "no debía ocurrir" };
        },
      }),
    });
    expect(dry.code).toBe(0);
    expect(calls).toBe(0);
    let observed = false;
    const failed = await runActivation({
      command: "provision",
      execute: true,
      read: false,
      authorization: auth({ maxSpendUsd: 2 }),
      executor: executor({
        provision: async () => {
          await Promise.resolve();
          observed = true;
          return { ok: false, summary: "d1 create terminó con código 1" };
        },
      }),
    });
    expect(observed).toBe(true);
    expect(failed.code).toBe(2);
    expect(failed.lines.join("\n")).toContain("d1 create terminó con código 1");
  });

  it("pide solo los permisos de la operación", () => {
    const probe = auth({ allowWorkersAi: true, maxSpendUsd: 1 });
    expect(missingFor("probe-embeddings", probe, null)).toEqual([]);
    expect(missingFor("probe-embeddings", auth(), null)).toContain("allowWorkersAi");
    expect(missingFor("probe-embeddings", auth(), null)).not.toContain("allowOpenRouter");
    expect(missingFor("probe-embeddings", auth(), null)).not.toContain("allowCreateD1");
    expect(missingFor("ingest", probe, null)).toContain("observedDimensions");
    expect(
      missingFor(
        "status",
        auth({
          accountId: COURSE_DESTINATION.accountId,
          accountName: COURSE_DESTINATION.accountName,
        }),
        null,
      ),
    ).toEqual([]);
    const blocked = runActivation({
      command: "provision",
      execute: true,
      read: false,
      authorization: { allowPlanChange: true },
    });
    return blocked.then((result) => {
      expect(result.code).toBe(2);
      expect(result.lines.join("\n")).toContain("allowPlanChange");
      expect(result.lines.join("\n")).not.toContain("example/generator");
    });
  });

  it("el ejemplo documenta la cuenta y no concede altas ni gasto", () => {
    const example = JSON.parse(
      readFileSync(path.join(root, "docs/activation.example.json"), "utf8"),
    ) as Record<string, unknown>;
    const parsed = parseActivation(example);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(parsed.auth.accountId).toBe(COURSE_DESTINATION.accountId);
    expect(parsed.auth.accountName).toBe(COURSE_DESTINATION.accountName);
    expect(parsed.auth.loginEmail).toBe(COURSE_DESTINATION.loginEmail);
    expect(parsed.auth.allowCreateD1).toBe(false);
    expect(parsed.auth.maxSpendUsd).toBeNull();
    expect(parsed.auth.modelId).toBeNull();
    expect(estimateEmbeddingUsd(20)).toBeGreaterThan(0);
    expect(estimateEmbeddingUsd(20)).toBeLessThan(0.01);
  });
});

describe("lecturas de Wrangler", () => {
  it("elige la cuenta pedida y no la primera", () => {
    const parsed = parseWhoami(
      {
        loggedIn: true,
        email: "joseantonionuevo@gmail.com",
        accounts: [
          { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Otra cuenta" },
          {
            id: COURSE_DESTINATION.accountId,
            name: COURSE_DESTINATION.accountName,
          },
        ],
      },
      COURSE_DESTINATION,
    );
    expect(parsed).toMatchObject({
      ok: true,
      identity: { accountId: COURSE_DESTINATION.accountId, accountCount: 2 },
    });
  });

  it("no inventa cosine si get no trae la métrica", () => {
    const missing = parseVectorizeIndex({ name: "indice", config: { dimensions: 1024 } }, "indice");
    expect(missing.ok).toBe(false);
    const observed = parseVectorizeIndex(
      { result: { name: "indice", config: { dimensions: 32, metric: "dot-product" } } },
      "indice",
    );
    expect(observed).toMatchObject({ ok: true, index: { metric: "dot-product" } });
  });

  it("guarda las mutaciones en el orden recibido y exige su texto", () => {
    expect(parseUpsertMutationIds('{"index":"indice","count":2}')).toEqual([]);
    expect(
      parseUpsertMutationIds(
        "Mutation changeset identifier: mut-b\nMutation changeset identifier: mut-a.",
      ),
    ).toEqual(["mut-b", "mut-a"]);
  });

  it("mide la anchura de BGE sin suponer 768 ni 128", () => {
    const parsed = parseEmbeddingMatrix({
      data: [
        [0.1, 0.2, 0.3],
        [1, 2, 3],
      ],
    });
    expect(parsed).toEqual({ ok: true, dimensions: 3, rows: 2 });
    expect(parseEmbeddingMatrix({ data: [[Number.NaN]] }).ok).toBe(false);
  });

  it("el entorno de Wrangler fija la cuenta y no copia un token", () => {
    const env = scopedWranglerEnv(
      { HOME: "/tmp/home", PATH: "/usr/bin", CLOUDFLARE_API_TOKEN: "secreto" },
      COURSE_DESTINATION.accountId,
    );
    expect(env.CLOUDFLARE_ACCOUNT_ID).toBe(COURSE_DESTINATION.accountId);
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("secreto");
  });
});

describe("ejecutor", () => {
  it("no crea ni borra cuando la lectura dice ausente y el permiso es falso", async () => {
    const seen: string[][] = [];
    const course = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        run: async (args) => {
          seen.push([...args]);
          const joined = args.join(" ");
          if (joined.includes("d1 info")) {
            return { code: 1, stdout: "", stderr: "Couldn't find a D1 DB named 'x'" };
          }
          if (joined.includes("bucket info")) {
            return { code: 1, stdout: "", stderr: "The specified bucket does not exist." };
          }
          if (joined.includes("vectorize list")) {
            return { code: 0, stdout: "[]", stderr: "" };
          }
          return { code: 1, stdout: "", stderr: "no esperado" };
        },
      },
    });
    const result = await course.provision(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
        maxSpendUsd: 2,
      }),
    );
    expect(result.ok).toBe(false);
    expect(seen.some((args) => args.includes("create") || args.includes("delete"))).toBe(false);
  });

  it("un listado Vectorize ilegible no confirma ausencia ni crea", async () => {
    const seen: string[][] = [];
    const course = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        run: async (args) => {
          seen.push([...args]);
          const joined = args.join(" ");
          if (joined.includes("d1 info")) {
            return { code: 1, stdout: "", stderr: "Couldn't find a D1 DB named 'x'" };
          }
          if (joined.includes("bucket info")) {
            return { code: 1, stdout: "", stderr: "The specified bucket does not exist." };
          }
          if (joined.includes("vectorize list")) {
            return { code: 0, stdout: "no-es-json", stderr: "" };
          }
          return { code: 0, stdout: '{"metadataIndexes":{}}', stderr: "" };
        },
      },
    });
    const inventory = await course.inventory(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
      }),
    );
    expect(inventory.ok).toBe(false);
    expect(inventory.lines?.join("\n")).toContain("lectura no confirmada");
    const provision = await course.provision(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
        maxSpendUsd: 2,
        allowCreateVectorize: true,
        observedDimensions: 32,
      }),
    );
    expect(provision.ok).toBe(false);
    expect(provision.summary).toContain("no está confirmado");
    expect(seen.some((args) => args.includes("create") || args.includes("delete"))).toBe(false);
    expect(parseVectorizeIndexList({ result: [] }).ok).toBe(false);
    expect(parseVectorizeIndexList([]).ok).toBe(true);
    expect(parseMetadataIndexNames([{ propertyName: "audience" }])).toEqual({
      ok: true,
      names: ["audience"],
    });
    expect(parseMetadataIndexNames({ unexpected: true }).ok).toBe(false);
  });

  it("la reanudación lee el índice y no inserta", async () => {
    const seen: string[][] = [];
    const course = createCourseExecutor({
      cwd: root,
      migrationsDir: path.join(root, "apps/api/migrations"),
      corpusPath: path.join(root, "corpus/prepared/corpus.json"),
      runner: {
        run: async (args, env) => {
          seen.push([...args]);
          expect(env.CLOUDFLARE_ACCOUNT_ID).toBe(COURSE_DESTINATION.accountId);
          expect(args.at(-2)).toBe("--config");
          if (args[1] === "get") {
            return {
              code: 0,
              stdout: JSON.stringify({
                name: args[2],
                config: { dimensions: 32, metric: "euclidean" },
              }),
              stderr: "",
            };
          }
          return { code: 0, stdout: "[]", stderr: "" };
        },
      },
    });
    const result = await course.resume(
      auth({
        accountId: COURSE_DESTINATION.accountId,
        accountName: COURSE_DESTINATION.accountName,
        maxSpendUsd: 1,
        observedDimensions: 32,
      }),
      "p0123456789ab",
    );
    expect(result.ok).toBe(false);
    expect(result.lines?.join("\n")).toContain("euclidean");
    expect(seen.some((args) => args.includes("upsert") || args.includes("delete"))).toBe(false);
  });
});
