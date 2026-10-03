import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  OPERATION_BOUNDS,
  VECTORIZE_METADATA_INDEXES,
  classifyRuntime,
  createAllowanceLedger,
  planFits,
  cacheFromVectors,
  semanticManifest,
  usableForRemoteIndex,
  validateEmbeddingCache,
  vectorizeIndexName,
  vectorsFromCache,
  type AdapterRecord,
  type AllowanceLedger,
  type CorpusManifest,
  type EmbeddingCache,
  type PreparedCorpus,
} from "@thepower-rag/core";
import type { ActivationAuth, CommandOutcome } from "./activation";

export const PROBE_TEXTS = [
  "sonda sintetica uno del curso",
  "sonda sintetica dos del curso",
] as const;

export interface ManagementReceipt {
  metric: string | null;
  dimensions: number | null;
  name: string | null;
  metadataIndexes: readonly string[];
}

export interface CourseDataPlane {
  adapters(): readonly AdapterRecord[];
  embed(
    texts: readonly string[],
    reservationId: string,
  ): Promise<{
    vectors: number[][];
    providerRevision: string | null;
    adapter: AdapterRecord;
  }>;
  ingest(input: { manifest: CorpusManifest; vectors: number[][] }): Promise<{
    phase: string;
    upserts: number;
    profileId: string;
    adapter: AdapterRecord;
  }>;
  selectActive(profileId: string): Promise<{
    ok: boolean;
    summary: string;
    activeId: string | null;
    adapter: AdapterRecord;
  }>;
  management: ManagementReceipt;
}

export interface RuntimePaths {
  receiptDir: string;
  cacheDir: string;
  now: string;
}

function ledgerFor(
  auth: ActivationAuth,
  prices: {
    embeddingUsdPerMillionInput: number | null;
    generativeUsdPerMillionInput: number | null;
    generativeUsdPerMillionOutput: number | null;
  },
  limits?: { generative?: number; embedding?: number },
): AllowanceLedger {
  return createAllowanceLedger({
    maxSpendUsd: auth.maxSpendUsd ?? 0,
    maxGenerativeCalls: limits?.generative ?? 4,
    maxEmbeddingCalls: limits?.embedding ?? 128,
    prices,
  });
}

export async function writeAtomic(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${String(process.pid)}.tmp`,
  );
  await writeFile(temporary, body);
  await rename(temporary, file);
}

export function parseObservedEmbeddings(
  vectors: readonly (readonly number[])[],
): { ok: true; dimensions: number } | { ok: false; reason: string } {
  if (vectors.length !== PROBE_TEXTS.length) {
    return { ok: false, reason: "La sonda no devolvió una fila por texto." };
  }
  const width = vectors[0]?.length ?? 0;
  if (!Number.isInteger(width) || width < 1) {
    return { ok: false, reason: "La sonda no devolvió una dimensión observada." };
  }
  for (const row of vectors) {
    if (
      row.length !== width ||
      row.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      return { ok: false, reason: "La sonda devolvió una fila vacía, desigual o no finita." };
    }
  }
  return { ok: true, dimensions: width };
}

async function readCache(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function managementReady(
  management: ManagementReceipt,
  dimensions: number,
  indexName: string,
): { ok: true } | { ok: false; reason: string } {
  if (management.metric !== "cosine") {
    return {
      ok: false,
      reason: "La métrica del recibo administrativo no es cosine. No se inserta.",
    };
  }
  if (management.dimensions !== dimensions) {
    return {
      ok: false,
      reason: "La dimensión del índice no coincide con la observada. No se inserta.",
    };
  }
  if (management.name !== indexName) {
    return { ok: false, reason: "El nombre del índice no coincide con el perfil. No se inserta." };
  }
  const missing = VECTORIZE_METADATA_INDEXES.filter(
    (name) => !management.metadataIndexes.includes(name),
  );
  if (missing.length > 0) {
    return { ok: false, reason: "Faltan índices de metadatos. No se inserta." };
  }
  return { ok: true };
}

export async function executeProbe(input: {
  auth: ActivationAuth;
  plane: CourseDataPlane | null;
  allowance: AllowanceLedger;
  paths: RuntimePaths;
  accountId: string;
}): Promise<CommandOutcome> {
  if (input.plane === null) {
    return {
      ok: false,
      summary:
        "El puente local no está conectado. Wrangler 4.147.0 no tiene ai run y no se sustituye la sonda por el índice lexical.",
    };
  }
  const reserved = input.allowance.reserve({
    kind: "embedding",
    calls: PROBE_TEXTS.length,
    maxInputTokens: 64,
    maxOutputTokens: 0,
  });
  if (!reserved.ok) {
    return { ok: false, summary: reserved.reason, receipt: { embedCalls: 0 } };
  }
  let embedded: {
    vectors: number[][];
    providerRevision: string | null;
    adapter: AdapterRecord;
  };
  try {
    embedded = await input.plane.embed([...PROBE_TEXTS], reserved.id);
  } catch {
    input.allowance.settle(reserved.id, null);
    return {
      ok: false,
      summary: "La sonda falló. La reserva no se libera porque el cargo real es desconocido.",
      receipt: { embedCalls: 1 },
    };
  }
  input.allowance.settle(reserved.id, null);
  const parsed = parseObservedEmbeddings(embedded.vectors);
  if (!parsed.ok) {
    return { ok: false, summary: parsed.reason, receipt: { embedCalls: 1 } };
  }
  const classified = classifyRuntime([embedded.adapter]);
  const receipt = {
    at: input.paths.now,
    accountId: input.accountId,
    model: "@cf/baai/bge-m3",
    dimensions: parsed.dimensions,
    providerRevision: embedded.providerRevision,
    rows: embedded.vectors.length,
    measuredChargeUsd: null,
    provenance: classified.provenance,
    live: classified.live,
    usableForRemoteIndex: usableForRemoteIndex(classified.provenance),
    adapter: embedded.adapter,
  };
  await writeAtomic(
    path.join(input.paths.receiptDir, "probe-embeddings.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return {
    ok: true,
    summary:
      classified.provenance === "remote-binding"
        ? `dimensión observada ${String(parsed.dimensions)}`
        : `dimensión emulada ${String(parsed.dimensions)}. No sirve para crear un índice remoto.`,
    receipt,
  };
}

export async function executeIngest(input: {
  auth: ActivationAuth;
  corpus: PreparedCorpus;
  plane: CourseDataPlane | null;
  allowance: AllowanceLedger;
  paths: RuntimePaths;
  resumeProfileId?: string | null;
}): Promise<CommandOutcome> {
  if (input.plane === null) {
    return {
      ok: false,
      summary: "El puente local no está conectado. No se ingesta ni se usa el índice lexical.",
    };
  }
  const dimensions = input.auth.observedDimensions;
  if (dimensions === null) {
    return { ok: false, summary: "No hay dimensión observada. No se embebe." };
  }
  const classified = classifyRuntime(input.plane.adapters());
  if (classified.provenance === "unknown") {
    return { ok: false, summary: "La procedencia del plano no está identificada. No se embebe." };
  }
  const provenance = classified.provenance;
  const manifest = semanticManifest(input.corpus, dimensions);
  if (
    input.resumeProfileId !== undefined &&
    input.resumeProfileId !== null &&
    input.resumeProfileId !== manifest.profileId
  ) {
    return {
      ok: false,
      summary: "El perfil pedido no es el de la dimensión observada. No se embebe.",
    };
  }
  const indexName = vectorizeIndexName(manifest.profileId);
  const ready = managementReady(input.plane.management, dimensions, indexName);
  if (!ready.ok) {
    return { ok: false, summary: ready.reason, receipt: { embedCalls: 0 } };
  }
  const cacheFile = path.join(input.paths.cacheDir, `${manifest.profileId}.json`);
  const existing = await readCache(cacheFile);
  let embedCalls = 0;
  let vectors: number[][];
  let providerRevision: string | null = null;
  if (existing !== null) {
    const cached = validateEmbeddingCache(existing, manifest, provenance);
    if (!cached.ok) {
      return {
        ok: false,
        summary: `${cached.reason} No se vuelve a embeber.`,
        receipt: { embedCalls: 0 },
      };
    }
    vectors = vectorsFromCache(cached.cache);
    providerRevision = cached.cache.providerRevision;
  } else if (input.resumeProfileId !== undefined && input.resumeProfileId !== null) {
    return {
      ok: false,
      summary: "La reanudación no tiene caché íntegra. No se vuelve a embeber.",
      receipt: { embedCalls: 0 },
    };
  } else {
    const reserved = input.allowance.reserve({
      kind: "embedding",
      calls: manifest.chunks.length,
      maxInputTokens: OPERATION_BOUNDS.embedding.maxInputTokens,
      maxOutputTokens: 0,
    });
    if (!reserved.ok) {
      return { ok: false, summary: reserved.reason, receipt: { embedCalls: 0 } };
    }
    try {
      const embedded = await input.plane.embed(
        manifest.chunks.map((chunk) => chunk.text),
        reserved.id,
      );
      embedCalls = 1;
      input.allowance.settle(reserved.id, null);
      const embeddedClass = classifyRuntime([embedded.adapter]);
      if (embeddedClass.provenance !== provenance) {
        return {
          ok: false,
          summary: "El adaptador de embedding no es el del plano. No se guarda la caché.",
          receipt: { embedCalls, provenance: embeddedClass.provenance },
        };
      }
      if (
        embedded.vectors.length !== manifest.chunks.length ||
        embedded.vectors.some(
          (row) => row.length !== dimensions || row.some((value) => !Number.isFinite(value)),
        )
      ) {
        return {
          ok: false,
          summary: "El embedding no coincide con la dimensión observada.",
          receipt: { embedCalls },
        };
      }
      vectors = embedded.vectors.map((row) => [...row]);
      providerRevision = embedded.providerRevision;
    } catch {
      input.allowance.settle(reserved.id, null);
      return {
        ok: false,
        summary: "El embedding falló. La reserva no se libera.",
        receipt: { embedCalls: 1 },
      };
    }
    const cache: EmbeddingCache = cacheFromVectors(manifest, vectors, providerRevision, provenance);
    const validated = validateEmbeddingCache(cache, manifest, provenance);
    if (!validated.ok) {
      return { ok: false, summary: validated.reason, receipt: { embedCalls } };
    }
    await writeAtomic(cacheFile, `${JSON.stringify(validated.cache, null, 2)}\n`);
  }
  const result = await input.plane.ingest({ manifest, vectors });
  return {
    ok: result.phase === "ready" || result.phase === "pending-visibility",
    summary:
      result.phase === "ready"
        ? "ingesta leída de vuelta"
        : `ingesta en ${result.phase}. No se marca activa ni se vuelve a insertar solo para esperar.`,
    receipt: {
      phase: result.phase,
      profileId: result.profileId,
      embedCalls,
      upserts: result.upserts,
      provenance,
      providerRevision,
      adapter: result.adapter,
    },
  };
}

export async function executeSelectActive(input: {
  plane: CourseDataPlane | null;
  profileId: string;
}): Promise<CommandOutcome> {
  if (input.plane === null) {
    return {
      ok: false,
      summary: "Falta el puente para leer el perfil. No se envía la selección.",
    };
  }
  const selected = await input.plane.selectActive(input.profileId);
  return {
    ok: selected.ok,
    summary: selected.summary,
    lines: [`perfil activo: ${selected.activeId ?? "ninguno"}`],
    receipt: { activeId: selected.activeId, adapter: selected.adapter },
  };
}

export function defaultSessionPrices() {
  return {
    embeddingUsdPerMillionInput: 0.0118,
    generativeUsdPerMillionInput: null as number | null,
    generativeUsdPerMillionOutput: null as number | null,
  };
}

export function probeAllowance(auth: ActivationAuth): AllowanceLedger {
  return ledgerFor(
    auth,
    {
      embeddingUsdPerMillionInput: 0.0118,
      generativeUsdPerMillionInput: null,
      generativeUsdPerMillionOutput: null,
    },
    { generative: 0, embedding: 2 },
  );
}

export { planFits };
