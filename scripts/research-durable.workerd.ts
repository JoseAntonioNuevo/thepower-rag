// GUÍA DE LECTURA · scripts/research-durable.workerd.ts
// Prueba de entrada de la investigación durable en workerd real con D1, Workflow y R2 locales: el trabajo
// termina aunque la petición se cierre, las operaciones ambiguas no se reenvían, una caída se recupera y
// todo sigue ahí tras reiniciar el proceso con la misma persistencia.
// Lanzar procesos.
import { spawn, type ChildProcess } from "node:child_process";
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Archivos temporales.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
// Sockets.
import net from "node:net";
// Sistema operativo.
import os from "node:os";
// Rutas.
import path from "node:path";
// Pregunta de demo y esquema del resumen.
import { DEMO_RESEARCH_QUESTION, researchSummarySchema } from "@thepower-rag/contracts";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");

// Reserva un puerto libre de 127.0.0.1.
function freePort(): Promise<number> {
  // Promesa.
  return new Promise((resolve, reject) => {
    // Servidor temporal.
    const server = net.createServer();
    // Puerto cualquiera.
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
      // Puerto.
      const port = address.port;
      // Cierra y lo devuelve.
      server.close(() => resolve(port));
    });
  });
}

// Para un proceso y su grupo.
function stop(child: ChildProcess): void {
  // Ya terminado.
  if (child.pid === undefined || child.exitCode !== null) {
    // Nada.
    return;
  }
  // Al grupo.
  try {
    // SIGTERM.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // Al hijo.
    child.kill("SIGTERM");
  }
}

// Espera a que termine un proceso.
async function waitExit(child: ChildProcess): Promise<void> {
  // Ya terminó.
  if (child.exitCode !== null) {
    // Nada.
    return;
  }
  // Espera el evento exit.
  await new Promise((resolve) => {
    // Resuelve.
    child.once("exit", () => resolve(undefined));
  });
}

// Cabeceras de una mutación: JSON, cookie y origen.
function mutateHeaders(base: string, cookie: string): Record<string, string> {
  // Cabeceras.
  return {
    "content-type": "application/json",
    cookie,
    origin: new URL(base).origin,
  };
}

// Cookies de una respuesta como cabecera cookie.
function cookieFrom(response: Response): string {
  // Cabeceras con getSetCookie.
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  // Varias cookies.
  const pieces = headers.getSetCookie?.() ?? [];
  // Una sola.
  const single = response.headers.get("set-cookie");
  // Todas.
  const all = pieces.length > 0 ? pieces : single ? [single] : [];
  // nombre=valor unidos por ;.
  return all
    .map((item) => item.split(";")[0] ?? "")
    .filter((item) => item.length > 0)
    .join("; ");
}

// Arranca wrangler dev con el Worker de investigación y sus bindings locales.
async function boot(
  persist: string,
  port: number,
  inspector: number,
): Promise<{ child: ChildProcess; logs: () => string }> {
  // Configuración.
  const configPath = path.join(persist, `wrangler-${String(port)}.json`);
  // Worker, variables, D1, Workflow y R2 locales.
  await writeFile(
    configPath,
    JSON.stringify({
      // Nombre, fecha de compatibilidad, flags y punto de entrada con el Workflow.
      name: "thepower-research-durable",
      compatibility_date: "2026-10-02",
      compatibility_flags: ["nodejs_compat"],
      main: path.join(root, "apps/api/src/research-worker.ts"),
      // Mismas variables que el perfil research de wrangler.jsonc.
      vars: {
        APP_MODE: "demo",
        RESEARCH_OWNER_SECRET: "local-loopback-research-owner",
        RESEARCH_BUDGET_USD: "1.000000",
        RESEARCH_JOB_LIMIT_USD: "0.250000",
        RESEARCH_INPUT_USD_PER_MILLION: "0.100000",
        RESEARCH_OUTPUT_USD_PER_MILLION: "0.500000",
        RESEARCH_SEARCH_USD: "0.002000",
        RESEARCH_READ_USD: "0.005000",
      },
      // D1 local con las migraciones de la investigación.
      d1_databases: [
        {
          binding: "RESEARCH_DB",
          database_name: "thepower-research-local",
          database_id: "11111111-1111-4111-8111-111111111111",
          migrations_dir: path.join(root, "apps/api/migrations-research"),
        },
      ],
      // Workflow local que ejecuta cada trabajo.
      workflows: [
        {
          name: "thepower-research-job",
          binding: "RESEARCH_WORKFLOW",
          class_name: "ResearchJobWorkflow",
        },
      ],
      // R2 local para los medios.
      r2_buckets: [
        {
          binding: "RESEARCH_MEDIA",
          bucket_name: "thepower-research-media-local",
        },
      ],
    }),
  );
  // Ruta de wrangler.
  const wrangler = path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js");
  // Entorno sin métricas.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CI: "1",
    BROWSER: "none",
    WRANGLER_SEND_METRICS: "false",
  };
  // Sin token de Cloudflare.
  delete env.CLOUDFLARE_API_TOKEN;
  // Sin clave de Cloudflare.
  delete env.CLOUDFLARE_API_KEY;
  // Sin clave de Anthropic.
  delete env.ANTHROPIC_API_KEY;
  // Sin clave de Firecrawl.
  delete env.FIRECRAWL_API_KEY;
  // Sin entorno de wrangler.
  delete env.CLOUDFLARE_ENV;
  // wrangler dev local con persistencia.
  const child = spawn(
    process.execPath,
    [
      // wrangler dev con la configuración temporal.
      wrangler,
      "dev",
      "--config",
      configPath,
      // Solo en 127.0.0.1, con su puerto y su inspector propios.
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--inspector-port",
      String(inspector),
      "--inspector-ip",
      "127.0.0.1",
      // Todo local y con persistencia en la carpeta de la prueba.
      "--local",
      "--persist-to",
      persist,
      // HTTP plano, sin sesión interactiva y solo errores en el registro.
      "--local-protocol",
      "http",
      "--no-show-interactive-dev-session",
      "--log-level",
      "error",
    ],
    // Proceso separado (detached) para poder matar su grupo al terminar.
    { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  // Registros.
  let logs = "";
  // Texto.
  child.stdout?.setEncoding("utf8");
  // Texto.
  child.stderr?.setEncoding("utf8");
  // Acumula la salida.
  child.stdout?.on("data", (chunk: string) => {
    // Suma.
    logs += chunk;
  });
  // Acumula los errores.
  child.stderr?.on("data", (chunk: string) => {
    // Suma.
    logs += chunk;
  });
  // Proceso y registros.
  return {
    child,
    // Devuelve los mensajes capturados para explicar un fallo del Worker local.
    logs: () => logs,
  };
}

// Espera a que /api/health diga demo con investigación durable.
async function ready(base: string, child: ChildProcess, logs: () => string): Promise<void> {
  // Hasta 80 intentos.
  for (let attempt = 0; attempt < 80; attempt += 1) {
    // Terminó.
    if (child.exitCode !== null) {
      // Error.
      throw new Error(`workerd terminó.\n${logs().slice(-2_000)}`);
    }
    // Puede no escuchar todavía.
    try {
      // Salud.
      const response = await fetch(`${base}/api/health`);
      // Responde.
      if (response.status === 200) {
        // Cuerpo.
        const body = (await response.json()) as { durableResearch?: boolean; execution?: string };
        // Listo.
        if (body.durableResearch === true && body.execution === "demo") {
          // Sale.
          return;
        }
      }
    } catch {
      // todavía no escucha
    }
    // Espera 250 ms.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // No estuvo listo.
  throw new Error(`workerd no estuvo listo.\n${logs().slice(-2_000)}`);
}

// Grupo.
describe("investigación durable en workerd", () => {
  // Completa, no repite lo ambiguo, recupera la caída y sobrevive a un reinicio.
  it("completa el trabajo tras cerrar la petición y lo recupera con la misma persistencia", async () => {
    // Carpeta de persistencia.
    const persist = await mkdtemp(path.join(os.tmpdir(), "thepower-research-persist-"));
    // Puerto.
    const port = await freePort();
    // Inspector.
    const inspector = await freePort();
    // Primer proceso.
    const first = await boot(persist, port, inspector);
    // Origen.
    const base = `http://127.0.0.1:${String(port)}`;
    // try/finally: para el proceso y borra la carpeta.
    try {
      // Espera a que esté listo.
      await ready(base, first.child, first.logs);
      // Sesión.
      const session = await fetch(`${base}/api/research/session`);
      // 200.
      expect(session.status).toBe(200);
      // Cookie.
      const cookie = cookieFrom(session);
      // Cookie del propietario.
      expect(cookie).toContain("thepower-research-owner");
      // Conversación.
      const created = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "M/J" }),
      });
      // Fallo.
      if (created.status !== 201) {
        // Error con registros.
        throw new Error(
          `${String(created.status)} ${await created.text()}\n${first.logs().slice(-3_000)}`,
        );
      }
      // Id.
      const conversation = (await created.json()) as { id: string };
      // Trabajo.
      const submitted = await fetch(`${base}/api/research/conversations/${conversation.id}/jobs`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({
          idempotencyKey: "idem-workerd-1",
          question: DEMO_RESEARCH_QUESTION,
          scenarioId: "sufficient-first-round",
        }),
      });
      // 202.
      expect(submitted.status).toBe(202);
      // Trabajo.
      const job = (await submitted.json()) as { jobId: string };
      // Estado.
      let execution = "queued";
      // Sondea hasta completar.
      for (let attempt = 0; attempt < 80 && execution !== "complete"; attempt += 1) {
        // Estado.
        const status = await fetch(`${base}/api/research/jobs/${job.jobId}`, {
          headers: { cookie },
        });
        // Cuerpo.
        const body = (await status.json()) as {
          // Ejecución.
          execution: string;
          // Atención.
          attention: string | null;
          // Progreso.
          progress: string | null;
          // Workflow.
          dispatch: string;
        };
        // Ejecución.
        execution = body.execution;
        // Final inesperado.
        if (execution === "attention" || execution === "failed" || execution === "cancelled") {
          // Error.
          throw new Error(`${JSON.stringify(body)}\n${first.logs().slice(-2_000)}`);
        }
        // Espera.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Completo.
      expect(execution).toBe("complete");
      // Resultado.
      const result = await fetch(`${base}/api/research/jobs/${job.jobId}/result`, {
        headers: { cookie },
      });
      // 200.
      expect(result.status).toBe(200);
      // Cuerpo.
      const payload = (await result.json()) as {
        // Resumen.
        summary: unknown;
        // Informe.
        report: { text: string } | null;
        // Disponibilidad.
        reportAvailability: string;
      };
      // Validado.
      const summary = researchSummarySchema.parse(payload.summary);
      // Completo.
      expect(summary.outcome).toBe("complete");
      // De prueba.
      expect(summary.fixture).toBe(true);
      // Guardado.
      expect(payload.reportAvailability).toBe("stored");
      // Informe de prueba.
      expect(payload.report?.text).toContain("Informe de prueba");
      // Otra conversación.
      const ambiguous = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "L/X" }),
      });
      // Id.
      const other = (await ambiguous.json()) as { id: string };
      // Trabajo con operación ambigua.
      const ambiguousJob = await fetch(`${base}/api/research/conversations/${other.id}/jobs`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({
          idempotencyKey: "idem-workerd-2",
          question: DEMO_RESEARCH_QUESTION,
          scenarioId: "ambiguous-operation",
        }),
      });
      // 202.
      expect(ambiguousJob.status).toBe(202);
      // Trabajo.
      const ambiguousBody = (await ambiguousJob.json()) as { jobId: string };
      // Estado.
      let ambiguousExecution = "queued";
      // Sondea hasta salir de cola o ejecución.
      for (
        let attempt = 0;
        attempt < 80 && (ambiguousExecution === "queued" || ambiguousExecution === "running");
        attempt += 1
      ) {
        // Estado.
        const status = await fetch(`${base}/api/research/jobs/${ambiguousBody.jobId}`, {
          headers: { cookie },
        });
        // Ejecución.
        ambiguousExecution = ((await status.json()) as { execution: string }).execution;
        // Espera.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Atención.
      expect(ambiguousExecution).toBe("attention");
      // Recuperar.
      const recover = await fetch(`${base}/api/research/jobs/${ambiguousBody.jobId}/recover`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
      });
      // 409: no se reenvía.
      expect(recover.status).toBe(409);
      // Conversación para la caída.
      const crashCreated = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "program" }),
      });
      // Id.
      const crashConversation = (await crashCreated.json()) as { id: string };
      // Trabajo con caída tras el plan.
      const crashSubmitted = await fetch(
        `${base}/api/research/conversations/${crashConversation.id}/jobs`,
        {
          method: "POST",
          headers: mutateHeaders(base, cookie),
          body: JSON.stringify({
            idempotencyKey: "idem-workerd-crash",
            question: DEMO_RESEARCH_QUESTION,
            scenarioId: "crash-after-plan",
          }),
        },
      );
      // 202.
      expect(crashSubmitted.status).toBe(202);
      // Trabajo.
      const crashJob = (await crashSubmitted.json()) as { jobId: string; runId: string };
      // Estado.
      let crashExecution = "queued";
      // Motivo.
      let crashAttention: string | null = null;
      // Sondea.
      for (
        let attempt = 0;
        attempt < 80 && (crashExecution === "queued" || crashExecution === "running");
        attempt += 1
      ) {
        // Estado.
        const status = await fetch(`${base}/api/research/jobs/${crashJob.jobId}`, {
          headers: { cookie },
        });
        // Cuerpo.
        const body = (await status.json()) as { execution: string; attention: string | null };
        // Ejecución.
        crashExecution = body.execution;
        // Motivo.
        crashAttention = body.attention;
        // Espera.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Atención.
      expect(crashExecution).toBe("attention");
      // Recuperable.
      expect(crashAttention).toBe("recoverable");
      // Para el primer proceso.
      stop(first.child);
      // Espera.
      await waitExit(first.child);
      // Nuevo puerto.
      const port2 = await freePort();
      // Nuevo inspector.
      const inspector2 = await freePort();
      // Segundo proceso con la misma persistencia.
      const second = await boot(persist, port2, inspector2);
      // Origen.
      const base2 = `http://127.0.0.1:${String(port2)}`;
      // try/finally: para el segundo proceso.
      try {
        // Espera.
        await ready(base2, second.child, second.logs);
        // Resultado guardado.
        const again = await fetch(`${base2}/api/research/jobs/${job.jobId}/result`, {
          headers: { cookie },
        });
        // 200.
        expect(again.status).toBe(200);
        // Cuerpo.
        const againPayload = (await again.json()) as {
          // Resumen.
          summary: unknown;
          // Informe.
          report: { text: string } | null;
        };
        // Validado.
        const restored = researchSummarySchema.parse(againPayload.summary);
        // Misma ejecución.
        expect(restored.runId).toBe(summary.runId);
        // Informe de prueba.
        expect(againPayload.report?.text).toContain("Informe de prueba");
        // Repite el envío original.
        const sameRequest = await fetch(
          `${base2}/api/research/conversations/${conversation.id}/jobs`,
          {
            method: "POST",
            headers: mutateHeaders(base2, cookie),
            body: JSON.stringify({
              idempotencyKey: "idem-workerd-1",
              question: DEMO_RESEARCH_QUESTION,
              scenarioId: "sufficient-first-round",
            }),
          },
        );
        // 202.
        expect(sameRequest.status).toBe(202);
        // Mismo trabajo.
        expect(((await sameRequest.json()) as { jobId: string }).jobId).toBe(job.jobId);
        // Conversación.
        const messages = await fetch(`${base2}/api/research/conversations/${conversation.id}`, {
          headers: { cookie },
        });
        // 200.
        expect(messages.status).toBe(200);
        // Recuperar el ambiguo sigue dando 409.
        const still = await fetch(`${base2}/api/research/jobs/${ambiguousBody.jobId}/recover`, {
          method: "POST",
          headers: mutateHeaders(base2, cookie),
        });
        // 409.
        expect(still.status).toBe(409);
        // Recupera la caída.
        const crashRecover = await fetch(`${base2}/api/research/jobs/${crashJob.jobId}/recover`, {
          method: "POST",
          headers: mutateHeaders(base2, cookie),
        });
        // No aceptada.
        if (crashRecover.status !== 202) {
          // Error.
          throw new Error(`${String(crashRecover.status)} ${await crashRecover.text()}`);
        }
        // Estado.
        let recovered = "running";
        // Sondea hasta terminar.
        for (
          let attempt = 0;
          attempt < 80 && (recovered === "queued" || recovered === "running");
          attempt += 1
        ) {
          // Estado.
          const status = await fetch(`${base2}/api/research/jobs/${crashJob.jobId}`, {
            headers: { cookie },
          });
          // Cuerpo.
          const body = (await status.json()) as {
            // Ejecución.
            execution: string;
            // Recorrido.
            runId: string;
            // Operaciones.
            operations: { kind: string; state: string }[];
            // Atención.
            attention: string | null;
          };
          // Ejecución.
          recovered = body.execution;
          // Completo.
          if (recovered === "complete") {
            // Mismo recorrido.
            expect(body.runId).toBe(crashJob.runId);
            // Un solo plan.
            expect(body.operations.filter((operation) => operation.kind === "plan")).toEqual([
              { kind: "plan", state: "completed" },
            ]);
          }
          // Final inesperado.
          if (recovered === "attention" || recovered === "failed" || recovered === "cancelled") {
            // Error.
            throw new Error(`${JSON.stringify(body)}\n${second.logs().slice(-2_000)}`);
          }
          // Espera.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        // Completo.
        expect(recovered).toBe("complete");
        // Resultado.
        const crashResult = await fetch(`${base2}/api/research/jobs/${crashJob.jobId}/result`, {
          headers: { cookie },
        });
        // Cuerpo.
        const crashPayload = (await crashResult.json()) as { report: { text: string } };
        // Informe de prueba.
        expect(crashPayload.report.text).toContain("Informe de prueba");
      } finally {
        // Para.
        stop(second.child);
        // Espera.
        await waitExit(second.child);
      }
    } finally {
      // Para.
      stop(first.child);
      // Borra la carpeta.
      await rm(persist, { recursive: true, force: true });
    }
  }, 180_000);

  // Imagen, audio y voz terminan y se conservan tras reiniciar.
  it("termina un trabajo con imagen, audio y voz y lo conserva al reiniciar", async () => {
    // Carpeta.
    const persist = await mkdtemp(path.join(os.tmpdir(), "thepower-research-media-"));
    // Puerto.
    const port = await freePort();
    // Inspector.
    const inspector = await freePort();
    // Primer proceso.
    const first = await boot(persist, port, inspector);
    // Origen.
    const base = `http://127.0.0.1:${String(port)}`;
    // Imagen del aula.
    const image = readFileSync(path.join(root, "apps/api/fixtures/media/dimension-mismatch.png"));
    // Audio del aula.
    const audio = readFileSync(path.join(root, "apps/api/fixtures/media/embedding-request.wav"));
    // try/finally.
    try {
      // Espera.
      await ready(base, first.child, first.logs);
      // Sesión.
      const session = await fetch(`${base}/api/research/session`);
      // Cookie.
      const cookie = cookieFrom(session);
      // Conversación.
      const created = await fetch(`${base}/api/research/conversations`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({ audience: "M/J" }),
      });
      // 201.
      expect(created.status).toBe(201);
      // Id.
      const conversation = (await created.json()) as { id: string };
      // Sube un archivo.
      const upload = async (bytes: Buffer, key: string) => {
        // POST de los bytes.
        const response = await fetch(
          `${base}/api/research/conversations/${conversation.id}/media`,
          {
            method: "POST",
            headers: {
              ...mutateHeaders(base, cookie),
              "content-type": "application/octet-stream",
              "x-idempotency-key": key,
            },
            body: bytes,
          },
        );
        // 201.
        expect(response.status).toBe(201);
        // Id.
        return (await response.json()) as { id: string };
      };
      // Imagen.
      const imageAsset = await upload(image, "idem-workerd-image");
      // Audio.
      const audioAsset = await upload(audio, "idem-workerd-audio");
      // Trabajo con imagen, audio y voz.
      const submitted = await fetch(`${base}/api/research/conversations/${conversation.id}/jobs`, {
        method: "POST",
        headers: mutateHeaders(base, cookie),
        body: JSON.stringify({
          idempotencyKey: "idem-workerd-media",
          question: "",
          voice: true,
          imageAssetId: imageAsset.id,
          audioAssetId: audioAsset.id,
        }),
      });
      // 202.
      expect(submitted.status).toBe(202);
      // Trabajo.
      const job = (await submitted.json()) as { jobId: string };
      // Estado.
      let execution = "queued";
      // Sondea.
      for (let attempt = 0; attempt < 80 && execution !== "complete"; attempt += 1) {
        // Estado.
        const status = await fetch(`${base}/api/research/jobs/${job.jobId}`, {
          headers: { cookie },
        });
        // Cuerpo.
        const body = (await status.json()) as { execution: string; attention: string | null };
        // Ejecución.
        execution = body.execution;
        // Fallo.
        if (execution === "attention" || execution === "failed") {
          // Error.
          throw new Error(`${JSON.stringify(body)}\n${first.logs().slice(-2_000)}`);
        }
        // Espera.
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      // Completo.
      expect(execution).toBe("complete");
      // Resultado.
      const result = await fetch(`${base}/api/research/jobs/${job.jobId}/result`, {
        headers: { cookie },
      });
      // Cuerpo.
      const payload = (await result.json()) as {
        // Resumen.
        summary: unknown;
        // Fuentes.
        sources: { sourceId: string; kind: string }[];
        // Informe.
        report: { text: string } | null;
      };
      // Validado.
      const summary = researchSummarySchema.parse(payload.summary);
      // Completo.
      expect(summary.outcome).toBe("complete");
      // Con lecturas.
      expect(summary.pagesRead.length).toBeGreaterThan(0);
      // Con evidencia.
      expect(summary.accepted.length).toBeGreaterThan(0);
      // Texto de la imagen.
      expect(summary.media?.image?.observedText).toContain("expected 1024, got 768");
      // Transcripción.
      expect(summary.media?.audio?.transcript).toContain("He cambiado el modelo de embeddings");
      // Voz lista.
      expect(summary.media?.speech?.status).toBe("ready");
      // Avisa de que es de prueba.
      expect(summary.media?.speech?.detail ?? "").toContain("no es");
      // Informe.
      expect(payload.report?.text).toContain("Informe de prueba");
      // No todo son adjuntos.
      expect(payload.sources.some((source) => source.kind !== "attachment")).toBe(true);
      // URL del audio de la voz.
      const speechUrl = `${base}/api/research/media/${summary.media?.speech?.assetId ?? ""}`;
      // Lo pide.
      const speech = await fetch(speechUrl, { headers: { cookie } });
      // 200.
      expect(speech.status).toBe(200);
      // Bytes.
      const speechBytes = new Uint8Array(await speech.arrayBuffer());
      // Empieza por RIFF.
      expect(
        String.fromCharCode(
          speechBytes[0] ?? 0,
          speechBytes[1] ?? 0,
          speechBytes[2] ?? 0,
          speechBytes[3] ?? 0,
        ),
      ).toBe("RIFF");
      // Para.
      stop(first.child);
      // Espera.
      await waitExit(first.child);
      // Nuevo puerto.
      const port2 = await freePort();
      // Segundo proceso.
      const second = await boot(persist, port2, await freePort());
      // Origen.
      const restarted = `http://127.0.0.1:${String(port2)}`;
      // try/finally.
      try {
        // Espera.
        await ready(restarted, second.child, second.logs);
        // Resultado.
        const again = await fetch(`${restarted}/api/research/jobs/${job.jobId}/result`, {
          headers: { cookie },
        });
        // 200.
        expect(again.status).toBe(200);
        // Audio de la voz.
        const againSpeech = await fetch(speechUrl.replace(base, restarted), {
          headers: { cookie },
        });
        // Mismos bytes.
        expect(new Uint8Array(await againSpeech.arrayBuffer())).toEqual(speechBytes);
        // Conversación.
        const messages = await fetch(`${restarted}/api/research/conversations/${conversation.id}`, {
          headers: { cookie },
        });
        // 200.
        expect(messages.status).toBe(200);
        // Mensajes.
        const history = (await messages.json()) as { messages?: { text: string }[] };
        // Texto recordado.
        const remembered = (history.messages ?? []).map((message) => message.text).join("\n");
        // Con la imagen.
        expect(remembered).toContain("1024");
        // Con el audio.
        expect(remembered).toContain("He cambiado el modelo de embeddings");
      } finally {
        // Para.
        stop(second.child);
        // Espera.
        await waitExit(second.child);
      }
    } finally {
      // Para.
      stop(first.child);
      // Borra.
      await rm(persist, { recursive: true, force: true });
    }
  }, 180_000);
});
