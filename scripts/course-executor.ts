// GUÍA DE LECTURA · scripts/course-executor.ts
// Ejecutor real de la activación con wrangler: identidad, inventario, creación de recursos (solo si la
// lectura confirma la ausencia y hay permiso), migraciones, y delegación de los comandos de datos al plano.
// Nunca borra recursos ni pasa tokens por argumentos.
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Archivos temporales.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Nombres del curso, identidad del perfil y particionado.
import {
  COURSE_D1_NAME,
  COURSE_R2_NAME,
  COURSE_VECTORIZE_PREFIX,
  indexProfileId,
  PREP_CHUNKING,
  VECTORIZE_METADATA_INDEXES,
  vectorizeIndexName,
} from "@thepower-rag/core";
// Tipo del corpus preparado.
import type { PreparedCorpus } from "@thepower-rag/core";
// Tipos de la activación.
import type { ActivationAuth, CommandOutcome } from "./activation";
// Operaciones de datos del curso.
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
// Tipo de la sesión de gasto.
import type { AllowanceLedger } from "@thepower-rag/core";
// Entorno acotado y ejecutor de procesos.
import { scopedWranglerEnv, type ProcessRunner } from "./process-runner";
// Parsers de wrangler.
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

// Opciones del ejecutor.
export interface ExecutorOptions {
  // Ejecutor de procesos.
  runner: ProcessRunner;
  // Raíz del proyecto.
  cwd: string;
  // Carpeta de migraciones.
  migrationsDir: string;
  // Corpus preparado.
  corpusPath: string;
  // Entorno.
  env?: NodeJS.ProcessEnv;
  // Plano de datos.
  plane?: CourseDataPlane | null;
  // Corpus en memoria.
  corpus?: PreparedCorpus;
  // Sesión de gasto.
  allowance?: AllowanceLedger;
  // Rutas de recibos y caché.
  paths?: RuntimePaths;
  // Verificación por HTTP.
  verifySession?: (allowance: AllowanceLedger) => Promise<CommandOutcome>;
  // Tarifas de la sesión.
  sessionPrices?: {
    // Embeddings.
    embeddingUsdPerMillionInput: number | null;
    // Entrada generativa.
    generativeUsdPerMillionInput: number | null;
    // Salida generativa.
    generativeUsdPerMillionOutput: number | null;
  };
  // Límites de llamadas.
  sessionLimits?: { generative: number; embedding: number };
}

// Crea el ejecutor del curso.
export function createCourseExecutor(options: ExecutorOptions) {
  // Comandos ejecutados (para las pruebas).
  const calls: string[][] = [];
  // Ejecuta wrangler con una configuración temporal de la cuenta.
  const run = async (accountId: string, args: readonly string[]) => {
    // Nunca delete, --update-config ni tokens en los argumentos.
    if (
      args.some((arg) => arg === "delete" || arg === "--update-config" || arg.includes("token"))
    ) {
      // Error.
      throw new Error("argumento de ejecución no permitido");
    }
    // Registra.
    calls.push([...args]);
    // Configuración temporal.
    const config = await writeAccountConfig(accountId);
    // try/finally: borra la configuración.
    try {
      // Ejecuta con el entorno acotado.
      const result = await options.runner.run(
        [...args, "--config", config],
        scopedWranglerEnv(options.env ?? process.env, accountId),
      );
      // Salidas sin secretos.
      return {
        ...result,
        stdout: sanitizeCommandText(result.stdout),
        stderr: sanitizeCommandText(result.stderr),
      };
    } finally {
      // Borra la carpeta.
      await rm(path.dirname(config), { recursive: true, force: true });
    }
  };

  // Operaciones del ejecutor.
  return {
    calls,
    // identify: comprueba la sesión de wrangler.
    async identify(auth: ActivationAuth): Promise<CommandOutcome> {
      // Cuenta.
      const accountId = auth.accountId ?? "";
      // whoami.
      const result = await run(accountId, ["whoami", "--json", "--account", accountId]);
      // Fallo.
      if (result.code !== 0) {
        // Error.
        return { ok: false, summary: "whoami no completó la lectura de la sesión" };
      }
      // Comprueba la cuenta.
      const parsed = parseWhoami(parseJsonText(result.stdout), {
        accountId,
        accountName: auth.accountName ?? "",
        loginEmail: auth.loginEmail,
      });
      // Distinta.
      if (!parsed.ok) {
        // Error.
        return { ok: false, summary: parsed.reason };
      }
      // Sesión correcta.
      return {
        // ok: la cuenta de la sesión de Wrangler es la del curso.
        ok: true,
        summary: "sesión verificada para la cuenta del curso",
        // Líneas que verá el usuario: correo y cuántas cuentas tiene la sesión.
        lines: [
          `correo: ${parsed.identity.email ?? "no expuesto"}`,
          `cuentas en la sesión: ${String(parsed.identity.accountCount)}`,
        ],
        // Recibo que se guarda en activation-receipts: identidad leída, sin secretos.
        receipt: {
          accountId: parsed.identity.accountId,
          accountName: parsed.identity.accountName,
          email: parsed.identity.email,
          accountCount: parsed.identity.accountCount,
        },
      };
    },
    // inventory: lee qué recursos del curso existen.
    async inventory(auth: ActivationAuth): Promise<CommandOutcome> {
      // Cuenta.
      const accountId = auth.accountId ?? "";
      // D1.
      const d1 = namedState(
        await run(accountId, ["d1", "info", COURSE_D1_NAME, "--json"]),
        COURSE_D1_NAME,
      );
      // R2.
      const r2 = namedState(
        await run(accountId, ["r2", "bucket", "info", COURSE_R2_NAME, "--json"]),
        COURSE_R2_NAME,
      );
      // Vectorize.
      const listed = await run(accountId, ["vectorize", "list", "--json"]);
      // Índices del curso.
      const parsedIndexes =
        listed.code === 0 ? courseIndexNames(parseJsonText(listed.stdout)) : null;
      // Nombres o null.
      const indexes = parsedIndexes?.ok === true ? parsedIndexes.names : null;
      // Líneas.
      const lines = [
        `D1 ${COURSE_D1_NAME}: ${d1}`,
        `R2 ${COURSE_R2_NAME}: ${r2}`,
        `Vectorize con prefijo del curso: ${indexes === null ? "lectura no confirmada" : indexes.length === 0 ? "ausente" : indexes.join(", ")}`,
      ];
      // Inventario.
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
    // provision: crea solo lo que falta y está permitido.
    async provision(auth: ActivationAuth): Promise<CommandOutcome> {
      // Cuenta.
      const accountId = auth.accountId ?? "";
      // Creados.
      const created: string[] = [];
      // Estado de D1.
      const d1 = namedState(
        await run(accountId, ["d1", "info", COURSE_D1_NAME, "--json"]),
        COURSE_D1_NAME,
      );
      // Ausente y permitido: se crea.
      if (d1 === "ausente" && auth.allowCreateD1) {
        // d1 create.
        const result = await run(accountId, ["d1", "create", COURSE_D1_NAME]);
        // Fallo.
        if (result.code !== 0) {
          // Error.
          return { ok: false, summary: "d1 create no terminó bien" };
        }
        // Creada.
        created.push(COURSE_D1_NAME);
      } else if (d1 === "lectura no confirmada") {
        // No confirmado: no se crea.
        return { ok: false, summary: "no se crea D1 porque la lectura no confirmó su ausencia" };
      }
      // Estado de R2.
      const r2 = namedState(
        await run(accountId, ["r2", "bucket", "info", COURSE_R2_NAME, "--json"]),
        COURSE_R2_NAME,
      );
      // Ausente y permitido.
      if (r2 === "ausente" && auth.allowCreateR2) {
        // r2 bucket create.
        const result = await run(accountId, ["r2", "bucket", "create", COURSE_R2_NAME]);
        // Fallo.
        if (result.code !== 0) {
          // Error.
          return { ok: false, summary: "r2 bucket create no terminó bien" };
        }
        // Creado.
        created.push(COURSE_R2_NAME);
      } else if (r2 === "lectura no confirmada") {
        // No confirmado.
        return { ok: false, summary: "no se crea R2 porque la lectura no confirmó su ausencia" };
      }
      // Sin permiso para Vectorize.
      if (!auth.allowCreateVectorize) {
        // Error.
        return {
          ok: false,
          summary: "falta permiso para crear el índice Vectorize del curso",
          lines: created.map((name) => `creado: ${name}`),
        };
      }
      // Sin dimensión medida.
      if (auth.observedDimensions === null) {
        // Error.
        return {
          ok: false,
          summary: "D1 y R2 quedaron revisados. Falta la dimensión observada para Vectorize.",
          lines: created.map((name) => `creado: ${name}`),
        };
      }
      // Nombre del índice.
      const indexName = semanticIndexName(options.corpusPath, auth.observedDimensions);
      // Índices existentes.
      const listed = await run(accountId, ["vectorize", "list", "--json"]);
      // Fallo.
      if (listed.code !== 0) {
        // Error.
        return { ok: false, summary: "no se crea el índice porque el listado no está confirmado" };
      }
      // Índices del curso.
      const names = courseIndexNames(parseJsonText(listed.stdout));
      // Ilegible.
      if (!names.ok) {
        // Error.
        return { ok: false, summary: "no se crea el índice porque el listado no está confirmado" };
      }
      // No existe: se crea con la dimensión medida y cosine.
      if (!names.names.includes(indexName)) {
        // vectorize create con dimensión y métrica.
        const createdIndex = await run(accountId, [
          "vectorize",
          "create",
          indexName,
          "--dimensions",
          String(auth.observedDimensions),
          "--metric",
          "cosine",
        ]);
        // Fallo.
        if (createdIndex.code !== 0) {
          // Error.
          return { ok: false, summary: "vectorize create no terminó bien" };
        }
        // Creado.
        created.push(indexName);
      } else {
        // Existe: se lee.
        const existing = await run(accountId, ["vectorize", "get", indexName, "--json"]);
        // Configuración.
        const current = parseVectorizeIndex(parseJsonText(existing.stdout), indexName);
        // Ilegible.
        if (!current.ok) {
          // Error.
          return { ok: false, summary: current.reason };
        }
        // Otra dimensión o métrica: no se borra.
        if (
          current.index.dimensions !== auth.observedDimensions ||
          current.index.metric !== "cosine"
        ) {
          // Error.
          return {
            ok: false,
            summary: "el índice existe con otra dimensión o métrica y no se borra",
          };
        }
      }
      // Cada índice de metadatos.
      for (const property of VECTORIZE_METADATA_INDEXES) {
        // Metadatos existentes.
        const listed = parseMetadataIndexNames(
          parseJsonText(
            (await run(accountId, ["vectorize", "list-metadata-index", indexName, "--json"]))
              .stdout,
          ),
        );
        // Ilegible.
        if (!listed.ok) {
          // Error.
          return {
            ok: false,
            summary: "no se crea un metadato porque el listado no está confirmado",
          };
        }
        // Ya existe.
        if (listed.names.includes(property)) {
          // Siguiente.
          continue;
        }
        // Lo crea.
        const mutation = await run(accountId, [
          "vectorize",
          "create-metadata-index",
          indexName,
          "--propertyName",
          property,
          "--type",
          "string",
        ]);
        // Ids de mutación.
        const ids = parseUpsertMutationIds(mutation.stdout);
        // Sin confirmar.
        if (mutation.code !== 0 || ids.length === 0) {
          // Error.
          return { ok: false, summary: `no se confirmó la mutación del metadato ${property}` };
        }
      }
      // Lectura final.
      const visible = parseMetadataIndexNames(
        parseJsonText(
          (await run(accountId, ["vectorize", "list-metadata-index", indexName, "--json"])).stdout,
        ),
      );
      // Ilegible.
      if (!visible.ok) {
        // Error.
        return { ok: false, summary: "la lectura final de metadatos no está confirmada" };
      }
      // Pendientes.
      const pending = VECTORIZE_METADATA_INDEXES.filter((name) => !visible.names.includes(name));
      // Alguno.
      if (pending.length > 0) {
        // Error.
        return {
          ok: false,
          summary: `los metadatos ${pending.join(", ")} siguen pendientes de visibilidad`,
        };
      }
      // Recursos comprobados.
      return {
        ok: true,
        summary: "recursos del curso comprobados",
        lines: created.map((name) => `creado: ${name}`),
      };
    },
    // migrate: aplica las migraciones a D1.
    async migrate(auth: ActivationAuth): Promise<CommandOutcome> {
      // Cuenta.
      const accountId = auth.accountId ?? "";
      // d1 info.
      const info = await run(accountId, ["d1", "info", COURSE_D1_NAME, "--json"]);
      // Estado.
      const state = namedState(info, COURSE_D1_NAME);
      // No confirmada.
      if (state !== "presente") {
        // Error.
        return { ok: false, summary: "no se migró porque D1 del curso no está confirmada" };
      }
      // UUID.
      const databaseId = databaseUuid(parseJsonText(info.stdout));
      // Sin UUID.
      if (databaseId === null) {
        // Error.
        return { ok: false, summary: "d1 info no trajo el uuid de la base" };
      }
      // Configuración con migraciones.
      const config = await writeMigrationConfig(accountId, databaseId, options.migrationsDir);
      // try/finally: borra la configuración.
      try {
        // d1 migrations apply --remote.
        const result = await options.runner.run(
          ["d1", "migrations", "apply", COURSE_D1_NAME, "--remote", "--config", config],
          scopedWranglerEnv(options.env ?? process.env, accountId),
        );
        // Registra.
        calls.push(["d1", "migrations", "apply", COURSE_D1_NAME, "--remote"]);
        // Fallo.
        if (result.code !== 0) {
          // Error.
          return { ok: false, summary: "d1 migrations apply no terminó bien" };
        }
        // Aplicadas.
        return { ok: true, summary: "migraciones aplicadas a la base del curso" };
      } finally {
        // Borra la carpeta.
        await rm(path.dirname(config), { recursive: true, force: true });
      }
    },
    // probeEmbeddings: sonda en el plano.
    async probeEmbeddings(auth: ActivationAuth): Promise<CommandOutcome> {
      // Sonda.
      return executeProbe({
        // Autorización, plano de datos (puente) y sesión de gasto (la persistida o la de la sonda).
        auth,
        plane: options.plane ?? null,
        allowance: options.allowance ?? probeAllowance(auth),
        // Rutas de recibos y de la caché de embeddings, con la fecha de la ejecución.
        paths: options.paths ?? {
          receiptDir: path.join(options.cwd, "activation-receipts"),
          cacheDir: path.join(options.cwd, "activation-receipts", "cache"),
          now: new Date().toISOString(),
        },
        // Cuenta de destino comprobada.
        accountId: auth.accountId ?? "",
      });
    },
    // ingest: ingesta en el plano.
    async ingest(auth: ActivationAuth): Promise<CommandOutcome> {
      // Ingesta.
      return executeIngest({
        // Autorización y corpus preparado (inyectado o leído de disco).
        auth,
        corpus: options.corpus ?? loadPrepared(options.corpusPath),
        // Plano y sesión de gasto.
        plane: options.plane ?? null,
        allowance: options.allowance ?? probeAllowance(auth),
        // Recibos y caché: la caché evita volver a pagar embeddings ya calculados.
        paths: options.paths ?? {
          receiptDir: path.join(options.cwd, "activation-receipts"),
          cacheDir: path.join(options.cwd, "activation-receipts", "cache"),
          now: new Date().toISOString(),
        },
      });
    },
    // resume: reanuda en el plano o lee el índice.
    async resume(auth: ActivationAuth, profileId: string): Promise<CommandOutcome> {
      // Con plano.
      if (options.plane) {
        // Ingesta sin reembeber.
        return executeIngest({
          // Misma ingesta, pero reanudando el perfil indicado: lo ya escrito no se repite.
          auth,
          corpus: options.corpus ?? loadPrepared(options.corpusPath),
          plane: options.plane,
          allowance: options.allowance ?? probeAllowance(auth),
          paths: options.paths ?? {
            receiptDir: path.join(options.cwd, "activation-receipts"),
            cacheDir: path.join(options.cwd, "activation-receipts", "cache"),
            now: new Date().toISOString(),
          },
          // Perfil que se reanuda.
          resumeProfileId: profileId,
        });
      }
      // Nombre del índice.
      let indexName: string;
      // Perfil inválido.
      try {
        // Nombre.
        indexName = vectorizeIndexName(profileId);
      } catch {
        // Error.
        return { ok: false, summary: "el perfil no produce un nombre de índice válido" };
      }
      // Cuenta.
      const accountId = auth.accountId ?? "";
      // vectorize get.
      const got = await run(accountId, ["vectorize", "get", indexName, "--json"]);
      // Configuración.
      const parsed = parseVectorizeIndex(parseJsonText(got.stdout), indexName);
      // Ilegible.
      if (!parsed.ok) {
        // Error.
        return { ok: false, summary: parsed.reason };
      }
      // Metadatos.
      const names = parseMetadataIndexNames(
        parseJsonText(
          (await run(accountId, ["vectorize", "list-metadata-index", indexName, "--json"])).stdout,
        ),
      );
      // Ilegibles.
      if (!names.ok) {
        // Error.
        return { ok: false, summary: names.reason };
      }
      // Metadatos que faltan.
      const missing = VECTORIZE_METADATA_INDEXES.filter((name) => !names.names.includes(name));
      // Lectura administrativa sin escribir.
      return {
        // Correcto solo si están todos los índices de metadatos y la métrica es cosine.
        ok: missing.length === 0 && parsed.index.metric === "cosine",
        summary: "lectura administrativa del índice, sin upsert",
        // Lo observado con «wrangler vectorize get»: dimensión, métrica y metadatos que faltan.
        lines: [
          `dimensión observada en get: ${String(parsed.index.dimensions)}`,
          `métrica observada en get: ${parsed.index.metric}`,
          `metadatos ausentes: ${missing.length === 0 ? "ninguno" : missing.join(", ")}`,
        ],
        // Recibo con lo leído del índice.
        receipt: {
          indexName: parsed.index.name,
          dimensions: parsed.index.dimensions,
          metric: parsed.index.metric,
          metadataIndexes: names.names,
        },
      };
    },
    // selectActive: elige el perfil activo en el plano.
    async selectActive(_auth: ActivationAuth, profileId: string): Promise<CommandOutcome> {
      // Selección.
      return executeSelectActive({ plane: options.plane ?? null, profileId });
    },
    // verify: verificación HTTP si cabe en la sesión de gasto.
    async verify(auth: ActivationAuth): Promise<CommandOutcome> {
      // Sin verificación conectada.
      if (options.verifySession === undefined) {
        // Error.
        return {
          ok: false,
          summary:
            "La verificación no está conectada al runtime local. No se llama a la API de Claude ni se copia otra canalización.",
        };
      }
      // Tarifas.
      const prices = options.sessionPrices ?? {
        embeddingUsdPerMillionInput: 0.0118,
        generativeUsdPerMillionInput: null,
        generativeUsdPerMillionOutput: null,
      };
      // Límites.
      const limits = options.sessionLimits ?? { generative: 4, embedding: 8 };
      // El plan no cabe.
      if (
        !planFits({
          maxSpendUsd: auth.maxSpendUsd ?? 0,
          maxGenerativeCalls: limits.generative,
          maxEmbeddingCalls: limits.embedding,
          prices,
          state: options.allowance?.snapshot(),
        })
      ) {
        // Error sin llamar.
        return {
          ok: false,
          summary: "El plan de verificación no cabe en la sesión. No se invoca al proveedor.",
          receipt: { calls: 0 },
        };
      }
      // Verifica.
      const outcome = await options.verifySession(options.allowance ?? probeAllowance(auth));
      // Con rutas, guarda recibos.
      if (options.paths !== undefined) {
        // Recibo.
        const receipt = outcome.receipt ?? {};
        // Procedencia.
        const provenance = typeof receipt.provenance === "string" ? receipt.provenance : "unknown";
        // ¿En vivo?
        const live = typeof receipt.live === "boolean" ? receipt.live : null;
        // Recibo en JSON.
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
        // Texto de en vivo.
        const liveLabel = live === true ? "sí" : live === false ? "no" : "desconocida";
        // verify.json.
        await writeAtomic(
          path.join(options.paths.receiptDir, "verify.json"),
          `${JSON.stringify(body, null, 2)}\n`,
        );
        // verify.md.
        await writeAtomic(
          path.join(options.paths.receiptDir, "verify.md"),
          `# Verificación\n\n${outcome.summary}\n\nProcedencia: ${String(provenance)}.\nLlamada de pago real: ${liveLabel}.\nCargo medido: desconocido.\n`,
        );
      }
      // Resultado.
      return outcome;
    },
  };
}

// Lee el corpus preparado.
function loadPrepared(corpusPath: string): PreparedCorpus {
  // JSON.
  return JSON.parse(readFileSync(corpusPath, "utf8")) as PreparedCorpus;
}

// Nombre del índice del perfil BGE-M3 con la dimensión medida.
export function semanticIndexName(corpusPath: string, dimensions: number): string {
  // Corpus.
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as { preparationId?: unknown };
  // Sin preparationId.
  if (typeof corpus.preparationId !== "string") {
    // Error.
    throw new Error("El corpus preparado no tiene preparationId.");
  }
  // Nombre derivado del perfil.
  return vectorizeIndexName(
    // El id del perfil se deriva de sus parámetros: BGE-M3, dimensión observada, cosine y troceado.
    indexProfileId({
      family: "workers-ai",
      model: "@cf/baai/bge-m3",
      dimensions,
      metric: "cosine",
      chunkMaxChars: PREP_CHUNKING.maxChars,
      chunkOverlap: PREP_CHUNKING.overlap,
      // Revisión desconocida y versión de preparación del corpus.
      providerRevision: null,
      preparationId: corpus.preparationId,
    }),
  );
}

// Índices con el prefijo del curso.
export function courseIndexNames(
  body: unknown,
): { ok: true; names: string[] } | { ok: false; reason: string } {
  // Lista.
  const parsed = parseVectorizeIndexList(body);
  // Ilegible.
  if (!parsed.ok) {
    // Error.
    return parsed;
  }
  // Filtrados.
  return {
    ok: true,
    names: parsed.names.filter((name) => name.startsWith(COURSE_VECTORIZE_PREFIX)),
  };
}

// UUID de D1 en la salida de d1 info.
export function databaseUuid(body: unknown): string | null {
  // No es objeto.
  if (typeof body !== "object" || body === null) {
    // null.
    return null;
  }
  // Registro.
  const record = body as Record<string, unknown>;
  // uuid o sus alias.
  const value = record.uuid ?? record.database_id ?? record.databaseId;
  // UUID válido o null.
  return typeof value === "string" && /^[0-9a-f-]{32,36}$/i.test(value) ? value : null;
}

// Estado de un recurso según la salida de wrangler.
function namedState(
  result: { code: number | null; stdout: string; stderr: string },
  expectedName: string,
): "presente" | "ausente" | "lectura no confirmada" {
  // Correcto.
  if (result.code === 0) {
    // JSON.
    const body = parseJsonText(result.stdout);
    // Objeto.
    if (typeof body === "object" && body !== null) {
      // Nombre.
      const name = (body as { name?: unknown }).name;
      // Otro nombre.
      if (typeof name === "string" && name !== expectedName) {
        // No confirmado.
        return "lectura no confirmada";
      }
      // Presente.
      return "presente";
    }
  }
  // Ausente o no confirmado.
  return absenceReason(result) === "absent" ? "ausente" : "lectura no confirmada";
}

// Configuración temporal con la cuenta.
async function writeAccountConfig(accountId: string): Promise<string> {
  // Carpeta.
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-account-"));
  // Archivo.
  const config = path.join(dir, "wrangler.json");
  // Lo escribe.
  await writeFile(
    config,
    JSON.stringify({
      name: "thepower-rag-activation",
      account_id: accountId,
      compatibility_date: "2026-10-02",
    }),
  );
  // Ruta.
  return config;
}

// Configuración temporal con D1 y sus migraciones.
async function writeMigrationConfig(
  accountId: string,
  databaseId: string,
  migrationsDir: string,
): Promise<string> {
  // Carpeta.
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-migrate-"));
  // Archivo.
  const config = path.join(dir, "wrangler.json");
  // Lo escribe.
  await writeFile(
    config,
    // Configuración mínima de Wrangler para aplicar migraciones: nombre, cuenta y fecha.
    JSON.stringify({
      name: "thepower-rag-activation",
      account_id: accountId,
      compatibility_date: "2026-10-02",
      // Solo el D1 del curso, con su id real y la carpeta de migraciones.
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
  // Ruta.
  return config;
}

// Reexporta el parser de mutaciones.
export { parseUpsertMutationIds };
