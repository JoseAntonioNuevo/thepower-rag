import { DEMO_RESEARCH_QUESTION, RESEARCH_SPEND_TOKEN } from "@thepower-rag/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { WorkerEnv } from "./env";
import { ensureResearchSchema } from "./research-db";
import { runResearchTick } from "./research-runner";
import { openResearchSqlite } from "./research-sqlite";
import {
  beginOperation,
  claimJob,
  listOperations,
  markDispatched,
  readAccount,
} from "./research-store";
import worker from "./worker";

const originalFetch = globalThis.fetch;
const context = {} as ExecutionContext;
const demoOrigin = "http://127.0.0.1:5191";
const publicOrigin = "https://rag-thepower.josenuevo.dev";
const ip = "198.51.100.20";
const turnstileSecret = "synthetic-secret-for-unit-tests-only";

function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

async function total(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  sql: string,
): Promise<number> {
  const row = await database.prepare(sql).first<{ total: number }>();
  return row?.total ?? 0;
}

function workflowMock(status = "complete") {
  const creates: string[] = [];
  const restarts: string[] = [];
  let activity = status;
  const workflow = {
    async create(options: { id: string }) {
      creates.push(options.id);
      return { id: options.id };
    },
    async get(id: string) {
      return {
        async status() {
          return { status: activity };
        },
        async terminate() {
          return undefined;
        },
        async restart() {
          restarts.push(id);
        },
      };
    },
  };
  return {
    workflow,
    creates,
    restarts,
    setActivity(next: string) {
      activity = next;
    },
  };
}

function demoEnv(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  workflow: WorkerEnv["RESEARCH_WORKFLOW"],
): WorkerEnv {
  return {
    APP_MODE: "demo",
    RESEARCH_OWNER_SECRET: "local-loopback-research-owner",
    RESEARCH_DB: database,
    RESEARCH_WORKFLOW: workflow,
    RESEARCH_BUDGET_USD: "1.000000",
    RESEARCH_JOB_LIMIT_USD: "0.250000",
    RESEARCH_INPUT_USD_PER_MILLION: "0.100000",
    RESEARCH_OUTPUT_USD_PER_MILLION: "0.500000",
    RESEARCH_SEARCH_USD: "0.002000",
    RESEARCH_READ_USD: "0.005000",
  };
}

function realEnv(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  workflow: WorkerEnv["RESEARCH_WORKFLOW"],
): WorkerEnv {
  return {
    ...demoEnv(database, workflow),
    APP_MODE: "real",
    PUBLIC_ORIGIN: publicOrigin,
    PUBLIC_BUDGET_USD: "1",
    TURNSTILE_SITE_KEY: "synthetic-site-key",
    TURNSTILE_SECRET_KEY: turnstileSecret,
    CHAT_IP_LIMITER: { limit: async () => ({ success: true }) },
    CHAT_SESSION_LIMITER: { limit: async () => ({ success: true }) },
    ANTHROPIC_API_KEY: "local-test-key",
    MODEL_ID: "example/generator",
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
    RESEARCH_MODEL_ID: "example/research",
    FIRECRAWL_API_KEY: "local-firecrawl",
    RESEARCH_SPEND_AUTHORIZATION: RESEARCH_SPEND_TOKEN,
    FIRECRAWL_USD_PER_CREDIT: "0.010000",
  };
}

async function send(env: WorkerEnv, url: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(url, init), env, context);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HTTP durable de investigación", () => {
  it("en loopback rechaza otro origen y repite la misma petición", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const { workflow, creates } = workflowMock();
    const env = demoEnv(database, workflow);
    const session = await send(env, `${demoOrigin}/api/research/session`);
    expect(session.status).toBe(200);
    const cookie = cookieFrom(session);
    const foreign = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: "https://other.example",
      },
      body: JSON.stringify({ audience: "M/J" }),
    });
    expect(foreign.status).toBe(403);
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_conversations")).toBe(0);
    expect(creates).toEqual([]);

    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "M/J" }),
    });
    expect(created.status).toBe(201);
    const conversation = (await created.json()) as { id: string };
    const body = {
      idempotencyKey: "idem-http-1",
      question: DEMO_RESEARCH_QUESTION,
      scenarioId: "sufficient-first-round",
    };
    const submitted = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    expect(submitted.status).toBe(202);
    const first = (await submitted.json()) as { jobId: string; runId: string; created: boolean };
    const again = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({ ...body, question: `  ${DEMO_RESEARCH_QUESTION}  ` }),
      },
    );
    expect(again.status).toBe(202);
    const second = (await again.json()) as { jobId: string; created: boolean };
    expect(second.jobId).toBe(first.jobId);
    expect(second.created).toBe(false);
    expect(new Set(creates)).toEqual(new Set([first.jobId]));
    const account = await readAccount(database);
    const reserved = await database
      .prepare(`SELECT reserved_micros FROM research_jobs WHERE id = ?`)
      .bind(first.jobId)
      .first<{ reserved_micros: number }>();
    expect(account?.reserved_micros).toBe(reserved?.reserved_micros);

    const different = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({ ...body, question: "Otra pregunta distinta" }),
      },
    );
    expect(different.status).toBe(409);
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_jobs")).toBe(1);

    const tick = await runResearchTick(database, first.jobId, await ownerOf(database, first.jobId));
    expect(tick.status).toBe("complete");
    const completed = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    expect(((await completed.json()) as { jobId: string }).jobId).toBe(first.jobId);

    const follow = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({
          idempotencyKey: "idem-http-2",
          question: "¿y ese índice?",
          scenarioId: "sufficient-first-round",
        }),
      },
    );
    expect(follow.status).toBe(202);
    const followId = ((await follow.json()) as { jobId: string }).jobId;
    expect(followId).not.toBe(first.jobId);
    const original = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    expect(((await original.json()) as { jobId: string }).jobId).toBe(first.jobId);

    const restarted = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify(body),
      },
    );
    expect(((await restarted.json()) as { jobId: string }).jobId).toBe(first.jobId);

    const result = await send(env, `${demoOrigin}/api/research/jobs/${first.jobId}/result`, {
      headers: { cookie },
    });
    expect(result.status).toBe(200);
    const payload = (await result.json()) as {
      summary: { outcome: string };
      report: { text: string } | null;
      reportAvailability: string;
    };
    expect(payload.summary.outcome).toBe("complete");
    expect(payload.reportAvailability).toBe("stored");
    expect(payload.report?.text).toContain("Informe de prueba");
    await database
      .prepare(`UPDATE research_messages SET text = ? WHERE job_id = ? AND role = 'assistant'`)
      .bind("NO-MOSTRAR-MEMORIA", first.jobId)
      .run();
    await database
      .prepare(`UPDATE research_jobs SET result_json = ? WHERE id = ?`)
      .bind(JSON.stringify({ summary: payload.summary, sources: [] }), first.jobId)
      .run();
    const legacy = await send(env, `${demoOrigin}/api/research/jobs/${first.jobId}/result`, {
      headers: { cookie },
    });
    const legacyBody = await legacy.text();
    expect(legacyBody).not.toContain("NO-MOSTRAR-MEMORIA");
    expect(legacyBody).toContain("legacy-missing");
    database.close();
  });

  it("dos envíos idénticos crean un trabajo y una reserva", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const { workflow, creates } = workflowMock();
    const env = demoEnv(database, workflow);
    const session = await send(env, `${demoOrigin}/api/research/session`);
    const cookie = cookieFrom(session);
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "L/X" }),
    });
    const conversation = (await created.json()) as { id: string };
    const body = JSON.stringify({
      idempotencyKey: "idem-http-race",
      question: DEMO_RESEARCH_QUESTION,
      scenarioId: "sufficient-first-round",
    });
    const [left, right] = await Promise.all([
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
    expect(left.status).toBe(202);
    expect(right.status).toBe(202);
    const leftJob = (await left.json()) as { jobId: string };
    const rightJob = (await right.json()) as { jobId: string };
    expect(rightJob.jobId).toBe(leftJob.jobId);
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_jobs")).toBe(1);
    expect(new Set(creates)).toEqual(new Set([leftJob.jobId]));
    const account = await readAccount(database);
    const reserved = await database
      .prepare(`SELECT reserved_micros FROM research_jobs WHERE id = ?`)
      .bind(leftJob.jobId)
      .first<{ reserved_micros: number }>();
    expect(account?.reserved_micros).toBe(reserved?.reserved_micros);
    database.close();
  });

  it("recupera un checkpoint y no promueve una operación todavía en curso", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const mock = workflowMock("complete");
    const env = demoEnv(database, mock.workflow);
    const session = await send(env, `${demoOrigin}/api/research/session`);
    const cookie = cookieFrom(session);
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "program" }),
    });
    const conversation = (await created.json()) as { id: string };
    const submitted = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { "content-type": "application/json", cookie, origin: demoOrigin },
        body: JSON.stringify({
          idempotencyKey: "idem-http-crash",
          question: DEMO_RESEARCH_QUESTION,
          scenarioId: "crash-after-plan",
        }),
      },
    );
    expect(submitted.status).toBe(202);
    const job = (await submitted.json()) as { jobId: string; runId: string };
    const ownerId = await ownerOf(database, job.jobId);
    const paused = await runResearchTick(database, job.jobId, ownerId);
    expect(paused.status).toBe("attention");
    const before = (await (
      await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}`, { headers: { cookie } })
    ).json()) as { attention: string; deadlineAt: number; runId: string };
    expect(before.attention).toBe("recoverable");
    const recover = await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}/recover`, {
      method: "POST",
      headers: { cookie, origin: demoOrigin },
    });
    expect(recover.status).toBe(202);
    expect(mock.restarts).toEqual([job.jobId]);
    const resumed = await runResearchTick(database, job.jobId, ownerId);
    expect(resumed.status).toBe("complete");
    const after = (await (
      await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}`, { headers: { cookie } })
    ).json()) as {
      runId: string;
      deadlineAt: number;
      operations: { kind: string; state: string }[];
    };
    expect(after.runId).toBe(before.runId);
    expect(after.deadlineAt).toBe(before.deadlineAt);
    const plans = after.operations.filter((operation) => operation.kind === "plan");
    expect(plans).toEqual([{ kind: "plan", state: "completed" }]);
    const result = (await (
      await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}/result`, {
        headers: { cookie },
      })
    ).json()) as { report: { text: string } };
    expect(result.report.text).toContain("Informe de prueba");

    const live = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({ audience: "M/J" }),
    });
    const other = (await live.json()) as { id: string };
    const running = await send(env, `${demoOrigin}/api/research/conversations/${other.id}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: demoOrigin },
      body: JSON.stringify({
        idempotencyKey: "idem-http-live",
        question: DEMO_RESEARCH_QUESTION,
        scenarioId: "sufficient-first-round",
      }),
    });
    const liveJob = (await running.json()) as { jobId: string };
    const liveOwner = await ownerOf(database, liveJob.jobId);
    const claimed = await claimJob(
      database,
      liveOwner,
      liveJob.jobId,
      "research-workflow",
      Date.now(),
      180_000,
    );
    if (!claimed) {
      throw new Error("sin arrendamiento");
    }
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-live",
      reservation: 10,
      fence: claimed.lease_token,
    });
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    mock.setActivity("running");
    const denied = await send(env, `${demoOrigin}/api/research/jobs/${liveJob.jobId}/recover`, {
      method: "POST",
      headers: { cookie, origin: demoOrigin },
    });
    expect(denied.status).toBe(409);
    const deniedBody = (await denied.json()) as { missing: string[] };
    expect(deniedBody.missing).toContain("executor-active");
    expect(deniedBody.missing).not.toContain("reconciliation-required");
    const still = await listOperations(database, liveJob.jobId);
    expect(still.find((item) => item.id === operation.id)?.state).toBe("dispatched");
    expect((await readAccount(database))?.unknown_micros).toBe(0);
    database.close();
  });

  it("en real público exige verificación antes de reservar o despachar", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const { workflow, creates } = workflowMock();
    const env = realEnv(database, workflow);
    let sessionId = "";
    let verifies = 0;
    let verifySuccess = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("siteverify")) {
        verifies += 1;
        return Response.json({
          success: verifySuccess,
          hostname: "rag-thepower.josenuevo.dev",
          action: "course-chat",
          cdata: sessionId,
        });
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const security = await send(env, `${publicOrigin}/api/security`, {
      headers: { "cf-connecting-ip": ip },
    });
    expect(security.status).toBe(200);
    const cookie = cookieFrom(security);
    sessionId = ((await security.json()) as { sessionId: string }).sessionId;

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
    expect(foreign.status).toBe(403);
    expect(verifies).toBe(0);

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
    expect(missing.status).toBe(403);
    expect(verifies).toBe(0);

    verifySuccess = false;
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
    expect(invalid.status).toBe(403);
    expect(verifies).toBe(1);

    env.CHAT_IP_LIMITER = { limit: async () => ({ success: false }) };
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
    expect(limited.status).toBe(429);
    expect(verifies).toBe(1);
    env.CHAT_IP_LIMITER = { limit: async () => ({ success: true }) };

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
    expect(expired.status).toBe(403);
    expect(verifies).toBe(1);
    expect(await total(database, "SELECT COUNT(*) AS total FROM research_conversations")).toBe(0);
    expect(creates).toEqual([]);
    expect((await readAccount(database))?.reserved_micros).toBe(0);

    verifySuccess = true;
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
    expect(created.status).toBe(201);
    const conversation = (await created.json()) as { id: string };
    const submitted = await send(
      env,
      `${publicOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          origin: publicOrigin,
          "cf-connecting-ip": ip,
          "x-turnstile-token": "synthetic-token",
        },
        body: JSON.stringify({
          idempotencyKey: "idem-public-1",
          question: DEMO_RESEARCH_QUESTION,
        }),
      },
    );
    if (submitted.status !== 202) {
      throw new Error(await submitted.text());
    }
    const job = (await submitted.json()) as { jobId: string };
    expect(creates).toEqual([job.jobId]);
    expect((await readAccount(database))?.reserved_micros).toBeGreaterThan(0);
    const status = await send(env, `${publicOrigin}/api/research/jobs/${job.jobId}`, {
      headers: { cookie, "cf-connecting-ip": ip },
    });
    expect(status.status).toBe(200);
    expect(verifies).toBe(3);
    database.close();
  });
});

async function ownerOf(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  jobId: string,
): Promise<string> {
  const row = await database
    .prepare(`SELECT owner_id FROM research_jobs WHERE id = ?`)
    .bind(jobId)
    .first<{ owner_id: string }>();
  if (!row) {
    throw new Error("sin propietario");
  }
  return row.owner_id;
}

async function expiredSession(secret: string): Promise<string> {
  const id = crypto.randomUUID();
  const expiry = String(Math.floor(Date.now() / 1000) - 120);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`thepower-session-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${expiry}`)),
  );
  const signature = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `__Host-thepower-session=${id}.${expiry}.${signature}`;
}
