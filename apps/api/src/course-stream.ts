// GUÍA DE LECTURA · apps/api/src/course-stream.ts
// Convierte una respuesta en el flujo de mensajes que entiende useChat del AI SDK.
// streamFixedCourseResponse envía un texto ya conocido (demo); streamProviderCourseResponse
// transmite el modelo en directo, valida citas por el camino y añade consumo y coste al final.
// Detecta si el modelo se negó a responder.
import { refusedByModel } from "./model";
// Coste estimado y su tarifa.
import { providerCost, type CostPricing } from "./provider-cost";
// Funciones del AI SDK para crear el flujo de mensajes y llamar al modelo.
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  type LanguageModel,
} from "ai";
// Límites y esquema de metadatos; tipos de cita, mensaje, metadatos y traza.
import {
  LIMITS,
  runMetadataSchema,
  type Citation,
  type CourseUIMessage,
  type RagStep,
  type RunMetadata,
  type TraceEvent,
} from "@thepower-rag/contracts";
// Utilidades del núcleo para validar citas [cite:id].
import { splitCitationBuffer, suppressUnknownCitations } from "@thepower-rag/core";
// Pasos de generación y respuesta del modo clase.
import { ragAnswerStep, ragGenerateStep } from "./rag-steps";

// Pasos del modo clase para el RAG básico: los de la búsqueda y el generador que actúa.
export interface RagStepsInput {
  // Pasos ya medidos de la búsqueda y la decisión (rag-steps.ts).
  retrieval: readonly RagStep[];
  // Pregunta original.
  query: string;
  // Generador, o null si la respuesta es una plantilla.
  model: string | null;
}

// Nombres de las fuentes por id, para los pasos del modo clase.
function sourceLabels(
  sources: readonly Citation[],
): Map<string, { title: string; section: string }> {
  // Título y sección de cada cita.
  return new Map(
    sources.map((source) => [source.chunkId, { title: source.title, section: source.section }]),
  );
}

// Ids citados y permitidos dentro de un trozo de texto ya validado.
function citedIn(text: string, allowed: ReadonlySet<string>): string[] {
  // Cada [cite:id] reconocido que pertenece a la evidencia.
  return [...text.matchAll(/\[cite:([A-Za-z0-9:_-]{1,128})\]/g)]
    .map((match) => match[1]!)
    .filter((id) => allowed.has(id));
}

// Mensaje público de error del proveedor; no expone el detalle interno.
export const PUBLIC_PROVIDER_MESSAGE =
  "El proveedor no ha completado la respuesta. El detalle interno no se muestra.";

// Normaliza el consumo del SDK: números o null; si no hay ningún dato, null.
export function usageFrom(
  usage:
    | {
        // Tokens de entrada.
        inputTokens?: number | undefined;
        // Tokens de salida.
        outputTokens?: number | undefined;
        // Total de tokens.
        totalTokens?: number | undefined;
      }
    | undefined,
): RunMetadata["usage"] {
  // Sin consumo: null.
  if (usage === undefined) {
    // null.
    return null;
  }
  // Tokens de entrada o null.
  const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : null;
  // Tokens de salida o null.
  const outputTokens = typeof usage.outputTokens === "number" ? usage.outputTokens : null;
  // Total o null.
  const totalTokens = typeof usage.totalTokens === "number" ? usage.totalTokens : null;
  // Ningún dato: null.
  if (inputTokens === null && outputTokens === null && totalTokens === null) {
    // null.
    return null;
  }
  // Consumo normalizado.
  return { inputTokens, outputTokens, totalTokens };
}

// Flujo con un texto fijo: la demo usa el mismo formato que una respuesta real.
export function streamFixedCourseResponse(input: {
  // Metadatos de la ejecución.
  metadata: RunMetadata;
  // Traza de pasos o null.
  trace: TraceEvent | null;
  // Fuentes que se citan.
  sources: readonly Citation[];
  // Texto completo de la respuesta.
  text: string;
  // Señal de cancelación.
  signal: AbortSignal;
  // Si se filtran las citas desconocidas.
  validateCitations: boolean;
  // Pasos del modo clase, solo en el RAG básico.
  ragSteps?: RagStepsInput;
}): Response {
  // Crea el flujo; execute escribe las partes en orden.
  const stream = createUIMessageStream<CourseUIMessage>({
    // Produce las partes del stream dentro del ciclo de ejecución del protocolo de mensajes.
    execute: async ({ writer }) => {
      // Inicio del mensaje, marcado como en curso.
      writer.write({
        type: "start",
        messageMetadata: { ...input.metadata, completion: "streaming" },
      });
      // Si hay traza, la envía como parte de datos.
      if (input.trace) {
        // Parte data-trace.
        writer.write({ type: "data-trace", id: "trace", data: input.trace });
      }
      // Pasos de la búsqueda del modo clase: transitorios, no se guardan en el mensaje.
      for (const step of input.ragSteps?.retrieval ?? [])
        // Publica el paso para el grafo en directo.
        writer.write({ type: "data-rag-step", data: step, transient: true });
      // ¿La búsqueda terminó sin generar (rechazo o aclaración)?
      const lastStep = input.ragSteps?.retrieval.at(-1);
      const generates =
        input.ragSteps !== undefined && lastStep?.kind !== "refuse" && lastStep?.kind !== "clarify";
      // Una parte data-source por fuente.
      for (const source of input.sources)
        // Publica una parte del protocolo de mensajes para que la interfaz reciba la evidencia del stream.
        writer.write({ type: "data-source", id: source.chunkId, data: source });
      // Paso de generación de la plantilla, si la búsqueda llevó a responder.
      if (generates)
        // Publica el paso para el grafo en directo.
        writer.write({
          type: "data-rag-step",
          data: ragGenerateStep({
            query: input.ragSteps!.query,
            model: input.ragSteps!.model,
            chunkIds: input.sources.map((source) => source.chunkId),
            labels: sourceLabels(input.sources),
          }),
          transient: true,
        });
      // Empieza el bloque de texto "answer".
      writer.write({ type: "text-start", id: "answer" });
      // Ids de fragmentos permitidos en las citas.
      const allowed = new Set(input.sources.map((source) => source.chunkId));
      // Envía todo el texto de una vez, sin citas desconocidas si se pide.
      writer.write({
        type: "text-delta",
        id: "answer",
        delta: input.validateCitations ? suppressUnknownCitations(input.text, allowed) : input.text,
      });
      // Si se canceló, termina como aborted.
      if (input.signal.aborted) {
        // Cierre con completion aborted.
        writer.write({
          type: "finish",
          messageMetadata: { ...input.metadata, completion: "aborted" },
        });
        // Sale sin cerrar el texto.
        return;
      }
      // Cierra el bloque de texto.
      writer.write({ type: "text-end", id: "answer" });
      // Paso final de la plantilla con sus citas.
      if (generates)
        // Publica el paso para el grafo en directo.
        writer.write({
          type: "data-rag-step",
          data: ragAnswerStep({
            query: input.ragSteps!.query,
            model: input.ragSteps!.model,
            durationMs: null,
            citedIds: [...new Set(citedIn(input.text, allowed))],
            labels: sourceLabels(input.sources),
          }),
          transient: true,
        });
      // Fin con los metadatos.
      writer.write({ type: "finish", messageMetadata: input.metadata });
    },
    // Transforma el fallo del stream en el mensaje que recibirá el consumidor.
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  // Respuesta HTTP en streaming, sin caché y con el origen en una cabecera.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": input.metadata.origin,
    },
  });
}

// Flujo en directo desde el modelo, con citas validadas y coste al final.
export function streamProviderCourseResponse(input: {
  // Modelo ya creado.
  model: LanguageModel;
  // Instrucciones de sistema.
  system: string;
  // Historial de mensajes.
  messages: readonly { role: "user" | "assistant"; content: string }[];
  // Metadatos de la ejecución.
  metadata: RunMetadata;
  // Traza de pasos.
  trace: TraceEvent;
  // Fuentes recuperadas.
  sources: readonly Citation[];
  // Señal de cancelación.
  signal: AbortSignal;
  // Si se filtran las citas desconocidas.
  validateCitations: boolean;
  // Si solo se muestran las fuentes citadas.
  onlyCitedSources?: boolean;
  // Tope de tokens de salida.
  maxOutputTokens?: number;
  // Tope del perfil, idéntico al de generación en CRAG cuando se comparan ambos recorridos.
  timeoutMs?: number;
  /** Tarifa del coste mostrado; null lo deja desconocido y sin valor usa la de Claude Haiku 5.5. */
  costPricing?: CostPricing | null;
  // Pasos del modo clase, solo en el RAG básico.
  ragSteps?: RagStepsInput;
}): Response {
  // Ids permitidos en las citas.
  const allowed = new Set(input.sources.map((source) => source.chunkId));
  // Crea el flujo de mensajes.
  const stream = createUIMessageStream<CourseUIMessage>({
    // Produce las partes del stream dentro del ciclo de ejecución del protocolo de mensajes.
    execute: async ({ writer }) => {
      // Inicio, marcado como en curso.
      writer.write({
        type: "start",
        messageMetadata: { ...input.metadata, completion: "streaming" },
      });
      // Envía la traza.
      writer.write({ type: "data-trace", id: "trace", data: input.trace });
      // Pasos de la búsqueda del modo clase: transitorios, no se guardan en el mensaje.
      for (const step of input.ragSteps?.retrieval ?? [])
        // Publica el paso para el grafo en directo.
        writer.write({ type: "data-rag-step", data: step, transient: true });
      // Citas válidas que ya se han escrito, para el paso final.
      const cited = new Set<string>();
      // Fuentes ya mostradas.
      const shown = new Set<string>();
      // Fuente por chunkId.
      const sourceMap = new Map(input.sources.map((source) => [source.chunkId, source]));
      // Muestra las fuentes citadas en un trozo de texto, una sola vez cada una.
      function showCited(text: string) {
        // Recorre cada [cite:id] del texto.
        for (const match of text.matchAll(/\[cite:([A-Za-z0-9:_-]{1,128})\]/g)) {
          // Fuente de ese id.
          const source = sourceMap.get(match[1]!);
          // Si existe y no se ha mostrado.
          if (source && !shown.has(source.chunkId)) {
            // La marca como mostrada.
            shown.add(source.chunkId);
            // Envía la fuente.
            writer.write({ type: "data-source", id: source.chunkId, data: source });
          }
        }
      }
      // Sin onlyCitedSources se envían todas las fuentes al principio.
      if (!input.onlyCitedSources)
        for (const source of input.sources) {
          // Parte data-source.
          writer.write({ type: "data-source", id: source.chunkId, data: source });
        }
      // try/catch: un fallo del modelo cierra el mensaje como error.
      try {
        // Llama al modelo en streaming con tope de salida, sin reintentos y con plazo total.
        const result = streamText({
          model: input.model,
          system: input.system,
          messages: [...input.messages],
          maxOutputTokens: input.maxOutputTokens ?? LIMITS.maxOutputTokens,
          maxRetries: LIMITS.maxRetries,
          abortSignal: input.signal,
          timeout: { totalMs: input.timeoutMs ?? LIMITS.generationTimeoutMs },
        });
        // Paso de generación en directo, justo cuando el modelo empieza a escribir.
        const generationStarted = Date.now();
        if (input.ragSteps)
          // Publica el paso para el grafo en directo.
          writer.write({
            type: "data-rag-step",
            data: ragGenerateStep({
              query: input.ragSteps.query,
              model: input.ragSteps.model,
              chunkIds: input.sources.map((source) => source.chunkId),
              labels: sourceLabels(input.sources),
            }),
            transient: true,
          });
        // Empieza el bloque de texto.
        writer.write({ type: "text-start", id: "answer" });
        // Texto retenido que puede contener una cita a medias.
        let pending = "";
        // Recorre cada trozo de texto que llega del modelo.
        for await (const delta of result.textStream) {
          // Sin validar citas, se reenvía tal cual.
          if (!input.validateCitations) {
            // Trozo de texto.
            writer.write({ type: "text-delta", id: "answer", delta });
            // Siguiente trozo.
            continue;
          }
          // Separa lo que ya se puede emitir de una cita aún incompleta.
          const split = splitCitationBuffer(pending + delta, allowed);
          // Guarda el resto para el siguiente trozo.
          pending = split.rest;
          // Si hay algo que emitir.
          if (split.emit.length > 0) {
            // Muestra las fuentes que cita.
            if (input.onlyCitedSources)
              // Entrega texto al filtro de citas antes de publicarlo en la respuesta visible.
              showCited(split.emit);
            // Anota las citas válidas para el paso final.
            for (const id of citedIn(split.emit, allowed)) cited.add(id);
            // Envía el texto.
            writer.write({ type: "text-delta", id: "answer", delta: split.emit });
          }
        }
        // Al terminar, queda texto retenido.
        if (pending.length > 0) {
          // Muestra sus fuentes.
          if (input.onlyCitedSources)
            // Entrega texto al filtro de citas antes de publicarlo en la respuesta visible.
            showCited(pending);
          // Texto final, filtrando citas desconocidas.
          const tail = input.validateCitations
            ? suppressUnknownCitations(pending, allowed)
            : pending;
          // Anota sus citas válidas para el paso final.
          for (const id of citedIn(tail, allowed)) cited.add(id);
          // Lo envía.
          writer.write({ type: "text-delta", id: "answer", delta: tail });
        }
        // Cancelado: cierra como aborted sin consumo ni coste.
        if (input.signal.aborted) {
          // Cierre aborted.
          writer.write({
            type: "finish",
            messageMetadata: { ...input.metadata, completion: "aborted", usage: null, cost: null },
          });
          // Sale.
          return;
        }
        // Motivo de parada normalizado.
        const reason = await result.finishReason;
        // Motivo original del proveedor.
        const rawReason = await result.rawFinishReason;
        // Si el modelo se negó, se trata como fallo.
        if (refusedByModel(reason, rawReason)) {
          // Error genérico.
          throw new Error("provider-failed");
        }
        // Consumo total de tokens.
        const usage = await result.totalUsage;
        // Cierra el bloque de texto.
        writer.write({ type: "text-end", id: "answer" });
        // Paso final con la duración de la generación y las citas validadas.
        if (input.ragSteps)
          // Publica el paso para el grafo en directo.
          writer.write({
            type: "data-rag-step",
            data: ragAnswerStep({
              query: input.ragSteps.query,
              model: input.ragSteps.model,
              durationMs: Date.now() - generationStarted,
              citedIds: [...cited],
              labels: sourceLabels(input.sources),
            }),
            transient: true,
          });
        // Fin con metadatos validados: completo, consumo y coste.
        writer.write({
          type: "finish",
          messageMetadata: runMetadataSchema.parse({
            ...input.metadata,
            completion: "complete",
            usage: usageFrom(usage),
            cost: providerCost(usage, input.costPricing),
          }),
        });
      } catch (error) {
        // ¿Fue una cancelación?
        const aborted = error instanceof DOMException && error.name === "AbortError";
        // Cierre como aborted o error, sin consumo ni coste.
        writer.write({
          type: "finish",
          messageMetadata: {
            ...input.metadata,
            completion: aborted ? "aborted" : "error",
            usage: null,
            cost: null,
          },
        });
        // Si no fue cancelación, propaga el fallo.
        if (!aborted) {
          // onError lo convierte en el mensaje público.
          throw new Error("provider-failed");
        }
      }
    },
    // Transforma el fallo del stream en el mensaje que recibirá el consumidor.
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  // Respuesta HTTP en streaming, sin caché.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": input.metadata.origin,
    },
  });
}

// Reexporta el filtro de citas para otros módulos.
export { suppressUnknownCitations };
