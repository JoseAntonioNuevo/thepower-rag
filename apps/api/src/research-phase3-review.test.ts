import { describe, expect, it } from "vite-plus/test";
import { fixtureCorpusVersion } from "./fixture";
import { readFixtureBytes } from "./fixture-bytes";
import { inspectMedia, sha256Bytes } from "./media-bytes";
import { RESEARCH_MEMORY_HEADER, contextualize } from "./research-memory";
import { insertAsset, memoryMediaBucket } from "./research-media";
import { perceiveJob } from "./research-multimodal";
import { holdForJob, priceSnapshot } from "./research-money";
import { journalMediaCall } from "./research-journal";
import { ensureResearchSchema } from "./research-db";
import { createFixtureResearchPorts } from "./research-fixture";
import { runResearchTick } from "./research-runner";
import { openResearchSqlite } from "./research-sqlite";
import {
  admitJob,
  claimJob,
  getJob,
  listMessages,
  listOperations,
  memoryTurns,
  readAccount,
} from "./research-store";
import { ResearchAttention } from "./research-state";

const prices = priceSnapshot({
  budgetUsd: "1.000000",
  jobLimitUsd: "0.250000",
  inputUsdPerMillion: "0.100000",
  outputUsdPerMillion: "0.500000",
  searchUsd: "0.002000",
  readUsd: "0.005000",
});

async function ready(filename = ":memory:") {
  const database = await openResearchSqlite(filename);
  await ensureResearchSchema(database, 1_000_000);
  return database;
}

async function classroomJob(
  database: Awaited<ReturnType<typeof ready>>,
  input: {
    question?: string;
    voice?: boolean;
    deadlineMs?: number;
    ownerId?: string;
    image?: boolean;
    audio?: boolean;
  },
) {
  if (!prices) throw new Error("sin tarifas");
  const ownerId = input.ownerId ?? "review-owner";
  const conversationId = crypto.randomUUID();
  await database
    .prepare(
      `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
       VALUES (?, ?, 'M/J', 1, 1)`,
    )
    .bind(conversationId, ownerId)
    .run();
  const bucket = memoryMediaBucket();
  const withImage = input.image !== false;
  const withAudio = input.audio !== false;
  const image = withImage ? await readFixtureBytes("dimension-mismatch.png") : null;
  const audio = withAudio ? await readFixtureBytes("embedding-request.wav") : null;
  const imageFacts = image ? await inspectMedia(image) : null;
  const audioFacts = audio ? await inspectMedia(audio) : null;
  if (image && (!imageFacts?.ok || imageFacts.facts.role !== "image")) throw new Error("imagen");
  if (audio && (!audioFacts?.ok || audioFacts.facts.role !== "audio")) throw new Error("audio");
  const imageId = crypto.randomUUID();
  const audioId = crypto.randomUUID();
  const imageHash = image ? await sha256Bytes(image) : "";
  const audioHash = audio ? await sha256Bytes(audio) : "";
  if (image) await bucket.put(`review/${imageId}`, image);
  if (audio) await bucket.put(`review/${audioId}`, audio);
  const now = Date.now();
  const rows = [
    ...(image && imageFacts?.ok && imageFacts.facts.role === "image"
      ? [
          {
            id: imageId,
            role: "image" as const,
            key: `review/${imageId}`,
            hash: imageHash,
            mime: imageFacts.facts.mime,
            bytes: image.byteLength,
            width: imageFacts.facts.width,
            height: imageFacts.facts.height,
            duration: null as number | null,
          },
        ]
      : []),
    ...(audio && audioFacts?.ok && audioFacts.facts.role === "audio"
      ? [
          {
            id: audioId,
            role: "audio" as const,
            key: `review/${audioId}`,
            hash: audioHash,
            mime: "audio/wav" as const,
            bytes: audio.byteLength,
            width: null as number | null,
            height: null as number | null,
            duration: audioFacts.facts.durationMs,
          },
        ]
      : []),
  ];
  for (const asset of rows) {
    await insertAsset(database, {
      id: asset.id,
      owner_id: ownerId,
      conversation_id: conversationId,
      role: asset.role,
      object_key: asset.key,
      content_hash: asset.hash,
      mime: asset.mime,
      byte_size: asset.bytes,
      width: asset.width,
      height: asset.height,
      duration_ms: asset.duration,
      sample_rate: asset.role === "audio" ? 16_000 : null,
      channels: asset.role === "audio" ? 1 : null,
      bit_depth: asset.role === "audio" ? 16 : null,
      status: "admitted",
      extracted_text: null,
      detail: null,
      job_id: null,
      idempotency_key: `review-${asset.id}`,
      created_at: now,
    });
  }
  const duration =
    audioFacts?.ok && audioFacts.facts.role === "audio" ? audioFacts.facts.durationMs : null;
  const hold = holdForJob(prices, {
    image: image !== null,
    audioDurationMs: duration,
    voice: input.voice === true,
  });
  if (hold === null) throw new Error("reserva");
  const admitted = await admitJob(database, {
    ownerId,
    conversationId,
    idempotencyKey: "review-job",
    fingerprint: "review-fingerprint",
    originalQuestion: input.question ?? "",
    contextualized: null,
    scenarioId: null,
    corpusVersion: fixtureCorpusVersion(),
    prices: { ...prices, holdMicros: hold },
    now,
    deadlineMs: input.deadlineMs ?? 120_000,
    queueMs: 60_000,
    media: {
      voice: input.voice === true,
      image: image ? { id: imageId, hash: imageHash } : null,
      audio:
        audio && duration !== null ? { id: audioId, hash: audioHash, durationMs: duration } : null,
    },
  });
  if (!admitted.ok) throw new Error(admitted.reason);
  return { database, bucket, admitted: admitted.job, ownerId, conversationId, imageId, audioId };
}

describe("correcciones de la revisión de la fase 3", () => {
  it("resuelve el guion del aula para todo el recorrido, sin escenario explícito", async () => {
    const database = await ready();
    const job = await classroomJob(database, { question: "", voice: true });
    const tick = await runResearchTick(database, job.admitted.id, job.ownerId, undefined, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    expect(tick.status).toBe("complete");
    const stored = await getJob(database, job.ownerId, job.admitted.id);
    expect(stored?.scenario_id).toBeNull();
    expect(stored?.fingerprint).toBe("review-fingerprint");
    const body = JSON.parse(stored?.result_json ?? "{}") as {
      summary: {
        outcome: string;
        pagesRead: unknown[];
        accepted: unknown[];
        media?: { speech?: { detail?: string } };
      };
      sources: { sourceId: string; authority?: string }[];
      report?: { text?: string };
    };
    expect(body.summary.outcome).toBe("complete");
    expect(body.summary.pagesRead.length).toBeGreaterThan(0);
    expect(body.summary.accepted.length).toBeGreaterThan(0);
    expect(body.sources.some((source) => source.authority !== "user-input")).toBe(true);
    expect(body.report?.text ?? "").toContain("Informe de prueba");
    expect(body.summary.media?.speech?.detail ?? "").toContain("no es");
    const repeated = await admitJob(database, {
      ownerId: job.ownerId,
      conversationId: job.conversationId,
      idempotencyKey: "review-job",
      fingerprint: "review-fingerprint",
      originalQuestion: "",
      contextualized: null,
      scenarioId: null,
      corpusVersion: fixtureCorpusVersion(),
      prices: { ...prices!, holdMicros: job.admitted.reserved_micros },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      media: {
        voice: true,
        image: {
          id: job.imageId,
          hash: await sha256Bytes(await readFixtureBytes("dimension-mismatch.png")),
        },
        audio: {
          id: job.audioId,
          hash: await sha256Bytes(await readFixtureBytes("embedding-request.wav")),
          durationMs: 1_000,
        },
      },
    });
    expect(repeated.ok && repeated.job.id).toBe(job.admitted.id);
  });

  it("recuerda la imagen y el audio en el turno siguiente y no los duplica", async () => {
    const database = await ready();
    const job = await classroomJob(database, { question: "", voice: false });
    await runResearchTick(database, job.admitted.id, job.ownerId, undefined, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    const claimed = await getJob(database, job.ownerId, job.admitted.id);
    if (!claimed) throw new Error("sin trabajo");
    await perceiveJob(database, claimed, prices!, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
      signal: new AbortController().signal,
    });
    const own = await memoryTurns(database, job.ownerId, job.conversationId);
    const user = own.filter((turn) => turn.role === "user");
    expect(user).toHaveLength(1);
    expect(user[0]?.text).toContain("1024");
    expect(user[0]?.text).toContain("He cambiado el modelo de embeddings");
    expect(user[0]?.text).not.toContain("base64");
    const follow = contextualize(own, "¿Qué dimensiones aparecían en mi captura?");
    expect(follow.contextualized).toContain("1024");
    expect(follow.contextualized).toContain("He cambiado el modelo de embeddings");
    expect(follow.contextualized).toContain("no es evidencia del curso");
    const spoken = contextualize(own, "¿Qué pedía el audio?");
    expect(spoken.contextualized).toContain("He cambiado el modelo de embeddings");
    expect(await memoryTurns(database, "otra-persona", job.conversationId)).toEqual([]);
    const again = await memoryTurns(database, job.ownerId, job.conversationId);
    expect(again.some((turn) => turn.text.includes("1024"))).toBe(true);
    database.close();
  });

  it("compacta la memoria previa antes de perder la imagen y el audio", async () => {
    const database = await ready();
    const job = await classroomJob(database, {
      question: "Investiga este error de dimensiones.",
      voice: false,
    });
    await database
      .prepare(`UPDATE research_jobs SET contextualized_question = ? WHERE id = ?`)
      .bind(
        `${RESEARCH_MEMORY_HEADER}token-antiguo-0001\n${"x".repeat(4_000)}\ndato-reciente-9981\n\nPregunta actual:\nvieja`,
        job.admitted.id,
      )
      .run();
    const claimed = await claimJob(
      database,
      job.ownerId,
      job.admitted.id,
      "review",
      Date.now(),
      180_000,
    );
    const perceived = await perceiveJob(database, claimed!, prices!, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
      signal: new AbortController().signal,
    });
    expect(perceived.kind).toBe("ready");
    if (perceived.kind !== "ready") return;
    expect(perceived.proceed).toBe(true);
    expect(perceived.question).toContain("expected 1024");
    expect(perceived.question).toContain("He cambiado el modelo de embeddings");
    expect(perceived.question).toContain(RESEARCH_MEMORY_HEADER.trim());
    expect(perceived.question).toContain("dato-reciente-9981");
    expect(perceived.question).not.toContain("token-antiguo-0001");
    expect(perceived.question.length).toBeLessThanOrEqual(2_000);
  });

  it("conserva la petición final cuando la memoria previa no cabe", async () => {
    const database = await ready();
    const question = `${"n".repeat(800)} Investiga cómo resolver ERROR_AUTH_401.`;
    const job = await classroomJob(database, { question, voice: false });
    await database
      .prepare(`UPDATE research_jobs SET contextualized_question = ? WHERE id = ?`)
      .bind(
        `${RESEARCH_MEMORY_HEADER}token-antiguo-0001\n${"x".repeat(4_000)}\ndato-reciente-9981\n\nPregunta actual:\nvieja`,
        job.admitted.id,
      )
      .run();
    const claimed = await claimJob(
      database,
      job.ownerId,
      job.admitted.id,
      "review",
      Date.now(),
      180_000,
    );
    const perceived = await perceiveJob(database, claimed!, prices!, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
      signal: new AbortController().signal,
    });
    expect(perceived.kind).toBe("ready");
    if (perceived.kind !== "ready") return;
    expect(perceived.proceed).toBe(true);
    expect(perceived.clarify).toBeNull();
    expect(perceived.question).toContain("ERROR_AUTH_401");
    expect(perceived.question).toContain("expected 1024");
    expect(perceived.question).toContain("He cambiado el modelo de embeddings");
    expect(perceived.question).toContain("dato-reciente-9981");
    expect(perceived.question).not.toContain("token-antiguo-0001");
    expect(perceived.question.length).toBeLessThanOrEqual(2_000);
    expect(perceived.media.image?.observedText).toContain("1024");
    expect(perceived.media.audio?.transcript).toContain("embeddings");
  });

  it("no planifica ni busca si la fusión perdería la petición", async () => {
    const database = await ready();
    const question = `${"x".repeat(1_900)} Investiga cómo resolver ERROR_AUTH_401.`;
    const job = await classroomJob(database, { question, voice: false });
    await database
      .prepare(`UPDATE research_jobs SET contextualized_question = ? WHERE id = ?`)
      .bind(
        `${RESEARCH_MEMORY_HEADER}${"memoria ".repeat(400)}\n\nPregunta actual:\nvieja`,
        job.admitted.id,
      )
      .run();
    let searches = 0;
    let plans = 0;
    const tick = await runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      (signal, row) => {
        const ports = createFixtureResearchPorts({
          signal,
          scenarioId: row.scenario_id,
          audience: row.audience,
          corpusVersion: row.corpus_version,
        });
        return {
          ...ports,
          model: {
            ...ports.model,
            plan: (input, context) => {
              plans += 1;
              return ports.model.plan(input, context);
            },
          },
          search: {
            search: async (input, context) => {
              searches += 1;
              return ports.search.search(input, context);
            },
          },
        };
      },
      {
        mode: "demo",
        bucket: job.bucket,
        ai: null,
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    expect(tick.status).toBe("complete");
    expect(searches).toBe(0);
    expect(plans).toBe(0);
    const stored = await getJob(database, job.ownerId, job.admitted.id);
    expect(stored?.original_question).toBe(question);
    expect(stored?.idempotency_key).toBe("review-job");
    expect(stored?.fingerprint).toBe("review-fingerprint");
    const body = JSON.parse(stored?.result_json ?? "{}") as {
      summary: {
        outcome: string;
        stopDetail: string;
        route: string | null;
        searches: unknown[];
        media?: {
          image?: { observedText?: string };
          audio?: { transcript?: string };
        };
      };
      report?: { text?: string };
    };
    expect(body.summary.outcome).toBe("clarify");
    expect(body.summary.route).toBeNull();
    expect(body.summary.stopDetail).toContain("no cabe");
    expect(body.summary.searches).toEqual([]);
    expect(body.report?.text ?? "").toContain("no cabe");
    expect(body.report?.text ?? "").not.toContain("Informe de prueba");
    expect(body.summary.media?.image?.observedText).toContain("1024");
    expect(body.summary.media?.audio?.transcript).toContain("He cambiado el modelo de embeddings");
    const graphKinds = new Set([
      "plan",
      "assess",
      "follow-up",
      "synthesize",
      "course",
      "tool",
      "search",
      "read",
    ]);
    const operations = await listOperations(database, job.admitted.id);
    expect(operations.some((operation) => graphKinds.has(operation.kind))).toBe(false);
    expect(operations.some((operation) => operation.kind === "vision")).toBe(true);
    expect(operations.some((operation) => operation.kind === "transcribe")).toBe(true);
    expect(operations.some((operation) => operation.kind === "speech")).toBe(false);
    const repeated = await admitJob(database, {
      ownerId: job.ownerId,
      conversationId: job.conversationId,
      idempotencyKey: "review-job",
      fingerprint: "review-fingerprint",
      originalQuestion: question,
      contextualized: null,
      scenarioId: null,
      corpusVersion: fixtureCorpusVersion(),
      prices: { ...prices!, holdMicros: job.admitted.reserved_micros },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      media: {
        voice: false,
        image: {
          id: job.imageId,
          hash: await sha256Bytes(await readFixtureBytes("dimension-mismatch.png")),
        },
        audio: {
          id: job.audioId,
          hash: await sha256Bytes(await readFixtureBytes("embedding-request.wav")),
          durationMs: 1_000,
        },
      },
    });
    expect(repeated.ok && repeated.job.id).toBe(job.admitted.id);
  });

  it("no espera a una transcripción que ignora la cancelación ni publica su éxito tardío", async () => {
    const database = await ready();
    const job = await classroomJob(database, { deadlineMs: 350, voice: false, image: false });
    let calls = 0;
    let late = false;
    let searches = 0;
    const started = Date.now();
    const tick = runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      (signal, row) => {
        const ports = createFixtureResearchPorts({
          signal,
          scenarioId: row.scenario_id,
          audience: row.audience,
          corpusVersion: row.corpus_version,
        });
        return {
          ...ports,
          search: {
            search: async (input, context) => {
              searches += 1;
              return ports.search.search(input, context);
            },
          },
        };
      },
      {
        mode: "real",
        bucket: job.bucket,
        ai: {
          run: async () => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 1_600));
            late = true;
            return { text: "Investiga el error de embeddings." };
          },
        },
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    await expect(tick).resolves.toMatchObject({ status: "attention" });
    expect(Date.now() - started).toBeLessThan(900);
    expect(calls).toBe(1);
    expect(searches).toBe(0);
    const operations = await listOperations(database, job.admitted.id);
    const transcript = operations.find((operation) => operation.kind === "transcribe");
    expect(transcript?.state).toBe("unknown");
    expect(transcript?.result_json).toBeNull();
    expect(transcript?.unknown_hold_micros).toBeGreaterThan(0);
    expect((await readAccount(database))?.unknown_micros).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(late).toBe(true);
    const after = (await listOperations(database, job.admitted.id)).find(
      (operation) => operation.kind === "transcribe",
    );
    expect(after?.state).toBe("unknown");
    expect(after?.result_json).toBeNull();
    let resumed = 0;
    await runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      () => {
        resumed += 1;
        return createFixtureResearchPorts({
          signal: new AbortController().signal,
          scenarioId: null,
          audience: "M/J",
          corpusVersion: fixtureCorpusVersion(),
        });
      },
      {
        mode: "real",
        bucket: job.bucket,
        ai: {
          run: async () => {
            calls += 1;
            return { text: "no debe llamarse" };
          },
        },
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    expect(calls).toBe(1);
    expect(resumed).toBe(0);
  });

  it("termina la espera de una voz o una promesa que no acaba", async () => {
    const database = await ready();
    const conversationId = crypto.randomUUID();
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'review-owner', 'program', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    const hold = holdForJob(prices!, { image: false, audioDurationMs: null, voice: true });
    const admitted = await admitJob(database, {
      ownerId: "review-owner",
      conversationId,
      idempotencyKey: "speech-deadline",
      fingerprint: "speech-fingerprint",
      originalQuestion: "¿Qué es un checkpointer?",
      contextualized: null,
      scenarioId: "sufficient-first-round",
      corpusVersion: fixtureCorpusVersion(),
      prices: { ...prices!, holdMicros: hold ?? 1 },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      media: { voice: true, image: null, audio: null },
    });
    if (!admitted.ok) throw new Error(admitted.reason);
    const claimed = await claimJob(
      database,
      "review-owner",
      admitted.job.id,
      "review",
      Date.now(),
      180_000,
    );
    if (!claimed) throw new Error("sin arrendamiento");
    const started = Date.now();
    await expect(
      journalMediaCall(database, { ...claimed, deadline_at: Date.now() + 120 }, prices!, {
        kind: "speech",
        speechChars: 40,
        payload: { digest: "hang" },
        signal: new AbortController().signal,
        invoke: () => new Promise(() => undefined),
      }),
    ).rejects.toBeInstanceOf(ResearchAttention);
    expect(Date.now() - started).toBeLessThan(700);
    const hung = (await listOperations(database, claimed.id)).find(
      (operation) => operation.kind === "speech",
    );
    expect(hung?.state).toBe("unknown");
    const controller = new AbortController();
    const lateStart = Date.now();
    const pending = journalMediaCall(database, claimed, prices!, {
      kind: "speech",
      speechChars: 40,
      payload: { digest: "late" },
      signal: controller.signal,
      invoke: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return {
          ok: true as const,
          value: { assetId: "late", mime: "audio/mpeg" },
          consumption: { kind: "none" as const },
        };
      },
    });
    setTimeout(() => controller.abort(), 40);
    await expect(pending).rejects.toBeInstanceOf(ResearchAttention);
    expect(Date.now() - lateStart).toBeLessThan(700);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const late = (await listOperations(database, claimed.id)).find(
      (operation) => operation.fingerprint !== hung?.fingerprint && operation.kind === "speech",
    );
    expect(late?.state).toBe("unknown");
    expect(late?.result_json).toBeNull();
  });

  it("cancela la percepción y la voz sin arrancar la operación siguiente", async () => {
    const database = await ready();
    const job = await classroomJob(database, { voice: false, image: false });
    let calls = 0;
    let searches = 0;
    const started = new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (calls > 0) {
          clearInterval(timer);
          resolve();
        }
      }, 10);
    });
    const tick = runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      (signal, row) => {
        const ports = createFixtureResearchPorts({
          signal,
          scenarioId: row.scenario_id,
          audience: row.audience,
          corpusVersion: row.corpus_version,
        });
        return {
          ...ports,
          search: {
            search: async (input, context) => {
              searches += 1;
              return ports.search.search(input, context);
            },
          },
        };
      },
      {
        mode: "real",
        bucket: job.bucket,
        ai: {
          run: async () => {
            calls += 1;
            await new Promise((resolve) => setTimeout(resolve, 1_600));
            return { text: "tarde" };
          },
        },
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    await started;
    await database
      .prepare(`UPDATE research_jobs SET cancel_requested = 1 WHERE id = ?`)
      .bind(job.admitted.id)
      .run();
    const result = await tick;
    expect(result.status === "attention" || result.status === "cancelled").toBe(true);
    expect(calls).toBe(1);
    expect(searches).toBe(0);
    const messages = await listMessages(database, job.ownerId, job.conversationId);
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
  });
});
