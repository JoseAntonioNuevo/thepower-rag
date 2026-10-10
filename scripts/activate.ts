import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  HAIKU_INPUT_USD_PER_MILLION,
  HAIKU_MODEL_ID,
  HAIKU_OUTPUT_USD_PER_MILLION,
} from "../apps/api/src/model";
import { readRepoAnthropicKey } from "./anthropic-key";
import {
  LOCAL_EMULATED_MIN_SCORE,
  classifyRuntime,
  semanticIdentity,
  vectorizeIndexName,
  type PreparedCorpus,
  type RuntimeProvenance,
} from "@thepower-rag/core";
import {
  ACTIVATION_COMMANDS,
  missingFor,
  parseActivation,
  runActivation,
  type ActivationCommand,
} from "./activation";
import { createBridgePlane } from "./bridge-client";
import { semanticIndexName, createCourseExecutor } from "./course-executor";
import { COURSE_DESTINATION } from "./course-destination";
import { openExecutionSession, saveExecutionSession } from "./execution-session";
import { createHttpVerifier } from "./http-verify";
import { attachSourceBodies } from "./source-bodies";
import { bridgeRoleFor, shouldStartRuntime, startOwnedBridge } from "./runtime-plane";
import { createWranglerRunner } from "./process-runner";

const root = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const command = (argv.find((item) => !item.startsWith("--")) ?? "plan") as ActivationCommand;
const execute = argv.includes("--execute");
const read = argv.includes("--read");
const profileFlag = argv.find((item) => item.startsWith("--profile="));
const profileId = profileFlag === undefined ? null : profileFlag.slice("--profile=".length);

if (!ACTIVATION_COMMANDS.includes(command)) {
  console.log("comando no reconocido");
  process.exitCode = 2;
} else {
  const offline = process.env.THEPOWER_OFFLINE_ENTRY === "emulated";
  const authPath = offline
    ? (process.env.THEPOWER_OFFLINE_AUTH ?? "")
    : path.join(root, "apps/web/.activation.json");
  let authorization: unknown = undefined;
  if (execute || read) {
    try {
      authorization = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
    } catch {
      authorization = null;
    }
  }
  const parsed = authorization === undefined ? null : parseActivation(authorization);
  const missing = parsed === null || !parsed.ok ? [] : missingFor(command, parsed.auth, profileId);
  const startRuntime =
    shouldStartRuntime(command, execute, read) && parsed?.ok === true && missing.length === 0;
  const lifecycle: { shutdown: (() => Promise<void>) | null } = { shutdown: null };
  let ledger: Awaited<ReturnType<typeof openExecutionSession>> | null = null;
  let sessionFile = "";
  let sessionProvenance: RuntimeProvenance | null = null;
  let sessionProfile: string | null = null;
  const pricesSynthetic = offline;
  const stopBridge = () => {
    void lifecycle.shutdown?.().finally(() => process.exit(1));
  };
  process.once("SIGTERM", stopBridge);
  process.once("SIGINT", stopBridge);
  try {
    const runner = createWranglerRunner(
      path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
      root,
    );
    const executor = startRuntime
      ? await (async () => {
          if (parsed === null || !parsed.ok) {
            return undefined;
          }
          const role = bridgeRoleFor(command);
          const port = Number(process.env.THEPOWER_BRIDGE_PORT ?? "8791");
          const sessionDir =
            process.env.THEPOWER_SESSION_DIR ?? path.join(root, "activation-receipts");
          const corpusPath = path.join(root, "corpus/prepared/corpus.json");
          const corpus = await attachSourceBodies(
            JSON.parse(readFileSync(corpusPath, "utf8")) as PreparedCorpus,
            path.join(root, "corpus/sources"),
          );
          const dimensions = parsed.auth.observedDimensions;
          const profile = dimensions === null ? null : semanticIdentity(corpus, dimensions);
          const indexName =
            role === "probe"
              ? undefined
              : command === "select-active" && profileId !== null
                ? vectorizeIndexName(profileId)
                : dimensions === null
                  ? undefined
                  : semanticIndexName(corpusPath, dimensions);
          const remote = offline ? false : true;
          let minScore: number | undefined = offline ? LOCAL_EMULATED_MIN_SCORE : undefined;
          let apiKey: string | undefined;
          let verifiedPrices:
            | {
                embeddingUsdPerMillionInput: number;
                generativeUsdPerMillionInput: number;
                generativeUsdPerMillionOutput: number;
              }
            | undefined;
          if (remote && role === "verify") {
            const calibration = JSON.parse(
              readFileSync(path.join(root, "activation-receipts/calibration.json"), "utf8"),
            );
            if (
              calibration.profileId !== profile?.id ||
              calibration.embeddingModel !== "@cf/baai/bge-m3" ||
              calibration.dimensions !== dimensions ||
              !Number.isFinite(calibration.minScore) ||
              calibration.minScore < -1 ||
              calibration.minScore > 1
            )
              throw new Error("La calibración no coincide con el perfil remoto.");
            minScore = calibration.minScore;
            if (parsed.auth.modelId !== HAIKU_MODEL_ID) {
              throw new Error("La verificación real exige MODEL_ID claude-haiku-5-5.");
            }
            apiKey = readRepoAnthropicKey(root);
            if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en .env.");
            verifiedPrices = {
              embeddingUsdPerMillionInput: 0.0118,
              generativeUsdPerMillionInput: HAIKU_INPUT_USD_PER_MILLION,
              generativeUsdPerMillionOutput: HAIKU_OUTPUT_USD_PER_MILLION,
            };
          }
          const owned = await startOwnedBridge({
            accountId: parsed.auth.accountId ?? COURSE_DESTINATION.accountId,
            port,
            inspectorPort: port + 1,
            token: randomBytes(24).toString("hex"),
            projectRoot: root,
            role,
            remote,
            persistDir: path.join(sessionDir, "wrangler-state"),
            indexName,
            databaseId: undefined,
            modelId: offline ? "local-emulated-generator" : (parsed.auth.modelId ?? undefined),
            evaluatorModelId: offline
              ? "local-emulated-evaluator"
              : (parsed.auth.modelId ?? undefined),
            profileId: profile?.id,
            corpusVersion: corpus.preparationId,
            dimensions: dimensions ?? undefined,
            minScore,
            apiKey,
            runner,
            offline,
          });
          lifecycle.shutdown = owned.shutdown;
          const plane = await createBridgePlane({ origin: owned.origin, token: owned.token });
          const classified = classifyRuntime(plane.adapters());
          if (classified.provenance === "unknown") {
            throw new Error("El plano no declara una procedencia.");
          }
          sessionProvenance = classified.provenance;
          sessionProfile = profile?.id ?? null;
          sessionFile = path.join(sessionDir, "allowance-session.json");
          const limits =
            process.env.THEPOWER_SESSION_LIMITS === "probe"
              ? { generative: 0, embedding: 2 }
              : { generative: 4, embedding: 128 };
          ledger = await openExecutionSession({
            file: sessionFile,
            accountId: parsed.auth.accountId ?? "",
            profileId: sessionProfile,
            provenance: sessionProvenance,
            pricesSynthetic,
            maxSpendUsd: parsed.auth.maxSpendUsd ?? 0,
            maxGenerativeCalls: limits.generative,
            maxEmbeddingCalls: limits.embedding,
            prices: offline
              ? {
                  embeddingUsdPerMillionInput: 0.0118,
                  generativeUsdPerMillionInput: 1,
                  generativeUsdPerMillionOutput: 1,
                }
              : (verifiedPrices ?? {
                  embeddingUsdPerMillionInput: 0.0118,
                  generativeUsdPerMillionInput: null,
                  generativeUsdPerMillionOutput: null,
                }),
          });
          await mkdir(path.join(sessionDir, "cache"), { recursive: true });
          return createCourseExecutor({
            runner: {
              run: async () => {
                throw new Error("Esta operación de datos no usa Wrangler de gestión.");
              },
            },
            cwd: root,
            migrationsDir: path.join(root, "apps/api/migrations"),
            corpusPath,
            corpus,
            plane,
            allowance: ledger,
            paths: {
              receiptDir: sessionDir,
              cacheDir: path.join(sessionDir, "cache"),
              now: new Date().toISOString(),
            },
            verifySession:
              role === "verify"
                ? createHttpVerifier({ origin: owned.origin, token: owned.token })
                : undefined,
            sessionPrices: offline
              ? {
                  embeddingUsdPerMillionInput: 0.0118,
                  generativeUsdPerMillionInput: 1,
                  generativeUsdPerMillionOutput: 1,
                }
              : verifiedPrices,
            sessionLimits: limits,
          });
        })()
      : execute || read
        ? offline
          ? undefined
          : createCourseExecutor({
              runner,
              cwd: root,
              migrationsDir: path.join(root, "apps/api/migrations"),
              corpusPath: path.join(root, "corpus/prepared/corpus.json"),
            })
        : undefined;
    const result = await runActivation({
      command,
      execute,
      read,
      authorization,
      profileId,
      executor,
    });
    if (read && result.code === 0 && !offline) {
      const receiptDir = path.join(root, "activation-receipts");
      mkdirSync(receiptDir, { recursive: true });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        path.join(receiptDir, "status.json"),
        `${JSON.stringify({ command, lines: result.lines, at: "2026-10-03" }, null, 2)}\n`,
      );
    }
    console.log(result.lines.join("\n"));
    process.exitCode = result.code;
  } catch (error) {
    console.log(error instanceof Error ? error.message : "El plano no pudo arrancar.");
    process.exitCode = 2;
  } finally {
    if (ledger !== null && sessionProvenance !== null && sessionFile.length > 0) {
      const auth = parsed !== null && parsed.ok ? parsed.auth : null;
      await saveExecutionSession({
        file: sessionFile,
        accountId: auth?.accountId ?? "",
        profileId: sessionProfile,
        provenance: sessionProvenance,
        pricesSynthetic,
        ledger,
      }).catch(() => undefined);
    }
    const stop = lifecycle.shutdown;
    if (stop !== null) {
      await stop();
    }
  }
}
