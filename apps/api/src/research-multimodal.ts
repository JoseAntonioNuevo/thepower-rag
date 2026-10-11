import {
  RESEARCH_LIMITS,
  type ResearchMedia,
  type ResearchOutcome,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
import {
  fuseInputs,
  spokenScript,
  type FusionInputText,
  type ResearchPorts,
} from "@thepower-rag/research";
import type { ResearchDatabase } from "./research-db";
import { journalMediaCall } from "./research-journal";
import { RESEARCH_MEMORY_HEADER, admittedTurnText } from "./research-memory";
import { inspectMedia, sha256Bytes, toneWav } from "./media-bytes";
import {
  assetById,
  insertAsset,
  markAssetText,
  readMediaObject,
  type ResearchMediaBucket,
} from "./research-media";
import {
  fixtureImage,
  fixtureTranscript,
  type ImageRead,
  type TranscriptRead,
  type WorkersAi,
} from "./research-perception";
import { anthropicImage, workersSpeech, workersTranscript } from "./research-perception-real";
import type { PriceSnapshot } from "./research-money";
import { readJobInput, rememberAdmittedTurn, type JobRow } from "./research-store";
import type { LanguageModel } from "ai";

export interface MultimodalContext {
  mode: "demo" | "real";
  bucket: ResearchMediaBucket | null;
  ai: WorkersAi | null;
  vision: LanguageModel | null;
  visionModelId: string | null;
  sttModelId: string;
  ttsModelId: string;
  signal: AbortSignal;
}

const EMPTY_MEDIA: ResearchMedia = {
  visionCalls: 0,
  transcriptionCalls: 0,
  speechCalls: 0,
  image: null,
  audio: null,
  conflict: null,
  speech: null,
};

function attachmentSource(
  role: "image" | "audio",
  assetId: string,
  hash: string,
  text: string,
): ResearchSource {
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

async function readOwned(
  database: ResearchDatabase,
  bucket: ResearchMediaBucket,
  ownerId: string,
  assetId: string,
  conversationId: string,
) {
  const row = await assetById(database, ownerId, assetId);
  if (!row || row.conversation_id !== conversationId) return null;
  const object = await readMediaObject(bucket, row.object_key);
  if (!object) return null;
  return { row, bytes: object.body };
}

export async function perceiveJob(
  database: ResearchDatabase,
  job: JobRow,
  prices: PriceSnapshot,
  context: MultimodalContext,
): Promise<
  | { kind: "absent" }
  | { kind: "blocked"; detail: string }
  | {
      kind: "ready";
      question: string;
      media: ResearchMedia;
      sources: ResearchSource[];
      proceed: boolean;
      clarify: string | null;
    }
> {
  const input = await readJobInput(database, job.id);
  if (
    !input ||
    (input.image_asset_id === null && input.audio_asset_id === null && input.voice === 0)
  ) {
    return { kind: "absent" };
  }
  if (
    (input.image_asset_id || input.audio_asset_id || input.voice === 1) &&
    context.bucket === null
  ) {
    return { kind: "blocked", detail: "Falta el almacén privado de medios." };
  }
  if (input.image_asset_id === null && input.audio_asset_id === null) {
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
  const bucket = context.bucket;
  const media: ResearchMedia = { ...EMPTY_MEDIA, image: null, audio: null };
  const sources: ResearchSource[] = [];
  let imageText: FusionInputText | null = null;
  let audioText: FusionInputText | null = null;
  if (input.image_asset_id && bucket) {
    if (context.mode === "real" && (context.vision === null || context.visionModelId === null)) {
      return { kind: "blocked", detail: "La visión real no está configurada." };
    }
    const loaded = await readOwned(
      database,
      bucket,
      job.owner_id,
      input.image_asset_id,
      job.conversation_id,
    );
    if (!loaded || loaded.row.role !== "image" || loaded.row.content_hash !== input.image_hash) {
      return { kind: "blocked", detail: "La imagen no pertenece a esta conversación." };
    }
    const facts = await inspectMedia(loaded.bytes);
    const mime = facts.ok && facts.facts.role === "image" ? facts.facts.mime : null;
    media.visionCalls = 1;
    const result = await journalMediaCall<ImageRead>(database, job, prices, {
      kind: "vision",
      payload: { hash: loaded.row.content_hash, model: context.visionModelId ?? "fixture-vision" },
      signal: context.signal,
      invoke: (signal) =>
        context.mode === "real" && context.vision && mime
          ? anthropicImage(context.vision, loaded.bytes, mime, signal)
          : fixtureImage(loaded.bytes),
    });
    const status = result.ok
      ? "read"
      : result.detail.includes("no conoce")
        ? "unknown-fixture"
        : "failed";
    const observed = result.ok ? result.value.observedText : "";
    media.image = {
      assetId: loaded.row.id,
      contentHash: loaded.row.content_hash,
      status,
      observedText: observed,
      notes: result.ok ? result.value.notes : "",
      uncertain: result.ok ? result.value.uncertain : true,
      detail: result.ok ? "Imagen leída." : result.detail,
    };
    imageText = { status, text: observed, detail: media.image.detail };
    await markAssetText(database, loaded.row.id, status, observed, media.image.detail);
    if (observed.length > 0) {
      sources.push(attachmentSource("image", loaded.row.id, loaded.row.content_hash, observed));
    }
  }
  if (input.audio_asset_id && bucket) {
    if (context.mode === "real" && context.ai === null) {
      return { kind: "blocked", detail: "Falta el binding de Workers AI para transcribir." };
    }
    const loaded = await readOwned(
      database,
      bucket,
      job.owner_id,
      input.audio_asset_id,
      job.conversation_id,
    );
    if (!loaded || loaded.row.role !== "audio" || loaded.row.content_hash !== input.audio_hash) {
      return { kind: "blocked", detail: "El audio no pertenece a esta conversación." };
    }
    media.transcriptionCalls = 1;
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
    const status = result.ok
      ? "read"
      : result.detail.includes("no conoce")
        ? "unknown-fixture"
        : "failed";
    const transcript = result.ok ? result.value.transcript : "";
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
    audioText = { status, text: transcript, detail: media.audio.detail };
    await markAssetText(database, loaded.row.id, status, transcript, media.audio.detail);
    if (transcript.length > 0) {
      sources.push(attachmentSource("audio", loaded.row.id, loaded.row.content_hash, transcript));
    }
  }
  const fused = fuseInputs({ typed: job.original_question, image: imageText, audio: audioText });
  media.conflict = fused.conflict;
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
  if (
    (imageText?.status === "read" && imageText.text.length > 0) ||
    (audioText?.status === "read" && audioText.text.length > 0)
  ) {
    await rememberAdmittedTurn(database, {
      ownerId: job.owner_id,
      conversationId: job.conversation_id,
      jobId: job.id,
      idempotencyKey: job.idempotency_key,
      text: remembered,
    });
  }
  const question = mergeMemory(
    job.contextualized_question,
    fused.question || job.original_question,
  );
  return {
    kind: "ready",
    question,
    media,
    sources,
    proceed: fused.proceed,
    clarify: fused.clarify,
  };
}

function mergeMemory(contextualized: string | null, question: string): string {
  const current = question.slice(0, RESEARCH_LIMITS.maxQuestionChars);
  if (!contextualized) return current;
  const marker = "\n\nPregunta actual:\n";
  const index = contextualized.lastIndexOf(marker);
  if (index === -1) return current;
  const prefix = contextualized.slice(0, index);
  const combined = `${prefix}${marker}${current}`;
  if (combined.length <= RESEARCH_LIMITS.maxQuestionChars) return combined;
  const room = RESEARCH_LIMITS.maxQuestionChars - marker.length - current.length;
  if (room < 40) return current;
  return `${keptMemory(prefix, room)}${marker}${current}`;
}

/** Conserva la cabecera y el final de la memoria, que es el turno más reciente. */
function keptMemory(prefix: string, room: number): string {
  if (prefix.startsWith(RESEARCH_MEMORY_HEADER) && RESEARCH_MEMORY_HEADER.length < room) {
    const body = prefix.slice(RESEARCH_MEMORY_HEADER.length);
    const bodyRoom = room - RESEARCH_MEMORY_HEADER.length;
    const tail = body.length > bodyRoom ? body.slice(body.length - bodyRoom) : body;
    return `${RESEARCH_MEMORY_HEADER}${tail}`;
  }
  return prefix.length > room ? prefix.slice(prefix.length - room) : prefix;
}

export async function speakAnswer(input: {
  database: ResearchDatabase;
  job: JobRow;
  prices: PriceSnapshot;
  context: MultimodalContext;
  outcome: ResearchOutcome;
  reportText: string;
  excerpts: readonly string[];
  media: ResearchMedia;
}): Promise<ResearchMedia> {
  const binding = await readJobInput(input.database, input.job.id);
  if (!binding || binding.voice !== 1) return input.media;
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
  if (Date.now() + RESEARCH_LIMITS.minCallMs > input.job.deadline_at) {
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
  if (input.context.bucket === null) {
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
  if (input.context.mode === "real" && input.context.ai === null) {
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
  const digest = await sha256Bytes(new TextEncoder().encode(`${input.outcome}:${text}`));
  const bucket = input.context.bucket;
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
        const produced =
          input.context.mode === "real" && input.context.ai
            ? await workersSpeech(input.context.ai, input.context.ttsModelId, text, signal)
            : {
                ok: true as const,
                value: toneWav(),
                consumption: { kind: "none" as const },
              };
        if (!produced.ok) return produced;
        const id = crypto.randomUUID();
        const mime = input.context.mode === "real" ? "audio/mpeg" : "audio/wav";
        const key = `research/${input.job.owner_id}/${input.job.conversation_id}/speech/${id}`;
        await bucket.put(key, produced.value, { httpMetadata: { contentType: mime } });
        const hash = await sha256Bytes(produced.value);
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
        return { ok: true, value: { assetId: id, mime }, consumption: produced.consumption };
      },
    },
  );
  if (!result.ok) {
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

export function shellSummary(
  job: JobRow,
  ports: Pick<ResearchPorts, "fixture" | "measured" | "estimatedMaxUsd">,
  outcome: ResearchOutcome,
  detail: string,
  reportText: string,
  media: ResearchMedia,
): ResearchSummary {
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
