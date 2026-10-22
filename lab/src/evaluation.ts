// GUÍA DE LECTURA · lab/src/evaluation.ts
// Conjuntos separados de validación (6 preguntas para calibrar umbrales) y de test (20 preguntas:
// 14 respondibles y 6 sin respuesta) sobre los 10 documentos ficticios de AetherCloud, y ejecutor
// comparativo entre el RAG básico de S10 y el CRAG de S11.
// Configuración del laboratorio.
import type { LabConfig } from "./config";
// Corpus preparado.
import type { LabPreparedCorpus } from "./corpus";
// Grafo CRAG de S11.
import { runLabCrag, type LabCragResult } from "./crag-graph";
// Proveedor de embeddings de 768 dimensiones.
import type { LabEmbeddingProvider } from "./embeddings";
// Almacén pgvector.
import type { LabVectorStore } from "./pgvector-store";
// RAG básico de S10.
import { runLabBasicRag, type LabBasicRagResult } from "./rag-basic";

// Caso de evaluación con respuesta esperada o motivo de rechazo definido antes de ejecutar.
export interface LabEvaluationCase {
  // Identificador numérico (1 a 20 en el test, 1 a 6 en validación).
  id: number;
  // Pregunta formulada al sistema.
  question: string;
  // true si tiene respuesta en los 10 documentos de AetherCloud; false si debe rechazarse.
  answerable: boolean;
  // Prefijos de `documentId` que respaldan la respuesta (vacío en preguntas no respondibles).
  expectedDocuments: string[];
  // Términos o cifras clave que una respuesta correcta debe contener, o motivo del rechazo esperado.
  expectedFactsOrRefusal: string[];
}

// Conjunto de validación de 6 casos (4 respondibles y 2 sin respuesta) usado para calibrar umbrales.
// Nunca se mezcla con las 20 preguntas reservadas del conjunto de test.
export const LAB_VALIDATION_SET: readonly LabEvaluationCase[] = [
  {
    id: 1,
    question: "¿Qué latencia máxima interzona tienen las regiones eu-mad-1 y eu-fra-1?",
    answerable: true,
    expectedDocuments: ["01-arquitectura-aethercloud"],
    expectedFactsOrRefusal: ["1,8 milisegundos"],
  },
  {
    id: 2,
    question:
      "¿Qué código HTTP devuelve la pasarela si X-Aether-Tenant no coincide con el certificado?",
    answerable: true,
    expectedDocuments: ["02-autenticacion-mtls-tokens"],
    expectedFactsOrRefusal: ["403", "TENANT_MISMATCH"],
  },
  {
    id: 3,
    question:
      "¿Cuál es el límite de peticiones por minuto del Plan Estándar y qué precio mensual tiene ese plan?",
    answerable: true,
    expectedDocuments: ["03-limites-y-cuotas-api", "07-facturacion-y-planes"],
    expectedFactsOrRefusal: ["120", "190 EUR"],
  },
  {
    id: 4,
    question: "¿Qué porcentaje de trazas exitosas muestrea el colector OTLP?",
    answerable: true,
    expectedDocuments: ["09-observabilidad-opentelemetry"],
    expectedFactsOrRefusal: ["10 %"],
  },
  {
    id: 5,
    question: "¿Qué descuento ofrece AetherCloud por pagar con criptomonedas?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: la documentación no menciona pagos con criptomonedas."],
  },
  {
    id: 6,
    question: "¿Cuál es el teléfono gratuito de soporte telefónico en Estados Unidos?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no existe soporte telefónico en EE. UU. en el corpus."],
  },
] as const;

// Conjunto de test de 20 preguntas (14 respondibles y 6 sin respuesta) para evaluar S10 y comparar con S11.
export const LAB_TEST_SET_20: readonly LabEvaluationCase[] = [
  {
    id: 1,
    question:
      "¿Cuáles son las dos regiones europeas de producción de AetherCloud y cuántas zonas tiene cada una?",
    answerable: true,
    expectedDocuments: ["01-arquitectura-aethercloud"],
    expectedFactsOrRefusal: ["eu-mad-1", "eu-fra-1", "tres zonas"],
  },
  {
    id: 2,
    question:
      "¿Cuánto tiempo puede operar el plano de datos si el plano de control entra en mantenimiento?",
    answerable: true,
    expectedDocuments: ["01-arquitectura-aethercloud"],
    expectedFactsOrRefusal: ["6 horas"],
  },
  {
    id: 3,
    question:
      "¿Qué duración máxima tienen los tokens de acceso EdDSA y cada cuántos días rotan los certificados de trabajo?",
    answerable: true,
    expectedDocuments: ["02-autenticacion-mtls-tokens"],
    expectedFactsOrRefusal: ["24 horas", "7 días"],
  },
  {
    id: 4,
    question: "¿En cuántos segundos se propaga una revocación de emergencia mediante listas CRL?",
    answerable: true,
    expectedDocuments: ["02-autenticacion-mtls-tokens"],
    expectedFactsOrRefusal: ["90 segundos"],
  },
  {
    id: 5,
    question:
      "¿Cuántas peticiones por minuto y concurrentes permite el Plan Empresa y cuál es el tamaño máximo de un POST?",
    answerable: true,
    expectedDocuments: ["03-limites-y-cuotas-api"],
    expectedFactsOrRefusal: ["600", "50", "4 MiB"],
  },
  {
    id: 6,
    question:
      "¿Con qué algoritmo se cifran los volúmenes en reposo y qué periodo de enfriamiento exige destruir una CMK?",
    answerable: true,
    expectedDocuments: ["04-almacenamiento-y-cifrado-kms"],
    expectedFactsOrRefusal: ["AES-256-GCM", "72 horas"],
  },
  {
    id: 7,
    question:
      "¿Cada cuántas horas se toman instantáneas incrementales y cuántos días naturales se retienen?",
    answerable: true,
    expectedDocuments: ["04-almacenamiento-y-cifrado-kms"],
    expectedFactsOrRefusal: ["6 horas", "35 días"],
  },
  {
    id: 8,
    question:
      "¿Qué disponibilidad mensual garantiza el SLA de AetherCloud y qué crédito corresponde si baja al 99,20 %?",
    answerable: true,
    expectedDocuments: ["05-sla-y-creditos-servicio"],
    expectedFactsOrRefusal: ["99,95 %", "10 %"],
  },
  {
    id: 9,
    question:
      "¿Cuál es el tiempo máximo de primera respuesta para un incidente SEV-1 y en cuántos días hábiles se entrega el RCA definitivo?",
    answerable: true,
    expectedDocuments: ["06-respuesta-a-incidentes"],
    expectedFactsOrRefusal: ["15 minutos", "5 días hábiles"],
  },
  {
    id: 10,
    question:
      "¿Cuál es la cuota mensual del Plan Empresa y cuánto cuesta cada GiB-mes adicional de almacenamiento?",
    answerable: true,
    expectedDocuments: ["07-facturacion-y-planes"],
    expectedFactsOrRefusal: ["850 EUR", "0,18 EUR"],
  },
  {
    id: 11,
    question:
      "¿Durante cuánto tiempo se conservan en almacenamiento WORM los registros de auditoría administrativa según la política RGPD?",
    answerable: true,
    expectedDocuments: ["08-residencia-datos-y-rgpd"],
    expectedFactsOrRefusal: ["2 años", "730 días"],
  },
  {
    id: 12,
    question:
      "¿En qué puertos escucha el colector OpenTelemetry OTLP por gRPC y por HTTP y cuántos días se retienen las trazas?",
    answerable: true,
    expectedDocuments: ["09-observabilidad-opentelemetry"],
    expectedFactsOrRefusal: ["4317", "4318", "14 días"],
  },
  {
    id: 13,
    question:
      "¿Qué porcentajes de tráfico y ventanas de observación tienen las etapas del despliegue canary y cuándo salta el rollback automático?",
    answerable: true,
    expectedDocuments: ["10-despliegues-canary-y-rollback"],
    expectedFactsOrRefusal: ["10 %", "50 %", "10 minutos", "2,0 %"],
  },
  {
    id: 14,
    question:
      "¿Cómo se autentican los clientes mTLS con X-Aether-Tenant y qué tiempo máximo de primera respuesta aplica si cae todo el plano de datos en un incidente SEV-1?",
    answerable: true,
    expectedDocuments: ["02-autenticacion-mtls-tokens", "06-respuesta-a-incidentes"],
    expectedFactsOrRefusal: ["AetherCA-G2", "15 minutos"],
  },
  {
    id: 15,
    question:
      "¿Qué coste mensual tienen las licencias dedicadas de Windows Server 2025 en AetherCloud?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: [
      "Rechazo: no consta soporte ni tarifas de Windows Server en el corpus.",
    ],
  },
  {
    id: 16,
    question:
      "¿Cuál es la dirección postal de las oficinas centrales de AetherCloud en Tokio (región ap-northeast-1)?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: [
      "Rechazo: no existe región ap-northeast-1 ni sede en Tokio en el corpus.",
    ],
  },
  {
    id: 17,
    question:
      "¿Qué versión exacta del kernel de Linux y qué tarjeta GPU NVIDIA H200 incluye el Plan Estándar?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: [
      "Rechazo: los documentos no especifican kernel de Linux ni GPUs H200.",
    ],
  },
  {
    id: 18,
    question:
      "¿Cuántos días de vacaciones anuales tienen los ingenieros de guardia del turno nocturno?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: política laboral interna ausente del corpus técnico."],
  },
  {
    id: 19,
    question:
      "¿Qué código SWIFT/BIC bancario debe usarse para transferencias internacionales en francos suizos (CHF)?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no consta código SWIFT/BIC ni facturación en CHF."],
  },
  {
    id: 20,
    question:
      "¿Cómo se configura el conector nativo de SAP R/3 por protocolo RFC dentro del plano de control?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no existe documentación sobre conectores SAP R/3 ni RFC."],
  },
] as const;

// Evaluación individual de una pregunta en una de las etapas (`rag` o `crag`).
export interface LabEvaluatedQuestion {
  // Identificador de la pregunta (1 a 20).
  id: number;
  // Etapa evaluada.
  stage: "rag" | "crag";
  // Pregunta formulada.
  question: string;
  // Si era respondible según el diseño del conjunto.
  answerable: boolean;
  // Decisión tomada por el sistema (`answer` o `refuse`).
  decision: "answer" | "refuse";
  // Si la respuesta o rechazo fue correcta según los hechos y fuentes esperados.
  correct: boolean;
  // Si las fuentes citadas cubren todos los documentos esperados (en preguntas respondibles).
  sourceSupported: boolean;
  // Número de recuperaciones ejecutadas.
  retrievalCount: number;
  // Número de reformulaciones ejecutadas.
  reformulationCount: number;
  // Duración en milisegundos.
  latencyMs: number;
  // Citas emitidas.
  citations: string[];
  // Puntuaciones principales observadas.
  topScores: number[];
  // Texto de la respuesta o rechazo.
  answer: string;
}

// Resumen agregado de una etapa sobre las 20 preguntas de test.
export interface LabStageSummary {
  // Etapa (`rag` o `crag`).
  stage: "rag" | "crag";
  // Total de aciertos sobre 20.
  totalCorrect: number;
  // Respondibles acertadas sobre 14.
  answerableCorrect: number;
  // Total de respondibles (14).
  answerableTotal: number;
  // Rechazos correctos sobre 6.
  refusalCorrect: number;
  // Total de preguntas sin respuesta (6).
  refusalTotal: number;
  // Recuperaciones medias por pregunta.
  averageRetrievals: number;
  // Reformulaciones medias por pregunta.
  averageReformulations: number;
  // Mediana de latencia en milisegundos.
  medianLatencyMs: number;
  // Media de latencia en milisegundos.
  meanLatencyMs: number;
}

// Informe completo de la evaluación comparativa entre S10 (RAG básico) y S11 (CRAG).
export interface LabEvaluationReport {
  // Fecha ISO de la ejecución.
  executedAt: string;
  // Versión del corpus sintético evaluado.
  corpusVersion: string;
  // Configuración congelada durante la evaluación.
  config: {
    genModelId: string;
    embeddingModelId: string;
    rerankerModelId: string;
    evaluatorModelId: string;
    dimensions: 768;
    minSimilarity: number;
    maxCosineDistance: number;
    cragMinChunkRelevance: number;
    cragPartialCoverageMin: number;
    cragSufficientCoverageMin: number;
  };
  // Resumen de RAG básico (S10).
  ragSummary: LabStageSummary;
  // Resumen de CRAG (S11).
  cragSummary: LabStageSummary;
  // Resultados detallados de las 40 ejecuciones (20 en RAG y 20 en CRAG).
  items: LabEvaluatedQuestion[];
}

// Comprueba si una respuesta de RAG o CRAG cumple los hechos y fuentes esperados del caso.
function gradeQuestionResult(input: {
  testCase: LabEvaluationCase;
  decision: "answer" | "refuse";
  answer: string;
  citations: readonly string[];
}): { correct: boolean; sourceSupported: boolean } {
  // Si la pregunta no tiene respuesta en el corpus, solo es correcta si rechaza sin citar fuentes falsas.
  if (!input.testCase.answerable) {
    // Un negativo es correcto solo si se rechaza y no se acompaña de citas aparentando evidencia.
    const refusedCleanly = input.decision === "refuse" && input.citations.length === 0;
    // Usa ese mismo rechazo limpio para las métricas de corrección y respaldo documental.
    return { correct: refusedCleanly, sourceSupported: refusedCleanly };
  }
  // En preguntas respondibles, un rechazo es un fallo de recuperación o de juicio.
  if (input.decision !== "answer" || input.citations.length === 0) {
    // Un caso que debería responderse falla si la ejecución no ha producido una respuesta válida.
    return { correct: false, sourceSupported: false };
  }
  // Comprueba que cada documento esperado esté citado al menos en un fragmento.
  const sourceSupported = input.testCase.expectedDocuments.every((docId) =>
    input.citations.some((citation) => citation.includes(`:${docId}:`)),
  );
  // Comprueba que todos los datos o cifras esperados aparezcan en el texto de la respuesta.
  const normalizedAnswer = input.answer.toLowerCase();
  // Comprueba que la respuesta normalizada contenga todos los hechos esperados de este ejercicio.
  const factsPresent = input.testCase.expectedFactsOrRefusal.every((fact) =>
    normalizedAnswer.includes(fact.toLowerCase()),
  );
  // Combina presencia de hechos y respaldo por fuentes en el resultado de corrección.
  return {
    correct: sourceSupported && factsPresent,
    sourceSupported,
  };
}

// Calcula el resumen estadístico de las 20 preguntas de una etapa.
function summarizeStage(
  stage: "rag" | "crag",
  items: readonly LabEvaluatedQuestion[],
): LabStageSummary {
  // Separa respondibles (14) y no respondibles (6).
  const answerableItems = items.filter((item) => item.answerable);
  // Separa los negativos para medir el rechazo sin mezclarlos con preguntas respondibles.
  const refusalItems = items.filter((item) => !item.answerable);
  // Cuenta los aciertos de las preguntas que sí tenían respuesta en el corpus.
  const answerableCorrect = answerableItems.filter((item) => item.correct).length;
  // Cuenta los rechazos correctos de las preguntas sin respuesta documental.
  const refusalCorrect = refusalItems.filter((item) => item.correct).length;
  // Suma ambos grupos sin cambiar la composición 14 positivas + 6 negativas del test.
  const totalCorrect = answerableCorrect + refusalCorrect;
  // Recuperaciones y reformulaciones medias.
  const averageRetrievals = Number(
    (items.reduce((sum, item) => sum + item.retrievalCount, 0) / items.length).toFixed(2),
  );
  // Promedia las reformulaciones por pregunta y fija dos decimales para el informe.
  const averageReformulations = Number(
    (items.reduce((sum, item) => sum + item.reformulationCount, 0) / items.length).toFixed(2),
  );
  // Latencias ordenadas para la mediana.
  const sortedLatencies = items.map((item) => item.latencyMs).sort((a, b) => a - b);
  // Localiza el centro de las latencias ordenadas para calcular la mediana.
  const mid = Math.floor(sortedLatencies.length / 2);
  // Distingue conjuntos pares e impares al combinar los tiempos centrales.
  const medianLatencyMs =
    sortedLatencies.length % 2 === 0
      ? Math.round(((sortedLatencies[mid - 1] ?? 0) + (sortedLatencies[mid] ?? 0)) / 2)
      : (sortedLatencies[mid] ?? 0);
  // Calcula también la media para mostrar el efecto de las ejecuciones lentas.
  const meanLatencyMs = Math.round(
    items.reduce((sum, item) => sum + item.latencyMs, 0) / items.length,
  );
  // Entrega los contadores y tiempos agregados con el mismo formato para RAG y CRAG.
  return {
    stage,
    totalCorrect,
    answerableCorrect,
    answerableTotal: answerableItems.length,
    refusalCorrect,
    refusalTotal: refusalItems.length,
    averageRetrievals,
    averageReformulations,
    medianLatencyMs,
    meanLatencyMs,
  };
}

// Ejecuta las 20 preguntas reservadas de test en RAG básico (S10) y en CRAG (S11) sobre el mismo índice.
export async function runLabComparison20(input: {
  corpus: LabPreparedCorpus;
  config: LabConfig;
  store: LabVectorStore;
  embedder: LabEmbeddingProvider;
}): Promise<LabEvaluationReport> {
  // Reconstruye primero el índice desde cero para garantizar estado limpio e idéntico.
  await input.store.rebuildFromEmptyIndex({
    corpus: input.corpus,
    embedder: input.embedder,
  });
  // Resultados de las 40 ejecuciones.
  const items: LabEvaluatedQuestion[] = [];
  // Pasada 1: las 20 preguntas en el RAG básico de S10.
  for (const testCase of LAB_TEST_SET_20) {
    // Ejecuta el caso con RAG básico y los mismos documentos y proveedor de embeddings del ensayo.
    const ragRes: LabBasicRagResult = await runLabBasicRag({
      question: testCase.question,
      corpusVersion: input.corpus.corpusVersion,
      config: input.config,
      store: input.store,
      embedder: input.embedder,
    });
    // Evalúa la respuesta RAG frente a los hechos y documentos esperados para esta pregunta.
    const graded = gradeQuestionResult({
      testCase,
      decision: ragRes.decision,
      answer: ragRes.answer,
      citations: ragRes.citations,
    });
    // Guarda decisión, evidencia y métricas RAG sin perder las similitudes de los vecinos.
    items.push({
      id: testCase.id,
      stage: "rag",
      question: testCase.question,
      answerable: testCase.answerable,
      decision: ragRes.decision,
      correct: graded.correct,
      sourceSupported: graded.sourceSupported,
      retrievalCount: ragRes.retrievalCount,
      reformulationCount: 0,
      latencyMs: ragRes.latencyMs,
      citations: ragRes.citations,
      topScores: ragRes.retrieved.map((hit) => hit.similarity),
      answer: ragRes.answer,
    });
  }
  // Pasada 2: las mismas 20 preguntas en el grafo CRAG de S11.
  for (const testCase of LAB_TEST_SET_20) {
    // Ejecuta después el mismo caso con el grafo correctivo y sus límites de intentos.
    const cragRes: LabCragResult = await runLabCrag({
      question: testCase.question,
      corpusVersion: input.corpus.corpusVersion,
      config: input.config,
      store: input.store,
      embedder: input.embedder,
    });
    // Aplica a CRAG el mismo criterio de corrección usado con RAG básico.
    const graded = gradeQuestionResult({
      testCase,
      decision: cragRes.decision,
      answer: cragRes.answer,
      citations: cragRes.citations,
    });
    // Recupera el último reranking para mostrar las puntuaciones de la decisión final.
    const lastReranked = cragRes.iterations.at(-1)?.reranked ?? [];
    // Guarda el resultado CRAG con sus reformulaciones, descartes y puntuaciones del último intento.
    items.push({
      id: testCase.id,
      stage: "crag",
      question: testCase.question,
      answerable: testCase.answerable,
      decision: cragRes.decision,
      correct: graded.correct,
      sourceSupported: graded.sourceSupported,
      retrievalCount: cragRes.retrievalCount,
      reformulationCount: cragRes.reformulationCount,
      latencyMs: cragRes.latencyMs,
      citations: cragRes.citations,
      topScores: lastReranked.map((item) => item.rerankScore),
      answer: cragRes.answer,
    });
  }
  // Resúmenes por etapa.
  const ragSummary = summarizeStage(
    "rag",
    items.filter((item) => item.stage === "rag"),
  );
  // Agrupa solo los resultados CRAG antes de calcular sus métricas agregadas.
  const cragSummary = summarizeStage(
    "crag",
    items.filter((item) => item.stage === "crag"),
  );
  // Devuelve ambas etapas, sus resúmenes y la diferencia observada en la comparación.
  return {
    executedAt: new Date().toISOString(),
    corpusVersion: input.corpus.corpusVersion,
    config: {
      genModelId: input.config.genModelId,
      embeddingModelId: input.config.embeddingModelId,
      rerankerModelId: input.config.rerankerModelId,
      evaluatorModelId: input.config.evaluatorModelId,
      dimensions: 768,
      minSimilarity: input.config.minSimilarity,
      maxCosineDistance: input.config.maxCosineDistance,
      cragMinChunkRelevance: 0.5,
      cragPartialCoverageMin: 0.4,
      cragSufficientCoverageMin: 0.75,
    },
    ragSummary,
    cragSummary,
    items,
  };
}
