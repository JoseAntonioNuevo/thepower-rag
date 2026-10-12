// GUÍA DE LECTURA · packages/rag/src/ingest.ts
// Ingesta del corpus en Cloudflare con un diario idempotente: documentos y manifiestos en R2,
// catálogo en D1 y vectores en Vectorize. Cada paso se lee de vuelta y queda anotado en el diario,
// así una ejecución interrumpida se puede reanudar sin repetir lo ya aceptado.
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Claves de R2, lotes y límites de Vectorize.
import {
  contentManifestKey,
  documentObjectKey,
  indexConfigReceiptKey,
  profileManifestKey,
  VECTORIZE_GET_BATCH,
  VECTORIZE_METADATA_INDEXES,
  VECTORIZE_UPSERT_BATCH,
  utf8Bytes,
  VECTOR_ID_MAX_BYTES,
} from "./ids";
// Tipo del corpus preparado.
import type { PreparedCorpus } from "./prepare";

// Almacén afectado por una anotación del diario.
export type StoreName = "r2" | "d1" | "vectorize";
// Fase de la ingesta: planificada, parcial, pendiente de visibilidad, lista o fallida.
export type IngestionPhase = "planned" | "partial" | "pending-visibility" | "ready" | "failed";
// Resultado de un paso del diario.
export type JournalOutcome = "succeeded" | "pending" | "failed";

// Anotación del diario de ingesta.
export interface IngestJournalItem {
  // Almacén (R2, D1 o Vectorize).
  store: StoreName;
  // Versión de preparación.
  versionId: string;
  // Perfil de índice.
  profileId: string;
  // Clave del paso (archivo, catálogo, lote de vectores…).
  key: string;
  // Resultado.
  outcome: JournalOutcome;
  // true si el paso terminó bien.
  ok: boolean;
  // Código de error, o null.
  error: string | null;
  // Id de la mutación de Vectorize, si la hubo.
  mutationId: string | null;
}

// Manifiesto de un perfil: todo lo necesario para reconstruir e indexar el corpus.
export interface CorpusManifest {
  // Tipo de manifiesto.
  kind: "profile";
  // Versión del contenido.
  contentVersion: string;
  // Versión de preparación.
  preparationId: string;
  // Fecha de verificación.
  verifiedDate: string;
  // Perfil de índice.
  profileId: string;
  // Modelo de embeddings.
  embeddingModel: string;
  // Dimensiones.
  dimensions: number;
  // Métrica.
  metric: "cosine";
  // Familia del perfil.
  family: "fixture" | "workers-ai";
  // Revisión del proveedor.
  providerRevision: string | null;
  // Tamaño máximo de fragmento.
  chunkMaxChars: number;
  // Solapamiento.
  chunkOverlap: number;
  // Clave del manifiesto de contenido en R2.
  contentManifestKey: string;
  // Documentos.
  documents: {
    // Id.
    id: string;
    // Título.
    title: string;
    // Audiencia.
    audience: Audience;
    // Sesión.
    session: string | null;
    // Ruta del archivo fuente.
    sourcePath: string;
    // Huella del archivo.
    sourceHash: string;
    // Texto completo.
    body: string;
  }[];
  // Fragmentos.
  chunks: {
    // Id del fragmento.
    chunkId: string;
    // Id del vector.
    vectorId: string;
    // Documento.
    documentId: string;
    // Sección.
    section: string;
    // Texto.
    text: string;
    // Posición.
    ordinal: number;
  }[];
  // Revisión remota sin verificar.
  remoteRevision: null;
}

// Manifiesto de contenido, común a todos los perfiles de una preparación.
export interface ContentManifest {
  // Tipo de manifiesto.
  kind: "content";
  // Versión del contenido.
  contentVersion: string;
  // Versión de preparación.
  preparationId: string;
  // Fecha de verificación.
  verifiedDate: string;
  // Documentos.
  documents: CorpusManifest["documents"];
  // Fragmentos.
  chunks: CorpusManifest["chunks"];
}

// Vector leído de vuelta desde Vectorize.
export interface VisibleVector {
  // Id del vector.
  id: string;
  // Metadatos guardados, o null.
  metadata: { corpusVersion: string; audience: string; profileId: string } | null;
}

// Descripción del índice que devuelve Vectorize.
export interface IndexDescription {
  // Nombre.
  name: string | null;
  // Dimensiones.
  dimensions: number | null;
  // Métrica.
  metric: string | null;
  // Número de vectores.
  vectorCount: number | null;
}

// Lo que se lee de D1 para comprobar el catálogo.
export interface CatalogSnapshot {
  // Documentos.
  documents: { id: string; title: string; audience: string; sourceHash: string }[];
  // Fragmentos.
  chunks: { chunkId: string; documentId: string; text: string; ordinal: number }[];
  // Mapa vector → fragmento.
  mappings: { vectorId: string; chunkId: string }[];
}

// Datos para calcular la fase de una ingesta.
export interface IngestEvidence {
  // Versión.
  versionId: string;
  // Perfil.
  profileId: string;
  // Documentos esperados.
  expectedDocuments: number;
  // Fragmentos esperados.
  expectedChunks: number;
  // Diario.
  journal: readonly IngestJournalItem[];
}

// Construye el manifiesto de un perfil a partir del corpus preparado.
export function manifestFrom(corpus: PreparedCorpus): CorpusManifest {
  // Copia los datos del perfil, los documentos y todos los fragmentos aplanados.
  return {
    // «profile»: manifiesto de un perfil concreto (el de contenido es común a todos los perfiles).
    kind: "profile",
    // Identidad del contenido preparado.
    contentVersion: corpus.contentVersion,
    preparationId: corpus.preparationId,
    verifiedDate: corpus.verifiedDate,
    // Parámetros del perfil de índice: modelo, dimensión, métrica, familia y troceado.
    profileId: corpus.indexProfile.id,
    embeddingModel: corpus.indexProfile.model,
    dimensions: corpus.indexProfile.dimensions,
    metric: corpus.indexProfile.metric,
    family: corpus.indexProfile.family,
    providerRevision: corpus.indexProfile.providerRevision,
    chunkMaxChars: corpus.indexProfile.chunkMaxChars,
    chunkOverlap: corpus.indexProfile.chunkOverlap,
    // Clave en R2 del manifiesto de contenido del que depende este perfil.
    contentManifestKey: contentManifestKey(corpus.preparationId),
    // Documentos con su texto completo, que se suben a R2.
    documents: corpus.documents.map((document) => ({
      id: document.id,
      title: document.title,
      audience: document.audience,
      session: document.session,
      sourcePath: document.sourcePath,
      sourceHash: document.sourceHash,
      body: document.body,
    })),
    // Fragmentos aplanados de todos los documentos, con el id de su vector en Vectorize.
    chunks: corpus.documents.flatMap((document) =>
      document.chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        vectorId: chunk.vectorId,
        documentId: document.id,
        section: chunk.section,
        text: chunk.text,
        ordinal: chunk.ordinal,
      })),
    ),
    // La revisión remota se conoce solo tras ingestar, así que empieza en null.
    remoteRevision: null,
  };
}

// Manifiesto de contenido a partir del de un perfil.
export function contentManifestFrom(manifest: CorpusManifest): ContentManifest {
  // Solo los datos comunes.
  return {
    kind: "content",
    contentVersion: manifest.contentVersion,
    preparationId: manifest.preparationId,
    verifiedDate: manifest.verifiedDate,
    documents: manifest.documents,
    chunks: manifest.chunks,
  };
}

// Manifiesto como JSON en una línea, con salto final.
export function serializeManifest(manifest: CorpusManifest): string {
  // JSON más salto de línea.
  return `${JSON.stringify(manifest)}\n`;
}

// Manifiesto de contenido como JSON.
export function serializeContentManifest(manifest: ContentManifest): string {
  // JSON más salto de línea.
  return `${JSON.stringify(manifest)}\n`;
}

// Crea una anotación; ok se deduce del resultado.
export function journalItem(input: Omit<IngestJournalItem, "ok">): IngestJournalItem {
  // ok es true solo si el paso tuvo éxito.
  return { ...input, ok: input.outcome === "succeeded" };
}

// Anotaciones de una versión y un perfil concretos.
export function journalForProfile(
  items: readonly IngestJournalItem[],
  versionId: string,
  profileId: string,
): IngestJournalItem[] {
  // Filtra por versión y perfil.
  return items.filter((item) => item.versionId === versionId && item.profileId === profileId);
}

// ¿Tienen las dos listas exactamente los mismos ids, sin importar el orden?
function sameIds(left: readonly string[], right: readonly string[]): boolean {
  // Longitudes distintas: no.
  if (left.length !== right.length) {
    // Distintas.
    return false;
  }
  // Ids pendientes de encontrar.
  const pending = new Set(right);
  // Cada id de la izquierda debe borrarse de los pendientes y no deben quedar.
  return left.every((id) => pending.delete(id)) && pending.size === 0;
}

// ¿Coincide el catálogo leído de D1 con el manifiesto?
export function catalogMatches(
  manifest: CorpusManifest,
  snapshot: CatalogSnapshot | null,
): boolean {
  // Sin lectura no hay coincidencia.
  if (snapshot === null) {
    // No coincide.
    return false;
  }
  // Mismo número de documentos, fragmentos y mapeos.
  if (
    snapshot.documents.length !== manifest.documents.length ||
    snapshot.chunks.length !== manifest.chunks.length ||
    snapshot.mappings.length !== manifest.chunks.length
  ) {
    // No coincide.
    return false;
  }
  // Documentos leídos por id.
  const documents = new Map(snapshot.documents.map((document) => [document.id, document]));
  // Revisa cada documento esperado.
  for (const document of manifest.documents) {
    // Documento leído.
    const found = documents.get(document.id);
    // Debe existir con el mismo título, audiencia y huella.
    if (
      found === undefined ||
      found.title !== document.title ||
      found.audience !== document.audience ||
      found.sourceHash !== document.sourceHash
    ) {
      // No coincide.
      return false;
    }
  }
  // Fragmentos leídos por id.
  const chunks = new Map(snapshot.chunks.map((chunk) => [chunk.chunkId, chunk]));
  // Mapa vector → fragmento leído.
  const mappings = new Map(snapshot.mappings.map((mapping) => [mapping.vectorId, mapping.chunkId]));
  // Revisa cada fragmento esperado.
  for (const chunk of manifest.chunks) {
    // Fragmento leído.
    const found = chunks.get(chunk.chunkId);
    // Mismo documento, texto, posición y mapeo de su vector.
    if (
      found === undefined ||
      found.documentId !== chunk.documentId ||
      found.text !== chunk.text ||
      found.ordinal !== chunk.ordinal ||
      mappings.get(chunk.vectorId) !== chunk.chunkId
    ) {
      // No coincide.
      return false;
    }
  }
  // Todo coincide.
  return true;
}

// Clasifica la lectura de vuelta del índice: lista, pendiente de visibilidad o fallida.
export function classifyIndexReadback(input: {
  // Ids esperados.
  expectedIds: readonly string[];
  // Vectores visibles.
  visible: readonly VisibleVector[];
  // Metadatos esperados por id.
  expectedMetadata: ReadonlyMap<
    string,
    { corpusVersion: string; audience: string; profileId: string }
  >;
  // Dimensiones observadas.
  dimensions: number | null;
  // Dimensiones esperadas.
  expectedDimensions: number;
  // Métrica observada.
  metric: string | null;
  // Vectores en el índice.
  vectorCount: number | null;
  // Nombre esperado del índice.
  expectedIndexName: string | null;
  // Nombre observado.
  indexName: string | null;
}): { outcome: JournalOutcome; error: string | null } {
  // Métrica distinta de coseno: fallo.
  if (input.metric !== null && input.metric !== "cosine") {
    // Error de métrica.
    return { outcome: "failed", error: "index-metric-mismatch" };
  }
  // Dimensión distinta: fallo.
  if (input.dimensions !== null && input.dimensions !== input.expectedDimensions) {
    // Error de dimensión.
    return { outcome: "failed", error: "index-dimension-mismatch" };
  }
  // Nombre de índice distinto: fallo.
  if (
    input.expectedIndexName !== null &&
    input.indexName !== null &&
    input.indexName !== input.expectedIndexName
  ) {
    // Error de nombre.
    return { outcome: "failed", error: "index-name-mismatch" };
  }
  // Ids visibles.
  const visibleIds = input.visible.map((vector) => vector.id);
  // ¿Se ven exactamente los ids esperados?
  const idsReady = sameIds(visibleIds, input.expectedIds);
  // Si no se ven todos.
  if (!idsReady) {
    // Ids esperados.
    const expected = new Set(input.expectedIds);
    // Ids visibles que no se esperaban.
    const unexpected = visibleIds.filter((id) => !expected.has(id));
    // Mismo recuento pero ids distintos: hay vectores ajenos.
    if (
      input.vectorCount === input.expectedIds.length &&
      visibleIds.length === input.expectedIds.length &&
      unexpected.length > 0
    ) {
      // Error de ids.
      return { outcome: "failed", error: "vectorize-id-mismatch" };
    }
  }
  // Con los ids completos se revisan los metadatos.
  if (idsReady) {
    // Cada vector debe tener los metadatos esperados.
    const metadataReady = input.visible.every((vector) => {
      // Metadatos esperados del vector.
      const expected = input.expectedMetadata.get(vector.id);
      // Coinciden versión, audiencia y perfil.
      return (
        expected !== undefined &&
        vector.metadata !== null &&
        vector.metadata.corpusVersion === expected.corpusVersion &&
        vector.metadata.audience === expected.audience &&
        vector.metadata.profileId === expected.profileId
      );
    });
    // Metadatos incorrectos: fallo.
    if (!metadataReady) {
      // Error de metadatos.
      return { outcome: "failed", error: "vectorize-metadata-mismatch" };
    }
    // Más vectores de los esperados: fallo.
    if (input.vectorCount !== null && input.vectorCount > input.expectedIds.length) {
      // Error de vectores de más.
      return { outcome: "failed", error: "vectorize-unexpected-vectors" };
    }
  }
  // Listo solo si todo coincide: ids, métrica, dimensión, recuento y nombre.
  const visible =
    idsReady &&
    input.metric === "cosine" &&
    input.dimensions === input.expectedDimensions &&
    input.vectorCount === input.expectedIds.length &&
    (input.expectedIndexName === null || input.indexName === input.expectedIndexName);
  // Índice listo.
  if (visible) {
    // Éxito.
    return { outcome: "succeeded", error: null };
  }
  // Aún no se ve todo: pendiente, sin reintentar la escritura.
  return { outcome: "pending", error: "vectorize-readback-incomplete" };
}

// Fase de una ingesta según su diario.
export function ingestionPhase(evidence: IngestEvidence): IngestionPhase {
  // Anotaciones de esta versión y perfil.
  const own = journalForProfile(evidence.journal, evidence.versionId, evidence.profileId);
  // Sin documentos o fragmentos no hay nada que indexar.
  if (evidence.expectedDocuments === 0 || evidence.expectedChunks === 0) {
    // Fallida.
    return "failed";
  }
  // Cualquier paso fallido hace fallar la ingesta.
  if (own.some((item) => item.outcome === "failed")) {
    // Fallida.
    return "failed";
  }
  // Almacenes con algún paso correcto.
  const succeeded = new Set(
    own.filter((item) => item.outcome === "succeeded").map((item) => item.store),
  );
  // Nada escrito todavía.
  if (succeeded.size === 0) {
    // Planificada.
    return "planned";
  }
  // ¿Se escribió en los tres almacenes?
  const written = succeeded.has("r2") && succeeded.has("d1") && succeeded.has("vectorize");
  // Falta alguno.
  if (!written) {
    // Parcial.
    return "partial";
  }
  // Paso de visibilidad de los vectores.
  const visibility = own.find((item) => item.key === "vectors:visibility");
  // Vectores visibles y comprobados.
  if (visibility?.outcome === "succeeded") {
    // Lista.
    return "ready";
  }
  // Escrita pero aún sin visibilidad confirmada.
  return "pending-visibility";
}

// Vector que se escribe en Vectorize.
export interface VectorWrite {
  // Id.
  id: string;
  // Valores.
  values: readonly number[];
  // Metadatos filtrables: versión, audiencia y perfil.
  metadata: { corpusVersion: string; audience: Audience; profileId: string };
}

// Puertos de la ingesta: los implementan Wrangler, workerd o las pruebas.
export interface IngestPorts {
  // Lee un objeto de R2.
  getObject(key: string): Promise<string | null>;
  // Escribe un objeto en R2.
  putObject(key: string, body: string): Promise<void>;
  // Escribe el catálogo en D1.
  writeCatalog(manifest: CorpusManifest): Promise<void>;
  // Lee el catálogo de D1.
  readCatalog(versionId: string, profileId: string): Promise<CatalogSnapshot | null>;
  // Lista los índices de metadatos de Vectorize.
  listMetadataIndexes(): Promise<readonly string[]>;
  // Inserta vectores y devuelve el id de mutación.
  upsertVectors(vectors: readonly VectorWrite[]): Promise<{ mutationId: string | null }>;
  // Lee vectores por id.
  readVectors(ids: readonly string[]): Promise<readonly VisibleVector[]>;
  // Describe el índice.
  describeIndex(): Promise<IndexDescription>;
  // Guarda una anotación del diario.
  persistJournal(item: IngestJournalItem): Promise<void>;
  // Guarda la fase del perfil.
  recordPhase(update: {
    // Fase.
    phase: IngestionPhase;
    // Última mutación.
    mutationId: string | null;
    // Métrica observada.
    observedMetric: string | null;
    // Último error.
    lastError: string | null;
  }): Promise<void>;
}

// Sustituye en el diario la anotación de la misma clave por la nueva.
function remember(journal: IngestJournalItem[], item: IngestJournalItem): IngestJournalItem[] {
  // Quita la anotación anterior del mismo paso.
  const rest = journal.filter(
    (current) =>
      !(
        current.versionId === item.versionId &&
        current.profileId === item.profileId &&
        current.store === item.store &&
        current.key === item.key
      ),
  );
  // Añade la nueva al final.
  return [...rest, item];
}

// Valida los embeddings antes de escribirlos y les añade sus metadatos.
export function validateVectors(
  manifest: CorpusManifest,
  vectors: readonly (readonly number[])[],
): VectorWrite[] {
  // Un vector por fragmento.
  if (vectors.length !== manifest.chunks.length) {
    // Error si no coincide.
    throw new Error("El número de embeddings no coincide con los fragmentos.");
  }
  // Ids de documento.
  const documentIds = new Set(manifest.documents.map((document) => document.id));
  // Ids ya vistos.
  const seen = new Set<string>();
  // Construye cada escritura.
  return manifest.chunks.map((chunk, index) => {
    // Vector del fragmento.
    const values = vectors[index];
    // Dimensión correcta.
    if (values === undefined || values.length !== manifest.dimensions) {
      // Error de dimensión.
      throw new Error("La dimensión del embedding no coincide con el perfil.");
    }
    // Solo números finitos.
    if (values.some((value) => !Number.isFinite(value))) {
      // Error.
      throw new Error("El embedding contiene un valor no finito.");
    }
    // Id dentro del límite.
    if (utf8Bytes(chunk.vectorId) > VECTOR_ID_MAX_BYTES) {
      // Error.
      throw new Error("El identificador vectorial supera 64 bytes.");
    }
    // Sin ids repetidos.
    if (seen.has(chunk.vectorId) || seen.has(chunk.chunkId)) {
      // Error.
      throw new Error("Hay un identificador de fragmento o de vector repetido.");
    }
    // Marca el id del vector.
    seen.add(chunk.vectorId);
    // Marca el id del fragmento.
    seen.add(chunk.chunkId);
    // Documento del fragmento.
    const document = manifest.documents.find((item) => item.id === chunk.documentId);
    // Debe existir.
    if (document === undefined || !documentIds.has(document.id)) {
      // Error.
      throw new Error("El fragmento no tiene documento.");
    }
    // Audiencia válida.
    if (
      document.audience !== "program" &&
      document.audience !== "L/X" &&
      document.audience !== "M/J"
    ) {
      // Error.
      throw new Error("La audiencia del documento no es válida.");
    }
    // Escritura con sus metadatos.
    return {
      id: chunk.vectorId,
      values,
      metadata: {
        corpusVersion: manifest.preparationId,
        audience: document.audience,
        profileId: manifest.profileId,
      },
    };
  });
}

// Lee vectores por lotes para no superar el límite de la API.
async function readVectorsInBatches(
  ids: readonly string[],
  read: IngestPorts["readVectors"],
  batchSize: number,
): Promise<VisibleVector[]> {
  // Lote inválido.
  if (batchSize < 1) {
    // Error.
    throw new Error("El lote de lectura vectorial no es válido.");
  }
  // Vectores leídos.
  const found: VisibleVector[] = [];
  // Recorre los ids de lote en lote.
  for (let index = 0; index < ids.length; index += batchSize) {
    // Lee un lote.
    const batch = await read(ids.slice(index, index + batchSize));
    // Acumula.
    found.push(...batch);
  }
  // Todos los vectores leídos.
  return found;
}

// Divide una lista en lotes de un tamaño dado.
function batchesOf<T>(items: readonly T[], size: number): T[][] {
  // Lotes.
  const batches: T[][] = [];
  // De size en size.
  for (let index = 0; index < items.length; index += size) {
    // Añade el lote.
    batches.push(items.slice(index, index + size));
  }
  // Lotes resultantes.
  return batches;
}

// Ejecuta la ingesta completa con su diario; se puede repetir y reanudar.
export async function runIngestion(input: {
  // Manifiesto del perfil.
  manifest: CorpusManifest;
  // Embeddings, o null si aún no se calcularon.
  vectors: readonly (readonly number[])[] | null;
  // Puertos.
  ports: IngestPorts;
  // Diario anterior.
  journal?: readonly IngestJournalItem[];
  // Tamaño de lote de escritura.
  upsertBatchSize?: number;
  // Tamaño de lote de lectura.
  getBatchSize?: number;
  // Nombre esperado del índice.
  expectedIndexName?: string | null;
  // true si el perfil ya está activo.
  profileIsActive?: boolean;
}): Promise<{ phase: IngestionPhase; journal: IngestJournalItem[]; mutationId: string | null }> {
  // Versión.
  const versionId = input.manifest.preparationId;
  // Perfil.
  const profileId = input.manifest.profileId;
  // Diario de este perfil.
  let journal = journalForProfile(input.journal ?? [], versionId, profileId);
  // Un perfil activo no se vuelve a escribir: solo se informa su fase.
  if (input.profileIsActive === true) {
    // Fase actual sin tocar nada.
    return {
      // Perfil activo: se calcula la fase con el diario, sin escribir nada (no se toca lo que está
      // sirviendo).
      phase: ingestionPhase({
        versionId,
        profileId,
        expectedDocuments: input.manifest.documents.length,
        expectedChunks: input.manifest.chunks.length,
        journal,
      }),
      journal,
      mutationId: null,
    };
  }
  // Anota un paso en memoria y en el almacén del diario.
  const mark = async (item: IngestJournalItem) => {
    // Actualiza el diario local.
    journal = remember(journal, item);
    // Lo guarda.
    await input.ports.persistJournal(item);
  };
  // Clave del manifiesto de contenido.
  const contentKey = contentManifestKey(versionId);
  // Clave del manifiesto del perfil.
  const profileKey = profileManifestKey(versionId, profileId);
  // Manifiesto de contenido serializado.
  const contentBody = serializeContentManifest(contentManifestFrom(input.manifest));
  // Manifiesto del perfil serializado.
  const profileBody = serializeManifest(input.manifest);

  // Escribe un objeto inmutable: si existe igual, vale; si existe distinto, es un conflicto.
  const putImmutable = async (key: string, body: string) => {
    // Objeto actual.
    const existing = await input.ports.getObject(key);
    // Ya está igual: éxito sin escribir.
    if (existing === body) {
      // Anota el éxito.
      await mark(
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: "succeeded",
          error: null,
          mutationId: null,
        }),
      );
      // Termina.
      return;
    }
    // Existe con otro contenido: no se sobrescribe.
    if (existing !== null) {
      // Anota el conflicto.
      await mark(
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: "failed",
          error: "r2-immutable-conflict",
          mutationId: null,
        }),
      );
      // Termina.
      return;
    }
    // Escribe y comprueba.
    try {
      // Escribe el objeto.
      await input.ports.putObject(key, body);
      // Lo lee de vuelta.
      const read = await input.ports.getObject(key);
      // Éxito solo si se lee igual.
      await mark(
        // Anotación del diario: almacén, versión, perfil y clave; outcome y error dicen cómo fue.
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          // Correcto solo si lo leído coincide byte a byte con lo escrito.
          outcome: read === body ? "succeeded" : "failed",
          error: read === body ? null : "r2-readback-mismatch",
          mutationId: null,
        }),
      );
    } catch {
      // Error de escritura.
      await mark(
        // Anota que la escritura en R2 lanzó un error.
        journalItem({
          store: "r2",
          versionId,
          profileId,
          key,
          outcome: "failed",
          error: "r2-write-failed",
          mutationId: null,
        }),
      );
    }
  };

  // Solo con documentos y fragmentos.
  if (input.manifest.documents.length > 0 && input.manifest.chunks.length > 0) {
    // Escribe cada documento.
    for (const document of input.manifest.documents) {
      // Documento inmutable en R2.
      await putImmutable(documentObjectKey(versionId, document.id), document.body);
    }
    // ¿Se escribieron todos los documentos?
    const documentsOk = input.manifest.documents.every((document) =>
      journal.some(
        (item) =>
          item.key === documentObjectKey(versionId, document.id) && item.outcome === "succeeded",
      ),
    );
    // Si sí, el manifiesto de contenido.
    if (documentsOk) {
      // Manifiesto de contenido inmutable.
      await putImmutable(contentKey, contentBody);
      // ¿Se escribió?
      const contentOk = journal.some(
        (item) => item.key === contentKey && item.outcome === "succeeded",
      );
      // Si sí, el manifiesto del perfil.
      if (contentOk) {
        // Este sí se puede reescribir.
        try {
          // Manifiesto actual.
          const current = await input.ports.getObject(profileKey);
          // Si es distinto, se escribe.
          if (current !== profileBody) {
            // Escribe.
            await input.ports.putObject(profileKey, profileBody);
          }
          // Lee de vuelta.
          const read = await input.ports.getObject(profileKey);
          // Anota el resultado.
          await mark(
            // Anota la comprobación del manifiesto del perfil en R2.
            journalItem({
              store: "r2",
              versionId,
              profileId,
              key: profileKey,
              outcome: read === profileBody ? "succeeded" : "failed",
              error: read === profileBody ? null : "r2-manifest-mismatch",
              mutationId: null,
            }),
          );
        } catch {
          // Anota el error.
          await mark(
            // Anota que escribir el manifiesto del perfil falló.
            journalItem({
              // Almacén, versión, perfil y clave del manifiesto del perfil.
              store: "r2",
              versionId,
              profileId,
              key: profileKey,
              // Resultado fallido con su motivo.
              outcome: "failed",
              error: "r2-write-failed",
              mutationId: null,
            }),
          );
        }
      }
    }
  }

  // ¿R2 listo?
  const r2Ready = journal.some((item) => item.key === profileKey && item.outcome === "succeeded");
  // Si sí, el catálogo en D1.
  if (r2Ready) {
    // Escribe y comprueba.
    try {
      // Escribe el catálogo.
      await input.ports.writeCatalog(input.manifest);
      // Lo lee.
      const catalog = await input.ports.readCatalog(versionId, profileId);
      // Compara con el manifiesto.
      const matches = catalogMatches(input.manifest, catalog);
      // Anota el resultado.
      await mark(
        // Anota la comprobación del catálogo en D1 (versión, documentos y fragmentos).
        journalItem({
          store: "d1",
          versionId,
          profileId,
          key: "catalog",
          outcome: matches ? "succeeded" : "failed",
          error: matches ? null : "d1-readback-mismatch",
          mutationId: null,
        }),
      );
    } catch {
      // Anota el error.
      await mark(
        // Anota que escribir el catálogo en D1 falló.
        journalItem({
          store: "d1",
          versionId,
          profileId,
          key: "catalog",
          outcome: "failed",
          error: "d1-write-failed",
          mutationId: null,
        }),
      );
    }
  }

  // Última mutación de Vectorize.
  let mutationId: string | null = null;
  // ¿D1 listo?
  const d1Ready = journal.some(
    (item) => item.store === "d1" && item.key === "catalog" && item.outcome === "succeeded",
  );
  // Descripción del índice, vacía hasta leerla.
  let described: IndexDescription = {
    name: null,
    dimensions: null,
    metric: null,
    vectorCount: null,
  };
  // Con D1 listo y embeddings disponibles se escribe Vectorize.
  if (d1Ready && input.vectors !== null) {
    // Errores de red se anotan como fallo.
    try {
      // Índices de metadatos existentes.
      const metadataIndexes = await input.ports.listMetadataIndexes();
      // Deben existir los tres que se filtran.
      const metadataReady = VECTORIZE_METADATA_INDEXES.every((name) =>
        metadataIndexes.includes(name),
      );
      // Faltan: no se insertan vectores que no se podrían filtrar.
      if (!metadataReady) {
        // Anota el fallo.
        await mark(
          // Sin índices de metadatos no se puede filtrar por versión, perfil y audiencia: se anota
          // como fallo.
          journalItem({
            store: "vectorize",
            versionId,
            profileId,
            key: "metadata-indexes",
            outcome: "failed",
            error: "metadata-indexes-missing",
            mutationId: null,
          }),
        );
      } else {
        // Valida los vectores.
        const writes = validateVectors(input.manifest, input.vectors);
        // Tamaño de lote.
        const upsertBatchSize = input.upsertBatchSize ?? VECTORIZE_UPSERT_BATCH;
        // Lotes.
        const groups = batchesOf(writes, upsertBatchSize);
        // true si Vectorize rechaza un lote.
        let rejected = false;
        // Escribe cada lote.
        for (const [index, batch] of groups.entries()) {
          // Clave del lote.
          const key = `vectors:batch:${String(index)}`;
          // ¿Ya se aceptó antes?
          const prior = journal.find(
            (item) => item.key === key && item.outcome === "succeeded" && item.mutationId !== null,
          );
          // Ya aceptado: no se repite.
          if (prior !== undefined) {
            // Recupera su mutación.
            mutationId = prior.mutationId;
            // Siguiente lote.
            continue;
          }
          // Inserta el lote.
          const result = await input.ports.upsertVectors(batch);
          // Sin id de mutación: rechazado.
          if (result.mutationId === null || result.mutationId.length === 0) {
            // Anota el rechazo.
            await mark(
              journalItem({
                store: "vectorize",
                versionId,
                profileId,
                key,
                outcome: "failed",
                error: "vectorize-write-rejected",
                mutationId: null,
              }),
            );
            // Marca el rechazo.
            rejected = true;
            // Deja de escribir.
            break;
          }
          // Guarda la mutación.
          mutationId = result.mutationId;
          // Anota el éxito del lote.
          await mark(
            // Anota el lote insertado y el id de mutación que devolvió Vectorize.
            journalItem({
              store: "vectorize",
              versionId,
              profileId,
              key,
              outcome: "succeeded",
              error: null,
              mutationId: result.mutationId,
            }),
          );
        }
        // Si todo se aceptó, se comprueba la visibilidad.
        if (!rejected) {
          // Lee los vectores escritos.
          const visible = await readVectorsInBatches(
            writes.map((vector) => vector.id),
            (ids) => input.ports.readVectors(ids),
            input.getBatchSize ?? VECTORIZE_GET_BATCH,
          );
          // Describe el índice.
          described = await input.ports.describeIndex();
          // Metadatos esperados por id.
          const expectedMetadata = new Map(
            writes.map((vector) => [vector.id, vector.metadata] as const),
          );
          // Clasifica la lectura.
          const classification = classifyIndexReadback({
            expectedIds: writes.map((vector) => vector.id),
            visible,
            expectedMetadata,
            dimensions: described.dimensions,
            expectedDimensions: input.manifest.dimensions,
            metric: described.metric,
            vectorCount: described.vectorCount,
            expectedIndexName: input.expectedIndexName ?? null,
            indexName: described.name,
          });
          // Reconcilia una lectura fallida tras una escritura aceptada, sin repetir el upsert
          // ni perder el estado pending-visibility.
          if (journal.some((item) => item.key === "vectors")) {
            // Actualiza la anotación de vectores anterior con el nuevo resultado.
            await mark(
              // Reescribe la anotación «vectors» con la clasificación de la lectura de vuelta.
              journalItem({
                store: "vectorize",
                versionId,
                profileId,
                key: "vectors",
                outcome: classification.outcome,
                error: classification.error,
                mutationId,
              }),
            );
          }
          // Visibles y comprobados.
          if (classification.outcome === "succeeded") {
            // Recibo de la configuración del índice.
            const receipt = `${JSON.stringify({
              indexName: described.name,
              dimensions: described.dimensions,
              metric: described.metric,
              vectorCount: described.vectorCount,
              mutationIds: journal
                .filter((item) => item.key.startsWith("vectors:batch:") && item.mutationId !== null)
                .map((item) => item.mutationId),
            })}\n`;
            // Clave del recibo.
            const receiptKey = indexConfigReceiptKey(versionId, profileId);
            // Lo escribe en R2.
            await input.ports.putObject(receiptKey, receipt);
            // Lo lee de vuelta.
            const read = await input.ports.getObject(receiptKey);
            // Si no coincide, la visibilidad falla.
            if (read !== receipt) {
              // Anota el fallo.
              await mark(
                // La configuración del índice leída no coincide con el recibo: fallo.
                journalItem({
                  store: "vectorize",
                  versionId,
                  profileId,
                  key: "vectors:visibility",
                  outcome: "failed",
                  error: "index-config-readback-mismatch",
                  mutationId,
                }),
              );
            } else {
              // Anota la visibilidad confirmada.
              await mark(
                // Visibilidad confirmada: los vectores se leen de vuelta con la configuración
                // esperada.
                journalItem({
                  store: "vectorize",
                  versionId,
                  profileId,
                  key: "vectors:visibility",
                  outcome: "succeeded",
                  error: null,
                  mutationId,
                }),
              );
            }
          } else {
            // Anota el resultado pendiente o fallido.
            await mark(
              // Aún no visibles (pending) o incongruentes (failed): se anota sin reenviar los
              // lotes.
              journalItem({
                // Almacén, versión, perfil y clave de visibilidad.
                store: "vectorize",
                versionId,
                profileId,
                key: "vectors:visibility",
                // Resultado y error de la clasificación, y la mutación.
                outcome: classification.outcome,
                error: classification.error,
                mutationId,
              }),
            );
          }
        }
      }
    } catch {
      // Error al escribir en Vectorize.
      await mark(
        // Anota que la escritura en Vectorize lanzó un error.
        journalItem({
          store: "vectorize",
          versionId,
          profileId,
          key: "vectors",
          outcome: "failed",
          error: "vectorize-write-failed",
          mutationId: null,
        }),
      );
    }
  }

  // Fase final.
  const phase = ingestionPhase({
    versionId,
    profileId,
    expectedDocuments: input.manifest.documents.length,
    expectedChunks: input.manifest.chunks.length,
    journal,
  });
  // Paso de visibilidad.
  const visibility = journal.find((item) => item.key === "vectors:visibility");
  // Guarda la fase y el último error.
  await input.ports.recordPhase({
    phase,
    mutationId,
    observedMetric: described.metric,
    lastError: visibility?.outcome === "succeeded" ? null : (visibility?.error ?? null),
  });
  // Resultado de la ingesta.
  return { phase, journal, mutationId };
}

// Decide qué perfil queda activo; solo uno listo puede sustituir al actual.
export function selectActiveProfile(input: {
  // Perfil pedido.
  requestedId: string;
  // Perfiles con su estado.
  profiles: readonly { id: string; status: IngestionPhase; active: boolean }[];
}): { activeId: string | null; changed: boolean; reason: string } {
  // Perfil activo actual.
  const current = input.profiles.find((profile) => profile.active) ?? null;
  // Perfil pedido.
  const requested = input.profiles.find((profile) => profile.id === input.requestedId) ?? null;
  // Si no existe o no está listo, no cambia nada.
  if (requested === null || requested.status !== "ready") {
    // Se mantiene el actual.
    return {
      activeId: current?.id ?? null,
      changed: false,
      reason: "La versión pedida no está lista. La versión activa no cambia.",
    };
  }
  // Perfil listo: pasa a ser el activo.
  return { activeId: requested.id, changed: current?.id !== requested.id, reason: "Perfil listo." };
}

// Aplica la selección a la lista de perfiles.
export function applyActiveSelection(
  profiles: readonly { id: string; status: IngestionPhase; active: boolean }[],
  requestedId: string,
): { id: string; status: IngestionPhase; active: boolean }[] {
  // Decisión.
  const decision = selectActiveProfile({ requestedId, profiles });
  // Sin cambio.
  if (!decision.changed) {
    // Copia de los perfiles.
    return profiles.map((profile) => ({ ...profile }));
  }
  // Activa solo el elegido.
  return profiles.map((profile) => ({ ...profile, active: profile.id === decision.activeId }));
}

// Orden de la ingesta, para documentarla y mostrarla.
export const INGEST_ORDER = [
  "Comprobar los índices de metadatos corpusVersion, audience y profileId antes de insertar.",
  "Escribir los documentos inmutables y el manifiesto de contenido en R2.",
  "Escribir el manifiesto del perfil en una clave que incluye profileId.",
  "Escribir el catálogo en D1 y leer identificadores, textos y el mapa vectorial.",
  "Insertar los embeddings que el diario no tenga ya aceptados y guardar cada mutación.",
  "Una lectura incompleta queda en pending-visibility. No se vuelve a insertar solo para esperar.",
  "Marcar listo solo con métrica observada, dimensión, recuento, identificadores y metadatos.",
  "Elegir la versión activa en una operación distinta. Un fallo no sustituye la anterior.",
] as const;

// Reexporta las claves de R2 para quien importe este módulo.
export { contentManifestKey, documentObjectKey, indexConfigReceiptKey, profileManifestKey };
