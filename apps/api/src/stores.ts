// GUÍA DE LECTURA · apps/api/src/stores.ts
// Adaptadores mínimos sobre Vectorize, D1 y R2: buscar vectores, leer fragmentos y leer el perfil del índice.
// Las interfaces describen solo los métodos que usa el curso; así los tests pueden pasar dobles en memoria.
// Constante LIMITS y tipo de audiencia (programa, L/X o M/J).
import { LIMITS, type Audience } from "@thepower-rag/contracts";
// Tipos del núcleo RAG: fragmento guardado, resultado de búsqueda y consulta.
import type { ChunkRecord, RetrievalHit, RetrievalQuery } from "@thepower-rag/core";

// Un resultado de Vectorize: id del vector, puntuación y metadatos.
export interface VectorMatch {
  // Identificador del vector, igual al chunkId.
  id: string;
  // Similitud con la pregunta; puede faltar.
  score?: number;
  // Metadatos guardados con el vector.
  metadata?: Record<string, unknown>;
}

// Parte de Vectorize que se usa: consultar y escribir vectores.
export interface VectorIndex {
  // Busca los vectores más parecidos con estas opciones.
  query(
    vector: number[],
    options: {
      // Número de resultados.
      topK: number;
      // Devuelve todos los metadatos de cada resultado.
      returnMetadata: "all";
      // Filtro por metadatos: solo vectores de esta versión, perfil y audiencias.
      filter: {
        // Versión del corpus.
        corpusVersion: string;
        // Perfil de índice.
        profileId: string;
        // Audiencias admitidas ($in = cualquiera de la lista).
        audience: { $in: string[] };
      };
    },
  ): Promise<{ matches: VectorMatch[] }>;
  // Inserta o reemplaza vectores con sus metadatos.
  upsert(
    vectors: { id: string; values: number[]; metadata: Record<string, string> }[],
  ): Promise<{ mutationId?: string }>;
}

// Audiencias visibles para un alumno: el programa común y, si tiene grupo, también el suyo.
export function audienceFilter(audience: Audience): string[] {
  // "program" solo ve el común; L/X o M/J ven el común y su grupo.
  return audience === "program" ? ["program"] : ["program", audience];
}

// Busca en Vectorize con plazo y cancelación, y devuelve el id y la puntuación de cada fragmento.
export async function queryVectorize(
  index: VectorIndex,
  query: RetrievalQuery & { profileId: string },
  signal: AbortSignal,
  timeoutMs: number = LIMITS.retrievalTimeoutMs,
): Promise<RetrievalHit[]> {
  // Si la petición ya se canceló, no consulta.
  if (signal.aborted) {
    // Error estándar de cancelación.
    throw new DOMException("The operation was aborted.", "AbortError");
  }
  // Temporizador del plazo; se limpia al final.
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Función que escucha la cancelación; se retira al final.
  let onAbort: (() => void) | undefined;
  // try/finally: limpia temporizador y oyente pase lo que pase.
  try {
    // Promise.race: gana la primera promesa que termine (consulta, cancelación o plazo).
    const result = await Promise.race([
      index.query([...query.vector], {
        topK: query.limit,
        returnMetadata: "all",
        filter: {
          corpusVersion: query.corpusVersion,
          profileId: query.profileId,
          audience: { $in: audienceFilter(query.audience) },
        },
      }),
      new Promise<never>((_, reject) => {
        // Al cancelar, rechaza con AbortError.
        onAbort = () => {
          // Rechaza la carrera.
          reject(new DOMException("The operation was aborted.", "AbortError"));
        };
        // Escucha la señal una sola vez.
        signal.addEventListener("abort", onAbort, { once: true });
      }),
      new Promise<never>((_, reject) => {
        // Si vence el plazo, rechaza con retrieval-timeout.
        timer = setTimeout(() => {
          // Error de plazo.
          reject(new Error("retrieval-timeout"));
        }, timeoutMs);
      }),
    ]);
    // Convierte cada resultado en chunkId y puntuación (null si no es un número finito).
    return result.matches.map((match) => ({
      chunkId: match.id,
      score: typeof match.score === "number" && Number.isFinite(match.score) ? match.score : null,
    }));
  } finally {
    // Si hubo temporizador, lo cancela.
    if (timer !== undefined) {
      // Evita que salte después.
      clearTimeout(timer);
    }
    // Si se registró el oyente, lo quita.
    if (onAbort !== undefined) {
      // Libera el oyente de la señal.
      signal.removeEventListener("abort", onAbort);
    }
  }
}

// Consulta preparada de D1 con valores enlazados.
export interface SqlStatement {
  // Enlaza los valores de los ? y permite leer la primera fila.
  bind(...values: unknown[]): { first<T>(): Promise<T | null> };
}

// Parte de D1 que se usa: preparar consultas.
export interface SqlDatabase {
  // Prepara una consulta SQL.
  prepare(query: string): SqlStatement;
}

// SQL que lee un fragmento con su documento: título, sección, texto, audiencia y versión.
const CHUNK_SQL = `SELECT chunks.chunk_id AS chunkId, chunks.document_id AS documentId,
  documents.title AS title, chunks.section AS section, chunks.text AS text,
  documents.audience AS audience, chunks.version_id AS corpusVersion
  FROM chunks
  JOIN documents ON documents.version_id = chunks.version_id AND documents.document_id = chunks.document_id
  WHERE chunks.version_id = ? AND chunks.chunk_id = ?`;

// Lee un fragmento de D1 y lo devuelve solo si coincide y tiene una audiencia válida.
export async function readChunk(
  database: SqlDatabase,
  corpusVersion: string,
  chunkId: string,
): Promise<ChunkRecord | null> {
  // Consulta con los dos valores enlazados; first devuelve la fila o null.
  const row = await database.prepare(CHUNK_SQL).bind(corpusVersion, chunkId).first<ChunkRecord>();
  // Fragmento inexistente.
  if (row === null) {
    // null.
    return null;
  }
  // Defensa extra: la fila debe ser de la versión y el id pedidos.
  if (row.corpusVersion !== corpusVersion || row.chunkId !== chunkId) {
    // null.
    return null;
  }
  // Audiencia desconocida: no se devuelve.
  if (row.audience !== "program" && row.audience !== "L/X" && row.audience !== "M/J") {
    // null.
    return null;
  }
  // Fragmento válido.
  return row;
}

// Parte de R2 que se usa: guardar y leer objetos.
export interface ObjectBucket {
  // Guarda un objeto bajo una clave.
  put(key: string, body: string | Uint8Array): Promise<unknown>;
  // Lee un objeto; null si no existe.
  get(key: string): Promise<{ text(): Promise<string> } | null>;
}

// Reexporta las claves de R2 del núcleo con los nombres que usa la API.
export {
  contentManifestKey as manifestObjectKey,
  documentObjectKey as corpusObjectKey,
  indexConfigReceiptKey,
  profileManifestKey,
} from "@thepower-rag/core";

// Fila de index_profiles: describe con qué se construyó el índice.
export interface IndexProfileRow {
  // Identificador del perfil.
  id: string;
  // Versión del corpus indexado.
  corpusVersion: string;
  // Modelo de embeddings.
  embeddingModel: string;
  // Dimensiones de cada vector.
  dimensions: number;
  // Métrica de similitud.
  metric: string;
  // Familia del proveedor de embeddings.
  family: string;
  // Estado del perfil (ready cuando está completo).
  status: string;
  // Revisión del proveedor; null si no se conoce.
  providerRevision: string | null;
}

// SQL que lee un perfil por id y versión del corpus.
const PROFILE_SQL = `SELECT id, corpus_version AS corpusVersion, embedding_model AS embeddingModel,
  dimensions, metric, family, status, provider_revision AS providerRevision
  FROM index_profiles
  WHERE id = ? AND corpus_version = ?`;

// Lee el perfil del índice; null si no existe o no coincide.
export async function readIndexProfile(
  database: SqlDatabase,
  profileId: string,
  corpusVersion: string,
): Promise<IndexProfileRow | null> {
  // Consulta con perfil y versión enlazados.
  const row = await database
    .prepare(PROFILE_SQL)
    .bind(profileId, corpusVersion)
    .first<IndexProfileRow>();
  // Sin fila o con otros datos: null.
  if (row === null || row.id !== profileId || row.corpusVersion !== corpusVersion) {
    // null.
    return null;
  }
  // Perfil encontrado.
  return row;
}

// Compara el perfil guardado con la configuración y lista lo que no coincide.
export function profileReady(
  row: IndexProfileRow | null,
  expected: {
    // Modelo de embeddings esperado.
    embeddingModel: string;
    // Dimensiones esperadas.
    dimensions: number;
    // Versión del corpus esperada.
    corpusVersion: string;
    // Perfil de índice esperado.
    indexProfile: string;
    // Métrica esperada.
    metric: "cosine";
  },
): { ok: true } | { ok: false; missing: string[] } {
  // Sin perfil, falta INDEX_PROFILE.
  if (row === null) {
    // Resultado no listo.
    return { ok: false, missing: ["INDEX_PROFILE"] };
  }
  // Variables que no coinciden.
  const missing: string[] = [];
  // Perfil sin terminar.
  if (row.status !== "ready") {
    // Señala el perfil.
    missing.push("INDEX_PROFILE");
  }
  // Embeddings de otra familia.
  if (row.family !== "workers-ai") {
    // Señala el perfil.
    missing.push("INDEX_PROFILE");
  }
  // Otro modelo de embeddings.
  if (row.embeddingModel !== expected.embeddingModel) {
    // Señala el modelo.
    missing.push("EMBEDDING_MODEL");
  }
  // Otras dimensiones.
  if (row.dimensions !== expected.dimensions) {
    // Señala las dimensiones.
    missing.push("EMBEDDING_DIMENSIONS");
  }
  // Otra versión del corpus.
  if (row.corpusVersion !== expected.corpusVersion) {
    // Señala la versión.
    missing.push("CORPUS_VERSION");
  }
  // Otro identificador de perfil.
  if (row.id !== expected.indexProfile) {
    // Señala el perfil.
    missing.push("INDEX_PROFILE");
  }
  // Otra métrica.
  if (row.metric !== expected.metric) {
    // Señala la métrica.
    missing.push("VECTOR_METRIC");
  }
  // Quita repetidos (INDEX_PROFILE puede salir varias veces).
  const unique = [...new Set(missing)];
  // Listo si no falta nada; si no, la lista de variables.
  return unique.length === 0 ? { ok: true } : { ok: false, missing: unique };
}
