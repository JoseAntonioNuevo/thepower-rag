// GUÍA DE LECTURA · scripts/activate.ts
// Punto de entrada de `bun run activate <comando>`: plan, sonda de embeddings, ingesta, selección del perfil
// activo y verificación. Sin --execute o --read solo muestra el plan; con ellos exige la autorización de
// apps/web/.activation.json, arranca el puente propio y guarda la sesión de gasto al terminar.
// Bytes aleatorios para la ficha del puente.
import { randomBytes } from "node:crypto";
// Lectura de archivos.
import { mkdirSync, readFileSync } from "node:fs";
// Carpetas.
import { mkdir } from "node:fs/promises";
// Rutas.
import path from "node:path";
// Modelo y tarifas de Haiku.
import {
  HAIKU_INPUT_USD_PER_MILLION,
  HAIKU_MODEL_ID,
  HAIKU_OUTPUT_USD_PER_MILLION,
} from "../apps/api/src/model";
// Clave de Anthropic.
import { readRepoAnthropicKey } from "./anthropic-key";
// Núcleo: umbral emulado, procedencia, identidad del corpus y nombre del índice.
import {
  LOCAL_EMULATED_MIN_SCORE,
  classifyRuntime,
  semanticIdentity,
  vectorizeIndexName,
  type PreparedCorpus,
  type RuntimeProvenance,
} from "@thepower-rag/core";
// Comandos, autorización y orquestación de la activación.
import {
  ACTIVATION_COMMANDS,
  missingFor,
  parseActivation,
  runActivation,
  type ActivationCommand,
} from "./activation";
// Cliente del puente.
import { createBridgePlane } from "./bridge-client";
// Nombre del índice y ejecutor del curso.
import { semanticIndexName, createCourseExecutor } from "./course-executor";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";
// Sesión de gasto.
import { openExecutionSession, saveExecutionSession } from "./execution-session";
// Verificación por HTTP.
import { createHttpVerifier } from "./http-verify";
// Textos de las fuentes.
import { attachSourceBodies } from "./source-bodies";
// Arranque del puente.
import { bridgeRoleFor, shouldStartRuntime, startOwnedBridge } from "./runtime-plane";
// Ejecutor de wrangler.
import { createWranglerRunner } from "./process-runner";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");
// Argumentos.
const argv = process.argv.slice(2);
// Comando (por defecto plan).
const command = (argv.find((item) => !item.startsWith("--")) ?? "plan") as ActivationCommand;
// ¿Ejecutar?
const execute = argv.includes("--execute");
// ¿Solo leer?
const read = argv.includes("--read");
// --profile=.
const profileFlag = argv.find((item) => item.startsWith("--profile="));
// Perfil pedido.
const profileId = profileFlag === undefined ? null : profileFlag.slice("--profile=".length);

// Comando desconocido.
if (!ACTIVATION_COMMANDS.includes(command)) {
  // Mensaje.
  console.log("comando no reconocido");
  // Código 2.
  process.exitCode = 2;
} else {
  // ¿Entrada offline emulada? (pruebas).
  const offline = process.env.THEPOWER_OFFLINE_ENTRY === "emulated";
  // Archivo de autorización.
  const authPath = offline
    ? (process.env.THEPOWER_OFFLINE_AUTH ?? "")
    : path.join(root, "apps/web/.activation.json");
  // Autorización.
  let authorization: unknown = undefined;
  // Solo se lee al ejecutar o leer.
  if (execute || read) {
    // Archivo ausente o roto: null.
    try {
      // Lee el JSON.
      authorization = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
    } catch {
      // null.
      authorization = null;
    }
  }
  // Autorización validada.
  const parsed = authorization === undefined ? null : parseActivation(authorization);
  // Lo que falta para este comando.
  const missing = parsed === null || !parsed.ok ? [] : missingFor(command, parsed.auth, profileId);
  // ¿Arrancar el puente?
  const startRuntime =
    shouldStartRuntime(command, execute, read) && parsed?.ok === true && missing.length === 0;
  // Parada del puente.
  const lifecycle: { shutdown: (() => Promise<void>) | null } = { shutdown: null };
  // Sesión de gasto.
  let ledger: Awaited<ReturnType<typeof openExecutionSession>> | null = null;
  // Archivo de sesión.
  let sessionFile = "";
  // Procedencia.
  let sessionProvenance: RuntimeProvenance | null = null;
  // Perfil.
  let sessionProfile: string | null = null;
  // Tarifas sintéticas en offline.
  const pricesSynthetic = offline;
  // Al recibir una señal, para el puente y sale.
  const stopBridge = () => {
    // Para y sale con 1.
    void lifecycle.shutdown?.().finally(() => process.exit(1));
  };
  // SIGTERM.
  process.once("SIGTERM", stopBridge);
  // Ctrl+C.
  process.once("SIGINT", stopBridge);
  // try/catch/finally: guarda la sesión y para el puente.
  try {
    // Ejecutor de wrangler.
    const runner = createWranglerRunner(
      path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
      root,
    );
    // Ejecutor de datos con puente, de gestión con wrangler o ninguno.
    const executor = startRuntime
      ? await (async () => {
          // Sin autorización.
          if (parsed === null || !parsed.ok) {
            // Nada.
            return undefined;
          }
          // Papel del puente.
          const role = bridgeRoleFor(command);
          // Puerto.
          const port = Number(process.env.THEPOWER_BRIDGE_PORT ?? "8791");
          // Carpeta de sesión.
          const sessionDir =
            process.env.THEPOWER_SESSION_DIR ?? path.join(root, "activation-receipts");
          // Corpus.
          const corpusPath = path.join(root, "corpus/prepared/corpus.json");
          // Con los textos.
          const corpus = await attachSourceBodies(
            JSON.parse(readFileSync(corpusPath, "utf8")) as PreparedCorpus,
            path.join(root, "corpus/sources"),
          );
          // Dimensiones medidas.
          const dimensions = parsed.auth.observedDimensions;
          // Perfil semántico.
          const profile = dimensions === null ? null : semanticIdentity(corpus, dimensions);
          // Nombre del índice según el comando.
          const indexName =
            role === "probe"
              ? undefined
              : command === "select-active" && profileId !== null
                ? vectorizeIndexName(profileId)
                : dimensions === null
                  ? undefined
                  : semanticIndexName(corpusPath, dimensions);
          // ¿Remoto?
          const remote = offline ? false : true;
          // Umbral: el emulado en offline; en remoto, el calibrado.
          let minScore: number | undefined = offline ? LOCAL_EMULATED_MIN_SCORE : undefined;
          // Clave del proveedor.
          let apiKey: string | undefined;
          // Tarifas verificadas.
          let verifiedPrices:
            | {
                // Embeddings.
                embeddingUsdPerMillionInput: number;
                // Entrada generativa.
                generativeUsdPerMillionInput: number;
                // Salida generativa.
                generativeUsdPerMillionOutput: number;
              }
            | undefined;
          // Verificación remota.
          if (remote && role === "verify") {
            // Calibración.
            const calibration = JSON.parse(
              readFileSync(path.join(root, "activation-receipts/calibration.json"), "utf8"),
            );
            // Debe coincidir con el perfil.
            if (
              calibration.profileId !== profile?.id ||
              calibration.embeddingModel !== "@cf/baai/bge-m3" ||
              calibration.dimensions !== dimensions ||
              !Number.isFinite(calibration.minScore) ||
              calibration.minScore < -1 ||
              calibration.minScore > 1
            )
              throw new Error("La calibración no coincide con el perfil remoto.");
            // Umbral calibrado.
            minScore = calibration.minScore;
            // Exige Haiku 5.5.
            if (parsed.auth.modelId !== HAIKU_MODEL_ID) {
              // Error.
              throw new Error("La verificación real exige MODEL_ID claude-haiku-5-5.");
            }
            // Clave.
            apiKey = readRepoAnthropicKey(root);
            // Sin clave: error.
            if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en .env.");
            // Tarifas de Haiku.
            verifiedPrices = {
              embeddingUsdPerMillionInput: 0.0118,
              generativeUsdPerMillionInput: HAIKU_INPUT_USD_PER_MILLION,
              generativeUsdPerMillionOutput: HAIKU_OUTPUT_USD_PER_MILLION,
            };
          }
          // Arranca el puente.
          const owned = await startOwnedBridge({
            // Cuenta, puertos y ficha aleatoria de 24 bytes.
            accountId: parsed.auth.accountId ?? COURSE_DESTINATION.accountId,
            port,
            inspectorPort: port + 1,
            token: randomBytes(24).toString("hex"),
            // Raíz, papel, si usa recursos remotos y carpeta de estado.
            projectRoot: root,
            role,
            remote,
            persistDir: path.join(sessionDir, "wrangler-state"),
            // Índice y base (la base se lee después).
            indexName,
            databaseId: undefined,
            // Modelos: emulados sin red o los autorizados.
            modelId: offline ? "local-emulated-generator" : (parsed.auth.modelId ?? undefined),
            evaluatorModelId: offline
              ? "local-emulated-evaluator"
              : (parsed.auth.modelId ?? undefined),
            // Perfil, corpus, dimensión y umbral.
            profileId: profile?.id,
            corpusVersion: corpus.preparationId,
            dimensions: dimensions ?? undefined,
            minScore,
            // Clave del proveedor, ejecutor de Wrangler y si es offline.
            apiKey,
            runner,
            offline,
          });
          // Guarda la parada.
          lifecycle.shutdown = owned.shutdown;
          // Cliente.
          const plane = await createBridgePlane({ origin: owned.origin, token: owned.token });
          // Procedencia.
          const classified = classifyRuntime(plane.adapters());
          // Desconocida.
          if (classified.provenance === "unknown") {
            // Error.
            throw new Error("El plano no declara una procedencia.");
          }
          // Procedencia.
          sessionProvenance = classified.provenance;
          // Perfil.
          sessionProfile = profile?.id ?? null;
          // Archivo de sesión.
          sessionFile = path.join(sessionDir, "allowance-session.json");
          // Límites (más pequeños en la sonda).
          const limits =
            process.env.THEPOWER_SESSION_LIMITS === "probe"
              ? { generative: 0, embedding: 2 }
              : { generative: 4, embedding: 128 };
          // Sesión de gasto.
          ledger = await openExecutionSession({
            // Archivo de la sesión, cuenta, perfil y procedencia.
            file: sessionFile,
            accountId: parsed.auth.accountId ?? "",
            profileId: sessionProfile,
            provenance: sessionProvenance,
            // Si los precios son sintéticos, tope de gasto y límites de llamadas.
            pricesSynthetic,
            maxSpendUsd: parsed.auth.maxSpendUsd ?? 0,
            maxGenerativeCalls: limits.generative,
            maxEmbeddingCalls: limits.embedding,
            // Precios: sintéticos en offline; en real, los verificados o desconocidos.
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
          // Carpeta de caché.
          await mkdir(path.join(sessionDir, "cache"), { recursive: true });
          // Ejecutor del curso.
          return createCourseExecutor({
            runner: {
              run: async () => {
                // Las operaciones de datos no usan wrangler.
                throw new Error("Esta operación de datos no usa Wrangler de gestión.");
              },
            },
            cwd: root,
            // Carpeta de migraciones, corpus y plano de datos.
            migrationsDir: path.join(root, "apps/api/migrations"),
            corpusPath,
            corpus,
            plane,
            // Sesión de gasto y rutas de recibos.
            allowance: ledger,
            paths: {
              receiptDir: sessionDir,
              cacheDir: path.join(sessionDir, "cache"),
              now: new Date().toISOString(),
            },
            // Solo «verify» usa el verificador HTTP contra el puente.
            verifySession:
              role === "verify"
                ? createHttpVerifier({ origin: owned.origin, token: owned.token })
                : undefined,
            // Precios y límites que se guardan con la sesión.
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
      : // Sin plano: ejecutor de Wrangler para identidad, inventario y migraciones (no en offline).
        execute || read
        ? offline
          ? undefined
          : createCourseExecutor({
              runner,
              cwd: root,
              migrationsDir: path.join(root, "apps/api/migrations"),
              corpusPath: path.join(root, "corpus/prepared/corpus.json"),
            })
        : undefined;
    // Ejecuta el comando.
    const result = await runActivation({
      command,
      execute,
      read,
      authorization,
      profileId,
      executor,
    });
    // Lectura correcta: guarda el estado.
    if (read && result.code === 0 && !offline) {
      // Carpeta.
      const receiptDir = path.join(root, "activation-receipts");
      // La crea.
      mkdirSync(receiptDir, { recursive: true });
      // writeFileSync.
      const { writeFileSync } = await import("node:fs");
      // Escribe status.json.
      writeFileSync(
        path.join(receiptDir, "status.json"),
        `${JSON.stringify({ command, lines: result.lines, at: "2026-10-03" }, null, 2)}\n`,
      );
    }
    // Muestra el resultado.
    console.log(result.lines.join("\n"));
    // Código.
    process.exitCode = result.code;
  } catch (error) {
    // Error.
    console.log(error instanceof Error ? error.message : "El plano no pudo arrancar.");
    // Código 2.
    process.exitCode = 2;
  } finally {
    // Si hubo sesión.
    if (ledger !== null && sessionProvenance !== null && sessionFile.length > 0) {
      // Autorización.
      const auth = parsed !== null && parsed.ok ? parsed.auth : null;
      // Guarda la sesión.
      await saveExecutionSession({
        file: sessionFile,
        accountId: auth?.accountId ?? "",
        profileId: sessionProfile,
        provenance: sessionProvenance,
        pricesSynthetic,
        ledger,
      }).catch(() => undefined);
    }
    // Parada.
    const stop = lifecycle.shutdown;
    // Si hay puente.
    if (stop !== null) {
      // Lo para.
      await stop();
    }
  }
}
