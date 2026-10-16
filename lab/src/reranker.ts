// GUÍA DE LECTURA · lab/src/reranker.ts
// Reordenamiento de candidatos en escala [0, 1] (incluido el formato oficial de Qwen3-Reranker-0.6B),
// valoración separada de suficiencia y cobertura de la pregunta, y reformulación de consultas para S11.
// Escala y umbrales calibrados de CRAG.
import { LAB_CRAG_CONFIG } from "./config";
// Tokenización en español para medir solapamiento de conceptos y subpreguntas.
import { tokenizeSpanish } from "./embeddings";
// Fragmentos devueltos por pgvector.
import type { LabVectorHit } from "./pgvector-store";

// Candidato reordenado con su puntuación en la escala cerrada [0, 1].
export interface LabRerankedCandidate {
  // Fragmento original.
  hit: LabVectorHit;
  // Puntuación de relevancia en [0, 1] (no es una probabilidad de verdad).
  rerankScore: number;
  // Explicación breve de por qué recibió esa puntuación.
  reason: string;
}

// Valoración de suficiencia producida por el nodo `assess` (separado del nodo `rerank`).
export interface LabSufficiencyAssessment {
  // Estado de la evidencia: suficiente, ambigua/parcial o insuficiente.
  status: "sufficient" | "partial" | "insufficient";
  // Puntuación global de cobertura de la pregunta completa en [0, 1].
  coverageScore: number;
  // Puntuación máxima de relevancia de un fragmento individual en [0, 1].
  maxChunkRelevance: number;
  // Explicación de la decisión (distingue relevancia del fragmento y cobertura total).
  reason: string;
  // Aspectos o subpreguntas que aún faltan por cubrir.
  gaps: string[];
  // Identificadores de los fragmentos útiles (`rerankScore >= minChunkRelevance`).
  usefulIds: string[];
}

// Construye el prompt oficial de Qwen3-Reranker-0.6B documentado para S11.
export function formatQwen3RerankerPrompt(input: {
  instruction?: string;
  query: string;
  document: string;
}): string {
  // Instrucción por defecto del reranker.
  const instruction =
    input.instruction ??
    "Given a technical documentation query, retrieve relevant passages that answer the query";
  // Plantilla ChatML exacta de Qwen3-Reranker-0.6B con decisión binaria yes/no.
  return [
    "<|im_start|>system",
    'Judge whether the Document meets the requirements based on the Query and the Instruct provided. Note that the answer can only be "yes" or "no".<|im_end|>',
    "<|im_start|>user",
    `<Instruct>: ${instruction}`,
    `<Query>: ${input.query}`,
    `<Document>: ${input.document}<|im_end|>`,
    "<|im_start|>assistant",
    "<think>",
    "",
    "</think>",
    "",
  ].join("\n");
}

// Divide una pregunta potencialmente compuesta en subaspectos para medir cobertura total.
export function splitQuestionAspects(question: string): string[] {
  // Limpia signos de interrogación y separa por conjunciones o signos de puntuación compuestos.
  const normalized = question.replace(/[¿?]/g, " ").trim();
  // Corta cuando una pregunta une dos temas con « y además », « y qué », « y cómo », « y cuál », «;».
  const rawParts = normalized
    .split(
      /\s+(?:y\s+(?:además|adicionalmente|qué|que|cómo|como|cuál|cual|cuánto|cuanto|quién|quien)|;\s*)/i,
    )
    .map((part) => part.trim())
    .filter((part) => tokenizeSpanish(part).length >= 2);
  // Si no es compuesta, devuelve la pregunta única.
  return rawParts.length > 1 ? rawParts : [normalized];
}

// Calcula la cobertura léxico-semántica de un aspecto en un texto en la escala [0, 1].
function aspectMatchScore(aspect: string, documentText: string): number {
  // Tokens del aspecto consultado.
  const queryTokens = tokenizeSpanish(aspect);
  if (queryTokens.length === 0) {
    return 0;
  }
  // Conjunto de tokens y raíces de 3 y 4 letras del documento.
  const docTokens = tokenizeSpanish(documentText);
  const docSet = new Set(docTokens);
  const docPrefixes4 = new Set(docTokens.filter((t) => t.length >= 4).map((t) => t.slice(0, 4)));
  const docPrefixes3 = new Set(docTokens.filter((t) => t.length >= 4).map((t) => t.slice(0, 3)));
  // Cuenta coincidencias exactas (1.0), de prefijo de 4 letras (0.85) y de raíz de 3 letras (0.70).
  let matched = 0;
  for (const token of queryTokens) {
    if (docSet.has(token)) {
      matched += 1;
    } else if (token.length >= 4 && docPrefixes4.has(token.slice(0, 4))) {
      matched += 0.85;
    } else if (token.length >= 4 && docPrefixes3.has(token.slice(0, 3))) {
      matched += 0.7;
    }
  }
  // Proporción cubierta en [0, 1].
  return Math.min(1, Number((matched / queryTokens.length).toFixed(4)));
}

// Reordena hasta 10 candidatos asignando una puntuación calibrada en la escala [0, 1].
export function rerankLabCandidates(input: {
  question: string;
  query: string;
  candidates: readonly LabVectorHit[];
}): LabRerankedCandidate[] {
  // Toma como máximo los 10 candidatos permitidos por S11.
  const bounded = input.candidates.slice(0, LAB_CRAG_CONFIG.maxCandidates);
  // Calcula la puntuación de reordenamiento combinando coincidencia con la consulta actual,
  // coincidencia con la pregunta original y similitud vectorial de 768 dimensiones.
  const scored = bounded.map((hit): LabRerankedCandidate => {
    // Texto completo indexado (título, sección y cuerpo).
    const fullText = `${hit.title} ${hit.section} ${hit.content}`;
    // Relevancia respecto a la consulta de búsqueda actual.
    const queryCoverage = aspectMatchScore(input.query, fullText);
    // Relevancia respecto a la pregunta original.
    const questionCoverage = aspectMatchScore(input.question, fullText);
    // Máxima cobertura entre los subaspectos de la pregunta original.
    const aspects = splitQuestionAspects(input.question);
    const bestAspect = Math.max(
      ...aspects.map((aspect) => aspectMatchScore(aspect, fullText)),
      queryCoverage,
    );
    // Puntuación en [0, 1]: pondera el mejor aspecto cubierto (55 %), la consulta (25 %) y el coseno (20 %).
    const rawScore =
      0.55 * bestAspect +
      0.25 * Math.max(queryCoverage, questionCoverage) +
      0.2 * Math.max(0, hit.similarity);
    const rerankScore = Math.max(
      LAB_CRAG_CONFIG.minScore,
      Math.min(LAB_CRAG_CONFIG.maxScore, Number(rawScore.toFixed(4))),
    );
    // Motivo explícito con la escala [0, 1].
    const reason =
      rerankScore >= LAB_CRAG_CONFIG.minChunkRelevance
        ? `Relevante en escala [0, 1] (${rerankScore.toFixed(3)} >= ${LAB_CRAG_CONFIG.minChunkRelevance.toFixed(2)}) para «${hit.section}».`
        : `Descartable en escala [0, 1] (${rerankScore.toFixed(3)} < ${LAB_CRAG_CONFIG.minChunkRelevance.toFixed(2)}).`;
    return { hit, rerankScore, reason };
  });
  // Ordena de mayor a menor `rerankScore` conservando orden estable en caso de empate.
  return scored.sort((left, right) => right.rerankScore - left.rerankScore);
}

// Valora si los fragmentos ya reordenados cubren toda la pregunta (nodo `assess` separado de `rerank`).
export function assessLabEvidence(input: {
  question: string;
  reranked: readonly LabRerankedCandidate[];
}): LabSufficiencyAssessment {
  // Fragmentos cuya relevancia individual supera el umbral `minChunkRelevance` (0,50).
  const useful = input.reranked
    .filter((item) => item.rerankScore >= LAB_CRAG_CONFIG.minChunkRelevance)
    .slice(0, LAB_CRAG_CONFIG.maxRetained);
  // Ids útiles en el orden validado del reordenador.
  const usefulIds = useful.map((item) => item.hit.chunkId);
  // Relevancia máxima de un fragmento individual.
  const maxChunkRelevance = input.reranked[0]?.rerankScore ?? 0;
  // Si ningún fragmento supera el corte individual de 0,50, la evidencia es insuficiente.
  if (useful.length === 0) {
    return {
      status: "insufficient",
      coverageScore: 0,
      maxChunkRelevance,
      reason: `Ningún fragmento alcanza el umbral individual de relevancia (${LAB_CRAG_CONFIG.minChunkRelevance.toFixed(2)}) en [0, 1].`,
      gaps: [],
      usefulIds: [],
    };
  }
  // Une el texto de los fragmentos útiles para medir la cobertura global de todos los aspectos de la pregunta.
  const combinedUsefulText = useful
    .map((item) => `${item.hit.title} ${item.hit.section} ${item.hit.content}`)
    .join("\n");
  // Evalúa cada aspecto de la pregunta original contra el conjunto de fragmentos útiles.
  const aspects = splitQuestionAspects(input.question);
  const aspectScores = aspects.map((aspect) => ({
    aspect,
    score: aspectMatchScore(aspect, combinedUsefulText),
  }));
  // Lagunas: aspectos cuya cobertura en los fragmentos útiles no llega a 0,55.
  const gaps = aspectScores
    .filter((item) => item.score < 0.55)
    .map((item) => `Falta evidencia documental sobre: ${item.aspect}`);
  // Cobertura global de la pregunta en [0, 1]: media de los aspectos ponderada con el mejor fragmento.
  const meanAspectScore =
    aspectScores.reduce((sum, item) => sum + item.score, 0) / aspectScores.length;
  const coverageScore = Number(
    Math.min(1, 0.65 * meanAspectScore + 0.35 * maxChunkRelevance).toFixed(4),
  );
  // Si la cobertura global no llega al mínimo parcial (0,40), se descarta como insuficiente.
  if (coverageScore < LAB_CRAG_CONFIG.partialCoverageMin) {
    return {
      status: "insufficient",
      coverageScore,
      maxChunkRelevance,
      reason: `La cobertura global (${coverageScore.toFixed(2)}) no alcanza el umbral mínimo parcial (${LAB_CRAG_CONFIG.partialCoverageMin.toFixed(2)}).`,
      gaps: [],
      usefulIds: [],
    };
  }
  // Si no hay lagunas y la cobertura global supera `sufficientCoverageMin` (0,75): suficiente.
  if (gaps.length === 0 && coverageScore >= LAB_CRAG_CONFIG.sufficientCoverageMin) {
    return {
      status: "sufficient",
      coverageScore,
      maxChunkRelevance,
      reason: `Cobertura global suficiente (${coverageScore.toFixed(2)} >= ${LAB_CRAG_CONFIG.sufficientCoverageMin.toFixed(2)}) sin lagunas pendientes.`,
      gaps: [],
      usefulIds,
    };
  }
  // Caso clave de S11: hay al menos un fragmento relevante (>= 0,50), pero falta cubrir parte de la pregunta.
  return {
    status: "partial",
    coverageScore,
    maxChunkRelevance,
    reason: `Relevancia individual alta (${maxChunkRelevance.toFixed(2)} >= ${LAB_CRAG_CONFIG.minChunkRelevance.toFixed(2)}), pero cobertura global parcial (${coverageScore.toFixed(2)}): quedan lagunas.`,
    gaps:
      gaps.length > 0
        ? gaps
        : ["Falta evidencia adicional para cubrir todos los términos de la pregunta."],
    usefulIds,
  };
}

// Reformula la consulta de búsqueda apuntando a la laguna detectada sin perder la intención original.
export function reformulateLabQuery(input: {
  originalQuestion: string;
  previousQuery: string;
  gaps: readonly string[];
  attempt: number;
}): string {
  // Si el evaluador nombró una laguna específica, centra la nueva consulta en esa laguna.
  const gapIndex = Math.min(input.attempt - 1, Math.max(0, input.gaps.length - 1));
  const rawGap = input.gaps[gapIndex]?.replace(/^Falta evidencia documental sobre:\s*/i, "").trim();
  if (rawGap && rawGap.length > 0) {
    const candidate =
      input.attempt === 1
        ? `${rawGap} especificaciones`
        : `${rawGap} documentación técnica intento ${String(input.attempt)}`;
    if (candidate.toLowerCase() !== input.previousQuery.toLowerCase()) {
      return candidate;
    }
  }
  // En caso de evidencia insuficiente sin laguna específica, amplía con términos técnicos clave de la pregunta.
  const tokens = tokenizeSpanish(input.originalQuestion);
  const tail = tokens.slice(Math.max(0, Math.floor(tokens.length / 2))).join(" ");
  return `${tail || input.originalQuestion} política oficial intento ${String(input.attempt)}`;
}
