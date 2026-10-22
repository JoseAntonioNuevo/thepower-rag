// GUÍA DE LECTURA · apps/api/src/research-durable.test.ts
// Pruebas del almacén durable con SQLite: aislamiento por propietario y conversación, idempotencia,
// presupuesto, arrendamientos, operaciones ambiguas, cancelación, retención, checkpointer y recuperación.
// LangGraph para un grafo mínimo de prueba.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
// Límites de la investigación.
import { RESEARCH_LIMITS } from "@thepower-rag/contracts";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Capacidades del Worker.
import { assessWorker } from "./env";
// Checkpointer sobre D1 y su hilo.
import { D1CheckpointSaver, checkpointThread } from "./research-checkpointer";
// Tablas de la investigación.
import { ensureResearchSchema } from "./research-db";
// Diario de operaciones.
import { journalPorts } from "./research-journal";
// Contextualización con la memoria.
import { contextualize } from "./research-memory";
// Versión y tipo de las tarifas.
import { RESEARCH_PRICE_VERSION, type PriceSnapshot } from "./research-money";
// Paso del trabajo.
import { runResearchTick } from "./research-runner";
// D1 simulada con SQLite.
import { openResearchSqlite } from "./research-sqlite";
// Operaciones del almacén.
import {
  // Admitir, operaciones, cancelación y reclamación de trabajos.
  admitJob,
  beginOperation,
  cancelJob,
  claimJob,
  completeOperation,
  // Conversaciones, cierre y lectura de trabajos.
  createConversation,
  finishJob,
  getJob,
  // Retención de llamadas enviadas y listados.
  holdDispatched,
  listMessages,
  listOperations,
  // Marcar enviada, memoria, recuperación, limpieza, cuenta y reanudación.
  markDispatched,
  memoryTurns,
  promoteDispatched,
  purgeCheckpoints,
  readAccount,
  resumeRecoverable,
  type JobRow,
} from "./research-store";
// Resultado guardado y presentado.
import { buildStoredResult, presentResearchResult } from "./research-result";
// Puertos de prueba.
import { createFixtureResearchPorts } from "./research-fixture";
// Versión del corpus de ejemplo.
import { fixtureCorpusVersion } from "./fixture";

// Tarifas de prueba con una reserva configurable.
function prices(hold = 100): PriceSnapshot {
  // Instantánea v3.
  return {
    // Versión actual de la instantánea y buscador.
    version: RESEARCH_PRICE_VERSION,
    searchProvider: "firecrawl",
    // Presupuesto de 1 USD y tope por trabajo de 0,25 USD, en micro-USD.
    budgetMicros: 1_000_000,
    jobLimitMicros: 250_000,
    // Precio de cada tipo de llamada y reserva inicial configurable.
    modelCallMicros: 10,
    searchMicros: 10,
    readMicros: 10,
    courseMicros: 10,
    holdMicros: hold,
    // Precios de visión, transcripción por minuto, voz por carácter y tope de la voz.
    visionCallMicros: 10,
    sttMicrosPerMinute: 510,
    ttsMicrosPerChar: 30,
    speechCapMicros: 18_000,
  };
}

// Base preparada con un presupuesto.
async function ready(budget = 1_000_000) {
  // SQLite en memoria.
  const database = await openResearchSqlite();
  // Tablas y cuenta.
  await ensureResearchSchema(database, budget);
  // Base.
  return database;
}

// Crea una conversación.
async function conversation(
  database: Awaited<ReturnType<typeof ready>>,
  owner: string,
  audience: "program" | "L/X" | "M/J",
) {
  // Con fecha fija.
  return createConversation(database, owner, audience, 1_000);
}

// Admite un trabajo con valores por defecto.
async function submit(
  database: Awaited<ReturnType<typeof ready>>,
  input: {
    // Propietario.
    ownerId: string;
    // Conversación.
    conversationId: string;
    // Clave de idempotencia.
    key: string;
    // Pregunta.
    question: string;
    // Huella.
    fingerprint?: string;
    // Reserva.
    hold?: number;
    // Escenario.
    scenarioId?: JobRow["scenario_id"];
    // Momento.
    now?: number;
  },
) {
  // Momento o 5.000.
  const now = input.now ?? 5_000;
  // Admite.
  return admitJob(database, {
    // Dueño, conversación, clave y huella (derivada de la pregunta si no se da).
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    idempotencyKey: input.key,
    fingerprint: input.fingerprint ?? `fp:${input.question}`,
    // Pregunta, sin memoria y guion suficiente por defecto.
    originalQuestion: input.question,
    contextualized: null,
    scenarioId: input.scenarioId ?? "sufficient-first-round",
    corpusVersion: fixtureCorpusVersion(),
    // Tarifas con la reserva pedida, fecha y plazos.
    prices: prices(input.hold ?? 100),
    now,
    deadlineMs: RESEARCH_LIMITS.deadlineMs,
    queueMs: 60_000,
  });
}

// Grupo: investigación durable.
describe("investigación durable", () => {
  // La conversación persiste en la base.
  it("conserva la conversación entre lecturas de la misma base", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "M/J");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "Dimension mismatch expected 1024",
    });
    // Admitido.
    expect(admitted.ok).toBe(true);
    // Mensajes.
    const messages = await listMessages(database, "owner-a", created.id);
    // La pregunta guardada.
    expect(messages.map((message) => message.text)).toEqual(["Dimension mismatch expected 1024"]);
    // Otro propietario no ve nada.
    expect(await listMessages(database, "owner-b", created.id)).toEqual([]);
    // Cierra.
    database.close();
  });

  // La memoria es de cada conversación.
  it("el seguimiento usa solo la memoria de su conversación", async () => {
    // Base.
    const database = await ready();
    // Primera conversación.
    const first = await conversation(database, "owner-a", "M/J");
    // Segunda.
    const second = await conversation(database, "owner-a", "M/J");
    // Trabajo en la primera.
    await submit(database, {
      ownerId: "owner-a",
      conversationId: first.id,
      key: "idem-0001",
      question: "el índice esperaba 1024",
    });
    // Seguimiento en la primera.
    const own = contextualize(await memoryTurns(database, "owner-a", first.id), "¿y ese índice?");
    // Seguimiento en la segunda.
    const other = contextualize(
      await memoryTurns(database, "owner-a", second.id),
      "¿y ese índice?",
    );
    // Usa la memoria propia.
    expect(own.contextualized).toContain("el índice esperaba 1024");
    // Conserva la original.
    expect(own.original).toBe("¿y ese índice?");
    // La otra no tiene memoria.
    expect(other.contextualized).toBeNull();
  });

  // Otro propietario no lee ni cancela.
  it("un propietario no lee el trabajo de otro", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "L/X");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "calendario lunes",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Otro propietario: null.
    expect(await getJob(database, "owner-b", admitted.job.id)).toBeNull();
    // No puede cancelar.
    expect(await cancelJob(database, "owner-b", admitted.job.id, 9_000)).toBeNull();
    // Sigue en cola.
    expect((await getJob(database, "owner-a", admitted.job.id))?.execution_status).toBe("queued");
  });

  // El grupo queda fijo.
  it("el grupo queda fijo en la conversación", async () => {
    // Base.
    const database = await ready();
    // L/X.
    const lx = await conversation(database, "owner-a", "L/X");
    // M/J.
    const mj = await conversation(database, "owner-a", "M/J");
    // Trabajo en L/X.
    await submit(database, {
      ownerId: "owner-a",
      conversationId: lx.id,
      key: "idem-0001",
      question: "clase del lunes",
    });
    // Memoria de L/X.
    const lxMemory = await memoryTurns(database, "owner-a", lx.id);
    // Memoria de M/J.
    const mjMemory = await memoryTurns(database, "owner-a", mj.id);
    // L/X recuerda.
    expect(lxMemory.map((turn) => turn.text).join(" ")).toContain("lunes");
    // M/J vacía.
    expect(mjMemory).toEqual([]);
    // Grupo L/X.
    expect(lx.audience).toBe("L/X");
    // Grupo M/J.
    expect(mj.audience).toBe("M/J");
  });

  // Misma clave: una reserva; otra pregunta: conflicto.
  it("la misma clave reserva una sola vez y otra pregunta no reutiliza la clave", async () => {
    // Presupuesto de 100.
    const database = await ready(100);
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Primer envío.
    const first = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
      hold: 100,
    });
    // Reintento.
    const retry = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
      hold: 100,
    });
    // Misma clave, otra pregunta.
    const clash = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "otra",
      fingerprint: "fp:otra",
      hold: 100,
    });
    // Id del primero.
    const firstId = first.ok ? first.job.id : "";
    // Id del reintento.
    const retryId = retry.ok ? retry.job.id : "";
    // ¿Se creó otro?
    const retryCreated = retry.ok ? retry.created : true;
    // Hay trabajo.
    expect(firstId).not.toBe("");
    // No se creó otro.
    expect(retryCreated).toBe(false);
    // Mismo trabajo.
    expect(retryId).toBe(firstId);
    // Conflicto.
    expect(clash).toEqual({ ok: false, reason: "fingerprint" });
    // Una sola reserva.
    expect((await readAccount(database))?.reserved_micros).toBe(100);
  });

  // Dos trabajos simultáneos no superan el presupuesto.
  it("dos trabajos simultáneos no rebasan el presupuesto", async () => {
    // Presupuesto de 100.
    const database = await ready(100);
    // Conversación 1.
    const left = await conversation(database, "owner-a", "program");
    // Conversación 2.
    const right = await conversation(database, "owner-a", "M/J");
    // Dos envíos a la vez.
    const [one, two] = await Promise.all([
      // Dos envíos simultáneos del mismo dueño en conversaciones distintas.
      submit(database, {
        ownerId: "owner-a",
        conversationId: left.id,
        key: "idem-0001",
        question: "una",
        hold: 100,
      }),
      // El segundo, en la otra conversación.
      submit(database, {
        ownerId: "owner-a",
        conversationId: right.id,
        key: "idem-0002",
        question: "dos",
        hold: 100,
      }),
    ]);
    // Admitidos.
    const ok = [one, two].filter((result) => result.ok);
    // Solo uno.
    expect(ok).toHaveLength(1);
    // El otro sin presupuesto.
    expect([one, two].some((result) => !result.ok && result.reason === "budget")).toBe(true);
    // Reserva de 100.
    expect((await readAccount(database))?.reserved_micros).toBe(100);
  });

  // Solo un ejecutor obtiene el arrendamiento.
  it("solo un ejecutor obtiene el arrendamiento", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Ejecutor A.
    const first = await claimJob(database, "owner-a", admitted.job.id, "executor-a", 6_000, 60_000);
    // Ejecutor B poco después.
    const second = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-b",
      6_100,
      60_000,
    );
    // A lo tiene.
    expect(first?.executor_id).toBe("executor-a");
    // B no.
    expect(second).toBeNull();
  });

  // Reutiliza lo completado y no reenvía lo desconocido.
  it("repite el resultado guardado y no reenvía una operación desconocida", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Reclama.
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    // Sin arrendamiento.
    if (!claimed) {
      // Error.
      throw new Error("sin arrendamiento");
    }
    // Operación del plan.
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Enviada.
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    // Completada.
    expect(
      // Cierra la operación con su resultado JSON y sin coste (kind: none).
      await completeOperation(database, {
        operationId: operation.id,
        fence: operation.fence,
        resultJson: JSON.stringify({
          ok: true,
          value: { route: "course" },
          consumption: { kind: "none" },
        }),
        // Consumo y reserva de la operación.
        consumption: { kind: "none" },
        reservation: 10,
      }),
    ).toBe(true);
    // Repite.
    const replay = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Misma operación.
    expect(replay.id).toBe(operation.id);
    // Completada.
    expect(replay.state).toBe("completed");
    // Búsqueda.
    const ambiguous = await beginOperation(database, {
      jobId: claimed.id,
      kind: "search",
      fingerprint: "search-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Enviada.
    expect(await markDispatched(database, ambiguous.id, ambiguous.fence)).toBe(true);
    // Pasa a desconocida.
    expect(await promoteDispatched(database, "owner-a", claimed.id)).toBe(1);
    // Repetir pide atención.
    await expect(
      beginOperation(database, {
        jobId: claimed.id,
        kind: "search",
        fingerprint: "search-1",
        reservation: 10,
        fence: claimed.lease_token,
      }),
    ).rejects.toThrow("research-attention");
    // Cuenta.
    const account = await readAccount(database);
    // 10 desconocidos.
    expect(account?.unknown_micros).toBe(10);
    // Nada consumido.
    expect(account?.consumed_micros).toBe(0);
  });

  // Cancelar conserva lo desconocido; un cierre tardío no lo cambia.
  it("cancelar conserva el cargo desconocido y un cierre tardío no lo pisa", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Reclama.
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    // Sin arrendamiento.
    if (!claimed) {
      // Error.
      throw new Error("sin arrendamiento");
    }
    // Búsqueda.
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "search",
      fingerprint: "search-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Enviada.
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    // Cancela.
    const cancelled = await cancelJob(database, "owner-a", claimed.id, 7_000);
    // Cancelado.
    expect(cancelled?.execution_status).toBe("cancelled");
    // 10 desconocidos.
    expect(cancelled?.unknown_micros).toBe(10);
    // En la cuenta.
    expect((await readAccount(database))?.unknown_micros).toBe(10);
    // Sin reservas.
    expect((await readAccount(database))?.reserved_micros).toBe(0);
    // Cierre tardío.
    const late = await finishJob(database, {
      ownerId: "owner-a",
      jobId: claimed.id,
      leaseToken: claimed.lease_token,
      now: 8_000,
      execution: "complete",
      outcome: "complete",
      resultJson: "{}",
    });
    // No cierra.
    expect(late).toBe(false);
    // No se puede volver a enviar.
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(false);
    // Ni completar.
    expect(
      await completeOperation(database, {
        operationId: operation.id,
        fence: operation.fence,
        resultJson: "{}",
        consumption: { kind: "none" },
        reservation: 10,
      }),
    ).toBe(false);
    // Sigue cancelado.
    expect((await getJob(database, "owner-a", claimed.id))?.execution_status).toBe("cancelled");
    // Sin resultado complete.
    expect((await getJob(database, "owner-a", claimed.id))?.report_outcome).not.toBe("complete");
  });

  // Créditos sin USD: total incompleto y la retención no lo borra.
  it("los créditos sin USD no completan el total y la retención no lo borra", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Reclama.
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    // Sin arrendamiento.
    if (!claimed) {
      // Error.
      throw new Error("sin arrendamiento");
    }
    // Plan.
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-credits",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Enviada.
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    // Completada con créditos sin USD.
    await completeOperation(database, {
      operationId: operation.id,
      fence: operation.fence,
      resultJson: "{}",
      consumption: { kind: "reported", usd: null, credits: 4 },
      reservation: 10,
    });
    // Cuenta antes.
    const before = await readAccount(database);
    // Nada consumido.
    expect(before?.consumed_micros).toBe(0);
    // 10 retenidos.
    expect(before?.unknown_micros).toBe(10);
    // Cierra el trabajo.
    await finishJob(database, {
      ownerId: "owner-a",
      jobId: claimed.id,
      leaseToken: claimed.lease_token,
      now: 7_000,
      execution: "complete",
      outcome: "partial",
      resultJson: null,
    });
    // Lo hace antiguo.
    await database
      .prepare(`UPDATE research_jobs SET finished_at = ? WHERE id = ?`)
      .bind(1, claimed.id)
      .run();
    // Retención.
    const removed = await purgeCheckpoints(database, 10_000);
    // No borra: hay cargo desconocido.
    expect(removed).toBe(0);
    // Cuenta después.
    const after = await readAccount(database);
    // Igual.
    expect(after?.unknown_micros).toBe(before?.unknown_micros);
    // Nada consumido.
    expect(after?.consumed_micros).toBe(0);
    // Retener otra vez no hace nada.
    const released = await holdDispatched(database, operation.id, operation.fence);
    // false.
    expect(released).toBe(false);
  });

  // El plazo no cambia al reclamar.
  it("el plazo original no se mueve al reclamar", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Plazo inicial.
    const before = admitted.job.deadline_at;
    // Reclama.
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      1_000,
    );
    // Mismo plazo.
    expect(claimed?.deadline_at).toBe(before);
    // Creación más el plazo.
    expect(claimed?.deadline_at).toBe(5_000 + RESEARCH_LIMITS.deadlineMs);
    // Creación.
    expect(claimed?.created_at).toBe(5_000);
  });

  // Fallo al crear los puertos: atención.
  it("un fallo al crear los puertos no deja el trabajo en ejecución", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-ports",
      question: "pregunta",
      now: Date.now(),
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Paso con puertos que fallan.
    const tick = await runResearchTick(database, admitted.job.id, "owner-a", () => {
      // Error.
      throw new Error("ports");
    });
    // Atención.
    expect(tick.status).toBe("attention");
    // En la base.
    expect((await getJob(database, "owner-a", admitted.job.id))?.execution_status).toBe(
      "attention",
    );
  });

  // Una reserva de otro arrendamiento no se reutiliza.
  it("una reserva con otro arrendamiento no se reutiliza", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-fence",
      question: "pregunta",
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Reclama.
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    // Sin arrendamiento.
    if (!claimed) {
      // Error.
      throw new Error("sin arrendamiento");
    }
    // Reserva.
    await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-fence",
      reservation: 10,
      fence: claimed.lease_token,
    });
    // Otra ficha: atención.
    await expect(
      beginOperation(database, {
        jobId: claimed.id,
        kind: "plan",
        fingerprint: "plan-fence",
        reservation: 10,
        fence: claimed.lease_token + 1,
      }),
    ).rejects.toThrow("research-attention");
  });

  // Real sin capacidad durable: bloqueada.
  it("la investigación real sigue bloqueada sin la capacidad durable", () => {
    // Entorno real sin D1 ni Workflow.
    const blocked = assessWorker({
      // Modo real con generación, investigación y precios, pero sin D1 ni Workflow.
      APP_MODE: "real",
      ANTHROPIC_API_KEY: "local-test-key",
      MODEL_ID: "example/generator",
      RESEARCH_MODEL_ID: "example/research",
      // Clave del buscador, autorización de gasto y presupuesto.
      FIRECRAWL_API_KEY: "local-firecrawl",
      RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
      RESEARCH_BUDGET_USD: "1",
      RESEARCH_JOB_LIMIT_USD: "0.25",
      // Tarifas y precio del crédito.
      RESEARCH_INPUT_USD_PER_MILLION: "0.2",
      RESEARCH_OUTPUT_USD_PER_MILLION: "1",
      FIRECRAWL_USD_PER_CREDIT: "0.01",
    });
    // Bloqueada.
    expect(blocked.capabilities.research.status).toBe("blocked");
    // Faltan D1 y Workflow.
    expect(blocked.capabilities.research.missing).toEqual(
      expect.arrayContaining(["RESEARCH_DB", "RESEARCH_WORKFLOW"]),
    );
    // No pide contabilidad aparte.
    expect(blocked.capabilities.research.missing).not.toContain("RESEARCH_DURABLE_ACCOUNTING");
    // Entorno con Turnstile.
    const turnstileEnv = {
      // Mismo entorno con origen público y secreto de Turnstile.
      APP_MODE: "real",
      PUBLIC_ORIGIN: "https://example.test",
      TURNSTILE_SECRET_KEY: "local-turnstile-secret-value",
      ANTHROPIC_API_KEY: "local-test-key",
      // Generación, investigación y buscador.
      MODEL_ID: "example/generator",
      RESEARCH_MODEL_ID: "example/research",
      FIRECRAWL_API_KEY: "local-firecrawl",
      // Autorización, presupuesto y tarifas.
      RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
      RESEARCH_BUDGET_USD: "1",
      RESEARCH_JOB_LIMIT_USD: "0.25",
      RESEARCH_INPUT_USD_PER_MILLION: "0.2",
      RESEARCH_OUTPUT_USD_PER_MILLION: "1",
      FIRECRAWL_USD_PER_CREDIT: "0.01",
    };
    // Pide el secreto de propietario.
    expect(assessWorker(turnstileEnv).capabilities.research.missing).toContain(
      "RESEARCH_OWNER_SECRET",
    );
    // Con presupuesto público no lo pide.
    expect(
      assessWorker({ ...turnstileEnv, PUBLIC_BUDGET_USD: "1" }).capabilities.research.missing,
    ).not.toContain("RESEARCH_OWNER_SECRET");
  });

  // Checkpointer: escrituras pendientes y reanudación.
  it("el checkpointer guarda escrituras pendientes y reanuda el mismo hilo", async () => {
    // Base.
    const database = await ready();
    // Tablas.
    await ensureResearchSchema(database, 1_000_000);
    // Checkpointer.
    const saver = new D1CheckpointSaver(database);
    // Ejecuciones del primer nodo.
    let runs = 0;
    // Estado con un número.
    const state = Annotation.Root({
      value: Annotation<number>({
        // Doble de prueba: combina la actualización del estado con su valor anterior según esta regla de LangGraph.
        reducer: (_left, right) => right,
        // Doble de prueba: crea el valor inicial independiente del canal de estado de LangGraph.
        default: () => 0,
      }),
    });
    // Grafo de dos nodos con pausa antes del segundo.
    const graph = new StateGraph(state)
      .addNode("first", () => {
        // Cuenta.
        runs += 1;
        // Valor 1.
        return { value: 1 };
      })
      .addNode("second", () => ({ value: 2 }))
      .addEdge(START, "first")
      .addEdge("first", "second")
      .addEdge("second", END)
      .compile({ checkpointer: saver, interruptBefore: ["second"] });
    // Hilo.
    const threadId = checkpointThread("job-1");
    // Configuración.
    const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
    // Ejecuta hasta la pausa.
    const paused = await graph.invoke({ value: 0 }, config);
    // Valor 1.
    expect(paused.value).toBe(1);
    // Una ejecución.
    expect(runs).toBe(1);
    // Checkpoint.
    const pausedTuple = await saver.getTuple(config);
    // Sin checkpoint.
    if (pausedTuple === undefined) {
      // Error.
      throw new Error("sin checkpoint");
    }
    // Escritura pendiente.
    await saver.putWrites(pausedTuple.config, [["value", 7]], "task-1");
    // Relee.
    const stored = await saver.getTuple(pausedTuple.config);
    // Contiene la escritura.
    expect(stored?.pendingWrites?.some((write) => write[1] === "value" && write[2] === 7)).toBe(
      true,
    );
    // Otro grafo con otro checkpointer reanuda el mismo hilo.
    const resumed = await new StateGraph(state)
      .addNode("first", () => {
        // Cuenta.
        runs += 1;
        // Valor 1.
        return { value: 1 };
      })
      .addNode("second", () => ({ value: 2 }))
      .addEdge(START, "first")
      .addEdge("first", "second")
      .addEdge("second", END)
      .compile({ checkpointer: new D1CheckpointSaver(database) })
      .invoke(null, config);
    // Llega al segundo nodo.
    expect(resumed.value).toBe(2);
    // Sin repetir el primero.
    expect(runs).toBe(1);
  });

  // Una caída con checkpoint se recupera sin otro plan ni otro plazo.
  it("una interrupción con checkpoint se recupera sin otro plan ni otro plazo", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "M/J");
    // Trabajo con caída simulada.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-crash",
      question: "Dimension mismatch",
      scenarioId: "crash-after-plan",
      hold: 250_000,
      now: Date.now(),
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Planes.
    let plans = 0;
    // Puertos que cuentan los planes.
    const createPorts = (signal: AbortSignal, job: JobRow) => {
      // Puertos de prueba.
      const ports = createFixtureResearchPorts({
        signal,
        scenarioId: job.scenario_id,
        audience: job.audience,
        corpusVersion: job.corpus_version,
      });
      // Plan original.
      const plan = ports.model.plan.bind(ports.model);
      // Plan contado.
      ports.model.plan = (input, context) => {
        // Cuenta.
        plans += 1;
        // Delega.
        return plan(input, context);
      };
      // Puertos.
      return ports;
    };
    // Primer paso.
    const first = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    // Atención.
    expect(first.status).toBe("attention");
    // Un plan.
    expect(plans).toBe(1);
    // Trabajo.
    const paused = await getJob(database, "owner-a", admitted.job.id);
    // Recuperable.
    expect(paused?.attention_reason).toBe("recoverable");
    // Mismo plazo.
    expect(paused?.deadline_at).toBe(admitted.job.deadline_at);
    // Reanuda.
    const resumed = await resumeRecoverable(database, "owner-a", admitted.job.id);
    // Mismo plazo.
    expect(resumed?.deadline_at).toBe(admitted.job.deadline_at);
    // Misma ejecución.
    expect(resumed?.run_id).toBe(admitted.job.run_id);
    // Segundo paso.
    const second = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    // Completo.
    expect(second.status).toBe("complete");
    // Sin otro plan.
    expect(plans).toBe(1);
    // Operaciones.
    const operations = await listOperations(database, admitted.job.id);
    // Planes.
    const planOperations = operations.filter((operation) => operation.kind === "plan");
    // Uno.
    expect(planOperations).toHaveLength(1);
    // Completado.
    expect(planOperations[0]?.state).toBe("completed");
    // Sin desconocidas.
    expect(operations.some((operation) => operation.state === "unknown")).toBe(false);
    // Trabajo.
    const finished = await getJob(database, "owner-a", admitted.job.id);
    // Mismo plazo.
    expect(finished?.deadline_at).toBe(admitted.job.deadline_at);
    // Resultado.
    const presented = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      finished?.result_json ?? "",
    );
    // Guardado.
    expect(presented?.reportAvailability).toBe("stored");
    // Informe.
    expect(presented?.report?.text).toContain("Informe de prueba");
    // Completo.
    expect(presented?.summary.outcome).toBe("complete");
  });

  // Informe largo en artefacto; registro antiguo sin informe.
  it("un informe largo queda en un artefacto y un registro antiguo no se reconstruye", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-artifact",
      question: "pregunta",
      hold: 250_000,
      now: Date.now(),
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Paso.
    const tick = await runResearchTick(database, admitted.job.id, "owner-a");
    // Completo.
    expect(tick.status).toBe("complete");
    // Trabajo.
    const finished = await getJob(database, "owner-a", admitted.job.id);
    // Resultado.
    const presented = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      finished?.result_json ?? "",
    );
    // Sin informe.
    if (!presented?.report) {
      // Error.
      throw new Error("sin informe");
    }
    // Informe de más de 24.000 caracteres.
    const reportText = `Informe largo ${"x".repeat(24_100)}`;
    // Resultado guardado.
    const stored = await buildStoredResult(database, {
      ownerId: "owner-a",
      jobId: admitted.job.id,
      summary: presented.summary,
      sources: presented.sources,
      reportText,
      now: Date.now(),
    });
    // Como artefacto.
    expect(stored?.report?.kind).toBe("artifact");
    // Se presenta.
    const restored = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      JSON.stringify(stored),
    );
    // Texto completo.
    expect(restored?.report?.text).toBe(reportText);
    // Registro antiguo sin informe.
    const legacy = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      JSON.stringify({ summary: presented.summary, sources: presented.sources }),
    );
    // legacy-missing.
    expect(legacy?.reportAvailability).toBe("legacy-missing");
    // Sin informe.
    expect(legacy?.report).toBeNull();
  });

  // Una operación ambigua no se repite al reanudar.
  it("una operación ambigua no se repite al reanudar el grafo", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "M/J");
    // Trabajo con operación ambigua.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "Dimension mismatch",
      scenarioId: "ambiguous-operation",
      now: Date.now(),
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Planes.
    let plans = 0;
    // Puertos que cuentan los planes.
    const createPorts = (signal: AbortSignal, job: JobRow) => {
      // Puertos de prueba.
      const ports = createFixtureResearchPorts({
        signal,
        scenarioId: job.scenario_id,
        audience: job.audience,
        corpusVersion: job.corpus_version,
      });
      // Plan original.
      const plan = ports.model.plan.bind(ports.model);
      // Plan contado.
      ports.model.plan = (input, context) => {
        // Cuenta.
        plans += 1;
        // Delega.
        return plan(input, context);
      };
      // Puertos.
      return ports;
    };
    // Primer paso.
    const first = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    // Atención.
    expect(first.status).toBe("attention");
    // Un plan.
    expect(plans).toBe(1);
    // Segundo paso.
    const second = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    // Sigue en atención.
    expect(second.status).toBe("attention");
    // Sin otro plan.
    expect(plans).toBe(1);
    // Cargo desconocido.
    expect((await readAccount(database))?.unknown_micros).toBeGreaterThan(0);
  });

  // El diario no repite una llamada completada.
  it("envuelve el puerto para no repetir una llamada completada", async () => {
    // Base.
    const database = await ready();
    // Conversación.
    const created = await conversation(database, "owner-a", "program");
    // Momento.
    const now = Date.now();
    // Trabajo.
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
      now,
    });
    // Si falla.
    if (!admitted.ok) {
      // Error.
      throw new Error(admitted.reason);
    }
    // Reclama.
    const claimed = await claimJob(database, "owner-a", admitted.job.id, "executor-a", now, 60_000);
    // Sin arrendamiento.
    if (!claimed) {
      // Error.
      throw new Error("sin arrendamiento");
    }
    // Llamadas.
    let calls = 0;
    // Puertos de prueba.
    const inner = createFixtureResearchPorts({
      signal: new AbortController().signal,
      scenarioId: "sufficient-first-round",
      audience: "program",
      corpusVersion: fixtureCorpusVersion(),
    });
    // Plan original.
    const plan = inner.model.plan.bind(inner.model);
    // Plan contado.
    inner.model.plan = (input, context) => {
      // Cuenta.
      calls += 1;
      // Delega.
      return plan(input, context);
    };
    // Puertos con diario.
    const ports = journalPorts(database, claimed, prices(), inner, null);
    // Contexto.
    const context = { signal: inner.signal, timeoutMs: 1_000 };
    // Primer plan.
    await ports.model.plan({ question: "pregunta", audience: "program" }, context);
    // Mismo plan.
    await ports.model.plan({ question: "pregunta", audience: "program" }, context);
    // Una llamada.
    expect(calls).toBe(1);
  });
});
