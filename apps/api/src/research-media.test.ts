import { readFixtureBytes } from "./fixture-bytes";
import { RESEARCH_PRICE_VERSION_V1 } from "./research-money";
import { describe, expect, it } from "vite-plus/test";
import { mediaMissing, type WorkerEnv } from "./env";
import { inspectMedia, sha256Bytes } from "./media-bytes";
import { invalidIdatPng, invalidScanJpeg } from "./media-byte-samples";
import {
  insertAsset,
  mediaDownloadName,
  memoryMediaBucket,
  purgeOrphanMedia,
} from "./research-media";
import { perceiveJob } from "./research-multimodal";
import { holdForJob, parsePriceSnapshot, priceSnapshot, reservationFor } from "./research-money";
import { journalMediaCall } from "./research-journal";
import { ensureResearchSchema } from "./research-db";
import { runResearchTick } from "./research-runner";
import { presentResearchResult } from "./research-result";
import { openResearchSqlite } from "./research-sqlite";
import {
  admitJob,
  claimJob,
  completeOperation,
  deleteMediaRow,
  getJob,
  listOperations,
  markDispatched,
} from "./research-store";
import { ResearchAttention } from "./research-state";
import worker from "./worker";

const demoOrigin = "http://127.0.0.1:5191";
const context = {} as ExecutionContext;

function cookieFrom(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

function envFor(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  bucket: ReturnType<typeof memoryMediaBucket>,
): WorkerEnv {
  return {
    APP_MODE: "demo",
    RESEARCH_OWNER_SECRET: "local-loopback-research-owner",
    RESEARCH_DB: database,
    RESEARCH_MEDIA: bucket,
    RESEARCH_WORKFLOW: {
      async create(options: { id: string }) {
        return { id: options.id };
      },
      async get() {
        return {
          async status() {
            return { status: "complete" };
          },
          async terminate() {
            return undefined;
          },
          async restart() {
            return undefined;
          },
        };
      },
    },
    RESEARCH_BUDGET_USD: "1.000000",
    RESEARCH_JOB_LIMIT_USD: "0.250000",
    RESEARCH_INPUT_USD_PER_MILLION: "0.100000",
    RESEARCH_OUTPUT_USD_PER_MILLION: "0.500000",
    RESEARCH_SEARCH_USD: "0.002000",
    RESEARCH_READ_USD: "0.005000",
  };
}

async function send(env: WorkerEnv, url: string, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(url, init), env, context);
}

describe("medios de la investigación", () => {
  it("nombra la descarga según el tipo guardado", () => {
    expect(mediaDownloadName("speech", "audio/mpeg")).toBe("respuesta.mp3");
    expect(mediaDownloadName("speech", "audio/wav")).toBe("respuesta.wav");
    expect(mediaDownloadName("audio", "audio/wav")).toBe("audio.wav");
    expect(mediaDownloadName("image", "image/png")).toBe("imagen.png");
    expect(mediaDownloadName("image", "image/jpeg")).toBe("imagen.jpg");
    expect(mediaDownloadName("speech", "application/octet-stream")).toBe("respuesta.bin");
  });

  it("tarifa la visión, el audio y la voz y sigue leyendo la instantánea v1", () => {
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    expect(prices).not.toBeNull();
    if (!prices) return;
    expect(reservationFor("vision", prices)).toBeGreaterThan(0);
    expect(reservationFor("transcribe", prices, { durationMs: 10_283 })).toBeGreaterThan(0);
    expect(reservationFor("speech", prices, { speechChars: 600 })).toBe(18_000);
    expect(reservationFor("plan", prices)).toBe(prices.modelCallMicros);
    const withVoice = holdForJob(prices, { image: true, audioDurationMs: 10_283, voice: true });
    expect(withVoice).toBeGreaterThan(prices.holdMicros);
    const legacy = parsePriceSnapshot(
      JSON.stringify({
        version: RESEARCH_PRICE_VERSION_V1,
        budgetMicros: 1_000_000,
        jobLimitMicros: 250_000,
        modelCallMicros: 10,
        searchMicros: 10,
        readMicros: 10,
        courseMicros: 10,
        holdMicros: 40,
      }),
    );
    expect(legacy?.version).toBe(RESEARCH_PRICE_VERSION_V1);
    expect(legacy ? reservationFor("vision", legacy) : 1).toBeNull();
    expect(legacy ? reservationFor("plan", legacy) : 0).toBe(10);
  });

  it("señala la clave o el binding ausente, no el modelo de voz por defecto", () => {
    const ready = {
      APP_MODE: "real",
      RESEARCH_MEDIA: {},
      AI: {},
      ANTHROPIC_API_KEY: "local-test-key",
      RESEARCH_MODEL_ID: "claude-haiku-5-5",
    } satisfies WorkerEnv;
    expect(mediaMissing(ready, { image: true, audio: true, voice: true })).toEqual([]);
    expect(
      mediaMissing(
        { ...ready, ANTHROPIC_API_KEY: undefined },
        { image: true, audio: false, voice: false },
      ),
    ).toEqual(["ANTHROPIC_API_KEY"]);
    expect(
      mediaMissing(
        { ...ready, RESEARCH_MODEL_ID: "example/text-only" },
        { image: true, audio: false, voice: false },
      ),
    ).toEqual(["RESEARCH_VISION_MODEL_ID"]);
    expect(
      mediaMissing({ ...ready, AI: undefined }, { image: false, audio: true, voice: true }),
    ).toEqual(["AI"]);
  });

  it("sube, aísla, reutiliza y reproduce sin otra reserva", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const bucket = memoryMediaBucket();
    const env = envFor(database, bucket);
    const session = await send(env, `${demoOrigin}/api/research/session`);
    const cookie = cookieFrom(session);
    const headers = {
      cookie,
      origin: demoOrigin,
    };
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ audience: "M/J" }),
    });
    expect(created.status).toBe(201);
    const conversation = (await created.json()) as { id: string };
    const image = await readFixtureBytes("dimension-mismatch.png");
    const audio = await readFixtureBytes("embedding-request.wav");
    const upload = (bytes: Uint8Array, key: string, type = "application/octet-stream") =>
      send(env, `${demoOrigin}/api/research/conversations/${conversation.id}/media`, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": type,
          "content-length": String(bytes.byteLength),
          "x-idempotency-key": key,
        },
        body: bytes,
      });
    const imageResponse = await upload(image, "idem-image-01", "text/html");
    expect(imageResponse.status).toBe(201);
    const imageAsset = (await imageResponse.json()) as { id: string; mime: string };
    expect(imageAsset.mime).toBe("image/png");
    const replay = await upload(image, "idem-image-01");
    expect(replay.status).toBe(200);
    expect(((await replay.json()) as { id: string }).id).toBe(imageAsset.id);
    const changed = await upload(await readFixtureBytes("unknown-square.png"), "idem-image-01");
    expect(changed.status).toBe(409);
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect((await upload(svg, "idem-svg-01")).status).toBe(400);
    const forgedPng = new Uint8Array(33);
    forgedPng.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    forgedPng.set(new TextEncoder().encode("IHDR"), 12);
    forgedPng[19] = 8;
    forgedPng[23] = 8;
    forgedPng[24] = 8;
    forgedPng[25] = 2;
    forgedPng.set(new TextEncoder().encode("IEND"), 29);
    const rejected = await upload(forgedPng, "idem-forged-png");
    expect(rejected.status).toBe(400);
    const invalidPng = invalidIdatPng();
    const invalidJpeg = invalidScanJpeg();
    expect(invalidPng.byteLength).toBe(58);
    expect(invalidJpeg.byteLength).toBe(31);
    const badPng = await upload(invalidPng, "idem-bad-idat");
    const badJpeg = await upload(invalidJpeg, "idem-bad-scan");
    expect(badPng.status).toBe(400);
    expect(badJpeg.status).toBe(400);
    expect(((await badPng.json()) as { message?: string }).message).toContain("malformed");
    expect(((await badJpeg.json()) as { message?: string }).message).toContain("malformed");
    const operationsAfterReject = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    expect(operationsAfterReject?.total ?? 0).toBe(0);
    const assetsAfterReject = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_media_assets WHERE idempotency_key = ?`)
      .bind("idem-forged-png")
      .first<{ total: number }>();
    expect(assetsAfterReject?.total ?? 0).toBe(0);
    const malformedAssets = await database
      .prepare(
        `SELECT COUNT(*) AS total FROM research_media_assets
         WHERE idempotency_key IN ('idem-bad-idat', 'idem-bad-scan', 'idem-forged-png')`,
      )
      .first<{ total: number }>();
    expect(malformedAssets?.total ?? 0).toBe(0);
    const audioResponse = await upload(audio, "idem-audio-01");
    expect(audioResponse.status).toBe(201);
    const audioAsset = (await audioResponse.json()) as { id: string; durationMs: number };
    expect(audioAsset.durationMs).toBeGreaterThan(1_000);
    const otherSession = await send(env, `${demoOrigin}/api/research/session`);
    const otherCookie = cookieFrom(otherSession);
    const foreign = await send(env, `${demoOrigin}/api/research/media/${imageAsset.id}`, {
      headers: { cookie: otherCookie },
    });
    expect(foreign.status).toBe(404);
    const owned = await send(env, `${demoOrigin}/api/research/media/${imageAsset.id}`, {
      headers: { cookie, range: "bytes=0-3" },
    });
    expect(owned.status).toBe(206);
    expect(new Uint8Array(await owned.arrayBuffer())).toEqual(image.subarray(0, 4));
    const before = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    const submitted = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "idem-multi-01",
          question: "",
          voice: true,
          imageAssetId: imageAsset.id,
          audioAssetId: audioAsset.id,
        }),
      },
    );
    expect(submitted.status).toBe(202);
    const job = (await submitted.json()) as { jobId: string };
    const different = await send(
      env,
      `${demoOrigin}/api/research/conversations/${conversation.id}/jobs`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: "idem-multi-01",
          question: "",
          voice: false,
          imageAssetId: imageAsset.id,
          audioAssetId: audioAsset.id,
        }),
      },
    );
    expect(different.status).toBe(409);
    const row = await getJob(
      database,
      (
        await database
          .prepare(`SELECT owner_id AS id FROM research_jobs WHERE id = ?`)
          .bind(job.jobId)
          .first<{ id: string }>()
      )?.id ?? "",
      job.jobId,
    );
    expect(row).not.toBeNull();
    if (!row) return;
    const tick = await runResearchTick(database, job.jobId, row.owner_id, undefined, {
      mode: "demo",
      bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    expect(tick.status).toBe("complete");
    const result = await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}/result`, {
      headers: { cookie },
    });
    expect(result.status).toBe(200);
    const payload = (await result.json()) as {
      summary: {
        media?: {
          image?: { observedText?: string; status?: string };
          audio?: { transcript?: string };
          speech?: { status?: string; assetId?: string; text?: string };
        };
        outcome?: string;
      };
      report: { text: string } | null;
    };
    expect(payload.summary.media?.image?.observedText).toContain("expected 1024, got 768");
    expect(payload.summary.media?.audio?.transcript).toContain(
      "He cambiado el modelo de embeddings",
    );
    expect(payload.summary.media?.speech?.status).toBe("ready");
    expect(payload.report?.text.length).toBeGreaterThan(20);
    const speech = await send(
      env,
      `${demoOrigin}/api/research/media/${payload.summary.media?.speech?.assetId ?? ""}`,
      { headers: { cookie } },
    );
    expect(speech.status).toBe(200);
    expect(speech.headers.get("content-type")).toBe("audio/wav");
    expect(speech.headers.get("content-disposition")).toContain("respuesta.wav");
    expect((await inspectMedia(new Uint8Array(await speech.arrayBuffer()))).ok).toBe(true);
    const after = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    expect((after?.total ?? 0) > (before?.total ?? 0)).toBe(true);
    const again = await runResearchTick(database, job.jobId, row.owner_id, undefined, {
      mode: "demo",
      bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    expect(again.status).toBe("complete");
    const still = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    expect(still?.total).toBe(after?.total);
    const kinds = await listOperations(database, job.jobId);
    expect(
      kinds.filter((item) => item.kind === "vision" && item.state === "completed"),
    ).toHaveLength(1);
    expect(
      kinds.filter((item) => item.kind === "transcribe" && item.state === "completed"),
    ).toHaveLength(1);
    expect(
      kinds.filter((item) => item.kind === "speech" && item.state === "completed"),
    ).toHaveLength(1);
  });

  it("reutiliza una percepción completada y no reenvía una ambigua", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    expect(prices).not.toBeNull();
    if (!prices) return;
    const conversationId = crypto.randomUUID();
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'owner-a', 'M/J', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    const admitted = await (
      await import("./research-store")
    ).admitJob(database, {
      ownerId: "owner-a",
      conversationId,
      idempotencyKey: "idem-journal-1",
      fingerprint: "fingerprint-journal-1",
      originalQuestion: "Investiga el error.",
      contextualized: null,
      scenarioId: null,
      corpusVersion: "fixture",
      prices: {
        ...prices,
        holdMicros:
          prices.holdMicros +
          (prices.version === "research-prices-v2" ? prices.visionCallMicros : 0),
      },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "test",
      Date.now(),
      60_000,
    );
    expect(claimed).not.toBeNull();
    if (!claimed) return;
    let calls = 0;
    const first = await journalMediaCall(database, claimed, prices, {
      kind: "vision",
      payload: { hash: "sha256:abc" },
      signal: new AbortController().signal,
      invoke: async () => {
        calls += 1;
        return {
          ok: true as const,
          value: { observedText: "expected 1024, got 768", notes: "texto", uncertain: false },
          consumption: { kind: "none" as const },
        };
      },
    });
    const second = await journalMediaCall(database, claimed, prices, {
      kind: "vision",
      payload: { hash: "sha256:abc" },
      signal: new AbortController().signal,
      invoke: async () => {
        calls += 1;
        return {
          ok: true as const,
          value: { observedText: "otro", notes: "", uncertain: true },
          consumption: { kind: "none" as const },
        };
      },
    });
    expect(calls).toBe(1);
    expect(second).toEqual(first);
    const operation = (await listOperations(database, claimed.id))[0];
    expect(operation).toBeDefined();
    if (!operation) return;
    await database
      .prepare(
        `UPDATE research_operations SET state = 'dispatched', result_json = NULL WHERE id = ?`,
      )
      .bind(operation.id)
      .run();
    await expect(
      journalMediaCall(database, claimed, prices, {
        kind: "vision",
        payload: { hash: "sha256:abc" },
        signal: new AbortController().signal,
        invoke: async () => {
          calls += 1;
          return {
            ok: true as const,
            value: { observedText: "x", notes: "", uncertain: false },
            consumption: { kind: "none" as const },
          };
        },
      }),
    ).rejects.toBeInstanceOf(ResearchAttention);
    expect(calls).toBe(1);
    const stale = await completeOperation(database, {
      operationId: operation.id,
      fence: claimed.lease_token + 9,
      resultJson: "{}",
      consumption: { kind: "none" },
      reservation: operation.reservation_micros,
    });
    expect(stale).toBe(false);
    await database
      .prepare(`UPDATE research_jobs SET deadline_at = ? WHERE id = ?`)
      .bind(Date.now() - 1, claimed.id)
      .run();
    const expired = await getJob(database, "owner-a", claimed.id);
    expect(expired).not.toBeNull();
    if (!expired) return;
    await markDispatched(database, operation.id, claimed.lease_token);
    await expect(
      journalMediaCall(database, expired, prices, {
        kind: "speech",
        speechChars: 20,
        payload: { digest: "otro" },
        signal: new AbortController().signal,
        invoke: async () => {
          calls += 1;
          return {
            ok: true as const,
            value: { assetId: "x", mime: "audio/wav" },
            consumption: { kind: "none" as const },
          };
        },
      }),
    ).rejects.toBeInstanceOf(ResearchAttention);
    expect(calls).toBe(1);
  });

  it("la voz sin adjuntos conserva la pregunta y no fusiona la entrada", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    expect(prices).not.toBeNull();
    if (!prices) return;
    const hold = holdForJob(prices, { image: false, audioDurationMs: null, voice: true });
    expect(hold).not.toBeNull();
    if (hold === null) return;
    const conversationId = crypto.randomUUID();
    const question = "¿Para qué sirve un checkpointer en LangGraph?";
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'owner-a', 'M/J', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    const admitted = await admitJob(database, {
      ownerId: "owner-a",
      conversationId,
      idempotencyKey: "idem-voice-only",
      fingerprint: "fingerprint-voice-only",
      originalQuestion: question,
      contextualized: `Memoria previa.\n\nPregunta actual:\n${question}`,
      scenarioId: null,
      corpusVersion: "fixture",
      prices: { ...prices, holdMicros: hold },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      media: { voice: true, image: null, audio: null },
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const perceived = await perceiveJob(database, admitted.job, prices, {
      mode: "demo",
      bucket: memoryMediaBucket(),
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
    expect(perceived.question).toBe(`Memoria previa.\n\nPregunta actual:\n${question}`);
    expect(perceived.question).not.toContain("contenido no confiable");
    expect(perceived.sources).toEqual([]);
  });

  it("borra el objeto huérfano solo cuando borra la fila", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const bucket = memoryMediaBucket();
    const orphanKey = "research/owner-a/conversation/orphan";
    const boundKey = "research/owner-a/conversation/bound";
    await bucket.put(orphanKey, new Uint8Array([1, 2, 3]));
    await bucket.put(boundKey, new Uint8Array([4, 5, 6]));
    await insertAsset(database, {
      id: "11111111-1111-4111-8111-111111111111",
      owner_id: "owner-a",
      conversation_id: "conversation",
      role: "image",
      object_key: orphanKey,
      content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      mime: "image/png",
      byte_size: 3,
      width: 8,
      height: 8,
      duration_ms: null,
      sample_rate: null,
      channels: null,
      bit_depth: null,
      status: "admitted",
      extracted_text: null,
      detail: null,
      job_id: null,
      idempotency_key: "idem-orphan",
      created_at: 1,
    });
    await insertAsset(database, {
      id: "22222222-2222-4222-8222-222222222222",
      owner_id: "owner-a",
      conversation_id: "conversation",
      role: "image",
      object_key: boundKey,
      content_hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      mime: "image/png",
      byte_size: 3,
      width: 8,
      height: 8,
      duration_ms: null,
      sample_rate: null,
      channels: null,
      bit_depth: null,
      status: "admitted",
      extracted_text: null,
      detail: null,
      job_id: "job-bound",
      idempotency_key: "idem-bound",
      created_at: 1,
    });
    expect(await deleteMediaRow(database, "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(await purgeOrphanMedia(database, bucket, 10_000, 1)).toBe(1);
    expect(await bucket.head(orphanKey)).toBeNull();
    expect(await bucket.head(boundKey)).not.toBeNull();
  });

  it("conserva el informe cuando la voz falla al guardar el audio", async () => {
    const database = await openResearchSqlite();
    await ensureResearchSchema(database, 1_000_000);
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    expect(prices).not.toBeNull();
    if (!prices) return;
    const hold = holdForJob(prices, { image: true, audioDurationMs: null, voice: true });
    expect(hold).not.toBeNull();
    if (hold === null) return;
    const image = await readFixtureBytes("dimension-mismatch.png");
    const hash = await sha256Bytes(image);
    const conversationId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'owner-a', 'M/J', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    const bucket = memoryMediaBucket();
    const put = bucket.put.bind(bucket);
    bucket.put = (key, value, options) => {
      if (key.includes("/speech/")) return Promise.reject(new Error("speech-put-failed"));
      return put(key, value, options);
    };
    await bucket.put(`research/owner-a/${conversationId}/${assetId}`, image, {
      httpMetadata: { contentType: "image/png" },
    });
    await insertAsset(database, {
      id: assetId,
      owner_id: "owner-a",
      conversation_id: conversationId,
      role: "image",
      object_key: `research/owner-a/${conversationId}/${assetId}`,
      content_hash: hash,
      mime: "image/png",
      byte_size: image.byteLength,
      width: 980,
      height: 180,
      duration_ms: null,
      sample_rate: null,
      channels: null,
      bit_depth: null,
      status: "admitted",
      extracted_text: null,
      detail: null,
      job_id: null,
      idempotency_key: "idem-clarify-image",
      created_at: 1,
    });
    const admitted = await admitJob(database, {
      ownerId: "owner-a",
      conversationId,
      idempotencyKey: "idem-clarify-voice",
      fingerprint: "fingerprint-clarify-voice",
      originalQuestion: "",
      contextualized: null,
      scenarioId: null,
      corpusVersion: "fixture",
      prices: { ...prices, holdMicros: hold },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      media: { voice: true, image: { id: assetId, hash }, audio: null },
    });
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;
    const tick = await runResearchTick(database, admitted.job.id, "owner-a", undefined, {
      mode: "demo",
      bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    const job = await getJob(database, "owner-a", admitted.job.id);
    expect(job?.result_json).toBeTruthy();
    const presented = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      job?.result_json ?? "",
    );
    expect(presented?.report?.text).toContain("no formula");
    expect(presented?.summary.media?.speech?.status).toBe("failed");
    expect(["complete", "attention", "failed"]).toContain(tick.status);
  });
});
