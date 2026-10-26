// GUÍA DE LECTURA · apps/api/src/bridge-worker.ts
// Worker puente que usan los scripts de ingesta y verificación: solo escucha en 127.0.0.1 y exige una
// ficha compartida. Embebe, describe el índice, ingesta el corpus congelado y elige el perfil activo,
// con bindings reales (BRIDGE_REMOTE=true) o con emuladores locales. Registra qué adaptador se usó.
// Corpus preparados y congelados que se empaquetan con el Worker: el curso y la tienda ThePower Shop.
import rawCorpus from "../../../corpus/prepared/corpus.json";
import rawStoreCorpus from "../../../corpus/prepared/thepower-shop.json";
// Núcleo: emulador local de embeddings, manifiesto, selección de perfil, nombres y sesión de gasto.
import {
  // Embedding emulado local y su dimensión.
  LOCAL_EMULATED_DIMENSIONS,
  // SQL de selección del perfil activo y hash FNV-1a.
  activeSelectionSql,
  fnv1a64,
  localEmulatedEmbed,
  // Manifiesto semántico, calendario, sesión de gasto y nombre del índice.
  semanticManifest,
  isScheduleQuestion,
  createAllowanceLedger,
  vectorizeIndexName,
  // Tipos del registro de adaptadores y del corpus preparado.
  type AdapterRecord,
  type PreparedCorpus,
} from "@thepower-rag/core";
// App principal para verificar el chat.
import { createApp } from "./app";
// Ingesta con bindings y su diario.
import { loadBoundJournal, runBoundIngestion, type IngestBindings } from "./ingest-run";
// Puertos CRAG emulados.
import { localEmulatedCragPorts } from "./local-crag-ports";
// Modelo de lenguaje emulado.
import { localEmulatedLanguageModel } from "./local-emulated-model";
// Esquema SQL local.
import { schemaStatements } from "./local-schema";
// Vectorize emulado sobre D1.
import { createLocalVectorize, type LocalVectorize, type StoredVector } from "./local-vectorize";
// Tipo del índice vectorial.
import type { VectorIndex } from "./stores";
// Modelo BGE-M3 y tipo del ejecutor de embeddings.
import { BGE_M3_MODEL, type EmbeddingRunner } from "./vectors";

// Id de preparación del corpus congelado.
const FROZEN_PREPARATION = "c3a59a406888b";
// Versión de contenido del corpus congelado.
const FROZEN_CONTENT = "cc037ef0bb1f7";
// Preparación y contenido congelados de la tienda ThePower Shop (chat con CHAT_CORPUS=thepower-shop).
const FROZEN_STORE_PREPARATION = "cc140d7876624";
const FROZEN_STORE_CONTENT = "c907bd93cf7af";

// Parte de D1 que usa el puente.
interface SqlDb {
  // Ejecuta SQL sin parámetros.
  exec(query: string): Promise<unknown>;
  // Prepara una consulta.
  prepare(query: string): {
    // Enlaza valores.
    bind(...values: unknown[]): {
      // Primera fila.
      first<T>(): Promise<T | null>;
      // Ejecuta.
      run(): Promise<unknown>;
      // Todas las filas.
      all<T>(): Promise<{ results: T[] }>;
    };
  };
  // Varias sentencias en lote.
  batch(statements: unknown[]): Promise<unknown>;
}

// Parte de R2 que usa el puente.
interface Bucket {
  // Guarda.
  put(key: string, body: string | Uint8Array): Promise<unknown>;
  // Lee.
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

// Variables y bindings del puente.
export interface BridgeEnv {
  // Ficha compartida con los scripts.
  BRIDGE_TOKEN?: string;
  // Papel: probe, storage o verify.
  BRIDGE_ROLE?: string;
  // "true" para usar bindings reales.
  BRIDGE_REMOTE?: string;
  // Nombre del índice Vectorize.
  BRIDGE_INDEX_NAME?: string;
  // Métrica verificada por la API de gestión.
  BRIDGE_VERIFIED_METRIC?: string;
  // Índices de metadatos en JSON.
  BRIDGE_METADATA_INDEXES?: string;
  // Modo de la app.
  APP_MODE?: string;
  // Clave de Anthropic.
  ANTHROPIC_API_KEY?: string;
  // Modelo generador.
  MODEL_ID?: string;
  // Modelo evaluador.
  EVALUATOR_MODEL_ID?: string;
  // Modelo de embeddings.
  EMBEDDING_MODEL?: string;
  // Dimensiones.
  EMBEDDING_DIMENSIONS?: string;
  // Versión del corpus.
  CORPUS_VERSION?: string;
  // Perfil del índice.
  INDEX_PROFILE?: string;
  // Métrica.
  VECTOR_METRIC?: string;
  // Umbral de recuperación.
  MIN_RETRIEVAL_SCORE?: string;
  // Workers AI.
  AI?: EmbeddingRunner;
  // D1.
  DB?: SqlDb;
  // Vectorize.
  VECTORIZE?: {
    // Inserta vectores.
    upsert(vectors: { id: string; values: number[]; metadata: Record<string, string> }[]): Promise<{
      // Id de mutación.
      mutationId?: string;
    }>;
    // Lee vectores por id.
    getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, unknown> }[]>;
    // Describe el índice.
    describe(): Promise<{
      // Dimensiones.
      dimensions?: number;
      // Número de vectores.
      vectorCount?: number;
      // Configuración.
      config?: { metric?: string };
    }>;
    // Consulta.
    query?: VectorIndex["query"];
  };
  // R2.
  CORPUS?: Bucket;
}

// Adaptadores usados en la última petición.
let used: AdapterRecord[] = [];
// Llamadas de embeddings.
let embedCalls = 0;
// Llamadas de generación.
let generateCalls = 0;
// Si la petición trae una reserva válida.
let reservationOk = false;
// Vectores locales cargados de D1.
let localRows: Map<string, StoredVector> | null = null;

// Registra un adaptador usado y cuenta llamadas.
function note(adapter: AdapterRecord): void {
  // Lo añade.
  used.push(adapter);
  // Embeddings.
  if (adapter.id === "local-emulated-embedder" || adapter.id === "workers-ai-binding") {
    // Cuenta.
    embedCalls += 1;
  }
  // Generación.
  if (adapter.id === "local-emulated-generator" || adapter.id === "anthropic") {
    // Cuenta.
    generateCalls += 1;
  }
}

// Métrica que devuelve describe, si la hay.
function metricFromDescribe(value: unknown): string | null {
  // No es objeto.
  if (typeof value !== "object" || value === null) {
    // null.
    return null;
  }
  // config.
  const config = (value as { config?: unknown }).config;
  // No es objeto.
  if (typeof config !== "object" || config === null) {
    // null.
    return null;
  }
  // metric.
  const metric = (config as { metric?: unknown }).metric;
  // Texto o null.
  return typeof metric === "string" ? metric : null;
}

// Compara dos fichas en tiempo constante.
function sameToken(left: string, right: string): boolean {
  // Vacía o de otra longitud.
  if (left.length === 0 || left.length !== right.length) {
    // Distintas.
    return false;
  }
  // Acumulador de diferencias.
  let diff = 0;
  // Cada carácter.
  for (let index = 0; index < left.length; index += 1) {
    // XOR: 0 si son iguales.
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  // Iguales si no hubo diferencias.
  return diff === 0;
}

// Corpus empaquetado, comprobando que es el congelado.
function frozenCorpus(): PreparedCorpus {
  // Corpus.
  const body = rawCorpus as PreparedCorpus;
  // Otra preparación o contenido.
  if (body.preparationId !== FROZEN_PREPARATION || body.contentVersion !== FROZEN_CONTENT) {
    // Error.
    throw new Error("El corpus empaquetado no es el congelado.");
  }
  // Corpus.
  return body;
}

// Corpus de la tienda empaquetado, comprobando que es el congelado.
function frozenStoreCorpus(): PreparedCorpus {
  // Corpus.
  const body = rawStoreCorpus as PreparedCorpus;
  // Otra preparación o contenido.
  if (
    body.preparationId !== FROZEN_STORE_PREPARATION ||
    body.contentVersion !== FROZEN_STORE_CONTENT
  ) {
    // Error.
    throw new Error("El corpus de la tienda empaquetado no es el congelado.");
  }
  // Corpus.
  return body;
}

// Une los textos enviados al corpus congelado comprobando cada hash. El corpus se elige porque los
// ids enviados son exactamente los suyos: el curso o la tienda, nunca una mezcla.
function corpusWithBodies(
  documents: readonly { id?: unknown; body?: unknown }[],
): PreparedCorpus | string {
  // Ids enviados.
  const sent = new Set(documents.map((document) => document.id));
  // Corpus congelado cuyos ids coinciden con los enviados.
  const base = [frozenCorpus(), frozenStoreCorpus()].find(
    (corpus) =>
      corpus.documents.length === sent.size &&
      corpus.documents.every((document) => sent.has(document.id)),
  );
  // Ninguno coincide.
  if (base === undefined) {
    // Error.
    return "La ingesta no cubre los documentos congelados.";
  }
  // Texto por id.
  const byId = new Map<string, string>();
  // Cada documento.
  for (const document of documents) {
    // Sin id o sin texto.
    if (typeof document.id !== "string" || typeof document.body !== "string") {
      // Error.
      return "La ingesta trae un documento sin texto.";
    }
    // Lo guarda.
    byId.set(document.id, document.body);
  }
  // No cubre todos.
  if (byId.size !== base.documents.length) {
    // Error.
    return "La ingesta no cubre los documentos congelados.";
  }
  // Documentos con texto si el hash coincide.
  const next = base.documents.map((document) => {
    // Texto.
    const text = byId.get(document.id);
    // Falta o el hash no coincide.
    if (text === undefined || fnv1a64(text) !== document.sourceHash) {
      // null.
      return null;
    }
    // Documento con texto.
    return { ...document, body: text };
  });
  // Alguno no coincide.
  if (next.some((document) => document === null)) {
    // Error.
    return "Un documento no coincide con el hash congelado. No se ingesta.";
  }
  // Corpus con textos.
  return { ...base, documents: next.filter((document) => document !== null) };
}

// ¿Se piden bindings reales?
function remoteRequested(env: BridgeEnv): boolean {
  // BRIDGE_REMOTE=true.
  return env.BRIDGE_REMOTE === "true";
}

// Adaptadores que usará cada papel.
function configuredAdapters(env: BridgeEnv): AdapterRecord[] {
  // Remoto.
  if (remoteRequested(env)) {
    // Lista.
    const adapters: AdapterRecord[] = [];
    // probe o verify: Workers AI.
    if (env.BRIDGE_ROLE === "probe" || env.BRIDGE_ROLE === "verify") {
      // Añade.
      adapters.push({ id: "workers-ai-binding", remote: true, binding: "AI" });
    }
    // storage o verify: Vectorize y D1.
    if (env.BRIDGE_ROLE === "storage" || env.BRIDGE_ROLE === "verify") {
      // Vectorize.
      adapters.push({ id: "vectorize-binding", remote: true, binding: "VECTORIZE" });
      // D1.
      adapters.push({ id: "native-d1", remote: true, binding: "DB" });
    }
    // verify: Anthropic.
    if (env.BRIDGE_ROLE === "verify") {
      // Añade.
      adapters.push({ id: "anthropic", remote: true, binding: null });
    }
    // Lista.
    return adapters;
  }
  // Local: siempre el emulador de embeddings.
  const adapters: AdapterRecord[] = [
    { id: "local-emulated-embedder", remote: false, binding: null },
  ];
  // storage o verify: Vectorize emulado y D1.
  if (env.BRIDGE_ROLE === "storage" || env.BRIDGE_ROLE === "verify") {
    // Vectorize emulado.
    adapters.push({ id: "local-emulated-vectorize", remote: false, binding: null });
    // D1.
    adapters.push({ id: "native-d1", remote: false, binding: "DB" });
  }
  // verify: generador y evaluador emulados.
  if (env.BRIDGE_ROLE === "verify") {
    // Generador.
    adapters.push({ id: "local-emulated-generator", remote: false, binding: null });
    // Evaluador.
    adapters.push({ id: "local-emulated-evaluator", remote: false, binding: null });
  }
  // Lista.
  return adapters;
}

// Respuesta JSON sin caché.
function json(body: unknown, status = 200): Response {
  // Response.json.
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

// Crea las tablas si no existen.
async function ensureSchema(db: SqlDb): Promise<void> {
  // ¿Existe corpus_versions?
  const existing = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'corpus_versions'")
    .bind()
    .first<{ name: string }>();
  // Ya existe.
  if (existing !== null) {
    // Sale.
    return;
  }
  // Cada sentencia del esquema.
  for (const statement of schemaStatements()) {
    // La ejecuta.
    await db.exec(statement.replace(/\s+/g, " "));
  }
}

// Vectorize emulado con persistencia en D1.
async function localIndex(env: BridgeEnv): Promise<LocalVectorize> {
  // D1.
  const db = env.DB;
  // Nombre del índice.
  const name = env.BRIDGE_INDEX_NAME ?? "";
  // Falta algo.
  if (db === undefined || name.length === 0) {
    // Error.
    throw new Error("El puente local no tiene D1 o el nombre del índice.");
  }
  // Primera vez: carga los vectores.
  if (localRows === null) {
    // Tablas.
    await ensureSchema(db);
    // Vectores guardados.
    const loaded = await db
      .prepare(
        "SELECT id, values_json AS valuesJson, metadata_json AS metadataJson FROM local_vector_store",
      )
      .bind()
      .all<{ id: string; valuesJson: string; metadataJson: string }>();
    // Mapa en memoria.
    localRows = new Map();
    // Cada fila.
    for (const row of loaded.results) {
      // Valores.
      const values = JSON.parse(row.valuesJson) as number[];
      // Metadatos.
      const metadata = JSON.parse(row.metadataJson) as Record<string, string>;
      // Si son válidos.
      if (Array.isArray(values)) {
        // Los guarda.
        localRows.set(row.id, { values, metadata });
      }
    }
  }
  // Vectores.
  const rows = localRows;
  // Índice emulado que persiste en D1.
  return createLocalVectorize({
    name,
    dimensions: LOCAL_EMULATED_DIMENSIONS,
    rows,
    // Guarda el estado actual del recorrido para que los resultados sobrevivan a una interrupción.
    persist: async (id, values, metadata) => {
      // INSERT o UPDATE.
      await db
        .prepare(
          `INSERT INTO local_vector_store (id, values_json, metadata_json) VALUES (?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET values_json = excluded.values_json, metadata_json = excluded.metadata_json`,
        )
        .bind(id, JSON.stringify(values), JSON.stringify(metadata))
        .run();
    },
  });
}

// Ejecutor de embeddings emulado.
function localEmbedder(env: BridgeEnv): EmbeddingRunner {
  // Con el método run.
  return {
    // Ejecuta la operación del puerto y devuelve su resultado al llamador.
    async run(model, input) {
      // En remoto no se emula.
      if (remoteRequested(env)) {
        // Error.
        throw new Error("La ruta remota no puede usar el emulador.");
      }
      // Solo BGE-M3.
      if (model !== BGE_M3_MODEL) {
        // Error.
        throw new Error("El emulador solo acepta la interfaz documentada de BGE-M3.");
      }
      // Registra.
      note({ id: "local-emulated-embedder", remote: false, binding: null });
      // Vectores emulados.
      return {
        data: input.text.map((text) => localEmulatedEmbed(text)),
        providerRevision: null,
      };
    },
  };
}

// ¿Id de reserva válido? (rN).
function reservationId(value: unknown): boolean {
  // Formato.
  return typeof value === "string" && /^r[0-9]+$/.test(value);
}

// Textos válidos: de 1 a 80, cada uno de 1 a 4.000 caracteres.
function textsOf(value: unknown): string[] | null {
  // No es lista o tamaño inválido.
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) {
    // null.
    return null;
  }
  // Solo textos.
  const texts = value.filter((item): item is string => typeof item === "string");
  // Alguno no es texto o tiene otra longitud.
  if (
    texts.length !== value.length ||
    texts.some((text) => text.length < 1 || text.length > 4_000)
  ) {
    // null.
    return null;
  }
  // Textos.
  return texts;
}

// Matriz de números finitos.
function matrixOf(value: unknown): number[][] | null {
  // No es lista.
  if (!Array.isArray(value)) {
    // null.
    return null;
  }
  // Filas.
  const rows: number[][] = [];
  // Cada fila.
  for (const row of value) {
    // Fila inválida.
    if (
      !Array.isArray(row) ||
      row.some((item) => typeof item !== "number" || !Number.isFinite(item))
    ) {
      // null.
      return null;
    }
    // La guarda.
    rows.push(row);
  }
  // Matriz.
  return rows;
}

// Operación embed: vectores reales o emulados.
async function embed(
  env: BridgeEnv,
  body: { reservationId?: unknown; texts?: unknown },
): Promise<Response> {
  // Sin reserva.
  if (!reservationId(body.reservationId)) {
    // 400.
    return json({ ok: false, reason: "Falta la reserva. No se llama al proveedor." }, 400);
  }
  // Textos.
  const texts = textsOf(body.texts);
  // Inválidos.
  if (texts === null) {
    // 400.
    return json({ ok: false, reason: "La sonda no tiene textos válidos." }, 400);
  }
  // Remoto.
  if (remoteRequested(env)) {
    // Sin Workers AI.
    if (env.AI === undefined) {
      // 400 sin emular.
      return json(
        { ok: false, reason: "El binding AI no está conectado. No se usa el emulador." },
        400,
      );
    }
    // Llama a BGE-M3.
    const result = await env.AI.run(BGE_M3_MODEL, { text: texts });
    // Registra.
    note({ id: "workers-ai-binding", remote: true, binding: "AI" });
    // Vectores.
    const data =
      typeof result === "object" &&
      result !== null &&
      "data" in result &&
      Array.isArray(result.data)
        ? result.data
        : null;
    // Revisión del proveedor.
    const revision =
      typeof result === "object" &&
      result !== null &&
      "providerRevision" in result &&
      typeof result.providerRevision === "string"
        ? result.providerRevision
        : null;
    // Sin vectores.
    if (data === null) {
      // 502.
      return json({ ok: false, reason: "respuesta de embedding inválida" }, 502);
    }
    // Vectores y adaptador.
    return json({ ok: true, vectors: data, providerRevision: revision, adapter: used.at(-1) });
  }
  // Local: vectores emulados.
  const vectors = texts.map((text) => localEmulatedEmbed(text));
  // Registra.
  note({ id: "local-emulated-embedder", remote: false, binding: null });
  // Vectores.
  return json({
    ok: true,
    vectors,
    providerRevision: null,
    adapter: { id: "local-emulated-embedder", remote: false, binding: null },
  });
}

// Operación describe: métrica, dimensiones e índices de metadatos.
async function describe(env: BridgeEnv): Promise<Response> {
  // Remoto.
  if (remoteRequested(env)) {
    // Sin Vectorize.
    if (env.VECTORIZE === undefined) {
      // 400.
      return json({ ok: false, reason: "Falta el binding Vectorize. No se emula." }, 400);
    }
    // Describe.
    const info = await env.VECTORIZE.describe();
    // Métrica o la verificada.
    const metric =
      info.config !== undefined && typeof info.config.metric === "string"
        ? info.config.metric
        : (env.BRIDGE_VERIFIED_METRIC ?? null);
    // Datos del índice remoto.
    return json({
      ok: true,
      metric,
      dimensions: typeof info.dimensions === "number" ? info.dimensions : null,
      name: env.BRIDGE_INDEX_NAME ?? null,
      metadataIndexes: JSON.parse(env.BRIDGE_METADATA_INDEXES ?? "[]"),
      adapter: { id: "vectorize-binding", remote: true, binding: "VECTORIZE" },
    });
  }
  // Local: índice emulado.
  const index = await localIndex(env);
  // Describe.
  const info = await index.describe();
  // Datos del índice emulado.
  return json({
    ok: true,
    metric: info.config.metric,
    dimensions: info.dimensions,
    name: info.name,
    metadataIndexes: await index.listMetadataIndexes(),
    adapter: { id: "local-emulated-vectorize", remote: false, binding: null },
  });
}

// ¿Dos matrices iguales?
function sameMatrix(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
): boolean {
  // Mismas filas y valores.
  return (
    left.length === right.length &&
    left.every((row, index) => {
      // Fila correspondiente.
      const other = right[index];
      // Mismos valores.
      return (
        other !== undefined &&
        row.length === other.length &&
        row.every((value, column) => value === other[column])
      );
    })
  );
}

// Operación ingest: escribe el corpus congelado en D1, R2 y Vectorize.
async function ingest(
  env: BridgeEnv,
  body: { vectors?: unknown; documents?: unknown },
): Promise<Response> {
  // D1.
  const db = env.DB;
  // R2.
  const bucket = env.CORPUS;
  // Falta algo.
  if (db === undefined || bucket === undefined) {
    // 400.
    return json({ ok: false, reason: "Faltan D1 o R2. No se ingesta en memoria." }, 400);
  }
  // Tablas.
  await ensureSchema(db);
  // ¿Remoto?
  const remote = remoteRequested(env);
  // Dimensiones.
  const dimensions = remote ? Number(env.EMBEDDING_DIMENSIONS) : LOCAL_EMULATED_DIMENSIONS;
  // Inválidas.
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    // 400.
    return json({ ok: false, reason: "No hay una dimensión de esta ruta." }, 400);
  }
  // Corpus con los textos enviados.
  const withBodies = corpusWithBodies(
    Array.isArray(body.documents) ? (body.documents as { id?: unknown; body?: unknown }[]) : [],
  );
  // Error.
  if (typeof withBodies === "string") {
    // 400.
    return json({ ok: false, reason: withBodies }, 400);
  }
  // Manifiesto del corpus.
  const manifest = semanticManifest(withBodies, dimensions);
  // Nombre esperado del índice.
  const expectedName = vectorizeIndexName(manifest.profileId);
  // Otro nombre.
  if (env.BRIDGE_INDEX_NAME !== expectedName) {
    // 400.
    return json({ ok: false, reason: "El nombre del índice no es el del perfil congelado." }, 400);
  }
  // Vectores enviados.
  const supplied = matrixOf(body.vectors);
  // Inválidos.
  if (supplied === null) {
    // 400.
    return json({ ok: false, reason: "La ingesta no trae una matriz finita." }, 400);
  }
  // Local.
  if (!remote) {
    // Vectores esperados del emulador.
    const expected = manifest.chunks.map((chunk) => localEmulatedEmbed(chunk.text));
    // No coinciden.
    if (!sameMatrix(supplied, expected)) {
      // 400.
      return json(
        {
          ok: false,
          reason: "Los vectores no salen del emulador local. No se reutiliza otra caché.",
        },
        400,
      );
    }
  }
  // Índice emulado o null.
  const index = remote ? null : await localIndex(env);
  // Remoto sin Vectorize.
  if (remote && env.VECTORIZE === undefined) {
    // 400.
    return json({ ok: false, reason: "Falta Vectorize remoto. No se emula." }, 400);
  }
  // Escrituras.
  let upserts = 0;
  // Error de Vectorize.
  let vectorError: string | null = null;
  // Vectorize emulado o real con errores registrados.
  const vectorBinding = index
    ? // Con índice local: delega en el emulador.
      {
        // Escribe un lote en el emulador.
        upsert: async (
          batch: { id: string; values: number[]; metadata: Record<string, string> }[],
        ) => index.upsert(batch),
        // Lee de vuelta y describe el índice.
        getByIds: (ids: string[]) => index.getByIds(ids),
        // Entrega las propiedades del índice que el recorrido utiliza para verificar compatibilidad.
        describe: () => index.describe(),
      }
    : // Sin índice local: usa el binding remoto y guarda el texto del error para diagnosticar.
      {
        // Escribe en el binding remoto y anota el error si falla.
        upsert: async (
          batch: { id: string; values: number[]; metadata: Record<string, string> }[],
        ) => {
          // Captura el error.
          try {
            // Escribe.
            const result = await env.VECTORIZE?.upsert(batch);
            // Id de mutación.
            return { mutationId: result?.mutationId ?? "" };
          } catch (error) {
            // Mensaje sin claves.
            vectorError = (error instanceof Error ? error.message : "Vectorize binding failed")
              .replace(/sk-or-v1-[A-Za-z0-9]+/g, "[REDACTED]")
              .slice(0, 300);
            // Propaga.
            throw error;
          }
        },
        // Lee vectores por identificador para comprobar presencia, valores y metadatos.
        getByIds: async (ids: string[]) => {
          // Captura el error.
          try {
            // Lee.
            return (await env.VECTORIZE?.getByIds(ids)) ?? [];
          } catch (error) {
            // Mensaje.
            vectorError = `read: ${error instanceof Error ? error.message : "unknown"}`.slice(
              0,
              300,
            );
            // Propaga.
            throw error;
          }
        },
        // Entrega las propiedades del índice que el recorrido utiliza para verificar compatibilidad.
        describe: () => env.VECTORIZE?.describe() ?? Promise.resolve({}),
      };
  // Bindings para la ingesta.
  const bindings: IngestBindings = {
    CORPUS: bucket,
    DB: db,
    VECTORIZE: {
      // Inserta o actualiza el lote de vectores por sus identificadores.
      upsert: async (batch) => {
        // Cuenta.
        upserts += 1;
        // Escribe.
        return vectorBinding.upsert(
          // Copia los valores a un array normal antes de enviarlos.
          batch.map((vector) => ({
            id: vector.id,
            values: [...vector.values],
            metadata: vector.metadata,
          })),
        );
      },
      // Lectura de vuelta y descripción del índice.
      getByIds: (ids) => vectorBinding.getByIds(ids),
      // Entrega las propiedades del índice que el recorrido utiliza para verificar compatibilidad.
      describe: () => vectorBinding.describe(),
    },
    // Índices de metadatos: del emulador o de la variable que leyó Wrangler.
    listMetadataIndexes: async () =>
      index === null
        ? JSON.parse(env.BRIDGE_METADATA_INDEXES ?? "[]")
        : index.listMetadataIndexes(),
  };
  // Métrica.
  const metric =
    metricFromDescribe(await vectorBinding.describe()) ??
    (remote ? (env.BRIDGE_VERIFIED_METRIC ?? null) : null);
  // Diario de la ingesta.
  const journal = await loadBoundJournal(db, manifest.preparationId, manifest.profileId);
  // Primera pasada.
  let result = await runBoundIngestion(bindings, manifest, supplied, journal, {
    metric,
    reportedName: env.BRIDGE_INDEX_NAME,
    expectedIndexName: expectedName,
  });
  // Lecturas de visibilidad.
  let polls = 0;
  // Hasta dos más.
  while (result.phase === "pending-visibility" && polls < 2) {
    // Cuenta.
    polls += 1;
    // Otra pasada.
    result = await runBoundIngestion(bindings, manifest, supplied, result.journal, {
      metric,
      reportedName: env.BRIDGE_INDEX_NAME,
      expectedIndexName: expectedName,
    });
  }
  // Elemento fallido.
  const failed = result.journal.find((item) => item.outcome === "failed");
  // Resultado.
  return json({
    // ok si quedó lista o pendiente de visibilidad (no es un fallo).
    ok: result.phase === "ready" || result.phase === "pending-visibility",
    phase: result.phase,
    // Perfil, número de escrituras y de lecturas de vuelta.
    profileId: manifest.profileId,
    upserts,
    polls,
    // Primer error y diagnóstico del binding.
    error: failed?.error ?? null,
    diagnostic: vectorError,
    key: failed?.key ?? null,
    // Qué adaptador se usó de verdad: Vectorize remoto o el emulado.
    adapter: remote
      ? { id: "vectorize-binding", remote: true, binding: "VECTORIZE" }
      : { id: "local-emulated-vectorize", remote: false, binding: null },
  });
}

// Operación select-active: activa un perfil y lo comprueba leyendo D1.
async function selectActive(env: BridgeEnv, body: { profileId?: unknown }): Promise<Response> {
  // D1.
  const db = env.DB;
  // Falta D1 o el perfil.
  if (db === undefined || typeof body.profileId !== "string") {
    // 400.
    return json({ ok: false, reason: "No hay D1 para seleccionar el perfil." }, 400);
  }
  // SQL.
  let sql: string;
  // Valida el id.
  try {
    // SQL de selección.
    sql = activeSelectionSql(body.profileId);
  } catch {
    // 400.
    return json({ ok: false, reason: "El identificador de perfil no es válido." }, 400);
  }
  // Ejecuta.
  await db.exec(sql.replace(/\s+/g, " "));
  // Perfil activo.
  const row = await db
    .prepare("SELECT id FROM index_profiles WHERE active = 1")
    .bind()
    .first<{ id: string }>();
  // Id.
  const activeId = row?.id ?? null;
  // Resultado.
  return json({
    ok: activeId === body.profileId,
    activeId,
    summary:
      activeId === body.profileId
        ? "perfil activo comprobado por lectura final"
        : "La lectura final no prueba el perfil activo.",
    adapter: { id: "native-d1", remote: remoteRequested(env), binding: "DB" },
  });
}

// Chat sin red: app con modelo, embeddings y Vectorize emulados.
async function offlineChat(request: Request, env: BridgeEnv): Promise<Response> {
  // Manifiesto.
  const manifest = semanticManifest(frozenCorpus(), LOCAL_EMULATED_DIMENSIONS);
  // Embeddings emulados.
  const embedder = localEmbedder(env);
  // Índice emulado.
  const index = await localIndex(env);
  // App con modelo y puertos CRAG emulados.
  const app = createApp({
    // Modelo emulado que solo responde si hay reserva.
    languageModel: localEmulatedLanguageModel({
      note,
      // Expone el resultado de la reserva que condiciona las llamadas posteriores.
      reservationOk: () => reservationOk,
    }),
    // Puertos CRAG emulados sobre el índice local.
    cragPorts: localEmulatedCragPorts({
      signal: request.signal,
      // Alcance fijo del puente: programa, corpus y perfil del manifiesto.
      scope: {
        runId: "bridge",
        audience: "program",
        corpusVersion: manifest.preparationId,
        profileId: manifest.profileId,
        embeddingLabel: "local-emulated-token-hash-v1",
      },
      // Embeddings, índice, D1 y dimensión del emulador.
      embedder,
      index,
      database: env.DB as never,
      dimensions: LOCAL_EMULATED_DIMENSIONS,
      // Reserva y registro de adaptadores.
      reservationOk: () => reservationOk,
      note,
    }),
  });
  // Atiende la petición con los bindings emulados.
  return app.fetch(request, {
    ...env,
    AI: embedder,
    VECTORIZE: index,
  } as never);
}

// Punto de entrada del puente.
export async function handleBridgeRequest(request: Request, env: BridgeEnv): Promise<Response> {
  // URL.
  let url: URL;
  // URL inválida.
  try {
    // La interpreta.
    url = new URL(request.url);
  } catch {
    // 404.
    return new Response(null, { status: 404 });
  }
  // Solo 127.0.0.1.
  if (url.hostname !== "127.0.0.1") {
    // 404.
    return new Response(null, { status: 404 });
  }
  // Ficha esperada.
  const expected = env.BRIDGE_TOKEN ?? "";
  // Ficha recibida.
  const presented = request.headers.get("x-thepower-bridge") ?? "";
  // No coincide.
  if (!sameToken(presented, expected)) {
    // 404.
    return new Response(null, { status: 404 });
  }
  // GET /bridge/ready: papel y adaptadores.
  if (request.method === "GET" && url.pathname === "/bridge/ready") {
    // Estado.
    return json({
      ok: true,
      bind: "127.0.0.1",
      role: env.BRIDGE_ROLE ?? "",
      adapters: configuredAdapters(env),
    });
  }
  // GET /bridge/used: adaptadores usados.
  if (request.method === "GET" && url.pathname === "/bridge/used") {
    // Registro.
    return json({ adapters: used, embedCalls, generateCalls });
  }
  // verify: peticiones a /api/ de la app.
  if (env.BRIDGE_ROLE === "verify" && url.pathname.startsWith("/api/")) {
    // Reinicia el registro.
    used = [];
    // Reinicia.
    embedCalls = 0;
    // Reinicia.
    generateCalls = 0;
    // ¿Reserva válida?
    reservationOk = reservationId(request.headers.get("x-thepower-reservation"));
    // Remoto.
    if (remoteRequested(env)) {
      // Faltan bindings.
      if (env.AI === undefined || env.VECTORIZE === undefined || env.DB === undefined) {
        // 409.
        return json(
          { ok: false, reason: "Faltan bindings nativos. No se usa el emulador ni otro RAG." },
          409,
        );
      }
      // Cuerpo.
      let payload: {
        // Modo.
        mode?: string;
        // Audiencia.
        audience?: string;
        // Mensajes.
        messages?: { parts?: { text?: string }[] }[];
      };
      // Lee el cuerpo.
      try {
        // Clon.
        payload = await request.clone().json();
      } catch {
        // Sin JSON: la app lo rechazará.
        return createApp().fetch(request, env as never);
      }
      // ¿Aclaración sin llamadas? (calendario en CRAG general).
      const zeroCallClarify =
        payload.mode === "crag" &&
        payload.audience === "program" &&
        isScheduleQuestion(
          payload.messages
            ?.at(-1)
            ?.parts?.map((p) => p.text ?? "")
            .join("") ?? "",
        );
      // Sin reserva y con llamadas.
      if (!reservationOk && !zeroCallClarify) {
        // 400.
        return json({ ok: false, reason: "Falta la reserva. No se llama al proveedor." }, 400);
      }
      // Sesión de gasto pequeña para la verificación.
      const allowance = createAllowanceLedger({
        maxSpendUsd: 0.1,
        maxGenerativeCalls: payload.mode === "crag" ? 2 : 1,
        maxEmbeddingCalls: 1,
        prices: {
          embeddingUsdPerMillionInput: 0.0118,
          generativeUsdPerMillionInput: 0.2,
          generativeUsdPerMillionOutput: 1,
        },
      });
      // Workers AI real.
      const remoteAI = env.AI;
      // Vectorize real.
      const remoteIndex = env.VECTORIZE;
      // App con registro de cada llamada.
      return createApp({
        allowance,
        // Registra que este recorrido llegó al proveedor para distinguirlo de un plan sin red.
        onProviderCall: () => note({ id: "anthropic", remote: true, binding: null }),
      }).fetch(request, {
        ...env,
        AI: {
          // Ejecuta la operación del puerto y devuelve su resultado al llamador.
          run: async (model: string, input: { text: string[] }) => {
            // Registra.
            note({ id: "workers-ai-binding", remote: true, binding: "AI" });
            // Llama.
            return remoteAI.run(model as typeof BGE_M3_MODEL, input);
          },
        },
        VECTORIZE: {
          ...remoteIndex,
          // Ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
          query: async (vector: number[], options: Parameters<VectorIndex["query"]>[1]) => {
            // Registra.
            note({ id: "vectorize-binding", remote: true, binding: "VECTORIZE" });
            // Consulta.
            return remoteIndex.query!(vector, options);
          },
        },
      } as never);
    }
    // Local: chat emulado.
    return offlineChat(request, env);
  }
  // Otro método o ruta.
  if (request.method !== "POST" || url.pathname !== "/bridge") {
    // 404.
    return new Response(null, { status: 404 });
  }
  // Cuerpo.
  let body: {
    // Operación.
    op?: unknown;
    // Reserva.
    reservationId?: unknown;
    // Textos.
    texts?: unknown;
    // Vectores.
    vectors?: unknown;
    // Perfil.
    profileId?: unknown;
  };
  // Lee el JSON.
  try {
    // Cuerpo.
    body = (await request.json()) as typeof body;
  } catch {
    // 400.
    return json({ ok: false, reason: "El cuerpo no es JSON." }, 400);
  }
  // Reinicia el registro.
  used = [];
  // Reinicia.
  embedCalls = 0;
  // Reinicia.
  generateCalls = 0;
  // query: consulta directa a Vectorize real.
  if (body.op === "query") {
    // Vector.
    const vector = (body as { vector?: number[] }).vector;
    // Audiencia.
    const audience = (body as { audience?: string }).audience;
    // Remoto, con consulta, vector válido y audiencia conocida.
    if (
      !remoteRequested(env) ||
      !env.VECTORIZE?.query ||
      !Array.isArray(vector) ||
      vector.length !== Number(env.EMBEDDING_DIMENSIONS) ||
      vector.some((v) => !Number.isFinite(v)) ||
      !["program", "M/J", "L/X"].includes(audience ?? "")
    )
      // 400.
      return json({ ok: false, reason: "Consulta inválida" }, 400);
    // Versión pedida: solo una de las dos congeladas; sin valor, la del curso.
    const requestedVersion = (body as { corpusVersion?: string }).corpusVersion;
    // Versión del filtro.
    const corpusVersion =
      requestedVersion === FROZEN_STORE_PREPARATION ? FROZEN_STORE_PREPARATION : FROZEN_PREPARATION;
    // Filtro por corpus, perfil y audiencia.
    const filter = {
      corpusVersion,
      profileId: (body as { profileId?: string }).profileId ?? "",
      audience: { $in: audience === "program" ? ["program"] : ["program", audience ?? ""] },
    };
    // Consulta.
    const hits = await env.VECTORIZE.query(vector, { topK: 10, returnMetadata: "all", filter });
    // Resultados.
    return json({ ok: true, hits });
  }
  // embed.
  if (body.op === "embed") {
    // Embeddings.
    return embed(env, body);
  }
  // describe.
  if (body.op === "describe") {
    // Describe.
    return describe(env);
  }
  // ingest.
  if (body.op === "ingest") {
    // Ingesta.
    return ingest(env, body);
  }
  // select-active.
  if (body.op === "select-active") {
    // Selección.
    return selectActive(env, body);
  }
  // Otra: 400.
  return json({ ok: false, reason: "operación no admitida" }, 400);
}

// Worker con fetch.
export default {
  // Recibe la petición del runtime Worker y la delega al manejador con sus bindings de entorno.
  async fetch(request: Request, env: BridgeEnv): Promise<Response> {
    // Delega.
    return handleBridgeRequest(request, env);
  },
};
