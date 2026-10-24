// GUÍA DE LECTURA · lab/aula/controller.ts
// Ordena eventos y pausas antes de cada operación. Avanzar identifica el paso pendiente;
// repetir un clic no puede autorizar por accidente el siguiente paso o duplicar una llamada.
import {
  aulaStages,
  type AulaEvent,
  type AulaJson,
  type AulaKind,
  type AulaMode,
  type AulaObserver,
  type AulaRun,
  type AulaStageId,
} from "@thepower-rag/contracts";

// Solo se persisten datos explícitos del pipeline; BigInt de PostgreSQL se conserva como texto.
export function aulaJson(value: unknown): AulaJson {
  return JSON.parse(
    JSON.stringify(value ?? null, (_key, item: unknown) =>
      typeof item === "bigint" ? String(item) : item,
    ),
  ) as AulaJson;
}

// Puerto sustituible en las pruebas; la aplicación usa PostgreSQL real.
export interface AulaJournal {
  create(run: AulaRun): Promise<void>;
  update(run: AulaRun): Promise<void>;
  append(event: AulaEvent): Promise<void>;
}

// Control de un único recorrido, con cancelación y un canal de observación que puede reconectarse.
export class AulaController implements AulaObserver {
  readonly signal: AbortSignal;
  readonly run: AulaRun;
  private readonly abort = new AbortController();
  private gate: {
    stage: AulaStageId;
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null = null;
  private queue = Promise.resolve();
  private readonly listeners = new Set<(event: AulaEvent, run: AulaRun) => void>();
  private started = 0;

  constructor(
    kind: AulaKind,
    mode: AulaMode,
    question: string,
    private readonly journal: AulaJournal,
  ) {
    const now = new Date().toISOString();
    this.signal = this.abort.signal;
    this.run = {
      id: crypto.randomUUID(),
      kind,
      mode,
      question,
      status: "running",
      createdAt: now,
      updatedAt: now,
      waitingStage: null,
      currentStage: null,
      stages: aulaStages(kind),
      events: [],
      result: null,
      error: null,
    };
  }

  // La copia impide que un consumidor modifique la ejecución mientras dibuja la interfaz.
  snapshot(): AulaRun {
    return structuredClone(this.run);
  }

  // Primero se confirma en PostgreSQL; después llega al navegador. La secuencia no depende de la red.
  async record(
    type: AulaEvent["type"],
    phase: AulaEvent["phase"],
    data: unknown,
    durationMs: number | null = null,
  ): Promise<void> {
    const stage = this.run.currentStage;
    const value = aulaJson(data);
    this.queue = this.queue.then(async () => {
      const event: AulaEvent = {
        runId: this.run.id,
        seq: this.run.events.length + 1,
        stage,
        type,
        phase,
        at: new Date().toISOString(),
        durationMs,
        data: value,
      };
      await this.journal.append(event);
      this.run.events.push(event);
      this.run.updatedAt = event.at;
      await this.journal.update(this.run);
      for (const listener of this.listeners) listener(event, this.run);
    });
    return this.queue;
  }

  // El tiempo de espera del profesor queda separado del tiempo de ejecución de la operación.
  async before(stage: AulaStageId, input: unknown): Promise<void> {
    this.signal.throwIfAborted();
    this.run.currentStage = stage;
    if (this.run.mode === "step") {
      this.run.status = "waiting";
      this.run.waitingStage = stage;
      const ready = new Promise<void>((resolve, reject) => {
        this.gate = { stage, resolve, reject };
      });
      // Adjunta ya el rechazo para que cancelar durante la persistencia no deje una promesa sin manejador.
      const waiting = ready.then(
        () => undefined,
        (error: unknown) => {
          throw error;
        },
      );
      void waiting.catch(() => {});
      await this.record("stage", "waiting", { input });
      await waiting;
    }
    this.signal.throwIfAborted();
    this.run.waitingStage = null;
    this.run.status = "running";
    this.started = performance.now();
    await this.record("stage", "running", { input });
  }

  // La salida es el valor devuelto por la operación real, no una reconstrucción de la interfaz.
  async after(_stage: AulaStageId, output: unknown): Promise<void> {
    this.signal.throwIfAborted();
    await this.record(
      "stage",
      "complete",
      { output },
      Math.max(0, performance.now() - this.started),
    );
  }

  // Cada delta procede del flujo del proveedor. Nunca se utiliza un temporizador para simular escritura.
  async delta(text: string): Promise<void> {
    await this.record("delta", "info", { text });
  }

  // El cliente debe nombrar el paso visto; una petición atrasada no salta el próximo paso.
  advance(expected: AulaStageId): void {
    if (!this.gate || this.gate.stage !== expected || this.signal.aborted)
      throw new Error("El paso ya cambió. Actualiza la ejecución.");
    const gate = this.gate;
    this.gate = null;
    gate.resolve();
  }

  // Cambiar a automático libera solo la espera actual y evita nuevas pausas.
  async automatic(): Promise<void> {
    this.run.mode = "auto";
    this.gate?.resolve();
    this.gate = null;
    await this.record("status", "info", { mode: "auto" });
  }

  // Una pausa solicitada durante una llamada se aplica antes de la siguiente operación.
  async pause(): Promise<void> {
    this.run.mode = "step";
    await this.record("status", "info", { mode: "step" });
  }

  // Aborta el proveedor o rechaza una espera; nunca reenvía ni devuelve una reserva incierta.
  cancel(): void {
    const error = new DOMException("Ejecución cancelada. Las reservas se conservan.", "AbortError");
    this.abort.abort(error);
    this.gate?.reject(error);
    this.gate = null;
  }

  // Los recorridos históricos son de lectura: solo los controladores vivos pueden avanzar.
  async finish(result: unknown, error?: string): Promise<void> {
    this.run.waitingStage = null;
    this.run.status = this.signal.aborted ? "cancelled" : error ? "failed" : "complete";
    this.run.error = error ?? null;
    this.run.result = aulaJson(result);
    await this.record("status", error ? "error" : "complete", {
      status: this.run.status,
      result: this.run.result,
      error: this.run.error,
    });
  }

  // Reconectar un observador no crea otra ejecución ni vuelve a llamar a los modelos.
  subscribe(listener: (event: AulaEvent, run: AulaRun) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
