// GUÍA DE LECTURA · lab/aula/service.ts
// Une el pipeline del CLI, sus proveedores reales y PostgreSQL con el controlador del Aula.
// El mismo running.lock y presupuesto del laboratorio impiden gastar desde dos procesos a la vez.
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { suppressUnknownCitations } from "@thepower-rag/core";
import type {
  AulaDocument,
  AulaKind,
  AulaMode,
  AulaRun,
  AulaStatus,
  AulaStoredChunk,
} from "@thepower-rag/contracts";
import { createLabModels, type LabModelOperation } from "../../apps/api/src/lab-models";
import { cleanDocumentText, prepareLabCorpusFromDirectory } from "../src/corpus";
import { resolveLabConfig } from "../src/config";
import { LAB_VALIDATION_SET } from "../src/evaluation";
import { PgVectorDatabaseStore, type PostgresSqlExecutor } from "../src/pgvector-store";
import { runLabBasicRag } from "../src/rag-basic";
import {
  LabBudget,
  labHash,
  LAB_LOCAL_DIR,
  realLabSettings,
  saveLabJson,
} from "../src/real-session";
import { AulaController, aulaJson } from "./controller";
import { PgAulaJournal } from "./journal";

// Solo esta pequeña interfaz depende de Bun.SQL; el resto se puede verificar desde Vitest.
interface AulaSqlClient {
  unsafe(text: string, parameters: unknown[]): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

// Abre una conexión propia para conservar cada transacción en una única sesión.
async function connect(databaseUrl: string) {
  const moduleName = "bun";
  const runtime = (await import(moduleName)) as {
    SQL: new (url: string, options: { max: number }) => AulaSqlClient;
  };
  const client = new runtime.SQL(databaseUrl, { max: 1 });
  const sql: PostgresSqlExecutor = {
    async query<T extends Record<string, unknown>>(
      text: string,
      parameters: readonly unknown[] = [],
    ) {
      return Array.from(await client.unsafe(text, [...parameters])) as T[];
    },
  };
  return { client, sql };
}

// Lee un recibo local sin confundir su ausencia con un experimento ejecutado.
function localJson(file: string): Record<string, unknown> | null {
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>)
    : null;
}

// Servicio local: ningún endpoint recibe claves ni puede elegir otro destino PostgreSQL.
export class AulaService {
  private readonly settings: ReturnType<typeof realLabSettings>;
  private readonly local: string;
  private journal!: PgAulaJournal;
  private catalog!: Awaited<ReturnType<typeof connect>>;
  private readonly controllers = new Map<string, AulaController>();
  private active: AulaController | null = null;
  private task: Promise<void> | null = null;

  constructor(
    readonly root: string,
    readonly enabled: boolean,
    readonly limitUsd: number,
  ) {
    const envFile = path.join(root, "lab/.env");
    this.settings = realLabSettings({
      ...process.env,
      ...(existsSync(envFile) ? parse(readFileSync(envFile, "utf8")) : {}),
    });
    // Comparte índice, calibración, diario y bloqueo con `bun run lab:real` para el corpus actual.
    this.local = path.join(root, LAB_LOCAL_DIR);
    mkdirSync(this.local, { recursive: true });
    // Valida el diario existente sin borrarlo ni cambiar su tope.
    this.budget();
  }

  async initialize(): Promise<void> {
    this.catalog = await connect(this.settings.databaseUrl);
    this.journal = new PgAulaJournal(this.catalog.sql);
    await this.journal.initialize();
  }

  private corpus() {
    return prepareLabCorpusFromDirectory(path.join(this.root, "lab/corpus/sources"));
  }
  private embeddingId() {
    return `${this.settings.embeddingProvider}:${this.settings.embeddingModel}:768`;
  }
  private profile(corpus = this.corpus()) {
    return labHash({
      corpus: corpus.corpusVersion,
      embedding: this.embeddingId(),
      dimensions: 768,
    });
  }
  private budget() {
    return new LabBudget(path.join(this.local, "budget.json"), this.limitUsd, this.settings.rates);
  }

  // Congela y contrasta la fuente antes de usarla como entrada de una etapa.
  private documents(corpus: ReturnType<typeof prepareLabCorpusFromDirectory>): AulaDocument[] {
    return corpus.documents.map((doc) => {
      const rawText = readFileSync(path.join(this.root, doc.sourcePath), "utf8");
      if (cleanDocumentText(rawText) !== doc.cleanText)
        throw new Error("Las fuentes cambiaron. Prepara un recorrido nuevo.");
      return { ...doc, rawText };
    });
  }

  // TablaPlus y la interfaz leen estas mismas tablas; los vectores son los almacenados por pgvector.
  async content(
    sql: PostgresSqlExecutor = this.catalog.sql,
  ): Promise<{ documents: AulaDocument[]; chunks: AulaStoredChunk[] }> {
    const corpus = this.corpus();
    const documents = this.documents(corpus);
    const rows = await sql.query(
      "SELECT chunk_id,document_id,title,section,content,ordinal,corpus_version,embedding_model,embedding::text AS vector FROM lab_chunks ORDER BY document_id,ordinal",
    );
    const chunks = rows.map((row): AulaStoredChunk => ({
      chunkId: String(row.chunk_id),
      documentId: String(row.document_id),
      title: String(row.title),
      section: String(row.section),
      content: String(row.content),
      ordinal: Number(row.ordinal),
      corpusVersion: String(row.corpus_version),
      embeddingModel: String(row.embedding_model),
      vector: JSON.parse(String(row.vector)) as number[],
    }));
    return { documents, chunks };
  }

  async status(sql: PostgresSqlExecutor = this.catalog.sql): Promise<AulaStatus> {
    const corpus = this.corpus();
    const [counts] = await sql.query(
      "SELECT COUNT(*) AS chunks, MIN(vector_dims(embedding)) AS minimum, MAX(vector_dims(embedding)) AS maximum FROM lab_chunks WHERE corpus_version=$1 AND embedding_model=$2",
      [corpus.corpusVersion, this.embeddingId()],
    );
    const [metadata] = await sql.query(
      "SELECT document_count FROM lab_corpus_versions WHERE corpus_version=$1 AND embedding_model=$2",
      [corpus.corpusVersion, this.embeddingId()],
    );
    const [index] = await sql.query(
      "SELECT indexdef FROM pg_indexes WHERE tablename='lab_chunks' AND indexname='lab_chunks_embedding_hnsw_idx'",
    );
    const calibration = localJson(path.join(this.local, "calibration.json"));
    const valid =
      calibration?.profile === this.profile() &&
      calibration.validationHash === labHash(LAB_VALIDATION_SET) &&
      typeof calibration.threshold === "number" &&
      Number.isFinite(calibration.threshold);
    const missing = [
      ...(!this.settings.embeddingApiKey ? ["Credencial de embeddings"] : []),
      ...(!this.settings.generation.apiKey ? ["Credencial del generador"] : []),
    ];
    return {
      executionEnabled: this.enabled && missing.length === 0,
      missing,
      backend: "postgresql-pgvector",
      database: "127.0.0.1:54329/aether_rag",
      generationModel: this.settings.generation.modelId,
      generationProvider: this.settings.generation.provider ?? "anthropic",
      embeddingModel: this.embeddingId(),
      corpusVersion: corpus.corpusVersion,
      profile: this.profile(),
      documents: Number(metadata?.document_count ?? 0),
      chunks: Number(counts?.chunks ?? 0),
      dimensions:
        counts?.minimum === counts?.maximum && counts?.minimum !== null
          ? Number(counts?.minimum)
          : null,
      hnsw: typeof index?.indexdef === "string" ? index.indexdef : null,
      calibration: {
        valid,
        threshold: valid ? Number(calibration!.threshold) : null,
        rows: aulaJson(calibration?.rows),
      },
      budget: this.budget().receipt(),
      activeRunId: this.active?.run.id ?? null,
    };
  }

  async list() {
    return this.journal.list();
  }
  controller(id: string) {
    return this.controllers.get(id);
  }
  async get(id: string): Promise<AulaRun | null> {
    return this.controllers.get(id)?.snapshot() ?? this.journal.get(id);
  }

  // Arrancar no repite ejecuciones previas: cada intención tiene un UUID nuevo y un bloqueo exclusivo.
  async start(kind: AulaKind, mode: AulaMode, question: string): Promise<AulaRun> {
    if (!this.enabled)
      throw new Error(
        "Las llamadas reales están desactivadas. Inicia lab:aula con --execute y el tope del laboratorio.",
      );
    if (this.active)
      throw new Error("Hay una ejecución en curso. Termínala o cancélala antes de iniciar otra.");
    const status = await this.status();
    if (status.missing.length) throw new Error("Faltan credenciales reales del laboratorio.");
    if (
      kind === "rag" &&
      (!status.calibration.valid ||
        status.chunks !== this.corpus().chunks.length ||
        status.dimensions !== 768)
    )
      throw new Error(
        "El índice o la calibración no coinciden con este corpus. Revisa el laboratorio antes de consultar.",
      );
    const lock = path.join(this.local, "running.lock");
    let fd: number;
    try {
      fd = openSync(lock, "wx", 0o600);
    } catch {
      throw new Error(
        "Otra ejecución del laboratorio tiene el bloqueo. No se ha enviado ninguna llamada.",
      );
    }
    const controller = new AulaController(
      kind,
      mode,
      kind === "ingest" ? "" : question,
      this.journal,
    );
    writeFileSync(
      fd,
      JSON.stringify({ owner: "aula", runId: controller.run.id, pid: process.pid }),
    );
    try {
      await this.journal.create(controller.run);
    } catch (error) {
      closeSync(fd);
      unlinkSync(lock);
      throw error;
    }
    this.active = controller;
    this.controllers.set(controller.run.id, controller);
    // El trabajo pertenece al servidor; recargar o reconectar SSE no vuelve a enviarlo.
    this.task = this.execute(controller).finally(() => {
      try {
        if (existsSync(lock) && statSync(lock).ino === fstatSync(fd).ino) unlinkSync(lock);
      } finally {
        closeSync(fd);
        this.active = null;
      }
    });
    void this.task.catch(() =>
      console.error(
        "El diario del Aula no pudo completar la ejecución. Las reservas se conservan.",
      ),
    );
    return controller.snapshot();
  }

  // Elimina cualquier credencial de un error antes de guardarlo o mostrarlo.
  private publicError(error: unknown): string {
    let text = error instanceof Error ? error.message : "Falló la ejecución real del laboratorio.";
    for (const key of [this.settings.embeddingApiKey, this.settings.generation.apiKey])
      if (key) text = text.replaceAll(key, "[credencial omitida]");
    return text.slice(0, 600);
  }

  private async execute(controller: AulaController): Promise<void> {
    let connection: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      const budget = this.budget();
      const operations: LabModelOperation[] = [];
      connection = await connect(this.settings.databaseUrl);
      // Captura las sentencias del almacén real; el diario usa otra conexión para evitar recursión.
      const sql: PostgresSqlExecutor = {
        query: async <T extends Record<string, unknown>>(
          statement: string,
          parameters: readonly unknown[] = [],
        ) => {
          const start = performance.now();
          await controller.record("sql", "running", { statement, parameters });
          const rows = await connection!.sql.query<T>(statement, parameters);
          await controller.record(
            "sql",
            "complete",
            { statement, parameters, rows },
            performance.now() - start,
          );
          return rows;
        },
      };
      const store = new PgVectorDatabaseStore(sql);
      const models = createLabModels({
        ...this.settings,
        signal: controller.signal,
        inspector: controller,
        beforeCall: (kind, text, maxOutput) => {
          controller.signal.throwIfAborted();
          budget.reserve(kind, text, maxOutput);
        },
        observe: (operation) => {
          operations.push(operation);
          // La siguiente frontera espera la misma cola y propagará el fallo del diario.
          // Este manejador evita una promesa sin capturar en el callback síncrono del SDK.
          void controller.record("usage", "info", operation).catch(() => {});
        },
      });
      let corpus = this.corpus();
      let result: unknown;
      if (controller.run.kind === "ingest") {
        await controller.before("documents", {
          directory: "lab/corpus/sources",
          files: corpus.documents.map((doc) => doc.sourcePath),
        });
        const documents = this.documents(corpus);
        await controller.after("documents", { documents });
        await controller.before("chunking", { documents, chunking: corpus.chunking });
        corpus = this.corpus();
        if (
          corpus.documents.some(
            (doc) =>
              documents.find((source) => source.documentId === doc.documentId)?.contentHash !==
              doc.contentHash,
          )
        )
          throw new Error("Las fuentes cambiaron durante la pausa. Prepara otra ingesta.");
        await controller.after("chunking", {
          documents: corpus.documents,
          chunks: corpus.chunks,
          chunking: corpus.chunking,
          corpusVersion: corpus.corpusVersion,
        });
        const tracedEmbedder = {
          ...models.embedder,
          embed: async (texts: readonly string[]) => {
            await controller.before("document-embeddings", {
              texts,
              model: models.embedder.modelId,
              dimensions: 768,
            });
            const vectors = await models.embedder.embed(texts);
            await controller.after("document-embeddings", {
              vectors,
              dimensions: 768,
              chunkIds: corpus.chunks.map((chunk) => chunk.chunkId),
            });
            return vectors;
          },
        };
        const receipt = await store.rebuildFromEmptyIndex({
          corpus,
          embedder: tracedEmbedder,
          signal: controller.signal,
          observer: controller,
          beforeWrite: () =>
            controller.before("store", {
              database: "127.0.0.1:54329/aether_rag",
              documentCount: corpus.documents.length,
              chunkCount: corpus.chunks.length,
              transaction: "BEGIN → reemplazo del índice local → lectura → COMMIT",
            }),
        });
        await controller.after("store", receipt);
        await controller.before("verify-index", {
          corpusVersion: corpus.corpusVersion,
          expectedChunks: corpus.chunks.length,
          dimensions: 768,
        });
        const content = await this.content(sql);
        const status = await this.status(sql);
        if (
          content.chunks.length !== corpus.chunks.length ||
          status.dimensions !== 768 ||
          !status.hnsw?.includes("USING hnsw")
        )
          throw new Error("La lectura de vuelta no confirma el índice esperado.");
        await controller.after("verify-index", { receipt, status, chunks: content.chunks });
        saveLabJson(path.join(this.local, "index.json"), {
          ...receipt,
          profile: this.profile(corpus),
        });
        result = { ...receipt, verified: true };
      } else if (controller.run.kind === "baseline") {
        const rawAnswer = await models.generator(controller.run.question, []);
        const answer = suppressUnknownCitations(rawAnswer, new Set<string>());
        await controller.before("citations", { rawAnswer, allowedIds: [] });
        await controller.after("citations", { answer, citations: [], suppliedDocuments: 0 });
        result = {
          answer,
          citations: [],
          retrievalCount: 0,
          generationCalled: true,
          suppliedDocuments: 0,
        };
      } else {
        const calibration = localJson(path.join(this.local, "calibration.json"))!;
        const threshold = Number(calibration.threshold);
        const config = {
          ...resolveLabConfig({}),
          genModelId: this.settings.generation.modelId,
          embeddingModelId: models.embedder.modelId,
          minSimilarity: threshold,
          maxCosineDistance: 1 - threshold,
        };
        result = await runLabBasicRag({
          question: controller.run.question,
          corpusVersion: corpus.corpusVersion,
          config,
          store,
          embedder: models.embedder,
          generator: models.generator,
          observer: controller,
        });
      }
      const receipt = {
        result,
        operations,
        budget: budget.receipt(),
        profile: this.profile(corpus),
        backend: "postgresql-pgvector",
        execution: "real",
      };
      saveLabJson(path.join(this.local, `aula-${controller.run.id}.json`), receipt);
      await controller.finish(receipt);
    } catch (error) {
      await controller.finish(null, this.publicError(error));
    } finally {
      await connection?.client.close();
    }
  }

  // Detener el servidor cancela la espera, libera el bloqueo y conserva los recibos ya escritos.
  async close(): Promise<void> {
    this.active?.cancel();
    await this.task?.catch(() => {});
    await this.catalog?.client.close();
  }
}
