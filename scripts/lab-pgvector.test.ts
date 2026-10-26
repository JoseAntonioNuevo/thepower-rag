// GUÍA DE LECTURA · scripts/lab-pgvector.test.ts
// Pruebas del laboratorio reproducible de S10 y S11: reconstrucción desde 12 documentos de ThePower Shop e
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
  LAB_DEMO_CASES,
  LAB_TEST_SET_20,
  LAB_VALIDATION_SET,
  decideLabSufficiency,
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

// Carpeta con los 12 documentos ficticios de ThePower Shop, un marketplace inventado.
const sourcesDir = path.join(import.meta.dirname, "../lab/corpus/sources");

// Grupo de pruebas del laboratorio S10 y S11.
describe("laboratorio reproducible S10 y S11 (pgvector 768 + HNSW + CRAG)", () => {
  // Verifica los 12 documentos ficticios, los vectores de 768 d y el esquema SQL con HNSW.
  it("reconstruye el sistema desde 12 documentos en bruto e índice vacío sobre PostgreSQL/pgvector (vector(768) + HNSW)", async () => {
    // Prepara el corpus desde los archivos Markdown en bruto.
    const corpus = prepareLabCorpusFromDirectory(sourcesDir);
    // Hay al menos 8 documentos ficticios (12 en el laboratorio).
    expect(corpus.documents.length).toBeGreaterThanOrEqual(8);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(corpus.documents.length).toBe(12);
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
    expect(receipt.documentCount).toBe(12);
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
    const [qVec] = await embedder.embed(["zonas de envío de ThePower Shop"]);
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

    // Pregunta respondible sobre el horario del chat.
    let genCalls = 0;
    // Ejecuta recuperación, corte de similitud y generación condicionada para este caso RAG.
    const answered = await runLabBasicRag({
      question: "¿En qué horario atiende el chat de la aplicación de ThePower Shop?",
      corpusVersion: corpus.corpusVersion,
      config,
      store,
      embedder,
      // Doble de prueba: genera una respuesta con la pregunta y los fragmentos suministrados por el pipeline.
      generator: (q, selected) => {
        genCalls += 1;
        // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
        expect(q).toContain("chat");
        return `El chat atiende de 8:00 a 22:00 [cite:${selected[0]!.chunkId}] [cite:id-inventado-falso].`;
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
    expect(answered.citations.some((id) => id.includes("11-atencion-al-cliente"))).toBe(true);

    // Pregunta sin apoyo documental: el control previo rechaza sin invocar al generador.
    let refusedGenCalls = 0;
    // Ejecuta recuperación, corte de similitud y generación condicionada para este caso RAG.
    const refused = await runLabBasicRag({
      question: "¿Qué descuento tienen los estudiantes universitarios en ThePower Shop?",
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
      query: "plazo de abono Bizum",
      document: "El abono tarda 2 días hábiles en Bizum.",
    });
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(prompt).toContain('Note that the answer can only be "yes" or "no".');
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(prompt).toContain("<Query>: plazo de abono Bizum");

    // Caso 1: pregunta compuesta donde la primera búsqueda es parcial y la segunda completa la cobertura.
    const composite = await runLabCrag({
      question: LAB_DEMO_CASES[0]!.question,
      corpusVersion: corpus.corpusVersion,
      config,
      store,
      embedder,
      // En el intento 1 simulamos que devoluciones remite a pagos (relevancia alta, cobertura parcial).
      assessor: ({ reranked, attempt }) => {
        // Localiza la política de devoluciones dentro de los candidatos reordenados.
        const refund = reranked.find((item) => item.hit.documentId === "02-devoluciones");
        // Busca por separado la política de pagos, que trae el plazo de Bizum.
        const payments = reranked.find((item) => item.hit.documentId === "06-pagos-y-reembolsos");
        if (attempt === 1 && refund) {
          return {
            status: "partial",
            coverageScore: 0.5,
            maxChunkRelevance: refund.rerankScore,
            reason: "Devoluciones cubre la validación, pero falta el abono de Bizum.",
            gaps: ["Plazo de abono de un reembolso pagado con Bizum"],
            usefulIds: [refund.hit.chunkId],
          };
        }
        // Declara cobertura suficiente y filtra ids ausentes antes de entregar la evidencia útil.
        return {
          status: "sufficient",
          coverageScore: 0.9,
          maxChunkRelevance: Math.max(refund?.rerankScore ?? 0.8, payments?.rerankScore ?? 0.85),
          reason: "Validación y abono cubiertos.",
          gaps: [],
          usefulIds: [refund?.hit.chunkId, payments?.hit.chunkId].filter((id): id is string =>
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
    expect(composite.citations.some((id) => id.includes("02-devoluciones"))).toBe(true);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(composite.citations.some((id) => id.includes("06-pagos-y-reembolsos"))).toBe(true);

    // Caso 2: pregunta sin respuesta en el corpus -> 3 búsquedas, 2 reformulaciones y rechazo sin generar.
    const exhausted = await runLabCrag({
      question: LAB_DEMO_CASES[5]!.question,
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

  // Verifica que validación, demostración y test son disjuntos y ejecuta la comparación completa sin red.
  it("ejecuta la comparación de 20 preguntas nuevas (14 respondibles y 6 sin respuesta) entre RAG básico y CRAG", async () => {
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_VALIDATION_SET).toHaveLength(6);
    // Seis casos de demostración visibles.
    expect(LAB_DEMO_CASES).toHaveLength(6);
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_TEST_SET_20).toHaveLength(20);
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_TEST_SET_20.filter((item) => item.answerable)).toHaveLength(14);
    // Comprueba la cantidad de elementos para detectar pérdidas o duplicados en el recorrido.
    expect(LAB_TEST_SET_20.filter((item) => !item.answerable)).toHaveLength(6);

    // Ninguna pregunta de validación o de demostración aparece en el test de 20 preguntas.
    const visibleQuestions = new Set(
      [...LAB_VALIDATION_SET, ...LAB_DEMO_CASES].map((item) => item.question),
    );
    for (const testCase of LAB_TEST_SET_20) {
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(visibleQuestions.has(testCase.question)).toBe(false);
    }
    // Cada documento esperado existe en el corpus.
    const corpusForIds = prepareLabCorpusFromDirectory(sourcesDir);
    const documentIds = new Set(corpusForIds.documents.map((doc) => doc.documentId));
    for (const item of [...LAB_VALIDATION_SET, ...LAB_DEMO_CASES, ...LAB_TEST_SET_20]) {
      // Un id de documento mal escrito invalidaría la corrección.
      for (const documentId of item.expectedDocuments)
        expect(documentIds.has(documentId)).toBe(true);
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
    // RAG básico hace siempre una búsqueda.
    expect(report.ragSummary.averageRetrievals).toBe(1);
    // CRAG nunca supera tres búsquedas ni dos reformulaciones por pregunta.
    for (const item of report.items.filter((entry) => entry.stage === "crag")) {
      // Límite de búsquedas en código.
      expect(item.retrievalCount).toBeLessThanOrEqual(LAB_CRAG_CONFIG.maxRetrievals);
      // Límite de reformulaciones en código.
      expect(item.reformulationCount).toBeLessThanOrEqual(LAB_CRAG_CONFIG.maxReformulations);
    }
    // Un rechazo nunca lleva citas en ninguna de las dos etapas.
    for (const item of report.items.filter((entry) => entry.decision === "refuse")) {
      // Sin fuentes aparentes en un rechazo.
      expect(item.citations).toEqual([]);
    }
  });

  // Verifica que los umbrales de código deciden la ruta a partir de la valoración de un juez real.
  it("decide suficiencia, evidencia parcial e insuficiencia con los umbrales de S11", () => {
    // Fragmento mínimo para construir candidatos reordenados.
    const hit = (chunkId: string) => ({
      chunkId,
      corpusVersion: "v",
      documentId: chunkId,
      ordinal: 0,
      title: "t",
      section: "s",
      content: "c",
      embeddingModel: "m",
      embeddingDimensions: 768 as const,
      cosineDistance: 0.3,
      similarity: 0.7,
    });
    // Un fragmento útil y otro irrelevante.
    const reranked = [
      { hit: hit("a"), rerankScore: 0.9, reason: "dato directo" },
      { hit: hit("b"), rerankScore: 0.1, reason: "otro tema" },
    ];
    // Cobertura alta sin lagunas: suficiente con el fragmento útil.
    const sufficient = decideLabSufficiency({
      reranked,
      coverageScore: 0.8,
      gaps: [],
      reason: "ok",
    });
    expect(sufficient.status).toBe("sufficient");
    expect(sufficient.usefulIds).toEqual(["a"]);
    // Cobertura alta pero con una laguna nombrada: parcial, nunca suficiente.
    const partial = decideLabSufficiency({
      reranked,
      coverageScore: 0.8,
      gaps: ["Plazo de abono de Bizum"],
      reason: "falta una parte",
    });
    expect(partial.status).toBe("partial");
    expect(partial.gaps).toEqual(["Plazo de abono de Bizum"]);
    // Cobertura por debajo de 0,40: insuficiente y no conserva nada, aunque mantiene la laguna.
    const low = decideLabSufficiency({
      reranked,
      coverageScore: 0.3,
      gaps: ["Otra búsqueda"],
      reason: "poco",
    });
    expect(low.status).toBe("insufficient");
    expect(low.usefulIds).toEqual([]);
    expect(low.gaps).toEqual(["Otra búsqueda"]);
    // Ningún fragmento llega a 0,50: insuficiente aunque el juez estime cobertura alta.
    const none = decideLabSufficiency({
      reranked: [{ hit: hit("c"), rerankScore: 0.4, reason: "tema cercano" }],
      coverageScore: 0.9,
      gaps: [],
      reason: "parecido",
    });
    expect(none.status).toBe("insufficient");
  });
});
