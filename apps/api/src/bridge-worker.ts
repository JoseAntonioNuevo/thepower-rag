import rawCorpus from "../../../corpus/prepared/corpus.json";
import {
  LOCAL_EMULATED_DIMENSIONS,
  activeSelectionSql,
  fnv1a64,
  localEmulatedEmbed,
  semanticManifest,
  isScheduleQuestion,
  createAllowanceLedger,
  vectorizeIndexName,
  type AdapterRecord,
  type PreparedCorpus,
} from "@thepower-rag/core";
import { createApp } from "./app";
import { loadBoundJournal, runBoundIngestion, type IngestBindings } from "./ingest-run";
import { localEmulatedCragPorts } from "./local-crag-ports";
import { localEmulatedLanguageModel } from "./local-emulated-model";
import { schemaStatements } from "./local-schema";
import { createLocalVectorize, type LocalVectorize, type StoredVector } from "./local-vectorize";
import type { VectorIndex } from "./stores";
import { BGE_M3_MODEL, type EmbeddingRunner } from "./vectors";

const FROZEN_PREPARATION = "c3a59a406888b";
const FROZEN_CONTENT = "cc037ef0bb1f7";

interface SqlDb {
  exec(query: string): Promise<unknown>;
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
      all<T>(): Promise<{ results: T[] }>;
    };
  };
  batch(statements: unknown[]): Promise<unknown>;
}

interface Bucket {
  put(key: string, body: string | Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

export interface BridgeEnv {
  BRIDGE_TOKEN?: string;
  BRIDGE_ROLE?: string;
  BRIDGE_REMOTE?: string;
  BRIDGE_INDEX_NAME?: string;
  BRIDGE_VERIFIED_METRIC?: string;
  BRIDGE_METADATA_INDEXES?: string;
  APP_MODE?: string;
  ANTHROPIC_API_KEY?: string;
  MODEL_ID?: string;
  EVALUATOR_MODEL_ID?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_DIMENSIONS?: string;
  CORPUS_VERSION?: string;
  INDEX_PROFILE?: string;
  VECTOR_METRIC?: string;
  MIN_RETRIEVAL_SCORE?: string;
  AI?: EmbeddingRunner;
  DB?: SqlDb;
  VECTORIZE?: {
    upsert(vectors: { id: string; values: number[]; metadata: Record<string, string> }[]): Promise<{
      mutationId?: string;
    }>;
    getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, unknown> }[]>;
    describe(): Promise<{
      dimensions?: number;
      vectorCount?: number;
      config?: { metric?: string };
    }>;
    query?: VectorIndex["query"];
  };
  CORPUS?: Bucket;
}

let used: AdapterRecord[] = [];
let embedCalls = 0;
let generateCalls = 0;
let reservationOk = false;
let localRows: Map<string, StoredVector> | null = null;

function note(adapter: AdapterRecord): void {
  used.push(adapter);
  if (adapter.id === "local-emulated-embedder" || adapter.id === "workers-ai-binding") {
    embedCalls += 1;
  }
  if (adapter.id === "local-emulated-generator" || adapter.id === "anthropic") {
    generateCalls += 1;
  }
}

function metricFromDescribe(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const config = (value as { config?: unknown }).config;
  if (typeof config !== "object" || config === null) {
    return null;
  }
  const metric = (config as { metric?: unknown }).metric;
  return typeof metric === "string" ? metric : null;
}

function sameToken(left: string, right: string): boolean {
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

function frozenCorpus(): PreparedCorpus {
  const body = rawCorpus as PreparedCorpus;
  if (body.preparationId !== FROZEN_PREPARATION || body.contentVersion !== FROZEN_CONTENT) {
    throw new Error("El corpus empaquetado no es el congelado.");
  }
  return body;
}

function corpusWithBodies(
  documents: readonly { id?: unknown; body?: unknown }[],
): PreparedCorpus | string {
  const base = frozenCorpus();
  const byId = new Map<string, string>();
  for (const document of documents) {
    if (typeof document.id !== "string" || typeof document.body !== "string") {
      return "La ingesta trae un documento sin texto.";
    }
    byId.set(document.id, document.body);
  }
  if (byId.size !== base.documents.length) {
    return "La ingesta no cubre los documentos congelados.";
  }
  const next = base.documents.map((document) => {
    const text = byId.get(document.id);
    if (text === undefined || fnv1a64(text) !== document.sourceHash) {
      return null;
    }
    return { ...document, body: text };
  });
  if (next.some((document) => document === null)) {
    return "Un documento no coincide con el hash congelado. No se ingesta.";
  }
  return { ...base, documents: next.filter((document) => document !== null) };
}

function remoteRequested(env: BridgeEnv): boolean {
  return env.BRIDGE_REMOTE === "true";
}

function configuredAdapters(env: BridgeEnv): AdapterRecord[] {
  if (remoteRequested(env)) {
    const adapters: AdapterRecord[] = [];
    if (env.BRIDGE_ROLE === "probe" || env.BRIDGE_ROLE === "verify") {
      adapters.push({ id: "workers-ai-binding", remote: true, binding: "AI" });
    }
    if (env.BRIDGE_ROLE === "storage" || env.BRIDGE_ROLE === "verify") {
      adapters.push({ id: "vectorize-binding", remote: true, binding: "VECTORIZE" });
      adapters.push({ id: "native-d1", remote: true, binding: "DB" });
    }
    if (env.BRIDGE_ROLE === "verify") {
      adapters.push({ id: "anthropic", remote: true, binding: null });
    }
    return adapters;
  }
  const adapters: AdapterRecord[] = [
    { id: "local-emulated-embedder", remote: false, binding: null },
  ];
  if (env.BRIDGE_ROLE === "storage" || env.BRIDGE_ROLE === "verify") {
    adapters.push({ id: "local-emulated-vectorize", remote: false, binding: null });
    adapters.push({ id: "native-d1", remote: false, binding: "DB" });
  }
  if (env.BRIDGE_ROLE === "verify") {
    adapters.push({ id: "local-emulated-generator", remote: false, binding: null });
    adapters.push({ id: "local-emulated-evaluator", remote: false, binding: null });
  }
  return adapters;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function ensureSchema(db: SqlDb): Promise<void> {
  const existing = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'corpus_versions'")
    .bind()
    .first<{ name: string }>();
  if (existing !== null) {
    return;
  }
  for (const statement of schemaStatements()) {
    await db.exec(statement.replace(/\s+/g, " "));
  }
}

async function localIndex(env: BridgeEnv): Promise<LocalVectorize> {
  const db = env.DB;
  const name = env.BRIDGE_INDEX_NAME ?? "";
  if (db === undefined || name.length === 0) {
    throw new Error("El puente local no tiene D1 o el nombre del índice.");
  }
  if (localRows === null) {
    await ensureSchema(db);
    const loaded = await db
      .prepare(
        "SELECT id, values_json AS valuesJson, metadata_json AS metadataJson FROM local_vector_store",
      )
      .bind()
      .all<{ id: string; valuesJson: string; metadataJson: string }>();
    localRows = new Map();
    for (const row of loaded.results) {
      const values = JSON.parse(row.valuesJson) as number[];
      const metadata = JSON.parse(row.metadataJson) as Record<string, string>;
      if (Array.isArray(values)) {
        localRows.set(row.id, { values, metadata });
      }
    }
  }
  const rows = localRows;
  return createLocalVectorize({
    name,
    dimensions: LOCAL_EMULATED_DIMENSIONS,
    rows,
    persist: async (id, values, metadata) => {
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

function localEmbedder(env: BridgeEnv): EmbeddingRunner {
  return {
    async run(model, input) {
      if (remoteRequested(env)) {
        throw new Error("La ruta remota no puede usar el emulador.");
      }
      if (model !== BGE_M3_MODEL) {
        throw new Error("El emulador solo acepta la interfaz documentada de BGE-M3.");
      }
      note({ id: "local-emulated-embedder", remote: false, binding: null });
      return {
        data: input.text.map((text) => localEmulatedEmbed(text)),
        providerRevision: null,
      };
    },
  };
}

function reservationId(value: unknown): boolean {
  return typeof value === "string" && /^r[0-9]+$/.test(value);
}

function textsOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 80) {
    return null;
  }
  const texts = value.filter((item): item is string => typeof item === "string");
  if (
    texts.length !== value.length ||
    texts.some((text) => text.length < 1 || text.length > 4_000)
  ) {
    return null;
  }
  return texts;
}

function matrixOf(value: unknown): number[][] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rows: number[][] = [];
  for (const row of value) {
    if (
      !Array.isArray(row) ||
      row.some((item) => typeof item !== "number" || !Number.isFinite(item))
    ) {
      return null;
    }
    rows.push(row);
  }
  return rows;
}

async function embed(
  env: BridgeEnv,
  body: { reservationId?: unknown; texts?: unknown },
): Promise<Response> {
  if (!reservationId(body.reservationId)) {
    return json({ ok: false, reason: "Falta la reserva. No se llama al proveedor." }, 400);
  }
  const texts = textsOf(body.texts);
  if (texts === null) {
    return json({ ok: false, reason: "La sonda no tiene textos válidos." }, 400);
  }
  if (remoteRequested(env)) {
    if (env.AI === undefined) {
      return json(
        { ok: false, reason: "El binding AI no está conectado. No se usa el emulador." },
        400,
      );
    }
    const result = await env.AI.run(BGE_M3_MODEL, { text: texts });
    note({ id: "workers-ai-binding", remote: true, binding: "AI" });
    const data =
      typeof result === "object" &&
      result !== null &&
      "data" in result &&
      Array.isArray(result.data)
        ? result.data
        : null;
    const revision =
      typeof result === "object" &&
      result !== null &&
      "providerRevision" in result &&
      typeof result.providerRevision === "string"
        ? result.providerRevision
        : null;
    if (data === null) {
      return json({ ok: false, reason: "respuesta de embedding inválida" }, 502);
    }
    return json({ ok: true, vectors: data, providerRevision: revision, adapter: used.at(-1) });
  }
  const vectors = texts.map((text) => localEmulatedEmbed(text));
  note({ id: "local-emulated-embedder", remote: false, binding: null });
  return json({
    ok: true,
    vectors,
    providerRevision: null,
    adapter: { id: "local-emulated-embedder", remote: false, binding: null },
  });
}

async function describe(env: BridgeEnv): Promise<Response> {
  if (remoteRequested(env)) {
    if (env.VECTORIZE === undefined) {
      return json({ ok: false, reason: "Falta el binding Vectorize. No se emula." }, 400);
    }
    const info = await env.VECTORIZE.describe();
    const metric =
      info.config !== undefined && typeof info.config.metric === "string"
        ? info.config.metric
        : (env.BRIDGE_VERIFIED_METRIC ?? null);
    return json({
      ok: true,
      metric,
      dimensions: typeof info.dimensions === "number" ? info.dimensions : null,
      name: env.BRIDGE_INDEX_NAME ?? null,
      metadataIndexes: JSON.parse(env.BRIDGE_METADATA_INDEXES ?? "[]"),
      adapter: { id: "vectorize-binding", remote: true, binding: "VECTORIZE" },
    });
  }
  const index = await localIndex(env);
  const info = await index.describe();
  return json({
    ok: true,
    metric: info.config.metric,
    dimensions: info.dimensions,
    name: info.name,
    metadataIndexes: await index.listMetadataIndexes(),
    adapter: { id: "local-emulated-vectorize", remote: false, binding: null },
  });
}

function sameMatrix(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        row.length === other.length &&
        row.every((value, column) => value === other[column])
      );
    })
  );
}

async function ingest(
  env: BridgeEnv,
  body: { vectors?: unknown; documents?: unknown },
): Promise<Response> {
  const db = env.DB;
  const bucket = env.CORPUS;
  if (db === undefined || bucket === undefined) {
    return json({ ok: false, reason: "Faltan D1 o R2. No se ingesta en memoria." }, 400);
  }
  await ensureSchema(db);
  const remote = remoteRequested(env);
  const dimensions = remote ? Number(env.EMBEDDING_DIMENSIONS) : LOCAL_EMULATED_DIMENSIONS;
  if (!Number.isInteger(dimensions) || dimensions < 1) {
    return json({ ok: false, reason: "No hay una dimensión de esta ruta." }, 400);
  }
  const withBodies = corpusWithBodies(
    Array.isArray(body.documents) ? (body.documents as { id?: unknown; body?: unknown }[]) : [],
  );
  if (typeof withBodies === "string") {
    return json({ ok: false, reason: withBodies }, 400);
  }
  const manifest = semanticManifest(withBodies, dimensions);
  const expectedName = vectorizeIndexName(manifest.profileId);
  if (env.BRIDGE_INDEX_NAME !== expectedName) {
    return json({ ok: false, reason: "El nombre del índice no es el del perfil congelado." }, 400);
  }
  const supplied = matrixOf(body.vectors);
  if (supplied === null) {
    return json({ ok: false, reason: "La ingesta no trae una matriz finita." }, 400);
  }
  if (!remote) {
    const expected = manifest.chunks.map((chunk) => localEmulatedEmbed(chunk.text));
    if (!sameMatrix(supplied, expected)) {
      return json(
        {
          ok: false,
          reason: "Los vectores no salen del emulador local. No se reutiliza otra caché.",
        },
        400,
      );
    }
  }
  const index = remote ? null : await localIndex(env);
  if (remote && env.VECTORIZE === undefined) {
    return json({ ok: false, reason: "Falta Vectorize remoto. No se emula." }, 400);
  }
  let upserts = 0;
  let vectorError: string | null = null;
  const vectorBinding = index
    ? {
        upsert: async (
          batch: { id: string; values: number[]; metadata: Record<string, string> }[],
        ) => index.upsert(batch),
        getByIds: (ids: string[]) => index.getByIds(ids),
        describe: () => index.describe(),
      }
    : {
        upsert: async (
          batch: { id: string; values: number[]; metadata: Record<string, string> }[],
        ) => {
          try {
            const result = await env.VECTORIZE?.upsert(batch);
            return { mutationId: result?.mutationId ?? "" };
          } catch (error) {
            vectorError = (error instanceof Error ? error.message : "Vectorize binding failed")
              .replace(/sk-or-v1-[A-Za-z0-9]+/g, "[REDACTED]")
              .slice(0, 300);
            throw error;
          }
        },
        getByIds: async (ids: string[]) => {
          try {
            return (await env.VECTORIZE?.getByIds(ids)) ?? [];
          } catch (error) {
            vectorError = `read: ${error instanceof Error ? error.message : "unknown"}`.slice(
              0,
              300,
            );
            throw error;
          }
        },
        describe: () => env.VECTORIZE?.describe() ?? Promise.resolve({}),
      };
  const bindings: IngestBindings = {
    CORPUS: bucket,
    DB: db,
    VECTORIZE: {
      upsert: async (batch) => {
        upserts += 1;
        return vectorBinding.upsert(
          batch.map((vector) => ({
            id: vector.id,
            values: [...vector.values],
            metadata: vector.metadata,
          })),
        );
      },
      getByIds: (ids) => vectorBinding.getByIds(ids),
      describe: () => vectorBinding.describe(),
    },
    listMetadataIndexes: async () =>
      index === null
        ? JSON.parse(env.BRIDGE_METADATA_INDEXES ?? "[]")
        : index.listMetadataIndexes(),
  };
  const metric =
    metricFromDescribe(await vectorBinding.describe()) ??
    (remote ? (env.BRIDGE_VERIFIED_METRIC ?? null) : null);
  const journal = await loadBoundJournal(db, manifest.preparationId, manifest.profileId);
  let result = await runBoundIngestion(bindings, manifest, supplied, journal, {
    metric,
    reportedName: env.BRIDGE_INDEX_NAME,
    expectedIndexName: expectedName,
  });
  let polls = 0;
  while (result.phase === "pending-visibility" && polls < 2) {
    polls += 1;
    result = await runBoundIngestion(bindings, manifest, supplied, result.journal, {
      metric,
      reportedName: env.BRIDGE_INDEX_NAME,
      expectedIndexName: expectedName,
    });
  }
  const failed = result.journal.find((item) => item.outcome === "failed");
  return json({
    ok: result.phase === "ready" || result.phase === "pending-visibility",
    phase: result.phase,
    profileId: manifest.profileId,
    upserts,
    polls,
    error: failed?.error ?? null,
    diagnostic: vectorError,
    key: failed?.key ?? null,
    adapter: remote
      ? { id: "vectorize-binding", remote: true, binding: "VECTORIZE" }
      : { id: "local-emulated-vectorize", remote: false, binding: null },
  });
}

async function selectActive(env: BridgeEnv, body: { profileId?: unknown }): Promise<Response> {
  const db = env.DB;
  if (db === undefined || typeof body.profileId !== "string") {
    return json({ ok: false, reason: "No hay D1 para seleccionar el perfil." }, 400);
  }
  let sql: string;
  try {
    sql = activeSelectionSql(body.profileId);
  } catch {
    return json({ ok: false, reason: "El identificador de perfil no es válido." }, 400);
  }
  await db.exec(sql.replace(/\s+/g, " "));
  const row = await db
    .prepare("SELECT id FROM index_profiles WHERE active = 1")
    .bind()
    .first<{ id: string }>();
  const activeId = row?.id ?? null;
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

async function offlineChat(request: Request, env: BridgeEnv): Promise<Response> {
  const manifest = semanticManifest(frozenCorpus(), LOCAL_EMULATED_DIMENSIONS);
  const embedder = localEmbedder(env);
  const index = await localIndex(env);
  const app = createApp({
    languageModel: localEmulatedLanguageModel({
      note,
      reservationOk: () => reservationOk,
    }),
    cragPorts: localEmulatedCragPorts({
      signal: request.signal,
      scope: {
        runId: "bridge",
        audience: "program",
        corpusVersion: manifest.preparationId,
        profileId: manifest.profileId,
        embeddingLabel: "local-emulated-token-hash-v1",
      },
      embedder,
      index,
      database: env.DB as never,
      dimensions: LOCAL_EMULATED_DIMENSIONS,
      reservationOk: () => reservationOk,
      note,
    }),
  });
  return app.fetch(request, {
    ...env,
    AI: embedder,
    VECTORIZE: index,
  } as never);
}

export async function handleBridgeRequest(request: Request, env: BridgeEnv): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (url.hostname !== "127.0.0.1") {
    return new Response(null, { status: 404 });
  }
  const expected = env.BRIDGE_TOKEN ?? "";
  const presented = request.headers.get("x-thepower-bridge") ?? "";
  if (!sameToken(presented, expected)) {
    return new Response(null, { status: 404 });
  }
  if (request.method === "GET" && url.pathname === "/bridge/ready") {
    return json({
      ok: true,
      bind: "127.0.0.1",
      role: env.BRIDGE_ROLE ?? "",
      adapters: configuredAdapters(env),
    });
  }
  if (request.method === "GET" && url.pathname === "/bridge/used") {
    return json({ adapters: used, embedCalls, generateCalls });
  }
  if (env.BRIDGE_ROLE === "verify" && url.pathname.startsWith("/api/")) {
    used = [];
    embedCalls = 0;
    generateCalls = 0;
    reservationOk = reservationId(request.headers.get("x-thepower-reservation"));
    if (remoteRequested(env)) {
      if (env.AI === undefined || env.VECTORIZE === undefined || env.DB === undefined) {
        return json(
          { ok: false, reason: "Faltan bindings nativos. No se usa el emulador ni otro RAG." },
          409,
        );
      }
      let payload: {
        mode?: string;
        audience?: string;
        messages?: { parts?: { text?: string }[] }[];
      };
      try {
        payload = await request.clone().json();
      } catch {
        return createApp().fetch(request, env as never);
      }
      const zeroCallClarify =
        payload.mode === "crag" &&
        payload.audience === "program" &&
        isScheduleQuestion(
          payload.messages
            ?.at(-1)
            ?.parts?.map((p) => p.text ?? "")
            .join("") ?? "",
        );
      if (!reservationOk && !zeroCallClarify) {
        return json({ ok: false, reason: "Falta la reserva. No se llama al proveedor." }, 400);
      }
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
      const remoteAI = env.AI;
      const remoteIndex = env.VECTORIZE;
      return createApp({
        allowance,
        onProviderCall: () => note({ id: "anthropic", remote: true, binding: null }),
      }).fetch(request, {
        ...env,
        AI: {
          run: async (model: string, input: { text: string[] }) => {
            note({ id: "workers-ai-binding", remote: true, binding: "AI" });
            return remoteAI.run(model as typeof BGE_M3_MODEL, input);
          },
        },
        VECTORIZE: {
          ...remoteIndex,
          query: async (vector: number[], options: Parameters<VectorIndex["query"]>[1]) => {
            note({ id: "vectorize-binding", remote: true, binding: "VECTORIZE" });
            return remoteIndex.query!(vector, options);
          },
        },
      } as never);
    }
    return offlineChat(request, env);
  }
  if (request.method !== "POST" || url.pathname !== "/bridge") {
    return new Response(null, { status: 404 });
  }
  let body: {
    op?: unknown;
    reservationId?: unknown;
    texts?: unknown;
    vectors?: unknown;
    profileId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ ok: false, reason: "El cuerpo no es JSON." }, 400);
  }
  used = [];
  embedCalls = 0;
  generateCalls = 0;
  if (body.op === "query") {
    const vector = (body as { vector?: number[] }).vector;
    const audience = (body as { audience?: string }).audience;
    if (
      !remoteRequested(env) ||
      !env.VECTORIZE?.query ||
      !Array.isArray(vector) ||
      vector.length !== Number(env.EMBEDDING_DIMENSIONS) ||
      vector.some((v) => !Number.isFinite(v)) ||
      !["program", "M/J", "L/X"].includes(audience ?? "")
    )
      return json({ ok: false, reason: "Consulta inválida" }, 400);
    const filter = {
      corpusVersion: FROZEN_PREPARATION,
      profileId: (body as { profileId?: string }).profileId ?? "",
      audience: { $in: audience === "program" ? ["program"] : ["program", audience ?? ""] },
    };
    const hits = await env.VECTORIZE.query(vector, { topK: 10, returnMetadata: "all", filter });
    return json({ ok: true, hits });
  }
  if (body.op === "embed") {
    return embed(env, body);
  }
  if (body.op === "describe") {
    return describe(env);
  }
  if (body.op === "ingest") {
    return ingest(env, body);
  }
  if (body.op === "select-active") {
    return selectActive(env, body);
  }
  return json({ ok: false, reason: "operación no admitida" }, 400);
}

export default {
  async fetch(request: Request, env: BridgeEnv): Promise<Response> {
    return handleBridgeRequest(request, env);
  },
};
