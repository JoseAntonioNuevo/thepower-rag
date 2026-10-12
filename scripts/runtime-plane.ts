// GUÍA DE LECTURA · scripts/runtime-plane.ts
// Arranca el Worker puente propio para los comandos de datos: decide su papel, confirma D1 y el índice
// remoto con wrangler y espera a que escuche en 127.0.0.1.
// Archivos temporales.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Nombre de la base D1 del curso.
import { COURSE_D1_NAME } from "@thepower-rag/core";
// Tipo de comando de activación.
import type { ActivationCommand } from "./activation";
// Extrae el UUID de D1.
import { databaseUuid } from "./course-executor";
// Arranque y tipos del puente.
import {
  spawnWranglerBridge,
  startLoopbackBridge,
  type BridgeRole,
  type BridgeSpec,
} from "./loopback-bridge";
// Entorno acotado y tipo del ejecutor.
import { scopedWranglerEnv, type ProcessRunner } from "./process-runner";
// fetch a 127.0.0.1.
import { loopbackFetch } from "./loopback-fetch";
// Parsers de las salidas de wrangler.
import { parseJsonText, parseVectorizeIndex, parseMetadataIndexNames } from "./wrangler-parse";

// Comandos que necesitan el puente.
const DATA_COMMANDS = new Set<ActivationCommand>([
  "probe-embeddings",
  "ingest",
  "resume",
  "select-active",
  "verify",
]);

// ¿Hay que arrancar el puente? Solo al ejecutar un comando de datos.
export function shouldStartRuntime(command: string, execute: boolean, read: boolean): boolean {
  // Condición.
  return execute && !read && DATA_COMMANDS.has(command as ActivationCommand);
}

// Papel del puente según el comando.
export function bridgeRoleFor(command: string): BridgeRole {
  // Sonda de embeddings.
  if (command === "probe-embeddings") {
    // probe.
    return "probe";
  }
  // Verificación.
  if (command === "verify") {
    // verify.
    return "verify";
  }
  // El resto: storage.
  return "storage";
}

// UUID de D1 confirmado por wrangler, o null.
async function confirmedDatabaseId(
  runner: ProcessRunner,
  accountId: string,
): Promise<string | null> {
  // Carpeta temporal.
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-d1-"));
  // Configuración mínima.
  const config = path.join(dir, "wrangler.json");
  // La escribe.
  await writeFile(
    config,
    JSON.stringify({
      name: "thepower-rag-activation",
      account_id: accountId,
      compatibility_date: "2026-10-02",
    }),
  );
  // try/finally: borra la carpeta.
  try {
    // d1 info.
    const result = await runner.run(
      ["d1", "info", COURSE_D1_NAME, "--json", "--config", config],
      scopedWranglerEnv(process.env, accountId),
    );
    // Fallo.
    if (result.code !== 0) {
      // null.
      return null;
    }
    // UUID.
    return databaseUuid(parseJsonText(result.stdout));
  } finally {
    // Borra la carpeta.
    await rm(dir, { recursive: true, force: true });
  }
}

// Arranca el puente y devuelve su origen, ficha y parada.
export async function startOwnedBridge(input: {
  // Cuenta.
  accountId: string;
  // Puerto.
  port: number;
  // Puerto del inspector.
  inspectorPort: number;
  // Ficha.
  token: string;
  // Raíz del proyecto.
  projectRoot: string;
  // Papel.
  role: BridgeRole;
  // ¿Bindings remotos?
  remote: boolean;
  // Carpeta de estado.
  persistDir: string;
  // Índice.
  indexName?: string;
  // Base D1.
  databaseId?: string;
  // Modelo generador.
  modelId?: string;
  // Modelo evaluador.
  evaluatorModelId?: string;
  // Perfil.
  profileId?: string;
  // Versión del corpus.
  corpusVersion?: string;
  // Dimensiones.
  dimensions?: number;
  // Umbral.
  minScore?: number;
  // Clave del proveedor.
  apiKey?: string;
  // Ejecutor de wrangler.
  runner: ProcessRunner;
  // ¿Sin red?
  offline: boolean;
}): Promise<{ origin: string; token: string; shutdown: () => Promise<void> }> {
  // Remoto y sin red a la vez: error.
  if (input.remote && input.offline) {
    // Error.
    throw new Error("La ruta offline no puede activar bindings remotos.");
  }
  // Verificar en remoto exige el umbral calibrado.
  if (input.role === "verify" && input.remote && input.minScore === undefined) {
    // Error.
    throw new Error(
      "Falta el umbral semántico observado. No se usa 0,33 ni se llama al proveedor.",
    );
  }
  // Base D1.
  let databaseId = input.databaseId;
  // Remoto con almacenamiento.
  if (input.remote && input.role !== "probe") {
    // Confirma el UUID.
    databaseId = (await confirmedDatabaseId(input.runner, input.accountId)) ?? undefined;
    // Sin UUID.
    if (databaseId === undefined) {
      // Error.
      throw new Error("d1 info no trajo el uuid de la base. No se inventa uno.");
    }
  }
  // Carpeta de estado.
  await mkdir(input.persistDir, { recursive: true });
  // Métrica.
  let metric: string | undefined;
  // Índices de metadatos.
  let metadataIndexes: string[] | undefined;
  // Remoto con almacenamiento.
  if (input.remote && input.role !== "probe") {
    // Entorno acotado.
    const env = scopedWranglerEnv(process.env, input.accountId);
    // vectorize get.
    const indexResult = await input.runner.run(
      ["vectorize", "get", input.indexName ?? "", "--json"],
      env,
    );
    // Datos del índice.
    const parsed = parseVectorizeIndex(parseJsonText(indexResult.stdout), input.indexName ?? "");
    // Índices de metadatos.
    const metadataResult = await input.runner.run(
      ["vectorize", "list-metadata-index", input.indexName ?? "", "--json"],
      env,
    );
    // Nombres.
    const metadata = parseMetadataIndexNames(parseJsonText(metadataResult.stdout));
    // Algún fallo o dimensiones distintas.
    if (
      indexResult.code !== 0 ||
      !parsed.ok ||
      metadataResult.code !== 0 ||
      !metadata.ok ||
      parsed.index.dimensions !== input.dimensions
    ) {
      // Error.
      throw new Error("No se confirmó la configuración administrativa del índice remoto.");
    }
    // Métrica.
    metric = parsed.index.metric;
    // Índices.
    metadataIndexes = metadata.names;
  }
  // Especificación del puente.
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
  // Ruta de wrangler.
  const wranglerPath = path.join(
    input.projectRoot,
    "apps/web/node_modules/wrangler/bin/wrangler.js",
  );
  // Arranca y espera a que esté listo.
  const started = await startLoopbackBridge(spec, {
    timeoutMs: 60_000,
    command: wranglerPath,
    spawn: spawnWranglerBridge(wranglerPath, input.projectRoot, input.accountId),
    fetch: async (url, init) => {
      // Petición.
      const response = await loopbackFetch(url, init);
      // Cuerpo.
      const body = (await response.json().catch(() => null)) as {
        // Si el puente está listo.
        ok?: boolean;
        // Dirección en la que escucha.
        bind?: string;
      } | null;
      // Estado y cuerpo.
      return { status: response.status, body: body ?? undefined };
    },
  });
  // Origen, ficha y parada.
  return {
    origin: `http://127.0.0.1:${String(input.port)}`,
    token: input.token,
    shutdown: started.shutdown,
  };
}
