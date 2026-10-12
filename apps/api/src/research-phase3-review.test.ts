// GUÍA DE LECTURA · apps/api/src/research-phase3-review.test.ts
// Pruebas de las correcciones de la fase 3 (multimodal): guion del aula sin escenario, memoria de imagen y
// audio, compactación de la memoria, aclaración cuando la fusión no cabe y esperas que no terminan.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Versión del corpus de ejemplo.
import { fixtureCorpusVersion } from "./fixture";
// Lee archivos de ejemplo.
import { readFixtureBytes } from "./fixture-bytes";
// Inspección y hash de bytes.
import { inspectMedia, sha256Bytes } from "./media-bytes";
// Cabecera de la memoria y contextualización.
import { RESEARCH_MEMORY_HEADER, contextualize } from "./research-memory";
// Filas de medios y bucket en memoria.
import { insertAsset, memoryMediaBucket } from "./research-media";
// Percepción del trabajo.
import { perceiveJob } from "./research-multimodal";
// Reserva y tarifas.
import { holdForJob, priceSnapshot } from "./research-money";
// Diario de llamadas de medios.
import { journalMediaCall } from "./research-journal";
// Tablas de la investigación.
import { ensureResearchSchema } from "./research-db";
// Puertos de prueba.
import { createFixtureResearchPorts } from "./research-fixture";
// Paso del trabajo.
import { runResearchTick } from "./research-runner";
// D1 simulada con SQLite.
import { openResearchSqlite } from "./research-sqlite";
// Operaciones del almacén.
import {
  admitJob,
  claimJob,
  getJob,
  listMessages,
  listOperations,
  memoryTurns,
  readAccount,
} from "./research-store";
// Error de atención.
import { ResearchAttention } from "./research-state";

// Tarifas de prueba.
const prices = priceSnapshot({
  budgetUsd: "1.000000",
  jobLimitUsd: "0.250000",
  inputUsdPerMillion: "0.100000",
  outputUsdPerMillion: "0.500000",
  searchUsd: "0.002000",
  readUsd: "0.005000",
});

// Base preparada.
async function ready(filename = ":memory:") {
  // SQLite.
  const database = await openResearchSqlite(filename);
  // Tablas y cuenta.
  await ensureResearchSchema(database, 1_000_000);
  // Base.
  return database;
}

// Crea un trabajo con la imagen y el audio del aula.
async function classroomJob(
  database: Awaited<ReturnType<typeof ready>>,
  input: {
    // Pregunta.
    question?: string;
    // Voz.
    voice?: boolean;
    // Plazo.
    deadlineMs?: number;
    // Propietario.
    ownerId?: string;
    // Con imagen.
    image?: boolean;
    // Con audio.
    audio?: boolean;
  },
) {
  // Sin tarifas: error.
  if (!prices) throw new Error("sin tarifas");
  // Propietario.
  const ownerId = input.ownerId ?? "review-owner";
  // Conversación.
  const conversationId = crypto.randomUUID();
  // La inserta.
  await database
    .prepare(
      `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
       VALUES (?, ?, 'M/J', 1, 1)`,
    )
    .bind(conversationId, ownerId)
    .run();
  // Bucket.
  const bucket = memoryMediaBucket();
  // ¿Imagen?
  const withImage = input.image !== false;
  // ¿Audio?
  const withAudio = input.audio !== false;
  // Bytes de la imagen.
  const image = withImage ? await readFixtureBytes("dimension-mismatch.png") : null;
  // Bytes del audio.
  const audio = withAudio ? await readFixtureBytes("embedding-request.wav") : null;
  // Datos de la imagen.
  const imageFacts = image ? await inspectMedia(image) : null;
  // Datos del audio.
  const audioFacts = audio ? await inspectMedia(audio) : null;
  // Imagen inválida.
  if (image && (!imageFacts?.ok || imageFacts.facts.role !== "image")) throw new Error("imagen");
  // Audio inválido.
  if (audio && (!audioFacts?.ok || audioFacts.facts.role !== "audio")) throw new Error("audio");
  // Id de la imagen.
  const imageId = crypto.randomUUID();
  // Id del audio.
  const audioId = crypto.randomUUID();
  // Hash de la imagen.
  const imageHash = image ? await sha256Bytes(image) : "";
  // Hash del audio.
  const audioHash = audio ? await sha256Bytes(audio) : "";
  // Guarda la imagen.
  if (image) await bucket.put(`review/${imageId}`, image);
  // Guarda el audio.
  if (audio) await bucket.put(`review/${audioId}`, audio);
  // Momento.
  const now = Date.now();
  // Filas de los medios.
  const rows = [
    // Fila de imagen solo si se pasó una imagen válida.
    ...(image && imageFacts?.ok && imageFacts.facts.role === "image"
      ? [
          // Id, papel, clave de R2, hash, tipo, bytes y dimensiones.
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
    // Fila de audio solo si se pasó un WAV válido.
    ...(audio && audioFacts?.ok && audioFacts.facts.role === "audio"
      ? [
          // Id, papel, clave, hash, tipo, bytes y duración.
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
  // Cada medio.
  for (const asset of rows) {
    // Su fila.
    await insertAsset(database, {
      // Datos comunes del archivo.
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
      // Formato de audio de la prueba: 16 kHz, mono, 16 bits.
      sample_rate: asset.role === "audio" ? 16_000 : null,
      channels: asset.role === "audio" ? 1 : null,
      bit_depth: asset.role === "audio" ? 16 : null,
      // Admitido y sin trabajo.
      status: "admitted",
      extracted_text: null,
      detail: null,
      job_id: null,
      idempotency_key: `review-${asset.id}`,
      created_at: now,
    });
  }
  // Duración del audio.
  const duration =
    audioFacts?.ok && audioFacts.facts.role === "audio" ? audioFacts.facts.durationMs : null;
  // Reserva.
  const hold = holdForJob(prices, {
    image: image !== null,
    audioDurationMs: duration,
    voice: input.voice === true,
  });
  // Sin reserva: error.
  if (hold === null) throw new Error("reserva");
  // Admite el trabajo.
  const admitted = await admitJob(database, {
    // Dueño, conversación, clave y huella fijas de la revisión.
    ownerId,
    conversationId,
    idempotencyKey: "review-job",
    fingerprint: "review-fingerprint",
    // Pregunta opcional del caso.
    originalQuestion: input.question ?? "",
    contextualized: null,
    scenarioId: null,
    corpusVersion: fixtureCorpusVersion(),
    // Reserva calculada para los medios del caso.
    prices: { ...prices, holdMicros: hold },
    now,
    // Plazo configurable para probar la falta de tiempo.
    deadlineMs: input.deadlineMs ?? 120_000,
    queueMs: 60_000,
    // Voz, imagen y audio según el caso.
    media: {
      voice: input.voice === true,
      image: image ? { id: imageId, hash: imageHash } : null,
      audio:
        audio && duration !== null ? { id: audioId, hash: audioHash, durationMs: duration } : null,
    },
  });
  // Rechazado: error.
  if (!admitted.ok) throw new Error(admitted.reason);
  // Datos del trabajo.
  return { database, bucket, admitted: admitted.job, ownerId, conversationId, imageId, audioId };
}

// Grupo: correcciones de la fase 3.
describe("correcciones de la revisión de la fase 3", () => {
  // El guion del aula se usa en todo el recorrido sin escenario.
  it("resuelve el guion del aula para todo el recorrido, sin escenario explícito", async () => {
    // Base.
    const database = await ready();
    // Trabajo con voz.
    const job = await classroomJob(database, { question: "", voice: true });
    // Paso en demo.
    const tick = await runResearchTick(database, job.admitted.id, job.ownerId, undefined, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    // Completo.
    expect(tick.status).toBe("complete");
    // Trabajo.
    const stored = await getJob(database, job.ownerId, job.admitted.id);
    // Sin escenario.
    expect(stored?.scenario_id).toBeNull();
    // Misma huella.
    expect(stored?.fingerprint).toBe("review-fingerprint");
    // Resultado.
    const body = JSON.parse(stored?.result_json ?? "{}") as {
      // Resumen.
      summary: {
        // Resultado.
        outcome: string;
        // Lecturas.
        pagesRead: unknown[];
        // Aceptadas.
        accepted: unknown[];
        // Voz.
        media?: { speech?: { detail?: string } };
      };
      // Fuentes.
      sources: { sourceId: string; authority?: string }[];
      // Informe.
      report?: { text?: string };
    };
    // Completo.
    expect(body.summary.outcome).toBe("complete");
    // Hubo lecturas.
    expect(body.summary.pagesRead.length).toBeGreaterThan(0);
    // Hubo aceptadas.
    expect(body.summary.accepted.length).toBeGreaterThan(0);
    // No todo son adjuntos.
    expect(body.sources.some((source) => source.authority !== "user-input")).toBe(true);
    // Informe de prueba.
    expect(body.report?.text ?? "").toContain("Informe de prueba");
    // La voz avisa de que es de prueba.
    expect(body.summary.media?.speech?.detail ?? "").toContain("no es");
    // Repetir el envío.
    const repeated = await admitJob(database, {
      // Mismo envío que el original: debe devolver el mismo trabajo sin crear otro.
      ownerId: job.ownerId,
      conversationId: job.conversationId,
      idempotencyKey: "review-job",
      fingerprint: "review-fingerprint",
      originalQuestion: "",
      contextualized: null,
      scenarioId: null,
      corpusVersion: fixtureCorpusVersion(),
      // Misma reserva que el trabajo ya admitido.
      prices: { ...prices!, holdMicros: job.admitted.reserved_micros },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      // Mismos archivos con sus hashes recalculados.
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
    // Mismo trabajo.
    expect(repeated.ok && repeated.job.id).toBe(job.admitted.id);
  });

  // Recuerda imagen y audio en el turno siguiente sin duplicar.
  it("recuerda la imagen y el audio en el turno siguiente y no los duplica", async () => {
    // Base.
    const database = await ready();
    // Trabajo sin voz.
    const job = await classroomJob(database, { question: "", voice: false });
    // Paso.
    await runResearchTick(database, job.admitted.id, job.ownerId, undefined, {
      mode: "demo",
      bucket: job.bucket,
      ai: null,
      vision: null,
      visionModelId: null,
      sttModelId: "@cf/openai/whisper-large-v3-turbo",
      ttsModelId: "@cf/deepgram/aura-2-es",
    });
    // Trabajo.
    const claimed = await getJob(database, job.ownerId, job.admitted.id);
    // Sin trabajo.
    if (!claimed) throw new Error("sin trabajo");
    // Percibe otra vez.
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
    // Turnos.
    const own = await memoryTurns(database, job.ownerId, job.conversationId);
    // Del usuario.
    const user = own.filter((turn) => turn.role === "user");
    // Uno solo.
    expect(user).toHaveLength(1);
    // Con la imagen.
    expect(user[0]?.text).toContain("1024");
    // Con el audio.
    expect(user[0]?.text).toContain("He cambiado el modelo de embeddings");
    // Sin bytes.
    expect(user[0]?.text).not.toContain("base64");
    // Seguimiento sobre la captura.
    const follow = contextualize(own, "¿Qué dimensiones aparecían en mi captura?");
    // Con la imagen.
    expect(follow.contextualized).toContain("1024");
    // Con el audio.
    expect(follow.contextualized).toContain("He cambiado el modelo de embeddings");
    // Avisa de que no es evidencia del curso.
    expect(follow.contextualized).toContain("no es evidencia del curso");
    // Seguimiento sobre el audio.
    const spoken = contextualize(own, "¿Qué pedía el audio?");
    // Con el audio.
    expect(spoken.contextualized).toContain("He cambiado el modelo de embeddings");
    // Otro propietario no lo ve.
    expect(await memoryTurns(database, "otra-persona", job.conversationId)).toEqual([]);
    // Relee.
    const again = await memoryTurns(database, job.ownerId, job.conversationId);
    // Sigue.
    expect(again.some((turn) => turn.text.includes("1024"))).toBe(true);
    // Cierra.
    database.close();
  });

  // Compacta la memoria previa conservando la imagen y el audio.
  it("compacta la memoria previa antes de perder la imagen y el audio", async () => {
    // Base.
    const database = await ready();
    // Trabajo con pregunta.
    const job = await classroomJob(database, {
      question: "Investiga este error de dimensiones.",
      voice: false,
    });
    // Memoria previa muy larga.
    await database
      .prepare(`UPDATE research_jobs SET contextualized_question = ? WHERE id = ?`)
      .bind(
        `${RESEARCH_MEMORY_HEADER}token-antiguo-0001\n${"x".repeat(4_000)}\ndato-reciente-9981\n\nPregunta actual:\nvieja`,
        job.admitted.id,
      )
      .run();
    // Reclama.
    const claimed = await claimJob(
      database,
      job.ownerId,
      job.admitted.id,
      "review",
      Date.now(),
      180_000,
    );
    // Percibe.
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
    // Lista.
    expect(perceived.kind).toBe("ready");
    // Si no, termina.
    if (perceived.kind !== "ready") return;
    // Sigue.
    expect(perceived.proceed).toBe(true);
    // Imagen.
    expect(perceived.question).toContain("expected 1024");
    // Audio.
    expect(perceived.question).toContain("He cambiado el modelo de embeddings");
    // Cabecera de memoria.
    expect(perceived.question).toContain(RESEARCH_MEMORY_HEADER.trim());
    // Final reciente.
    expect(perceived.question).toContain("dato-reciente-9981");
    // Sin el principio antiguo.
    expect(perceived.question).not.toContain("token-antiguo-0001");
    // Dentro del máximo.
    expect(perceived.question.length).toBeLessThanOrEqual(2_000);
  });

  // Conserva la petición final si la memoria no cabe.
  it("conserva la petición final cuando la memoria previa no cabe", async () => {
    // Base.
    const database = await ready();
    // Pregunta larga.
    const question = `${"n".repeat(800)} Investiga cómo resolver ERROR_AUTH_401.`;
    // Trabajo.
    const job = await classroomJob(database, { question, voice: false });
    // Memoria larga.
    await database
      .prepare(`UPDATE research_jobs SET contextualized_question = ? WHERE id = ?`)
      .bind(
        `${RESEARCH_MEMORY_HEADER}token-antiguo-0001\n${"x".repeat(4_000)}\ndato-reciente-9981\n\nPregunta actual:\nvieja`,
        job.admitted.id,
      )
      .run();
    // Reclama.
    const claimed = await claimJob(
      database,
      job.ownerId,
      job.admitted.id,
      "review",
      Date.now(),
      180_000,
    );
    // Percibe.
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
    // Lista.
    expect(perceived.kind).toBe("ready");
    // Si no, termina.
    if (perceived.kind !== "ready") return;
    // Sigue.
    expect(perceived.proceed).toBe(true);
    // Sin aclaración.
    expect(perceived.clarify).toBeNull();
    // Petición final.
    expect(perceived.question).toContain("ERROR_AUTH_401");
    // Imagen.
    expect(perceived.question).toContain("expected 1024");
    // Audio.
    expect(perceived.question).toContain("He cambiado el modelo de embeddings");
    // Final reciente.
    expect(perceived.question).toContain("dato-reciente-9981");
    // Sin el principio.
    expect(perceived.question).not.toContain("token-antiguo-0001");
    // Dentro del máximo.
    expect(perceived.question.length).toBeLessThanOrEqual(2_000);
    // Texto de la imagen.
    expect(perceived.media.image?.observedText).toContain("1024");
    // Transcripción.
    expect(perceived.media.audio?.transcript).toContain("embeddings");
  });

  // Si la fusión perdería la petición, no planifica ni busca.
  it("no planifica ni busca si la fusión perdería la petición", async () => {
    // Base.
    const database = await ready();
    // Pregunta casi en el máximo.
    const question = `${"x".repeat(1_900)} Investiga cómo resolver ERROR_AUTH_401.`;
    // Trabajo.
    const job = await classroomJob(database, { question, voice: false });
    // Memoria larga.
    await database
      .prepare(`UPDATE research_jobs SET contextualized_question = ? WHERE id = ?`)
      .bind(
        `${RESEARCH_MEMORY_HEADER}${"memoria ".repeat(400)}\n\nPregunta actual:\nvieja`,
        job.admitted.id,
      )
      .run();
    // Búsquedas.
    let searches = 0;
    // Planes.
    let plans = 0;
    // Paso con puertos que cuentan.
    const tick = await runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      (signal, row) => {
        // Puertos de prueba.
        const ports = createFixtureResearchPorts({
          signal,
          scenarioId: row.scenario_id,
          audience: row.audience,
          corpusVersion: row.corpus_version,
        });
        // Plan y búsqueda contados.
        return {
          ...ports,
          model: {
            ...ports.model,
            plan: (input, context) => {
              // Cuenta.
              plans += 1;
              // Delega.
              return ports.model.plan(input, context);
            },
          },
          search: {
            search: async (input, context) => {
              // Cuenta.
              searches += 1;
              // Delega.
              return ports.search.search(input, context);
            },
          },
        };
      },
      {
        // Contexto de medios de la demo: sin AI ni visión reales, con los modelos de Workers AI por
        // defecto.
        mode: "demo",
        bucket: job.bucket,
        ai: null,
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    // Completo.
    expect(tick.status).toBe("complete");
    // Sin búsquedas.
    expect(searches).toBe(0);
    // Sin planes.
    expect(plans).toBe(0);
    // Trabajo.
    const stored = await getJob(database, job.ownerId, job.admitted.id);
    // Pregunta original intacta.
    expect(stored?.original_question).toBe(question);
    // Misma clave.
    expect(stored?.idempotency_key).toBe("review-job");
    // Misma huella.
    expect(stored?.fingerprint).toBe("review-fingerprint");
    // Resultado.
    const body = JSON.parse(stored?.result_json ?? "{}") as {
      // Resumen.
      summary: {
        // Resultado.
        outcome: string;
        // Detalle de la parada.
        stopDetail: string;
        // Ruta.
        route: string | null;
        // Búsquedas.
        searches: unknown[];
        // Medios.
        media?: {
          // Imagen.
          image?: { observedText?: string };
          // Audio.
          audio?: { transcript?: string };
        };
      };
      // Informe.
      report?: { text?: string };
    };
    // Aclaración.
    expect(body.summary.outcome).toBe("clarify");
    // Sin ruta.
    expect(body.summary.route).toBeNull();
    // Explica que no cabe.
    expect(body.summary.stopDetail).toContain("no cabe");
    // Sin búsquedas.
    expect(body.summary.searches).toEqual([]);
    // Informe explicativo.
    expect(body.report?.text ?? "").toContain("no cabe");
    // Sin informe de prueba.
    expect(body.report?.text ?? "").not.toContain("Informe de prueba");
    // Imagen leída.
    expect(body.summary.media?.image?.observedText).toContain("1024");
    // Audio transcrito.
    expect(body.summary.media?.audio?.transcript).toContain("He cambiado el modelo de embeddings");
    // Tipos de operación del grafo.
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
    // Operaciones.
    const operations = await listOperations(database, job.admitted.id);
    // Ninguna del grafo.
    expect(operations.some((operation) => graphKinds.has(operation.kind))).toBe(false);
    // Visión.
    expect(operations.some((operation) => operation.kind === "vision")).toBe(true);
    // Transcripción.
    expect(operations.some((operation) => operation.kind === "transcribe")).toBe(true);
    // Sin voz.
    expect(operations.some((operation) => operation.kind === "speech")).toBe(false);
    // Repetir el envío.
    const repeated = await admitJob(database, {
      // Mismo envío pero sin voz: la huella cambia.
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
      // Voz desactivada y los mismos archivos.
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
    // Mismo trabajo.
    expect(repeated.ok && repeated.job.id).toBe(job.admitted.id);
  });

  // No espera a una transcripción que ignora la cancelación.
  it("no espera a una transcripción que ignora la cancelación ni publica su éxito tardío", async () => {
    // Base.
    const database = await ready();
    // Trabajo con plazo de 350 ms y solo audio.
    const job = await classroomJob(database, { deadlineMs: 350, voice: false, image: false });
    // Llamadas.
    let calls = 0;
    // Si terminó tarde.
    let late = false;
    // Búsquedas.
    let searches = 0;
    // Inicio.
    const started = Date.now();
    // Paso con Whisper lento.
    const tick = runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      (signal, row) => {
        // Puertos de prueba.
        const ports = createFixtureResearchPorts({
          signal,
          scenarioId: row.scenario_id,
          audience: row.audience,
          corpusVersion: row.corpus_version,
        });
        // Búsqueda contada.
        return {
          ...ports,
          search: {
            search: async (input, context) => {
              // Cuenta.
              searches += 1;
              // Delega.
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
            // Cuenta.
            calls += 1;
            // Tarda 1,6 s.
            await new Promise((resolve) => setTimeout(resolve, 1_600));
            // Marca tarde.
            late = true;
            // Transcripción.
            return { text: "Investiga el error de embeddings." };
          },
        },
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    // Atención.
    await expect(tick).resolves.toMatchObject({ status: "attention" });
    // Antes de 900 ms.
    expect(Date.now() - started).toBeLessThan(900);
    // Una llamada.
    expect(calls).toBe(1);
    // Sin búsquedas.
    expect(searches).toBe(0);
    // Operaciones.
    const operations = await listOperations(database, job.admitted.id);
    // Transcripción.
    const transcript = operations.find((operation) => operation.kind === "transcribe");
    // Desconocida.
    expect(transcript?.state).toBe("unknown");
    // Sin resultado.
    expect(transcript?.result_json).toBeNull();
    // Con retención.
    expect(transcript?.unknown_hold_micros).toBeGreaterThan(0);
    // Cargo desconocido en la cuenta.
    expect((await readAccount(database))?.unknown_micros).toBeGreaterThan(0);
    // Espera a que termine tarde.
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    // Terminó.
    expect(late).toBe(true);
    // Operación.
    const after = (await listOperations(database, job.admitted.id)).find(
      (operation) => operation.kind === "transcribe",
    );
    // Sigue desconocida.
    expect(after?.state).toBe("unknown");
    // Sin resultado.
    expect(after?.result_json).toBeNull();
    // Pasos reanudados.
    let resumed = 0;
    // Otro paso.
    await runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      () => {
        // Cuenta.
        resumed += 1;
        // Puertos.
        return createFixtureResearchPorts({
          // Puertos de demo para la reanudación.
          signal: new AbortController().signal,
          scenarioId: null,
          audience: "M/J",
          corpusVersion: fixtureCorpusVersion(),
        });
      },
      {
        // Contexto en modo real con un binding AI simulado.
        mode: "real",
        bucket: job.bucket,
        ai: {
          run: async () => {
            // Cuenta.
            calls += 1;
            // No debería llamarse.
            return { text: "no debe llamarse" };
          },
        },
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    // Sin nuevas llamadas.
    expect(calls).toBe(1);
    // No crea puertos.
    expect(resumed).toBe(0);
  });

  // Termina la espera de una voz o promesa que no acaba.
  it("termina la espera de una voz o una promesa que no acaba", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const conversationId = crypto.randomUUID();
    // La inserta.
    await database
      .prepare(
        `INSERT INTO research_conversations (id, owner_id, audience, created_at, updated_at)
         VALUES (?, 'review-owner', 'program', 1, 1)`,
      )
      .bind(conversationId)
      .run();
    // Reserva de voz.
    const hold = holdForJob(prices!, { image: false, audioDurationMs: null, voice: true });
    // Trabajo con voz.
    const admitted = await admitJob(database, {
      // Trabajo con voz y guion suficiente, para probar el plazo de la voz.
      ownerId: "review-owner",
      conversationId,
      idempotencyKey: "speech-deadline",
      fingerprint: "speech-fingerprint",
      originalQuestion: "¿Qué es un checkpointer?",
      contextualized: null,
      scenarioId: "sufficient-first-round",
      corpusVersion: fixtureCorpusVersion(),
      // Reserva que incluye la voz.
      prices: { ...prices!, holdMicros: hold ?? 1 },
      now: Date.now(),
      deadlineMs: 120_000,
      queueMs: 60_000,
      // Solo voz.
      media: { voice: true, image: null, audio: null },
    });
    // Rechazado: error.
    if (!admitted.ok) throw new Error(admitted.reason);
    // Reclama.
    const claimed = await claimJob(
      database,
      "review-owner",
      admitted.job.id,
      "review",
      Date.now(),
      180_000,
    );
    // Sin arrendamiento: error.
    if (!claimed) throw new Error("sin arrendamiento");
    // Inicio.
    const started = Date.now();
    // Voz que nunca acaba con plazo de 120 ms.
    await expect(
      journalMediaCall(database, { ...claimed, deadline_at: Date.now() + 120 }, prices!, {
        kind: "speech",
        speechChars: 40,
        payload: { digest: "hang" },
        signal: new AbortController().signal,
        invoke: () => new Promise(() => undefined),
      }),
    ).rejects.toBeInstanceOf(ResearchAttention);
    // Antes de 700 ms.
    expect(Date.now() - started).toBeLessThan(700);
    // Operación.
    const hung = (await listOperations(database, claimed.id)).find(
      (operation) => operation.kind === "speech",
    );
    // Desconocida.
    expect(hung?.state).toBe("unknown");
    // Controlador.
    const controller = new AbortController();
    // Inicio.
    const lateStart = Date.now();
    // Voz que tarda 400 ms.
    const pending = journalMediaCall(database, claimed, prices!, {
      kind: "speech",
      speechChars: 40,
      payload: { digest: "late" },
      signal: controller.signal,
      invoke: async () => {
        // Espera.
        await new Promise((resolve) => setTimeout(resolve, 400));
        // Resultado.
        return {
          ok: true as const,
          value: { assetId: "late", mime: "audio/mpeg" },
          consumption: { kind: "none" as const },
        };
      },
    });
    // Cancela a los 40 ms.
    setTimeout(() => controller.abort(), 40);
    // Atención.
    await expect(pending).rejects.toBeInstanceOf(ResearchAttention);
    // Antes de 700 ms.
    expect(Date.now() - lateStart).toBeLessThan(700);
    // Espera a que termine.
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Operación.
    const late = (await listOperations(database, claimed.id)).find(
      (operation) => operation.fingerprint !== hung?.fingerprint && operation.kind === "speech",
    );
    // Desconocida.
    expect(late?.state).toBe("unknown");
    // Sin resultado.
    expect(late?.result_json).toBeNull();
  });

  // Cancelar durante la percepción no arranca nada más.
  it("cancela la percepción y la voz sin arrancar la operación siguiente", async () => {
    // Base.
    const database = await ready();
    // Trabajo solo con audio.
    const job = await classroomJob(database, { voice: false, image: false });
    // Llamadas.
    let calls = 0;
    // Búsquedas.
    let searches = 0;
    // Promesa que se resuelve al empezar la llamada.
    const started = new Promise<void>((resolve) => {
      // Comprueba cada 10 ms.
      const timer = setInterval(() => {
        // Ya empezó.
        if (calls > 0) {
          // Para de comprobar.
          clearInterval(timer);
          // Resuelve.
          resolve();
        }
      }, 10);
    });
    // Paso con Whisper lento.
    const tick = runResearchTick(
      database,
      job.admitted.id,
      job.ownerId,
      (signal, row) => {
        // Puertos de prueba.
        const ports = createFixtureResearchPorts({
          signal,
          scenarioId: row.scenario_id,
          audience: row.audience,
          corpusVersion: row.corpus_version,
        });
        // Búsqueda contada.
        return {
          ...ports,
          search: {
            search: async (input, context) => {
              // Cuenta.
              searches += 1;
              // Delega.
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
            // Cuenta.
            calls += 1;
            // Tarda.
            await new Promise((resolve) => setTimeout(resolve, 1_600));
            // Transcripción.
            return { text: "tarde" };
          },
        },
        vision: null,
        visionModelId: null,
        sttModelId: "@cf/openai/whisper-large-v3-turbo",
        ttsModelId: "@cf/deepgram/aura-2-es",
      },
    );
    // Espera a que empiece.
    await started;
    // Pide cancelar.
    await database
      .prepare(`UPDATE research_jobs SET cancel_requested = 1 WHERE id = ?`)
      .bind(job.admitted.id)
      .run();
    // Resultado.
    const result = await tick;
    // Atención o cancelado.
    expect(result.status === "attention" || result.status === "cancelled").toBe(true);
    // Una llamada.
    expect(calls).toBe(1);
    // Sin búsquedas.
    expect(searches).toBe(0);
    // Mensajes.
    const messages = await listMessages(database, job.ownerId, job.conversationId);
    // Un turno de usuario.
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
  });
});
