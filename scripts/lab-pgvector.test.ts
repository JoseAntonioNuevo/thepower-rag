// GUÍA DE LECTURA · scripts/lab-pgvector.test.ts
// Pruebas del laboratorio reproducible de S10 y S11: reconstrucción desde 10 documentos ficticios e
// índice vacío, esquema PostgreSQL/pgvector con vector(768) e índice HNSW, umbral de RAG básico,
// grafo CRAG con nodos separados retrieve -> rerank -> assess y evaluación de 20 preguntas (14+6).
// Rutas de archivos.
import path from "node:path";
// Utilidades de test de Vite+.
import { describe, expect, it } from "vite-plus/test";
// Módulos del laboratorio reproducible.
import {
  InMemoryPgVectorStore,
  LAB_CRAG_CONFIG,
  LAB_EMBEDDING_DIMENSIONS,
  LAB_TEST_SET_20,
  LAB_VALIDATION_SET,
  PgVectorDatabaseStore,
  createDeterministic768EmbeddingProvider,
  formatQwen3RerankerPrompt,
  prepareLabCorpusFromDirectory,
  resolveLabConfig,
  runLabBasicRag,
  runLabComparison20,
  runLabCrag,
  type PostgresSqlExecutor,
} from "../lab/src/index";

// Carpeta con los 10 documentos ficticios de AetherCloud.
const sourcesDir = path.join(import.meta.dirname, "../lab/corpus/sources");

// Grupo de pruebas del laboratorio S10 y S11.
describe("laboratorio reproducible S10 y S11 (pgvector 768 + HNSW + CRAG)", () => {
  // Verifica los 10 documentos ficticios, los vectores de 768 d y el esquema SQL con HNSW.
  it("reconstruye el sistema desde 10 documentos en bruto e índice vacío sobre PostgreSQL/pgvector (vector(768) + HNSW)", async () => {
    // Prepara el corpus desde los archivos Markdown en bruto.
    const corpus = prepareLabCorpusFromDirectory(sourcesDir);
    // Hay al menos 8 documentos ficticios (10 en el laboratorio).
    expect(corpus.documents.length).toBeGreaterThanOrEqual(8);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(corpus.documents.length).toBe(10);
    // Comprueba que la medida alcance el límite inferior esperado.
    expect(corpus.chunks.length).toBeGreaterThanOrEqual(16);

    // Doble de ejecutor SQL de PostgreSQL para verificar las sentencias exactas de pgvector.
    const executedSql: { sqlText: string; params: readonly unknown[] }[] = [];
    // Simula el conteo de filas para contrastar vaciado, inserciones y lectura de vuelta.
    let storedCount = 0;
    // Reconoce el SQL del almacén sin abrir una base PostgreSQL.
    const mockSql: PostgresSqlExecutor = {
      // Doble de prueba: ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
      async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        sqlText: string,
        params: readonly unknown[] = [],
      ): Promise<Row[]> {
        // Captura la sentencia y sus parámetros para verificar después el contrato de pgvector.
        executedSql.push({ sqlText, params });
        // El vaciado debe reiniciar las filas contadas por este doble.
        if (sqlText.startsWith("TRUNCATE TABLE")) {
          storedCount = 0;
          // Entrega una colección vacía para representar que esta rama no aporta elementos.
          return [];
        }
        // Cada inserción aumenta el conteo que después devolverá la consulta de comprobación.
        if (sqlText.startsWith("INSERT INTO lab_chunks")) {
          storedCount += 1;
          // Entrega una colección vacía para representar que esta rama no aporta elementos.
          return [];
        }
        // La lectura refleja el efecto de las escrituras, en vez de devolver siempre un valor fijo.
        if (sqlText.startsWith("SELECT COUNT(*) AS total FROM lab_chunks")) {
          return [{ total: storedCount } as unknown as Row];
        }
        // La búsqueda por distancia coseno recibe un vecino controlado para comprobar el mapeo de columnas.
        if (sqlText.includes("ORDER BY embedding <=> $1::vector(768) ASC")) {
          const firstChunk = corpus.chunks[0]!;
          return [
            {
              chunk_id: firstChunk.chunkId,
              corpus_version: firstChunk.corpusVersion,
              document_id: firstChunk.documentId,
              ordinal: firstChunk.ordinal,
              title: firstChunk.title,
              section: firstChunk.section,
              content: firstChunk.content,
              embedding_model: "gemini-embedding-2",
              embedding_dimensions: 768,
              cosine_distance: 0.18,
              similarity: 0.82,
            } as unknown as Row,
          ];
        }
        // Entrega una colección vacía para representar que esta rama no aporta elementos.
        return [];
      },
    };

    // Instancia del almacén PostgreSQL/pgvector.
    const pgStore = new PgVectorDatabaseStore(mockSql);
    // Crea embeddings léxicos deterministas de demostración; este proveedor no consulta un modelo semántico.
    const embedder = createDeterministic768EmbeddingProvider("gemini-embedding-2");
    // Reconstruye el índice del ensayo con los documentos preparados y el proveedor inyectado.
    const receipt = await pgStore.rebuildFromEmptyIndex({ corpus, embedder });

    // Verifica el recibo de reconstrucción.
    expect(receipt.rebuiltFromEmptyIndex).toBe(true);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(receipt.embeddingDimensions).toBe(LAB_EMBEDDING_DIMENSIONS);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(receipt.documentCount).toBe(10);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(receipt.chunkCount).toBe(corpus.chunks.length);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(receipt.hnswIndex.operatorClass).toBe("vector_cosine_ops");

    // Verifica que se ejecutaron CREATE EXTENSION vector, vector(768), USING hnsw y TRUNCATE.
    const allSql = executedSql.map((item) => item.sqlText).join("\n");
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(allSql).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(allSql).toContain("embedding vector(768) NOT NULL");
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(allSql).toContain("USING hnsw (embedding vector_cosine_ops)");
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(allSql).toContain("TRUNCATE TABLE lab_corpus_versions CASCADE");

    // Verifica que la consulta usa el operador de distancia coseno `<=>` con `::vector(768)`.
    const [qVec] = await embedder.embed(["regiones europeas de AetherCloud"]);
    // Recupera los vecinos del corpus y modelo solicitados ordenados por distancia coseno.
    const hits = await pgStore.queryNearest({
      queryVector: qVec!,
      corpusVersion: corpus.corpusVersion,
      embeddingModel: "gemini-embedding-2",
      topK: 4,
    });
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(hits).toHaveLength(1);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(hits[0]?.cosineDistance).toBe(0.18);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(hits[0]?.similarity).toBe(0.82);
  });

  // Verifica el RAG básico de S10: respuesta citada, rechazo previo sin llamar al generador y protección de datos.
  it("S10 RAG básico selecciona por puntuación, cita ids reales y rechaza sin llamar al generador", async () => {
    // Resuelve los parámetros del laboratorio a partir del entorno suministrado.
    const config = resolveLabConfig({});
    // Prepara los documentos del laboratorio con versiones e identificadores de fragmento reproducibles.
    const corpus = prepareLabCorpusFromDirectory(sourcesDir);
    // Crea embeddings léxicos deterministas de demostración; este proveedor no consulta un modelo semántico.
    const embedder = createDeterministic768EmbeddingProvider(config.embeddingModelId);
    // Usa el doble en memoria de pgvector para recorrer el mismo contrato sin abrir PostgreSQL.
    const store = new InMemoryPgVectorStore();
    // Reconstruye el índice del ensayo con los documentos preparados y el proveedor inyectado.
    await store.rebuildFromEmptyIndex({ corpus, embedder });

    // Pregunta respondible sobre cifrado y enfriamiento de CMK.
    let genCalls = 0;
    // Ejecuta recuperación, corte de similitud y generación condicionada para este caso RAG.
    const answered = await runLabBasicRag({
      question:
        "¿Con qué algoritmo se cifran los volúmenes en reposo y qué periodo de enfriamiento exige destruir una CMK?",
      corpusVersion: corpus.corpusVersion,
      config,
      store,
      embedder,
      // Doble de prueba: genera una respuesta con la pregunta y los fragmentos suministrados por el pipeline.
      generator: (q, selected) => {
        genCalls += 1;
        // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
        expect(q).toContain("CMK");
        return `Se cifra con AES-256-GCM y requiere 72 horas [cite:${selected[0]!.chunkId}] [cite:id-inventado-falso].`;
      },
    });
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(answered.decision).toBe("answer");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(answered.generationCalled).toBe(true);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(genCalls).toBe(1);
    // Filtra la cita inventada y conserva solo la cita real seleccionada.
    expect(answered.answer).not.toContain("id-inventado-falso");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(answered.citations.some((id) => id.includes("04-almacenamiento-y-cifrado-kms"))).toBe(
      true,
    );

    // Pregunta sin apoyo documental: el control previo rechaza sin invocar al generador.
    let refusedGenCalls = 0;
    // Ejecuta recuperación, corte de similitud y generación condicionada para este caso RAG.
    const refused = await runLabBasicRag({
      question: "¿Qué coste mensual tienen las licencias dedicadas de Windows Server 2025?",
      corpusVersion: corpus.corpusVersion,
      config,
      store,
      embedder,
      // Doble de prueba: genera una respuesta con la pregunta y los fragmentos suministrados por el pipeline.
      generator: () => {
        refusedGenCalls += 1;
        return "no debería ejecutarse";
      },
    });
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(refused.decision).toBe("refuse");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(refused.generationCalled).toBe(false);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(refusedGenCalls).toBe(0);
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(refused.citations).toEqual([]);
  });

  // Verifica S11 CRAG: separación de nodos retrieve -> rerank -> assess, evidencia parcial, descarte y tope de 3 búsquedas.
  it("S11 CRAG separa retrieve, rerank y assess, resuelve evidencia parcial y corta a las 3 búsquedas", async () => {
    // Resuelve los parámetros del laboratorio a partir del entorno suministrado.
    const config = resolveLabConfig({});
    // Prepara los documentos del laboratorio con versiones e identificadores de fragmento reproducibles.
    const corpus = prepareLabCorpusFromDirectory(sourcesDir);
    // Crea embeddings léxicos deterministas de demostración; este proveedor no consulta un modelo semántico.
    const embedder = createDeterministic768EmbeddingProvider(config.embeddingModelId);
    // Usa el doble en memoria de pgvector para recorrer el mismo contrato sin abrir PostgreSQL.
    const store = new InMemoryPgVectorStore();
    // Reconstruye el índice del ensayo con los documentos preparados y el proveedor inyectado.
    await store.rebuildFromEmptyIndex({ corpus, embedder });

    // Verifica también la plantilla oficial de Qwen3-Reranker-0.6B.
    const prompt = formatQwen3RerankerPrompt({
      query: "mTLS X-Aether-Tenant",
      document: "Certificados emitidos por AetherCA-G2.",
    });
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(prompt).toContain('Note that the answer can only be "yes" or "no".');
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(prompt).toContain("<Query>: mTLS X-Aether-Tenant");

    // Caso 1: pregunta compuesta donde la primera búsqueda es parcial y la segunda completa la cobertura.
    const composite = await runLabCrag({
      question:
        "¿Cómo se autentican los clientes mTLS con X-Aether-Tenant y qué tiempo máximo de primera respuesta aplica si cae todo el plano de datos en un incidente SEV-1?",
      corpusVersion: corpus.corpusVersion,
      config,
      store,
      embedder,
      // En el intento 1 simulamos que solo se recupera el documento de mTLS (relevancia alta, cobertura parcial).
      assessor: ({ reranked, attempt }) => {
        // Localiza evidencia de autenticación mTLS dentro de los candidatos reordenados.
        const mtlsChunk = reranked.find((item) =>
          item.hit.documentId.includes("02-autenticacion-mtls-tokens"),
        );
        // Busca por separado el documento de incidentes que cubrirá el segundo aspecto de la pregunta.
        const sevChunk = reranked.find((item) =>
          item.hit.documentId.includes("06-respuesta-a-incidentes"),
        );
        if (attempt === 1 && mtlsChunk) {
          return {
            status: "partial",
            coverageScore: 0.5,
            maxChunkRelevance: mtlsChunk.rerankScore,
            reason: "Relevancia alta en mTLS, pero falta el tiempo de primera respuesta SEV-1.",
            gaps: [
              "Falta evidencia documental sobre: tiempo máximo de primera respuesta en incidente SEV-1",
            ],
            usefulIds: [mtlsChunk.hit.chunkId],
          };
        }
        // Declara cobertura suficiente y filtra ids ausentes antes de entregar la evidencia útil.
        return {
          status: "sufficient",
          coverageScore: 0.9,
          maxChunkRelevance: Math.max(mtlsChunk?.rerankScore ?? 0.8, sevChunk?.rerankScore ?? 0.85),
          reason: "Ambos aspectos (mTLS y SEV-1) están cubiertos.",
          gaps: [],
          usefulIds: [mtlsChunk?.hit.chunkId, sevChunk?.hit.chunkId].filter((id): id is string =>
            Boolean(id),
          ),
        };
      },
    });
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(composite.decision).toBe("answer");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(composite.retrievalCount).toBe(2);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(composite.reformulationCount).toBe(1);
    // Recorre explícitamente retrieve -> rerank -> assess -> retain -> reformulate -> retrieve -> rerank -> assess -> answer.
    expect(composite.visitedNodes).toEqual([
      "retrieve",
      "rerank",
      "assess",
      "retain",
      "reformulate",
      "retrieve",
      "rerank",
      "assess",
      "answer",
    ]);
    // Cita ambos documentos sin duplicar ids.
    expect(composite.citations.some((id) => id.includes("02-autenticacion-mtls-tokens"))).toBe(
      true,
    );
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(composite.citations.some((id) => id.includes("06-respuesta-a-incidentes"))).toBe(true);

    // Caso 2: pregunta sin respuesta en el corpus -> 3 búsquedas, 2 reformulaciones y rechazo sin generar.
    const exhausted = await runLabCrag({
      question: "¿Qué descuento ofrece AetherCloud por pagar con criptomonedas?",
      corpusVersion: corpus.corpusVersion,
      config,
      store,
      embedder,
    });
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(exhausted.decision).toBe("refuse");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(exhausted.retrievalCount).toBe(LAB_CRAG_CONFIG.maxRetrievals);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(exhausted.reformulationCount).toBe(LAB_CRAG_CONFIG.maxReformulations);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(exhausted.generationCalled).toBe(false);
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(exhausted.citations).toEqual([]);
  });

  // Verifica que el conjunto de validación (6) y el de test (20: 14+6) son disjuntos y ejecuta la comparación completa.
  it("ejecuta la comparación de 20 preguntas nuevas (14 respondibles y 6 sin respuesta) entre RAG básico y CRAG", async () => {
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_VALIDATION_SET).toHaveLength(6);
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_TEST_SET_20).toHaveLength(20);
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_TEST_SET_20.filter((item) => item.answerable)).toHaveLength(14);
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_TEST_SET_20.filter((item) => !item.answerable)).toHaveLength(6);

    // Ninguna pregunta de validación aparece en el conjunto de test de 20 preguntas.
    const validationQuestions = new Set(LAB_VALIDATION_SET.map((item) => item.question));
    for (const testCase of LAB_TEST_SET_20) {
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(validationQuestions.has(testCase.question)).toBe(false);
    }

    // Resuelve los parámetros del laboratorio a partir del entorno suministrado.
    const config = resolveLabConfig({});
    // Prepara los documentos del laboratorio con versiones e identificadores de fragmento reproducibles.
    const corpus = prepareLabCorpusFromDirectory(sourcesDir);
    // Crea embeddings léxicos deterministas de demostración; este proveedor no consulta un modelo semántico.
    const embedder = createDeterministic768EmbeddingProvider(config.embeddingModelId);
    // Usa el doble en memoria de pgvector para recorrer el mismo contrato sin abrir PostgreSQL.
    const store = new InMemoryPgVectorStore();

    // Ejecuta los veinte casos de la comparación docente con parámetros idénticos entre etapas.
    const report = await runLabComparison20({ corpus, config, store, embedder });
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(report.items).toHaveLength(40);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(report.ragSummary.refusalCorrect).toBe(6);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(report.cragSummary.refusalCorrect).toBe(6);
    // Comprueba que la medida alcance el límite inferior esperado.
    expect(report.ragSummary.answerableCorrect).toBeGreaterThanOrEqual(10);
    // Comprueba que la medida supere el límite esperado.
    expect(report.cragSummary.answerableCorrect).toBeGreaterThan(
      report.ragSummary.answerableCorrect,
    );
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(report.ragSummary.averageRetrievals).toBe(1);
    // Comprueba que la medida supere el límite esperado.
    expect(report.cragSummary.averageRetrievals).toBeGreaterThan(1);
  });
});
