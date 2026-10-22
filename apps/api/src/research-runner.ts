// GUÍA DE LECTURA · apps/api/src/research-runner.ts
// Un paso del trabajo durable de investigación: reclama el trabajo con un arrendamiento, percibe imagen
// y audio, ejecuta el grafo con checkpoints en D1, genera la voz y guarda el resultado. Si una llamada
// quedó enviada sin resultado, el trabajo pasa a «atención» en vez de repetirla.
// Límites de medios, esquema del resumen y tipos del contrato.
import {
  MEDIA_LIMITS,
  researchSummarySchema,
  type ResearchMedia,
  type ResearchOutcome,
  type ResearchScenarioId,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
// Tipos de puertos y petición de la investigación.
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
// Checkpointer de LangGraph sobre D1.
import { checkpointConfig, checkpointThread, D1CheckpointSaver } from "./research-checkpointer";
// Tipo de la base de datos.
import type { ResearchDatabase } from "./research-db";
// Puertos de prueba.
import { createFixtureResearchPorts } from "./research-fixture";
// Diario de operaciones de pago.
import { journalPorts } from "./research-journal";
// Grafo de la investigación.
import { runResearchGraph } from "./research-graph";
// Lectura de las tarifas congeladas.
import { parsePriceSnapshot, type PriceSnapshot } from "./research-money";
// Operaciones del almacén del trabajo.
import {
  // Eventos, reclamación, cierre y lectura del trabajo.
  appendEvent,
  claimJob,
  finishJob,
  getJob,
  // Operaciones, atención y caída simulada.
  listOperations,
  markAttention,
  markCrashConsumed,
  // Recuperación, respuesta del asistente y liberación de reservas.
  promoteDispatched,
  recordAssistantMessage,
  releaseReservedOperations,
  // Borrador del resultado y progreso.
  saveResultDraft,
  setProgress,
  type JobRow,
} from "./research-store";
// Percepción multimodal y voz.
import {
  perceiveJob,
  shellSummary,
  speakAnswer,
  type MultimodalContext,
} from "./research-multimodal";
// Resultado guardado y acotado.
import { buildStoredResult } from "./research-result";
// Fuentes citadas y resumen público.
import { citedSources, researchSummary } from "./research-summary";
// Errores de control del paso.
import { controlError, ResearchAttention, ResearchStepCrash } from "./research-state";

// Resultado de un paso.
export interface TickResult {
  // Si el Workflow puede terminar.
  done: boolean;
  // Estado del trabajo.
  status: JobRow["execution_status"] | "missing";
}

// Guarda un borrador del resultado cuando falla la voz, para no perder el informe.
async function saveSpeechFailureDraft(
  database: ResearchDatabase,
  input: {
    // Propietario.
    ownerId: string;
    // Trabajo.
    jobId: string;
    // Ficha del arrendamiento.
    leaseToken: number;
    // Resumen.
    summary: ResearchSummary;
    // Estado de medios.
    media: ResearchMedia;
    // Fuentes.
    sources: readonly ResearchSource[];
    // Texto del informe.
    reportText: string;
    // Si es de prueba.
    fixture: boolean;
    // Error de la voz.
    error: unknown;
  },
): Promise<void> {
  // ¿Fue una operación ambigua (enviada sin resultado)?
  const attention = controlError(input.error) instanceof ResearchAttention;
  // Voz marcada como ambigua o fallida.
  input.summary.media = {
    ...input.media,
    speech: {
      status: attention ? "ambiguous" : "failed",
      text: "",
      assetId: null,
      mime: null,
      detail: attention
        ? "La voz quedó sin resultado durable. El informe se conserva y la reserva no se libera."
        : "La voz falló. El informe se conserva.",
      fixture: input.fixture,
    },
  };
  // El total ya no está completo.
  input.summary.accounting = { ...input.summary.accounting, totalComplete: false };
  // Resultado acotado.
  const draft = await buildStoredResult(database, {
    ownerId: input.ownerId,
    jobId: input.jobId,
    summary: input.summary,
    sources: [...input.sources],
    reportText: input.reportText,
    now: Date.now(),
  });
  // Demasiado grande: no se guarda.
  if (!draft)
    // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
    return;
  // Guarda el borrador.
  await saveResultDraft(database, {
    ownerId: input.ownerId,
    jobId: input.jobId,
    leaseToken: input.leaseToken,
    outcome: input.summary.outcome,
    resultJson: JSON.stringify(draft),
  });
}

// Nombre del ejecutor que reclama el trabajo.
const EXECUTOR = "research-workflow";
// Duración del arrendamiento: 3 minutos.
const LEASE_MS = 180_000;

// Escenario de prueba del trabajo.
function scenarioOf(job: JobRow): ResearchScenarioId | null {
  // Campo de la fila.
  return job.scenario_id;
}

/**
 * Un paso del mismo grafo. El flujo de trabajo solo llama a esta función:
 * no reimplementa la investigación.
 */
export async function runResearchTick(
  // Base de datos, trabajo y dueño.
  database: ResearchDatabase,
  jobId: string,
  ownerId: string,
  // Fábrica de puertos: por defecto, los de la demo con el guion del trabajo.
  createPorts: (signal: AbortSignal, job: JobRow, prices: PriceSnapshot) => ResearchPorts = (
    signal,
    job,
  ) =>
    createFixtureResearchPorts({
      signal,
      scenarioId: scenarioOf(job),
      audience: job.audience,
      corpusVersion: job.corpus_version,
    }),
  // Contexto de medios: por defecto, demo sin R2, sin AI y sin visión.
  mediaContext: Omit<MultimodalContext, "signal"> = {
    mode: "demo",
    bucket: null,
    ai: null,
    vision: null,
    visionModelId: null,
    sttModelId: MEDIA_LIMITS.sttModelId,
    ttsModelId: MEDIA_LIMITS.ttsModelId,
  },
): Promise<TickResult> {
  // Operaciones enviadas sin resultado pasan a desconocidas.
  const promoted = await promoteDispatched(database, ownerId, jobId);
  // Si había alguna, atención.
  if (promoted > 0) {
    // Fin.
    return { done: true, status: "attention" };
  }
  // Trabajo del propietario.
  const job = await getJob(database, ownerId, jobId);
  // No existe.
  if (job === null) {
    // Fin.
    return { done: true, status: "missing" };
  }
  // Ya en atención.
  if (job.execution_status === "attention") {
    // Fin.
    return { done: true, status: "attention" };
  }
  // Ya terminado.
  if (
    job.execution_status === "complete" ||
    job.execution_status === "cancelled" ||
    job.execution_status === "failed"
  ) {
    // Fin con su estado.
    return { done: true, status: job.execution_status };
  }
  // Tarifas congeladas.
  const prices = parsePriceSnapshot(job.price_json);
  // Ilegibles.
  if (prices === null) {
    // Atención.
    await markAttention(database, ownerId, jobId, "price-snapshot");
    // Fin.
    return { done: true, status: "attention" };
  }
  // Reclama el trabajo con un arrendamiento.
  const claimed = await claimJob(database, ownerId, jobId, EXECUTOR, Date.now(), LEASE_MS);
  // Otro ejecutor lo tiene.
  if (claimed === null) {
    // Estado actual.
    const latest = await getJob(database, ownerId, jobId);
    // Fin.
    return { done: true, status: latest?.execution_status ?? "missing" };
  }
  // Fuera de plazo sin haber empezado: cancelado.
  if (Date.now() > claimed.deadline_at && claimed.started_at === null) {
    // Fin.
    return { done: true, status: "cancelled" };
  }
  // Controlador de cancelación del paso.
  const controller = new AbortController();
  // Vigilante de cancelación y plazo.
  let watcher: ReturnType<typeof setInterval> | undefined;
  // Puertos con diario.
  let ports: ReturnType<typeof journalPorts>;
  // Crear puertos puede fallar por configuración.
  try {
    // Puertos envueltos por el diario.
    ports = journalPorts(
      database,
      claimed,
      prices,
      createPorts(controller.signal, claimed, prices),
      scenarioOf(claimed),
    );
  } catch {
    // Sin puertos: atención.
    await markAttention(database, ownerId, jobId, "ports-unavailable");
    // Fin.
    return { done: true, status: "attention" };
  }
  // Cada 200 ms mira si se pidió cancelar o venció el plazo.
  watcher = setInterval(() => {
    // Relee el trabajo.
    void getJob(database, ownerId, jobId).then((row) => {
      // Cancelado o fuera de plazo.
      if (row?.cancel_requested === 1 || (row && Date.now() > row.deadline_at)) {
        // Corta las llamadas en curso.
        controller.abort();
      }
    });
  }, 200);
  // Contexto multimodal con la señal del paso.
  const multimodal: MultimodalContext = { ...mediaContext, signal: controller.signal };
  // Pregunta del grafo.
  let graphQuestion = claimed.contextualized_question ?? claimed.original_question;
  // Medios ya percibidos.
  let ahead: ResearchMedia | null = null;
  // Fuentes de los adjuntos.
  let aheadSources: ResearchSource[] = [];
  // Petición del grafo.
  const request: ResearchRequest = {
    runId: claimed.run_id,
    threadId: claimed.conversation_id,
    question: graphQuestion,
    observations: [{ kind: "text", text: claimed.original_question }],
    audience: claimed.audience,
    corpusVersion: claimed.corpus_version,
    scenarioId: scenarioOf(claimed),
  };
  // try/catch/finally: errores de control, fallos y limpieza del vigilante.
  try {
    // Lee imagen y audio si los hay.
    const perceived = await perceiveJob(database, claimed, prices, multimodal);
    // Bloqueado.
    if (perceived.kind === "blocked") {
      // Resumen mínimo de error.
      const summary = shellSummary(claimed, ports, "error", perceived.detail, perceived.detail, {
        visionCalls: 0,
        transcriptionCalls: 0,
        speechCalls: 0,
        image: null,
        audio: null,
        conflict: null,
        speech: null,
      });
      // Resultado acotado.
      const storedResult = await buildStoredResult(database, {
        ownerId,
        jobId,
        summary,
        sources: [],
        reportText: perceived.detail,
        now: Date.now(),
      });
      // Cierra como fallido.
      await finishOrAttention(database, {
        ownerId,
        jobId,
        leaseToken: claimed.lease_token,
        now: Date.now(),
        execution: "failed",
        outcome: "error",
        resultJson: storedResult ? JSON.stringify(storedResult) : null,
      });
      // Fin.
      return { done: true, status: "failed" };
    }
    // La entrada pide aclaración.
    if (perceived.kind === "ready" && !perceived.proceed) {
      // Resumen de aclaración.
      const summary = shellSummary(
        claimed,
        ports,
        "clarify",
        perceived.clarify ?? "Hace falta aclarar la entrada.",
        perceived.clarify ?? "Hace falta aclarar la entrada.",
        perceived.media,
      );
      // Medios con voz.
      let spoken = perceived.media;
      // try/catch: la voz puede fallar.
      try {
        // Voz de la aclaración.
        spoken = await speakAnswer({
          database,
          job: claimed,
          prices,
          context: multimodal,
          outcome: "clarify",
          reportText: summary.stopDetail,
          excerpts: [],
          media: perceived.media,
        });
      } catch (error) {
        // Guarda el borrador antes de propagar.
        await saveSpeechFailureDraft(database, {
          ownerId,
          jobId,
          leaseToken: claimed.lease_token,
          summary,
          media: perceived.media,
          sources: perceived.sources,
          reportText: perceived.clarify ?? "Hace falta aclarar la entrada.",
          fixture: ports.fixture,
          error,
        });
        // Propaga.
        throw error;
      }
      // Medios finales.
      summary.media = spoken;
      // Resultado acotado.
      const storedResult = await buildStoredResult(database, {
        ownerId,
        jobId,
        summary,
        sources: perceived.sources,
        reportText: perceived.clarify ?? "Hace falta aclarar la entrada.",
        now: Date.now(),
      });
      // Cierra como completo.
      await finishOrAttention(database, {
        ownerId,
        jobId,
        leaseToken: claimed.lease_token,
        now: Date.now(),
        execution: "complete",
        outcome: "clarify",
        resultJson: storedResult ? JSON.stringify(storedResult) : null,
      });
      // Estado actual.
      const latest = await getJob(database, ownerId, jobId);
      // Fin.
      return { done: true, status: latest?.execution_status ?? "complete" };
    }
    // Listo para investigar.
    if (perceived.kind === "ready") {
      // Pregunta fundida.
      request.question = perceived.question;
      // Medios.
      ahead = perceived.media;
      // Fuentes.
      aheadSources = perceived.sources;
    }
    // Puertos de prueba que necesitan la pregunta final.
    const latch = ports as ResearchPorts & { noteFixtureQuestion?: (question: string) => void };
    // Se la pasa si existe.
    latch.noteFixtureQuestion?.(request.question);
    // Escenario de caída tras el plan, solo una vez.
    const interrupt = claimed.scenario_id === "crash-after-plan" && claimed.crash_consumed === 0;
    // Ejecuta el grafo con checkpoints y registra cada paso.
    const state = await runResearchGraph(
      request,
      ports,
      (step) => {
        // Progreso visible.
        void setProgress(database, jobId, `${step.node}: ${step.status}`);
        // Evento del paso.
        void appendEvent(database, jobId, "step", `${step.node}: ${step.status}`, Date.now());
      },
      {
        startedAt: claimed.created_at,
        checkpointer: new D1CheckpointSaver(database),
        threadId: checkpointThread(jobId),
        interruptBefore: interrupt ? "course" : undefined,
        jobId: claimed.id,
        originalQuestion: claimed.original_question,
      },
    );
    // Pausa simulada: marca la caída y la lanza.
    if (interrupt && state.outcome === null) {
      // Una sola vez.
      await markCrashConsumed(database, jobId);
      // Caída.
      throw new ResearchStepCrash();
    }
    // ¿Queda alguna operación enviada sin resultado?
    const unresolved = (await listOperations(database, jobId)).some(
      (operation) => operation.state === "dispatched",
    );
    // Si queda.
    if (unresolved) {
      // Pasa a desconocida.
      await promoteDispatched(database, ownerId, jobId);
      // Atención.
      await markAttention(database, ownerId, jobId, "reconciliation-required");
      // Fin.
      return { done: true, status: "attention" };
    }
    // Resumen validado con los medios.
    const summary = researchSummarySchema.parse({
      ...researchSummary({ ...state, jobId: claimed.id, threadId: claimed.conversation_id }, ports),
      media: ahead ?? undefined,
    });
    // Extractos admitidos.
    const excerpts = state.accepted.flatMap((entry) => entry.excerpts);
    // Medios.
    let media = ahead;
    // Si hay medios.
    if (media) {
      // try/catch: la voz puede fallar.
      try {
        // Voz del informe.
        media = await speakAnswer({
          database,
          job: claimed,
          prices,
          context: multimodal,
          outcome: summary.outcome,
          reportText: state.reportText,
          excerpts,
          media,
        });
      } catch (error) {
        // Guarda el borrador.
        await saveSpeechFailureDraft(database, {
          ownerId,
          jobId,
          leaseToken: claimed.lease_token,
          summary,
          media,
          sources: [...citedSources(state), ...aheadSources],
          reportText: state.reportText,
          fixture: ports.fixture,
          error,
        });
        // Propaga.
        throw error;
      }
      // Medios finales.
      summary.media = media;
      // Operaciones de medios con cargo desconocido.
      const unknown = (await listOperations(database, jobId)).filter(
        (operation) =>
          (operation.kind === "vision" ||
            operation.kind === "transcribe" ||
            operation.kind === "speech") &&
          (operation.state === "unknown" || operation.unknown_hold_micros > 0),
      ).length;
      // Con cargos desconocidos o voz fallida.
      if (
        unknown > 0 ||
        media.speech?.status === "failed" ||
        media.speech?.status === "ambiguous"
      ) {
        // El total no está completo.
        summary.accounting = {
          ...summary.accounting,
          totalComplete: false,
          unknownConsumptionCalls: summary.accounting.unknownConsumptionCalls + unknown,
        };
      }
    }
    // Resultado acotado.
    const storedResult = await buildStoredResult(database, {
      ownerId,
      jobId,
      summary,
      sources: [...citedSources(state), ...aheadSources],
      reportText: state.reportText,
      now: Date.now(),
    });
    // Demasiado grande.
    if (storedResult === null) {
      // Atención.
      await markAttention(database, ownerId, jobId, "report-unbounded");
      // Fin.
      return { done: true, status: "attention" };
    }
    // Cierra como completo o atención.
    const stored = await finishOrAttention(database, {
      ownerId,
      jobId,
      leaseToken: claimed.lease_token,
      now: Date.now(),
      execution: "complete",
      outcome: summary.outcome,
      resultJson: JSON.stringify(storedResult),
    });
    // Si se guardó.
    if (stored) {
      // Guarda el informe como mensaje del asistente.
      await recordAssistantMessage(database, {
        conversationId: claimed.conversation_id,
        ownerId,
        jobId,
        text: state.reportText,
        now: Date.now(),
      });
      // Evento de resultado.
      await appendEvent(database, jobId, "result", summary.outcome, Date.now());
    }
    // Estado actual.
    const latest = await getJob(database, ownerId, jobId);
    // Fin.
    return { done: true, status: latest?.execution_status ?? "complete" };
  } catch (error) {
    // Error de control.
    const control = controlError(error);
    // Caída o atención.
    if (control instanceof ResearchStepCrash || control instanceof ResearchAttention) {
      // Operaciones.
      const operations = await listOperations(database, jobId);
      // ¿Alguna ambigua?
      const ambiguous = operations.some(
        (operation) => operation.state === "dispatched" || operation.state === "unknown",
      );
      // Ambiguas: reconciliar.
      if (ambiguous) {
        // Pasa a desconocidas.
        await promoteDispatched(database, ownerId, jobId);
        // Atención.
        await markAttention(database, ownerId, jobId, "reconciliation-required");
      } else if (control instanceof ResearchStepCrash) {
        // Caída sin ambigüedad: recuperable.
        await markAttention(database, ownerId, jobId, "recoverable");
      } else {
        // Atención sin caída: reconciliar.
        await markAttention(database, ownerId, jobId, "reconciliation-required");
      }
      // Fin.
      return { done: true, status: "attention" };
    }
    // Estado actual.
    const latest = await getJob(database, ownerId, jobId);
    // Cancelado por el usuario.
    if (latest?.cancel_requested === 1) {
      // Fin.
      return { done: true, status: "cancelled" };
    }
    // Conserva un borrador si existía.
    const preserved = await getJob(database, ownerId, jobId);
    // Cierra como fallido.
    await finishOrAttention(database, {
      ownerId,
      jobId,
      leaseToken: claimed.lease_token,
      now: Date.now(),
      execution: "failed",
      outcome: "error",
      resultJson: preserved?.result_json ?? null,
    });
    // Estado final.
    const afterFailure = await getJob(database, ownerId, jobId);
    // Fin.
    return { done: true, status: afterFailure?.execution_status ?? "failed" };
  } finally {
    // Si hubo vigilante.
    if (watcher !== undefined) {
      // Lo detiene.
      clearInterval(watcher);
    }
  }
}

// Cierra el trabajo solo si no quedan operaciones ambiguas.
async function finishOrAttention(
  database: ResearchDatabase,
  input: {
    // Propietario.
    ownerId: string;
    // Trabajo.
    jobId: string;
    // Ficha del arrendamiento.
    leaseToken: number;
    // Momento.
    now: number;
    // Completo o fallido.
    execution: "complete" | "failed";
    // Resultado.
    outcome: ResearchOutcome | null;
    // JSON del resultado.
    resultJson: string | null;
  },
): Promise<boolean> {
  // Libera reservas no enviadas.
  await releaseReservedOperations(database, input.jobId, input.leaseToken);
  // Enviadas sin resultado pasan a desconocidas.
  const promoted = await promoteDispatched(database, input.ownerId, input.jobId);
  // Operaciones.
  const operations = await listOperations(database, input.jobId);
  // ¿Alguna ambigua?
  const ambiguous =
    promoted > 0 ||
    operations.some(
      (operation) => operation.state === "dispatched" || operation.state === "unknown",
    );
  // Ambiguas: atención.
  if (ambiguous) {
    // Marca.
    await markAttention(database, input.ownerId, input.jobId, "reconciliation-required");
    // No se cerró.
    return false;
  }
  // Cierra el trabajo.
  return finishJob(database, input);
}

// Configuración del checkpoint de un trabajo.
export function checkpointOf(jobId: string) {
  // Delegado.
  return checkpointConfig(jobId);
}

// Cuántas operaciones de un tipo (y estado) tiene un trabajo.
export async function operationCount(
  database: ResearchDatabase,
  jobId: string,
  kind: string,
  state?: string,
): Promise<number> {
  // Operaciones.
  const rows = await listOperations(database, jobId);
  // Filtra y cuenta.
  return rows.filter((row) => row.kind === kind && (state === undefined || row.state === state))
    .length;
}

// Puertos de prueba de un trabajo.
export function fixturePorts(signal: AbortSignal, job: JobRow): ResearchPorts {
  // Puertos con su escenario.
  return createFixtureResearchPorts({
    signal,
    scenarioId: scenarioOf(job),
    audience: job.audience,
    corpusVersion: job.corpus_version,
  });
}
