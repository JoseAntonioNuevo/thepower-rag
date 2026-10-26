// GUÍA DE LECTURA · apps/api/src/research-routes.ts
// Rutas HTTP de la investigación durable bajo /api/research: sesión, conversaciones, envío de trabajos,
// estado y eventos, cancelación, recuperación, resultado, subida y descarga de medios y limpieza.
// Las mutaciones pasan antes por origen, Turnstile y límites; cada lectura comprueba el propietario.
// Límites y esquema de escenario.
import { MEDIA_LIMITS, RESEARCH_LIMITS, researchScenarioSchema } from "@thepower-rag/contracts";
// Hono: enrutador HTTP.
import { Hono } from "hono";
// Protección del chat público.
import { protectChat, protectionRequired } from "./chat-protection";
// Acceso y esquema de la base de investigación.
import { asResearchDatabase, ensureResearchSchema } from "./research-db";
// Arranque, reinicio, parada y estado del Workflow.
import {
  ensureWorkflow,
  restartWorkflow,
  stopWorkflow,
  workflowActivity,
  type ResearchWorkflowBinding,
} from "./research-dispatch";
// Configuración del Worker.
import { assessWorker, durableResearchConfigured, mediaMissing, type WorkerEnv } from "./env";
// Inspección y hash de bytes.
import { inspectMedia, sha256Bytes } from "./media-bytes";
// Contextualiza la pregunta con la memoria.
import { contextualize } from "./research-memory";
// Filas y objetos de medios.
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
// Plazo de cola, formato de importes, reservas y tarifas.
import { RESEARCH_QUEUE_MS, formatMicros, holdForJob, priceSnapshot } from "./research-money";
// Origen local y propietario por cookie.
import { loopback, resolveOwner } from "./research-owner";
// Resultado presentado al navegador.
import { presentResearchResult } from "./research-result";
// Operaciones del almacén.
import {
  // Admitir, eventos y cancelación de trabajos.
  admitJob,
  appendEvent,
  cancelJob,
  // Conversaciones y lectura de trabajos.
  createConversation,
  getConversation,
  getJob,
  listConversations,
  // Listados de eventos, mensajes y operaciones, y memoria de la conversación.
  listEvents,
  listMessages,
  listOperations,
  memoryTurns,
  // Recuperación tras una caída, limpieza de checkpoints, cuenta y reanudación.
  promoteDispatched,
  purgeCheckpoints,
  readAccount,
  resumeRecoverable,
} from "./research-store";
// Versión del corpus de ejemplo.
import { storeFixtureCorpusVersion } from "./fixture";

// Formato de un UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Formato de una clave de idempotencia.
const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,80}$/;

// Binding del Workflow o null.
function workflowOf(env: WorkerEnv): ResearchWorkflowBinding | null {
  // Valor del entorno.
  const value = env.RESEARCH_WORKFLOW;
  // Si tiene create y get.
  if (typeof value === "object" && value !== null && "create" in value && "get" in value) {
    // Se usa como Workflow.
    return value as ResearchWorkflowBinding;
  }
  // null.
  return null;
}

// Huella SHA-256 de un objeto en JSON.
async function fingerprintOf(value: unknown): Promise<string> {
  // Resumen.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  // Hexadecimal.
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Respuesta JSON sin caché y con cookie opcional.
function json(body: unknown, status = 200, setCookie?: string): Response {
  // Cabeceras.
  const headers = new Headers({ "cache-control": "no-store" });
  // Con cookie.
  if (setCookie) {
    // La añade.
    headers.set("set-cookie", setCookie);
  }
  // Respuesta.
  return Response.json(body, { status, headers });
}

// Pregunta normalizada: NFC, sin espacios repetidos.
function normalizeQuestion(value: string): string {
  // Normaliza.
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

/**
 * La propiedad y el abuso son comprobaciones distintas. En real público,
 * una mutación pasa por origen, Turnstile y cupo antes de reservar. La
 * demostración de loopback solo acepta su propio origen.
 */
async function guardMutation(request: Request, env: WorkerEnv): Promise<Response | null> {
  // En real público: protección completa.
  if (protectionRequired(env)) {
    // Origen, Turnstile y límites.
    return protectChat(request, env);
  }
  // Origen de la petición.
  const origin = request.headers.get("origin");
  // URL.
  const url = new URL(request.url);
  // Solo loopback con su mismo origen.
  if (!loopback(request.url) || origin !== url.origin) {
    // 403.
    return json({ error: "configuration", message: "Origen no permitido.", missing: [] }, 403);
  }
  // Permitida.
  return null;
}

// Crea el subenrutador /api/research.
export function researchRoutes() {
  // Enrutador Hono.
  const routes = new Hono<{ Bindings: WorkerEnv }>();

  // Sin investigación durable configurada: 404 en todas las rutas.
  routes.use("*", async (context, next) => {
    // No configurada.
    if (!durableResearchConfigured(context.env)) {
      // 404.
      return json(
        { error: "configuration", message: "No hay ejecución durable.", missing: [] },
        404,
      );
    }
    // Sigue a la ruta.
    await next();
  });

  // GET /session: crea o renueva la cookie de propietario.
  routes.get("/session", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Sesión anónima.
    return json(
      {
        durable: true,
        anonymous: true,
        note: "La cookie identifica esta demostración en loopback. No es una cuenta de cliente.",
      },
      200,
      owner.setCookie,
    );
  });

  // POST /conversations: crea una conversación del propietario.
  routes.post("/conversations", async (context) => {
    // Protección de la mutación.
    const blocked = await guardMutation(context.req.raw, context.env);
    // Bloqueada.
    if (blocked) {
      // Se devuelve.
      return blocked;
    }
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Tarifas.
    const prices = pricesFrom(context.env);
    // Falta algo.
    if (!database || !prices) {
      // 409.
      return json(
        {
          error: "configuration",
          message: "Falta la base o el presupuesto.",
          missing: ["RESEARCH_DB"],
        },
        409,
      );
    }
    // Prepara las tablas.
    try {
      // Esquema y presupuesto.
      await ensureResearchSchema(database, prices.budgetMicros);
    } catch (error) {
      // Registra el error recortado.
      console.error(
        "research schema",
        error instanceof Error ? error.message.slice(0, 300) : "schema",
      );
      // 500.
      return json(
        {
          error: "configuration",
          message: "No se pudo preparar la base de investigación.",
          missing: ["RESEARCH_SCHEMA"],
        },
        500,
      );
    }
    // Crea la conversación.
    const conversation = await createConversation(database, owner.id, Date.now());
    // 201.
    return json({ id: conversation.id }, 201, owner.setCookie);
  });

  // GET /conversations: lista las del propietario.
  routes.get("/conversations", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Tarifas.
    const prices = pricesFrom(context.env);
    // Falta algo.
    if (!database || !prices) {
      // 409.
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    // Prepara las tablas.
    await ensureResearchSchema(database, prices.budgetMicros);
    // Conversaciones.
    const conversations = await listConversations(database, owner.id);
    // Lista.
    return json({ conversations }, 200, owner.setCookie);
  });

  // GET /conversations/:id: conversación con sus mensajes.
  routes.get("/conversations/:id", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Falta.
    if (!database) {
      // 409.
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    // Conversación del propietario.
    const conversation = await getConversation(database, owner.id, context.req.param("id"));
    // No existe.
    if (!conversation) {
      // 404.
      return json(
        { error: "configuration", message: "La conversación no existe.", missing: [] },
        404,
      );
    }
    // Mensajes.
    const messages = await listMessages(database, owner.id, conversation.id);
    // Conversación y mensajes.
    return json({ conversation, messages });
  });

  // POST /conversations/:id/jobs: valida, reserva y encola un trabajo.
  routes.post("/conversations/:id/jobs", async (context) => {
    // Protección de la mutación.
    const blocked = await guardMutation(context.req.raw, context.env);
    // Bloqueada.
    if (blocked) {
      // Se devuelve.
      return blocked;
    }
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Workflow.
    const workflow = workflowOf(context.env);
    // Tarifas.
    const prices = pricesFrom(context.env);
    // Falta algo.
    if (!database || !workflow || !prices) {
      // 409.
      return json(
        {
          error: "configuration",
          message: "La investigación durable no está disponible.",
          missing: ["RESEARCH_WORKFLOW"],
        },
        409,
      );
    }
    // ¿Modo real?
    const real = context.env.APP_MODE === "real";
    // Capacidades en real.
    const assessment = real ? assessWorker(context.env) : null;
    // Investigación real no lista.
    if (real && assessment?.capabilities.research.status !== "ready") {
      // 409 sin guiones.
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
    // Versión del corpus de la tienda.
    const corpusVersion = assessment?.storeRetrieval?.corpusVersion ?? storeFixtureCorpusVersion();
    // Prepara las tablas.
    await ensureResearchSchema(database, prices.budgetMicros);
    // Conversación del propietario.
    const conversation = await getConversation(database, owner.id, context.req.param("id"));
    // No existe.
    if (!conversation) {
      // 404.
      return json(
        { error: "configuration", message: "La conversación no existe.", missing: [] },
        404,
      );
    }
    // Cuerpo.
    const body = (await context.req.json().catch(() => null)) as {
      // Clave de idempotencia.
      idempotencyKey?: string;
      // Pregunta.
      question?: string;
      // Escenario de prueba.
      scenarioId?: string | null;
      // Voz.
      voice?: boolean;
      // Imagen subida.
      imageAssetId?: string | null;
      // Audio subido.
      audioAssetId?: string | null;
    } | null;
    // Clave ausente o inválida.
    if (!body || !body.idempotencyKey || !IDEMPOTENCY.test(body.idempotencyKey)) {
      // 400.
      return json(
        { error: "invalid_request", message: "Falta la clave de idempotencia.", issues: [] },
        400,
      );
    }
    // Pregunta normalizada.
    const question = normalizeQuestion(body.question ?? "");
    // ¿Voz?
    const voice = body.voice === true;
    // Imagen.
    const imageAssetId = body.imageAssetId ?? null;
    // Audio.
    const audioAssetId = body.audioAssetId ?? null;
    // ¿Hay medios?
    const hasMedia = voice || imageAssetId !== null || audioAssetId !== null;
    // Sin pregunta ni adjuntos, o demasiado larga.
    if (
      (question.length === 0 && !imageAssetId && !audioAssetId) ||
      question.length > RESEARCH_LIMITS.maxQuestionChars
    ) {
      // 400.
      return json(
        { error: "invalid_request", message: "La pregunta no es válida.", issues: [] },
        400,
      );
    }
    // Escenario validado.
    const scenario = body.scenarioId ? researchScenarioSchema.safeParse(body.scenarioId) : null;
    // Inválido.
    if (body.scenarioId && !scenario?.success) {
      // 400.
      return json({ error: "invalid_request", message: "El guion no es válido.", issues: [] }, 400);
    }
    // En real no hay guiones.
    if (real && body.scenarioId) {
      // 409.
      return json(
        { error: "invalid_request", message: "El modo real no usa guiones.", issues: [] },
        409,
      );
    }
    // Capacidades de medios que faltan.
    const missingMedia = mediaMissing(context.env, {
      image: imageAssetId !== null,
      audio: audioAssetId !== null,
      voice,
    });
    // Falta alguna.
    if (missingMedia.length > 0) {
      // 409.
      return json(
        {
          error: "configuration",
          message: "Falta una capacidad de medios. No se usa un guion en su lugar.",
          missing: missingMedia,
        },
        409,
      );
    }
    // Imagen del propietario.
    const imageAsset = imageAssetId ? await assetById(database, owner.id, imageAssetId) : null;
    // Audio del propietario.
    const audioAsset = audioAssetId ? await assetById(database, owner.id, audioAssetId) : null;
    // Adjunto ajeno, de otro papel o inexistente.
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
      // 409.
      return json(
        {
          error: "invalid_request",
          message: "El adjunto no pertenece a esta conversación o ya está usado.",
          issues: [],
        },
        409,
      );
    }
    // Turnos previos.
    const history = await memoryTurns(database, owner.id, conversation.id);
    // Pregunta con memoria.
    const contextual = contextualize(history, question);
    // Medios del trabajo.
    const mediaBinding = hasMedia
      ? // Con adjuntos: voz pedida y referencias (id y hash) a la imagen y al audio. Sin adjuntos:
        // null.
        {
          voice,
          image: imageAsset ? { id: imageAsset.id, hash: imageAsset.content_hash } : null,
          // La duración del audio se usa para reservar el coste de la transcripción.
          audio: audioAsset
            ? {
                id: audioAsset.id,
                hash: audioAsset.content_hash,
                durationMs: audioAsset.duration_ms ?? 0,
              }
            : null,
        }
      : null;
    // Huella de la petición: igual pregunta y medios dan la misma huella.
    const fingerprint = await fingerprintOf(
      // La huella cubre pregunta, guion y adjuntos: reenviar lo mismo da la misma huella.
      mediaBinding
        ? {
            question,
            scenarioId: scenario?.success ? scenario.data : null,
            voice,
            image: mediaBinding.image,
            audio: mediaBinding.audio
              ? { id: mediaBinding.audio.id, hash: mediaBinding.audio.hash }
              : null,
          }
        : // Sin adjuntos la huella conserva la forma de la fase 2.
          {
            question,
            scenarioId: scenario?.success ? scenario.data : null,
          },
    );
    // Reserva en el peor caso.
    const hold = holdForJob(prices, {
      image: imageAsset !== null,
      audioDurationMs: audioAsset?.duration_ms ?? null,
      voice,
    });
    // No cabe.
    if (hold === null) {
      // 402.
      return json(
        {
          error: "configuration",
          message: "La reserva de medios no cabe en el tope del trabajo.",
          missing: ["RESEARCH_JOB_LIMIT_USD"],
        },
        402,
      );
    }
    // Tarifas del trabajo.
    const jobPrices = { ...prices, holdMicros: hold };
    // Admite el trabajo en la base.
    const admitted = await admitJob(database, {
      // Dueño, conversación y clave de idempotencia del navegador.
      ownerId: owner.id,
      conversationId: conversation.id,
      idempotencyKey: body.idempotencyKey,
      // Huella y preguntas (original y con memoria).
      fingerprint,
      originalQuestion: contextual.original,
      contextualized: contextual.contextualized,
      scenarioId: scenario?.success ? scenario.data : null,
      // Corpus, tarifas congeladas con la reserva inicial y fecha.
      corpusVersion,
      prices: jobPrices,
      now: Date.now(),
      // Plazos: total del trabajo y máximo en cola.
      deadlineMs: RESEARCH_LIMITS.deadlineMs,
      queueMs: RESEARCH_QUEUE_MS,
      // Adjuntos vinculados al trabajo.
      media: mediaBinding,
    });
    // Rechazado.
    if (!admitted.ok) {
      // Estado HTTP.
      const status =
        admitted.reason === "fingerprint" ? 409 : admitted.reason === "budget" ? 402 : 409;
      // Mensaje según el motivo.
      return json(
        // «configuration»: el cliente puede leer el motivo y mostrarlo.
        {
          error: "configuration",
          // Mensaje en español según el motivo del rechazo.
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
          // Si fue el presupuesto, indica qué variable lo limita.
          missing: admitted.reason === "budget" ? ["RESEARCH_BUDGET_USD"] : [],
        },
        status,
      );
    }
    // Trabajo.
    let job = admitted.job;
    // Workflow aún no creado.
    if (job.dispatch_state !== "created") {
      // Crea el Workflow.
      const dispatch = await ensureWorkflow(database, workflow, owner.id, job.id);
      // Evento.
      await appendEvent(
        database,
        job.id,
        "dispatch",
        dispatch === "created" ? "Trabajo encolado." : "El arranque del flujo no está confirmado.",
        Date.now(),
      );
      // Relee el trabajo.
      job = (await getJob(database, owner.id, job.id)) ?? job;
      // Creación no confirmada.
      if (dispatch === "unconfirmed") {
        // 202 en atención.
        return json(
          // No se sabe si el Workflow se creó: el trabajo queda en atención para revisarlo.
          {
            jobId: job.id,
            conversationId: conversation.id,
            execution: "attention",
            dispatch: "unconfirmed",
          },
          // 202 Accepted: la petición se aceptó y el trabajo sigue en segundo plano.
          202,
          owner.setCookie,
        );
      }
    }
    // 202 con el trabajo.
    return json(
      // Ids que el navegador usa para sondear el estado.
      {
        jobId: job.id,
        conversationId: conversation.id,
        runId: job.run_id,
        // Estado de ejecución, si se creó ahora o ya existía, y estado del lanzamiento.
        execution: job.execution_status,
        created: admitted.created,
        dispatch: job.dispatch_state,
      },
      // La cookie del propietario se renueva si hace falta.
      202,
      owner.setCookie,
    );
  });

  // GET /jobs/:id: estado, eventos y operaciones.
  routes.get("/jobs/:id", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Falta.
    if (!database) {
      // 409.
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    // Trabajo.
    const job = await getJob(database, owner.id, context.req.param("id"));
    // No existe.
    if (!job || !UUID.test(job.id)) {
      // 404.
      return json({ error: "configuration", message: "El trabajo no existe.", missing: [] }, 404);
    }
    // Eventos posteriores a este número.
    const after = Number(context.req.query("after") ?? "0");
    // Eventos.
    const events = await listEvents(database, owner.id, job.id, Number.isFinite(after) ? after : 0);
    // Operaciones.
    const operations = await listOperations(database, job.id);
    // Estado, eventos y operaciones.
    return json({
      // Identidad del trabajo.
      jobId: job.id,
      conversationId: job.conversation_id,
      runId: job.run_id,
      // Estado, resultado, motivo de atención y progreso.
      execution: job.execution_status,
      reportOutcome: job.report_outcome,
      attention: job.attention_reason,
      progress: job.progress_text,
      // Plazo, cancelación pedida y estado del lanzamiento.
      deadlineAt: job.deadline_at,
      cancelRequested: job.cancel_requested === 1,
      dispatch: job.dispatch_state,
      // Eventos nuevos y operaciones (solo tipo y estado, sin resultados ni costes).
      events,
      operations: operations.map((operation) => ({
        kind: operation.kind,
        state: operation.state,
      })),
    });
  });

  // GET /jobs/:id/result: informe y resumen guardados.
  routes.get("/jobs/:id/result", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Falta.
    if (!database) {
      // 409.
      return json(
        { error: "configuration", message: "Falta la base.", missing: ["RESEARCH_DB"] },
        409,
      );
    }
    // Trabajo.
    const job = await getJob(database, owner.id, context.req.param("id"));
    // Sin resultado todavía.
    if (!job?.result_json) {
      // 404.
      return json(
        { error: "configuration", message: "Todavía no hay resultado.", missing: [] },
        404,
      );
    }
    // Resultado presentado.
    const presented = await presentResearchResult(database, owner.id, job.id, job.result_json);
    // Inválido.
    if (presented === null) {
      // 409.
      return json(
        { error: "configuration", message: "El resultado guardado no es válido.", missing: [] },
        409,
      );
    }
    // Resultado.
    return json(presented);
  });

  // POST /jobs/:id/cancel: cancela el trabajo y su Workflow.
  routes.post("/jobs/:id/cancel", async (context) => {
    // Protección.
    const blocked = await guardMutation(context.req.raw, context.env);
    // Bloqueada.
    if (blocked) {
      // Se devuelve.
      return blocked;
    }
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Workflow.
    const workflow = workflowOf(context.env);
    // Falta algo.
    if (!database || !workflow) {
      // 409.
      return json({ error: "configuration", message: "Falta el ejecutor.", missing: [] }, 409);
    }
    // Cancela en la base.
    const job = await cancelJob(database, owner.id, context.req.param("id"), Date.now());
    // No existe.
    if (!job) {
      // 404.
      return json({ error: "configuration", message: "El trabajo no existe.", missing: [] }, 404);
    }
    // Detiene el Workflow.
    await stopWorkflow(workflow, job.id);
    // Estado tras cancelar.
    return json({
      jobId: job.id,
      execution: job.execution_status,
      reportOutcome: job.report_outcome,
      unknownMicros: job.unknown_micros,
    });
  });

  // POST /jobs/:id/recover: reanuda un trabajo sin reenviar llamadas ambiguas.
  routes.post("/jobs/:id/recover", async (context) => {
    // Protección.
    const blocked = await guardMutation(context.req.raw, context.env);
    // Bloqueada.
    if (blocked) {
      // Se devuelve.
      return blocked;
    }
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Workflow.
    const workflow = workflowOf(context.env);
    // Falta algo.
    if (!database || !workflow) {
      // 409.
      return json({ error: "configuration", message: "Falta el ejecutor.", missing: [] }, 409);
    }
    // Id.
    const jobId = context.req.param("id");
    // Trabajo.
    const job = await getJob(database, owner.id, jobId);
    // No existe.
    if (!job) {
      // 404.
      return json({ error: "configuration", message: "El trabajo no existe.", missing: [] }, 404);
    }
    // Operaciones.
    const operations = await listOperations(database, job.id);
    // ¿Alguna desconocida?
    const unknown = operations.some((operation) => operation.state === "unknown");
    // ¿Alguna enviada?
    const dispatched = operations.some((operation) => operation.state === "dispatched");
    // Desconocida.
    if (unknown) {
      // 409: requiere reconciliación.
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
    // Enviada.
    if (dispatched) {
      // ¿Sigue vivo el Workflow?
      const activity = await workflowActivity(workflow, job.id);
      // Inactivo.
      if (activity === "inactive") {
        // La enviada pasa a desconocida.
        await promoteDispatched(database, owner.id, job.id);
        // 409.
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
      // Activo: 409 sin tocar la operación.
      return json(
        // 409: no se toca una operación mientras otro ejecutor podría estar terminándola.
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
    // Atención recuperable.
    if (job.execution_status === "attention" && job.attention_reason === "recoverable") {
      // Vuelve a running.
      const resumed = await resumeRecoverable(database, owner.id, job.id);
      // No se pudo.
      if (!resumed) {
        // 409.
        return json(
          { error: "configuration", message: "El trabajo ya no se puede reanudar.", missing: [] },
          409,
        );
      }
      // Reinicia el Workflow.
      let restarted = await restartWorkflow(workflow, job.id);
      // No se pudo.
      if (!restarted) {
        // Lo crea de nuevo.
        const dispatch = await ensureWorkflow(database, workflow, owner.id, job.id);
        // ¿Se creó?
        restarted = dispatch === "created";
      }
      // 202 o 409.
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
    // Atención no recuperable.
    if (job.execution_status === "attention") {
      // 409.
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
    // Workflow sin crear.
    if (job.dispatch_state !== "created") {
      // Lo crea.
      const dispatch = await ensureWorkflow(database, workflow, owner.id, job.id);
      // 202 o 409.
      return json(
        { jobId: job.id, dispatch, execution: job.execution_status },
        dispatch === "created" ? 202 : 409,
      );
    }
    // En curso o en cola.
    if (job.execution_status === "running" || job.execution_status === "queued") {
      // Reinicia el Workflow.
      const restarted = await restartWorkflow(workflow, job.id);
      // 202 o 409.
      return json(
        { jobId: job.id, restarted, execution: job.execution_status },
        restarted ? 202 : 409,
      );
    }
    // Terminado: estado.
    return json({
      jobId: job.id,
      execution: job.execution_status,
      reportOutcome: job.report_outcome,
    });
  });

  // GET /budget: estado de la cuenta de gasto.
  routes.get("/budget", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Tarifas.
    const prices = pricesFrom(context.env);
    // Falta algo.
    if (!database || !prices) {
      // 409.
      return json(
        {
          error: "configuration",
          message: "Falta el presupuesto.",
          missing: ["RESEARCH_BUDGET_USD"],
        },
        409,
      );
    }
    // Prepara las tablas.
    await ensureResearchSchema(database, prices.budgetMicros);
    // Cuenta.
    const account = await readAccount(database);
    // No existe.
    if (!account) {
      // 409.
      return json(
        { error: "configuration", message: "No hay cuenta de investigación.", missing: [] },
        409,
      );
    }
    // ¿Hay cargos desconocidos?
    const open = account.unknown_micros > 0;
    // Importes como texto fijo.
    return json({
      // Importes en texto con seis decimales para no perder precisión.
      currency: "USD",
      budget: formatMicros(account.budget_micros),
      reserved: formatMicros(account.reserved_micros),
      unknown: formatMicros(account.unknown_micros),
      consumed: formatMicros(account.consumed_micros),
      // Un total solo está completo si no hay importes desconocidos.
      totalComplete: !open,
      // Nota honesta sobre qué significa cada cifra.
      note: open
        ? "Hay cargos desconocidos o sin precio. No forman un total en USD y no se liberan."
        : "Reservado es un tope. Consumido es lo ya asentado. Desconocido no es cero.",
    });
  });

  // POST /conversations/:id/media: sube una imagen o un audio.
  routes.post("/conversations/:id/media", async (context) => {
    // Protección.
    const blocked = await guardMutation(context.req.raw, context.env);
    // Bloqueada.
    if (blocked) return blocked;
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) return owner;
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Bucket.
    const bucket = asMediaBucket(context.env.RESEARCH_MEDIA);
    // Tarifas.
    const prices = pricesFrom(context.env);
    // Falta algo.
    if (!database || !prices || !bucket) {
      // 409.
      return json(
        {
          error: "configuration",
          message: "Falta el almacén de medios.",
          missing: ["RESEARCH_MEDIA"],
        },
        409,
      );
    }
    // Prepara las tablas.
    await ensureResearchSchema(database, prices.budgetMicros);
    // Conversación del propietario.
    const conversation = await getConversation(database, owner.id, context.req.param("id"));
    // No existe.
    if (!conversation) {
      // 404.
      return json(
        { error: "configuration", message: "La conversación no existe.", missing: [] },
        404,
      );
    }
    // Clave de idempotencia.
    const key = context.req.header("x-idempotency-key") ?? "";
    // Inválida.
    if (!IDEMPOTENCY.test(key)) {
      // 400.
      return json(
        { error: "invalid_request", message: "Falta la clave de idempotencia.", issues: [] },
        400,
      );
    }
    // Lee el cuerpo con tope.
    const bytes = await readLimited(context.req.raw, MEDIA_LIMITS.maxImageBytes);
    // Demasiado grande.
    if (bytes === "too-large") {
      // 413.
      return json(
        { error: "invalid_request", message: "El archivo supera el tope.", issues: [] },
        413,
      );
    }
    // Sin cuerpo.
    if (bytes === "missing") {
      // 400.
      return json({ error: "invalid_request", message: "No llegó el archivo.", issues: [] }, 400);
    }
    // Inspecciona los bytes: el tipo real, no el declarado.
    const inspected = await inspectMedia(bytes);
    // Rechazado.
    if (!inspected.ok) {
      // 400 con el motivo.
      return json(
        {
          error: "invalid_request",
          message: `Archivo rechazado: ${inspected.reason}.`,
          issues: [],
        },
        400,
      );
    }
    // Hash.
    const hash = await sha256Bytes(bytes);
    // Subida previa con la misma clave.
    const existing = await assetByIdempotency(database, owner.id, conversation.id, key);
    // Existe.
    if (existing) {
      // Otros bytes.
      if (existing.content_hash !== hash) {
        // 409.
        return json(
          { error: "invalid_request", message: "Esa clave ya se usó con otros bytes.", issues: [] },
          409,
        );
      }
      // Misma subida.
      return json(publicAsset(existing), 200, owner.setCookie);
    }
    // Id nuevo.
    const id = crypto.randomUUID();
    // Clave en R2.
    const objectKey = `research/${owner.id}/${conversation.id}/${id}`;
    // Guarda el objeto.
    await bucket.put(objectKey, bytes, { httpMetadata: { contentType: inspected.facts.mime } });
    // Fila del archivo.
    const row = {
      // Fila del archivo con los datos medidos en el servidor, no los que declara el navegador.
      id,
      owner_id: owner.id,
      conversation_id: conversation.id,
      // Papel, clave de R2, hash, tipo real y tamaño.
      role: inspected.facts.role,
      object_key: objectKey,
      content_hash: hash,
      mime: inspected.facts.mime,
      byte_size: bytes.byteLength,
      // Dimensiones solo para imagen.
      width: inspected.facts.role === "image" ? inspected.facts.width : null,
      height: inspected.facts.role === "image" ? inspected.facts.height : null,
      // Datos de audio solo para audio.
      duration_ms: inspected.facts.role === "audio" ? inspected.facts.durationMs : null,
      sample_rate: inspected.facts.role === "audio" ? inspected.facts.sampleRate : null,
      channels: inspected.facts.role === "audio" ? inspected.facts.channels : null,
      bit_depth: inspected.facts.role === "audio" ? inspected.facts.bitDepth : null,
      // «admitted»: validado y guardado, pendiente de leer o transcribir.
      status: "admitted",
      // Aún sin texto extraído ni trabajo asociado.
      extracted_text: null,
      detail: null,
      job_id: null,
      // Clave de idempotencia de la subida y fecha.
      idempotency_key: key,
      created_at: Date.now(),
    };
    // Guarda la fila; si falla, borra el objeto.
    try {
      // INSERT.
      await insertAsset(database, row);
    } catch {
      // Borra el objeto.
      await bucket.delete(objectKey);
      // ¿Otra petición ganó?
      const raced = await assetByIdempotency(database, owner.id, conversation.id, key);
      // Mismos bytes: la suya.
      if (raced?.content_hash === hash) return json(publicAsset(raced), 200, owner.setCookie);
      // 409.
      return json(
        { error: "invalid_request", message: "No se pudo guardar el archivo.", issues: [] },
        409,
      );
    }
    // 201.
    return json(publicAsset(row), 201, owner.setCookie);
  });

  // GET o HEAD /media/:id: descarga o reproduce un medio propio, con rangos.
  routes.on(["GET", "HEAD"], "/media/:id", async (context) => {
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) return owner;
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Bucket.
    const bucket = asMediaBucket(context.env.RESEARCH_MEDIA);
    // Falta algo.
    if (!database || !bucket) {
      // 409.
      return json(
        { error: "configuration", message: "Falta el almacén de medios.", missing: [] },
        409,
      );
    }
    // Fila del propietario.
    const asset = await assetById(database, owner.id, context.req.param("id"));
    // No existe.
    if (!asset) {
      // 404.
      return json({ error: "configuration", message: "El archivo no existe.", missing: [] }, 404);
    }
    // Metadatos del objeto.
    const head = await bucket.head(asset.object_key);
    // No está en R2.
    if (!head) {
      // 404.
      return json(
        { error: "configuration", message: "El archivo no está en el almacén.", missing: [] },
        404,
      );
    }
    // Nombre seguro.
    const safeName = mediaDownloadName(asset.role, asset.mime);
    // HEAD: solo cabeceras.
    if (context.req.method === "HEAD") {
      // Respuesta vacía.
      return new Response(null, {
        // HEAD: solo cabeceras, para que el reproductor sepa tamaño y tipo.
        status: 200,
        headers: {
          // Tipo y tamaño reales; «accept-ranges» permite pedir trozos del audio.
          "content-type": asset.mime,
          "content-length": String(head.size),
          "accept-ranges": "bytes",
          // nosniff: el navegador no adivina otro tipo. inline: se muestra, no se descarga.
          "x-content-type-options": "nosniff",
          "content-disposition": `inline; filename="${safeName}"`,
          // Privado y sin caché: solo su dueño puede verlo.
          "cache-control": "private, no-store",
        },
      });
    }
    // Rango pedido.
    const range = parseRange(context.req.header("range") ?? null, head.size);
    // Inválido.
    if (range === "invalid") {
      // 416.
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${String(head.size)}` },
      });
    }
    // Lee el objeto o el rango.
    const object = await readMediaObject(
      bucket,
      asset.object_key,
      range ? { offset: range.start, length: range.end - range.start + 1 } : undefined,
    );
    // No existe.
    if (!object) {
      // 404.
      return json(
        { error: "configuration", message: "El archivo no está en el almacén.", missing: [] },
        404,
      );
    }
    // Respuesta 200 o 206.
    return mediaResponse({
      bytes: object.body,
      mime: asset.mime,
      total: head.size,
      filename: safeName,
      range,
    });
  });

  // POST /retention: limpia checkpoints y medios huérfanos.
  routes.post("/retention", async (context) => {
    // Protección.
    const blocked = await guardMutation(context.req.raw, context.env);
    // Bloqueada.
    if (blocked) {
      // Se devuelve.
      return blocked;
    }
    // Propietario.
    const owner = await resolveOwner(context.req.raw, context.env);
    // Error.
    if (owner instanceof Response) {
      // Se devuelve.
      return owner;
    }
    // Base.
    const database = asResearchDatabase(context.env.RESEARCH_DB);
    // Falta.
    if (!database) {
      // 409.
      return json({ error: "configuration", message: "Falta la base.", missing: [] }, 409);
    }
    // Checkpoints borrados.
    const removed = await purgeCheckpoints(database, Date.now());
    // Bucket.
    const bucket = asMediaBucket(context.env.RESEARCH_MEDIA);
    // Medios borrados.
    const orphans = bucket
      ? await purgeOrphanMedia(database, bucket, Date.now(), MEDIA_LIMITS.orphanAfterMs)
      : 0;
    // Recuento.
    return json({ removed, orphans });
  });

  // Subenrutador.
  return routes;
}

// Datos públicos de un medio.
function publicAsset(row: {
  // Id.
  id: string;
  // Papel.
  role: string;
  // MIME.
  mime: string;
  // Bytes.
  byte_size: number;
  // Hash.
  content_hash: string;
  // Ancho.
  width: number | null;
  // Alto.
  height: number | null;
  // Duración.
  duration_ms: number | null;
}) {
  // Nombres en camelCase.
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

// Lee el cuerpo con tope de bytes.
async function readLimited(
  request: Request,
  max: number,
): Promise<Uint8Array | "too-large" | "missing"> {
  // Tamaño declarado.
  const header = request.headers.get("content-length");
  // Si lo hay.
  if (header !== null) {
    // Número.
    const declared = Number(header);
    // Inválido o mayor del tope.
    if (!Number.isFinite(declared) || declared < 1 || declared > max) return "too-large";
  }
  // Lector.
  const reader = request.body?.getReader();
  // Sin cuerpo.
  if (!reader) return "missing";
  // Trozos.
  const chunks: Uint8Array[] = [];
  // Total.
  let total = 0;
  // Hasta el final.
  for (;;) {
    // Siguiente.
    const next = await reader.read();
    // Fin.
    if (next.done)
      // Detiene el bucle al alcanzar la condición de parada de esta rama.
      break;
    // Suma.
    total += next.value.byteLength;
    // Supera el tope.
    if (total > max) {
      // Cancela.
      await reader.cancel();
      // Demasiado grande.
      return "too-large";
    }
    // Guarda.
    chunks.push(next.value);
  }
  // Une los trozos.
  const bytes = new Uint8Array(total);
  // Posición.
  let offset = 0;
  // Cada trozo.
  for (const chunk of chunks) {
    // Copia.
    bytes.set(chunk, offset);
    // Avanza.
    offset += chunk.byteLength;
  }
  // Bytes.
  return bytes;
}

// Tarifas desde el entorno.
function pricesFrom(env: WorkerEnv) {
  // Instantánea con presupuesto, tarifas y buscador.
  return priceSnapshot({
    // Presupuesto total y tope por trabajo (en demo, los valores de fixture).
    budgetUsd: env.RESEARCH_BUDGET_USD ?? env.RESEARCH_FIXTURE_BUDGET_USD ?? "",
    jobLimitUsd: env.RESEARCH_JOB_LIMIT_USD ?? env.RESEARCH_FIXTURE_JOB_LIMIT_USD ?? "",
    // Tarifas del modelo de investigación por millón de tokens.
    inputUsdPerMillion: env.RESEARCH_INPUT_USD_PER_MILLION ?? "",
    outputUsdPerMillion: env.RESEARCH_OUTPUT_USD_PER_MILLION ?? "",
    // Precio de búsquedas y lecturas, créditos de Firecrawl y buscador elegido.
    searchUsd: env.RESEARCH_SEARCH_USD,
    readUsd: env.RESEARCH_READ_USD,
    firecrawlUsdPerCredit: env.FIRECRAWL_USD_PER_CREDIT,
    searchProvider: env.RESEARCH_SEARCH_PROVIDER === "tavily" ? "tavily" : "firecrawl",
    // Precio por crédito de Tavily.
    tavilyUsdPerCredit: env.TAVILY_USD_PER_CREDIT,
  });
}
