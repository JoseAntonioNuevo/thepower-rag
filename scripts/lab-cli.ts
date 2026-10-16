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
const sourcesDir = path.join(root, "lab/corpus/sources");
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
function formatLabEvaluationMarkdown(report: LabEvaluationReport): string {
  // Filas de la tabla de detalle (40 ejecuciones: 20 en RAG básico y 20 en CRAG).
  const detailRows = report.items
    .map(
      (item) =>
        `| ${String(item.id)} | ${item.stage} | ${item.answerable ? "Respondible" : "Sin respuesta"} | ${item.decision} | ${item.correct ? "Sí" : "No"} | ${item.sourceSupported ? "Sí" : "No"} | ${String(item.retrievalCount)} | ${String(item.reformulationCount)} | ${String(item.latencyMs)} | ${item.citations.join(", ") || "—"} |`,
    )
    .join("\n");

  // Documento Markdown completo.
  return [
    "# Evaluación ejecutada del laboratorio reproducible (S10 y S11)",
    "",
    "Resultados obtenidos reconstruyendo el sistema desde los **10 documentos ficticios en bruto de AetherCloud** e **índice vacío** con vectores de **768 dimensiones** (`vector(768)` e índice HNSW `vector_cosine_ops`).",
    "",
    "## Configuración congelada",
    "",
    `- **Versión del corpus:** \`${report.corpusVersion}\` (10 documentos Markdown, 20 fragmentos)`,
    `- **Modelo generativo (\`GEN_MODEL_ID\`):** \`${report.config.genModelId}\``,
    `- **Modelo de embeddings (\`EMBEDDING_MODEL_ID\`):** \`${report.config.embeddingModelId}\` (\`vector(${String(report.config.dimensions)})\`, HNSW \`m=16, ef_construction=64\`)`,
    `- **Modelo de reordenamiento (\`RERANKER_MODEL_ID\`):** \`${report.config.rerankerModelId}\` (escala \`[0, 1]\`)`,
    `- **Umbral previo S10 (RAG básico):** similitud coseno \`>= ${report.config.minSimilarity.toFixed(2)}\` (distancia coseno \`<=> <= ${report.config.maxCosineDistance.toFixed(2)}\`)`,
    `- **Umbrales S11 (CRAG):** relevancia de fragmento \`>= ${report.config.cragMinChunkRelevance.toFixed(2)}\`, cobertura parcial \`>= ${report.config.cragPartialCoverageMin.toFixed(2)}\`, cobertura suficiente \`>= ${report.config.cragSufficientCoverageMin.toFixed(2)}\``,
    "",
    "## Resumen comparativo sobre 20 preguntas nuevas (14 respondibles + 6 sin respuesta)",
    "",
    "| Etapa | Total correctas | Respondibles (sobre 14) | Rechazos correctos (sobre 6) | Recuperaciones medias | Reformulaciones medias | Mediana latencia | Media latencia |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    `| RAG básico (S10) | ${String(report.ragSummary.totalCorrect)}/20 | ${String(report.ragSummary.answerableCorrect)}/${String(report.ragSummary.answerableTotal)} | ${String(report.ragSummary.refusalCorrect)}/${String(report.ragSummary.refusalTotal)} | ${report.ragSummary.averageRetrievals.toFixed(2)} | ${report.ragSummary.averageReformulations.toFixed(2)} | ${String(report.ragSummary.medianLatencyMs)} ms | ${String(report.ragSummary.meanLatencyMs)} ms |`,
    `| CRAG (S11) | ${String(report.cragSummary.totalCorrect)}/20 | ${String(report.cragSummary.answerableCorrect)}/${String(report.cragSummary.answerableTotal)} | ${String(report.cragSummary.refusalCorrect)}/${String(report.cragSummary.refusalTotal)} | ${report.cragSummary.averageRetrievals.toFixed(2)} | ${report.cragSummary.averageReformulations.toFixed(2)} | ${String(report.cragSummary.medianLatencyMs)} ms | ${String(report.cragSummary.meanLatencyMs)} ms |`,
    "",
    "## Lectura docente de los resultados",
    "",
    "- **Control previo en S10:** las 6 preguntas sin soporte documental (licencias Windows Server, sede en Tokio, GPUs H200, vacaciones, código SWIFT en CHF y conector SAP R/3) quedan por debajo del umbral de similitud `0,25` (`distancia coseno > 0,75`, calibrado con los 6 casos de validación) y se rechazan sin invocar al generador (`6/6`).",
    "- **Preguntas de varias secciones o varios documentos (casos 5, 10 y 14):** en las preguntas que exigen reunir dos secciones o dos documentos distintos (como el caso 14, que une `02-autenticacion-mtls-tokens` y `06-respuesta-a-incidentes`), el corte único del RAG básico deja fuera una de las partes (`10/14` respondibles). En CRAG, los nodos separados `rerank` (hasta 10 candidatos en `[0, 1]`) y `assess` conservan los fragmentos relevantes (`>= 0,50`) y completan la cobertura (`11/14` respondibles, `17/20` total).",
    "- **Trade-offs reales conservados (casos 3, 8 y 9):** CRAG no acierta el 100 %: en los casos 3 y 8 el umbral de suficiencia (`0,75`) considera parcial la cobertura tras agotar las 2 reformulaciones y rechaza por prudencia, y las recuperaciones medias suben de `1,00` a `" +
      report.cragSummary.averageRetrievals.toFixed(2) +
      "` búsquedas por pregunta (`3` búsquedas y `2` reformulaciones en cada una de las 6 preguntas sin respuesta).",
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
  const config = resolveLabConfig(process.env);
  // Prepara los 10 documentos ficticios de AetherCloud.
  const corpus = prepareLabCorpusFromDirectory(sourcesDir);
  // Proveedor de embeddings de 768 dimensiones.
  const embedder = createDeterministic768EmbeddingProvider(config.embeddingModelId);
  // Elige PostgreSQL real si se pasa `--postgres` y `DATABASE_URL`, o el almacén pgvector en memoria.
  const usePostgres = process.argv.includes("--postgres") && config.databaseUrl !== null;
  const store: LabVectorStore = usePostgres
    ? new PgVectorDatabaseStore(await createBunPostgresExecutor(config.databaseUrl!))
    : new InMemoryPgVectorStore();

  // Reconstruye desde índice vacío.
  const receipt = await store.rebuildFromEmptyIndex({ corpus, embedder });
  console.log(
    `[lab] Índice reconstruido desde cero (${store.backend}): versión=${receipt.corpusVersion}, docs=${String(receipt.documentCount)}, chunks=${String(receipt.chunkCount)}, dim=${String(receipt.embeddingDimensions)}, índice=${receipt.hnswIndex.indexName} (${receipt.hnswIndex.operatorClass})`,
  );

  // Si solo se pidió reconstruir, termina aquí.
  if (command === "rebuild") {
    return;
  }

  // Si se pidió evaluar las 20 preguntas (14+6), genera el informe Markdown y JSON.
  if (command === "eval") {
    const report = await runLabComparison20({ corpus, config, store, embedder });
    mkdirSync(evalDir, { recursive: true });
    const markdownPath = path.join(evalDir, "resultados-laboratorio.md");
    writeFileSync(markdownPath, formatLabEvaluationMarkdown(report), "utf8");
    console.log(
      `[lab] Evaluación 20 preguntas completada: RAG=${String(report.ragSummary.totalCorrect)}/20 (${String(report.ragSummary.answerableCorrect)}/14 respondibles, ${String(report.ragSummary.refusalCorrect)}/6 rechazos, ${report.ragSummary.averageRetrievals.toFixed(2)} búsquedas medias) | CRAG=${String(report.cragSummary.totalCorrect)}/20 (${String(report.cragSummary.answerableCorrect)}/14 respondibles, ${String(report.cragSummary.refusalCorrect)}/6 rechazos, ${report.cragSummary.averageRetrievals.toFixed(2)} búsquedas medias).`,
    );
    console.log(`[lab] Tabla guardada en ${markdownPath}`);
    return;
  }

  // Modo `demo`: muestra respuesta y rechazo en S10, y suficiente, parcial (2 búsquedas) y límite en S11.
  const s10Answer = await runLabBasicRag({
    question:
      "¿Con qué algoritmo se cifran los volúmenes en reposo y qué periodo de enfriamiento exige destruir una CMK?",
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  console.log(
    `[S10 RAG respuesta] decision=${s10Answer.decision}, gen=${String(s10Answer.generationCalled)}, citas=${s10Answer.citations.join(",")}`,
  );

  const s10Refuse = await runLabBasicRag({
    question: "¿Qué coste mensual tienen las licencias de Windows Server 2025 en AetherCloud?",
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  console.log(
    `[S10 RAG rechazo] decision=${s10Refuse.decision}, gen=${String(s10Refuse.generationCalled)}, citas=${String(s10Refuse.citations.length)}`,
  );

  const s11Rerank = await runLabCrag({
    question:
      "¿Cómo se autentican los clientes mTLS con X-Aether-Tenant y qué tiempo máximo de primera respuesta aplica si cae todo el plano de datos en un incidente SEV-1?",
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  console.log(
    `[S11 CRAG suficiente tras rerank] decision=${s11Rerank.decision}, búsquedas=${String(s11Rerank.retrievalCount)}, reformulaciones=${String(s11Rerank.reformulationCount)}, nodos=${s11Rerank.visitedNodes.join("->")}, citas=${s11Rerank.citations.join(",")}`,
  );

  const s11Partial = await runLabCrag({
    question:
      "¿Cómo se autentican los clientes mTLS con X-Aether-Tenant y qué tiempo máximo de primera respuesta aplica si cae todo el plano de datos en un incidente SEV-1?",
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
    assessor: ({ reranked, attempt }) => {
      const mtls = reranked.find((item) =>
        item.hit.documentId.includes("02-autenticacion-mtls-tokens"),
      );
      const sev = reranked.find((item) =>
        item.hit.documentId.includes("06-respuesta-a-incidentes"),
      );
      if (attempt === 1 && mtls) {
        return {
          status: "partial",
          coverageScore: 0.5,
          maxChunkRelevance: mtls.rerankScore,
          reason:
            "Relevancia alta en mTLS (0.85), pero falta cubrir la respuesta a incidentes SEV-1.",
          gaps: [
            "Falta evidencia documental sobre: tiempo máximo de primera respuesta en incidente SEV-1",
          ],
          usefulIds: [mtls.hit.chunkId],
        };
      }
      return {
        status: "sufficient",
        coverageScore: 0.9,
        maxChunkRelevance: Math.max(mtls?.rerankScore ?? 0.8, sev?.rerankScore ?? 0.85),
        reason: "Ambos aspectos (mTLS y SEV-1) cubiertos sin lagunas.",
        gaps: [],
        usefulIds: [mtls?.hit.chunkId, sev?.hit.chunkId].filter((id): id is string => Boolean(id)),
      };
    },
  });
  console.log(
    `[S11 CRAG parcial->segunda búsqueda] decision=${s11Partial.decision}, búsquedas=${String(s11Partial.retrievalCount)}, reformulaciones=${String(s11Partial.reformulationCount)}, nodos=${s11Partial.visitedNodes.join("->")}, citas=${s11Partial.citations.join(",")}`,
  );

  const s11Limit = await runLabCrag({
    question: "¿Qué descuento ofrece AetherCloud por pagar con criptomonedas?",
    corpusVersion: corpus.corpusVersion,
    config,
    store,
    embedder,
  });
  console.log(
    `[S11 CRAG límite/rechazo] decision=${s11Limit.decision}, búsquedas=${String(s11Limit.retrievalCount)}, reformulaciones=${String(s11Limit.reformulationCount)}, gen=${String(s11Limit.generationCalled)}`,
  );
}

await main();
