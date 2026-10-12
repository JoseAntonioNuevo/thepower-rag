// GUÍA DE LECTURA · scripts/loopback-bridge.ts
// Arranca el Worker puente con `wrangler dev` solo en 127.0.0.1: genera su configuración en una carpeta
// temporal con permisos 600, pasa la ficha por .dev.vars (nunca por argumentos) y espera a que responda.
// Archivos temporales y permisos.
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
// Lanzar procesos.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Nombres de recursos del curso.
import { COURSE_D1_NAME, COURSE_R2_NAME, COURSE_VECTORIZE_PREFIX } from "@thepower-rag/core";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";
// Entorno acotado de wrangler.
import { scopedWranglerEnv } from "./process-runner";

// Papel del puente.
export type BridgeRole = "probe" | "storage" | "verify";

// Especificación del puente.
export interface BridgeSpec {
  // Cuenta.
  accountId: string;
  // Puerto.
  port: number;
  // Puerto del inspector.
  inspectorPort: number;
  // Ficha compartida.
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
  // Métrica verificada.
  metric?: string;
  // Índices de metadatos.
  metadataIndexes?: string[];
}

// Proceso del puente.
export interface SpawnedBridge {
  // PID.
  pid: number;
  // Lo para.
  kill: () => void;
  // ¿Terminó?
  hasExited: () => boolean;
  // Espera a que termine.
  waitForExit: () => Promise<number | null>;
}

// Solo se admite 127.0.0.1.
export function assertLoopbackHost(ip: string): boolean {
  // Comprobación.
  return ip === "127.0.0.1";
}

// Ruta del Worker puente.
export function bridgeMainPath(projectRoot: string): string {
  // Ruta absoluta.
  return path.resolve(projectRoot, "apps/api/src/bridge-worker.ts");
}

// Configuración de wrangler del puente según papel y modo.
export function bridgeWranglerConfig(spec: BridgeSpec): Record<string, unknown> {
  // Otra cuenta: error.
  if (spec.accountId !== COURSE_DESTINATION.accountId) {
    // Error.
    throw new Error("La cuenta del puente no es la del curso.");
  }
  // Puerto fuera de rango.
  if (!assertLoopbackHost("127.0.0.1") || spec.port < 1 || spec.port > 65535) {
    // Error.
    throw new Error("El puerto del puente no es válido.");
  }
  // Ficha demasiado corta o con espacios.
  if (spec.token.length < 16 || spec.token.includes("\n") || spec.token.includes(" ")) {
    // Error.
    throw new Error("El testigo del puente no es válido.");
  }
  // Punto de entrada.
  const main = bridgeMainPath(spec.projectRoot);
  // Configuración base: sin workers.dev ni vistas previas y solo en 127.0.0.1.
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
  // Sonda.
  if (spec.role === "probe") {
    // Remota: Workers AI real.
    if (spec.remote) {
      // Binding AI.
      config.ai = { binding: "AI", remote: true };
    }
    // Configuración.
    return config;
  }
  // Índice que no es del curso.
  if (spec.indexName === undefined || !spec.indexName.startsWith(COURSE_VECTORIZE_PREFIX)) {
    // Error.
    throw new Error("El índice del puente no es el del curso.");
  }
  // Remoto sin UUID real de D1.
  if (spec.remote && (spec.databaseId === undefined || spec.databaseId.length < 32)) {
    // Error.
    throw new Error("No hay un uuid real de D1. No se inventa uno.");
  }
  // Variables.
  const vars = config.vars as Record<string, string>;
  // Índice.
  vars.BRIDGE_INDEX_NAME = spec.indexName;
  // Dimensiones.
  if (spec.dimensions !== undefined) vars.EMBEDDING_DIMENSIONS = String(spec.dimensions);
  // Métrica.
  if (spec.metric !== undefined) vars.BRIDGE_VERIFIED_METRIC = spec.metric;
  // Índices de metadatos.
  if (spec.metadataIndexes !== undefined)
    vars.BRIDGE_METADATA_INDEXES = JSON.stringify(spec.metadataIndexes);
  // Base D1.
  const d1: Record<string, unknown> = {
    binding: "DB",
    database_name: COURSE_D1_NAME,
    remote: spec.remote,
  };
  // Con UUID.
  if (spec.databaseId !== undefined) {
    // Lo añade.
    d1.database_id = spec.databaseId;
  }
  // D1.
  config.d1_databases = [d1];
  // R2.
  config.r2_buckets = [{ binding: "CORPUS", bucket_name: COURSE_R2_NAME, remote: spec.remote }];
  // Remoto.
  if (spec.remote) {
    // Vectorize real.
    config.vectorize = [{ binding: "VECTORIZE", index_name: spec.indexName, remote: true }];
    // Workers AI real.
    config.ai = { binding: "AI", remote: true };
  }
  // Verificación.
  if (spec.role === "verify") {
    // Exige modelo, perfil, umbral y clave en remoto.
    if (
      spec.modelId === undefined ||
      spec.evaluatorModelId === undefined ||
      spec.profileId === undefined ||
      spec.corpusVersion === undefined ||
      spec.dimensions === undefined ||
      spec.minScore === undefined ||
      (spec.remote && !spec.apiKey)
    ) {
      // Error.
      throw new Error("La verificación no tiene modelo, perfil o umbral explícitos.");
    }
    // Variables del modo real.
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
  // Configuración.
  return config;
}

// Espera entre intentos (máximo 200 ms).
function backoff(attempt: number): number {
  // Milisegundos.
  return Math.min(200, 40 * attempt);
}

// Arranca el puente y espera a que responda en /bridge/ready.
export async function startLoopbackBridge(
  spec: BridgeSpec,
  deps: {
    // Lanza el proceso.
    spawn: (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => SpawnedBridge;
    // Petición HTTP.
    fetch: (
      url: string,
      init: RequestInit,
    ) => Promise<{ status: number; body?: { ok?: boolean; bind?: string } }>;
    // Plazo.
    timeoutMs: number;
    // Reloj.
    now?: () => number;
    // Espera.
    sleep?: (ms: number) => Promise<void>;
    // Comando.
    command?: string;
    // Intentos máximos.
    maxAttempts?: number;
  },
): Promise<{
  // PID.
  pid: number;
  // Intentos.
  attempts: number;
  // Parada.
  shutdown: () => Promise<void>;
  // Configuración.
  config: Record<string, unknown>;
}> {
  // Solo 127.0.0.1.
  if (!assertLoopbackHost("127.0.0.1")) {
    // Error.
    throw new Error("El puente solo puede escuchar en 127.0.0.1.");
  }
  // Ruta del Worker.
  const main = bridgeMainPath(spec.projectRoot);
  // Debe existir.
  await access(main);
  // Configuración.
  const config = bridgeWranglerConfig(spec);
  // Texto.
  const serialized = JSON.stringify(config);
  // Nunca la ficha, --remote ni 0.0.0.0.
  if (
    serialized.includes(spec.token) ||
    serialized.includes("--remote") ||
    serialized.includes("0.0.0.0")
  ) {
    // Error.
    throw new Error("La configuración del puente no puede publicar ni incluir el testigo.");
  }
  // Carpeta temporal.
  const dir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-bridge-"));
  // Configuración.
  const configPath = path.join(dir, "wrangler.json");
  // .dev.vars.
  const varsPath = path.join(dir, ".dev.vars");
  // Escribe la configuración con permisos 600.
  await writeFile(configPath, serialized, { mode: 0o600 });
  // Clave del proveedor: falsa en local, real solo en verificación remota.
  const extra =
    spec.role === "verify" && !spec.remote
      ? "ANTHROPIC_API_KEY=local-emulated-not-a-provider\n"
      : spec.role === "verify" && spec.remote
        ? `ANTHROPIC_API_KEY=${JSON.stringify(spec.apiKey)}\n`
        : "";
  // Escribe la ficha y la clave en .dev.vars.
  await writeFile(varsPath, `BRIDGE_TOKEN=${spec.token}\n${extra}`, { mode: 0o600 });
  // Permisos 600.
  await chmod(configPath, 0o600);
  // Permisos 600.
  await chmod(varsPath, 0o600);
  // Argumentos de wrangler dev.
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
  // Local.
  if (!spec.remote) {
    // --local.
    args.push("--local");
  }
  // Nunca remoto, túnel ni ficha en los argumentos.
  if (
    args.includes("--remote") ||
    args.includes("--tunnel") ||
    args.join(" ").includes(spec.token)
  ) {
    // Error.
    throw new Error("El arranque del puente no puede publicar ni mostrar el testigo.");
  }
  // Lanza el proceso.
  const child = deps.spawn(deps.command ?? "wrangler", args, {});
  // Inicio.
  const started = deps.now?.() ?? Date.now();
  // Intentos máximos.
  const maxAttempts = deps.maxAttempts ?? 300;
  // Intentos.
  let attempts = 0;
  // ¿Listo?
  let ready = false;
  // Motivo de fallo.
  let terminal: string | null = null;
  // Espera.
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  // Un error interno se registra como motivo.
  try {
    // Reintenta hasta el máximo.
    while (attempts < maxAttempts) {
      // El proceso terminó.
      if (child.hasExited()) {
        // Motivo.
        terminal = "El proceso del puente terminó antes de estar listo.";
        // Sale.
        break;
      }
      // Tiempo transcurrido.
      const elapsed = (deps.now?.() ?? Date.now()) - started;
      // Plazo agotado.
      if (attempts > 0 && elapsed >= deps.timeoutMs) {
        // Sale.
        break;
      }
      // Un intento más.
      attempts += 1;
      // La conexión puede fallar mientras arranca.
      try {
        // GET /bridge/ready con la ficha.
        const response = await deps.fetch(`http://127.0.0.1:${String(spec.port)}/bridge/ready`, {
          headers: { "x-thepower-bridge": spec.token },
        });
        // Listo y escuchando en 127.0.0.1.
        if (
          response.status === 200 &&
          response.body?.ok === true &&
          response.body.bind === "127.0.0.1"
        ) {
          // Listo.
          ready = true;
          // Sale.
          break;
        }
        // Ficha rechazada.
        if (response.status === 404 || (response.status === 200 && response.body?.ok !== true)) {
          // Motivo.
          terminal = "El testigo del puente no fue aceptado.";
          // Sale.
          break;
        }
      } catch {
        // ECONNREFUSED mientras workerd abre el puerto.
      }
      // Si quedan intentos.
      if (attempts < maxAttempts) {
        // Espera.
        await sleep(backoff(attempts));
      }
    }
  } catch (error) {
    // Motivo.
    terminal = error instanceof Error ? error.message : "El puente no pudo arrancar.";
  }
  // Parada: mata el proceso y borra la carpeta.
  const shutdown = async () => {
    // Mata.
    child.kill();
    // Espera.
    await child.waitForExit();
    // Borra.
    await rm(dir, { recursive: true, force: true });
  };
  // No arrancó.
  if (!ready) {
    // Lo para.
    await shutdown();
    // Error.
    throw new Error(
      terminal ?? "El puente local no estuvo listo a tiempo. El proceso se ha detenido.",
    );
  }
  // Puente listo.
  return { pid: child.pid, attempts, config, shutdown };
}

// Ruta del ejecutable de Node (Bun no ejecuta wrangler dev).
function nodeBinary(): string {
  // Ya es Node.
  if (process.execPath.endsWith("/node") || process.execPath.endsWith("\\node.exe")) {
    // Esa ruta.
    return process.execPath;
  }
  // Pregunta a node.
  return execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
}

// Lanzador real de wrangler con Node y el entorno acotado.
export function spawnWranglerBridge(
  wranglerPath: string,
  cwd: string,
  accountId: string,
): (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => SpawnedBridge {
  // Función de lanzamiento.
  return (_command, args) => {
    // Proceso en su propio grupo.
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
    // ¿Terminó?
    let exited = false;
    // Código.
    let exitCode: number | null = null;
    // Promesa de salida.
    const exitPromise = new Promise<number | null>((resolve) => {
      // Al salir.
      child.on("exit", (code) => {
        // Terminó.
        exited = true;
        // Código.
        exitCode = code;
        // Resuelve.
        resolve(code);
      });
      // Error al lanzar.
      child.on("error", () => {
        // Terminó.
        exited = true;
        // Código 1.
        resolve(1);
      });
    });
    // Proceso controlable.
    return {
      pid: child.pid ?? -1,
      hasExited: () => exited,
      kill: () => {
        // PID.
        const pid = child.pid;
        // Sin PID.
        if (pid === undefined) {
          // Nada.
          return;
        }
        // Mata el grupo.
        try {
          // SIGTERM.
          process.kill(-pid, "SIGTERM");
        } catch {
          // Solo al hijo.
          child.kill("SIGTERM");
        }
      },
      waitForExit: async () => {
        // Espera la salida o mata a la fuerza a los 2 s.
        const result = await Promise.race([
          exitPromise,
          new Promise<number | null>((resolve) => {
            // Tras 2 s.
            setTimeout(() => {
              // PID.
              const pid = child.pid;
              // Si existe.
              if (pid !== undefined) {
                // Mata a la fuerza.
                try {
                  // SIGKILL al grupo.
                  process.kill(-pid, "SIGKILL");
                } catch {
                  // SIGKILL al hijo.
                  child.kill("SIGKILL");
                }
              }
              // Resuelve.
              resolve(exitCode);
            }, 2_000);
          }),
        ]);
        // Código.
        return result;
      },
    };
  };
}
