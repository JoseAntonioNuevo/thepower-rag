// GUÍA DE LECTURA · apps/api/src/ingest-run.ts
// Ejecuta la ingesta del núcleo con bindings reales (R2, D1 y Vectorize): implementa cada puerto
// con SQL de D1, objetos de R2 y llamadas del binding de Vectorize.
// Clave de R2 y tipos de los bindings.
import { corpusObjectKey, type ObjectBucket, type SqlDatabase } from "./stores";
// Ingesta del núcleo y sus tipos.
import {
  runIngestion,
  UNVERIFIED_METRIC,
  type CatalogSnapshot,
  type CorpusManifest,
  type IngestJournalItem,
  type IngestionPhase,
  type VectorWrite,
  type VisibleVector,
} from "@thepower-rag/core";

// Base de D1 con lotes.
interface CatalogDatabase extends SqlDatabase {
  // Prepara una sentencia.
  prepare(query: string): {
    // Une parámetros.
    bind(...values: unknown[]): {
      // Primera fila.
      first<T>(): Promise<T | null>;
      // Ejecuta.
      run(): Promise<unknown>;
      // Todas las filas.
      all<T>(): Promise<{ results: T[] }>;
    };
  };
  // Lote de sentencias.
  batch(statements: unknown[]): Promise<unknown>;
}

// Binding de Vectorize.
interface VectorBinding {
  // Inserta vectores.
  upsert(vectors: VectorWrite[]): Promise<{ mutationId?: string }>;
  // Lee por id.
  getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, unknown> }[]>;
  // Describe el índice.
  describe(): Promise<{ dimensions?: number; vectorCount?: number }>;
}

// Bindings que necesita la ingesta.
export interface IngestBindings {
  // R2 del corpus.
  CORPUS: ObjectBucket;
  // D1 del catálogo.
  DB: CatalogDatabase;
  // Vectorize.
  VECTORIZE: VectorBinding;
  // Índices de metadatos.
  listMetadataIndexes(): Promise<readonly string[]>;
}

// Texto o null.
function textValue(value: unknown): string | null {
  // Solo cadenas.
  return typeof value === "string" ? value : null;
}

// Convierte un vector leído en el formato del núcleo.
function visibleFromBinding(vector: {
  // Id.
  id: string;
  // Metadatos.
  metadata?: Record<string, unknown>;
}): VisibleVector {
  // Metadatos.
  const metadata = vector.metadata;
  // Versión.
  const corpusVersion = textValue(metadata?.corpusVersion);
  // Audiencia.
  const audience = textValue(metadata?.audience);
  // Perfil.
  const profileId = textValue(metadata?.profileId);
  // Incompletos: sin metadatos.
  if (corpusVersion === null || audience === null || profileId === null) {
    // Vector sin metadatos.
    return { id: vector.id, metadata: null };
  }
  // Vector con sus metadatos.
  return { id: vector.id, metadata: { corpusVersion, audience, profileId } };
}

// Ingesta con bindings y diario.
export async function runBoundIngestion(
  bindings: IngestBindings,
  manifest: CorpusManifest,
  vectors: readonly (readonly number[])[] | null,
  journal: readonly IngestJournalItem[] = [],
  observed: {
    // Métrica observada.
    metric: string | null;
    // Nombre informado del índice.
    reportedName: string | null;
    // Nombre esperado.
    expectedIndexName: string | null;
  } = {
    metric: null,
    reportedName: null,
    expectedIndexName: null,
  },
): Promise<{ phase: IngestionPhase; journal: IngestJournalItem[]; mutationId: string | null }> {
  // Ejecuta la ingesta del núcleo con estos puertos.
  return runIngestion({
    manifest,
    vectors,
    journal,
    expectedIndexName: observed.expectedIndexName,
    getBatchSize: 20,
    ports: {
      getObject: async (key) => {
        // Objeto de R2.
        const object = await bindings.CORPUS.get(key);
        // Texto o null.
        return object === null ? null : object.text();
      },
      putObject: async (key, body) => {
        // Escribe en R2.
        await bindings.CORPUS.put(key, body);
      },
      writeCatalog: async (current) => {
        // Versión, perfil, documentos, fragmentos y mapa de vectores en un lote.
        const statements = [
          // Versión del corpus: upsert. Si ya existe, se actualizan modelo, dimensión y revisión.
          bindings.DB.prepare(
            `INSERT INTO corpus_versions (id, embedding_model, dimensions, remote_revision, status)
             VALUES (?, ?, ?, ?, 'catalog')
             ON CONFLICT(id) DO UPDATE SET
               embedding_model = excluded.embedding_model,
               dimensions = excluded.dimensions,
               remote_revision = excluded.remote_revision`,
            // Valores: versión, modelo, dimensión y revisión.
          ).bind(
            current.preparationId,
            current.embeddingModel,
            current.dimensions,
            current.providerRevision,
          ),
          // Perfil: se crea como «partial» e inactivo. Un perfil activo conserva su estado.
          bindings.DB.prepare(
            `INSERT INTO index_profiles (
               id, corpus_version, embedding_model, dimensions, metric, chunk_max_chars,
               chunk_overlap, provider_revision, family, status, expected_vectors, active
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'partial', ?, 0)
             ON CONFLICT(id) DO UPDATE SET
               corpus_version = excluded.corpus_version,
               embedding_model = excluded.embedding_model,
               dimensions = excluded.dimensions,
               metric = excluded.metric,
               chunk_max_chars = excluded.chunk_max_chars,
               chunk_overlap = excluded.chunk_overlap,
               provider_revision = excluded.provider_revision,
               family = excluded.family,
               expected_vectors = excluded.expected_vectors,
               status = CASE WHEN index_profiles.active = 1 THEN index_profiles.status ELSE excluded.status END`,
            // Valores en el orden de las columnas. La métrica queda «sin verificar» hasta leerla de
            // Vectorize.
          ).bind(
            current.profileId,
            current.preparationId,
            current.embeddingModel,
            current.dimensions,
            UNVERIFIED_METRIC,
            current.chunkMaxChars,
            current.chunkOverlap,
            current.providerRevision,
            current.family,
            current.chunks.length,
          ),
        ];
        // Cada documento.
        for (const document of current.documents) {
          // Inserta o actualiza.
          statements.push(
            // Upsert de cada documento de la versión.
            bindings.DB.prepare(
              `INSERT INTO documents (version_id, document_id, title, audience, source_hash)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(version_id, document_id) DO UPDATE SET
                 title = excluded.title, audience = excluded.audience, source_hash = excluded.source_hash`,
              // Valores: versión, id, título, audiencia y hash de la fuente.
            ).bind(
              current.preparationId,
              document.id,
              document.title,
              document.audience,
              document.sourceHash,
            ),
          );
        }
        // Cada fragmento.
        for (const chunk of current.chunks) {
          // Fragmento y su vector.
          statements.push(
            // Upsert del texto del fragmento.
            bindings.DB.prepare(
              `INSERT INTO chunks (version_id, chunk_id, document_id, section, text, ordinal)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(version_id, chunk_id) DO UPDATE SET
                 document_id = excluded.document_id, section = excluded.section,
                 text = excluded.text, ordinal = excluded.ordinal`,
              // Valores: versión, id, documento, sección, texto y orden.
            ).bind(
              current.preparationId,
              chunk.chunkId,
              chunk.documentId,
              chunk.section,
              chunk.text,
              chunk.ordinal,
            ),
            // Relación vector → fragmento del perfil.
            bindings.DB.prepare(
              `INSERT INTO vector_map (profile_id, vector_id, chunk_id) VALUES (?, ?, ?)
               ON CONFLICT(profile_id, vector_id) DO UPDATE SET chunk_id = excluded.chunk_id`,
            ).bind(current.profileId, chunk.vectorId, chunk.chunkId),
          );
        }
        // Lote atómico.
        await bindings.DB.batch(statements);
      },
      readCatalog: async (versionId, profileId) => {
        // Documentos de la versión.
        const documents = await bindings.DB.prepare(
          `SELECT document_id AS id, title, audience, source_hash AS sourceHash
           FROM documents WHERE version_id = ?`,
        )
          .bind(versionId)
          .all<CatalogSnapshot["documents"][number]>();
        // Fragmentos.
        const chunks = await bindings.DB.prepare(
          `SELECT chunk_id AS chunkId, document_id AS documentId, text, ordinal
           FROM chunks WHERE version_id = ?`,
        )
          .bind(versionId)
          .all<CatalogSnapshot["chunks"][number]>();
        // Mapa de vectores.
        const mappings = await bindings.DB.prepare(
          `SELECT vector_id AS vectorId, chunk_id AS chunkId
           FROM vector_map WHERE profile_id = ?`,
        )
          .bind(profileId)
          .all<CatalogSnapshot["mappings"][number]>();
        // Instantánea del catálogo.
        return {
          documents: documents.results,
          chunks: chunks.results,
          mappings: mappings.results,
        };
      },
      listMetadataIndexes: () => bindings.listMetadataIndexes(),
      upsertVectors: async (batch) => {
        // Inserta en Vectorize.
        const result = await bindings.VECTORIZE.upsert([...batch]);
        // Id de la mutación.
        return { mutationId: result.mutationId ?? null };
      },
      readVectors: async (ids) => {
        // Lee por id.
        const found = await bindings.VECTORIZE.getByIds([...ids]);
        // Formato del núcleo.
        return found.map((vector) => visibleFromBinding(vector));
      },
      describeIndex: async () => {
        // Describe el índice.
        const info = (await bindings.VECTORIZE.describe()) as {
          // Dimensiones.
          dimensions?: number;
          // Número de vectores.
          vectorCount?: number;
          // Métrica.
          config?: { metric?: string };
        };
        // Métrica del binding si la informa.
        const bindingMetric =
          info.config !== undefined && typeof info.config.metric === "string"
            ? info.config.metric
            : null;
        // Descripción para el núcleo.
        return {
          name: observed.reportedName,
          dimensions: typeof info.dimensions === "number" ? info.dimensions : null,
          metric: bindingMetric ?? observed.metric,
          vectorCount: typeof info.vectorCount === "number" ? info.vectorCount : null,
        };
      },
      persistJournal: async (item) => {
        // Guarda la anotación en D1.
        // Upsert de la anotación: repetir la ingesta actualiza la fila en vez de duplicarla.
        await bindings.DB.prepare(
          `INSERT INTO ingest_items (
             corpus_version, profile_id, store, item_key, ok, error, outcome, mutation_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(corpus_version, profile_id, store, item_key) DO UPDATE SET
             ok = excluded.ok,
             error = excluded.error,
             outcome = excluded.outcome,
             mutation_id = excluded.mutation_id`,
        )
          // Valores: versión, perfil, almacén, clave, ok (1/0), error, resultado y mutación.
          .bind(
            item.versionId,
            item.profileId,
            item.store,
            item.key,
            item.ok ? 1 : 0,
            item.error,
            item.outcome,
            item.mutationId,
          )
          .run();
      },
      recordPhase: async (update) => {
        // Actualiza la fase de un perfil no activo.
        // Fase del perfil: solo si no está activo. La métrica solo cambia si se observó una.
        await bindings.DB.prepare(
          `UPDATE index_profiles
           SET status = ?, mutation_id = ?, last_error = ?,
               metric = CASE WHEN ? IS NULL THEN metric ELSE ? END,
               visible_vectors = CASE WHEN ? = 'ready' THEN expected_vectors ELSE NULL END
           WHERE id = ? AND active = 0`,
        )
          // Valores: fase, mutación, error, métrica observada (dos veces por el CASE), fase y
          // perfil.
          .bind(
            // Fase, mutación y error.
            update.phase,
            update.mutationId,
            update.lastError,
            // Métrica observada: una vez para el IS NULL y otra para el valor.
            update.observedMetric,
            update.observedMetric,
            // Fase (para visible_vectors) y perfil.
            update.phase,
            manifest.profileId,
          )
          .run();
      },
    },
  });
}

// Lee el diario de un perfil desde D1.
export async function loadBoundJournal(
  database: CatalogDatabase,
  versionId: string,
  profileId: string,
): Promise<IngestJournalItem[]> {
  // Anotaciones guardadas.
  const rows = await database
    .prepare(
      `SELECT store, item_key AS itemKey, ok, error, outcome, mutation_id AS mutationId
       FROM ingest_items
       WHERE corpus_version = ? AND profile_id = ?`,
    )
    .bind(versionId, profileId)
    .all<{
      // Almacén.
      store: string;
      // Clave.
      itemKey: string;
      // Correcto (1/0).
      ok: number;
      // Error.
      error: string | null;
      // Resultado.
      outcome: string | null;
      // Mutación.
      mutationId: string | null;
    }>();
  // Convierte cada fila.
  return rows.results.flatMap((row) => {
    // Almacén desconocido: se ignora.
    if (row.store !== "r2" && row.store !== "d1" && row.store !== "vectorize") {
      // Sin anotación.
      return [];
    }
    // Resultado guardado o deducido de ok.
    const outcome =
      row.outcome === "succeeded" || row.outcome === "pending" || row.outcome === "failed"
        ? row.outcome
        : row.ok === 1
          ? "succeeded"
          : "failed";
    // Anotación del núcleo.
    return [
      // Anotación del núcleo reconstruida desde la fila de D1.
      {
        store: row.store,
        versionId,
        profileId,
        key: row.itemKey,
        outcome,
        // ok se deriva del resultado, no de la columna antigua.
        ok: outcome === "succeeded",
        error: row.error,
        mutationId: row.mutationId,
      },
    ];
  });
}

// Reexporta la clave de R2.
export { corpusObjectKey };
