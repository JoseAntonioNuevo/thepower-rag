import { RESEARCH_LIMITS, researchScenarioSchema, type Audience } from "@thepower-rag/contracts";
import { Hono } from "hono";
import { protectChat, protectionRequired } from "./chat-protection";
import { asResearchDatabase, ensureResearchSchema } from "./research-db";
import {
  ensureWorkflow,
  restartWorkflow,
  stopWorkflow,
  workflowActivity,
  type ResearchWorkflowBinding,
} from "./research-dispatch";
import { assessWorker, durableResearchConfigured, type WorkerEnv } from "./env";
import { contextualize } from "./research-memory";
import { RESEARCH_QUEUE_MS, formatMicros, priceSnapshot } from "./research-money";
import { loopback, resolveOwner } from "./research-owner";
import { presentResearchResult } from "./research-result";
import {
  admitJob,
  appendEvent,
  cancelJob,
  createConversation,
  getConversation,
  getJob,
  listConversations,
  listEvents,
  listMessages,
  listOperations,
  memoryTurns,
  promoteDispatched,
  purgeCheckpoints,
  readAccount,
  resumeRecoverable,
} from "./research-store";
import { fixtureCorpusVersion } from "./fixture";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,80}$/;

function workflowOf(env: WorkerEnv): ResearchWorkflowBinding | null {
  const value = env.RESEARCH_WORKFLOW;
  if (typeof value === "object" && value !== null && "create" in value && "get" in value) {
    return value as ResearchWorkflowBinding;
  }
  return null;
}

async function fingerprintOf(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status = 200, setCookie?: string): Response {
  const headers = new Headers({ "cache-control": "no-store" });
  if (setCookie) {
    headers.set("set-cookie", setCookie);
  }
  return Response.json(body, { status, headers });
}

function normalizeQuestion(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * La propiedad y el abuso son comprobaciones distintas. En real público,
 * una mutación pasa por origen, Turnstile y cupo antes de reservar. La
 * demostración de loopback solo acepta su propio origen.
 */
async function guardMutation(request: Request, env: WorkerEnv): Promise<Response | null> {
  if (protectionRequired(env)) {
    return protectChat(request, env);
  }
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (!loopback(request.url) || origin !== url.origin) {
    return json({ error: "configuration", message: "Origen no permitido.", missing: [] }, 403);
  }
  return null;
}

export function researchRoutes() {
  const routes = new Hono<{ Bindings: WorkerEnv }>();

  routes.use("*", async (context, next) => {
    if (!durableResearchConfigured(context.env)) {
      return json(
        { error: "configuration", message: "No hay ejecución durable.", missing: [] },
        404,
      );
    }
    await next();
  });

  routes.get("/session", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    return json(
      {
        durable: true,
        anonymous: true,
        note: "La cookie identifica esta demostración en loopback. No es una cuenta de alumno.",
      },
      200,
      owner.setCookie,
    );
  });

  routes.post("/conversations", async (context) => {
    const blocked = await guardMutation(context.req.raw, context.env);
    if (blocked) {
      return blocked;
    }
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const prices = pricesFrom(context.env);
    if (!database || !prices) {
      return json(
        {
          error: "configuration",
          message: "Falta la base o el presupuesto.",
          missing: ["RESEARCH_DB"],
        },
        409,
      );
    }
    try {
      await ensureResearchSchema(database, prices.budgetMicros);
    } catch (error) {
      console.error(
        "research schema",
        error instanceof Error ? error.message.slice(0, 300) : "schema",
      );
      return json(
        {
          error: "configuration",
          message: "No se pudo preparar la base de investigación.",
          missing: ["RESEARCH_SCHEMA"],
        },
        500,
      );
    }
    const body = (await context.req.json().catch(() => null)) as { audience?: Audience } | null;
    const audience = body?.audience;
    if (audience !== "program" && audience !== "L/X" && audience !== "M/J") {
      return json({ error: "invalid_request", message: "El grupo no es válido.", issues: [] }, 400);
    }
    const conversation = await createConversation(database, owner.id, audience, Date.now());
    return json({ id: conversation.id, audience: conversation.audience }, 201, owner.setCookie);
  });

  routes.get("/conversations", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const prices = pricesFrom(context.env);
    if (!database || !prices) {
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    await ensureResearchSchema(database, prices.budgetMicros);
    const conversations = await listConversations(database, owner.id);
    return json({ conversations }, 200, owner.setCookie);
  });

  routes.get("/conversations/:id", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    if (!database) {
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    const conversation = await getConversation(database, owner.id, context.req.param("id"));
    if (!conversation) {
      return json(
        { error: "configuration", message: "La conversación no existe.", missing: [] },
        404,
      );
    }
    const messages = await listMessages(database, owner.id, conversation.id);
    return json({ conversation, messages });
  });

  routes.post("/conversations/:id/jobs", async (context) => {
    const blocked = await guardMutation(context.req.raw, context.env);
    if (blocked) {
      return blocked;
    }
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const workflow = workflowOf(context.env);
    const prices = pricesFrom(context.env);
    if (!database || !workflow || !prices) {
      return json(
        {
          error: "configuration",
          message: "La investigación durable no está disponible.",
          missing: ["RESEARCH_WORKFLOW"],
        },
        409,
      );
    }
    const real = context.env.APP_MODE === "real";
    const assessment = real ? assessWorker(context.env) : null;
    if (real && assessment?.capabilities.research.status !== "ready") {
      return json(
        {
          error: "configuration",
          message:
            "La investigación real está bloqueada. No se usan guiones ni ejecución en primer plano.",
          missing: assessment?.capabilities.research.missing ?? ["APP_MODE"],
        },
        409,
      );
    }
    const corpusVersion = assessment?.retrieval?.corpusVersion ?? fixtureCorpusVersion();
    await ensureResearchSchema(database, prices.budgetMicros);
    const conversation = await getConversation(database, owner.id, context.req.param("id"));
    if (!conversation) {
      return json(
        { error: "configuration", message: "La conversación no existe.", missing: [] },
        404,
      );
    }
    const body = (await context.req.json().catch(() => null)) as {
      idempotencyKey?: string;
      question?: string;
      scenarioId?: string | null;
      audience?: string;
    } | null;
    if (!body || !body.idempotencyKey || !IDEMPOTENCY.test(body.idempotencyKey)) {
      return json(
        { error: "invalid_request", message: "Falta la clave de idempotencia.", issues: [] },
        400,
      );
    }
    const question = normalizeQuestion(body.question ?? "");
    if (question.length === 0 || question.length > RESEARCH_LIMITS.maxQuestionChars) {
      return json(
        { error: "invalid_request", message: "La pregunta no es válida.", issues: [] },
        400,
      );
    }
    if (body.audience && body.audience !== conversation.audience) {
      return json(
        {
          error: "invalid_request",
          message: "El grupo de la conversación no cambia. Abre otra conversación.",
          issues: [],
        },
        409,
      );
    }
    const scenario = body.scenarioId ? researchScenarioSchema.safeParse(body.scenarioId) : null;
    if (body.scenarioId && !scenario?.success) {
      return json({ error: "invalid_request", message: "El guion no es válido.", issues: [] }, 400);
    }
    if (real && body.scenarioId) {
      return json(
        { error: "invalid_request", message: "El modo real no usa guiones.", issues: [] },
        409,
      );
    }
    const history = await memoryTurns(database, owner.id, conversation.id);
    const contextual = contextualize(history, question);
    const fingerprint = await fingerprintOf({
      question,
      audience: conversation.audience,
      scenarioId: scenario?.success ? scenario.data : null,
    });
    const admitted = await admitJob(database, {
      ownerId: owner.id,
      conversationId: conversation.id,
      idempotencyKey: body.idempotencyKey,
      fingerprint,
      originalQuestion: contextual.original,
      contextualized: contextual.contextualized,
      scenarioId: scenario?.success ? scenario.data : null,
      corpusVersion,
      prices,
      now: Date.now(),
      deadlineMs: RESEARCH_LIMITS.deadlineMs,
      queueMs: RESEARCH_QUEUE_MS,
    });
    if (!admitted.ok) {
      const status =
        admitted.reason === "fingerprint" ? 409 : admitted.reason === "budget" ? 402 : 409;
      return json(
        {
          error: "configuration",
          message:
            admitted.reason === "budget"
              ? "No queda presupuesto de investigación para reservar este trabajo."
              : admitted.reason === "fingerprint"
                ? "Esa clave ya se usó con otra pregunta."
                : admitted.reason === "active"
                  ? "Esta conversación ya tiene un trabajo activo."
                  : admitted.reason === "turns"
                    ? "La conversación alcanzó el tope de turnos."
                    : "No se pudo crear el trabajo.",
          missing: admitted.reason === "budget" ? ["RESEARCH_BUDGET_USD"] : [],
        },
        status,
      );
    }
    let job = admitted.job;
    if (job.dispatch_state !== "created") {
      const dispatch = await ensureWorkflow(database, workflow, owner.id, job.id);
      await appendEvent(
        database,
        job.id,
        "dispatch",
        dispatch === "created" ? "Trabajo encolado." : "El arranque del flujo no está confirmado.",
        Date.now(),
      );
      job = (await getJob(database, owner.id, job.id)) ?? job;
      if (dispatch === "unconfirmed") {
        return json(
          {
            jobId: job.id,
            conversationId: conversation.id,
            execution: "attention",
            dispatch: "unconfirmed",
          },
          202,
          owner.setCookie,
        );
      }
    }
    return json(
      {
        jobId: job.id,
        conversationId: conversation.id,
        runId: job.run_id,
        execution: job.execution_status,
        created: admitted.created,
        dispatch: job.dispatch_state,
      },
      202,
      owner.setCookie,
    );
  });

  routes.get("/jobs/:id", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    if (!database) {
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    const job = await getJob(database, owner.id, context.req.param("id"));
    if (!job || !UUID.test(job.id)) {
      return json({ error: "configuration", message: "El trabajo no existe.", missing: [] }, 404);
    }
    const after = Number(context.req.query("after") ?? "0");
    const events = await listEvents(database, owner.id, job.id, Number.isFinite(after) ? after : 0);
    const operations = await listOperations(database, job.id);
    return json({
      jobId: job.id,
      conversationId: job.conversation_id,
      runId: job.run_id,
      execution: job.execution_status,
      reportOutcome: job.report_outcome,
      attention: job.attention_reason,
      progress: job.progress_text,
      deadlineAt: job.deadline_at,
      cancelRequested: job.cancel_requested === 1,
      dispatch: job.dispatch_state,
      events,
      operations: operations.map((operation) => ({
        kind: operation.kind,
        state: operation.state,
      })),
    });
  });

  routes.get("/jobs/:id/result", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    if (!database) {
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    const job = await getJob(database, owner.id, context.req.param("id"));
    if (!job?.result_json) {
      return json(
        { error: "configuration", message: "Todavía no hay resultado.", missing: [] },
        404,
      );
    }
    const presented = await presentResearchResult(database, owner.id, job.id, job.result_json);
    if (presented === null) {
      return json(
        { error: "configuration", message: "El resultado guardado no es válido.", missing: [] },
        409,
      );
    }
    return json(presented);
  });

  routes.post("/jobs/:id/cancel", async (context) => {
    const blocked = await guardMutation(context.req.raw, context.env);
    if (blocked) {
      return blocked;
    }
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const workflow = workflowOf(context.env);
    if (!database || !workflow) {
      return json({ error: "configuration", message: "Falta el ejecutor.", missing: [] }, 409);
    }
    const job = await cancelJob(database, owner.id, context.req.param("id"), Date.now());
    if (!job) {
      return json({ error: "configuration", message: "El trabajo no existe.", missing: [] }, 404);
    }
    await stopWorkflow(workflow, job.id);
    return json({
      jobId: job.id,
      execution: job.execution_status,
      reportOutcome: job.report_outcome,
      unknownMicros: job.unknown_micros,
    });
  });

  routes.post("/jobs/:id/recover", async (context) => {
    const blocked = await guardMutation(context.req.raw, context.env);
    if (blocked) {
      return blocked;
    }
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const workflow = workflowOf(context.env);
    if (!database || !workflow) {
      return json({ error: "configuration", message: "Falta el ejecutor.", missing: [] }, 409);
    }
    const jobId = context.req.param("id");
    const job = await getJob(database, owner.id, jobId);
    if (!job) {
      return json({ error: "configuration", message: "El trabajo no existe.", missing: [] }, 404);
    }
    const operations = await listOperations(database, job.id);
    const unknown = operations.some((operation) => operation.state === "unknown");
    const dispatched = operations.some((operation) => operation.state === "dispatched");
    if (unknown) {
      return json(
        {
          error: "configuration",
          message: "Hay una operación ambigua. No se reenvía ni se libera su reserva.",
          missing: ["reconciliation-required"],
          jobId: job.id,
          execution: "attention",
        },
        409,
      );
    }
    if (dispatched) {
      const activity = await workflowActivity(workflow, job.id);
      if (activity === "inactive") {
        await promoteDispatched(database, owner.id, job.id);
        return json(
          {
            error: "configuration",
            message: "Hay una operación ambigua. No se reenvía ni se libera su reserva.",
            missing: ["reconciliation-required"],
            jobId: job.id,
            execution: "attention",
          },
          409,
        );
      }
      return json(
        {
          error: "configuration",
          message:
            "El ejecutor todavía tiene el arrendamiento. No se marca la operación como desconocida.",
          missing: ["executor-active"],
          jobId: job.id,
          execution: job.execution_status,
        },
        409,
      );
    }
    if (job.execution_status === "attention" && job.attention_reason === "recoverable") {
      const resumed = await resumeRecoverable(database, owner.id, job.id);
      if (!resumed) {
        return json(
          { error: "configuration", message: "El trabajo ya no se puede reanudar.", missing: [] },
          409,
        );
      }
      let restarted = await restartWorkflow(workflow, job.id);
      if (!restarted) {
        const dispatch = await ensureWorkflow(database, workflow, owner.id, job.id);
        restarted = dispatch === "created";
      }
      return json(
        {
          jobId: job.id,
          runId: resumed.run_id,
          restarted,
          execution: resumed.execution_status,
          deadlineAt: resumed.deadline_at,
        },
        restarted ? 202 : 409,
      );
    }
    if (job.execution_status === "attention") {
      return json(
        {
          error: "configuration",
          message: "Este trabajo no se puede reanudar automáticamente.",
          missing: [job.attention_reason ?? "attention"],
          jobId: job.id,
          execution: "attention",
        },
        409,
      );
    }
    if (job.dispatch_state !== "created") {
      const dispatch = await ensureWorkflow(database, workflow, owner.id, job.id);
      return json(
        { jobId: job.id, dispatch, execution: job.execution_status },
        dispatch === "created" ? 202 : 409,
      );
    }
    if (job.execution_status === "running" || job.execution_status === "queued") {
      const restarted = await restartWorkflow(workflow, job.id);
      return json(
        { jobId: job.id, restarted, execution: job.execution_status },
        restarted ? 202 : 409,
      );
    }
    return json({
      jobId: job.id,
      execution: job.execution_status,
      reportOutcome: job.report_outcome,
    });
  });

  routes.get("/budget", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const prices = pricesFrom(context.env);
    if (!database || !prices) {
      return json(
        {
          error: "configuration",
          message: "Falta el presupuesto.",
          missing: ["RESEARCH_BUDGET_USD"],
        },
        409,
      );
    }
    await ensureResearchSchema(database, prices.budgetMicros);
    const account = await readAccount(database);
    if (!account) {
      return json(
        { error: "configuration", message: "No hay cuenta de investigación.", missing: [] },
        409,
      );
    }
    const open = account.unknown_micros > 0;
    return json({
      currency: "USD",
      budget: formatMicros(account.budget_micros),
      reserved: formatMicros(account.reserved_micros),
      unknown: formatMicros(account.unknown_micros),
      consumed: formatMicros(account.consumed_micros),
      totalComplete: !open,
      note: open
        ? "Hay cargos desconocidos o sin precio. No forman un total en USD y no se liberan."
        : "Reservado es un tope. Consumido es lo ya asentado. Desconocido no es cero.",
    });
  });

  routes.post("/retention", async (context) => {
    const blocked = await guardMutation(context.req.raw, context.env);
    if (blocked) {
      return blocked;
    }
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) {
      return owner;
    }
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    if (!database) {
      return json({ error: "configuration", message: "Falta la base.", missing: [] }, 409);
    }
    const removed = await purgeCheckpoints(database, Date.now());
    return json({ removed });
  });

  return routes;
}

function pricesFrom(env: WorkerEnv) {
  return priceSnapshot({
    budgetUsd: env.RESEARCH_BUDGET_USD ?? env.RESEARCH_FIXTURE_BUDGET_USD ?? "",
    jobLimitUsd: env.RESEARCH_JOB_LIMIT_USD ?? env.RESEARCH_FIXTURE_JOB_LIMIT_USD ?? "",
    inputUsdPerMillion: env.RESEARCH_INPUT_USD_PER_MILLION ?? "",
    outputUsdPerMillion: env.RESEARCH_OUTPUT_USD_PER_MILLION ?? "",
    searchUsd: env.RESEARCH_SEARCH_USD,
    readUsd: env.RESEARCH_READ_USD,
    firecrawlUsdPerCredit: env.FIRECRAWL_USD_PER_CREDIT,
  });
}
