// GUÍA DE LECTURA · apps/api/src/research-media.test.ts
// Pruebas de imágenes, audios y voz de la investigación: nombres de descarga, tarifas de medios, subida
// con idempotencia y aislamiento, percepción reutilizable, limpieza de huérfanos y fallo de la voz.
// Lee archivos de ejemplo.
import { readFixtureBytes } from "./fixture-bytes";
// Versión 1 de las tarifas.
import { RESEARCH_PRICE_VERSION_V1 } from "./research-money";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Variables que faltan para medios.
import { mediaMissing, type WorkerEnv } from "./env";
// Inspección y hash de bytes.
import { inspectMedia, sha256Bytes } from "./media-bytes";
// Archivos inválidos de prueba.
import { invalidIdatPng, invalidScanJpeg } from "./media-byte-samples";
// Funciones de medios.
import {
  insertAsset,
  mediaDownloadName,
  memoryMediaBucket,
  purgeOrphanMedia,
} from "./research-media";
// Percepción del trabajo.
import { perceiveJob } from "./research-multimodal";
// Tarifas y reservas.
import { holdForJob, parsePriceSnapshot, priceSnapshot, reservationFor } from "./research-money";
// Diario de llamadas de medios.
import { journalMediaCall } from "./research-journal";
// Tablas de la investigación.
import { ensureResearchSchema } from "./research-db";
// Paso del trabajo.
import { runResearchTick } from "./research-runner";
// Presentación del resultado.
import { presentResearchResult } from "./research-result";
// D1 simulada con SQLite.
import { openResearchSqlite } from "./research-sqlite";
// Operaciones del almacén.
import {
  admitJob,
  claimJob,
  completeOperation,
  deleteMediaRow,
  getJob,
  listOperations,
  markDispatched,
} from "./research-store";
// Error de atención.
import { ResearchAttention } from "./research-state";
// Worker completo.
import worker from "./worker";

// Origen local de la demo.
const demoOrigin = "http://127.0.0.1:5191";
// Contexto vacío.
const context = {} as ExecutionContext;

// Cookie de una respuesta.
function cookieFrom(response: Response): string {
  // Primera parte de set-cookie.
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

// Entorno de demo con bucket y Workflow simulados.
function envFor(
  database: Awaited<ReturnType<typeof openResearchSqlite>>,
  bucket: ReturnType<typeof memoryMediaBucket>,
): WorkerEnv {
  // Variables, bindings y tarifas.
  return {
    APP_MODE: "demo",
    RESEARCH_OWNER_SECRET: "local-loopback-research-owner",
    RESEARCH_DB: database,
    RESEARCH_MEDIA: bucket,
    RESEARCH_WORKFLOW: {
      async create(options: { id: string }) {
        // Instancia creada.
        return { id: options.id };
      },
      async get() {
        // Instancia simulada.
        return {
          async status() {
            // Siempre completa.
            return { status: "complete" };
          },
          async terminate() {
            // Nada.
            return undefined;
          },
          async restart() {
            // Nada.
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

// Envía una petición al Worker.
async function send(env: WorkerEnv, url: string, init: RequestInit = {}): Promise<Response> {
  // worker.fetch.
  return worker.fetch(new Request(url, init), env, context);
}

// Grupo: medios de la investigación.
describe("medios de la investigación", () => {
  // Nombre de descarga según papel y MIME.
  it("nombra la descarga según el tipo guardado", () => {
    // Voz mp3.
    expect(mediaDownloadName("speech", "audio/mpeg")).toBe("respuesta.mp3");
    // Voz wav.
    expect(mediaDownloadName("speech", "audio/wav")).toBe("respuesta.wav");
    // Audio subido.
    expect(mediaDownloadName("audio", "audio/wav")).toBe("audio.wav");
    // Imagen PNG.
    expect(mediaDownloadName("image", "image/png")).toBe("imagen.png");
    // Imagen JPEG.
    expect(mediaDownloadName("image", "image/jpeg")).toBe("imagen.jpg");
    // Tipo desconocido.
    expect(mediaDownloadName("speech", "application/octet-stream")).toBe("respuesta.bin");
  });

  // Tarifas de medios y lectura de la versión 1.
  it("tarifa la visión, el audio y la voz y sigue leyendo la instantánea v1", () => {
    // Tarifas.
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    // Existen.
    expect(prices).not.toBeNull();
    // Si no, termina.
    if (!prices) return;
    // Reserva de visión.
    expect(reservationFor("vision", prices)).toBeGreaterThan(0);
    // Reserva de transcripción.
    expect(reservationFor("transcribe", prices, { durationMs: 10_283 })).toBeGreaterThan(0);
    // 600 caracteres de voz: 18.000 micro-USD.
    expect(reservationFor("speech", prices, { speechChars: 600 })).toBe(18_000);
    // Plan: reserva por llamada.
    expect(reservationFor("plan", prices)).toBe(prices.modelCallMicros);
    // Reserva con imagen, audio y voz.
    const withVoice = holdForJob(prices, { image: true, audioDurationMs: 10_283, voice: true });
    // Mayor que la de texto.
    expect(withVoice).toBeGreaterThan(prices.holdMicros);
    // Instantánea v1.
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
    // Se lee.
    expect(legacy?.version).toBe(RESEARCH_PRICE_VERSION_V1);
    // Sin tarifa de visión.
    expect(legacy ? reservationFor("vision", legacy) : 1).toBeNull();
    // Plan sí.
    expect(legacy ? reservationFor("plan", legacy) : 0).toBe(10);
  });

  // Falta la clave o el binding, no el modelo de voz por defecto.
  it("señala la clave o el binding ausente, no el modelo de voz por defecto", () => {
    // Entorno listo.
    const ready = {
      APP_MODE: "real",
      RESEARCH_MEDIA: {},
      AI: {},
      ANTHROPIC_API_KEY: "local-test-key",
      RESEARCH_MODEL_ID: "claude-haiku-5-5",
    } satisfies WorkerEnv;
    // No falta nada.
    expect(mediaMissing(ready, { image: true, audio: true, voice: true })).toEqual([]);
    // Sin clave de Anthropic.
    expect(
      mediaMissing(
        { ...ready, ANTHROPIC_API_KEY: undefined },
        { image: true, audio: false, voice: false },
      ),
    ).toEqual(["ANTHROPIC_API_KEY"]);
    // Modelo sin imagen.
    expect(
      mediaMissing(
        { ...ready, RESEARCH_MODEL_ID: "example/text-only" },
        { image: true, audio: false, voice: false },
      ),
    ).toEqual(["RESEARCH_VISION_MODEL_ID"]);
    // Sin Workers AI.
    expect(
      mediaMissing({ ...ready, AI: undefined }, { image: false, audio: true, voice: true }),
    ).toEqual(["AI"]);
  });

  // Subida, aislamiento, reutilización y reproducción.
  it("sube, aísla, reutiliza y reproduce sin otra reserva", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Bucket en memoria.
    const bucket = memoryMediaBucket();
    // Entorno.
    const env = envFor(database, bucket);
    // Sesión.
    const session = await send(env, `${demoOrigin}/api/research/session`);
    // Cookie.
    const cookie = cookieFrom(session);
    // Cabeceras comunes.
    const headers = {
      cookie,
      origin: demoOrigin,
    };
    // Conversación.
    const created = await send(env, `${demoOrigin}/api/research/conversations`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ audience: "M/J" }),
    });
    // 201.
    expect(created.status).toBe(201);
    // Id.
    const conversation = (await created.json()) as { id: string };
    // Imagen del aula.
    const image = await readFixtureBytes("dimension-mismatch.png");
    // Audio del aula.
    const audio = await readFixtureBytes("embedding-request.wav");
    // Sube unos bytes con una clave de idempotencia.
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
    // Sube la imagen con un MIME falso.
    const imageResponse = await upload(image, "idem-image-01", "text/html");
    // 201.
    expect(imageResponse.status).toBe(201);
    // Datos.
    const imageAsset = (await imageResponse.json()) as { id: string; mime: string };
    // El servidor detecta PNG.
    expect(imageAsset.mime).toBe("image/png");
    // Repite.
    const replay = await upload(image, "idem-image-01");
    // 200.
    expect(replay.status).toBe(200);
    // Mismo archivo.
    expect(((await replay.json()) as { id: string }).id).toBe(imageAsset.id);
    // Misma clave con otro archivo.
    const changed = await upload(await readFixtureBytes("unknown-square.png"), "idem-image-01");
    // Conflicto.
    expect(changed.status).toBe(409);
    // SVG.
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    // Rechazado.
    expect((await upload(svg, "idem-svg-01")).status).toBe(400);
    // PNG falsificado.
    const forgedPng = new Uint8Array(33);
    // Firma.
    forgedPng.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    // IHDR.
    forgedPng.set(new TextEncoder().encode("IHDR"), 12);
    // Ancho.
    forgedPng[19] = 8;
    // Alto.
    forgedPng[23] = 8;
    // Bits.
    forgedPng[24] = 8;
    // RGB.
    forgedPng[25] = 2;
    // IEND.
    forgedPng.set(new TextEncoder().encode("IEND"), 29);
    // Sube.
    const rejected = await upload(forgedPng, "idem-forged-png");
    // Rechazado.
    expect(rejected.status).toBe(400);
    // PNG con IDAT inválido.
    const invalidPng = invalidIdatPng();
    // JPEG con escaneo inválido.
    const invalidJpeg = invalidScanJpeg();
    // Tamaño.
    expect(invalidPng.byteLength).toBe(58);
    // Tamaño.
    expect(invalidJpeg.byteLength).toBe(31);
    // Sube el PNG.
    const badPng = await upload(invalidPng, "idem-bad-idat");
    // Sube el JPEG.
    const badJpeg = await upload(invalidJpeg, "idem-bad-scan");
    // 400.
    expect(badPng.status).toBe(400);
    // 400.
    expect(badJpeg.status).toBe(400);
    // Mensaje malformed.
    expect(((await badPng.json()) as { message?: string }).message).toContain("malformed");
    // Mensaje malformed.
    expect(((await badJpeg.json()) as { message?: string }).message).toContain("malformed");
    // Operaciones tras los rechazos.
    const operationsAfterReject = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    // Ninguna.
    expect(operationsAfterReject?.total ?? 0).toBe(0);
    // Filas del PNG falsificado.
    const assetsAfterReject = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_media_assets WHERE idempotency_key = ?`)
      .bind("idem-forged-png")
      .first<{ total: number }>();
    // Ninguna.
    expect(assetsAfterReject?.total ?? 0).toBe(0);
    // Filas de archivos malformados.
    const malformedAssets = await database
      .prepare(
        `SELECT COUNT(*) AS total FROM research_media_assets
         WHERE idempotency_key IN ('idem-bad-idat', 'idem-bad-scan', 'idem-forged-png')`,
      )
      .first<{ total: number }>();
    // Ninguna.
    expect(malformedAssets?.total ?? 0).toBe(0);
    // Sube el audio.
    const audioResponse = await upload(audio, "idem-audio-01");
    // 201.
    expect(audioResponse.status).toBe(201);
    // Datos.
    const audioAsset = (await audioResponse.json()) as { id: string; durationMs: number };
    // Más de 1 segundo.
    expect(audioAsset.durationMs).toBeGreaterThan(1_000);
    // Otra sesión.
    const otherSession = await send(env, `${demoOrigin}/api/research/session`);
    // Su cookie.
    const otherCookie = cookieFrom(otherSession);
    // Pide la imagen ajena.
    const foreign = await send(env, `${demoOrigin}/api/research/media/${imageAsset.id}`, {
      headers: { cookie: otherCookie },
    });
    // 404.
    expect(foreign.status).toBe(404);
    // Pide un rango de la propia.
    const owned = await send(env, `${demoOrigin}/api/research/media/${imageAsset.id}`, {
      headers: { cookie, range: "bytes=0-3" },
    });
    // 206.
    expect(owned.status).toBe(206);
    // Primeros 4 bytes.
    expect(new Uint8Array(await owned.arrayBuffer())).toEqual(image.subarray(0, 4));
    // Operaciones antes del trabajo.
    const before = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    // Trabajo con imagen, audio y voz.
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
    // 202.
    expect(submitted.status).toBe(202);
    // Trabajo.
    const job = (await submitted.json()) as { jobId: string };
    // Misma clave con otra voz.
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
    // Conflicto.
    expect(different.status).toBe(409);
    // Fila del trabajo.
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
    // Existe.
    expect(row).not.toBeNull();
    // Si no, termina.
    if (!row) return;
    // Paso en demo con el bucket.
    const tick = await runResearchTick(database, job.jobId, row.owner_id, undefined, {
      mode: "demo",
      bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    // Completo.
    expect(tick.status).toBe("complete");
    // Resultado.
    const result = await send(env, `${demoOrigin}/api/research/jobs/${job.jobId}/result`, {
      headers: { cookie },
    });
    // 200.
    expect(result.status).toBe(200);
    // Cuerpo.
    const payload = (await result.json()) as {
      // Resumen.
      summary: {
        // Medios.
        media?: {
          // Imagen.
          image?: { observedText?: string; status?: string };
          // Audio.
          audio?: { transcript?: string };
          // Voz.
          speech?: { status?: string; assetId?: string; text?: string };
        };
        // Resultado.
        outcome?: string;
      };
      // Informe.
      report: { text: string } | null;
    };
    // Texto de la imagen.
    expect(payload.summary.media?.image?.observedText).toContain("expected 1024, got 768");
    // Transcripción.
    expect(payload.summary.media?.audio?.transcript).toContain(
      "He cambiado el modelo de embeddings",
    );
    // Voz lista.
    expect(payload.summary.media?.speech?.status).toBe("ready");
    // Informe.
    expect(payload.report?.text.length).toBeGreaterThan(20);
    // Audio de la voz.
    const speech = await send(
      env,
      `${demoOrigin}/api/research/media/${payload.summary.media?.speech?.assetId ?? ""}`,
      { headers: { cookie } },
    );
    // 200.
    expect(speech.status).toBe(200);
    // WAV de prueba.
    expect(speech.headers.get("content-type")).toBe("audio/wav");
    // Nombre de descarga.
    expect(speech.headers.get("content-disposition")).toContain("respuesta.wav");
    // Audio válido.
    expect((await inspectMedia(new Uint8Array(await speech.arrayBuffer()))).ok).toBe(true);
    // Operaciones después.
    const after = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    // Hay más.
    expect((after?.total ?? 0) > (before?.total ?? 0)).toBe(true);
    // Repite el paso.
    const again = await runResearchTick(database, job.jobId, row.owner_id, undefined, {
      mode: "demo",
      bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    // Completo.
    expect(again.status).toBe("complete");
    // Operaciones.
    const still = await database
      .prepare(`SELECT COUNT(*) AS total FROM research_operations`)
      .first<{ total: number }>();
    // Sin operaciones nuevas.
    expect(still?.total).toBe(after?.total);
    // Operaciones del trabajo.
    const kinds = await listOperations(database, job.jobId);
    // Una visión completada.
    expect(
      kinds.filter((item) => item.kind === "vision" && item.state === "completed"),
    ).toHaveLength(1);
    // Una transcripción.
    expect(
      kinds.filter((item) => item.kind === "transcribe" && item.state === "completed"),
    ).toHaveLength(1);
    // Una voz.
    expect(
      kinds.filter((item) => item.kind === "speech" && item.state === "completed"),
    ).toHaveLength(1);
  });

  // Reutiliza una percepción completada y no reenvía una ambigua.
  it("reutiliza una percepción completada y no reenvía una ambigua", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Tarifas.
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    // Existen.
    expect(prices).not.toBeNull();
    // Si no, termina.
    if (!prices) return;
    // Conversación.
    const conversationId = crypto.randomUUID();
    // La inserta.
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'owner-a', 'M/J', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    // Admite un trabajo con reserva de visión.
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
    // Admitido.
    expect(admitted.ok).toBe(true);
    // Si no, termina.
    if (!admitted.ok) return;
    // Reclama el trabajo.
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "test",
      Date.now(),
      60_000,
    );
    // Reclamado.
    expect(claimed).not.toBeNull();
    // Si no, termina.
    if (!claimed) return;
    // Contador de llamadas.
    let calls = 0;
    // Primera visión.
    const first = await journalMediaCall(database, claimed, prices, {
      kind: "vision",
      payload: { hash: "sha256:abc" },
      signal: new AbortController().signal,
      invoke: async () => {
        // Cuenta.
        calls += 1;
        // Resultado.
        return {
          ok: true as const,
          value: { observedText: "expected 1024, got 768", notes: "texto", uncertain: false },
          consumption: { kind: "none" as const },
        };
      },
    });
    // Misma visión.
    const second = await journalMediaCall(database, claimed, prices, {
      kind: "vision",
      payload: { hash: "sha256:abc" },
      signal: new AbortController().signal,
      invoke: async () => {
        // Cuenta.
        calls += 1;
        // Otro resultado.
        return {
          ok: true as const,
          value: { observedText: "otro", notes: "", uncertain: true },
          consumption: { kind: "none" as const },
        };
      },
    });
    // Una sola llamada.
    expect(calls).toBe(1);
    // Reutiliza la primera.
    expect(second).toEqual(first);
    // Operación.
    const operation = (await listOperations(database, claimed.id))[0];
    // Existe.
    expect(operation).toBeDefined();
    // Si no, termina.
    if (!operation) return;
    // La marca como enviada sin resultado.
    await database
      .prepare(
        `UPDATE research_operations SET state = 'dispatched', result_json = NULL WHERE id = ?`,
      )
      .bind(operation.id)
      .run();
    // Ahora pide atención.
    await expect(
      journalMediaCall(database, claimed, prices, {
        kind: "vision",
        payload: { hash: "sha256:abc" },
        signal: new AbortController().signal,
        invoke: async () => {
          // Cuenta.
          calls += 1;
          // Resultado.
          return {
            ok: true as const,
            value: { observedText: "x", notes: "", uncertain: false },
            consumption: { kind: "none" as const },
          };
        },
      }),
    ).rejects.toBeInstanceOf(ResearchAttention);
    // Sin llamadas nuevas.
    expect(calls).toBe(1);
    // Guardar con otra ficha falla.
    const stale = await completeOperation(database, {
      operationId: operation.id,
      fence: claimed.lease_token + 9,
      resultJson: "{}",
      consumption: { kind: "none" },
      reservation: operation.reservation_micros,
    });
    // No se guarda.
    expect(stale).toBe(false);
    // Vence el plazo.
    await database
      .prepare(`UPDATE research_jobs SET deadline_at = ? WHERE id = ?`)
      .bind(Date.now() - 1, claimed.id)
      .run();
    // Trabajo caducado.
    const expired = await getJob(database, "owner-a", claimed.id);
    // Existe.
    expect(expired).not.toBeNull();
    // Si no, termina.
    if (!expired) return;
    // Marca enviada.
    await markDispatched(database, operation.id, claimed.lease_token);
    // La voz pide atención.
    await expect(
      journalMediaCall(database, expired, prices, {
        kind: "speech",
        speechChars: 20,
        payload: { digest: "otro" },
        signal: new AbortController().signal,
        invoke: async () => {
          // Cuenta.
          calls += 1;
          // Resultado.
          return {
            ok: true as const,
            value: { assetId: "x", mime: "audio/wav" },
            consumption: { kind: "none" as const },
          };
        },
      }),
    ).rejects.toBeInstanceOf(ResearchAttention);
    // Sin llamadas nuevas.
    expect(calls).toBe(1);
  });

  // Voz sin adjuntos: conserva la pregunta.
  it("la voz sin adjuntos conserva la pregunta y no fusiona la entrada", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Tarifas.
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    // Existen.
    expect(prices).not.toBeNull();
    // Si no, termina.
    if (!prices) return;
    // Reserva con voz.
    const hold = holdForJob(prices, { image: false, audioDurationMs: null, voice: true });
    // Existe.
    expect(hold).not.toBeNull();
    // Si no, termina.
    if (hold === null) return;
    // Conversación.
    const conversationId = crypto.randomUUID();
    // Pregunta.
    const question = "¿Para qué sirve un checkpointer en LangGraph?";
    // La inserta.
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'owner-a', 'M/J', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    // Trabajo solo con voz.
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
    // Admitido.
    expect(admitted.ok).toBe(true);
    // Si no, termina.
    if (!admitted.ok) return;
    // Percepción.
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
    // Lista.
    expect(perceived.kind).toBe("ready");
    // Si no, termina.
    if (perceived.kind !== "ready") return;
    // Puede seguir.
    expect(perceived.proceed).toBe(true);
    // Pregunta con memoria.
    expect(perceived.question).toBe(`Memoria previa.\n\nPregunta actual:\n${question}`);
    // Sin texto de adjuntos.
    expect(perceived.question).not.toContain("contenido no confiable");
    // Sin fuentes.
    expect(perceived.sources).toEqual([]);
  });

  // Borra el objeto huérfano solo si borra la fila.
  it("borra el objeto huérfano solo cuando borra la fila", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Bucket.
    const bucket = memoryMediaBucket();
    // Clave huérfana.
    const orphanKey = "research/owner-a/conversation/orphan";
    // Clave usada.
    const boundKey = "research/owner-a/conversation/bound";
    // Guarda el huérfano.
    await bucket.put(orphanKey, new Uint8Array([1, 2, 3]));
    // Guarda el usado.
    await bucket.put(boundKey, new Uint8Array([4, 5, 6]));
    // Fila huérfana.
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
    // Fila ligada a un trabajo.
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
    // La ligada no se borra.
    expect(await deleteMediaRow(database, "22222222-2222-4222-8222-222222222222")).toBe(false);
    // Se purga un huérfano.
    expect(await purgeOrphanMedia(database, bucket, 10_000, 1)).toBe(1);
    // Su objeto ya no existe.
    expect(await bucket.head(orphanKey)).toBeNull();
    // El usado sigue.
    expect(await bucket.head(boundKey)).not.toBeNull();
  });

  // Si falla guardar la voz, el informe se conserva.
  it("conserva el informe cuando la voz falla al guardar el audio", async () => {
    // Base.
    const database = await openResearchSqlite();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Tarifas.
    const prices = priceSnapshot({
      budgetUsd: "1.000000",
      jobLimitUsd: "0.250000",
      inputUsdPerMillion: "0.100000",
      outputUsdPerMillion: "0.500000",
      searchUsd: "0.002000",
      readUsd: "0.005000",
    });
    // Existen.
    expect(prices).not.toBeNull();
    // Si no, termina.
    if (!prices) return;
    // Reserva con imagen y voz.
    const hold = holdForJob(prices, { image: true, audioDurationMs: null, voice: true });
    // Existe.
    expect(hold).not.toBeNull();
    // Si no, termina.
    if (hold === null) return;
    // Imagen.
    const image = await readFixtureBytes("dimension-mismatch.png");
    // Hash.
    const hash = await sha256Bytes(image);
    // Conversación.
    const conversationId = crypto.randomUUID();
    // Archivo.
    const assetId = crypto.randomUUID();
    // Conversación.
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'owner-a', 'M/J', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    // Bucket.
    const bucket = memoryMediaBucket();
    // put original.
    const put = bucket.put.bind(bucket);
    // put que falla para la voz.
    bucket.put = (key, value, options) => {
      // Voz: error.
      if (key.includes("/speech/")) return Promise.reject(new Error("speech-put-failed"));
      // Resto: normal.
      return put(key, value, options);
    };
    // Guarda la imagen.
    await bucket.put(`research/owner-a/${conversationId}/${assetId}`, image, {
      httpMetadata: { contentType: "image/png" },
    });
    // Fila de la imagen.
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
    // Trabajo con imagen y voz.
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
    // Admitido.
    expect(admitted.ok).toBe(true);
    // Si no, termina.
    if (!admitted.ok) return;
    // Paso.
    const tick = await runResearchTick(database, admitted.job.id, "owner-a", undefined, {
      mode: "demo",
      bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    // Trabajo.
    const job = await getJob(database, "owner-a", admitted.job.id);
    // Tiene resultado.
    expect(job?.result_json).toBeTruthy();
    // Resultado presentado.
    const presented = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      job?.result_json ?? "",
    );
    // Informe conservado.
    expect(presented?.report?.text).toContain("no formula");
    // Voz fallida.
    expect(presented?.summary.media?.speech?.status).toBe("failed");
    // Estado final.
    expect(["complete", "attention", "failed"]).toContain(tick.status);
  });
});
