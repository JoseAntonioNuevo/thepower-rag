// GUÍA DE LECTURA · lab/src/pgvector-store.ts
// Almacén vectorial para el laboratorio de S10 y S11 sobre PostgreSQL + pgvector (columna vector(768)
// e índice HNSW vector_cosine_ops) y su doble en memoria con idéntico contrato para pruebas sin Docker.
// Lectura del esquema SQL.
import { readFileSync } from "node:fs";
// La preparación del esquema también se puede detener y observar en el Aula.
import type { AulaObserver } from "@thepower-rag/contracts";
// Rutas de archivos.
import path from "node:path";
// Configuración del índice HNSW y dimensión fija de 768.
import { LAB_EMBEDDING_DIMENSIONS, LAB_HNSW_INDEX } from "./config";
// Tipos del corpus preparado.
import type { LabDocument, LabPreparedChunk, LabPreparedCorpus } from "./corpus";
// Funciones de validación de 768 dimensiones y distancia/similitud coseno.
import {
  assertVector768,
  cosineDistance768,
  cosineSimilarity768,
  type LabEmbeddingProvider,
} from "./embeddings";

// Fragmento indexado devuelto por una consulta a pgvector.
export interface LabVectorHit {
  // Identificador estable del fragmento.
  chunkId: string;
  // Versión del corpus.
  corpusVersion: string;
  // Identificador del documento origen.
  documentId: string;
  // Posición dentro del documento.
  ordinal: number;
  // Título del documento.
  title: string;
  // Sección Markdown.
  section: string;
  // Texto completo del fragmento.
  content: string;
  // Modelo de embeddings con el que se indexó.
  embeddingModel: string;
  // Dimensión del vector (siempre 768).
  embeddingDimensions: 768;
  // Distancia coseno de pgvector (<=>), donde menor significa más próximo.
  cosineDistance: number;
  // Similitud coseno (1 - cosineDistance), donde mayor significa más próximo.
  similarity: number;
}

// Recibo devuelto tras vaciar y reconstruir el índice desde los documentos en bruto.
export interface LabRebuildReceipt {
  // Versión del corpus reconstruido.
  corpusVersion: string;
  // Modelo de embeddings registrado.
  embeddingModel: string;
  // Dimensión verificada (768).
  embeddingDimensions: 768;
  // Documentos insertados y leídos de vuelta.
  documentCount: number;
  // Fragmentos insertados y leídos de vuelta.
  chunkCount: number;
  // Índice HNSW verificado.
  hnswIndex: typeof LAB_HNSW_INDEX;
  // Si el índice se vació antes de reconstruir.
  rebuiltFromEmptyIndex: true;
}

// Interfaz del cliente SQL de PostgreSQL (compatible con Bun.SQL o adaptador pg).
export interface PostgresSqlExecutor {
  // Ejecuta una sentencia SQL parametrizada y devuelve las filas resultantes.
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sqlText: string,
    params?: readonly unknown[],
  ): Promise<Row[]>;
}

// Interfaz común del almacén pgvector del laboratorio.
export interface LabVectorStore {
  // Nombre del backend ("postgresql-pgvector" o "in-memory-pgvector").
  readonly backend: "postgresql-pgvector" | "in-memory-pgvector";
  // Vacía el índice y lo reconstruye desde los documentos y sus vectores de 768 dimensiones.
  rebuildFromEmptyIndex(input: {
    corpus: LabPreparedCorpus;
    embedder: LabEmbeddingProvider;
    observer?: AulaObserver;
    beforeWrite?: () => Promise<void>;
    signal?: AbortSignal;
  }): Promise<LabRebuildReceipt>;
  // Busca los k vecinos más próximos usando distancia coseno (<=>) sobre vector(768).
  queryNearest(input: {
    queryVector: readonly number[];
    corpusVersion: string;
    embeddingModel: string;
    topK: number;
  }): Promise<LabVectorHit[]>;
  // Cuenta los fragmentos actualmente almacenados para comprobar índice vacío o poblado.
  countChunks(corpusVersion?: string): Promise<number>;
}

// Formatea un vector de 768 números al literal `[x1,x2,...,x768]` que acepta `vector(768)` en pgvector.
export function formatPgVectorLiteral(vector: readonly number[]): string {
  // Valida que tenga exactamente 768 números finitos antes de serializar.
  assertVector768(vector, "formatPgVectorLiteral");
  // Literal de texto para `$1::vector(768)`.
  return `[${vector.map((value) => Number(value.toFixed(6))).join(",")}]`;
}

// Consulta compartida: el inspector muestra exactamente el SQL y los parámetros que ejecuta el almacén.
export function labNearestQuery(input: {
  queryVector: readonly number[];
  corpusVersion: string;
  embeddingModel: string;
  topK: number;
}) {
  const vectorLiteral = formatPgVectorLiteral(input.queryVector);
  return {
    sql: `SELECT
        chunk_id,
        corpus_version,
        document_id,
        ordinal,
        title,
        section,
        content,
        embedding_model,
        embedding_dimensions,
        (embedding <=> $1::vector(768)) AS cosine_distance,
        (1 - (embedding <=> $1::vector(768))) AS similarity
      FROM lab_chunks
      WHERE corpus_version = $2 AND embedding_model = $3
      ORDER BY embedding <=> $1::vector(768) ASC
      LIMIT $4`,
    parameters: [vectorLiteral, input.corpusVersion, input.embeddingModel, input.topK],
  };
}

// Separa `lab/schema.sql` en sentencias ejecutables ignorando comentarios `--` de línea completa.
export function parseLabSchemaStatements(sqlContent: string): string[] {
  // Quita líneas vacías o que empiezan por `--`.
  const withoutComments = sqlContent
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  // Corta por `;` y limpia espacios.
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// Almacén real sobre PostgreSQL + pgvector que ejecuta `lab/schema.sql` y consultas `<=>`.
export class PgVectorDatabaseStore implements LabVectorStore {
  // Etiqueta del backend real.
  public readonly backend = "postgresql-pgvector" as const;
  // Ejecutor SQL inyectado.
  private readonly sql: PostgresSqlExecutor;
  // Ruta al archivo `lab/schema.sql`.
  private readonly schemaPath: string;

  // Construye el almacén sobre un ejecutor SQL de PostgreSQL.
  public constructor(sql: PostgresSqlExecutor, schemaPath?: string) {
    // Guarda el ejecutor SQL.
    this.sql = sql;
    // Ruta por defecto a `lab/schema.sql`.
    this.schemaPath = schemaPath ?? path.resolve(import.meta.dirname, "../schema.sql");
  }

  // Reconstruye el sistema desde índice vacío aplicando el esquema `vector(768)` + HNSW.
  public async rebuildFromEmptyIndex(input: {
    corpus: LabPreparedCorpus;
    embedder: LabEmbeddingProvider;
    observer?: AulaObserver;
    beforeWrite?: () => Promise<void>;
    signal?: AbortSignal;
  }): Promise<LabRebuildReceipt> {
    // Verifica que el proveedor de embeddings sea de 768 dimensiones.
    if (input.embedder.dimensions !== LAB_EMBEDDING_DIMENSIONS) {
      // Rechaza dimensiones distintas de 768.
      throw new Error("El esquema PostgreSQL/pgvector exige embeddings de 768 dimensiones.");
    }
    // Lee y aplica las sentencias de `lab/schema.sql` (CREATE EXTENSION vector, tablas e índice HNSW).
    const statements = parseLabSchemaStatements(readFileSync(this.schemaPath, "utf8"));
    await input.observer?.before("schema", { statements });
    for (const statement of statements) {
      // Aplica cada sentencia de preparación del esquema mediante la conexión inyectada.
      await this.sql.query(statement);
    }
    await input.observer?.after("schema", { statementsApplied: statements.length });
    // Calcula y valida todo antes de tocar el índice anterior: un fallo de API lo conserva.
    const vectors = await input.embedder.embed(
      input.corpus.chunks.map((chunk) => `${chunk.title} ${chunk.section}\n${chunk.content}`),
    );
    // Comprueba la correspondencia uno a uno entre fragmentos y vectores antes de tocar el índice anterior.
    if (vectors.length !== input.corpus.chunks.length) {
      // Detiene el recorrido con el diagnóstico: El número de vectores devueltos no coincide con los fragmentos preparados.
      throw new Error("El número de vectores devueltos no coincide con los fragmentos preparados.");
    }
    // Valida las 768 componentes finitas de cada vector antes de entrar en la transacción.
    for (const vector of vectors) assertVector768(vector, "reconstrucción PostgreSQL");
    // La pausa docente ocurre antes de abrir la transacción.
    await input.beforeWrite?.();
    input.signal?.throwIfAborted();
    // El ejecutor mantiene una conexión; no se pausa mientras hay bloqueos de escritura.
    await this.sql.query("BEGIN");
    try {
      // Vacía las tablas para garantizar reconstrucción desde índice vacío.
      await this.sql.query("TRUNCATE TABLE lab_corpus_versions CASCADE");
      // Comprueba de vuelta que el índice quedó con 0 fragmentos.
      const emptyCount = await this.countChunks();
      // Confirma dentro de la transacción que el vaciado no dejó fragmentos antiguos.
      if (emptyCount !== 0) {
        // Detiene el recorrido con el diagnóstico: El índice no quedó vacío antes de reconstruir.
        throw new Error("El índice no quedó vacío antes de reconstruir.");
      }
      // Inserta el registro de versión del corpus.
      await this.sql.query(
        `INSERT INTO lab_corpus_versions (
        corpus_version, embedding_model, embedding_dimensions,
        chunk_size, chunk_overlap, document_count, chunk_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.corpus.corpusVersion,
          input.embedder.modelId,
          LAB_EMBEDDING_DIMENSIONS,
          input.corpus.chunking.maxChars,
          input.corpus.chunking.overlapChars,
          input.corpus.documents.length,
          input.corpus.chunks.length,
        ],
      );
      // Inserta cada documento limpio.
      for (const doc of input.corpus.documents) {
        // Escribe el documento con parámetros separados del SQL para conservar texto y metadatos.
        await this.sql.query(
          `INSERT INTO lab_documents (
          document_id, corpus_version, title, source_path, content_hash
        ) VALUES ($1, $2, $3, $4, $5)`,
          [doc.documentId, input.corpus.corpusVersion, doc.title, doc.sourcePath, doc.contentHash],
        );
      }
      // Inserta cada fragmento con su literal `vector(768)`.
      for (let index = 0; index < input.corpus.chunks.length; index += 1) {
        // Fragmento y vector correspondientes.
        const chunk = input.corpus.chunks[index]!;
        // Toma el vector de la misma posición que el fragmento preparado.
        const vector = vectors[index]!;
        // Serializa el vector validado al literal que acepta el tipo vector(768).
        const vectorLiteral = formatPgVectorLiteral(vector);
        // Inserta el fragmento y su embedding con identidad de corpus, modelo y dimensión.
        await this.sql.query(
          `INSERT INTO lab_chunks (
          chunk_id, corpus_version, document_id, ordinal, title, section,
          content, embedding_model, embedding_dimensions, embedding
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector(768))`,
          [
            chunk.chunkId,
            chunk.corpusVersion,
            chunk.documentId,
            chunk.ordinal,
            chunk.title,
            chunk.section,
            chunk.content,
            input.embedder.modelId,
            LAB_EMBEDDING_DIMENSIONS,
            vectorLiteral,
          ],
        );
      }
      // Lee de vuelta el conteo de fragmentos insertados.
      const chunkCount = await this.countChunks(input.corpus.corpusVersion);
      // Comprueba que la lectura de vuelta tenga exactamente el número de fragmentos esperado.
      if (chunkCount !== input.corpus.chunks.length) {
        // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
        throw new Error(
          "La lectura de vuelta en PostgreSQL no coincide con los fragmentos insertados.",
        );
      }
      // Publica el índice completo solo después de comprobarlo en la misma transacción.
      input.signal?.throwIfAborted();
      await this.sql.query("COMMIT");
      // Devuelve el recibo verificado.
      return {
        corpusVersion: input.corpus.corpusVersion,
        embeddingModel: input.embedder.modelId,
        embeddingDimensions: LAB_EMBEDDING_DIMENSIONS,
        documentCount: input.corpus.documents.length,
        chunkCount,
        hnswIndex: LAB_HNSW_INDEX,
        rebuiltFromEmptyIndex: true,
      };
    } catch (error) {
      // Deshace las escrituras de esta transacción para conservar la versión anterior si falla un paso.
      await this.sql.query("ROLLBACK");
      // Propaga el error original para que el llamador no confunda el fallo con un resultado válido.
      throw error;
    }
  }

  // Busca vecinos por distancia coseno (`<=>`) sobre la columna `vector(768)`.
  public async queryNearest(input: {
    queryVector: readonly number[];
    corpusVersion: string;
    embeddingModel: string;
    topK: number;
  }): Promise<LabVectorHit[]> {
    // Valida que la consulta tenga exactamente 768 dimensiones.
    const statement = labNearestQuery(input);
    // Consulta parametrizada ordenando por menor distancia coseno (`embedding <=> $1::vector(768) ASC`).
    const rows = await this.sql.query<{
      chunk_id: string;
      corpus_version: string;
      document_id: string;
      ordinal: number;
      title: string;
      section: string;
      content: string;
      embedding_model: string;
      embedding_dimensions: number;
      cosine_distance: number;
      similarity: number;
    }>(statement.sql, statement.parameters);
    // Convierte cada fila al contrato `LabVectorHit`.
    return rows.map((row) => ({
      chunkId: String(row.chunk_id),
      corpusVersion: String(row.corpus_version),
      documentId: String(row.document_id),
      ordinal: Number(row.ordinal),
      title: String(row.title),
      section: String(row.section),
      content: String(row.content),
      embeddingModel: String(row.embedding_model),
      embeddingDimensions: LAB_EMBEDDING_DIMENSIONS,
      cosineDistance: Number(Number(row.cosine_distance).toFixed(6)),
      similarity: Number(Number(row.similarity).toFixed(6)),
    }));
  }

  // Cuenta los fragmentos en `lab_chunks` para una versión o en total.
  public async countChunks(corpusVersion?: string): Promise<number> {
    // Consulta con o sin filtro de versión.
    const rows =
      corpusVersion !== undefined
        ? await this.sql.query<{ total: number | string }>(
            "SELECT COUNT(*) AS total FROM lab_chunks WHERE corpus_version = $1",
            [corpusVersion],
          )
        : await this.sql.query<{ total: number | string }>(
            "SELECT COUNT(*) AS total FROM lab_chunks",
          );
    // Convierte el conteo a entero.
    return Number(rows[0]?.total ?? 0);
  }
}

// Almacén en memoria compatible con pgvector (`vector(768)` + `<=>`) para ejecución sin Docker.
export class InMemoryPgVectorStore implements LabVectorStore {
  // Etiqueta del backend en memoria.
  public readonly backend = "in-memory-pgvector" as const;
  // Documentos almacenados tras la última reconstrucción.
  private documents: LabDocument[] = [];
  // Fragmentos almacenados con su vector de 768 dimensiones.
  private rows: (LabPreparedChunk & {
    embeddingModel: string;
    embeddingDimensions: 768;
    embedding: number[];
  })[] = [];

  // Vacía el almacén y reconstruye el índice desde cero verificando 768 dimensiones.
  public async rebuildFromEmptyIndex(input: {
    corpus: LabPreparedCorpus;
    embedder: LabEmbeddingProvider;
    observer?: AulaObserver;
    beforeWrite?: () => Promise<void>;
    signal?: AbortSignal;
  }): Promise<LabRebuildReceipt> {
    // Exige 768 dimensiones exactas.
    if (input.embedder.dimensions !== LAB_EMBEDDING_DIMENSIONS) {
      // Detiene el recorrido con el diagnóstico: El almacén pgvector exige vectores de 768 dimensiones.
      throw new Error("El almacén pgvector exige vectores de 768 dimensiones.");
    }
    // Vacía documentos y fragmentos previos (índice vacío).
    this.documents = [];
    // Vacía las filas del doble en memoria antes de reconstruir su índice de demostración.
    this.rows = [];
    // Calcula los vectores de 768 dimensiones (incluyendo título y sección).
    const vectors = await input.embedder.embed(
      input.corpus.chunks.map((chunk) => `${chunk.title} ${chunk.section}\n${chunk.content}`),
    );
    // También en memoria exige un vector por fragmento para reproducir el contrato del almacén.
    if (vectors.length !== input.corpus.chunks.length) {
      // Detiene el recorrido con el diagnóstico: El número de vectores no coincide con el número de fragmentos.
      throw new Error("El número de vectores no coincide con el número de fragmentos.");
    }
    // Guarda los documentos.
    this.documents = [...input.corpus.documents];
    // Valida e inserta cada fragmento con su vector de 768 dimensiones.
    for (let index = 0; index < input.corpus.chunks.length; index += 1) {
      // Toma el fragmento preparado correspondiente a la posición actual.
      const chunk = input.corpus.chunks[index]!;
      // Asocia el vector devuelto en esa misma posición del lote.
      const vector = vectors[index]!;
      // Aplica la validación de 768 dimensiones también al doble en memoria.
      assertVector768(vector, `rebuildFromEmptyIndex(${chunk.chunkId})`);
      // Guarda fragmento, documento y vector juntos para simular las consultas posteriores.
      this.rows.push({
        ...chunk,
        embeddingModel: input.embedder.modelId,
        embeddingDimensions: LAB_EMBEDDING_DIMENSIONS,
        embedding: [...vector],
      });
    }
    // Comprueba lectura de vuelta.
    const chunkCount = await this.countChunks(input.corpus.corpusVersion);
    return {
      corpusVersion: input.corpus.corpusVersion,
      embeddingModel: input.embedder.modelId,
      embeddingDimensions: LAB_EMBEDDING_DIMENSIONS,
      documentCount: this.documents.length,
      chunkCount,
      hnswIndex: LAB_HNSW_INDEX,
      rebuiltFromEmptyIndex: true,
    };
  }

  // Consulta los `topK` fragmentos más cercanos por distancia coseno `<=>` en 768 dimensiones.
  public async queryNearest(input: {
    queryVector: readonly number[];
    corpusVersion: string;
    embeddingModel: string;
    topK: number;
  }): Promise<LabVectorHit[]> {
    // Comprueba que el vector de consulta tenga 768 dimensiones.
    assertVector768(input.queryVector, "queryNearest(queryVector)");
    // Filtra por versión de corpus y modelo de embeddings (impide mezclar modelos distintos).
    const candidates = this.rows.filter(
      (row) =>
        row.corpusVersion === input.corpusVersion && row.embeddingModel === input.embeddingModel,
    );
    // Calcula distancia coseno `<=>` (menor = más cercano) y similitud `1 - distancia`.
    return candidates
      .map((row): LabVectorHit => {
        // Calcula la distancia coseno que en PostgreSQL produciría el operador <=>.
        const cosineDistance = cosineDistance768(input.queryVector, row.embedding);
        // Calcula la similitud coseno equivalente que usará el umbral de selección.
        const similarity = cosineSimilarity768(input.queryVector, row.embedding);
        return {
          chunkId: row.chunkId,
          corpusVersion: row.corpusVersion,
          documentId: row.documentId,
          ordinal: row.ordinal,
          title: row.title,
          section: row.section,
          content: row.content,
          embeddingModel: row.embeddingModel,
          embeddingDimensions: row.embeddingDimensions,
          cosineDistance,
          similarity,
        };
      })
      .sort(
        (left, right) =>
          left.cosineDistance - right.cosineDistance || left.chunkId.localeCompare(right.chunkId),
      )
      .slice(0, Math.max(1, input.topK));
  }

  // Cuenta los fragmentos en el índice.
  public async countChunks(corpusVersion?: string): Promise<number> {
    // Si se indica versión, filtra por ella.
    if (corpusVersion !== undefined) {
      // Cuenta solo las filas del corpus solicitado, igual que el filtro del almacén SQL.
      return this.rows.filter((row) => row.corpusVersion === corpusVersion).length;
    }
    return this.rows.length;
  }
}
