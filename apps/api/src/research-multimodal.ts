// GUÍA DE LECTURA · apps/api/src/research-multimodal.ts
// Entrada y salida multimodal de la investigación: lee la imagen y transcribe el audio del trabajo,
// funde lo leído con la pregunta escrita, recuerda el turno admitido y, si se pidió, genera la voz.
// Límites y tipos de medios, resultado, fuente y resumen.
import {
  RESEARCH_LIMITS,
  type ResearchMedia,
  type ResearchOutcome,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
// Fusión de entradas y guion hablado del paquete de investigación.
import {
  fuseInputs,
  spokenScript,
  type FusionInputText,
  type ResearchPorts,
} from "@thepower-rag/research";
// Tipo de la base de datos.
import type { ResearchDatabase } from "./research-db";
// Diario de llamadas de medios (reserva antes de llamar).
import { journalMediaCall } from "./research-journal";
// Memoria de turnos admitidos.
import { RESEARCH_MEMORY_HEADER, admittedTurnText } from "./research-memory";
// Inspección y hash de bytes; tono WAV de prueba.
import { inspectMedia, sha256Bytes, toneWav } from "./media-bytes";
// Filas y objetos de medios.
import {
  assetById,
  insertAsset,
  markAssetText,
  readMediaObject,
  type ResearchMediaBucket,
} from "./research-media";
// Lecturas de prueba y tipos de percepción.
import {
  fixtureImage,
  fixtureTranscript,
  type ImageRead,
  type TranscriptRead,
  type WorkersAi,
} from "./research-perception";
// Llamadas reales a visión, Whisper y Aura.
import { visionImage, workersSpeech, workersTranscript } from "./research-perception-real";
// Tipo de las tarifas congeladas.
import type { PriceSnapshot } from "./research-money";
// Entrada del trabajo y memoria de la conversación.
import { readJobInput, rememberAdmittedTurn, type JobRow } from "./research-store";
// Tipo del modelo de lenguaje.
import type { LanguageModel } from "ai";
// Tipo de tarifa por tokens.
import type { TokenPrices } from "./env";

// Lo que necesita la percepción en este entorno.
export interface MultimodalContext {
  // Demo o real.
  mode: "demo" | "real";
  // Bucket de medios o null.
  bucket: ResearchMediaBucket | null;
  // Workers AI o null.
  ai: WorkersAi | null;
  // Modelo de visión o null.
  vision: LanguageModel | null;
  // Id del modelo de visión.
  visionModelId: string | null;
  /** Tarifa del consumo estimado de visión; sin valor, la publicada de Claude Haiku 5.5. */
  visionPrices?: TokenPrices | null;
  // Modelo de transcripción.
  sttModelId: string;
  // Modelo de voz.
  ttsModelId: string;
  // Señal de cancelación.
  signal: AbortSignal;
}

// Estado vacío de medios.
const EMPTY_MEDIA: ResearchMedia = {
  visionCalls: 0,
  transcriptionCalls: 0,
  speechCalls: 0,
  image: null,
  audio: null,
  conflict: null,
  speech: null,
};

// Convierte el texto leído de un adjunto en una fuente citable.
function attachmentSource(
  role: "image" | "audio",
  assetId: string,
  hash: string,
  text: string,
): ResearchSource {
  // Fuente de tipo attachment aportada por el alumno.
  return {
    kind: "attachment",
    sourceId: `attachment:${role}:${assetId}`,
    role,
    assetId,
    title: role === "image" ? "Texto leído en la imagen" : "Transcripción del audio",
    excerpts: [text.slice(0, RESEARCH_LIMITS.maxExcerptChars)],
    contentHash: hash,
    authority: "user-input",
    subquestionIds: [],
  };
}

// Lee un archivo solo si es del propietario y de esta conversación.
async function readOwned(
  database: ResearchDatabase,
  bucket: ResearchMediaBucket,
  ownerId: string,
  assetId: string,
  conversationId: string,
) {
  // Fila del archivo.
  const row = await assetById(database, ownerId, assetId);
  // Otra conversación o inexistente: null.
  if (!row || row.conversation_id !== conversationId) return null;
  // Objeto de R2.
  const object = await readMediaObject(bucket, row.object_key);
  // Sin objeto: null.
  if (!object) return null;
  // Fila y bytes.
  return { row, bytes: object.body };
}

// Prepara la pregunta de un trabajo con imagen o audio.
export async function perceiveJob(
  database: ResearchDatabase,
  job: JobRow,
  prices: PriceSnapshot,
  context: MultimodalContext,
): Promise<
  | { kind: "absent" }
  | { kind: "blocked"; detail: string }
  | {
      // Listo para investigar.
      kind: "ready";
      // Pregunta final.
      question: string;
      // Estado de medios.
      media: ResearchMedia;
      // Fuentes de los adjuntos.
      sources: ResearchSource[];
      // Si se puede seguir.
      proceed: boolean;
      // Aclaración pedida o null.
      clarify: string | null;
    }
> {
  // Entrada multimodal del trabajo.
  const input = await readJobInput(database, job.id);
  // Sin imagen, audio ni voz.
  if (
    !input ||
    (input.image_asset_id === null && input.audio_asset_id === null && input.voice === 0)
  ) {
    // Nada que percibir.
    return { kind: "absent" };
  }
  // Hay medios pero no almacén.
  if (
    (input.image_asset_id || input.audio_asset_id || input.voice === 1) &&
    context.bucket === null
  ) {
    // Bloqueado.
    return { kind: "blocked", detail: "Falta el almacén privado de medios." };
  }
  // Solo voz: la pregunta es la escrita.
  if (input.image_asset_id === null && input.audio_asset_id === null) {
    // Listo con la pregunta del trabajo.
    return {
      kind: "ready",
      question: (job.contextualized_question ?? job.original_question).slice(
        0,
        RESEARCH_LIMITS.maxQuestionChars,
      ),
      media: { ...EMPTY_MEDIA },
      sources: [],
      proceed: true,
      clarify: null,
    };
  }
  // Bucket.
  const bucket = context.bucket;
  // Medios vacíos.
  const media: ResearchMedia = { ...EMPTY_MEDIA, image: null, audio: null };
  // Fuentes.
  const sources: ResearchSource[] = [];
  // Texto leído de la imagen.
  let imageText: FusionInputText | null = null;
  // Texto transcrito.
  let audioText: FusionInputText | null = null;
  // Hay imagen.
  if (input.image_asset_id && bucket) {
    // En real sin modelo de visión: bloqueado.
    if (context.mode === "real" && (context.vision === null || context.visionModelId === null)) {
      // Motivo.
      return { kind: "blocked", detail: "La visión real no está configurada." };
    }
    // Lee la imagen propia.
    const loaded = await readOwned(
      database,
      bucket,
      job.owner_id,
      input.image_asset_id,
      job.conversation_id,
    );
    // Rol o hash distintos de la subida: bloqueado.
    if (!loaded || loaded.row.role !== "image" || loaded.row.content_hash !== input.image_hash) {
      // Motivo.
      return { kind: "blocked", detail: "La imagen no pertenece a esta conversación." };
    }
    // Datos de la imagen.
    const facts = await inspectMedia(loaded.bytes);
    // MIME si es válida.
    const mime = facts.ok && facts.facts.role === "image" ? facts.facts.mime : null;
    // Una llamada de visión.
    media.visionCalls = 1;
    // Llamada registrada en el diario: real o de prueba.
    const result = await journalMediaCall<ImageRead>(database, job, prices, {
      kind: "vision",
      payload: { hash: loaded.row.content_hash, model: context.visionModelId ?? "fixture-vision" },
      signal: context.signal,
      invoke: (signal) =>
        context.mode === "real" && context.vision && mime
          ? visionImage(
              context.vision,
              loaded.bytes,
              mime,
              signal,
              context.visionPrices ?? undefined,
            )
          : fixtureImage(loaded.bytes),
    });
    // Estado: leída, desconocida para el guion o fallida.
    const status = result.ok
      ? "read"
      : result.detail.includes("no conoce")
        ? "unknown-fixture"
        : "failed";
    // Texto observado.
    const observed = result.ok ? result.value.observedText : "";
    // Resultado de la imagen.
    media.image = {
      assetId: loaded.row.id,
      contentHash: loaded.row.content_hash,
      status,
      observedText: observed,
      notes: result.ok ? result.value.notes : "",
      uncertain: result.ok ? result.value.uncertain : true,
      detail: result.ok ? "Imagen leída." : result.detail,
    };
    // Texto para la fusión.
    imageText = { status, text: observed, detail: media.image.detail };
    // Guarda el texto en la fila.
    await markAssetText(database, loaded.row.id, status, observed, media.image.detail);
    // Si hay texto.
    if (observed.length > 0) {
      // Lo añade como fuente.
      sources.push(attachmentSource("image", loaded.row.id, loaded.row.content_hash, observed));
    }
  }
  // Hay audio.
  if (input.audio_asset_id && bucket) {
    // En real sin Workers AI: bloqueado.
    if (context.mode === "real" && context.ai === null) {
      // Motivo.
      return { kind: "blocked", detail: "Falta el binding de Workers AI para transcribir." };
    }
    // Lee el audio propio.
    const loaded = await readOwned(
      database,
      bucket,
      job.owner_id,
      input.audio_asset_id,
      job.conversation_id,
    );
    // Rol o hash distintos: bloqueado.
    if (!loaded || loaded.row.role !== "audio" || loaded.row.content_hash !== input.audio_hash) {
      // Motivo.
      return { kind: "blocked", detail: "El audio no pertenece a esta conversación." };
    }
    // Una llamada de transcripción.
    media.transcriptionCalls = 1;
    // Transcripción registrada en el diario.
    const result = await journalMediaCall<TranscriptRead>(database, job, prices, {
      kind: "transcribe",
      durationMs: loaded.row.duration_ms ?? input.audio_duration_ms ?? undefined,
      payload: {
        hash: loaded.row.content_hash,
        model: context.sttModelId,
        durationMs: loaded.row.duration_ms,
      },
      signal: context.signal,
      invoke: (signal) =>
        context.mode === "real" && context.ai
          ? workersTranscript(context.ai, context.sttModelId, loaded.bytes, signal)
          : fixtureTranscript(loaded.bytes),
    });
    // Estado.
    const status = result.ok
      ? "read"
      : result.detail.includes("no conoce")
        ? "unknown-fixture"
        : "failed";
    // Transcripción.
    const transcript = result.ok ? result.value.transcript : "";
    // Resultado del audio.
    media.audio = {
      assetId: loaded.row.id,
      contentHash: loaded.row.content_hash,
      status,
      transcript,
      detail: result.ok ? "Audio transcrito." : result.detail,
      language: result.ok ? result.value.language : null,
      durationSeconds: result.ok ? result.value.durationSeconds : null,
      wordCount: result.ok ? result.value.wordCount : null,
    };
    // Texto para la fusión.
    audioText = { status, text: transcript, detail: media.audio.detail };
    // Guarda la transcripción.
    await markAssetText(database, loaded.row.id, status, transcript, media.audio.detail);
    // Si hay texto.
    if (transcript.length > 0) {
      // Lo añade como fuente.
      sources.push(attachmentSource("audio", loaded.row.id, loaded.row.content_hash, transcript));
    }
  }
  // Funde pregunta escrita, imagen y audio.
  const fused = fuseInputs({ typed: job.original_question, image: imageText, audio: audioText });
  // Conflicto detectado entre entradas.
  media.conflict = fused.conflict;
  // Texto del turno que se recordará.
  const remembered = admittedTurnText({
    typed: job.original_question,
    image:
      imageText?.status === "read" && imageText.text.length > 0 && input.image_asset_id
        ? { id: input.image_asset_id, text: imageText.text }
        : null,
    audio:
      audioText?.status === "read" && audioText.text.length > 0 && input.audio_asset_id
        ? { id: input.audio_asset_id, text: audioText.text }
        : null,
  });
  // Si se leyó algo.
  if (
    (imageText?.status === "read" && imageText.text.length > 0) ||
    (audioText?.status === "read" && audioText.text.length > 0)
  ) {
    // Lo guarda en la memoria de la conversación.
    await rememberAdmittedTurn(database, {
      ownerId: job.owner_id,
      conversationId: job.conversation_id,
      jobId: job.id,
      idempotencyKey: job.idempotency_key,
      text: remembered,
    });
  }
  // Pregunta final con la memoria previa.
  const question = mergeMemory(
    job.contextualized_question,
    fused.question || job.original_question,
  );
  // Resultado listo.
  return {
    kind: "ready",
    question,
    media,
    sources,
    proceed: fused.proceed,
    clarify: fused.clarify,
  };
}

// Une la memoria previa con la pregunta actual sin pasar del máximo.
function mergeMemory(contextualized: string | null, question: string): string {
  // Pregunta actual recortada.
  const current = question.slice(0, RESEARCH_LIMITS.maxQuestionChars);
  // Sin memoria: solo la actual.
  if (!contextualized) return current;
  // Marcador que separa memoria y pregunta.
  const marker = "\n\nPregunta actual:\n";
  // Última aparición.
  const index = contextualized.lastIndexOf(marker);
  // Sin marcador: solo la actual.
  if (index === -1) return current;
  // Memoria.
  const prefix = contextualized.slice(0, index);
  // Combinación.
  const combined = `${prefix}${marker}${current}`;
  // Si cabe, se usa.
  if (combined.length <= RESEARCH_LIMITS.maxQuestionChars) return combined;
  // Espacio que queda para la memoria.
  const room = RESEARCH_LIMITS.maxQuestionChars - marker.length - current.length;
  // Muy poco: solo la actual.
  if (room < 40) return current;
  // Memoria recortada y pregunta.
  return `${keptMemory(prefix, room)}${marker}${current}`;
}

/** Conserva la cabecera y el final de la memoria, que es el turno más reciente. */
function keptMemory(prefix: string, room: number): string {
  // Con cabecera y espacio: cabecera más el final del cuerpo.
  if (prefix.startsWith(RESEARCH_MEMORY_HEADER) && RESEARCH_MEMORY_HEADER.length < room) {
    // Cuerpo.
    const body = prefix.slice(RESEARCH_MEMORY_HEADER.length);
    // Espacio para el cuerpo.
    const bodyRoom = room - RESEARCH_MEMORY_HEADER.length;
    // Final del cuerpo.
    const tail = body.length > bodyRoom ? body.slice(body.length - bodyRoom) : body;
    // Cabecera y final.
    return `${RESEARCH_MEMORY_HEADER}${tail}`;
  }
  // Sin cabecera: el final que quepa.
  return prefix.length > room ? prefix.slice(prefix.length - room) : prefix;
}

// Genera la voz del informe si el trabajo la pidió.
export async function speakAnswer(input: {
  // Base de datos.
  database: ResearchDatabase;
  // Trabajo.
  job: JobRow;
  // Tarifas.
  prices: PriceSnapshot;
  // Contexto.
  context: MultimodalContext;
  // Resultado de la investigación.
  outcome: ResearchOutcome;
  // Texto del informe.
  reportText: string;
  // Extractos citados.
  excerpts: readonly string[];
  // Estado de medios.
  media: ResearchMedia;
}): Promise<ResearchMedia> {
  // Entrada del trabajo.
  const binding = await readJobInput(input.database, input.job.id);
  // Sin voz pedida: sin cambios.
  if (!binding || binding.voice !== 1) return input.media;
  // Guion hablado.
  const text = spokenScript({
    outcome: input.outcome,
    reportText: input.reportText,
    excerpts: input.excerpts,
    conflict: input.media.conflict,
    perceptionFailed:
      input.media.image?.status === "failed" ||
      input.media.image?.status === "unknown-fixture" ||
      input.media.audio?.status === "failed" ||
      input.media.audio?.status === "unknown-fixture",
  });
  // Sin tiempo en el plazo: se salta.
  if (Date.now() + RESEARCH_LIMITS.minCallMs > input.job.deadline_at) {
    // Voz omitida.
    return {
      ...input.media,
      speech: {
        status: "skipped",
        text,
        assetId: null,
        mime: null,
        detail: "No queda tiempo en el plazo del trabajo para generar voz.",
        fixture: input.context.mode !== "real",
      },
    };
  }
  // Sin almacén.
  if (input.context.bucket === null) {
    // Voz no configurada.
    return {
      ...input.media,
      speech: {
        status: "unconfigured",
        text,
        assetId: null,
        mime: null,
        detail: "Falta el almacén para guardar el audio.",
        fixture: input.context.mode !== "real",
      },
    };
  }
  // En real sin Workers AI.
  if (input.context.mode === "real" && input.context.ai === null) {
    // Voz no configurada.
    return {
      ...input.media,
      speech: {
        status: "unconfigured",
        text,
        assetId: null,
        mime: null,
        detail: "La voz real no está configurada. El informe se conserva.",
        fixture: false,
      },
    };
  }
  // Huella del guion.
  const digest = await sha256Bytes(new TextEncoder().encode(`${input.outcome}:${text}`));
  // Bucket.
  const bucket = input.context.bucket;
  // Llamada de voz registrada en el diario.
  const result = await journalMediaCall<{ assetId: string; mime: string }>(
    input.database,
    input.job,
    input.prices,
    {
      kind: "speech",
      speechChars: text.length,
      payload: { digest, speaker: "aquila", model: input.context.ttsModelId, chars: text.length },
      signal: input.context.signal,
      invoke: async (signal) => {
        // Audio real o tono local de prueba.
        const produced =
          input.context.mode === "real" && input.context.ai
            ? await workersSpeech(input.context.ai, input.context.ttsModelId, text, signal)
            : {
                ok: true as const,
                value: toneWav(),
                consumption: { kind: "none" as const },
              };
        // Fallo: se devuelve.
        if (!produced.ok) return produced;
        // Id del audio.
        const id = crypto.randomUUID();
        // MIME.
        const mime = input.context.mode === "real" ? "audio/mpeg" : "audio/wav";
        // Clave en R2.
        const key = `research/${input.job.owner_id}/${input.job.conversation_id}/speech/${id}`;
        // Guarda el audio.
        await bucket.put(key, produced.value, { httpMetadata: { contentType: mime } });
        // Hash.
        const hash = await sha256Bytes(produced.value);
        // Fila del audio.
        await insertAsset(input.database, {
          id,
          owner_id: input.job.owner_id,
          conversation_id: input.job.conversation_id,
          role: "speech",
          object_key: key,
          content_hash: hash,
          mime,
          byte_size: produced.value.byteLength,
          width: null,
          height: null,
          duration_ms: null,
          sample_rate: null,
          channels: null,
          bit_depth: null,
          status: "ready",
          extracted_text: text,
          detail:
            input.context.mode === "real"
              ? "Audio del modelo."
              : "Tono local de prueba, no es una voz neural.",
          job_id: input.job.id,
          idempotency_key: `speech:${input.job.id}`,
          created_at: Date.now(),
        });
        // Id y MIME.
        return { ok: true, value: { assetId: id, mime }, consumption: produced.consumption };
      },
    },
  );
  // Fallo.
  if (!result.ok) {
    // Voz fallida.
    return {
      ...input.media,
      speechCalls: 1,
      speech: {
        status: "failed",
        text,
        assetId: null,
        mime: null,
        detail: result.detail,
        fixture: input.context.mode !== "real",
      },
    };
  }
  // Voz lista.
  return {
    ...input.media,
    speechCalls: 1,
    speech: {
      status: "ready",
      text,
      assetId: result.value.assetId,
      mime: result.value.mime,
      detail:
        input.context.mode === "real"
          ? "Voz generada."
          : "Audio de prueba local, no es la voz del modelo.",
      fixture: input.context.mode !== "real",
    },
  };
}

// Resumen mínimo cuando la entrada multimodal no llega a investigarse.
export function shellSummary(
  job: JobRow,
  ports: Pick<ResearchPorts, "fixture" | "measured" | "estimatedMaxUsd">,
  outcome: ResearchOutcome,
  detail: string,
  reportText: string,
  media: ResearchMedia,
): ResearchSummary {
  // Resumen con contadores a cero.
  return {
    runId: job.run_id,
    fixture: ports.fixture,
    scenarioId: job.scenario_id,
    measured: ports.measured,
    audience: job.audience,
    corpusVersion: job.corpus_version,
    originalQuestion: (job.original_question || reportText).slice(
      0,
      RESEARCH_LIMITS.maxQuestionChars,
    ),
    threadId: job.conversation_id,
    jobId: job.id,
    contextualizedQuestion: null,
    route: null,
    planRationale: null,
    subquestions: [],
    rounds: 0,
    courseQueries: [],
    toolCalls: [],
    searches: [],
    discovered: [],
    pagesRead: [],
    accepted: [],
    rejected: [],
    coverage: [],
    contradictions: [],
    followUp: null,
    stop: outcome === "clarify" ? "clarify" : "invalid-output",
    stopDetail: detail.slice(0, RESEARCH_LIMITS.maxReasonChars),
    outcome,
    claimCheck: { method: "Sin informe de investigación.", checked: 0, dropped: [] },
    citedSourceIds: [],
    counters: {
      searchCalls: 0,
      pagesRead: 0,
      modelCalls: 0,
      toolCalls: 0,
      courseQueries: 0,
      elapsedMs: null,
    },
    limits: {
      maxSubquestions: RESEARCH_LIMITS.maxSubquestions,
      maxRounds: RESEARCH_LIMITS.maxRounds,
      maxSearchCalls: RESEARCH_LIMITS.maxSearchCalls,
      maxPagesRead: RESEARCH_LIMITS.maxPagesRead,
      deadlineMs: RESEARCH_LIMITS.deadlineMs,
    },
    accounting: {
      measured: ports.measured,
      estimatedMaxUsd: ports.estimatedMaxUsd,
      providerReportedUsd: null,
      providerReportedCredits: null,
      unknownConsumptionCalls: 0,
      finalAnswerUsd: null,
      totalComplete: false,
      note: "La entrada multimodal no llegó a investigarse. La reserva de lo no enviado se libera al cerrar.",
    },
    trace: [{ runId: job.run_id, node: "validate", round: 0, status: detail.slice(0, 240) }],
    media,
  };
}
