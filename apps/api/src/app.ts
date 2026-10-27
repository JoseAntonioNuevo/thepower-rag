// GUÍA DE LECTURA · apps/api/src/app.ts
// Aplicación Hono de la API: /api/health describe qué capacidades están listas y /api/chat atiende
// los cuatro modos (sin RAG, RAG, CRAG e investigación). Recorrido de /api/chat: protección →
// validación del cuerpo → modo → recuperación (demo, prueba o Vectorize) → decisión → generación en streaming.
// Esquemas de petición y salud, límites y tipos del contrato.
import {
  chatRequestSchema,
  healthResponseSchema,
  issuesFrom,
  LIMITS,
  messageText,
  type Citation,
  type ErrorResponse,
  type HealthResponse,
  type RunMetadata,
} from "@thepower-rag/contracts";
// Núcleo RAG: audiencias, calendario, citas, índice de prueba, recuperación y tipos.
import {
  // Audiencias y atajo del calendario semanal.
  allowsAudience,
  isWeeklyScheduleQuestion,
  calendarOverviewId,
  calendarOverviewOutcome,
  // Citas y embedding léxico de la demo (modelo, dimensión, umbral y función).
  citationsFor,
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  // Umbral, detección de calendario y recuperación básica.
  gateScoredChunks,
  isScheduleQuestion,
  retrieveBasic,
  // Tipos de CRAG, presupuesto, fragmentos y resultado de la recuperación.
  type CragPorts,
  type AllowanceLedger,
  type IndexedChunk,
  type RetrievalOutcome,
} from "@thepower-rag/core";
// Tipo del modelo de lenguaje del AI SDK.
import type { LanguageModel } from "ai";
// Hono: enrutador HTTP ligero que funciona en Workers.
import { Hono } from "hono";
// Versiones de las dependencias para /api/health.
import { dependencyCompatibility } from "./compat";
// Respuesta HTTP del modo CRAG.
import { cragHttpResponse } from "./crag-http";
// Lectura de configuración y capacidades.
import {
  assessWorker,
  cragExecutionBudgetMs,
  durableResearchConfigured,
  mediaReadiness,
  modelTimeoutMs,
  type WorkerEnv,
} from "./env";
// Respuesta HTTP del modo investigación sin trabajo durable.
import { researchHttpResponse } from "./research-http";
// Rutas del trabajo durable de investigación.
import { researchRoutes } from "./research-routes";
// Tipo de los puertos de investigación.
import type { ResearchPorts } from "@thepower-rag/research";
// Mensaje público de error y respuestas en streaming.
import {
  PUBLIC_PROVIDER_MESSAGE,
  streamFixedCourseResponse,
  streamProviderCourseResponse,
} from "./course-stream";
// Respuesta de demo sin red.
import { offlineDemoResponse } from "./demo-stream";
// Corpus y perfil de prueba incluidos en el código.
import {
  demoChatFixture,
  fixtureContentVersion,
  fixtureCorpusVersion,
  fixtureCoverage,
} from "./fixture";
// Contexto completo del curso (modo complete).
import { readCourseContext, completeContextOutcome, CourseContextError } from "./course-context";
// Origen, Turnstile y límites de peticiones.
import { limitPublicRead, protectChat } from "./chat-protection";
// Presupuesto público por turno.
import { reservePublicTurn } from "./public-budget";
// Fábrica del modelo generador.
import { createGenerationModel } from "./model";
// Tarifa del coste mostrado.
import { generationPricing } from "./provider-cost";
// Prompts de cada modo.
import { chatPrompts, ragSystem, COMPLETE_RAG_PROMPT, completeRagSystem } from "./prompts";
// Corpus del chat: binding de su índice, si usa grupos y su nombre visible.
import { CHAT_CORPUS_LABELS, chatVectorBinding, usesCourseGroups } from "./chat-corpus";
// Vectorize, D1 y perfil del índice.
import {
  profileReady,
  queryVectorize,
  readChunk,
  readIndexProfile,
  type IndexProfileRow,
  type SqlDatabase,
  type VectorIndex,
} from "./stores";
// Embeddings con Workers AI.
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";
// Biblioteca de documentos y fragmentos de D1.
import {
  DOCUMENT_ID_PATTERN,
  corpusOptions,
  listChunks,
  listDocuments,
  type ReadDatabase,
} from "./corpus-browser";
// Pasos del RAG básico para el modo clase.
import { NO_RAG_TIMINGS, ragRetrievalSteps, type RagTimings } from "./rag-steps";

// Dependencias que los tests pueden sustituir.
export interface AppDeps {
  // Sesión de gasto.
  allowance?: AllowanceLedger;
  // Aviso de cada llamada al proveedor.
  onProviderCall?: () => void;
  // Modelo simulado.
  languageModel?: LanguageModel;
  // Fragmentos de prueba.
  chunks?: readonly IndexedChunk[];
  // Embedding de prueba.
  embed?: (text: string) => readonly number[];
  // Perfil del índice de prueba.
  profile?: IndexProfileRow | null;
  // Puertos CRAG simulados.
  cragPorts?: CragPorts;
  /** Solo pruebas: puertos de investigación inyectados. */
  researchPorts?: ResearchPorts;
}

// Error JSON sin caché con su estado HTTP.
function jsonError(body: ErrorResponse, status: 400 | 404 | 409 | 501 | 502): Response {
  // Response.json con cabecera no-store.
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Nombre del runtime para /api/health.
function runtimeLabel(): string {
  // userAgent de workerd o de Node.
  return navigator.userAgent || "runtime-desconocido";
}

// Historial en el formato del modelo: papel y texto, sin mensajes vacíos.
function modelMessages(
  messages: { role: "user" | "assistant"; parts: { type: string; text?: string }[] }[],
) {
  // Une las partes de texto y quita los vacíos.
  return messages
    .map((message) => ({ role: message.role, content: messageText(message as never) }))
    .filter((message) => message.content.trim().length > 0);
}

// Respuesta de plantilla de la demo: cita cada fragmento recuperado.
function fixtureAnswer(evidence: readonly IndexedChunk[]): string {
  // Una línea por fragmento con su cita.
  const lines = evidence.map(
    (chunk) =>
      `Según [cite:${chunk.chunkId}] (${chunk.section}): ${chunk.text.replace(/\s+/g, " ").slice(0, 280)}`,
  );
  // Texto completo.
  return `Respuesta de la canalización local de prueba. No es un modelo ni un índice de Vectorize.\n${lines.join("\n")}`;
}

// Respuesta cuando falta el grupo en una pregunta de calendario.
const CLARIFY =
  "La pregunta parece de calendario. Elige el grupo con clases los lunes y miércoles o el grupo con clases los martes y jueves. La selección general no muestra los dos calendarios.";
// Respuesta cuando no hay contexto útil.
const REFUSE =
  "No hay contexto utilizable en el corpus seleccionado. No consta en los documentos recuperados y no se ha llamado a un modelo.";

// Metadatos de una ejecución.
function metadata(
  origin: RunMetadata["origin"],
  modelId: string | null,
  promptId: string,
  completion: RunMetadata["completion"],
): RunMetadata {
  // Id nuevo, origen, modelo, prompt y estado; sin consumo ni coste.
  return {
    runId: crypto.randomUUID(),
    origin,
    modelId,
    promptId,
    completion,
    usage: null,
    cost: null,
  };
}

// Crea la aplicación con dependencias opcionales.
export function createApp(deps: AppDeps = {}) {
  // App Hono tipada con las variables del Worker.
  const app = new Hono<{ Bindings: WorkerEnv }>();
  // Monta las rutas de investigación durable.
  app.route("/api/research", researchRoutes());

  // GET /api/health: estado de la configuración sin llamar a proveedores.
  // Biblioteca: corpus disponibles y documentos del pedido, leídos de D1 en el momento.
  app.get("/api/corpus", async (context) => {
    // Cupo por red en el perfil público.
    const limited = await limitPublicRead(context.req.raw, context.env);
    if (limited) return limited;
    // Demo o real.
    const demo = assessWorker(context.env).execution === "demo";
    // Corpus disponibles y el pedido (por defecto, el del chat).
    const options = corpusOptions(context.env, demo);
    const requested = context.req.query("corpus");
    const option =
      requested === undefined ? options[0] : options.find((item) => item.key === requested);
    // Corpus desconocido o sin versión.
    if (option === undefined) {
      return jsonError(
        { error: "configuration", message: "Ese corpus no está disponible.", missing: [] },
        404,
      );
    }
    // En real hace falta D1.
    const database = demo ? null : (context.env.DB as ReadDatabase | undefined);
    if (database === undefined) {
      return jsonError(
        { error: "configuration", message: "Falta la base de datos.", missing: ["DB"] },
        409,
      );
    }
    // Lectura sin caché: es la base de datos en este momento.
    try {
      return Response.json(await listDocuments({ option, options, database }), {
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return jsonError({ error: "provider", message: "No se pudo leer la base de datos." }, 502);
    }
  });

  // Biblioteca: fragmentos de un documento, en orden.
  app.get("/api/corpus/:corpus/:documentId", async (context) => {
    // Cupo por red en el perfil público.
    const limited = await limitPublicRead(context.req.raw, context.env);
    if (limited) return limited;
    // Id de documento con el formato de las fichas.
    const documentId = context.req.param("documentId");
    if (!DOCUMENT_ID_PATTERN.test(documentId)) {
      return jsonError(
        {
          error: "invalid_request",
          message: "Id de documento no válido.",
          issues: [{ path: "documentId", message: "Solo letras minúsculas, números y guiones." }],
        },
        400,
      );
    }
    // Demo o real, y el corpus pedido.
    const demo = assessWorker(context.env).execution === "demo";
    const option = corpusOptions(context.env, demo).find(
      (item) => item.key === context.req.param("corpus"),
    );
    if (option === undefined) {
      return jsonError(
        { error: "configuration", message: "Ese corpus no está disponible.", missing: [] },
        404,
      );
    }
    // En real hace falta D1.
    const database = demo ? null : (context.env.DB as ReadDatabase | undefined);
    if (database === undefined) {
      return jsonError(
        { error: "configuration", message: "Falta la base de datos.", missing: ["DB"] },
        409,
      );
    }
    // Lectura sin caché.
    try {
      const body = await listChunks({ option, documentId, database });
      // Documento inexistente en ese corpus.
      if (body === null) {
        return jsonError(
          { error: "configuration", message: "Ese documento no está en el corpus.", missing: [] },
          404,
        );
      }
      return Response.json(body, { headers: { "cache-control": "no-store" } });
    } catch {
      return jsonError({ error: "provider", message: "No se pudo leer la base de datos." }, 502);
    }
  });

  app.get("/api/health", async (context) => {
    // Capacidades según el entorno.
    const assessment = assessWorker(context.env);
    // Versiones de dependencias.
    const compatibility = await dependencyCompatibility();
    // ¿Corpus de demo?
    const demoCorpus = assessment.execution === "demo";
    // Corpus preparado de la demo del chat (el del curso o el de la tienda).
    const demoFixture = demoChatFixture(assessment.chatCorpus ?? "course");
    // Versión del corpus incluido.
    const bundled = fixtureCorpusVersion();
    // Corpus que describe la salud: el del curso si está configurado; si no, el del chat.
    const described = assessment.retrieval ?? assessment.chatRetrieval;
    // Versión configurada.
    const configuredVersion = described?.corpusVersion ?? null;
    // ¿Se conoce el contenido del corpus?
    const sourceKnown = demoCorpus || configuredVersion === bundled;
    // Cobertura desconocida.
    const unknownCoverage = {
      curriculum: "unknown" as const,
      calendarLx: "unknown" as const,
      calendarMj: "unknown" as const,
      exerciseDetail: "unknown" as const,
      remote: "not-verified" as const,
    };
    // Cuerpo de la respuesta.
    const body: HealthResponse = {
      // Nombre, fase, modo de ejecución y runtime.
      app: "thepower-rag",
      phase: "crag",
      execution: assessment.execution,
      runtime: runtimeLabel(),
      // Estado de cada capacidad: sin RAG, RAG, CRAG e investigación.
      capabilities: assessment.capabilities,
      // Corpus: en demo, el preparado del chat; en real, la versión y el perfil configurados.
      corpus: {
        version: demoCorpus ? demoFixture.version : configuredVersion,
        contentVersion: demoCorpus
          ? demoFixture.contentVersion
          : sourceKnown
            ? fixtureContentVersion()
            : null,
        profileId: demoCorpus ? demoFixture.profile.id : (described?.indexProfile ?? null),
        profileFamily: demoCorpus ? "fixture" : described ? "workers-ai" : "unknown",
        coverage: demoCorpus
          ? demoFixture.coverage
          : sourceKnown
            ? fixtureCoverage()
            : unknownCoverage,
        // Modelo de embeddings y dimensión que usa cada modo.
        embedding: demoCorpus
          ? FIXTURE_EMBEDDING_MODEL
          : (described?.embeddingModel ?? "sin configurar"),
        dimensions: demoCorpus ? FIXTURE_DIMENSIONS : (described?.dimensions ?? null),
        remoteRevision: null,
      },
      // Compatibilidad de dependencias, investigación durable y medios de S12.
      compatibility,
      durableResearch: durableResearchConfigured(context.env),
      // Lectura de configuración para verificar un despliegue sin invocar modelos ni revelar claves.
      modelConfiguration: {
        provider: assessment.generation?.provider ?? null,
        generator: assessment.generation?.modelId ?? null,
        evaluator: context.env.EVALUATOR_MODEL_ID?.trim() || null,
        research: context.env.RESEARCH_MODEL_ID?.trim() || null,
        cragExecutionBudgetMs: cragExecutionBudgetMs(context.env),
        generationTimeoutMs: assessment.generation?.timeoutMs ?? null,
        ragContextMode: demoCorpus
          ? "fixture"
          : context.env.RAG_CONTEXT_MODE === "complete"
            ? "complete"
            : "semantic",
        retrievalMinScore: assessment.chatRetrieval?.minScore ?? null,
      },
      // Corpus del chat: el de CHAT_CORPUS; en demo con su corpus preparado y en real con su perfil.
      ...(assessment.chatCorpus === null
        ? {}
        : {
            chatCorpus: {
              id: assessment.chatCorpus,
              label: CHAT_CORPUS_LABELS[assessment.chatCorpus],
              version: demoCorpus
                ? demoFixture.version
                : (assessment.chatRetrieval?.corpusVersion ?? null),
              profileId: demoCorpus
                ? demoFixture.profile.id
                : (assessment.chatRetrieval?.indexProfile ?? null),
              minScore: demoCorpus ? null : (assessment.chatRetrieval?.minScore ?? null),
              groups: usesCourseGroups(assessment.chatCorpus),
              remote: "not-verified" as const,
            },
          }),
      media: mediaReadiness(context.env),
    };
    // En real con D1, comprueba el perfil del índice.
    if (!demoCorpus && described && context.env.DB) {
      // Fallo de lectura: no se marca como verificado.
      try {
        // Perfil.
        const row = await readIndexProfile(
          context.env.DB as SqlDatabase,
          described.indexProfile,
          described.corpusVersion,
        );
        // Si coincide, índice verificado.
        if (profileReady(row, described).ok) body.corpus.coverage.remote = "index-verified";
      } catch {
        /* Declarar el binding no demuestra conexión: sin lectura correcta no se marca verificado. */
      }
    }
    // Perfil del corpus del chat: el mismo del curso o el de la tienda, leído también en D1.
    if (!demoCorpus && body.chatCorpus && assessment.chatRetrieval && context.env.DB) {
      // Si es el mismo corpus que el de la lectura anterior, no se vuelve a leer.
      if (described === assessment.chatRetrieval) {
        // Copia el resultado.
        body.chatCorpus.remote = body.corpus.coverage.remote;
      } else {
        // Fallo de lectura: no se marca como verificado.
        try {
          // Perfil de la tienda.
          const row = await readIndexProfile(
            context.env.DB as SqlDatabase,
            assessment.chatRetrieval.indexProfile,
            assessment.chatRetrieval.corpusVersion,
          );
          // Si coincide, índice de la tienda verificado.
          if (profileReady(row, assessment.chatRetrieval).ok)
            body.chatCorpus.remote = "index-verified";
        } catch {
          /* Sin lectura correcta no se marca verificado. */
        }
      }
    }
    // Respuesta validada con el esquema y sin caché.
    return Response.json(healthResponseSchema.parse(body), {
      headers: { "cache-control": "no-store" },
    });
  });

  // POST /api/chat: un turno de conversación.
  app.post("/api/chat", async (context) => {
    // Origen, Turnstile y límites; si falla, devuelve el rechazo.
    const rejected = await protectChat(context.req.raw, context.env ?? {});
    // Rechazada.
    if (rejected) return rejected;
    // Cuerpo como texto.
    const raw = await context.req.text();
    // Demasiado grande.
    if (raw.length > LIMITS.maxBodyChars) {
      // 400.
      return jsonError(
        {
          error: "invalid_request",
          message: "El cuerpo supera el límite de la solicitud.",
          issues: [{ path: "", message: `Máximo ${String(LIMITS.maxBodyChars)} caracteres.` }],
        },
        400,
      );
    }
    // JSON del cuerpo.
    let payload: unknown;
    // Parseo protegido.
    try {
      // JSON.
      payload = JSON.parse(raw) as unknown;
    } catch {
      // No es JSON: 400.
      return jsonError(
        { error: "invalid_request", message: "El cuerpo no es JSON válido.", issues: [] },
        400,
      );
    }
    // Valida contra el contrato.
    const parsed = chatRequestSchema.safeParse(payload);
    // Inválido.
    if (!parsed.success) {
      // 400 con los problemas.
      return jsonError(
        {
          error: "invalid_request",
          message: "La solicitud no cumple el contrato.",
          issues: issuesFrom(parsed.error),
        },
        400,
      );
    }
    // Capacidades.
    const assessment = assessWorker(context.env);
    // Corpus del chat (un CHAT_CORPUS inválido ya bloquea las etapas en el diagnóstico).
    const chatCorpus = assessment.chatCorpus ?? "course";
    // Instrucciones de cada etapa para ese corpus.
    const prompts = chatPrompts(chatCorpus);
    // ¿Tiene grupos y calendario? La tienda no pide grupo ni usa el atajo de horario.
    const groups = usesCourseGroups(chatCorpus);
    // APP_MODE inválido.
    if (assessment.execution === "misconfigured") {
      // 409.
      return jsonError(
        {
          error: "configuration",
          message: assessment.message ?? "APP_MODE no es válido.",
          missing: ["APP_MODE"],
        },
        409,
      );
    }
    // Texto del último mensaje.
    const question = messageText(
      parsed.data.messages.at(-1) ?? { id: "", role: "user", parts: [] },
    );
    // Historial para el modelo.
    const history = modelMessages(parsed.data.messages);
    // Señal de cancelación de la petición.
    const signal = context.req.raw.signal;

    // La investigación va antes del presupuesto público: no consume la reserva
    // del RAG. En real queda bloqueada sin su propia autorización y contabilidad.
    if (parsed.data.mode === "research") {
      // Con Workflow configurado, este endpoint no investiga.
      if (durableResearchConfigured(context.env)) {
        // 409 explicando dónde se crea el trabajo.
        return jsonError(
          {
            error: "configuration",
            message:
              "Esta petición no ejecuta la investigación. El trabajo durable se crea en la conversación y sigue aunque se cierre la página.",
            missing: [],
          },
          409,
        );
      }
      // Investigación en primer plano (demo o prueba).
      const research = await researchHttpResponse({
        assessment,
        request: parsed.data,
        question,
        signal,
        deps: { researchPorts: deps.researchPorts },
      });
      // Si no es una respuesta, es un bloqueo de configuración.
      if (!(research instanceof Response)) {
        // 409.
        return jsonError(
          { error: "configuration", message: research.message, missing: research.missing },
          409,
        );
      }
      // Respuesta en streaming.
      return research;
    }

    // Un plazo inválido no puede consumir una reserva pública antes de devolver el error.
    const invalidTimeouts = [
      ...(modelTimeoutMs(context.env) === null ? ["MODEL_TIMEOUT_MS"] : []),
      ...(parsed.data.mode === "crag" && cragExecutionBudgetMs(context.env) === null
        ? ["CRAG_EXECUTION_BUDGET_MS"]
        : []),
    ];
    if (assessment.execution === "real" && invalidTimeouts.length) {
      return jsonError(
        {
          error: "configuration",
          message: "Los plazos del modelo no son válidos.",
          missing: invalidTimeouts,
        },
        409,
      );
    }
    // ¿Hay presupuesto público en real?
    const publicBudget =
      assessment.execution === "real" && context.env.PUBLIC_BUDGET_USD !== undefined;
    // Reserva de presupuesto del turno o la sesión inyectada.
    const allowance = publicBudget
      ? await reservePublicTurn(context.env, parsed.data.mode)
      : deps.allowance;
    // Presupuesto agotado: 429.
    if (publicBudget && !allowance)
      return Response.json(
        {
          error: "configuration",
          message: "Se ha alcanzado el presupuesto de esta demo. Contacta con el profesor.",
          missing: ["PUBLIC_BUDGET_USD"],
        },
        { status: 429 },
      );
    // Modo CRAG.
    if (parsed.data.mode === "crag") {
      // Respuesta CRAG.
      const crag = await cragHttpResponse({
        env: context.env,
        assessment,
        request: parsed.data,
        question,
        history,
        signal,
        deps,
        allowance: allowance ?? undefined,
      });
      // Bloqueo de configuración.
      if (!(crag instanceof Response)) {
        // 409.
        return jsonError(
          { error: "configuration", message: crag.message, missing: crag.missing },
          409,
        );
      }
      // Respuesta.
      return crag;
    }

    // Modo.
    const mode = parsed.data.mode;
    // Capacidad del modo.
    const capability = assessment.capabilities[mode];
    // En real sin capacidad: 409, sin volver a la demo.
    if (assessment.execution === "real" && capability.status === "blocked") {
      // 409.
      return jsonError(
        {
          error: "configuration",
          message: "La capacidad pedida no está configurada. No hay vuelta a la demostración.",
          missing: capability.missing,
        },
        409,
      );
    }

    // Modo sin RAG.
    if (parsed.data.mode === "sin-rag") {
      // Demo.
      if (assessment.execution === "demo") {
        // Respuesta de demo.
        return offlineDemoResponse(signal);
      }
      // Ajustes de generación.
      const settings = assessment.generation;
      // Sin ajustes.
      if (settings === null) {
        // 409.
        return jsonError(
          { error: "configuration", message: "Falta la generación.", missing: capability.missing },
          409,
        );
      }
      // try/catch: un fallo al crear el modelo da 502.
      try {
        // Modelo inyectado o el del proveedor configurado.
        const model = deps.languageModel ?? createGenerationModel(settings, deps.onProviderCall);
        // Generación en streaming sin fuentes ni citas.
        return streamProviderCourseResponse({
          // Modelo, instrucciones sin RAG e historial completo.
          model,
          system: prompts.sinRag.text,
          messages: history,
          // Metadatos (proveedor, modelo, prompt) y tarifas para el coste mostrado.
          metadata: metadata("provider", settings.modelId, prompts.sinRag.id, "complete"),
          costPricing: generationPricing(settings),
          timeoutMs: settings.timeoutMs,
          // Sin RAG no hay fuentes, así que no se validan citas.
          validateCitations: false,
          // Traza mínima: deja claro que no hubo recuperación.
          trace: {
            // Pregunta sin reescritura y sin corpus ni embeddings.
            query: question,
            queryRewrite: "pending",
            corpusVersion: null,
            embedding: "ninguno",
            scoreMeaning: "Sin RAG no calcula puntuaciones.",
            // Sin recuperados; se respondió con generación.
            retrieved: [],
            decision: "answer",
            generation: "called",
            status: "Generación sin recuperación.",
          },
          // Sin fuentes y con la señal de cancelación.
          sources: [],
          signal,
        });
      } catch {
        // 502 con mensaje público.
        return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
      }
    }

    // Fragmentos de prueba: los inyectados o los del corpus preparado del chat.
    const chunks = deps.chunks ?? demoChatFixture(chatCorpus).chunks;
    // Embedding de prueba.
    const embed = deps.embed ?? fixtureEmbed;
    // ¿Recuperación de prueba?
    const useFixture = assessment.execution === "demo" || deps.chunks !== undefined;
    // Resultado de la recuperación.
    let outcome: RetrievalOutcome;
    // Duraciones medidas de la búsqueda real para el modo clase; la demo no mide.
    let timings: RagTimings = NO_RAG_TIMINGS;
    // Fragmentos con título y sección para nombrar los candidatos del modo clase.
    let labelChunks: readonly IndexedChunk[] = useFixture ? chunks : [];
    // Demo: índice incluido en el código.
    if (useFixture && assessment.execution === "demo") {
      // Recuperación básica con el embedding de prueba.
      outcome = retrieveBasic({
        // Pregunta, grupo y fragmentos del corpus de la demo con su embedding léxico.
        question,
        audience: parsed.data.audience,
        chunks,
        embed,
        // La tienda no tiene grupos ni aclaración de calendario.
        groups,
        // Umbral y etiqueta del índice de prueba.
        minScore: FIXTURE_MIN_SCORE,
        embeddingLabel: FIXTURE_EMBEDDING_MODEL,
        corpusVersion: chunks[0]?.corpusVersion ?? demoChatFixture(chatCorpus).version,
        // Qué significa la puntuación, para no confundirla con una probabilidad.
        scoreMeaning:
          "Coseno del índice de prueba por tokens. No es una probabilidad ni un embedding de BGE-M3.",
      });
    } else if (deps.chunks !== undefined) {
      // Fragmentos inyectados por un test.
      const retrieval = assessment.chatRetrieval;
      // Ajustes de recuperación.
      if (retrieval === null) {
        // Sin ajustes: 409.
        return jsonError(
          {
            error: "configuration",
            message: "Falta la recuperación.",
            missing: capability.missing,
          },
          409,
        );
      }
      // Calendario sin grupo: aclaración (solo en un corpus con grupos).
      if (groups && isScheduleQuestion(question) && parsed.data.audience === "program") {
        // Resultado clarify.
        outcome = {
          // Aclarar: sin evidencia y sin llamar al modelo.
          decision: "clarify",
          evidence: [],
          // Traza de la aclaración.
          trace: {
            query: question,
            queryRewrite: "pending",
            corpusVersion: retrieval.corpusVersion,
            embedding: retrieval.embeddingModel,
            scoreMeaning: "Coseno del índice inyectado en la prueba. No es Vectorize.",
            retrieved: [],
            decision: "clarify",
            generation: "skipped",
            status: "Falta el grupo para una pregunta de calendario.",
          },
        };
      } else {
        // Comprueba el perfil inyectado.
        const gate = profileReady(deps.profile ?? null, retrieval);
        // No coincide.
        if (!gate.ok) {
          // 409.
          return jsonError(
            {
              error: "configuration",
              message: "El índice configurado no está listo o no coincide con el perfil.",
              missing: gate.missing,
            },
            409,
          );
        }
        // Recuperación básica con el índice inyectado.
        outcome = retrieveBasic({
          // Recuperación con el índice que inyecta la prueba y su umbral configurado.
          question,
          audience: parsed.data.audience,
          chunks,
          embed,
          minScore: retrieval.minScore,
          embeddingLabel: retrieval.embeddingModel,
          corpusVersion: retrieval.corpusVersion,
          scoreMeaning: "Coseno del índice inyectado en la prueba. No es Vectorize.",
          // La tienda no tiene grupos ni calendario.
          groups,
        });
      }
    } else {
      // Ajustes de recuperación del chat.
      const retrieval = assessment.chatRetrieval;
      // Sin ajustes.
      if (retrieval === null) {
        // 409.
        return jsonError(
          {
            error: "configuration",
            message: "Falta la recuperación.",
            missing: capability.missing,
          },
          409,
        );
      }
      // Workers AI.
      const runner = context.env.AI as EmbeddingRunner | undefined;
      // Vectorize del corpus del chat.
      const index = context.env[chatVectorBinding(chatCorpus)] as VectorIndex | undefined;
      // D1.
      const database = context.env.DB as SqlDatabase | undefined;
      // Falta algún binding.
      if (!runner || !index || !database) {
        // 409.
        return jsonError(
          {
            error: "configuration",
            message: "Faltan bindings de recuperación.",
            missing: capability.missing,
          },
          409,
        );
      }
      // Calendario sin grupo: aclaración (solo en un corpus con grupos).
      if (groups && isScheduleQuestion(question) && parsed.data.audience === "program") {
        // Resultado clarify.
        outcome = {
          // Aclarar sin buscar en Vectorize: falta el grupo para una pregunta de horario.
          decision: "clarify",
          evidence: [],
          // Traza de la aclaración con los datos del índice real.
          trace: {
            query: question,
            queryRewrite: "pending",
            corpusVersion: retrieval.corpusVersion,
            embedding: retrieval.embeddingModel,
            scoreMeaning: "Puntuación devuelta por Vectorize. No es una probabilidad de acierto.",
            retrieved: [],
            decision: "clarify",
            generation: "skipped",
            status: "Falta el grupo para una pregunta de calendario.",
          },
        };
      } else {
        // Perfil inyectado o leído de D1.
        const row =
          deps.profile !== undefined
            ? deps.profile
            : await readIndexProfile(database, retrieval.indexProfile, retrieval.corpusVersion);
        // Comprueba el perfil.
        const gate = profileReady(row, retrieval);
        // No coincide.
        if (!gate.ok) {
          // 409.
          return jsonError(
            {
              error: "configuration",
              message: "El índice configurado no está listo o no coincide con el perfil.",
              missing: gate.missing,
            },
            409,
          );
        }
        // try/catch: errores de contexto, cancelación o proveedor.
        try {
          // Modo complete: todo el curso como contexto.
          if (context.env.RAG_CONTEXT_MODE === "complete") {
            // Lee todos los documentos de la audiencia.
            const contextChunks = await readCourseContext(
              database,
              retrieval.corpusVersion,
              parsed.data.audience,
              signal,
            );
            // Resultado con el contexto completo.
            outcome = completeContextOutcome(question, retrieval.corpusVersion, contextChunks);
          } else if (groups && isWeeklyScheduleQuestion(question)) {
            // Pregunta de calendario semanal: ficha resumen del grupo.
            const id = calendarOverviewId(parsed.data.audience, retrieval.corpusVersion);
            // Ficha leída de D1.
            const record =
              id === null ? null : await readChunk(database, retrieval.corpusVersion, id);
            // Resultado con esa ficha.
            outcome = calendarOverviewOutcome({
              question,
              audience: parsed.data.audience,
              corpusVersion: retrieval.corpusVersion,
              chunk: record ? { ...record, vector: [] } : null,
            });
          } else {
            // Inicio del embedding, para el modo clase.
            const embedStarted = Date.now();
            // RAG con Vectorize: embedding de la pregunta.
            const [vector] = await embedWithWorkersAi(
              runner,
              retrieval.embeddingModel,
              [question],
              retrieval.dimensions,
              signal,
            );
            // Sin vector: 502.
            if (vector === undefined) {
              // 502.
              return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
            }
            // Inicio de la búsqueda (Vectorize y texto en D1), para el modo clase.
            const searchStarted = Date.now();
            // Vecinos en Vectorize.
            const hits = await queryVectorize(
              index,
              {
                vector,
                audience: parsed.data.audience,
                corpusVersion: retrieval.corpusVersion,
                profileId: retrieval.indexProfile,
                limit: LIMITS.retrievalTopK,
              },
              signal,
            );
            // Fragmentos con puntuación.
            const ranked: { chunk: IndexedChunk; score: number | null }[] = [];
            // Cada resultado.
            for (const hit of hits) {
              // Texto de D1.
              const record = await readChunk(database, retrieval.corpusVersion, hit.chunkId);
              // Inexistente o de otra audiencia: se salta.
              if (record === null || !allowsAudience(record.audience, parsed.data.audience)) {
                // Siguiente.
                continue;
              }
              // Lo añade.
              ranked.push({
                chunk: { ...record, vector: [] },
                score: hit.score,
              });
            }
            // Duraciones medidas del modo clase y nombres de los vecinos leídos de D1.
            timings = {
              embedMs: searchStarted - embedStarted,
              searchMs: Date.now() - searchStarted,
            };
            labelChunks = ranked.map((item) => item.chunk);
            // Decide con el umbral mínimo.
            outcome = gateScoredChunks({
              question,
              audience: parsed.data.audience,
              corpusVersion: retrieval.corpusVersion,
              embeddingLabel: retrieval.embeddingModel,
              scoreMeaning: "Puntuación devuelta por Vectorize. No es una probabilidad de acierto.",
              minScore: retrieval.minScore,
              ranked,
            });
          }
        } catch (error) {
          // Contexto incompleto: 409 sin responder.
          if (error instanceof CourseContextError)
            return jsonError(
              {
                error: "configuration",
                message:
                  "No se pudo verificar todo el contexto del curso. No se responde con documentos incompletos.",
                missing: ["COURSE_CONTEXT"],
              },
              409,
            );
          // Cancelado: 499.
          if (error instanceof DOMException && error.name === "AbortError") {
            // Sin cuerpo.
            return new Response(null, { status: 499 });
          }
          // Otro fallo: 502.
          return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
        }
      }
    }

    // Citas de la evidencia.
    const sources: Citation[] = citationsFor(outcome.evidence);
    // Pasos de la búsqueda para el modo clase, con el umbral que aplicó esta ruta.
    const ragRetrieval = ragRetrievalSteps({
      trace: outcome.trace,
      threshold:
        assessment.execution === "demo"
          ? FIXTURE_MIN_SCORE
          : (assessment.chatRetrieval?.minScore ?? null),
      timings,
      labels: new Map(
        labelChunks.map((chunk) => [chunk.chunkId, { title: chunk.title, section: chunk.section }]),
      ),
    });
    // Sin respuesta (aclarar o rechazar).
    if (outcome.decision !== "answer") {
      // Texto fijo.
      const text = outcome.decision === "clarify" ? CLARIFY : REFUSE;
      // Origen.
      const origin = assessment.execution === "demo" ? "offline-fixture" : "pipeline";
      // Respuesta fija.
      return streamFixedCourseResponse({
        // Metadatos: origen, sin modelo, id del prompt de control y resultado.
        metadata: metadata(
          origin,
          null,
          "rag-control-v1",
          outcome.decision === "clarify" ? "clarified" : "refused",
        ),
        // Traza, fuentes (vacías) y texto de rechazo o aclaración.
        trace: outcome.trace,
        sources,
        text,
        signal,
        // El texto es nuestro, no del modelo: no se validan citas.
        validateCitations: false,
        // Pasos del modo clase: la búsqueda y el rechazo o la aclaración.
        ragSteps: { retrieval: ragRetrieval, query: question, model: null },
      });
    }

    // Demo: respuesta de plantilla.
    if (assessment.execution === "demo") {
      // Respuesta fija con citas validadas.
      return streamFixedCourseResponse({
        // Respuesta plantilla con citas reales a la evidencia recuperada.
        metadata: metadata("offline-fixture", null, "rag-fixture-v1", "complete"),
        validateCitations: true,
        // La traza deja claro que no hubo generación.
        trace: {
          ...outcome.trace,
          generation: "skipped",
          status: "Respuesta plantilla de la canalización de prueba. No hay llamada a un modelo.",
        },
        // Fuentes, texto de plantilla y señal de cancelación.
        sources,
        text: fixtureAnswer(outcome.evidence),
        signal,
        // Pasos del modo clase con la plantilla como generador.
        ragSteps: { retrieval: ragRetrieval, query: question, model: null },
      });
    }

    // Ajustes de generación.
    const settings = assessment.generation;
    // Sin ajustes.
    if (settings === null) {
      // 409.
      return jsonError(
        { error: "configuration", message: "Falta la generación.", missing: capability.missing },
        409,
      );
    }
    // try/catch: un fallo al crear el modelo da 502.
    try {
      // Modelo inyectado o el configurado.
      const model = deps.languageModel ?? createGenerationModel(settings, deps.onProviderCall);
      // Generación con la evidencia en el sistema, citas validadas y coste.
      return streamProviderCourseResponse({
        // Modelo e instrucciones: contexto completo del grupo o solo los fragmentos recuperados.
        model,
        system:
          context.env.RAG_CONTEXT_MODE === "complete"
            ? completeRagSystem(outcome.evidence, parsed.data.audience)
            : ragSystem(outcome.evidence, chatCorpus),
        // Historial de la conversación.
        messages: history,
        // Metadatos con el id del prompt usado.
        metadata: metadata(
          "provider",
          settings.modelId,
          context.env.RAG_CONTEXT_MODE === "complete" ? COMPLETE_RAG_PROMPT.id : prompts.rag.id,
          "complete",
        ),
        // Traza y fuentes de la recuperación.
        trace: outcome.trace,
        sources,
        signal,
        // Se validan las citas [cite:id]. En modo completo solo se muestran las fuentes citadas.
        validateCitations: true,
        onlyCitedSources: context.env.RAG_CONTEXT_MODE === "complete",
        // El modo completo admite una respuesta más larga (1200 tokens).
        maxOutputTokens: context.env.RAG_CONTEXT_MODE === "complete" ? 1200 : undefined,
        // Tarifas para el coste estimado.
        costPricing: generationPricing(settings),
        timeoutMs: settings.timeoutMs,
        // Pasos del modo clase con el generador configurado.
        ragSteps: { retrieval: ragRetrieval, query: question, model: settings.modelId },
      });
    } catch {
      // 502.
      return jsonError({ error: "provider", message: PUBLIC_PROVIDER_MESSAGE }, 502);
    }
  });

  // App lista.
  return app;
}
