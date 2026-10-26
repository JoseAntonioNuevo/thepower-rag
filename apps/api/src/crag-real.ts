// GUÍA DE LECTURA · apps/api/src/crag-real.ts
// Puertos reales de CRAG: buscar en Vectorize, evaluar la evidencia con el modelo evaluador, reformular
// la consulta y generar la respuesta. Cada llamada tiene plazo propio y descuenta de la sesión de gasto.
// Detecta si el modelo se negó a responder.
import { refusedByModel } from "./model";
// Coste estimado y su tarifa.
import { providerCost, type CostPricing } from "./provider-cost";
// Límites de plazos, salida y reintentos.
import { LIMITS } from "@thepower-rag/contracts";
// Cotas de CRAG, escala de puntuaciones y tipos del grafo del núcleo.
import {
  CRAG_BOUNDS,
  CRAG_SCORE_THRESHOLDS,
  OPERATION_BOUNDS,
  type AllowanceLedger,
  type CragChunk,
  type CragPorts,
  type CragScope,
} from "@thepower-rag/core";
// Funciones del AI SDK: objeto con esquema y texto libre.
import { generateObject, generateText, type LanguageModel } from "ai";
// Zod define los esquemas de salida estructurada.
import { z } from "zod";
// Prompt de sistema de la respuesta final de CRAG.
import { cragSystem } from "./prompts";
// Corpus del chat.
import type { ChatCorpusId } from "@thepower-rag/contracts";
// Acceso a Vectorize y D1.
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";
// Embeddings con Workers AI.
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";

// Esquema del evaluador: ranking de fragmentos en [0, 1], estado, motivo, lagunas e ids útiles.
const evidenceSchema = z.object({
  // Un elemento por fragmento recibido, con su puntuación en [0, 1] y motivo.
  ranking: z
    .array(
      z.object({
        chunkId: z.string().min(1).max(CRAG_BOUNDS.maxIdChars),
        score: z.number().min(CRAG_SCORE_THRESHOLDS.minScore).max(CRAG_SCORE_THRESHOLDS.maxScore),
        reason: z.string().min(1).max(CRAG_BOUNDS.maxReasonChars),
      }),
    )
    .max(CRAG_BOUNDS.maxCandidates),
  // Decisión: suficiente, parcial o insuficiente, con su motivo.
  status: z.enum(["sufficient", "partial", "insufficient"]),
  reason: z.string().min(1).max(CRAG_BOUNDS.maxReasonChars),
  // Lagunas concretas y fragmentos útiles (como mucho maxRetained).
  gaps: z.array(z.string().min(1).max(CRAG_BOUNDS.maxGapChars)).max(CRAG_BOUNDS.maxGaps),
  usefulIds: z.array(z.string().min(1).max(CRAG_BOUNDS.maxIdChars)).max(CRAG_BOUNDS.maxRetained),
});

// Esquema de la reformulación: una nueva consulta.
const rewriteSchema = z.object({
  query: z.string().min(1).max(CRAG_BOUNDS.maxQueryChars),
});

// Instrucciones del evaluador: reordenar en [0, 1] y valorar por separado la cobertura de la pregunta.
const EVALUATOR_PROMPT = [
  "Eres el evaluador del corpus privado del programa AI Engineer.",
  "Paso 1 (reordenamiento): ranking debe incluir EXACTAMENTE TODOS los fragmentos recibidos, cada id una sola vez, también los irrelevantes. Copia sus ids completos.",
  "Asigna a cada fragmento una puntuación score en la escala cerrada [0.00, 1.00]: 0.00 = irrelevante; 0.50 = corte mínimo de fragmento útil; 0.75–1.00 = evidencia directa sobre un aspecto de la pregunta.",
  "Paso 2 (valoración de suficiencia): distingue la relevancia de un fragmento individual de la cobertura de toda la pregunta original.",
  "Un fragmento con score alto (>= 0.75) puede cubrir solo una parte de una pregunta compuesta: en ese caso la decisión global es partial (cobertura 0.40–0.74), nunca sufficient.",
  "sufficient (cobertura >= 0.75 sin lagunas): usefulIds contiene de 1 a 6 ids con texto que cubre todas las partes de la pregunta; gaps es [].",
  "partial (cobertura 0.40–0.74 con laguna): usefulIds conserva de 1 a 6 ids útiles (score >= 0.50) y gaps nombra exactamente qué parte falta.",
  "insufficient (cobertura < 0.40 o ningún fragmento >= 0.50): usefulIds es [] Y gaps es []. El reason explica qué falta.",
  "No inventes ids ni hechos. La puntuación mide relevancia documental en [0, 1], no una probabilidad de verdad. No respondas al alumno ni busques fuera del corpus.",
].join("\n");

// Instrucciones de la reformulación: nueva consulta para cubrir la laguna.
const REWRITE_PROMPT = [
  "Reformula la búsqueda en el corpus del curso para cubrir la laguna.",
  "Conserva la intención de la pregunta original y no añadas un hecho que no esté pedido.",
  "La consulta tiene que ser distinta de las anteriores.",
].join("\n");

// Evaluador con la tienda Zocomar: mismo esquema y pasos, con las reglas del juez del laboratorio
// sobre políticas sustituidas, remisiones entre documentos y lagunas (apps/api/src/lab-models.ts).
const STORE_EVALUATOR_PROMPT = [
  "Eres el evaluador de la documentación de Zocomar, una tienda en línea ficticia que se usa en clase.",
  ...EVALUATOR_PROMPT.split("\n").slice(1, -1),
  "Un fragmento de un documento sustituido, archivado o no vigente no sirve para describir las condiciones actuales: puntúalo con 0.20 o menos, salvo que la pregunta pida expresamente las condiciones antiguas.",
  "Si un fragmento remite a otro documento para un dato que la pregunta necesita, o la pregunta trata de una categoría, un tipo de cliente o una zona con condiciones propias y solo hay regla general, esa parte es una laguna.",
  "Una laguna es un dato que debería estar en la documentación de la tienda y no aparece. No son lagunas las dudas sobre la situación del cliente: toma como dado lo que cuenta el cliente.",
  "No inventes ids ni hechos. La puntuación mide relevancia documental en [0, 1], no una probabilidad de verdad. No respondas al cliente ni busques fuera de la documentación.",
].join("\n");

// Reformulación con la tienda: vocabulario de política, no el del cliente.
const STORE_REWRITE_PROMPT = [
  "Reformula la búsqueda en la documentación de la tienda para cubrir la laguna.",
  "Usa el vocabulario formal con el que estaría escrita una política, no el coloquial del cliente.",
  "Conserva la intención de la pregunta original y no añadas un hecho que no esté pedido.",
  "La consulta tiene que ser distinta de las anteriores.",
].join("\n");

// Plazo que se da al proveedor: lo que queda, sin pasar del máximo de la llamada.
export function providerTimeoutMs(remainingMs: number, capMs: number): number {
  // Sin tiempo restante, 0.
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    // 0 milisegundos.
    return 0;
  }
  // El menor entre el máximo y lo que queda.
  return Math.min(capMs, Math.floor(remainingMs));
}

// Ejecuta una llamada con su propio plazo y cancelación encadenada a la del padre.
async function withDeadline<T>(
  parent: AbortSignal,
  remainingMs: number,
  capMs: number,
  run: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
): Promise<T> {
  // Plazo de esta llamada.
  const timeoutMs = providerTimeoutMs(remainingMs, capMs);
  // Ya cancelada o sin tiempo: no llama.
  if (parent.aborted || timeoutMs <= 0) {
    // AbortError.
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  // Controlador propio de la llamada.
  const controller = new AbortController();
  // Si el padre se cancela, cancela la llamada.
  const onAbort = () => {
    // Cancela.
    controller.abort();
  };
  // Escucha al padre una vez.
  parent.addEventListener("abort", onAbort, { once: true });
  // Temporizador del plazo.
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Lanza la llamada.
  const pending = run(controller.signal, timeoutMs);
  // Evita un rechazo sin manejar si pierde la carrera.
  void pending.catch(() => undefined);
  // try/finally: limpia temporizador y oyente.
  try {
    // Gana la llamada o el plazo.
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        // Al vencer el plazo, cancela y rechaza con crag-timeout.
        timer = setTimeout(() => {
          // Cancela la llamada.
          controller.abort();
          // Error de plazo.
          reject(new Error("crag-timeout"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    // Si hubo temporizador.
    if (timer !== undefined) {
      // Lo cancela.
      clearTimeout(timer);
    }
    // Retira el oyente del padre.
    parent.removeEventListener("abort", onAbort);
  }
}

// ¿Mismo ámbito? Audiencia, versión del corpus y perfil de índice.
function sameScope(left: CragScope, right: CragScope): boolean {
  // Compara los tres campos.
  return (
    left.audience === right.audience &&
    left.corpusVersion === right.corpusVersion &&
    left.profileId === right.profileId
  );
}

// Crea los puertos reales que usa el grafo CRAG.
export function createRealCragPorts(input: {
  // Señal de cancelación de la petición.
  signal: AbortSignal;
  // Ámbito fijo: audiencia, corpus y perfil.
  scope: CragScope;
  // Ejecutor de embeddings.
  embedder: EmbeddingRunner;
  // Índice vectorial.
  index: VectorIndex;
  // Base de datos D1.
  database: SqlDatabase;
  // Modelo evaluador.
  evaluator: LanguageModel;
  // Modelo que redacta la respuesta.
  generator: LanguageModel;
  // Historial de la conversación.
  messages: readonly { role: "user" | "assistant"; content: string }[];
  // Modelo de embeddings.
  embeddingModel: string;
  // Dimensiones del vector.
  dimensions: number;
  // Sesión de gasto autorizada; sin ella no se llama al proveedor.
  allowance?: AllowanceLedger;
  /** Tarifa del coste mostrado de la respuesta final; sin valor, la de Claude Haiku 5.5. */
  costPricing?: CostPricing | null;
  // Tope por llamada, siempre recortado al tiempo restante del turno.
  generationTimeoutMs?: number;
  // Corpus del chat: decide los prompts del evaluador, la reformulación y la respuesta.
  corpus?: ChatCorpusId;
  // Observación opcional para comparaciones dirigidas: tokens medidos, nunca factura ni secretos.
  onUsage?: (
    kind: "evaluation" | "reformulation" | "generation",
    usage: {
      inputTokens?: number;
      outputTokens?: number;
    },
  ) => void;
}): CragPorts {
  // Reserva abierta por tipo de operación.
  const open = new Map<string, string>();
  // Reserva gasto para una operación antes de hacerla.
  const reserveKind = (
    kind: "retrieval" | "evaluation" | "reformulation" | "generation",
  ): { ok: true } | { ok: false; reason: string } => {
    // Sin sesión de gasto, no se reserva.
    if (input.allowance === undefined) {
      // Motivo visible.
      return {
        ok: false,
        reason: "No hay una sesión de gasto autorizada. El chat real no llama al proveedor.",
      };
    }
    // Cotas de esa operación.
    const bounds = OPERATION_BOUNDS[kind];
    // Pide la reserva.
    const reserved = input.allowance.reserve({ kind, ...bounds });
    // Rechazada.
    if (!reserved.ok) {
      // Se devuelve el motivo.
      return reserved;
    }
    // Guarda su id.
    open.set(kind, reserved.id);
    // Reserva hecha.
    return { ok: true };
  };
  // Cierra la reserva de una operación con el importe real (null si se desconoce).
  const settle = (kind: string, actualUsd: number | null) => {
    // Id de la reserva.
    const id = open.get(kind);
    // Si existe.
    if (id !== undefined) {
      // La liquida.
      input.allowance?.settle(id, actualUsd);
      // La quita de las abiertas.
      open.delete(kind);
    }
  };
  // Puertos del grafo.
  return {
    measured: true,
    now: Date.now,
    signal: input.signal,
    reserve: reserveKind,
    // Recupera candidatos documentales dentro del ámbito de corpus y consulta del recorrido.
    async retrieve({ query, scope, limit, remainingMs }) {
      // Otro ámbito: rechazado.
      if (!sameScope(scope, input.scope)) {
        // Motivo.
        return { ok: false, reason: "La búsqueda cambió de ámbito." };
      }
      // Cancelada: no busca.
      if (input.signal.aborted) {
        // AbortError.
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      // Vector de la consulta.
      let vector: number[] | undefined;
      // try/catch: la reserva se cierra pase lo que pase.
      try {
        // Embedding de la consulta con plazo.
        const rows = await withDeadline(
          // Señal de cancelación, tiempo restante del turno y plazo propio del embedding.
          input.signal,
          remainingMs,
          LIMITS.embeddingTimeoutMs,
          (signal, timeoutMs) =>
            // Embebe solo la consulta con BGE-M3 y valida la dimensión.
            embedWithWorkersAi(
              input.embedder,
              input.embeddingModel,
              [query],
              input.dimensions,
              signal,
              timeoutMs,
            ),
        );
        // Primer vector.
        vector = rows[0];
        // Cierra la reserva de búsqueda.
        settle("retrieval", null);
      } catch (error) {
        // Cierra también si falla.
        settle("retrieval", null);
        // Propaga el error.
        throw error;
      }
      // Sin vector.
      if (vector === undefined) {
        // Fallo.
        return { ok: false, reason: "El embedding no devolvió un vector." };
      }
      // Busca los vecinos en Vectorize.
      const hits = await queryVectorize(
        input.index,
        {
          vector,
          audience: scope.audience,
          corpusVersion: scope.corpusVersion,
          profileId: scope.profileId,
          limit,
        },
        input.signal,
      );
      // Fragmentos completos.
      const chunks: CragChunk[] = [];
      // Cada resultado.
      for (const hit of hits) {
        // Lee su texto de D1.
        const record = await readChunk(input.database, scope.corpusVersion, hit.chunkId);
        // No existe: se salta.
        if (record === null) {
          // Siguiente.
          continue;
        }
        // Añade el fragmento con perfil y puntuación.
        chunks.push({ ...record, profileId: scope.profileId, score: hit.score });
      }
      // Fragmentos recuperados.
      return { ok: true, providerCall: true, chunks };
    },
    // Ordena los fragmentos y evalúa si aportan evidencia suficiente para la pregunta.
    async rankAndAssess({ question, query, chunks, remainingMs }) {
      // Cancelada: no evalúa.
      if (input.signal.aborted) {
        // AbortError.
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      // Fragmentos empaquetados como texto: id, puntuación y contenido.
      const packed = chunks
        .map(
          (chunk) =>
            `id: ${chunk.chunkId}\npuntuación: ${chunk.score === null ? "desconocida" : String(chunk.score)}\ntexto:\n${chunk.text}`,
        )
        .join("\n\n");
      // try/catch: cierra la reserva y registra el error sin datos privados.
      try {
        // El evaluador devuelve un objeto con el esquema; ranking debe tener tantos elementos como fragmentos.
        const result = await withDeadline(
          // Señal, tiempo restante y plazo propio de la evaluación.
          input.signal,
          remainingMs,
          input.generationTimeoutMs ?? LIMITS.generationTimeoutMs,
          (signal) =>
            generateObject({
              // Modelo evaluador con el esquema y un ranking de exactamente tantos elementos como
              // fragmentos.
              model: input.evaluator,
              schema: evidenceSchema.extend({
                ranking: evidenceSchema.shape.ranking.length(chunks.length),
              }),
              // Instrucciones y prompt con la pregunta, la consulta y los fragmentos empaquetados.
              schemaName: "crag-evidence",
              system: input.corpus === "zocomar" ? STORE_EVALUATOR_PROMPT : EVALUATOR_PROMPT,
              prompt: `Pregunta original:\n${question}\n\nConsulta de búsqueda:\n${query}\n\nFragmentos:\n${packed}`,
              // Tope de salida, reintentos en 0 y señal.
              maxOutputTokens: 1600,
              maxRetries: LIMITS.maxRetries,
              abortSignal: signal,
            }),
        );
        // Cierra la reserva.
        settle("evaluation", null);
        // Comunica los tokens observados del papel actual para calcular su estimación de coste.
        input.onUsage?.("evaluation", result.usage);
        // Objeto sin validar todavía; el núcleo lo comprueba.
        return { ok: true, providerCall: true, raw: result.object };
      } catch (error) {
        // Cierra la reserva.
        settle("evaluation", null);
        // Registra nombre y mensaje recortado del error.
        console.warn(
          "CRAG evaluator failure",
          error instanceof Error
            ? { name: error.name, message: error.message.slice(0, 500) }
            : { name: "unknown" },
        );
        // Propaga.
        throw error;
      }
    },
    // Propone otra consulta a partir de la pregunta y las carencias detectadas.
    async reformulate({ question, query, gaps, remainingMs }) {
      // Cancelada: no reformula.
      if (input.signal.aborted) {
        // AbortError.
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      // try/catch: cierra la reserva.
      try {
        // El evaluador propone otra consulta.
        const result = await withDeadline(
          // Señal, tiempo restante y plazo propio.
          input.signal,
          remainingMs,
          input.generationTimeoutMs ?? LIMITS.generationTimeoutMs,
          (signal) =>
            generateObject({
              // Reformulación con su esquema: una consulta nueva.
              model: input.evaluator,
              schema: rewriteSchema,
              schemaName: "crag-query",
              system: input.corpus === "zocomar" ? STORE_REWRITE_PROMPT : REWRITE_PROMPT,
              // Pregunta original, consulta anterior y lagunas nombradas.
              prompt: `Pregunta original:\n${question}\n\nConsulta anterior:\n${query}\n\nLagunas:\n${gaps.join("\n") || "sin laguna nombrada"}`,
              // Tope de salida, sin reintentos y con señal.
              maxOutputTokens: 800,
              maxRetries: LIMITS.maxRetries,
              abortSignal: signal,
            }),
        );
        // Cierra la reserva.
        settle("reformulation", null);
        // Comunica los tokens observados del papel actual para calcular su estimación de coste.
        input.onUsage?.("reformulation", result.usage);
        // Objeto con la nueva consulta.
        return { ok: true, providerCall: true, raw: result.object };
      } catch (error) {
        // Cierra la reserva.
        settle("reformulation", null);
        // Propaga.
        throw error;
      }
    },
    // Produce la respuesta final con los fragmentos que este recorrido ha seleccionado.
    async generate({ question, evidence, remainingMs }) {
      // Cancelada: no genera.
      if (input.signal.aborted) {
        // AbortError.
        throw new DOMException("The operation was aborted.", "AbortError");
      }
      // Resultado de generateText.
      let result: Awaited<ReturnType<typeof generateText>>;
      // try/catch: cierra la reserva.
      try {
        // Genera la respuesta con la evidencia en el sistema y la pregunta original.
        result = await withDeadline(
          // Señal, tiempo restante y plazo propio de la generación.
          input.signal,
          remainingMs,
          input.generationTimeoutMs ?? LIMITS.generationTimeoutMs,
          (signal, timeoutMs) =>
            generateText({
              // Generador con la evidencia en las instrucciones.
              model: input.generator,
              system: cragSystem(evidence, input.corpus ?? "course"),
              // Historial sin el último mensaje, que se sustituye por la pregunta original.
              messages: [
                ...input.messages.slice(0, -1),
                { role: "user" as const, content: question },
              ],
              // Tope de salida del curso, sin reintentos, señal y plazo total.
              maxOutputTokens: LIMITS.maxOutputTokens,
              maxRetries: LIMITS.maxRetries,
              abortSignal: signal,
              timeout: { totalMs: timeoutMs },
            }),
        );
        // Cierra la reserva.
        settle("generation", null);
      } catch (error) {
        // Cierra la reserva.
        settle("generation", null);
        // Propaga.
        throw error;
      }
      // Negativa del modelo: fallo.
      if (refusedByModel(result.finishReason, result.rawFinishReason)) {
        // Error genérico.
        throw new Error("provider-failed");
      }
      // Consumo total.
      const usage = result.totalUsage;
      // Comunica los tokens observados del papel actual para calcular su estimación de coste.
      input.onUsage?.("generation", usage);
      // Tokens de entrada o null.
      const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : null;
      // Tokens de salida o null.
      const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : null;
      // Total o null.
      const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : null;
      // Texto, consumo y coste estimado.
      return {
        // providerCall: true, hubo una llamada de pago.
        ok: true,
        providerCall: true,
        text: result.text,
        // Tokens si el proveedor los dio; null si no hay ninguno.
        usage:
          inputTokens === null && outputTokens === null && totalTokens === null
            ? null
            : { inputTokens, outputTokens, totalTokens },
        // Coste estimado con las tarifas configuradas.
        cost: providerCost(usage, input.costPricing),
      };
    },
  };
}
