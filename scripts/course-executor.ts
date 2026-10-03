import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  COURSE_D1_NAME,
  COURSE_R2_NAME,
  COURSE_VECTORIZE_PREFIX,
  indexProfileId,
  PREP_CHUNKING,
  VECTORIZE_METADATA_INDEXES,
  vectorizeIndexName,
} from "@thepower-rag/core";
import type { PreparedCorpus } from "@thepower-rag/core";
import type { ActivationAuth, CommandOutcome } from "./activation";
import {
  executeIngest,
  executeProbe,
  executeSelectActive,
  planFits,
  probeAllowance,
  writeAtomic,
  type CourseDataPlane,
  type RuntimePaths,
} from "./course-runtime";
import type { AllowanceLedger } from "@thepower-rag/core";
import { scopedWranglerEnv, type ProcessRunner } from "./process-runner";
import {
  absenceReason,
  parseJsonText,
  parseMetadataIndexNames,
  parseVectorizeIndexList,
  parseUpsertMutationIds,
  parseVectorizeIndex,
  parseWhoami,
  sanitizeCommandText,
} from "./wrangler-parse";

export interface ExecutorOptions {
  runner: ProcessRunner;
  cwd: string;
  migrationsDir: string;
  corpusPath: string;
  env?: NodeJS.ProcessEnv;
  plane?: CourseDataPlane | null;
  corpus?: PreparedCorpus;
  allowance?: AllowanceLedger;
  paths?: RuntimePaths;
  verifySession?: (allowance: AllowanceLedger) => Promise<CommandOutcome>;
  sessionPrices?: {
    embeddingUsdPerMillionInput: number | null;
    generativeUsdPerMillionInput: number | null;
    generativeUsdPerMillionOutput: number | null;
  };
  sessionLimits?: { generative: number; embedding: number };
}

export function createCourseExecutor(options: ExecutorOptions) {
  const calls: string[][] = [];
  const run = async (accountId: string, args: readonly string[]) => {
    if (
      args.some((arg) => arg === "delete" || arg === "--update-config" || arg.includes("token"))
    ) {
      throw new Error("argumento de ejecución no permitido");
    }
    calls.push([...args]);
    const config = await writeAccountConfig(accountId);
    try {
      const result = await options.runner.run(
        [...args, "--config", config],
        scopedWranglerEnv(options.env ?? process.env, accountId),
      );
      return {
        ...result,
        stdout: sanitizeCommandText(result.stdout),
        stderr: sanitizeCommandText(result.stderr),
      };
    } finally {
      await rm(path.dirname(config), { recursive: true, force: true });
    }
  };

  return {
    calls,
    async identify(auth: ActivationAuth): Promise<CommandOutcome> {
      const accountId = auth.accountId ?? "";
      const result = await run(accountId, ["whoami", "--json", "--account", accountId]);
      if (result.code !== 0) {
        return { ok: false, summary: "whoami no completó la lectura de la sesión" };
      }
      const parsed = parseWhoami(parseJsonText(result.stdout), {
        accountId,
        accountName: auth.accountName ?? "",
        loginEmail: auth.loginEmail,
      });
      if (!parsed.ok) {
        return { ok: false, summary: parsed.reason };
      }
      return {
        ok: true,
        summary: "sesión verificada para la cuenta del curso",
        lines: [
          `correo: ${parsed.identity.email ?? "no expuesto"}`,
          `cuentas en la sesión: ${String(parsed.identity.accountCount)}`,
        ],
        receipt: {
          accountId: parsed.identity.accountId,
          accountName: parsed.identity.accountName,
          email: parsed.identity.email,
          accountCount: parsed.identity.accountCount,
        },
      };
    },
    async inventory(auth: ActivationAuth): Promise<CommandOutcome> {
      const accountId = auth.accountId ?? "";
      const d1 = namedState(
        await run(accountId, ["d1", "info", COURSE_D1_NAME, "--json"]),
        COURSE_D1_NAME,
      );
      const r2 = namedState(
        await run(accountId, ["r2", "bucket", "info", COURSE_R2_NAME, "--json"]),
        COURSE_R2_NAME,
      );
      const listed = await run(accountId, ["vectorize", "list", "--json"]);
      const parsedIndexes =
        listed.code === 0 ? courseIndexNames(parseJsonText(listed.stdout)) : null;
      const indexes = parsedIndexes?.ok === true ? parsedIndexes.names : null;
      const lines = [
        `D1 ${COURSE_D1_NAME}: ${d1}`,
        `R2 ${COURSE_R2_NAME}: ${r2}`,
        `Vectorize con prefijo del curso: ${indexes === null ? "lectura no confirmada" : indexes.length === 0 ? "ausente" : indexes.join(", ")}`,
      ];
      return {
        ok: d1 !== "lectura no confirmada" && r2 !== "lectura no confirmada" && indexes !== null,
        summary: "inventario de solo lectura",
        lines,
        receipt: {
          d1,
          r2,
          vectorize: indexes,
        },
      };
    },
    async provision(auth: ActivationAuth): Promise<CommandOutcome> {
      const accountId = auth.accountId ?? "";
      const created: string[] = [];
      const d1 = namedState(
        await run(accountId, ["d1", "info", COURSE_D1_NAME, "--json"]),
        COURSE_D1_NAME,
      );
      if (d1 === "ausente" && auth.allowCreateD1) {
        const result = await run(accountId, ["d1", "create", COURSE_D1_NAME]);
        if (result.code !== 0) {
          return { ok: false, summary: "d1 create no terminó bien" };
        }
        created.push(COURSE_D1_NAME);
      } else if (d1 === "lectura no confirmada") {
        return { ok: false, summary: "no se crea D1 porque la lectura no confirmó su ausencia" };
      }
      const r2 = namedState(
        await run(accountId, ["r2", "bucket", "info", COURSE_R2_NAME, "--json"]),
        COURSE_R2_NAME,
      );
      if (r2 === "ausente" && auth.allowCreateR2) {
        const result = await run(accountId, ["r2", "bucket", "create", COURSE_R2_NAME]);
        if (result.code !== 0) {
          return { ok: false, summary: "r2 bucket create no terminó bien" };
        }
        created.push(COURSE_R2_NAME);
      } else if (r2 === "lectura no confirmada") {
        return { ok: false, summary: "no se crea R2 porque la lectura no confirmó su ausencia" };
      }
      if (!auth.allowCreateVectorize) {
        return {
          ok: false,
          summary: "falta permiso para crear el índice Vectorize del curso",
          lines: created.map((name) => `creado: ${name}`),
        };
      }
      if (auth.observedDimensions === null) {
        return {
          ok: false,
          summary: "D1 y R2 quedaron revisados. Falta la dimensión observada para Vectorize.",
          lines: created.map((name) => `creado: ${name}`),
        };
      }
      const indexName = semanticIndexName(options.corpusPath, auth.observedDimensions);
      const listed = await run(accountId, ["vectorize", "list", "--json"]);
      if (listed.code !== 0) {
        return { ok: false, summary: "no se crea el índice porque el listado no está confirmado" };
      }
      const names = courseIndexNames(parseJsonText(listed.stdout));
      if (!names.ok) {
        return { ok: false, summary: "no se crea el índice porque el listado no está confirmado" };
      }
      if (!names.names.includes(indexName)) {
        const createdIndex = await run(accountId, [
          "vectorize",
          "create",
          indexName,
          "--dimensions",
          String(auth.observedDimensions),
          "--metric",
          "cosine",
        ]);
        if (createdIndex.code !== 0) {
          return { ok: false, summary: "vectorize create no terminó bien" };
        }
        created.push(indexName);
      } else {
        const existing = await run(accountId, ["vectorize", "get", indexName, "--json"]);
        const current = parseVectorizeIndex(parseJsonText(existing.stdout), indexName);
        if (!current.ok) {
          return { ok: false, summary: current.reason };
        }
        if (
          current.index.dimensions !== auth.observedDimensions ||
          current.index.metric !== "cosine"
        ) {
          return {
            ok: false,
            summary: "el índice existe con otra dimensión o métrica y no se borra",
          };
        }
      }
      for (const property of VECTORIZE_METADATA_INDEXES) {
        const listed = parseMetadataIndexNames(
          parseJsonText(
            (await run(accountId, ["vectorize", "list-metadata-index", indexName, "--json"]))
              .stdout,
          ),
        );
        if (!listed.ok) {
          return {
            ok: false,
            summary: "no se crea un metadato porque el listado no está confirmado",
          };
        }
        if (listed.names.includes(property)) {
          continue;
        }
        const mutation = await run(accountId, [
          "vectorize",
          "create-metadata-index",
          indexName,
          "--propertyName",
          property,
          "--type",
          "string",
        ]);
        const ids = parseUpsertMutationIds(mutation.stdout);
        if (mutation.code !== 0 || ids.length === 0) {
          return { ok: false, summary: `no se confirmó la mutación del metadato ${property}` };
        }
      }
      const visible = parseMetadataIndexNames(
        parseJsonText(
          (await run(accountId, ["vectorize", "list-metadata-index", indexName, "--json"])).stdout,
        ),
      );
      if (!visible.ok) {
        return { ok: false, summary: "la lectura final de metadatos no está confirmada" };
      }
      const pending = VECTORIZE_METADATA_INDEXES.filter((name) => !visible.names.includes(name));
      if (pending.length > 0) {
        return {
          ok: false,
          summary: `los metadatos ${pending.join(", ")} siguen pendientes de visibilidad`,
        };
      }
      return {
        ok: true,
        summary: "recursos del curso comprobados",
        lines: created.map((name) => `creado: ${name}`),
      };
    },
    async migrate(auth: ActivationAuth): Promise<CommandOutcome> {
      const accountId = auth.accountId ?? "";
      const info = await run(accountId, ["d1", "info", COURSE_D1_NAME, "--json"]);
      const state = namedState(info, COURSE_D1_NAME);
      if (state !== "presente") {
        return { ok: false, summary: "no se migró porque D1 del curso no está confirmada" };
      }
      const databaseId = databaseUuid(parseJsonText(info.stdout));
      if (databaseId === null) {
        return { ok: false, summary: "d1 info no trajo el uuid de la base" };
      }
      const config = await writeMigrationConfig(accountId, databaseId, options.migrationsDir);
      try {
        const result = await options.runner.run(
          ["d1", "migrations", "apply", COURSE_D1_NAME, "--remote", "--config", config],
          scopedWranglerEnv(options.env ?? process.env, accountId),
        );
        calls.push(["d1", "migrations", "apply", COURSE_D1_NAME, "--remote"]);
        if (result.code !== 0) {
          return { ok: false, summary: "d1 migrations apply no terminó bien" };
        }
        return { ok: true, summary: "migraciones aplicadas a la base del curso" };
      } finally {
        await rm(path.dirname(config), { recursive: true, force: true });
      }
    },
    async probeEmbeddings(auth: ActivationAuth): Promise<CommandOutcome> {
      return executeProbe({
        auth,
        plane: options.plane ?? null,
        allowance: options.allowance ?? probeAllowance(auth),
        paths: options.paths ?? {
          receiptDir: path.join(options.cwd, "activation-receipts"),
          cacheDir: path.join(options.cwd, "activation-receipts", "cache"),
          now: new Date().toISOString(),
        },
        accountId: auth.accountId ?? "",
      });
    },
    async ingest(auth: ActivationAuth): Promise<CommandOutcome> {
      return executeIngest({
        auth,
        corpus: options.corpus ?? loadPrepared(options.corpusPath),
        plane: options.plane ?? null,
        allowance: options.allowance ?? probeAllowance(auth),
        paths: options.paths ?? {
          receiptDir: path.join(options.cwd, "activation-receipts"),
          cacheDir: path.join(options.cwd, "activation-receipts", "cache"),
          now: new Date().toISOString(),
        },
      });
    },
    async resume(auth: ActivationAuth, profileId: string): Promise<CommandOutcome> {
      if (options.plane) {
        return executeIngest({
          auth,
          corpus: options.corpus ?? loadPrepared(options.corpusPath),
          plane: options.plane,
          allowance: options.allowance ?? probeAllowance(auth),
          paths: options.paths ?? {
            receiptDir: path.join(options.cwd, "activation-receipts"),
            cacheDir: path.join(options.cwd, "activation-receipts", "cache"),
            now: new Date().toISOString(),
          },
          resumeProfileId: profileId,
        });
      }
      let indexName: string;
      try {
        indexName = vectorizeIndexName(profileId);
      } catch {
        return { ok: false, summary: "el perfil no produce un nombre de índice válido" };
      }
      const accountId = auth.accountId ?? "";
      const got = await run(accountId, ["vectorize", "get", indexName, "--json"]);
      const parsed = parseVectorizeIndex(parseJsonText(got.stdout), indexName);
      if (!parsed.ok) {
        return { ok: false, summary: parsed.reason };
      }
      const names = parseMetadataIndexNames(
        parseJsonText(
          (await run(accountId, ["vectorize", "list-metadata-index", indexName, "--json"])).stdout,
        ),
      );
      if (!names.ok) {
        return { ok: false, summary: names.reason };
      }
      const missing = VECTORIZE_METADATA_INDEXES.filter((name) => !names.names.includes(name));
      return {
        ok: missing.length === 0 && parsed.index.metric === "cosine",
        summary: "lectura administrativa del índice, sin upsert",
        lines: [
          `dimensión observada en get: ${String(parsed.index.dimensions)}`,
          `métrica observada en get: ${parsed.index.metric}`,
          `metadatos ausentes: ${missing.length === 0 ? "ninguno" : missing.join(", ")}`,
        ],
        receipt: {
          indexName: parsed.index.name,
          dimensions: parsed.index.dimensions,
          metric: parsed.index.metric,
          metadataIndexes: names.names,
        },
      };
    },
    async selectActive(_auth: ActivationAuth, profileId: string): Promise<CommandOutcome> {
      return executeSelectActive({ plane: options.plane ?? null, profileId });
    },
    async verify(auth: ActivationAuth): Promise<CommandOutcome> {
      if (options.verifySession === undefined) {
        return {
          ok: false,
          summary:
            "La verificación no está conectada al runtime local. No se llama a OpenRouter ni se copia otra canalización.",
        };
      }
      const prices = options.sessionPrices ?? {
        embeddingUsdPerMillionInput: 0.0118,
        generativeUsdPerMillionInput: null,
        generativeUsdPerMillionOutput: null,
      };
      const limits = options.sessionLimits ?? { generative: 4, embedding: 8 };
      if (
        !planFits({
          maxSpendUsd: auth.maxSpendUsd ?? 0,
          maxGenerativeCalls: limits.generative,
          maxEmbeddingCalls: limits.embedding,
          prices,
          state: options.allowance?.snapshot(),
        })
      ) {
        return {
          ok: false,
          summary: "El plan de verificación no cabe en la sesión. No se invoca al proveedor.",
          receipt: { calls: 0 },
        };
      }
      const outcome = await options.verifySession(options.allowance ?? probeAllowance(auth));
      if (options.paths !== undefined) {
        const receipt = outcome.receipt ?? {};
        const provenance = typeof receipt.provenance === "string" ? receipt.provenance : "unknown";
        const live = typeof receipt.live === "boolean" ? receipt.live : null;
        const body = {
          at: options.paths.now,
          accountId: auth.accountId,
          modelId: auth.modelId,
          provenance,
          live,
          measuredChargeUsd: null,
          summary: outcome.summary,
          receipt,
        };
        const liveLabel = live === true ? "sí" : live === false ? "no" : "desconocida";
        await writeAtomic(
          path.join(options.paths.receiptDir, "verify.json"),
          `${JSON.stringify(body, null, 2)}\n`,
        );
        await writeAtomic(
          path.join(options.paths.receiptDir, "verify.md"),
          `# Verificación\n\n${outcome.summary}\n\nProcedencia: ${String(provenance)}.\nLlamada de pago real: ${liveLabel}.\nCargo medido: desconocido.\n`,
        );
      }
      return outcome;
    },
  };
}

function loadPrepared(corpusPath: string): PreparedCorpus {
  return JSON.parse(readFileSync(corpusPath, "utf8")) as PreparedCorpus;
}

export function semanticIndexName(corpusPath: string, dimensions: number): string {
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { preparationId?: unknown };
  if (typeof corpus.preparationId !== "string") {
    throw new Error("El corpus preparado no tiene preparationId.");
  }
  return vectorizeIndexName(
    indexProfileId({
      family: "workers-ai",
      model: "@cf/baai/bge-m3",
      dimensions,
      metric: "cosine",
      chunkMaxChars: PREP_CHUNKING.maxChars,
      chunkOverlap: PREP_CHUNKING.overlap,
      providerRevision: null,
      preparationId: corpus.preparationId,
    }),
  );
}

export function courseIndexNames(
  body: unknown,
): { ok: true; names: string[] } | { ok: false; reason: string } {
  const parsed = parseVectorizeIndexList(body);
  if (!parsed.ok) {
    return parsed;
  }
  return {
    ok: true,
    names: parsed.names.filter((name) => name.startsWith(COURSE_VECTORIZE_PREFIX)),
  };
}

export function databaseUuid(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const value = record.uuid ?? record.database_id ?? record.databaseId;
  return typeof value === "string" && /^[0-9a-f-]{32,36}$/i.test(value) ? value : null;
}

function namedState(
  result: { code: number | null; stdout: string; stderr: string },
  expectedName: string,
): "presente" | "ausente" | "lectura no confirmada" {
  if (result.code === 0) {
    const body = parseJsonText(result.stdout);
    if (typeof body === "object" && body !== null) {
      const name = (body as { name?: unknown }).name;
      if (typeof name === "string" && name !== expectedName) {
        return "lectura no confirmada";
      }
      return "presente";
    }
  }
  return absenceReason(result) === "absent" ? "ausente" : "lectura no confirmada";
}

async function writeAccountConfig(accountId: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-account-"));
  const config = path.join(dir, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "thepower-rag-activation",
      account_id: accountId,
      compatibility_date: "2026-10-02",
    }),
  );
  return config;
}

async function writeMigrationConfig(
  accountId: string,
  databaseId: string,
  migrationsDir: string,
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-migrate-"));
  const config = path.join(dir, "wrangler.json");
  await writeFile(
    config,
    JSON.stringify({
      name: "thepower-rag-activation",
      account_id: accountId,
      compatibility_date: "2026-10-02",
      d1_databases: [
        {
          binding: "DB",
          database_name: COURSE_D1_NAME,
          database_id: databaseId,
          migrations_dir: migrationsDir,
        },
      ],
    }),
  );
  return config;
}

export { parseUpsertMutationIds };
