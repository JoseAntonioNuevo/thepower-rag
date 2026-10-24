// GUÍA DE LECTURA · lab/src/evaluation.ts
// Conjuntos separados de validación (6 preguntas para calibrar umbrales) y de test (20 preguntas:
// 14 respondibles y 6 sin respuesta), casos de demostración sobre los 12 documentos de Zocomar
// (un marketplace inventado) y ejecutor comparativo entre el RAG básico de S10 y el CRAG de S11.
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
  // true si tiene respuesta en los documentos de Zocomar; false si debe rechazarse.
  answerable: boolean;
  // Prefijos de `documentId` que respaldan la respuesta (vacío en preguntas no respondibles).
  expectedDocuments: string[];
  // Términos o cifras clave que una respuesta correcta debe contener, o motivo del rechazo esperado.
  expectedFactsOrRefusal: string[];
}

// Conjunto de validación de 6 casos (4 respondibles y 2 sin respuesta) usado para calibrar umbrales.
// Nunca se mezcla con las 20 preguntas reservadas del conjunto de test ni con los casos de demostración.
export const LAB_VALIDATION_SET: readonly LabEvaluationCase[] = [
  {
    id: 1,
    question: "¿Cuánto tiempo tiene el vendedor para responder a una disputa?",
    answerable: true,
    expectedDocuments: ["08-garantia-zocomar-y-disputas"],
    expectedFactsOrRefusal: ["48 horas"],
  },
  {
    id: 2,
    question: "¿Qué comisión paga un vendedor que está en el Plan Pro?",
    answerable: true,
    expectedDocuments: ["07-vendedores-planes-y-comisiones"],
    expectedFactsOrRefusal: ["8 %"],
  },
  {
    id: 3,
    question: "¿En qué horario atiende el chat de la aplicación de Zocomar?",
    answerable: true,
    expectedDocuments: ["11-atencion-al-cliente"],
    expectedFactsOrRefusal: ["8:00", "22:00"],
  },
  {
    id: 4,
    question: "¿Cuántas unidades de una misma oferta flash puede comprar un cliente?",
    answerable: true,
    expectedDocuments: ["12-promociones-y-cupones"],
    expectedFactsOrRefusal: ["2 unidades"],
  },
  {
    id: 5,
    question: "¿Qué seguro de viaje ofrece Zocomar a sus clientes?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: la documentación no menciona seguros de viaje."],
  },
  {
    id: 6,
    question: "¿Cuántas personas trabajan en el almacén de Getafe?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no consta la plantilla del almacén."],
  },
] as const;

// Caso de demostración: se enseña en clase para explicar un mecanismo concreto de CRAG.
export interface LabDemoCase extends LabEvaluationCase {
  // Mecanismo que el caso permite observar en la traza.
  mechanism: string;
}

// Casos de demostración de S11, visibles y distintos del test. Muestran por qué una búsqueda única
// puede quedarse corta; no miden la calidad general (eso lo hace el test de 20 preguntas).
export const LAB_DEMO_CASES: readonly LabDemoCase[] = [
  {
    id: 1,
    question:
      "Devolví en un Zocopunto un pedido que pagué con Bizum. ¿Cuánto puede tardar en llegarme el dinero?",
    answerable: true,
    expectedDocuments: ["02-devoluciones", "06-pagos-y-reembolsos"],
    expectedFactsOrRefusal: ["3 días hábiles", "2 días hábiles"],
    mechanism:
      "Salto entre documentos: devoluciones remite a la política de pagos para el plazo de Bizum.",
  },
  {
    id: 2,
    question:
      "Me compré unos cascos de botón hace 10 días, los he estrenado y no me convencen. ¿Los puedo devolver?",
    answerable: true,
    expectedDocuments: ["03-electronica-y-garantia"],
    expectedFactsOrRefusal: ["precinto higiénico", "garantía"],
    mechanism:
      "Excepción en otro documento: la regla general de 30 días no se aplica a los auriculares intraauditivos.",
  },
  {
    id: 3,
    question: "¿A partir de qué importe es gratis el envío estándar a la península?",
    answerable: true,
    expectedDocuments: ["04-envios-vigente"],
    expectedFactsOrRefusal: ["39 €", "vendedor"],
    mechanism:
      "Documento obsoleto: la política de 2025 (29 €) se parece a la pregunta, pero está sustituida.",
  },
  {
    id: 4,
    question:
      "Soy de Zocomar Plus y vivo en Mallorca. ¿Pago envío en un pedido de 35 € de un solo vendedor y lo puedo pedir exprés?",
    answerable: true,
    expectedDocuments: ["04-envios-vigente"],
    expectedFactsOrRefusal: ["29 €", "no está disponible"],
    mechanism: "Pregunta compuesta: ventaja Plus en Baleares y disponibilidad del exprés.",
  },
  {
    id: 5,
    question: "Me habéis cobrado dos veces el mismo pedido, ¿qué hago?",
    answerable: true,
    expectedDocuments: ["06-pagos-y-reembolsos"],
    expectedFactsOrRefusal: ["7 días", "48 horas hábiles"],
    mechanism:
      "Lenguaje del cliente frente a lenguaje de la política (cargo duplicado, retención).",
  },
  {
    id: 6,
    question: "¿Qué descuento tienen los estudiantes universitarios en Zocomar?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no existe un descuento para estudiantes."],
    mechanism:
      "Dato ausente: tres búsquedas, dos reformulaciones y rechazo sin llamar al generador.",
  },
] as const;

// Conjunto de test de 20 preguntas (14 respondibles y 6 sin respuesta) para comparar RAG básico y CRAG.
// Se redactó antes de ejecutar ningún modelo sobre el corpus de Zocomar y no se ajusta después.
export const LAB_TEST_SET_20: readonly LabEvaluationCase[] = [
  {
    id: 1,
    question:
      "¿Cuánto cuesta el envío exprés y hasta qué hora hay que confirmar el pedido para recibirlo en 24 horas?",
    answerable: true,
    expectedDocuments: ["04-envios-vigente"],
    expectedFactsOrRefusal: ["6,99 €", "14:00"],
  },
  {
    id: 2,
    question: "¿Cuántos días tiene un miembro de Zocomar Plus para devolver unas zapatillas?",
    answerable: true,
    expectedDocuments: ["02-devoluciones"],
    expectedFactsOrRefusal: ["45 días"],
  },
  {
    id: 3,
    question: "¿Qué pasa si devuelvo un móvil sin quitar el bloqueo de activación?",
    answerable: true,
    expectedDocuments: ["03-electronica-y-garantia"],
    expectedFactsOrRefusal: ["rechaza", "6,50 €"],
  },
  {
    id: 4,
    question:
      "¿Cuánto tarda el servicio técnico en diagnosticar un producto en garantía y cuánta garantía tiene un portátil reacondicionado?",
    answerable: true,
    expectedDocuments: ["03-electronica-y-garantia"],
    expectedFactsOrRefusal: ["15 días hábiles", "1 año"],
  },
  {
    id: 5,
    question: "¿Puedo pagar a plazos un pedido de 1.200 € con PayPal?",
    answerable: true,
    expectedDocuments: ["06-pagos-y-reembolsos"],
    expectedFactsOrRefusal: ["tarjeta"],
  },
  {
    id: 6,
    question:
      "Si devuelvo un pedido pagado con ZocoPlazos, ¿qué pasa con las cuotas y cuánto tarda el almacén en validar la devolución?",
    answerable: true,
    expectedDocuments: ["06-pagos-y-reembolsos", "02-devoluciones"],
    expectedFactsOrRefusal: ["cuotas pendientes", "3 días hábiles"],
  },
  {
    id: 7,
    question: "¿Qué comisión pagan los vendedores de electrónica y cada cuánto cobran sus ventas?",
    answerable: true,
    expectedDocuments: ["07-vendedores-planes-y-comisiones"],
    expectedFactsOrRefusal: ["7 %", "14 días"],
  },
  {
    id: 8,
    question:
      "¿Qué necesita un vendedor para activar el sello de devolución gratuita y quién paga entonces las devoluciones?",
    answerable: true,
    expectedDocuments: ["07-vendedores-planes-y-comisiones"],
    expectedFactsOrRefusal: ["4,5", "2 %"],
  },
  {
    id: 9,
    question:
      "Mi paquete no llega y ya ha pasado la fecha máxima de entrega: ¿desde cuándo puedo reclamar y hasta qué importe me cubre Zocomar?",
    answerable: true,
    expectedDocuments: ["08-garantia-zocomar-y-disputas"],
    expectedFactsOrRefusal: ["tercer día", "2.500 €"],
  },
  {
    id: 10,
    question:
      "Si devuelvo todo el pedido porque no me gustó, ¿me devuelven lo que pagué por el envío exprés?",
    answerable: true,
    expectedDocuments: ["02-devoluciones"],
    expectedFactsOrRefusal: ["exprés no se reembolsan"],
  },
  {
    id: 11,
    question: "¿Puede recoger mi hijo de 16 años un paquete con una botella de vino?",
    answerable: true,
    expectedDocuments: ["10-productos-prohibidos-y-restringidos"],
    expectedFactsOrRefusal: ["18 años"],
  },
  {
    id: 12,
    question: "¿Cuánto cuesta enviar a Lisboa un pedido de 45 € de un solo vendedor?",
    answerable: true,
    expectedDocuments: ["04-envios-vigente"],
    expectedFactsOrRefusal: ["4,99 €"],
  },
  {
    id: 13,
    question:
      "Si compro con el cupón de bienvenida y luego devuelvo el artículo, ¿recupero el cupón?",
    answerable: true,
    expectedDocuments: ["12-promociones-y-cupones"],
    expectedFactsOrRefusal: ["no se repone"],
  },
  {
    id: 14,
    question:
      "Si cancelo Zocomar Plus anual a los 10 días sin haber usado nada, ¿me devuelven la cuota? ¿Y si fuera mensual?",
    answerable: true,
    expectedDocuments: ["09-zocomar-plus"],
    expectedFactsOrRefusal: ["proporcional", "mensual no se reembolsa"],
  },
  {
    id: 15,
    question: "¿Cuál es el NIF de la empresa que opera Zocomar?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no consta la identidad fiscal de Zocomar."],
  },
  {
    id: 16,
    question: "¿Cuánto cobra al mes un repartidor de Zocomar?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no consta información salarial."],
  },
  {
    id: 17,
    question: "¿Cuántos puntos de fidelidad gana un cliente por cada euro gastado?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no existe un programa de puntos."],
  },
  {
    id: 18,
    question: "¿Cuál es la dirección de la oficina central de Zocomar en Lisboa?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no consta ninguna oficina en Lisboa."],
  },
  {
    id: 19,
    question: "¿Cuánto cuesta el servicio de montaje de muebles a domicilio?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no existe un servicio de montaje."],
  },
  {
    id: 20,
    question: "¿Qué día de la semana se publican las ofertas flash?",
    answerable: false,
    expectedDocuments: [],
    expectedFactsOrRefusal: ["Rechazo: no consta el día de publicación."],
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
