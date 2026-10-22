// GUÍA DE LECTURA · apps/api/src/research-phase2-http.test.ts
// Pruebas HTTP de la investigación durable con SQLite y un Workflow simulado: origen, idempotencia,
// reservas, recuperación tras una caída y protección pública (Turnstile, límites y sesión caducada).
// Pregunta de demo y token de autorización de gasto.
import { DEMO_RESEARCH_QUESTION, RESEARCH_SPEND_TOKEN } from "@thepower-rag/contracts";
// Funciones de prueba.
import { afterEach, describe, expect, it } from "vite-plus/test";
// Tipo de las variables del Worker.
import type { WorkerEnv } from "./env";
// Crea las tablas de la investigación.
import { ensureResearchSchema } from "./research-db";
// Un paso del trabajo.
import { runResearchTick } from "./research-runner";
// D1 simulada con SQLite en memoria.
import { openResearchSqlite } from "./research-sqlite";
// Operaciones del almacén usadas para preparar casos.
import {
  beginOperation,
  claimJob,
  listOperations,
  markDispatched,
  readAccount,
} from "./research-store";
// Worker completo que se prueba.
import worker from "./worker";

// fetch original.
const originalFetch = globalThis.fetch;
// Contexto de ejecución vacío.
const context = {} as ExecutionContext;
// Origen local de la demo.
const demoOrigin = "http://127.0.0.1:5191";
// Origen público.
const publicOrigin = "https://rag-thepower.josenuevo.dev";
// IP de prueba.
const ip = "198.51.100.20";
// Secreto de Turnstile sintético.
const turnstileSecret = "synthetic-secret-for-unit-tests-only";

// Cookie de una respuesta (solo nombre=valor).
function cookieFrom(response: Response): string {
  // Cabecera set-cookie.
  const header = response.headers.get("set-cookie") ?? "";
  // Primera parte.
  return header.split(";")[0] ?? "";
}

// Resultado de un COUNT(*).
async function total(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  sql: string,
): Promise<number> {
  // Primera fila.
  const row = await database.prepare(sql).first<{ total: number }>();
  // Total o 0.
  return row?.total ?? 0;
}

// Workflow simulado que registra creaciones y reinicios.
function workflowMock(status = "complete") {
  // Ids creados.
  const creates: string[] = [];
  // Ids reiniciados.
  const restarts: string[] = [];
  // Estado que devuelve status().
  let activity = status;
  // API mínima del Workflow.
  const workflow = {
    // Doble de prueba: crea o representa una instancia del Workflow de investigación.
    async create(options: { id: string }) {
      // Registra.
      creates.push(options.id);
      // Instancia.
      return { id: options.id };
    },
    // Doble de prueba: obtiene el recurso solicitado mediante el adaptador de almacenamiento o Workflow.
    async get(id: string) {
      // Instancia con status, terminate y restart.
      return {
        // Doble de prueba: entrega el estado observable de la instancia del Workflow.
        async status() {
          // Estado actual.
          return { status: activity };
        },
        // Doble de prueba: representa la terminación de la instancia de Workflow solicitada por el consumidor.
        async terminate() {
          // Nada.
          return undefined;
        },
        // Doble de prueba: representa el reinicio de la instancia de Workflow solicitado por el consumidor.
        async restart() {
          // Registra.
          restarts.push(id);
        },
      };
    },
  };
  // Workflow, registros y cambio de estado.
  return {
    workflow,
    creates,
    restarts,
    // Doble de prueba: registra la actividad que permitirá comprobar el estado de la instancia simulada.
    setActivity(next: string) {
      // Cambia el estado.
      activity = next;
    },
  };
}

// Entorno de demo con investigación durable.
function demoEnv(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  workflow: WorkerEnv["RESEARCH_WORKFLOW"],
): WorkerEnv {
  // Variables de demo y tarifas.
  return {
    // Demo: secreto local del propietario y bindings de la prueba.
    APP_MODE: "demo",
    RESEARCH_OWNER_SECRET: "local-loopback-research-owner",
    RESEARCH_DB: database,
    RESEARCH_WORKFLOW: workflow,
    // Presupuesto, tope por trabajo y tarifas del perfil de investigación.
    RESEARCH_BUDGET_USD: "1.000000",
    RESEARCH_JOB_LIMIT_USD: "0.250000",
    RESEARCH_INPUT_USD_PER_MILLION: "0.100000",
    RESEARCH_OUTPUT_USD_PER_MILLION: "0.500000",
    RESEARCH_SEARCH_USD: "0.002000",
    RESEARCH_READ_USD: "0.005000",
  };
}

// Entorno real con protección pública y claves de prueba.
function realEnv(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  workflow: WorkerEnv["RESEARCH_WORKFLOW"],
): WorkerEnv {
  // Demo más variables reales.
  return {
    // Parte de la demo y la convierte en real.
    ...demoEnv(database, workflow),
    APP_MODE: "real",
    // Protección pública: origen, presupuesto, Turnstile y limitadores que siempre aceptan.
    PUBLIC_ORIGIN: publicOrigin,
    PUBLIC_BUDGET_USD: "1",
    TURNSTILE_SITE_KEY: "synthetic-site-key",
    TURNSTILE_SECRET_KEY: turnstileSecret,
    CHAT_IP_LIMITER: {
      // Doble de prueba: resuelve el control de cupo inyectado antes de permitir que avance la petición.
      limit: async () => ({ success: true }),
    },
    CHAT_SESSION_LIMITER: {
      // Doble de prueba: resuelve el control de cupo inyectado antes de permitir que avance la petición.
      limit: async () => ({ success: true }),
    },
    // Generación con clave de prueba.
    ANTHROPIC_API_KEY: "local-test-key",
    MODEL_ID: "example/generator",
    // RAG real configurado con bindings vacíos.
    EMBEDDING_MODEL: "example/embed",
    EMBEDDING_DIMENSIONS: "1024",
    CORPUS_VERSION: "test-corpus",
    INDEX_PROFILE: "test-profile",
    VECTOR_METRIC: "cosine",
    MIN_RETRIEVAL_SCORE: "0.5",
    AI: {},
    VECTORIZE: {},
    DB: {},
    CORPUS: {},
    // Investigación real: modelo, buscador, autorización y precio del crédito.
    RESEARCH_MODEL_ID: "example/research",
    FIRECRAWL_API_KEY: "local-firecrawl",
    RESEARCH_SPEND_AUTHORIZATION: RESEARCH_SPEND_TOKEN,
    FIRECRAWL_USD_PER_CREDIT: "0.010000",
  };
}

// Envía una petición al Worker.
async function send(env: WorkerEnv, url: string, init: RequestInit = {}): Promise<Response> {
  // worker.fetch con el entorno.
  return worker.fetch(new Request(url, init), env, context);
}

// Tras cada prueba restaura fetch.
afterEach(() => {
  // Original.
  globalThis.fetch = originalFetch;
});

// Grupo: HTTP durable.
describe("HTTP durable de investigación", () => {
  // Origen, idempotencia, reserva y resultado.
  it("en loopback rechaza otro origen y repite la misma petición", async () => {
    // Base de datos.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Workflow.
    const { workflow, creates } = workflowMock();
    // Entorno.
    const env = demoEnv(database, workflow);
    // Sesión.
    const session = await send(env, `${demoOrigin}/api/research/session`);
    // 200.
    expect(session.status).toBe(200);
    // Cookie.
    const cookie = cookieFrom(session);
    // Origen ajeno.
    const foreign = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://other.example",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 403.
    expect(foreign.status).toBe(403);
    // Sin conversaciones.
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_conversations")).toBe(0);
    // Sin trabajos.
    expect(creates).toEqual([]);

    // Crea la conversación.
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 201.
    expect(created.status).toBe(201);
    // Id.
    const conversation = (await created.json()) as { id: string };
    // Petición de trabajo.
    const body = {
      idempotencyKey: "idem-http-1",
      question: DEMO_RESEARCH_QUESTION,
      scenarioId: "sufficient-first-round",
    };
    // Envía.
    const submitted = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    // 202.
    expect(submitted.status).toBe(202);
    // Respuesta.
    const first = (await submitted.json()) as { jobId: string; runId: string; created: boolean };
    // Repite con espacios extra.
    const again = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({ ...body, question: `  ${DEMO_RESEARCH_QUESTION}  ` }),
      },
    );
    // 202.
    expect(again.status).toBe(202);
    // Respuesta.
    const second = (await again.json()) as { jobId: string; created: boolean };
    // Mismo trabajo.
    expect(second.jobId).toBe(first.jobId);
    // No se creó otro.
    expect(second.created).toBe(false);
    // Un solo Workflow.
    expect(new Set(creates)).toEqual(new Set([first.jobId]));
    // Cuenta de gasto.
    const account = await readAccount(database);
    // Reserva del trabajo.
    const reserved = await database
      .prepare(`SELECT reserved_micros FROM research_jobs WHERE id = ?`)
      .bind(first.jobId)
      .first<{ reserved_micros: number }>();
    // La cuenta reserva lo mismo.
    expect(account?.reserved_micros).toBe(reserved?.reserved_micros);

    // Misma clave con otra pregunta.
    const different = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({ ...body, question: "Otra pregunta distinta" }),
      },
    );
    // Conflicto.
    expect(different.status).toBe(409);
    // Un solo trabajo.
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_jobs")).toBe(1);

    // Ejecuta el paso.
    const tick = await runResearchTick(database, first.jobId, await ownerOf(database, first.jobId));
    // Completo.
    expect(tick.status).toBe("complete");
    // Repite tras completar.
    const completed = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    // Mismo trabajo.
    expect(((await completed.json()) as { jobId: string }).jobId).toBe(first.jobId);

    // Pregunta de seguimiento con otra clave.
    const follow = await send(
      // Envío a la misma conversación.
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        // POST con cookie y origen de la demo.
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({
          // Clave nueva y pregunta que depende de la anterior («ese índice»).
          idempotencyKey: "idem-http-2",
          question: "¿y ese índice?",
          scenarioId: "sufficient-first-round",
        }),
      },
    );
    // 202.
    expect(follow.status).toBe(202);
    // Id.
    const followId = ((await follow.json()) as { jobId: string }).jobId;
    // Trabajo nuevo.
    expect(followId).not.toBe(first.jobId);
    // Repite la original.
    const original = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    // Mismo trabajo.
    expect(((await original.json()) as { jobId: string }).jobId).toBe(first.jobId);

    // Otra repetición.
    const restarted = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    // Mismo trabajo.
    expect(((await restarted.json()) as { jobId: string }).jobId).toBe(first.jobId);

    // Resultado.
    const result = await send(env, `${demoOrigin}/api/research/jobs/${first.jobId}/result`, {
      headers: { cookie },
    });
    // 200.
    expect(result.status).toBe(200);
    // Cuerpo.
    const payload = (await result.json()) as {
      // Resumen.
      summary: { outcome: string };
      // Informe.
      report: { text: string } | null;
      // Disponibilidad.
      reportAvailability: string;
    };
    // Completo.
    expect(payload.summary.outcome).toBe("complete");
    // Guardado.
    expect(payload.reportAvailability).toBe("stored");
    // Informe de prueba.
    expect(payload.report?.text).toContain("Informe de prueba");
    // Cambia el mensaje guardado en la memoria.
    await database
      .prepare(`UPDATE research_messages SET text = ? WHERE job_id = ? AND role = 'assistant'`)
      .bind("NO-MOSTRAR-MEMORIA", first.jobId)
      .run();
    // Quita el informe del resultado.
    await database
      .prepare(`UPDATE research_jobs SET result_json = ? WHERE id = ?`)
      .bind(JSON.stringify({ summary: payload.summary, sources: [] }), first.jobId)
      .run();
    // Lee el resultado antiguo.
    const legacy = await send(env, `${demoOrigin}/api/research/jobs/${first.jobId}/result`, {
      headers: { cookie },
    });
    // Texto.
    const legacyBody = await legacy.text();
    // No usa la memoria.
    expect(legacyBody).not.toContain("NO-MOSTRAR-MEMORIA");
    // Marca legacy-missing.
    expect(legacyBody).toContain("legacy-missing");
    // Cierra.
    database.close();
  });

  // Dos envíos simultáneos: un trabajo y una reserva.
  it("dos envíos idénticos crean un trabajo y una reserva", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Workflow.
    const { workflow, creates } = workflowMock();
    // Entorno.
    const env = demoEnv(database, workflow);
    // Sesión.
    const session = await send(env, `${demoOrigin}/api/research/session`);
    // Cookie.
    const cookie = cookieFrom(session);
    // Conversación.
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "L/X" }),
    });
    // Id.
    const conversation = (await created.json()) as { id: string };
    // Cuerpo.
    const body = JSON.stringify({
      idempotencyKey: "idem-http-race",
      question: DEMO_RESEARCH_QUESTION,
      scenarioId: "sufficient-first-round",
    });
    // Dos envíos a la vez.
    const [left, right] = await Promise.all([
      // Dos envíos idénticos a la misma conversación al mismo tiempo.
      send(env, `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body,
      }),
      send(env, `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body,
      }),
    ]);
    // 202.
    expect(left.status).toBe(202);
    // 202.
    expect(right.status).toBe(202);
    // Trabajo.
    const leftJob = (await left.json()) as { jobId: string };
    // Trabajo.
    const rightJob = (await right.json()) as { jobId: string };
    // El mismo.
    expect(rightJob.jobId).toBe(leftJob.jobId);
    // Uno solo.
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_jobs")).toBe(1);
    // Un Workflow.
    expect(new Set(creates)).toEqual(new Set([leftJob.jobId]));
    // Cuenta.
    const account = await readAccount(database);
    // Reserva.
    const reserved = await database
      .prepare(`SELECT reserved_micros FROM research_jobs WHERE id = ?`)
      .bind(leftJob.jobId)
      .first<{ reserved_micros: number }>();
    // Iguales.
    expect(account?.reserved_micros).toBe(reserved?.reserved_micros);
    // Cierra.
    database.close();
  });

  // Recupera un checkpoint y no promueve una operación en curso.
  it("recupera un checkpoint y no promueve una operación todavía en curso", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Workflow.
    const mock = workflowMock("complete");
    // Entorno.
    const env = demoEnv(database, mock.workflow);
    // Sesión.
    const session = await send(env, `${demoOrigin}/api/research/session`);
    // Cookie.
    const cookie = cookieFrom(session);
    // Conversación.
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "program" }),
    });
    // Id.
    const conversation = (await created.json()) as { id: string };
    // Trabajo con caída tras el plan.
    const submitted = await send(
      // Envío del guion que simula una caída tras el plan.
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        // Clave, pregunta de demo y guion «crash-after-plan».
        body: JSON.stringify({
          idempotencyKey: "idem-http-crash",
          question: DEMO_RESEARCH_QUESTION,
          scenarioId: "crash-after-plan",
        }),
      },
    );
    // 202.
    expect(submitted.status).toBe(202);
    // Trabajo.
    const job = (await submitted.json()) as { jobId: string; runId: string };
    // Propietario.
    const ownerId = await ownerOf(database, job.jobId);
    // Primer paso: se cae.
    const paused = await runResearchTick(database, job.jobId, ownerId);
    // Atención.
    expect(paused.status).toBe("attention");
    // Estado.
    const before = (await (
      await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}`, { headers: { cookie } })
    ).json()) as { attention: string; deadlineAt: number; runId: string };
    // Recuperable.
    expect(before.attention).toBe("recoverable");
    // Pide recuperar.
    const recover = await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}/recover`, {
      method: "POST",
      headers: { cookie, origin: demoOrigin },
    });
    // 202.
    expect(recover.status).toBe(202);
    // Reinicia el Workflow.
    expect(mock.restarts).toEqual([job.jobId]);
    // Segundo paso.
    const resumed = await runResearchTick(database, job.jobId, ownerId);
    // Completo.
    expect(resumed.status).toBe("complete");
    // Estado final.
    const after = (await (
      await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}`, { headers: { cookie } })
    ).json()) as {
      // Ejecución.
      runId: string;
      // Plazo.
      deadlineAt: number;
      // Operaciones.
      operations: { kind: string; state: string }[];
    };
    // Misma ejecución.
    expect(after.runId).toBe(before.runId);
    // Mismo plazo.
    expect(after.deadlineAt).toBe(before.deadlineAt);
    // Planes.
    const plans = after.operations.filter((operation) => operation.kind === "plan");
    // Uno solo, completado.
    expect(plans).toEqual([{ kind: "plan", state: "completed" }]);
    // Resultado.
    const result = (await (
      await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}/result`, {
        headers: { cookie },
      })
    ).json()) as { report: { text: string } };
    // Informe de prueba.
    expect(result.report.text).toContain("Informe de prueba");

    // Otra conversación.
    const live = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // Id.
    const other = (await live.json()) as { id: string };
    // Trabajo.
    const running = await send(env, `${demoOrigin}/api/research/conversations/${other.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({
        idempotencyKey: "idem-http-live",
        question: DEMO_RESEARCH_QUESTION,
        scenarioId: "sufficient-first-round",
      }),
    });
    // Id.
    const liveJob = (await running.json()) as { jobId: string };
    // Propietario.
    const liveOwner = await ownerOf(database, liveJob.jobId);
    // Reclama el trabajo.
    const claimed = await claimJob(
      database,
      liveOwner,
      liveJob.jobId,
      "research-workflow",
      Date.now(),
      180_000,
    );
    // Sin arrendamiento.
    if (!claimed) {
      // Error.
      throw new Error("sin arrendamiento");
    }
    // Operación del plan.
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-live",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Enviada.
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    // El Workflow sigue activo.
    mock.setActivity("running");
    // Pide recuperar.
    const denied = await send(env, `${demoOrigin}/api/research/jobs/${liveJob.jobId}/recover`, {
      method: "POST",
      headers: { cookie, origin: demoOrigin },
    });
    // Conflicto.
    expect(denied.status).toBe(409);
    // Cuerpo.
    const deniedBody = (await denied.json()) as { missing: string[] };
    // Ejecutor activo.
    expect(deniedBody.missing).toContain("executor-active");
    // Sin reconciliación.
    expect(deniedBody.missing).not.toContain("reconciliation-required");
    // Operaciones.
    const still = await listOperations(database, liveJob.jobId);
    // Sigue enviada.
    expect(still.find((item) => item.id === operation.id)?.state).toBe("dispatched");
    // Sin cargo desconocido.
    expect((await readAccount(database))?.unknown_micros).toBe(0);
    // Cierra.
    database.close();
  });

  // Real público: verificar antes de reservar.
  it("en real público exige verificación antes de reservar o despachar", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Workflow.
    const { workflow, creates } = workflowMock();
    // Entorno real.
    const env = realEnv(database, workflow);
    // Sesión.
    let sessionId = "";
    // Verificaciones de Turnstile.
    let verifies = 0;
    // Resultado de Turnstile.
    let verifySuccess = true;
    // fetch que responde a siteverify.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // URL.
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Turnstile.
      if (url.includes("siteverify")) {
        // Cuenta.
        verifies += 1;
        // Respuesta sintética.
        return Response.json({
          success: verifySuccess,
          hostname: "rag-thepower.josenuevo.dev",
          action: "course-chat",
          cdata: sessionId,
        });
      }
      // Resto.
      return originalFetch(input, init);
    }) as typeof fetch;

    // Sesión de seguridad.
    const security = await send(env, `${publicOrigin}/api/security`, {
      headers: { "cf-connecting-ip": ip },
    });
    // 200.
    expect(security.status).toBe(200);
    // Cookie.
    const cookie = cookieFrom(security);
    // Id de sesión.
    sessionId = ((await security.json()) as { sessionId: string }).sessionId;

    // Origen ajeno.
    const foreign = await send(env, `${publicOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://other.example",
        "cf-connecting-ip": ip,
        "x-turnstile-token": "synthetic-token",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 403.
    expect(foreign.status).toBe(403);
    // Sin verificar.
    expect(verifies).toBe(0);

    // Sin token.
    const missing = await send(env, `${publicOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: publicOrigin,
        "cf-connecting-ip": ip,
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 403.
    expect(missing.status).toBe(403);
    // Sin verificar.
    expect(verifies).toBe(0);

    // Turnstile falla.
    verifySuccess = false;
    // Petición.
    const invalid = await send(env, `${publicOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: publicOrigin,
        "cf-connecting-ip": ip,
        "x-turnstile-token": "synthetic-token",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 403.
    expect(invalid.status).toBe(403);
    // Una verificación.
    expect(verifies).toBe(1);

    // Límite por IP agotado.
    env.CHAT_IP_LIMITER = {
      // Doble de prueba: resuelve el control de cupo inyectado antes de permitir que avance la petición.
      limit: async () => ({ success: false }),
    };
    // Petición.
    const limited = await send(env, `${publicOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: publicOrigin,
        "cf-connecting-ip": ip,
        "x-turnstile-token": "synthetic-token",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 429.
    expect(limited.status).toBe(429);
    // Sin verificar más.
    expect(verifies).toBe(1);
    // Restaura el límite.
    env.CHAT_IP_LIMITER = {
      // Doble de prueba: resuelve el control de cupo inyectado antes de permitir que avance la petición.
      limit: async () => ({ success: true }),
    };

    // Sesión caducada.
    const expired = await send(env, `${publicOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: await expiredSession(turnstileSecret),
        origin: publicOrigin,
        "cf-connecting-ip": ip,
        "x-turnstile-token": "synthetic-token",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 403.
    expect(expired.status).toBe(403);
    // Sin verificar más.
    expect(verifies).toBe(1);
    // Sin conversaciones.
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_conversations")).toBe(0);
    // Sin Workflow.
    expect(creates).toEqual([]);
    // Sin reservas.
    expect((await readAccount(database))?.reserved_micros).toBe(0);

    // Turnstile correcto.
    verifySuccess = true;
    // Conversación.
    const created = await send(env, `${publicOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: publicOrigin,
        "cf-connecting-ip": ip,
        "x-turnstile-token": "synthetic-token",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 201.
    expect(created.status).toBe(201);
    // Id.
    const conversation = (await created.json()) as { id: string };
    // Trabajo.
    const submitted = await send(
      // Envío por el origen público: pasa por Turnstile y límites.
      env,
      `${publicOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        // Cabeceras: JSON, cookie, origen, IP del cliente y token de Turnstile.
        headers: {
          "content-type": "application/json",
          cookie,
          origin: publicOrigin,
          "cf-connecting-ip": ip,
          "x-turnstile-token": "synthetic-token",
        },
        // Clave y pregunta.
        body: JSON.stringify({
          idempotencyKey: "idem-public-1",
          question: DEMO_RESEARCH_QUESTION,
        }),
      },
    );
    // Si falla.
    if (submitted.status !== 202) {
      // Muestra el cuerpo.
      throw new Error(await submitted.text());
    }
    // Trabajo.
    const job = (await submitted.json()) as { jobId: string };
    // Un Workflow.
    expect(creates).toEqual([job.jobId]);
    // Hay reserva.
    expect((await readAccount(database))?.reserved_micros).toBeGreaterThan(0);
    // Estado.
    const status = await send(env, `${publicOrigin}/api/research/jobs/${job.jobId}`, {
      headers: { cookie, "cf-connecting-ip": ip },
    });
    // 200.
    expect(status.status).toBe(200);
    // Tres verificaciones.
    expect(verifies).toBe(3);
    // Cierra.
    database.close();
  });
});

// Propietario de un trabajo.
async function ownerOf(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  jobId: string,
): Promise<string> {
  // Fila.
  const row = await database
    .prepare(`SELECT owner_id FROM research_jobs WHERE id = ?`)
    .bind(jobId)
    .first<{ owner_id: string }>();
  // Sin fila.
  if (!row) {
    // Error.
    throw new Error("sin propietario");
  }
  // Propietario.
  return row.owner_id;
}

// Cookie de sesión firmada pero caducada.
async function expiredSession(secret: string): Promise<string> {
  // Id.
  const id = crypto.randomUUID();
  // Caducó hace 2 minutos.
  const expiry = String(Math.floor(Date.now() / 1000) - 120);
  // Clave HMAC derivada del secreto.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`thepower-session-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // Firma.
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${expiry}`)),
  );
  // Hexadecimal.
  const signature = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  // Cookie.
  return `__Host-thepower-session=${id}.${expiry}.${signature}`;
}
