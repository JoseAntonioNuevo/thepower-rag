import {
  MEDIA_LIMITS,
  RESEARCH_LIMITS,
  researchScenarioSchema,
  type Audience,
} from "@thepower-rag/contracts";
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
import { assessWorker, durableResearchConfigured, mediaMissing, type WorkerEnv } from "./env";
import { inspectMedia, sha256Bytes } from "./media-bytes";
import { contextualize } from "./research-memory";
import {
  assetById,
  assetByIdempotency,
  insertAsset,
  mediaDownloadName,
  mediaResponse,
  parseRange,
  purgeOrphanMedia,
  readMediaObject,
  asMediaBucket,
} from "./research-media";
import { RESEARCH_QUEUE_MS, formatMicros, holdForJob, priceSnapshot } from "./research-money";
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
      voice?: boolean;
      imageAssetId?: string | null;
      audioAssetId?: string | null;
    } | null;
    if (!body || !body.idempotencyKey || !IDEMPOTENCY.test(body.idempotencyKey)) {
      return json(
        { error: "invalid_request", message: "Falta la clave de idempotencia.", issues: [] },
        400,
      );
    }
    const question = normalizeQuestion(body.question ?? "");
    const voice = body.voice === true;
    const imageAssetId = body.imageAssetId ?? null;
    const audioAssetId = body.audioAssetId ?? null;
    const hasMedia = voice || imageAssetId !== null || audioAssetId !== null;
    if (
      (question.length === 0 && !imageAssetId && !audioAssetId) ||
      question.length > RESEARCH_LIMITS.maxQuestionChars
    ) {
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
    const missingMedia = mediaMissing(context.env, {
      image: imageAssetId !== null,
      audio: audioAssetId !== null,
      voice,
    });
    if (missingMedia.length > 0) {
      return json(
        {
          error: "configuration",
          message: "Falta una capacidad de medios. No se usa un guion en su lugar.",
          missing: missingMedia,
        },
        409,
      );
    }
    const imageAsset = imageAssetId ? await assetById(database, owner.id, imageAssetId) : null;
    const audioAsset = audioAssetId ? await assetById(database, owner.id, audioAssetId) : null;
    if (
      (imageAssetId &&
        (!imageAsset ||
          imageAsset.conversation_id !== conversation.id ||
          imageAsset.role !== "image")) ||
      (audioAssetId &&
        (!audioAsset ||
          audioAsset.conversation_id !== conversation.id ||
          audioAsset.role !== "audio"))
    ) {
      return json(
        {
          error: "invalid_request",
          message: "El adjunto no pertenece a esta conversación o ya está usado.",
          issues: [],
        },
        409,
      );
    }
    const history = await memoryTurns(database, owner.id, conversation.id);
    const contextual = contextualize(history, question);
    const mediaBinding = hasMedia
      ? {
          voice,
          image: imageAsset ? { id: imageAsset.id, hash: imageAsset.content_hash } : null,
          audio: audioAsset
            ? {
                id: audioAsset.id,
                hash: audioAsset.content_hash,
                durationMs: audioAsset.duration_ms ?? 0,
              }
            : null,
        }
      : null;
    const fingerprint = await fingerprintOf(
      mediaBinding
        ? {
            question,
            audience: conversation.audience,
            scenarioId: scenario?.success ? scenario.data : null,
            voice,
            image: mediaBinding.image,
            audio: mediaBinding.audio
              ? { id: mediaBinding.audio.id, hash: mediaBinding.audio.hash }
              : null,
          }
        : {
            question,
            audience: conversation.audience,
            scenarioId: scenario?.success ? scenario.data : null,
          },
    );
    const hold = holdForJob(prices, {
      image: imageAsset !== null,
      audioDurationMs: audioAsset?.duration_ms ?? null,
      voice,
    });
    if (hold === null) {
      return json(
        {
          error: "configuration",
          message: "La reserva de medios no cabe en el tope del trabajo.",
          missing: ["RESEARCH_JOB_LIMIT_USD"],
        },
        402,
      );
    }
    const jobPrices = { ...prices, holdMicros: hold };
    const admitted = await admitJob(database, {
      ownerId: owner.id,
      conversationId: conversation.id,
      idempotencyKey: body.idempotencyKey,
      fingerprint,
      originalQuestion: contextual.original,
      contextualized: contextual.contextualized,
      scenarioId: scenario?.success ? scenario.data : null,
      corpusVersion,
      prices: jobPrices,
      now: Date.now(),
      deadlineMs: RESEARCH_LIMITS.deadlineMs,
      queueMs: RESEARCH_QUEUE_MS,
      media: mediaBinding,
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
                    : admitted.reason === "attachment"
                      ? "El adjunto cambió o pertenece a otro trabajo."
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

  routes.post("/conversations/:id/media", async (context) => {
    const blocked = await guardMutation(context.req.raw, context.env);
    if (blocked) return blocked;
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) return owner;
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const bucket = asMediaBucket(context.env.RESEARCH_MEDIA);
    const prices = pricesFrom(context.env);
    if (!database || !prices || !bucket) {
      return json(
        {
          error: "configuration",
          message: "Falta el almacén de medios.",
          missing: ["RESEARCH_MEDIA"],
        },
        409,
      );
    }
    await ensureResearchSchema(database, prices.budgetMicros);
    const conversation = await getConversation(database, owner.id, context.req.param("id"));
    if (!conversation) {
      return json(
        { error: "configuration", message: "La conversación no existe.", missing: [] },
        404,
      );
    }
    const key = context.req.header("x-idempotency-key") ?? "";
    if (!IDEMPOTENCY.test(key)) {
      return json(
        { error: "invalid_request", message: "Falta la clave de idempotencia.", issues: [] },
        400,
      );
    }
    const bytes = await readLimited(context.req.raw, MEDIA_LIMITS.maxImageBytes);
    if (bytes === "too-large") {
      return json(
        { error: "invalid_request", message: "El archivo supera el tope.", issues: [] },
        413,
      );
    }
    if (bytes === "missing") {
      return json({ error: "invalid_request", message: "No llegó el archivo.", issues: [] }, 400);
    }
    const inspected = await inspectMedia(bytes);
    if (!inspected.ok) {
      return json(
        {
          error: "invalid_request",
          message: `Archivo rechazado: ${inspected.reason}.`,
          issues: [],
        },
        400,
      );
    }
    const hash = await sha256Bytes(bytes);
    const existing = await assetByIdempotency(database, owner.id, conversation.id, key);
    if (existing) {
      if (existing.content_hash !== hash) {
        return json(
          { error: "invalid_request", message: "Esa clave ya se usó con otros bytes.", issues: [] },
          409,
        );
      }
      return json(publicAsset(existing), 200, owner.setCookie);
    }
    const id = crypto.randomUUID();
    const objectKey = `research/${owner.id}/${conversation.id}/${id}`;
    await bucket.put(objectKey, bytes, { httpMetadata: { contentType: inspected.facts.mime } });
    const row = {
      id,
      owner_id: owner.id,
      conversation_id: conversation.id,
      role: inspected.facts.role,
      object_key: objectKey,
      content_hash: hash,
      mime: inspected.facts.mime,
      byte_size: bytes.byteLength,
      width: inspected.facts.role === "image" ? inspected.facts.width : null,
      height: inspected.facts.role === "image" ? inspected.facts.height : null,
      duration_ms: inspected.facts.role === "audio" ? inspected.facts.durationMs : null,
      sample_rate: inspected.facts.role === "audio" ? inspected.facts.sampleRate : null,
      channels: inspected.facts.role === "audio" ? inspected.facts.channels : null,
      bit_depth: inspected.facts.role === "audio" ? inspected.facts.bitDepth : null,
      status: "admitted",
      extracted_text: null,
      detail: null,
      job_id: null,
      idempotency_key: key,
      created_at: Date.now(),
    };
    try {
      await insertAsset(database, row);
    } catch {
      await bucket.delete(objectKey);
      const raced = await assetByIdempotency(database, owner.id, conversation.id, key);
      if (raced?.content_hash === hash) return json(publicAsset(raced), 200, owner.setCookie);
      return json(
        { error: "invalid_request", message: "No se pudo guardar el archivo.", issues: [] },
        409,
      );
    }
    return json(publicAsset(row), 201, owner.setCookie);
  });

  routes.on(["GET", "HEAD"], "/media/:id", async (context) => {
    const owner = await resolveOwner(context.req.raw, context.env);
    if (owner instanceof Response) return owner;
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    const bucket = asMediaBucket(context.env.RESEARCH_MEDIA);
    if (!database || !bucket) {
      return json(
        { error: "configuration", message: "Falta el almacén de medios.", missing: [] },
        409,
      );
    }
    const asset = await assetById(database, owner.id, context.req.param("id"));
    if (!asset) {
      return json({ error: "configuration", message: "El archivo no existe.", missing: [] }, 404);
    }
    const head = await bucket.head(asset.object_key);
    if (!head) {
      return json(
        { error: "configuration", message: "El archivo no está en el almacén.", missing: [] },
        404,
      );
    }
    const safeName = mediaDownloadName(asset.role, asset.mime);
    if (context.req.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": asset.mime,
          "content-length": String(head.size),
          "accept-ranges": "bytes",
          "x-content-type-options": "nosniff",
          "content-disposition": `inline; filename="${safeName}"`,
          "cache-control": "private, no-store",
        },
      });
    }
    const range = parseRange(context.req.header("range") ?? null, head.size);
    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${String(head.size)}` },
      });
    }
    const object = await readMediaObject(
      bucket,
      asset.object_key,
      range ? { offset: range.start, length: range.end - range.start + 1 } : undefined,
    );
    if (!object) {
      return json(
        { error: "configuration", message: "El archivo no está en el almacén.", missing: [] },
        404,
      );
    }
    return mediaResponse({
      bytes: object.body,
      mime: asset.mime,
      total: head.size,
      filename: safeName,
      range,
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
    const bucket = asMediaBucket(context.env.RESEARCH_MEDIA);
    const orphans = bucket
      ? await purgeOrphanMedia(database, bucket, Date.now(), MEDIA_LIMITS.orphanAfterMs)
      : 0;
    return json({ removed, orphans });
  });

  return routes;
}

function publicAsset(row: {
  id: string;
  role: string;
  mime: string;
  byte_size: number;
  content_hash: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
}) {
  return {
    id: row.id,
    role: row.role,
    mime: row.mime,
    bytes: row.byte_size,
    contentHash: row.content_hash,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
  };
}

async function readLimited(
  request: Request,
  max: number,
): Promise<Uint8Array | "too-large" | "missing"> {
  const header = request.headers.get("content-length");
  if (header !== null) {
    const declared = Number(header);
    if (!Number.isFinite(declared) || declared < 1 || declared > max) return "too-large";
  }
  const reader = request.body?.getReader();
  if (!reader) return "missing";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > max) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
    searchProvider: env.RESEARCH_SEARCH_PROVIDER === "tavily" ? "tavily" : "firecrawl",
    tavilyUsdPerCredit: env.TAVILY_USD_PER_CREDIT,
  });
}
