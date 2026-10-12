// GUÍA DE LECTURA · scripts/entrypoint-offline.integration.ts
// Prueba de entrada offline: ejecuta `bun scripts/activate.ts` con emuladores locales y un workerd real,
// sin claves ni red, y recorre sonda, ingesta, reanudación, selección y verificación.
// Lanzar procesos.
import { spawn } from "node:child_process";
// Archivos temporales.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
// Sockets.
import net from "node:net";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Identidad del corpus y tipo.
import { semanticIdentity, type PreparedCorpus } from "@thepower-rag/core";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";
// Arranque del puente.
import { spawnWranglerBridge, startLoopbackBridge } from "./loopback-bridge";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");

// Reserva un puerto libre de 127.0.0.1.
function freePort(): Promise<number> {
  // Promesa con el puerto.
  return new Promise((resolve, reject) => {
    // Servidor temporal.
    const server = net.createServer();
    // Escucha en un puerto cualquiera.
    server.listen(0, "127.0.0.1", () => {
      // Dirección.
      const address = server.address();
      // Sin puerto.
      if (address === null || typeof address === "string") {
        // Error.
        reject(new Error("No se pudo reservar un puerto local."));
        // Sale.
        return;
      }
      // Cierra y devuelve el puerto.
      server.close(() => resolve(address.port));
    });
  });
}

// ¿Hay algo escuchando en el puerto?
function listening(port: number): Promise<boolean> {
  // Promesa.
  return new Promise((resolve) => {
    // Intenta conectar.
    const socket = net.connect({ host: "127.0.0.1", port });
    // Termina con el resultado.
    const finish = (open: boolean) => {
      // Quita oyentes.
      socket.removeAllListeners();
      // Cierra.
      socket.destroy();
      // Resuelve.
      resolve(open);
    };
    // Conectó: abierto.
    socket.once("connect", () => finish(true));
    // Error: cerrado.
    socket.once("error", () => finish(false));
  });
}

// Ejecuta activate.ts con un entorno sin claves.
function runActivate(
  args: readonly string[],
  extra: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  // Entorno con los extras.
  const env = { ...process.env, ...extra };
  // Sin token de Cloudflare.
  delete env.CLOUDFLARE_API_TOKEN;
  // Sin clave de Cloudflare.
  delete env.CLOUDFLARE_API_KEY;
  // Sin clave de Anthropic.
  delete env.ANTHROPIC_API_KEY;
  // Promesa con código y salidas.
  return new Promise((resolve, reject) => {
    // bun scripts/activate.ts.
    const child = spawn("bun", ["scripts/activate.ts", ...args], {
      cwd: root,
      env,
      shell: false,
    });
    // Salida.
    let stdout = "";
    // Errores.
    let stderr = "";
    // Plazo de 90 s.
    const timer = setTimeout(() => {
      // Si hay proceso.
      if (child.pid !== undefined) {
        // Mata su grupo.
        try {
          // SIGTERM.
          process.kill(-child.pid, "SIGTERM");
        } catch {
          // Solo al hijo.
          child.kill("SIGTERM");
        }
      }
      // Error de plazo.
      reject(new Error(`activate superó el tiempo: ${args.join(" ")}`));
    }, 90_000);
    // Texto.
    child.stdout.setEncoding("utf8");
    // Texto.
    child.stderr.setEncoding("utf8");
    // Acumula la salida.
    child.stdout.on("data", (chunk: string) => {
      // Suma.
      stdout += chunk;
    });
    // Acumula los errores.
    child.stderr.on("data", (chunk: string) => {
      // Suma.
      stderr += chunk;
    });
    // Al terminar.
    child.on("close", (code) => {
      // Cancela el plazo.
      clearTimeout(timer);
      // Resultado.
      resolve({ code, stdout, stderr });
    });
  });
}

// Grupo.
describe("entrypoint offline", () => {
  // La simulación no abre el puente.
  it("la simulación no abre el puente", async () => {
    // Puerto.
    const port = await freePort();
    // Inicio.
    const started = Date.now();
    // plan.
    const dry = await runActivate(["plan"], {
      THEPOWER_OFFLINE_ENTRY: "emulated",
      THEPOWER_BRIDGE_PORT: String(port),
    });
    // Correcto.
    expect(dry.code, dry.stderr).toBe(0);
    // Simulación.
    expect(dry.stdout).toContain("simulación");
    // Rápido.
    expect(Date.now() - started).toBeLessThan(8_000);
    // Sonda sin --execute.
    const unread = await runActivate(["probe-embeddings"], {
      THEPOWER_OFFLINE_ENTRY: "emulated",
      THEPOWER_BRIDGE_PORT: String(port),
    });
    // Correcto.
    expect(unread.code, unread.stdout).toBe(0);
    // Simulación.
    expect(unread.stdout).toContain("simulación");
    // Nada escucha.
    expect(await listening(port)).toBe(false);
  });

  // El workerd real exige la ficha y se apaga.
  it("el workerd real exige el testigo y se apaga", async () => {
    // Puerto.
    const port = await freePort();
    // Carpeta temporal.
    const directory = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-entry-"));
    // Ficha.
    const token = "testigo-entrypoint-local-1";
    // Ruta de wrangler.
    const wrangler = path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js");
    // Arranca el puente local.
    const started = await startLoopbackBridge(
      // Cuenta, puertos, ficha y raíz.
      {
        accountId: COURSE_DESTINATION.accountId,
        port,
        inspectorPort: port + 1,
        token,
        projectRoot: root,
        // Papel «probe» en local y estado en la carpeta de la prueba.
        role: "probe",
        remote: false,
        persistDir: path.join(directory, "state"),
      },
      {
        // Plazo de arranque y el Wrangler fijado del proyecto.
        timeoutMs: 60_000,
        command: wrangler,
        spawn: spawnWranglerBridge(wrangler, root, COURSE_DESTINATION.accountId),
        fetch: async (url, init) => {
          // Petición.
          const response = await fetch(url, init);
          // Cuerpo.
          const body = (await response.json().catch(() => null)) as {
            // Listo.
            ok?: boolean;
            // Dirección.
            bind?: string;
          } | null;
          // Estado y cuerpo.
          return { status: response.status, body: body ?? undefined };
        },
      },
    );
    // Necesitó más de un intento.
    expect(started.attempts).toBeGreaterThan(1);
    // Ficha incorrecta.
    const wrong = await fetch(`http://127.0.0.1:${String(port)}/bridge/ready`, {
      headers: { "x-thepower-bridge": "otro-testigo-que-no-sirve" },
    });
    // 404.
    expect(wrong.status).toBe(404);
    // Ficha correcta.
    const right = await fetch(`http://127.0.0.1:${String(port)}/bridge/ready`, {
      headers: { "x-thepower-bridge": token },
    });
    // 200.
    expect(right.status).toBe(200);
    // Lo para.
    await started.shutdown();
    // Ya no escucha.
    expect(await listening(port)).toBe(false);
    // Borra la carpeta.
    await rm(directory, { recursive: true, force: true });
  }, 90_000);

  // Recorrido completo por el CLI.
  it("el CLI recorre sonda, ingesta, reanudación, selección y verificación", async () => {
    // Corpus.
    const corpus = JSON.parse(
      await readFile(path.join(root, "corpus/prepared/corpus.json"), "utf8"),
    ) as PreparedCorpus;
    // Perfil de 32 dimensiones.
    const profileId = semanticIdentity(corpus, 32).id;
    // Puerto.
    const port = await freePort();
    // Carpeta de la autorización.
    const authDir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-auth-"));
    // Archivo.
    const authPath = path.join(authDir, "auth.json");
    // Autorización local de prueba.
    await writeFile(
      authPath,
      `${JSON.stringify(
        {
          accountId: COURSE_DESTINATION.accountId,
          accountName: COURSE_DESTINATION.accountName,
          loginEmail: COURSE_DESTINATION.loginEmail,
          allowCreateD1: true,
          allowCreateR2: false,
          allowCreateVectorize: false,
          allowWorkersAi: true,
          allowOpenRouter: true,
          modelId: "local-emulated-generator",
          maxSpendUsd: 5,
          allowPlanChange: false,
          observedDimensions: 32,
        },
        null,
        2,
      )}\n`,
    );
    // Entorno base.
    const base = {
      THEPOWER_OFFLINE_ENTRY: "emulated",
      THEPOWER_OFFLINE_AUTH: authPath,
      THEPOWER_BRIDGE_PORT: String(port),
    };
    // Carpeta de la sonda.
    const probeDir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-probe-"));
    // Primera sonda.
    const first = await runActivate(["probe-embeddings", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: probeDir,
      THEPOWER_SESSION_LIMITS: "probe",
    });
    // Correcta.
    expect(first.code, `${first.stdout}\n${first.stderr}`).toBe(0);
    // Recibo.
    const receiptPath = path.join(probeDir, "probe-embeddings.json");
    // Texto.
    const receiptText = await readFile(receiptPath, "utf8");
    // Recibo parseado.
    const receipt = JSON.parse(receiptText) as {
      // Procedencia.
      provenance: string;
      // ¿En vivo?
      live: boolean | null;
      // ¿Sirve para el índice remoto?
      usableForRemoteIndex: boolean;
      // Dimensiones.
      dimensions: number;
      // Revisión.
      providerRevision: string | null;
      // Cargo medido.
      measuredChargeUsd: number | null;
    };
    // Emulación local, sin cargo.
    expect(receipt).toMatchObject({
      provenance: "local-native-emulation",
      live: false,
      usableForRemoteIndex: false,
      dimensions: 32,
      providerRevision: null,
      measuredChargeUsd: null,
    });
    // Sin la ficha.
    expect(first.stdout).not.toContain("BRIDGE_TOKEN");
    // Segunda sonda: supera el tope.
    const second = await runActivate(["probe-embeddings", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: probeDir,
      THEPOWER_SESSION_LIMITS: "probe",
    });
    // Código 2.
    expect(second.code, second.stdout).toBe(2);
    // Tope.
    expect(second.stdout).toContain("tope");
    // Recibo intacto.
    expect(await readFile(receiptPath, "utf8")).toBe(receiptText);
    // Nada escucha.
    expect(await listening(port)).toBe(false);

    // Carpeta de la ingesta.
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "thepower-rag-ingest-"));
    // Ingesta.
    const ingested = await runActivate(["ingest", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    // Correcta.
    expect(ingested.code, `${ingested.stdout}\n${ingested.stderr}`).toBe(0);
    // Mensaje.
    expect(ingested.stdout).toContain("ingesta");
    // Reanuda.
    const resumed = await runActivate(["resume", "--execute", `--profile=${profileId}`], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    // Correcta.
    expect(resumed.code, `${resumed.stdout}\n${resumed.stderr}`).toBe(0);
    // Sin lectura administrativa.
    expect(resumed.stdout).not.toContain("lectura administrativa");
    // Selecciona el perfil.
    const selected = await runActivate(["select-active", "--execute", `--profile=${profileId}`], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    // Correcta.
    expect(selected.code, `${selected.stdout}\n${selected.stderr}`).toBe(0);
    // Nombra el perfil.
    expect(selected.stdout).toContain(profileId);
    // Verifica.
    const verified = await runActivate(["verify", "--execute"], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    // Correcta.
    expect(verified.code, `${verified.stdout}\n${verified.stderr}`).toBe(0);
    // Recibo de verificación.
    const verifyBody = JSON.parse(await readFile(path.join(sessionDir, "verify.json"), "utf8")) as {
      // Procedencia.
      provenance: string;
      // ¿En vivo?
      live: boolean | null;
      // Recibo.
      receipt: {
        // Llamadas generativas.
        generativeCalls: number;
        // Error sintético.
        syntheticError: boolean;
        // Turnos.
        turns: { id: string; ok: boolean }[];
      };
    };
    // Emulación local.
    expect(verifyBody.provenance).toBe("local-native-emulation");
    // No en vivo.
    expect(verifyBody.live).toBe(false);
    // Con error sintético.
    expect(verifyBody.receipt.syntheticError).toBe(true);
    // Dentro del tope.
    expect(verifyBody.receipt.generativeCalls).toBeLessThanOrEqual(4);
    // Todos los turnos correctos.
    expect(verifyBody.receipt.turns.every((turn) => turn.ok)).toBe(true);
    // Caché del perfil.
    const cachePath = path.join(sessionDir, "cache", `${profileId}.json`);
    // Caché.
    const cache = JSON.parse(await readFile(cachePath, "utf8")) as { provenance: string };
    // Le cambia la procedencia.
    cache.provenance = "fixture";
    // La guarda.
    await writeFile(cachePath, JSON.stringify(cache));
    // Reanudar con caché ajena.
    const mismatched = await runActivate(["resume", "--execute", `--profile=${profileId}`], {
      ...base,
      THEPOWER_SESSION_DIR: sessionDir,
    });
    // Código 2.
    expect(mismatched.code, mismatched.stdout).toBe(2);
    // Por la procedencia.
    expect(mismatched.stdout).toContain("procedencia");
    // Nada escucha.
    expect(await listening(port)).toBe(false);
    // Borra la autorización.
    await rm(authDir, { recursive: true, force: true });
    // Borra la sonda.
    await rm(probeDir, { recursive: true, force: true });
    // Borra la sesión.
    await rm(sessionDir, { recursive: true, force: true });
  }, 180_000);
});
