import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { RESEARCH_LIMITS } from "@thepower-rag/contracts";
import { describe, expect, it } from "vite-plus/test";
import { assessWorker } from "./env";
import { D1CheckpointSaver, checkpointThread } from "./research-checkpointer";
import { ensureResearchSchema } from "./research-db";
import { journalPorts } from "./research-journal";
import { contextualize } from "./research-memory";
import { RESEARCH_PRICE_VERSION, type PriceSnapshot } from "./research-money";
import { runResearchTick } from "./research-runner";
import { openResearchSqlite } from "./research-sqlite";
import {
  admitJob,
  beginOperation,
  cancelJob,
  claimJob,
  completeOperation,
  createConversation,
  finishJob,
  getJob,
  holdDispatched,
  listMessages,
  listOperations,
  markDispatched,
  memoryTurns,
  promoteDispatched,
  purgeCheckpoints,
  readAccount,
  resumeRecoverable,
  type JobRow,
} from "./research-store";
import { buildStoredResult, presentResearchResult } from "./research-result";
import { createFixtureResearchPorts } from "./research-fixture";
import { fixtureCorpusVersion } from "./fixture";

function prices(hold = 100): PriceSnapshot {
  return {
    version: RESEARCH_PRICE_VERSION,
    searchProvider: "firecrawl",
    budgetMicros: 1_000_000,
    jobLimitMicros: 250_000,
    modelCallMicros: 10,
    searchMicros: 10,
    readMicros: 10,
    courseMicros: 10,
    holdMicros: hold,
    visionCallMicros: 10,
    sttMicrosPerMinute: 510,
    ttsMicrosPerChar: 30,
    speechCapMicros: 18_000,
  };
}

async function ready(budget = 1_000_000) {
  const database = await openResearchSqlite();
  await ensureResearchSchema(database, budget);
  return database;
}

async function conversation(
  database: Awaited<ReturnType<typeof ready>>,
  owner: string,
  audience: "program" | "L/X" | "M/J",
) {
  return createConversation(database, owner, audience, 1_000);
}

async function submit(
  database: Awaited<ReturnType<typeof ready>>,
  input: {
    ownerId: string;
    conversationId: string;
    key: string;
    question: string;
    fingerprint?: string;
    hold?: number;
    scenarioId?: JobRow["scenario_id"];
    now?: number;
  },
) {
  const now = input.now ?? 5_000;
  return admitJob(database, {
    ownerId: input.ownerId,
    conversationId: input.conversationId,
    idempotencyKey: input.key,
    fingerprint: input.fingerprint ?? `fp:${input.question}`,
    originalQuestion: input.question,
    contextualized: null,
    scenarioId: input.scenarioId ?? "sufficient-first-round",
    corpusVersion: fixtureCorpusVersion(),
    prices: prices(input.hold ?? 100),
    now,
    deadlineMs: RESEARCH_LIMITS.deadlineMs,
    queueMs: 60_000,
  });
}

describe("investigación durable", () => {
  it("conserva la conversación entre lecturas de la misma base", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "M/J");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "Dimension mismatch expected 1024",
    });
    expect(admitted.ok).toBe(true);
    const messages = await listMessages(database, "owner-a", created.id);
    expect(messages.map((message) => message.text)).toEqual(["Dimension mismatch expected 1024"]);
    expect(await listMessages(database, "owner-b", created.id)).toEqual([]);
    database.close();
  });

  it("el seguimiento usa solo la memoria de su conversación", async () => {
    const database = await ready();
    const first = await conversation(database, "owner-a", "M/J");
    const second = await conversation(database, "owner-a", "M/J");
    await submit(database, {
      ownerId: "owner-a",
      conversationId: first.id,
      key: "idem-0001",
      question: "el índice esperaba 1024",
    });
    const own = contextualize(await memoryTurns(database, "owner-a", first.id), "¿y ese índice?");
    const other = contextualize(
      await memoryTurns(database, "owner-a", second.id),
      "¿y ese índice?",
    );
    expect(own.contextualized).toContain("el índice esperaba 1024");
    expect(own.original).toBe("¿y ese índice?");
    expect(other.contextualized).toBeNull();
  });

  it("un propietario no lee el trabajo de otro", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "L/X");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "calendario lunes",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    expect(await getJob(database, "owner-b", admitted.job.id)).toBeNull();
    expect(await cancelJob(database, "owner-b", admitted.job.id, 9_000)).toBeNull();
    expect((await getJob(database, "owner-a", admitted.job.id))?.execution_status).toBe("queued");
  });

  it("el grupo queda fijo en la conversación", async () => {
    const database = await ready();
    const lx = await conversation(database, "owner-a", "L/X");
    const mj = await conversation(database, "owner-a", "M/J");
    await submit(database, {
      ownerId: "owner-a",
      conversationId: lx.id,
      key: "idem-0001",
      question: "clase del lunes",
    });
    const lxMemory = await memoryTurns(database, "owner-a", lx.id);
    const mjMemory = await memoryTurns(database, "owner-a", mj.id);
    expect(lxMemory.map((turn) => turn.text).join(" ")).toContain("lunes");
    expect(mjMemory).toEqual([]);
    expect(lx.audience).toBe("L/X");
    expect(mj.audience).toBe("M/J");
  });

  it("la misma clave reserva una sola vez y otra pregunta no reutiliza la clave", async () => {
    const database = await ready(100);
    const created = await conversation(database, "owner-a", "program");
    const first = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
      hold: 100,
    });
    const retry = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
      hold: 100,
    });
    const clash = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "otra",
      fingerprint: "fp:otra",
      hold: 100,
    });
    const firstId = first.ok ? first.job.id : "";
    const retryId = retry.ok ? retry.job.id : "";
    const retryCreated = retry.ok ? retry.created : true;
    expect(firstId).not.toBe("");
    expect(retryCreated).toBe(false);
    expect(retryId).toBe(firstId);
    expect(clash).toEqual({ ok: false, reason: "fingerprint" });
    expect((await readAccount(database))?.reserved_micros).toBe(100);
  });

  it("dos trabajos simultáneos no rebasan el presupuesto", async () => {
    const database = await ready(100);
    const left = await conversation(database, "owner-a", "program");
    const right = await conversation(database, "owner-a", "M/J");
    const [one, two] = await Promise.all([
      submit(database, {
        ownerId: "owner-a",
        conversationId: left.id,
        key: "idem-0001",
        question: "una",
        hold: 100,
      }),
      submit(database, {
        ownerId: "owner-a",
        conversationId: right.id,
        key: "idem-0002",
        question: "dos",
        hold: 100,
      }),
    ]);
    const ok = [one, two].filter((result) => result.ok);
    expect(ok).toHaveLength(1);
    expect([one, two].some((result) => !result.ok && result.reason === "budget")).toBe(true);
    expect((await readAccount(database))?.reserved_micros).toBe(100);
  });

  it("solo un ejecutor obtiene el arrendamiento", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const first = await claimJob(database, "owner-a", admitted.job.id, "executor-a", 6_000, 60_000);
    const second = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-b",
      6_100,
      60_000,
    );
    expect(first?.executor_id).toBe("executor-a");
    expect(second).toBeNull();
  });

  it("repite el resultado guardado y no reenvía una operación desconocida", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    if (!claimed) {
      throw new Error("sin arrendamiento");
    }
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    expect(
      await completeOperation(database, {
        operationId: operation.id,
        fence: operation.fence,
        resultJson: JSON.stringify({
          ok: true,
          value: { route: "course" },
          consumption: { kind: "none" },
        }),
        consumption: { kind: "none" },
        reservation: 10,
      }),
    ).toBe(true);
    const replay = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    expect(replay.id).toBe(operation.id);
    expect(replay.state).toBe("completed");
    const ambiguous = await beginOperation(database, {
      jobId: claimed.id,
      kind: "search",
      fingerprint: "search-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    expect(await markDispatched(database, ambiguous.id, ambiguous.fence)).toBe(true);
    expect(await promoteDispatched(database, "owner-a", claimed.id)).toBe(1);
    await expect(
      beginOperation(database, {
        jobId: claimed.id,
        kind: "search",
        fingerprint: "search-1",
        reservation: 10,
        fence: claimed.lease_token,
      }),
    ).rejects.toThrow("research-attention");
    const account = await readAccount(database);
    expect(account?.unknown_micros).toBe(10);
    expect(account?.consumed_micros).toBe(0);
  });

  it("cancelar conserva el cargo desconocido y un cierre tardío no lo pisa", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    if (!claimed) {
      throw new Error("sin arrendamiento");
    }
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "search",
      fingerprint: "search-1",
      reservation: 10,
      fence: claimed.lease_token,
    });
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    const cancelled = await cancelJob(database, "owner-a", claimed.id, 7_000);
    expect(cancelled?.execution_status).toBe("cancelled");
    expect(cancelled?.unknown_micros).toBe(10);
    expect((await readAccount(database))?.unknown_micros).toBe(10);
    expect((await readAccount(database))?.reserved_micros).toBe(0);
    const late = await finishJob(database, {
      ownerId: "owner-a",
      jobId: claimed.id,
      leaseToken: claimed.lease_token,
      now: 8_000,
      execution: "complete",
      outcome: "complete",
      resultJson: "{}",
    });
    expect(late).toBe(false);
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(false);
    expect(
      await completeOperation(database, {
        operationId: operation.id,
        fence: operation.fence,
        resultJson: "{}",
        consumption: { kind: "none" },
        reservation: 10,
      }),
    ).toBe(false);
    expect((await getJob(database, "owner-a", claimed.id))?.execution_status).toBe("cancelled");
    expect((await getJob(database, "owner-a", claimed.id))?.report_outcome).not.toBe("complete");
  });

  it("los créditos sin USD no completan el total y la retención no lo borra", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    if (!claimed) {
      throw new Error("sin arrendamiento");
    }
    const operation = await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-credits",
      reservation: 10,
      fence: claimed.lease_token,
    });
    expect(await markDispatched(database, operation.id, operation.fence)).toBe(true);
    await completeOperation(database, {
      operationId: operation.id,
      fence: operation.fence,
      resultJson: "{}",
      consumption: { kind: "reported", usd: null, credits: 4 },
      reservation: 10,
    });
    const before = await readAccount(database);
    expect(before?.consumed_micros).toBe(0);
    expect(before?.unknown_micros).toBe(10);
    await finishJob(database, {
      ownerId: "owner-a",
      jobId: claimed.id,
      leaseToken: claimed.lease_token,
      now: 7_000,
      execution: "complete",
      outcome: "partial",
      resultJson: null,
    });
    await database
      .prepare(`UPDATE research_jobs SET finished_at = ? WHERE id = ?`)
      .bind(1, claimed.id)
      .run();
    const removed = await purgeCheckpoints(database, 10_000);
    expect(removed).toBe(0);
    const after = await readAccount(database);
    expect(after?.unknown_micros).toBe(before?.unknown_micros);
    expect(after?.consumed_micros).toBe(0);
    const released = await holdDispatched(database, operation.id, operation.fence);
    expect(released).toBe(false);
  });

  it("el plazo original no se mueve al reclamar", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const before = admitted.job.deadline_at;
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      1_000,
    );
    expect(claimed?.deadline_at).toBe(before);
    expect(claimed?.deadline_at).toBe(5_000 + RESEARCH_LIMITS.deadlineMs);
    expect(claimed?.created_at).toBe(5_000);
  });

  it("un fallo al crear los puertos no deja el trabajo en ejecución", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-ports",
      question: "pregunta",
      now: Date.now(),
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const tick = await runResearchTick(database, admitted.job.id, "owner-a", () => {
      throw new Error("ports");
    });
    expect(tick.status).toBe("attention");
    expect((await getJob(database, "owner-a", admitted.job.id))?.execution_status).toBe(
      "attention",
    );
  });

  it("una reserva con otro arrendamiento no se reutiliza", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-fence",
      question: "pregunta",
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const claimed = await claimJob(
      database,
      "owner-a",
      admitted.job.id,
      "executor-a",
      6_000,
      60_000,
    );
    if (!claimed) {
      throw new Error("sin arrendamiento");
    }
    await beginOperation(database, {
      jobId: claimed.id,
      kind: "plan",
      fingerprint: "plan-fence",
      reservation: 10,
      fence: claimed.lease_token,
    });
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

  it("la investigación real sigue bloqueada sin la capacidad durable", () => {
    const blocked = assessWorker({
      APP_MODE: "real",
      ANTHROPIC_API_KEY: "local-test-key",
      MODEL_ID: "example/generator",
      RESEARCH_MODEL_ID: "example/research",
      FIRECRAWL_API_KEY: "local-firecrawl",
      RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
      RESEARCH_BUDGET_USD: "1",
      RESEARCH_JOB_LIMIT_USD: "0.25",
      RESEARCH_INPUT_USD_PER_MILLION: "0.2",
      RESEARCH_OUTPUT_USD_PER_MILLION: "1",
      FIRECRAWL_USD_PER_CREDIT: "0.01",
    });
    expect(blocked.capabilities.research.status).toBe("blocked");
    expect(blocked.capabilities.research.missing).toEqual(
      expect.arrayContaining(["RESEARCH_DB", "RESEARCH_WORKFLOW"]),
    );
    expect(blocked.capabilities.research.missing).not.toContain("RESEARCH_DURABLE_ACCOUNTING");
    const turnstileEnv = {
      APP_MODE: "real",
      PUBLIC_ORIGIN: "https://example.test",
      TURNSTILE_SECRET_KEY: "local-turnstile-secret-value",
      ANTHROPIC_API_KEY: "local-test-key",
      MODEL_ID: "example/generator",
      RESEARCH_MODEL_ID: "example/research",
      FIRECRAWL_API_KEY: "local-firecrawl",
      RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
      RESEARCH_BUDGET_USD: "1",
      RESEARCH_JOB_LIMIT_USD: "0.25",
      RESEARCH_INPUT_USD_PER_MILLION: "0.2",
      RESEARCH_OUTPUT_USD_PER_MILLION: "1",
      FIRECRAWL_USD_PER_CREDIT: "0.01",
    };
    expect(assessWorker(turnstileEnv).capabilities.research.missing).toContain(
      "RESEARCH_OWNER_SECRET",
    );
    expect(
      assessWorker({ ...turnstileEnv, PUBLIC_BUDGET_USD: "1" }).capabilities.research.missing,
    ).not.toContain("RESEARCH_OWNER_SECRET");
  });

  it("el checkpointer guarda escrituras pendientes y reanuda el mismo hilo", async () => {
    const database = await ready();
    await ensureResearchSchema(database, 1_000_000);
    const saver = new D1CheckpointSaver(database);
    let runs = 0;
    const state = Annotation.Root({
      value: Annotation<number>({ reducer: (_left, right) => right, default: () => 0 }),
    });
    const graph = new StateGraph(state)
      .addNode("first", () => {
        runs += 1;
        return { value: 1 };
      })
      .addNode("second", () => ({ value: 2 }))
      .addEdge(START, "first")
      .addEdge("first", "second")
      .addEdge("second", END)
      .compile({ checkpointer: saver, interruptBefore: ["second"] });
    const threadId = checkpointThread("job-1");
    const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
    const paused = await graph.invoke({ value: 0 }, config);
    expect(paused.value).toBe(1);
    expect(runs).toBe(1);
    const pausedTuple = await saver.getTuple(config);
    if (pausedTuple === undefined) {
      throw new Error("sin checkpoint");
    }
    await saver.putWrites(pausedTuple.config, [["value", 7]], "task-1");
    const stored = await saver.getTuple(pausedTuple.config);
    expect(stored?.pendingWrites?.some((write) => write[1] === "value" && write[2] === 7)).toBe(
      true,
    );
    const resumed = await new StateGraph(state)
      .addNode("first", () => {
        runs += 1;
        return { value: 1 };
      })
      .addNode("second", () => ({ value: 2 }))
      .addEdge(START, "first")
      .addEdge("first", "second")
      .addEdge("second", END)
      .compile({ checkpointer: new D1CheckpointSaver(database) })
      .invoke(null, config);
    expect(resumed.value).toBe(2);
    expect(runs).toBe(1);
  });

  it("una interrupción con checkpoint se recupera sin otro plan ni otro plazo", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "M/J");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-crash",
      question: "Dimension mismatch",
      scenarioId: "crash-after-plan",
      hold: 250_000,
      now: Date.now(),
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    let plans = 0;
    const createPorts = (signal: AbortSignal, job: JobRow) => {
      const ports = createFixtureResearchPorts({
        signal,
        scenarioId: job.scenario_id,
        audience: job.audience,
        corpusVersion: job.corpus_version,
      });
      const plan = ports.model.plan.bind(ports.model);
      ports.model.plan = (input, context) => {
        plans += 1;
        return plan(input, context);
      };
      return ports;
    };
    const first = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    expect(first.status).toBe("attention");
    expect(plans).toBe(1);
    const paused = await getJob(database, "owner-a", admitted.job.id);
    expect(paused?.attention_reason).toBe("recoverable");
    expect(paused?.deadline_at).toBe(admitted.job.deadline_at);
    const resumed = await resumeRecoverable(database, "owner-a", admitted.job.id);
    expect(resumed?.deadline_at).toBe(admitted.job.deadline_at);
    expect(resumed?.run_id).toBe(admitted.job.run_id);
    const second = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    expect(second.status).toBe("complete");
    expect(plans).toBe(1);
    const operations = await listOperations(database, admitted.job.id);
    const planOperations = operations.filter((operation) => operation.kind === "plan");
    expect(planOperations).toHaveLength(1);
    expect(planOperations[0]?.state).toBe("completed");
    expect(operations.some((operation) => operation.state === "unknown")).toBe(false);
    const finished = await getJob(database, "owner-a", admitted.job.id);
    expect(finished?.deadline_at).toBe(admitted.job.deadline_at);
    const presented = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      finished?.result_json ?? "",
    );
    expect(presented?.reportAvailability).toBe("stored");
    expect(presented?.report?.text).toContain("Informe de prueba");
    expect(presented?.summary.outcome).toBe("complete");
  });

  it("un informe largo queda en un artefacto y un registro antiguo no se reconstruye", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-artifact",
      question: "pregunta",
      hold: 250_000,
      now: Date.now(),
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const tick = await runResearchTick(database, admitted.job.id, "owner-a");
    expect(tick.status).toBe("complete");
    const finished = await getJob(database, "owner-a", admitted.job.id);
    const presented = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      finished?.result_json ?? "",
    );
    if (!presented?.report) {
      throw new Error("sin informe");
    }
    const reportText = `Informe largo ${"x".repeat(24_100)}`;
    const stored = await buildStoredResult(database, {
      ownerId: "owner-a",
      jobId: admitted.job.id,
      summary: presented.summary,
      sources: presented.sources,
      reportText,
      now: Date.now(),
    });
    expect(stored?.report?.kind).toBe("artifact");
    const restored = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      JSON.stringify(stored),
    );
    expect(restored?.report?.text).toBe(reportText);
    const legacy = await presentResearchResult(
      database,
      "owner-a",
      admitted.job.id,
      JSON.stringify({ summary: presented.summary, sources: presented.sources }),
    );
    expect(legacy?.reportAvailability).toBe("legacy-missing");
    expect(legacy?.report).toBeNull();
  });

  it("una operación ambigua no se repite al reanudar el grafo", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "M/J");
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "Dimension mismatch",
      scenarioId: "ambiguous-operation",
      now: Date.now(),
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    let plans = 0;
    const createPorts = (signal: AbortSignal, job: JobRow) => {
      const ports = createFixtureResearchPorts({
        signal,
        scenarioId: job.scenario_id,
        audience: job.audience,
        corpusVersion: job.corpus_version,
      });
      const plan = ports.model.plan.bind(ports.model);
      ports.model.plan = (input, context) => {
        plans += 1;
        return plan(input, context);
      };
      return ports;
    };
    const first = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    expect(first.status).toBe("attention");
    expect(plans).toBe(1);
    const second = await runResearchTick(database, admitted.job.id, "owner-a", createPorts);
    expect(second.status).toBe("attention");
    expect(plans).toBe(1);
    expect((await readAccount(database))?.unknown_micros).toBeGreaterThan(0);
  });

  it("envuelve el puerto para no repetir una llamada completada", async () => {
    const database = await ready();
    const created = await conversation(database, "owner-a", "program");
    const now = Date.now();
    const admitted = await submit(database, {
      ownerId: "owner-a",
      conversationId: created.id,
      key: "idem-0001",
      question: "pregunta",
      now,
    });
    if (!admitted.ok) {
      throw new Error(admitted.reason);
    }
    const claimed = await claimJob(database, "owner-a", admitted.job.id, "executor-a", now, 60_000);
    if (!claimed) {
      throw new Error("sin arrendamiento");
    }
    let calls = 0;
    const inner = createFixtureResearchPorts({
      signal: new AbortController().signal,
      scenarioId: "sufficient-first-round",
      audience: "program",
      corpusVersion: fixtureCorpusVersion(),
    });
    const plan = inner.model.plan.bind(inner.model);
    inner.model.plan = (input, context) => {
      calls += 1;
      return plan(input, context);
    };
    const ports = journalPorts(database, claimed, prices(), inner, null);
    const context = { signal: inner.signal, timeoutMs: 1_000 };
    await ports.model.plan({ question: "pregunta", audience: "program" }, context);
    await ports.model.plan({ question: "pregunta", audience: "program" }, context);
    expect(calls).toBe(1);
  });
});
