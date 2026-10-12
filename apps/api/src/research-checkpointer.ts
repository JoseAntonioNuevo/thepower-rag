// GUÍA DE LECTURA · apps/api/src/research-checkpointer.ts
// Checkpointer de LangGraph sobre D1: guarda cada checkpoint y sus escrituras pendientes para que
// un trabajo de investigación pueda reanudarse en otro paso del Workflow.
// Tipo de la configuración de LangGraph.
import type { RunnableConfig } from "@langchain/core/runnables";
// Clase base y tipos de checkpoint de LangGraph.
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
// Tipo de la base de datos de la investigación.
import type { ResearchDatabase } from "./research-db";

// Índices especiales que LangGraph usa para errores, programados, interrupciones y reanudaciones.
const WRITES_IDX_MAP: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
};

// Escritura pendiente: canal y valor.
type PendingWrite = [string, unknown];

// Opciones de list.
interface CheckpointListOptions {
  // Máximo de resultados.
  limit?: number;
  // Solo anteriores a este checkpoint.
  before?: RunnableConfig;
  // Filtro por metadatos.
  filter?: Record<string, unknown>;
}

// Id del checkpoint de la configuración (o thread_ts antiguo).
function checkpointId(config: RunnableConfig): string {
  // Valor de configurable.
  const value = config.configurable?.checkpoint_id ?? config.configurable?.thread_ts;
  // Texto o vacío.
  return typeof value === "string" ? value : "";
}

/** LangGraph escribe el grafo raíz con el espacio vacío. El aislamiento es el hilo del trabajo. */

function threadIdOf(config: RunnableConfig): string {
  // Id del hilo.
  const threadId = config.configurable?.thread_id;
  // Obligatorio y acotado.
  if (typeof threadId !== "string" || threadId.length === 0 || threadId.length > 160) {
    // Error.
    throw new Error("El checkpointer exige un thread_id de servidor.");
  }
  // Hilo.
  return threadId;
}

// Espacio de nombres del checkpoint.
function namespaceOf(config: RunnableConfig): string {
  // Valor.
  const value = config.configurable?.checkpoint_ns;
  // Texto o vacío.
  return typeof value === "string" ? value : "";
}

// Serializa bytes: JSON como texto y el resto en base64.
function encode(type: string, data: Uint8Array): string {
  // JSON.
  if (type === "json") {
    // Texto.
    return new TextDecoder().decode(data);
  }
  // Cadena binaria.
  let binary = "";
  // Cada byte.
  for (const byte of data) {
    // Como carácter.
    binary += String.fromCharCode(byte);
  }
  // Base64.
  return btoa(binary);
}

// Deshace encode.
function decode(type: string, value: string): Uint8Array | string {
  // JSON.
  if (type === "json") {
    // Texto tal cual.
    return value;
  }
  // Decodifica base64.
  const binary = atob(value);
  // Bytes.
  const bytes = new Uint8Array(binary.length);
  // Cada carácter.
  for (let index = 0; index < binary.length; index += 1) {
    // A byte.
    bytes[index] = binary.charCodeAt(index);
  }
  // Bytes.
  return bytes;
}

// Fila de research_checkpoints.
interface CheckpointRow {
  // Id del checkpoint.
  checkpoint_id: string;
  // Id del padre.
  parent_checkpoint_id: string | null;
  // Tipo de serialización.
  type: string;
  // Checkpoint serializado.
  checkpoint: string;
  // Metadatos JSON.
  metadata: string;
}

// Fila de research_checkpoint_writes.
interface WriteRow {
  // Tarea que escribió.
  task_id: string;
  // Índice de la escritura.
  idx: number;
  // Canal.
  channel: string;
  // Tipo de serialización.
  type: string;
  // Valor serializado.
  value: string;
}

/**
 * Checkpointer de LangGraph sobre D1. Guarda el checkpoint y las escrituras
 * pendientes. El hilo es el del trabajo, no el de la conversación.
 */
export class D1CheckpointSaver extends BaseCheckpointSaver {
  // Recibe la base de datos y la guarda como propiedad privada.
  constructor(private readonly database: ResearchDatabase) {
    // Constructor de la clase base.
    super();
  }

  // Devuelve un checkpoint concreto o el último del hilo.
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    // Hilo.
    const threadId = threadIdOf(config);
    // Espacio.
    const checkpointNs = namespaceOf(config);
    // Id pedido.
    const requested = checkpointId(config);
    // Con id, ese checkpoint; sin id, el más reciente.
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
    // No existe.
    if (row === null) {
      // undefined.
      return undefined;
    }
    // Tupla completa.
    return this.tuple(threadId, checkpointNs, row);
  }

  // Recorre los checkpoints del hilo del más reciente al más antiguo.
  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    // Hilo.
    const threadId = config.configurable?.thread_id;
    // Sin hilo, nada.
    if (typeof threadId !== "string") {
      // Termina.
      return;
    }
    // Espacio.
    const checkpointNs = namespaceOf(config);
    // Todos los checkpoints del hilo.
    const rows = await this.database
      .prepare(
        `SELECT checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
         FROM research_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC`,
      )
      .bind(threadId, checkpointNs)
      .all<CheckpointRow>();
    // Cuántos quedan por devolver.
    let remaining = options?.limit;
    // Límite superior opcional.
    const before = options?.before ? checkpointId(options.before) : "";
    // Cada fila.
    for (const row of rows) {
      // Posterior al límite: se salta.
      if (before && row.checkpoint_id >= before) {
        // Siguiente.
        continue;
      }
      // Metadatos.
      const metadata = (await this.serde.loadsTyped("json", row.metadata)) as CheckpointMetadata;
      // Como registro.
      const metadataRecord = metadata as Record<string, unknown>;
      // No cumple el filtro.
      if (
        options?.filter &&
        !Object.entries(options.filter).every(([key, value]) => metadataRecord[key] === value)
      ) {
        // Siguiente.
        continue;
      }
      // Con límite.
      if (remaining !== undefined) {
        // Agotado.
        if (remaining <= 0) {
          // Termina.
          return;
        }
        // Uno menos.
        remaining -= 1;
      }
      // Entrega la tupla.
      yield await this.tuple(threadId, checkpointNs, row);
    }
  }

  // Guarda un checkpoint; si ya existe, lo actualiza.
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    // Hilo.
    const threadId = threadIdOf(config);
    // Espacio.
    const checkpointNs = namespaceOf(config);
    // Serializa checkpoint y metadatos.
    const [[checkpointType, checkpointBytes], [metadataType, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    // Los metadatos deben ser JSON.
    if (metadataType !== "json") {
      // Error.
      throw new Error("Los metadatos del checkpoint no son JSON.");
    }
    // INSERT con ON CONFLICT: idempotente.
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
    // Configuración del checkpoint guardado.
    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  // Guarda las escrituras pendientes de una tarea.
  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    // Hilo.
    const threadId = threadIdOf(config);
    // Espacio.
    const checkpointNs = namespaceOf(config);
    // Checkpoint al que pertenecen.
    const checkpointId = config.configurable?.checkpoint_id;
    // Obligatorio.
    if (typeof checkpointId !== "string" || checkpointId.length === 0) {
      // Error.
      throw new Error("putWrites exige checkpoint_id.");
    }
    // Índices ya guardados de esa tarea.
    const existing = await this.database
      .prepare(
        `SELECT task_id, idx FROM research_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ? AND task_id = ?`,
      )
      .bind(threadId, checkpointNs, checkpointId, taskId)
      .all<{ idx: number }>();
    // Conjunto de índices vistos.
    const seen = new Set(existing.map((row) => row.idx));
    // Cada escritura.
    for (let index = 0; index < writes.length; index += 1) {
      // Escritura.
      const write = writes[index];
      // Hueco: se salta.
      if (write === undefined) {
        // Siguiente.
        continue;
      }
      // Canal y valor.
      const [channel, value] = write;
      // Índice especial del canal.
      const mapped = WRITES_IDX_MAP[channel];
      // Especial o posición.
      const idx = mapped === undefined ? index : mapped;
      // Normal ya guardada: no se repite.
      if (idx >= 0 && seen.has(idx)) {
        // Siguiente.
        continue;
      }
      // Serializa.
      const [type, bytes] = await this.serde.dumpsTyped(value);
      // Guarda o actualiza.
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

  // Borra todo el hilo de un trabajo.
  async deleteThread(threadId: string): Promise<void> {
    // Escrituras.
    await this.database
      .prepare(`DELETE FROM research_checkpoint_writes WHERE thread_id = ?`)
      .bind(threadId)
      .run();
    // Checkpoints.
    await this.database
      .prepare(`DELETE FROM research_checkpoints WHERE thread_id = ?`)
      .bind(threadId)
      .run();
  }

  // Construye la tupla de LangGraph a partir de una fila.
  private async tuple(
    threadId: string,
    checkpointNs: string,
    row: CheckpointRow,
  ): Promise<CheckpointTuple> {
    // Checkpoint deserializado.
    const checkpoint = (await this.serde.loadsTyped(
      row.type,
      decode(row.type, row.checkpoint),
    )) as Checkpoint;
    // Metadatos.
    const metadata = (await this.serde.loadsTyped("json", row.metadata)) as CheckpointMetadata;
    // Escrituras del checkpoint.
    const writes = await this.database
      .prepare(
        `SELECT task_id, idx, channel, type, value
         FROM research_checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      )
      .bind(threadId, checkpointNs, row.checkpoint_id)
      .all<WriteRow>();
    // Escrituras como [tarea, canal, valor].
    const pendingWrites = await Promise.all(
      writes.map(async (write) => {
        // Valor deserializado.
        const value: unknown = await this.serde.loadsTyped(
          write.type,
          decode(write.type, write.value),
        );
        // Tupla de escritura.
        return [write.task_id, write.channel, value] as [string, string, unknown];
      }),
    );
    // Tupla con configuración, checkpoint, metadatos y escrituras.
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
    // Si tiene padre.
    if (row.parent_checkpoint_id) {
      // Su configuración.
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }
    // Tupla.
    return tuple;
  }
}

// Hilo de LangGraph de un trabajo.
export function checkpointThread(jobId: string): string {
  // job: más el id.
  return `job:${jobId}`;
}

// Configuración del grafo de un trabajo.
export function checkpointConfig(jobId: string): RunnableConfig {
  // Hilo del trabajo y espacio raíz.
  return { configurable: { thread_id: checkpointThread(jobId), checkpoint_ns: "" } };
}
