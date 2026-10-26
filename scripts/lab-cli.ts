// GUÍA DE LECTURA · scripts/lab-cli.ts
// CLI del laboratorio reproducible de S10 y S11: reconstruye el índice vector(768) desde los
// documentos en bruto, ejecuta consultas de RAG básico y CRAG, y genera la comparación de 20 preguntas.
// Escritura de resultados en disco.
import { mkdirSync, writeFileSync } from "node:fs";
// Rutas de archivos.
import path from "node:path";
// Módulos del laboratorio reproducible.
import {
  InMemoryPgVectorStore,
  LAB_DEMO_CASES,
  PgVectorDatabaseStore,
  createDeterministic768EmbeddingProvider,
  prepareLabCorpusFromDirectory,
  resolveLabConfig,
  runLabBasicRag,
  runLabComparison20,
  runLabCrag,
  type LabEvaluationReport,
  type LabVectorStore,
  type PostgresSqlExecutor,
} from "../lab/src/index";

// Raíz del repositorio y carpeta de fuentes del laboratorio.
const root = path.resolve(import.meta.dirname, "..");
// Restringe la preparación a los documentos ficticios incluidos con el laboratorio.
const sourcesDir = path.join(root, "lab/corpus/sources");
// Separa los informes del laboratorio de las fuentes documentales utilizadas para responder.
const evalDir = path.join(root, "lab/eval");

// Crea un ejecutor SQL para PostgreSQL usando el cliente nativo `SQL` de Bun cuando hay `DATABASE_URL`.
async function createBunPostgresExecutor(databaseUrl: string): Promise<PostgresSqlExecutor> {
  // Importación dinámica de `bun` para que `vp check` bajo Node no exija el módulo en tiempo de compilación.
  const bunModuleName = "bun";
  const bunRuntime = (await import(bunModuleName)) as {
    SQL: new (url: string) => {
      unsafe: (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    };
  };
  // Instancia de conexión a PostgreSQL.
  const client = new bunRuntime.SQL(databaseUrl);
  return {
    // Ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      sqlText: string,
      params: readonly unknown[] = [],
    ): Promise<Row[]> {
      // Ejecuta la sentencia SQL parametrizada contra PostgreSQL/pgvector.
      const rows = await client.unsafe(sqlText, [...params]);
      return Array.from(rows) as Row[];
    },
  };
}

// Formatea el informe de evaluación de las 20 preguntas como tabla Markdown para `lab/eval/resultados-laboratorio.md`.
function formatLabEvaluationMarkdown(
  report: LabEvaluationReport,
  counts: { documents: number; chunks: number },
): string {
  // Filas de la tabla de detalle (40 ejecuciones: 20 en RAG básico y 20 en CRAG).
  const detailRows = report.items
    .map(
      (item) =>
        `| ${String(item.id)} | ${item.stage} | ${item.answerable ? "Respondible" : "Sin respuesta"} | ${item.decision} | ${item.correct ? "Sí" : "No"} | ${item.sourceSupported ? "Sí" : "No"} | ${String(item.retrievalCount)} | ${String(item.reformulationCount)} | ${String(item.latencyMs)} | ${item.citations.join(", ") || "—"} |`,
    )
    .join("\n");

  // Documento Markdown completo.
  return [
    "# Respaldo offline del laboratorio: RAG básico y CRAG sobre ThePower Shop",
    "",
    "> **Respaldo determinista, no medición de modelos.** Embeddings léxicos de 768 dimensiones, reordenador por reglas y respuesta extractiva. No llama a ningún proveedor. Sirve para enseñar el recorrido sin red; la comparación con modelos reales está en `lab/.local/thepower-shop/evaluation.json` (`bun run lab:real eval`).",
    "",
    `Reconstruido desde los **${String(counts.documents)} documentos ficticios de ThePower Shop** (un marketplace inventado) e **índice vacío** con vectores de **768 dimensiones** (\`vector(768)\` e índice HNSW \`vector_cosine_ops\`).`,
    "",
    "## Configuración congelada",
    "",
    `- **Versión del corpus:** \`${report.corpusVersion}\` (${String(counts.documents)} documentos Markdown, ${String(counts.chunks)} fragmentos)`,
    `- **Generador:** \`${report.config.genModelId}\``,
    `- **Embeddings:** \`${report.config.embeddingModelId}\` (\`vector(${String(report.config.dimensions)})\`, HNSW \`m=16, ef_construction=64\`)`,
    `- **Reordenador:** \`${report.config.rerankerModelId}\` (escala \`[0, 1]\`)`,
    `- **Umbral previo S10 (RAG básico):** similitud coseno \`>= ${report.config.minSimilarity.toFixed(2)}\` (distancia coseno \`<=> <= ${report.config.maxCosineDistance.toFixed(2)}\`)`,
    `- **Umbrales S11 (CRAG):** relevancia de fragmento \`>= ${report.config.cragMinChunkRelevance.toFixed(2)}\`, cobertura parcial \`>= ${report.config.cragPartialCoverageMin.toFixed(2)}\`, cobertura suficiente \`>= ${report.config.cragSufficientCoverageMin.toFixed(2)}\``,
    "",
    "## Resumen sobre las 20 preguntas del test (14 respondibles + 6 sin respuesta)",
    "",
    "| Etapa | Total correctas | Respondibles (sobre 14) | Rechazos correctos (sobre 6) | Recuperaciones medias | Reformulaciones medias | Mediana latencia | Media latencia |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    `| RAG básico (S10) | ${String(report.ragSummary.totalCorrect)}/20 | ${String(report.ragSummary.answerableCorrect)}/${String(report.ragSummary.answerableTotal)} | ${String(report.ragSummary.refusalCorrect)}/${String(report.ragSummary.refusalTotal)} | ${report.ragSummary.averageRetrievals.toFixed(2)} | ${report.ragSummary.averageReformulations.toFixed(2)} | ${String(report.ragSummary.medianLatencyMs)} ms | ${String(report.ragSummary.meanLatencyMs)} ms |`,
    `| CRAG (S11) | ${String(report.cragSummary.totalCorrect)}/20 | ${String(report.cragSummary.answerableCorrect)}/${String(report.cragSummary.answerableTotal)} | ${String(report.cragSummary.refusalCorrect)}/${String(report.cragSummary.refusalTotal)} | ${report.cragSummary.averageRetrievals.toFixed(2)} | ${report.cragSummary.averageReformulations.toFixed(2)} | ${String(report.cragSummary.medianLatencyMs)} ms | ${String(report.cragSummary.meanLatencyMs)} ms |`,
    "",
    "La corrección automática exige los hechos esperados y citar los documentos esperados. Las reglas léxicas no entienden sinónimos, versiones ni excepciones: estos números no estiman la calidad de un juez real.",
    "",
    "## Detalle de las 40 ejecuciones (20 RAG básico + 20 CRAG)",
    "",
    "| Caso | Etapa | Tipo | Decisión | Correcta | Apoyo fuente | Búsquedas | Reformulaciones | Latencia ms | Fuentes citadas |",
    "|---:|---|---|---|---|---|---:|---:|---:|---|",
    detailRows,
    "",
  ].join("\n");
}

// Punto de entrada principal del CLI del laboratorio.
async function main(): Promise<void> {
  // Subcomando (`demo`, `eval`, `rebuild`).
  const command = process.argv[2] ?? "demo";
  // Configuración del laboratorio.
  const config = resolveLabConfig({
    GEN_MODEL_ID: "fixture-extractive-v1",
    EMBEDDING_MODEL_ID: "fixture-token-hash-768-v1",
    RERANKER_MODEL_ID: "fixture-lexical-reranker-v1",
  });
  // Prepara los documentos ficticios de ThePower Shop.
  const corpus = prepareLabCorpusFromDirectory(sourcesDir);
  // Proveedor de embeddings de 768 dimensiones.
  const embedder = createDeterministic768EmbeddingProvider(config.embeddingModelId);
  // Elige PostgreSQL real si se pasa `--postgres` y `DATABASE_URL`, o el almacén pgvector en memoria.
  const usePostgres = process.argv.includes("--postgres") && config.databaseUrl !== null;
  // Usa el doble en memoria de pgvector para recorrer el mismo contrato sin abrir PostgreSQL.
  const store: LabVectorStore = usePostgres
    ? new PgVectorDatabaseStore(await createBunPostgresExecutor(config.databaseUrl!))
    : new InMemoryPgVectorStore();
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    "[lab] RESPALDO OFFLINE: embeddings léxicos, reglas y respuesta extractiva; no llama a ningún modelo. Ruta real: bun run lab:real preflight",
  );

  // Reconstruye desde índice vacío.
  const receipt = await store.rebuildFromEmptyIndex({ corpus, embedder });
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    `[lab] Índice reconstruido desde cero (${store.backend}): versión=${receipt.corpusVersion}, docs=${String(receipt.documentCount)}, chunks=${String(receipt.chunkCount)}, dim=${String(receipt.embeddingDimensions)}, índice=${receipt.hnswIndex.indexName} (${receipt.hnswIndex.operatorClass})`,
  );

  // Si solo se pidió reconstruir, termina aquí.
  if (command === "rebuild") {
    // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
    return;
  }

  // Si se pidió evaluar las 20 preguntas (14+6), genera el informe Markdown y JSON.
  if (command === "eval") {
    // Ejecuta los veinte casos de la comparación docente con parámetros idénticos entre etapas.
    const report = await runLabComparison20({ corpus, config, store, embedder });
    // Crea el directorio de salida antes de persistir los resultados del recorrido.
    mkdirSync(evalDir, { recursive: true });
    const markdownPath = path.join(evalDir, "resultados-laboratorio.md");
    // Persiste el resultado en la ruta del recorrido para poder revisarlo después.
    writeFileSync(
      markdownPath,
      formatLabEvaluationMarkdown(report, {
        documents: corpus.documents.length,
        chunks: corpus.chunks.length,
      }),
      "utf8",
    );
    // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
    console.log(
      `[lab] Evaluación 20 preguntas completada: RAG=${String(report.ragSummary.totalCorrect)}/20 (${String(report.ragSummary.answerableCorrect)}/14 respondibles, ${String(report.ragSummary.refusalCorrect)}/6 rechazos, ${report.ragSummary.averageRetrievals.toFixed(2)} búsquedas medias) | CRAG=${String(report.cragSummary.totalCorrect)}/20 (${String(report.cragSummary.answerableCorrect)}/14 respondibles, ${String(report.cragSummary.refusalCorrect)}/6 rechazos, ${report.cragSummary.averageRetrievals.toFixed(2)} búsquedas medias).`,
    );
    // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
    console.log(`[lab] Tabla guardada en ${markdownPath}`);
    // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
    return;
  }

  // Modo `demo`: muestra respuesta y rechazo en S10, y suficiente, parcial (2 búsquedas) y límite en S11.
  const [bizum, , , , , students] = LAB_DEMO_CASES;
  // Caso de RAG básico con evidencia.
  const s10Answer = await runLabBasicRag({
    question: "¿En qué horario atiende el chat de la aplicación de ThePower Shop?",
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    `[S10 RAG respuesta] decision=${s10Answer.decision}, gen=${String(s10Answer.generationCalled)}, citas=${s10Answer.citations.join(",")}`,
  );

  // Caso de RAG básico sin evidencia: rechaza antes de generar.
  const s10Refuse = await runLabBasicRag({
    question: students!.question,
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    `[S10 RAG rechazo] decision=${s10Refuse.decision}, gen=${String(s10Refuse.generationCalled)}, citas=${String(s10Refuse.citations.length)}`,
  );

  // Ejecuta el recorrido correctivo con las reglas léxicas por defecto.
  const s11Rules = await runLabCrag({
    question: bizum!.question,
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    `[S11 CRAG con reglas] decision=${s11Rules.decision}, búsquedas=${String(s11Rules.retrievalCount)}, reformulaciones=${String(s11Rules.reformulationCount)}, nodos=${s11Rules.visitedNodes.join("->")}, citas=${s11Rules.citations.join(",")}`,
  );

  // Simula la valoración del juez para enseñar sin red la ruta parcial y la segunda búsqueda.
  const s11Partial = await runLabCrag({
    question: bizum!.question,
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
    // Valoración simulada: devoluciones cubre la validación; falta el plazo de abono de Bizum.
    assessor: ({ reranked, attempt }) => {
      // Fragmento de la política de devoluciones sobre el reembolso.
      const refund = reranked.find((item) => item.hit.documentId === "02-devoluciones");
      // Fragmento de la política de pagos con el plazo de Bizum.
      const payments = reranked.find((item) => item.hit.documentId === "06-pagos-y-reembolsos");
      // Primera pasada: parcial, con la laguna nombrada.
      if (attempt === 1 && refund) {
        // Conserva devoluciones y pide el plazo de abono.
        return {
          status: "partial",
          coverageScore: 0.5,
          maxChunkRelevance: refund.rerankScore,
          reason:
            "Devoluciones explica la validación, pero remite a la política de pagos para el abono.",
          gaps: ["Plazo de abono de un reembolso pagado con Bizum"],
          usefulIds: [refund.hit.chunkId],
        };
      }
      // Pasadas siguientes: suficiente con los dos documentos.
      return {
        status: "sufficient",
        coverageScore: 0.9,
        maxChunkRelevance: Math.max(refund?.rerankScore ?? 0.8, payments?.rerankScore ?? 0.85),
        reason: "Validación y abono de Bizum cubiertos sin lagunas.",
        gaps: [],
        usefulIds: [refund?.hit.chunkId, payments?.hit.chunkId].filter((id): id is string =>
          Boolean(id),
        ),
      };
    },
  });
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    `[S11 CRAG parcial->segunda búsqueda] decision=${s11Partial.decision}, búsquedas=${String(s11Partial.retrievalCount)}, reformulaciones=${String(s11Partial.reformulationCount)}, nodos=${s11Partial.visitedNodes.join("->")}, citas=${s11Partial.citations.join(",")}`,
  );

  // Dato ausente: el grafo agota sus búsquedas y rechaza sin generar.
  const s11Limit = await runLabCrag({
    question: students!.question,
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  // Presenta el resultado de este paso en la terminal para que pueda contrastarse durante la demostración.
  console.log(
    `[S11 CRAG límite/rechazo] decision=${s11Limit.decision}, búsquedas=${String(s11Limit.retrievalCount)}, reformulaciones=${String(s11Limit.reformulationCount)}, gen=${String(s11Limit.generationCalled)}`,
  );
}

await main();
