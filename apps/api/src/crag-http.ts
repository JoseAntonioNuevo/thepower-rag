// GUÍA DE LECTURA · apps/api/src/crag-http.ts
// Etapa CRAG por HTTP: comprueba configuración e índice, crea los puertos (demo, aclaración o
// reales con el proveedor elegido), ejecuta el grafo y envía pasos, resumen, fuentes y respuesta.
// Esquema y tipos del contrato.
import {
  cragSummarySchema,
  type ChatRequest,
  type CragStep,
  type RunMetadata,
} from "@thepower-rag/contracts";
// Citas, detección de calendario, filtro de citas y tipos.
import {
  citationsFor,
  isScheduleQuestion,
  suppressUnknownCitations,
  type CragPorts,
  type AllowanceLedger,
  type IndexedChunk,
} from "@thepower-rag/core";
// Utilidades del AI SDK para el stream.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
// Puertos de la demo y su guion.
import { createDemoCragPorts, resolveDemoScenario } from "./crag-demo";
// Grafo de CRAG.
import { runCragTurn } from "./crag-graph";
// Puertos reales.
import { createRealCragPorts } from "./crag-real";
// Mensaje genérico de fallo.
import { PUBLIC_PROVIDER_MESSAGE } from "./course-stream";
// Tipos del entorno.
import { cragExecutionBudgetMs, type Assessment, type WorkerEnv } from "./env";
// Corpus de la demo.
import { demoChatFixture, fixtureCorpusVersion, fixtureProfile } from "./fixture";
// Fábrica de modelos.
import { createEvaluatorModel, createGenerationModel } from "./model";
// Tarifa del coste mostrado.
import { generationPricing } from "./provider-cost";
// Instrucciones de CRAG.
import { chatPrompts } from "./prompts";
// Corpus del chat: binding de su índice y si usa grupos.
import { chatVectorBinding, usesCourseGroups } from "./chat-corpus";
// Perfil de índice y tipos de los bindings.
import {
  profileReady,
  readIndexProfile,
  type IndexProfileRow,
  type SqlDatabase,
  type VectorIndex,
} from "./stores";
// Tipo del ejecutor de embeddings.
import type { EmbeddingRunner } from "./vectors";

// Dependencias inyectables.
export interface CragHttpDeps {
  // Aviso de cada llamada al proveedor.
  onProviderCall?: () => void;
  // Puertos de prueba.
  cragPorts?: CragPorts;
  // Perfil de índice de prueba.
  profile?: IndexProfileRow | null;
}

// Estado de la respuesta (identidad, se deja explícito).
function completionFor(terminal: RunMetadata["completion"]): RunMetadata["completion"] {
  // Mismo valor.
  return terminal;
}

// Puertos que no hacen nada: una aclaración no busca ni genera.
function inertPorts(signal: AbortSignal): CragPorts {
  // Puertos inertes.
  return {
    // No mide llamadas de pago: no habrá ninguna.
    measured: false,
    // Proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
    now: () => Date.now(),
    signal,
    // Reserva siempre posible (nada se gastará).
    reserve: () => ({ ok: true }),
    // Cada paso falla con un motivo: la aclaración nunca debería llamarlos.
    retrieve: () => Promise.resolve({ ok: false, reason: "La aclaración no busca." }),
    // Ordena los fragmentos y evalúa si aportan evidencia suficiente para la pregunta.
    rankAndAssess: () =>
      Promise.resolve({ ok: false, reason: "La aclaración no evalúa.", providerCall: false }),
    // Propone otra consulta a partir de la pregunta y las carencias detectadas.
    reformulate: () =>
      Promise.resolve({ ok: false, reason: "La aclaración no reformula.", providerCall: false }),
    // Produce la respuesta final con los fragmentos que este recorrido ha seleccionado.
    generate: () =>
      Promise.resolve({ ok: false, reason: "La aclaración no genera.", providerCall: false }),
  };
}

// Atiende un turno de CRAG: 409 si falta configuración o un stream con el grafo.
export async function cragHttpResponse(input: {
  // Entorno.
  env: WorkerEnv;
  // Diagnóstico.
  assessment: Assessment;
  // Petición.
  request: ChatRequest;
  // Pregunta.
  question: string;
  // Historial.
  history: readonly { role: "user" | "assistant"; content: string }[];
  // Señal de cancelación.
  signal: AbortSignal;
  // Dependencias.
  deps: CragHttpDeps;
  // Reserva del presupuesto.
  allowance?: AllowanceLedger;
}): Promise<Response | { status: 409; missing: string[]; message: string }> {
  // Corpus del chat; la demo y un CHAT_CORPUS inválido conservan el curso para la aclaración.
  const corpus = input.assessment.chatCorpus ?? "course";
  // ¿Tiene grupos y calendario? La tienda no pide grupo.
  const groups = usesCourseGroups(corpus);
  // Pregunta de calendario sin grupo: aclaración (solo en el curso).
  const clarify =
    groups && input.request.audience === "program" && isScheduleQuestion(input.question);
  // En real (salvo aclaración) hay que comprobar la configuración.
  if (input.assessment.execution === "real" && !clarify) {
    // Estado de CRAG.
    const capability = input.assessment.capabilities.crag;
    // No está listo.
    if (capability.status !== "ready") {
      // 409 sin caer a la demo.
      return {
        status: 409,
        missing: capability.missing,
        message: "CRAG real no está configurado. No se usa la demostración ni RAG básico.",
      };
    }
    // Ajustes del RAG del chat (curso o tienda).
    const retrieval = input.assessment.chatRetrieval;
    // Binding de embeddings.
    const runner = input.env.AI as EmbeddingRunner | undefined;
    // Binding de Vectorize del corpus del chat.
    const index = input.env[chatVectorBinding(corpus)] as VectorIndex | undefined;
    // Binding de D1.
    const database = input.env.DB as SqlDatabase | undefined;
    // Falta algo.
    if (
      !runner ||
      !index ||
      !database ||
      retrieval === null ||
      input.assessment.generation === null
    ) {
      // 409.
      return {
        status: 409,
        missing: capability.missing,
        message: "Faltan bindings o ajustes de CRAG.",
      };
    }
    // Sin puertos inyectados, el índice debe estar listo.
    if (input.deps.cragPorts === undefined) {
      // Perfil inyectado o leído de D1.
      const row =
        input.deps.profile !== undefined
          ? input.deps.profile
          : await readIndexProfile(database, retrieval.indexProfile, retrieval.corpusVersion);
      // ¿Coincide y está listo?
      const gate = profileReady(row, retrieval);
      // No.
      if (!gate.ok) {
        // 409.
        return {
          status: 409,
          missing: gate.missing,
          message: "El índice configurado no está listo o no coincide con el perfil.",
        };
      }
    }
  }

  // ¿Modo demo?
  const demo = input.assessment.execution !== "real";
  // Corpus preparado de la demo del chat.
  const demoFixture = demoChatFixture(corpus);
  // Guion de la demo: los guiones son del curso; con la tienda solo hay pregunta libre.
  const scenarioId =
    demo && corpus === "course"
      ? resolveDemoScenario(input.request.demoScenario, input.question)
      : null;
  // Ajustes del RAG del chat (curso o tienda).
  const retrieval = input.assessment.chatRetrieval;
  // Alcance de la ejecución.
  const scope = {
    runId: crypto.randomUUID(),
    audience: input.request.audience,
    corpusVersion: demo
      ? demoFixture.version
      : (retrieval?.corpusVersion ?? fixtureCorpusVersion()),
    profileId: demo ? demoFixture.profile.id : (retrieval?.indexProfile ?? fixtureProfile().id),
    embeddingLabel: demo
      ? "fixture-token-hash-v1"
      : (retrieval?.embeddingModel ?? "sin configurar"),
  };
  // Puertos inyectados, de la demo, inertes o reales.
  const ports =
    input.deps.cragPorts ??
    (demo
      ? createDemoCragPorts({
          signal: input.signal,
          scenarioId,
          library: demoFixture.chunks,
          profileId: demoFixture.profile.id,
        })
      : clarify
        ? inertPorts(input.signal)
        : createRealCragPorts({
            signal: input.signal,
            scope,
            embedder: input.env.AI as EmbeddingRunner,
            index: input.env[chatVectorBinding(corpus)] as VectorIndex,
            // Prompts del evaluador, la reformulación y la respuesta según el corpus.
            corpus,
            database: input.env.DB as SqlDatabase,
            // Mismo proveedor y clave para los dos papeles; solo cambia el modelo.
            evaluator: createEvaluatorModel(
              // Evaluador: ajustes de generación con el modelo del evaluador.
              {
                ...(input.assessment.generation ?? { apiKey: "", modelId: "" }),
                evaluatorModelId: input.env.EVALUATOR_MODEL_ID?.trim() ?? "",
              },
              input.deps.onProviderCall,
            ),
            // Generador: los mismos ajustes de generación.
            generator: createGenerationModel(
              input.assessment.generation ?? { apiKey: "", modelId: "" },
              input.deps.onProviderCall,
            ),
            // Tarifas para el coste estimado.
            costPricing: input.assessment.generation
              ? generationPricing(input.assessment.generation)
              : null,
            // Historial, modelo y dimensión de embeddings y sesión de gasto.
            messages: input.history,
            embeddingModel: retrieval?.embeddingModel ?? "",
            dimensions: retrieval?.dimensions ?? 0,
            allowance: input.allowance,
            // Mantiene un tope por llamada dentro del plazo único del perfil de CRAG.
            generationTimeoutMs: Math.min(
              input.assessment.generation?.timeoutMs ?? 20_000,
              cragExecutionBudgetMs(input.env) ?? 20_000,
            ),
          }));

  // Metadatos de la respuesta.
  const metadata: RunMetadata = {
    runId: scope.runId,
    origin: demo ? "offline-fixture" : "pipeline",
    modelId: demo ? null : (input.assessment.generation?.modelId ?? null),
    promptId: chatPrompts(corpus).crag.id,
    completion: "streaming",
    usage: null,
    cost: null,
  };

  // Stream de la respuesta.
  const stream = createUIMessageStream({
    // Produce las partes del stream dentro del ciclo de ejecución del protocolo de mensajes.
    execute: async ({ writer }) => {
      // Inicio.
      writer.write({ type: "start", messageMetadata: metadata });
      // Ejecuta el grafo enviando cada paso.
      const result = await runCragTurn({
        question: input.question,
        scope,
        ports,
        fixture: demo,
        scenarioId,
        // La demo mantiene su contrato previo. En real el diagnóstico ya validó el plazo.
        executionBudgetMs: demo ? undefined : (cragExecutionBudgetMs(input.env) ?? undefined),
        // La tienda no tiene grupos: no se pide aclaración de calendario.
        groups,
        // Publica el paso CRAG para que la interfaz pueda mostrar la traza mientras se ejecuta.
        onStep: (step: CragStep) => {
          // Paso transitorio.
          writer.write({ type: "data-step", data: step, transient: true });
        },
      });
      // Resumen validado.
      const summary = cragSummarySchema.parse(result.summary);
      // Envía el resumen.
      writer.write({ type: "data-crag", id: "crag", data: summary });
      // Citas solo si hay respuesta.
      const sources =
        result.terminal === "answer"
          ? citationsFor(
              result.evidence.map((chunk): IndexedChunk => ({
                ...chunk,
                vector: [],
              })),
            )
          : [];
      // Envía cada cita.
      for (const source of sources) {
        // Cita.
        writer.write({ type: "data-source", id: source.chunkId, data: source });
      }
      // Ids citables.
      const allowed = new Set(sources.map((source) => source.chunkId));
      // Texto sin citas desconocidas.
      const text =
        result.terminal === "answer"
          ? suppressUnknownCitations(result.answerText, allowed)
          : result.answerText;
      // Inicio del texto.
      writer.write({ type: "text-start", id: "answer" });
      // Trozos de 160 caracteres.
      const size = 160;
      // Envía cada trozo.
      for (let index = 0; index < text.length; index += size) {
        // Trozo.
        writer.write({ type: "text-delta", id: "answer", delta: text.slice(index, index + size) });
      }
      // Fin del texto.
      writer.write({ type: "text-end", id: "answer" });
      // Estado según el final del grafo.
      const completion = completionFor(
        result.terminal === "answer"
          ? "complete"
          : result.terminal === "refuse"
            ? "refused"
            : result.terminal === "clarify"
              ? "clarified"
              : result.terminal === "aborted"
                ? "aborted"
                : "error",
      );
      // Final con consumo y coste.
      writer.write({
        // Evento final del stream con los metadatos del turno.
        type: "finish",
        messageMetadata: {
          ...metadata,
          // Origen: demo, proveedor si hubo generación de pago, o canalización si no.
          origin: demo
            ? "offline-fixture"
            : summary.calls.generation.providerCalls
              ? "provider"
              : "pipeline",
          // Cómo terminó, consumo y coste.
          completion,
          usage: summary.usage,
          cost: summary.cost,
        },
      });
    },
    // Transforma el fallo del stream en el mensaje que recibirá el consumidor.
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  // Respuesta HTTP sin caché.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": demo ? "offline-fixture" : "pipeline",
    },
  });
}
