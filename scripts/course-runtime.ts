// GUÍA DE LECTURA · scripts/course-runtime.ts
// Operaciones de datos del curso sobre el plano (puente real o emulado): sonda de embeddings, ingesta con
// caché de vectores y selección del perfil activo. Cada llamada de pago se reserva antes y la caché evita reembeber.
// Archivos.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
// Rutas.
import path from "node:path";
// Núcleo: cotas, índices de metadatos, procedencia, sesión de gasto, caché, manifiesto y tipos.
import {
  // Cotas de cada operación e índices de metadatos obligatorios.
  OPERATION_BOUNDS,
  VECTORIZE_METADATA_INDEXES,
  // Procedencia, sesión de gasto y si el plan cabe en el tope.
  classifyRuntime,
  createAllowanceLedger,
  planFits,
  // Caché de embeddings y manifiesto semántico.
  cacheFromVectors,
  semanticManifest,
  // Validación de la caché y nombre del índice.
  usableForRemoteIndex,
  validateEmbeddingCache,
  vectorizeIndexName,
  vectorsFromCache,
  // Tipos.
  type AdapterRecord,
  type AllowanceLedger,
  type CorpusManifest,
  type EmbeddingCache,
  type PreparedCorpus,
} from "@thepower-rag/core";
// Tipos de la activación.
import type { ActivationAuth, CommandOutcome } from "./activation";

// Textos sintéticos de la sonda.
export const PROBE_TEXTS = [
  "sonda sintetica uno del curso",
  "sonda sintetica dos del curso",
] as const;

// Datos del índice según la API de gestión.
export interface ManagementReceipt {
  // Métrica.
  metric: string | null;
  // Dimensiones.
  dimensions: number | null;
  // Nombre.
  name: string | null;
  // Índices de metadatos.
  metadataIndexes: readonly string[];
}

// Plano de datos: el puente que embebe, ingesta y selecciona.
export interface CourseDataPlane {
  // Adaptadores en uso.
  adapters(): readonly AdapterRecord[];
  // Embeddings con una reserva.
  embed(
    texts: readonly string[],
    reservationId: string,
  ): Promise<{
    // Vectores.
    vectors: number[][];
    // Revisión del proveedor.
    providerRevision: string | null;
    // Adaptador usado.
    adapter: AdapterRecord;
  }>;
  // Ingesta del manifiesto con sus vectores.
  ingest(input: { manifest: CorpusManifest; vectors: number[][] }): Promise<{
    // Fase.
    phase: string;
    // Escrituras.
    upserts: number;
    // Perfil.
    profileId: string;
    // Adaptador.
    adapter: AdapterRecord;
  }>;
  // Selección del perfil activo.
  selectActive(profileId: string): Promise<{
    // Correcta.
    ok: boolean;
    // Resumen.
    summary: string;
    // Perfil activo.
    activeId: string | null;
    // Adaptador.
    adapter: AdapterRecord;
  }>;
  // Datos del índice.
  management: ManagementReceipt;
}

// Rutas de recibos y caché.
export interface RuntimePaths {
  // Carpeta de recibos.
  receiptDir: string;
  // Carpeta de caché.
  cacheDir: string;
  // Fecha del recibo.
  now: string;
}

// Sesión de gasto con el tope de la autorización.
function ledgerFor(
  auth: ActivationAuth,
  prices: {
    // Embeddings.
    embeddingUsdPerMillionInput: number | null;
    // Entrada generativa.
    generativeUsdPerMillionInput: number | null;
    // Salida generativa.
    generativeUsdPerMillionOutput: number | null;
  },
  limits?: { generative?: number; embedding?: number },
): AllowanceLedger {
  // Sesión.
  return createAllowanceLedger({
    maxSpendUsd: auth.maxSpendUsd ?? 0,
    maxGenerativeCalls: limits?.generative ?? 4,
    maxEmbeddingCalls: limits?.embedding ?? 128,
    prices,
  });
}

// Escribe un archivo de forma atómica (temporal y rename).
export async function writeAtomic(file: string, body: string): Promise<void> {
  // Crea la carpeta.
  await mkdir(path.dirname(file), { recursive: true });
  // Archivo temporal.
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${String(process.pid)}.tmp`,
  );
  // Escribe.
  await writeFile(temporary, body);
  // Renombra.
  await rename(temporary, file);
}

// Comprueba la matriz de la sonda y mide su dimensión.
export function parseObservedEmbeddings(
  vectors: readonly (readonly number[])[],
): { ok: true; dimensions: number } | { ok: false; reason: string } {
  // Una fila por texto.
  if (vectors.length !== PROBE_TEXTS.length) {
    // Error.
    return { ok: false, reason: "La sonda no devolvió una fila por texto." };
  }
  // Anchura.
  const width = vectors[0]?.length ?? 0;
  // Sin dimensión.
  if (!Number.isInteger(width) || width < 1) {
    // Error.
    return { ok: false, reason: "La sonda no devolvió una dimensión observada." };
  }
  // Cada fila.
  for (const row of vectors) {
    // Otra anchura o valores no finitos.
    if (
      row.length !== width ||
      row.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      // Error.
      return { ok: false, reason: "La sonda devolvió una fila vacía, desigual o no finita." };
    }
  }
  // Dimensión.
  return { ok: true, dimensions: width };
}

// Lee la caché o null.
async function readCache(file: string): Promise<unknown> {
  // Archivo ausente o roto: null.
  try {
    // JSON.
    return JSON.parse(await readFile(file, "utf8")) as unknown;
  } catch {
    // null.
    return null;
  }
}

// ¿El índice remoto coincide con el perfil? Si no, no se inserta nada.
function managementReady(
  management: ManagementReceipt,
  dimensions: number,
  indexName: string,
): { ok: true } | { ok: false; reason: string } {
  // Métrica distinta de cosine.
  if (management.metric !== "cosine") {
    // Error.
    return {
      ok: false,
      reason: "La métrica del recibo administrativo no es cosine. No se inserta.",
    };
  }
  // Otra dimensión.
  if (management.dimensions !== dimensions) {
    // Error.
    return {
      ok: false,
      reason: "La dimensión del índice no coincide con la observada. No se inserta.",
    };
  }
  // Otro nombre.
  if (management.name !== indexName) {
    // Error.
    return { ok: false, reason: "El nombre del índice no coincide con el perfil. No se inserta." };
  }
  // Índices de metadatos que faltan.
  const missing = VECTORIZE_METADATA_INDEXES.filter(
    (name) => !management.metadataIndexes.includes(name),
  );
  // Falta alguno.
  if (missing.length > 0) {
    // Error.
    return { ok: false, reason: "Faltan índices de metadatos. No se inserta." };
  }
  // Listo.
  return { ok: true };
}

// Sonda de embeddings: mide la dimensión real del modelo.
export async function executeProbe(input: {
  // Autorización.
  auth: ActivationAuth;
  // Plano de datos.
  plane: CourseDataPlane | null;
  // Sesión de gasto.
  allowance: AllowanceLedger;
  // Rutas.
  paths: RuntimePaths;
  // Cuenta.
  accountId: string;
}): Promise<CommandOutcome> {
  // Sin plano.
  if (input.plane === null) {
    // Error.
    return {
      ok: false,
      summary:
        "El puente local no está conectado. Wrangler 4.147.0 no tiene ai run y no se sustituye la sonda por el índice lexical.",
    };
  }
  // Reserva los dos textos.
  const reserved = input.allowance.reserve({
    kind: "embedding",
    calls: PROBE_TEXTS.length,
    maxInputTokens: 64,
    maxOutputTokens: 0,
  });
  // Sin reserva.
  if (!reserved.ok) {
    // Error.
    return { ok: false, summary: reserved.reason, receipt: { embedCalls: 0 } };
  }
  // Resultado.
  let embedded: {
    // Vectores.
    vectors: number[][];
    // Revisión.
    providerRevision: string | null;
    // Adaptador.
    adapter: AdapterRecord;
  };
  // Un fallo deja el cargo desconocido.
  try {
    // Embebe.
    embedded = await input.plane.embed([...PROBE_TEXTS], reserved.id);
  } catch {
    // Cierra la reserva sin importe.
    input.allowance.settle(reserved.id, null);
    // Error.
    return {
      ok: false,
      summary: "La sonda falló. La reserva no se libera porque el cargo real es desconocido.",
      receipt: { embedCalls: 1 },
    };
  }
  // Cierra la reserva.
  input.allowance.settle(reserved.id, null);
  // Comprueba la matriz.
  const parsed = parseObservedEmbeddings(embedded.vectors);
  // Inválida.
  if (!parsed.ok) {
    // Error.
    return { ok: false, summary: parsed.reason, receipt: { embedCalls: 1 } };
  }
  // Procedencia del adaptador.
  const classified = classifyRuntime([embedded.adapter]);
  // Recibo.
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
  // Lo guarda.
  await writeAtomic(
    path.join(input.paths.receiptDir, "probe-embeddings.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  // Dimensión observada o emulada.
  return {
    ok: true,
    summary:
      classified.provenance === "remote-binding"
        ? `dimensión observada ${String(parsed.dimensions)}`
        : `dimensión emulada ${String(parsed.dimensions)}. No sirve para crear un índice remoto.`,
    receipt,
  };
}

// Ingesta: embebe (o usa la caché) y escribe en el índice.
export async function executeIngest(input: {
  // Autorización.
  auth: ActivationAuth;
  // Corpus.
  corpus: PreparedCorpus;
  // Plano.
  plane: CourseDataPlane | null;
  // Sesión de gasto.
  allowance: AllowanceLedger;
  // Rutas.
  paths: RuntimePaths;
  // Perfil que se reanuda.
  resumeProfileId?: string | null;
}): Promise<CommandOutcome> {
  // Sin plano.
  if (input.plane === null) {
    // Error.
    return {
      ok: false,
      summary: "El puente local no está conectado. No se ingesta ni se usa el índice lexical.",
    };
  }
  // Dimensión medida.
  const dimensions = input.auth.observedDimensions;
  // Sin medir.
  if (dimensions === null) {
    // Error.
    return { ok: false, summary: "No hay dimensión observada. No se embebe." };
  }
  // Procedencia.
  const classified = classifyRuntime(input.plane.adapters());
  // Desconocida.
  if (classified.provenance === "unknown") {
    // Error.
    return { ok: false, summary: "La procedencia del plano no está identificada. No se embebe." };
  }
  // Procedencia.
  const provenance = classified.provenance;
  // Manifiesto.
  const manifest = semanticManifest(input.corpus, dimensions);
  // Reanudación de otro perfil.
  if (
    input.resumeProfileId !== undefined &&
    input.resumeProfileId !== null &&
    input.resumeProfileId !== manifest.profileId
  ) {
    // Error.
    return {
      ok: false,
      summary: "El perfil pedido no es el de la dimensión observada. No se embebe.",
    };
  }
  // Nombre del índice.
  const indexName = vectorizeIndexName(manifest.profileId);
  // ¿Coincide el índice?
  const ready = managementReady(input.plane.management, dimensions, indexName);
  // No.
  if (!ready.ok) {
    // Error.
    return { ok: false, summary: ready.reason, receipt: { embedCalls: 0 } };
  }
  // Caché del perfil.
  const cacheFile = path.join(input.paths.cacheDir, `${manifest.profileId}.json`);
  // Caché existente.
  const existing = await readCache(cacheFile);
  // Llamadas de embeddings.
  let embedCalls = 0;
  // Vectores.
  let vectors: number[][];
  // Revisión.
  let providerRevision: string | null = null;
  // Hay caché.
  if (existing !== null) {
    // Se valida.
    const cached = validateEmbeddingCache(existing, manifest, provenance);
    // Inválida.
    if (!cached.ok) {
      // Error sin reembeber.
      return {
        ok: false,
        summary: `${cached.reason} No se vuelve a embeber.`,
        receipt: { embedCalls: 0 },
      };
    }
    // Vectores de la caché.
    vectors = vectorsFromCache(cached.cache);
    // Revisión.
    providerRevision = cached.cache.providerRevision;
  } else if (input.resumeProfileId !== undefined && input.resumeProfileId !== null) {
    // Reanudación sin caché.
    return {
      ok: false,
      summary: "La reanudación no tiene caché íntegra. No se vuelve a embeber.",
      receipt: { embedCalls: 0 },
    };
  } else {
    // Reserva los embeddings de todos los fragmentos.
    const reserved = input.allowance.reserve({
      kind: "embedding",
      calls: manifest.chunks.length,
      maxInputTokens: OPERATION_BOUNDS.embedding.maxInputTokens,
      maxOutputTokens: 0,
    });
    // Sin reserva.
    if (!reserved.ok) {
      // Error.
      return { ok: false, summary: reserved.reason, receipt: { embedCalls: 0 } };
    }
    // Un fallo deja el cargo desconocido.
    try {
      // Embebe.
      const embedded = await input.plane.embed(
        manifest.chunks.map((chunk) => chunk.text),
        reserved.id,
      );
      // Una llamada.
      embedCalls = 1;
      // Cierra la reserva.
      input.allowance.settle(reserved.id, null);
      // Procedencia del adaptador.
      const embeddedClass = classifyRuntime([embedded.adapter]);
      // Distinta del plano.
      if (embeddedClass.provenance !== provenance) {
        // Error.
        return {
          ok: false,
          summary: "El adaptador de embedding no es el del plano. No se guarda la caché.",
          receipt: { embedCalls, provenance: embeddedClass.provenance },
        };
      }
      // Número de filas o dimensiones distintas.
      if (
        embedded.vectors.length !== manifest.chunks.length ||
        embedded.vectors.some(
          (row) => row.length !== dimensions || row.some((value) => !Number.isFinite(value)),
        )
      ) {
        // Error.
        return {
          ok: false,
          summary: "El embedding no coincide con la dimensión observada.",
          receipt: { embedCalls },
        };
      }
      // Copia los vectores.
      vectors = embedded.vectors.map((row) => [...row]);
      // Revisión.
      providerRevision = embedded.providerRevision;
    } catch {
      // Cierra la reserva sin importe.
      input.allowance.settle(reserved.id, null);
      // Error.
      return {
        ok: false,
        summary: "El embedding falló. La reserva no se libera.",
        receipt: { embedCalls: 1 },
      };
    }
    // Caché nueva.
    const cache: EmbeddingCache = cacheFromVectors(manifest, vectors, providerRevision, provenance);
    // Se valida.
    const validated = validateEmbeddingCache(cache, manifest, provenance);
    // Inválida.
    if (!validated.ok) {
      // Error.
      return { ok: false, summary: validated.reason, receipt: { embedCalls } };
    }
    // La guarda.
    await writeAtomic(cacheFile, `${JSON.stringify(validated.cache, null, 2)}\n`);
  }
  // Escribe en el índice.
  const result = await input.plane.ingest({ manifest, vectors });
  // Resultado.
  return {
    // ok si quedó lista o pendiente de visibilidad.
    ok: result.phase === "ready" || result.phase === "pending-visibility",
    summary:
      result.phase === "ready"
        ? "ingesta leída de vuelta"
        : `ingesta en ${result.phase}. No se marca activa ni se vuelve a insertar solo para esperar.`,
    // Recibo: fase, perfil, llamadas de embeddings, escrituras y procedencia.
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

// Selecciona el perfil activo.
export async function executeSelectActive(input: {
  // Plano.
  plane: CourseDataPlane | null;
  // Perfil.
  profileId: string;
}): Promise<CommandOutcome> {
  // Sin plano.
  if (input.plane === null) {
    // Error.
    return {
      ok: false,
      summary: "Falta el puente para leer el perfil. No se envía la selección.",
    };
  }
  // Selección.
  const selected = await input.plane.selectActive(input.profileId);
  // Resultado.
  return {
    ok: selected.ok,
    summary: selected.summary,
    lines: [`perfil activo: ${selected.activeId ?? "ninguno"}`],
    receipt: { activeId: selected.activeId, adapter: selected.adapter },
  };
}

// Tarifas de sesión por defecto: solo embeddings.
export function defaultSessionPrices() {
  // Tarifas.
  return {
    embeddingUsdPerMillionInput: 0.0118,
    generativeUsdPerMillionInput: null as number | null,
    generativeUsdPerMillionOutput: null as number | null,
  };
}

// Sesión de gasto de la sonda: dos embeddings y ninguna generación.
export function probeAllowance(auth: ActivationAuth): AllowanceLedger {
  // Sesión.
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

// Reexporta planFits del núcleo.
export { planFits };
