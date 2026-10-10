import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import type { ResearchDatabase } from "./research-db";

const WRITES_IDX_MAP: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
};

type PendingWrite = [string, unknown];

interface CheckpointListOptions {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
}

function checkpointId(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_id ?? config.configurable?.thread_ts;
  return typeof value === "string" ? value : "";
}

/** LangGraph escribe el grafo raíz con el espacio vacío. El aislamiento es el hilo del trabajo. */

function threadIdOf(config: RunnableConfig): string {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || threadId.length === 0 || threadId.length > 160) {
    throw new Error("El checkpointer exige un thread_id de servidor.");
  }
  return threadId;
}

function namespaceOf(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_ns;
  return typeof value === "string" ? value : "";
}

function encode(type: string, data: Uint8Array): string {
  if (type === "json") {
    return new TextDecoder().decode(data);
  }
  let binary = "";
  for (const byte of data) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decode(type: string, value: string): Uint8Array | string {
  if (type === "json") {
    return value;
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

interface CheckpointRow {
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  type: string;
  checkpoint: string;
  metadata: string;
}

interface WriteRow {
  task_id: string;
  idx: number;
  channel: string;
  type: string;
  value: string;
}

/**
 * Checkpointer de LangGraph sobre D1. Guarda el checkpoint y las escrituras
 * pendientes. El hilo es el del trabajo, no el de la conversación.
 */
export class D1CheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly database: ResearchDatabase) {
    super();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = threadIdOf(config);
    const checkpointNs = namespaceOf(config);
    const requested = checkpointId(config);
    const row = requested
      ? await this.database
          .prepare(
            `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
             FROM research_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
          )
          .bind(threadId, checkpointNs, requested)
          .first<CheckpointRow>()
      : await this.database
          .prepare(
            `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
             FROM research_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC LIMIT 1`,
          )
          .bind(threadId, checkpointNs)
          .first<CheckpointRow>();
    if (row === null) {
      return undefined;
    }
    return this.tuple(threadId, checkpointNs, row);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id;
    if (typeof threadId !== "string") {
      return;
    }
    const checkpointNs = namespaceOf(config);
    const rows = await this.database
      .prepare(
        `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
         FROM research_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC`,
      )
      .bind(threadId, checkpointNs)
      .all<CheckpointRow>();
    let remaining = options?.limit;
    const before = options?.before ? checkpointId(options.before) : "";
    for (const row of rows) {
      if (before && row.checkpoint_id >= before) {
        continue;
      }
      const metadata = (await this.serde.loadsTyped("json", row.metadata)) as CheckpointMetadata;
      const metadataRecord = metadata as Record<string, unknown>;
      if (
        options?.filter &&
        !Object.entries(options.filter).every(([key, value]) => metadataRecord[key] === value)
      ) {
        continue;
      }
      if (remaining !== undefined) {
        if (remaining <= 0) {
          return;
        }
        remaining -= 1;
      }
      yield await this.tuple(threadId, checkpointNs, row);
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = threadIdOf(config);
    const checkpointNs = namespaceOf(config);
    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    if (metadataType !== "json") {
      throw new Error("Los metadatos del checkpoint no son JSON.");
    }
    await this.database
      .prepare(
        `INSERT INTO research_checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
           parent_checkpoint_id = excluded.parent_checkpoint_id,
           type = excluded.type,
           checkpoint = excluded.checkpoint,
           metadata = excluded.metadata`,
      )
      .bind(
        threadId,
        checkpointNs,
        checkpoint.id,
        checkpointId(config) || null,
        checkpointType,
        encode(checkpointType, checkpointBytes),
        encode(metadataType, metadataBytes),
      )
      .run();
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = threadIdOf(config);
    const checkpointNs = namespaceOf(config);
    const checkpointId = config.configurable?.checkpoint_id;
    if (typeof checkpointId !== "string" || checkpointId.length === 0) {
      throw new Error("putWrites exige checkpoint_id.");
    }
    const existing = await this.database
      .prepare(
        `SELECT task_id, idx FROM research_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND task_id = ?`,
      )
      .bind(threadId, checkpointNs, checkpointId, taskId)
      .all<{ idx: number }>();
    const seen = new Set(existing.map((row) => row.idx));
    for (let index = 0; index < writes.length; index += 1) {
      const write = writes[index];
      if (write === undefined) {
        continue;
      }
      const [channel, value] = write;
      const mapped = WRITES_IDX_MAP[channel];
      const idx = mapped === undefined ? index : mapped;
      if (idx >= 0 && seen.has(idx)) {
        continue;
      }
      const [type, bytes] = await this.serde.dumpsTyped(value);
      await this.database
        .prepare(
          `INSERT INTO research_checkpoint_writes
             (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, idx) DO UPDATE SET
             channel = excluded.channel,
             type = excluded.type,
             value = excluded.value`,
        )
        .bind(threadId, checkpointNs, checkpointId, taskId, idx, channel, type, encode(type, bytes))
        .run();
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.database
      .prepare(`DELETE FROM research_checkpoint_writes WHERE thread_id = ?`)
      .bind(threadId)
      .run();
    await this.database
      .prepare(`DELETE FROM research_checkpoints WHERE thread_id = ?`)
      .bind(threadId)
      .run();
  }

  private async tuple(
    threadId: string,
    checkpointNs: string,
    row: CheckpointRow,
  ): Promise<CheckpointTuple> {
    const checkpoint = (await this.serde.loadsTyped(
      row.type,
      decode(row.type, row.checkpoint),
    )) as Checkpoint;
    const metadata = (await this.serde.loadsTyped("json", row.metadata)) as CheckpointMetadata;
    const writes = await this.database
      .prepare(
        `SELECT task_id, idx, channel, type, value
         FROM research_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      )
      .bind(threadId, checkpointNs, row.checkpoint_id)
      .all<WriteRow>();
    const pendingWrites = await Promise.all(
      writes.map(async (write) => {
        const value: unknown = await this.serde.loadsTyped(
          write.type,
          decode(write.type, write.value),
        );
        return [write.task_id, write.channel, value] as [string, string, unknown];
      }),
    );
    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    };
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }
    return tuple;
  }
}

export function checkpointThread(jobId: string): string {
  return `job:${jobId}`;
}

export function checkpointConfig(jobId: string): RunnableConfig {
  return { configurable: { thread_id: checkpointThread(jobId), checkpoint_ns: "" } };
}
