// GUÍA DE LECTURA · lab/src/crag-graph.ts
// Grafo LangGraph de Corrective RAG (S11) para el laboratorio reproducible con PostgreSQL/pgvector:
// nodos separados de recuperación (hasta 10 candidatos), reordenamiento en [0, 1], valoración de
// suficiencia, conservación sin duplicados, descarte, reformulación (máx. 2, 3 búsquedas) y respuesta/rechazo.
// Primitivas del grafo de estados de LangGraph.js (reexportadas por compat.ts sin tocar bun.lock).
import { Annotation, END, START, StateGraph } from "../../apps/api/src/compat";
// Filtro de citas verificables.
import { suppressUnknownCitations } from "@thepower-rag/core";
// Límites y umbrales calibrados de S11.
import { LAB_CRAG_CONFIG, type LabConfig } from "./config";
// Proveedor de embeddings de 768 dimensiones.
import type { LabEmbeddingProvider } from "./embeddings";
// Almacén pgvector y sus candidatos.
import type { LabVectorHit, LabVectorStore } from "./pgvector-store";
// Generador fundamentado compartido con el RAG básico de S10.
import { synthesizeGroundedLabAnswer } from "./rag-basic";
// Reordenador en [0, 1], evaluador de suficiencia y reformulador.
import {
  assessLabEvidence,
  reformulateLabQuery,
  rerankLabCandidates,
  type LabRerankedCandidate,
  type LabSufficiencyAssessment,
} from "./reranker";

// Registro de un fragmento descartado durante un intento de CRAG.
export interface LabDiscardedRecord {
  // Identificador del fragmento descartado.
  chunkId: string;
  // Intento en el que se descartó (1, 2 o 3).
  attempt: number;
  // Puntuación en el reordenador [0, 1].
  rerankScore: number;
  // Motivo del descarte.
  reason: string;
}

// Traza de una iteración completa (búsqueda -> reordenamiento -> valoración).
export interface LabCragIterationTrace {
  // Número de intento (1 a 3).
  attempt: number;
  // Consulta ejecutada en este intento.
  query: string;
  // Candidatos recuperados de pgvector (hasta 10).
  retrievedIds: { chunkId: string; cosineDistance: number; similarity: number }[];
  // Orden resultante del nodo `rerank` con puntuaciones en [0, 1].
  reranked: { chunkId: string; rerankScore: number; reason: string }[];
  // Valoración emitida por el nodo `assess`.
  assessment: LabSufficiencyAssessment;
  // Ruta tomada tras valorar (`answer`, `retain`, `discard` o `refuse`).
  route: "answer" | "retain" | "discard" | "refuse";
}

// Resultado completo de una ejecución del grafo CRAG de S11.
export interface LabCragResult {
  // Pregunta original (nunca se sobrescribe al reformular).
  question: string;
  // Todas las consultas enviadas a pgvector en orden.
  queries: string[];
  // Número total de recuperaciones ejecutadas (1 a 3).
  retrievalCount: number;
  // Número total de reformulaciones ejecutadas (0 a 2).
  reformulationCount: number;
  // Estado final de la evidencia (`sufficient`, `partial` o `insufficient`).
  finalStatus: "sufficient" | "partial" | "insufficient";
  // Decisión terminal (`answer` o `refuse`).
  decision: "answer" | "refuse";
  // Indica si se llamó al modelo generador (en `refuse` siempre es `false`).
  generationCalled: boolean;
  // Secuencia de nodos recorridos en el `StateGraph`.
  visitedNodes: string[];
  // Fragmentos conservados en el orden final validado.
  retained: LabVectorHit[];
  // Historial de fragmentos descartados con su intento y motivo.
  discarded: LabDiscardedRecord[];
  // Traza detallada por iteración.
  iterations: LabCragIterationTrace[];
  // Texto final de la respuesta o del rechazo controlado.
  answer: string;
  // Citas `[cite:id]` presentes y validadas en la respuesta.
  citations: string[];
  // Duración total en milisegundos.
  latencyMs: number;
}

// Estado interno del `StateGraph` de S11.
interface LabCragGraphState {
  // Pregunta original del usuario.
  originalQuestion: string;
  // Consulta activa para la siguiente búsqueda en pgvector.
  currentQuery: string;
  // Consultas ya ejecutadas (para evitar bucles con la misma consulta).
  queries: string[];
  // Contador de búsquedas (máximo 3).
  retrievalCount: number;
  // Contador de reformulaciones (máximo 2).
  reformulationCount: number;
  // Candidatos recuperados en la búsqueda actual (hasta 10).
  candidates: LabVectorHit[];
  // Fragmentos mostrados al reordenador en la pasada actual.
  shown: LabVectorHit[];
  // Resultado del nodo `rerank` en escala [0, 1].
  reranked: LabRerankedCandidate[];
  // Resultado del nodo `assess` (suficiente, parcial o insuficiente).
  assessment: LabSufficiencyAssessment | null;
  // Fragmentos útiles conservados entre pasadas sin duplicados.
  retained: LabVectorHit[];
  // Fragmentos descartados con intento y motivo.
  discarded: LabDiscardedRecord[];
  // Traza por iteración.
  iterations: LabCragIterationTrace[];
  // Nodos visitados durante la ejecución.
  visitedNodes: string[];
  // Decisión terminal o `pending` mientras el grafo continúa.
  terminal: "pending" | "answer" | "refuse";
  // Indica si se llamó al generador final.
  generationCalled: boolean;
  // Texto de respuesta o rechazo.
  answerText: string;
  // Citas verificadas.
  citations: string[];
}

// Definición de canales del estado para LangGraph.js.
const LabCragAnnotation = Annotation.Root({
  originalQuestion: Annotation<string>,
  currentQuery: Annotation<string>,
  queries: Annotation<string[]>,
  retrievalCount: Annotation<number>,
  reformulationCount: Annotation<number>,
  candidates: Annotation<LabVectorHit[]>,
  shown: Annotation<LabVectorHit[]>,
  reranked: Annotation<LabRerankedCandidate[]>,
  assessment: Annotation<LabSufficiencyAssessment | null>,
  retained: Annotation<LabVectorHit[]>,
  discarded: Annotation<LabDiscardedRecord[]>,
  iterations: Annotation<LabCragIterationTrace[]>,
  visitedNodes: Annotation<string[]>,
  terminal: Annotation<"pending" | "answer" | "refuse">,
  generationCalled: Annotation<boolean>,
  answerText: Annotation<string>,
  citations: Annotation<string[]>,
});

// Une listas de fragmentos por `chunkId` sin duplicados conservando la primera aparición.
function dedupeHits(hits: readonly LabVectorHit[]): LabVectorHit[] {
  // Conjunto de ids ya vistos.
  const seen = new Set<string>();
  const out: LabVectorHit[] = [];
  for (const hit of hits) {
    if (!seen.has(hit.chunkId)) {
      seen.add(hit.chunkId);
      out.push(hit);
    }
  }
  return out;
}

// Ejecuta el grafo CRAG de S11 con pasos separados `retrieve -> rerank -> assess -> (answer | retain | discard | refuse)`.
export async function runLabCrag(input: {
  question: string;
  corpusVersion: string;
  config: LabConfig;
  store: LabVectorStore;
  embedder: LabEmbeddingProvider;
  reranker?: (args: {
    question: string;
    query: string;
    candidates: readonly LabVectorHit[];
    attempt: number;
  }) => Promise<LabRerankedCandidate[]> | LabRerankedCandidate[];
  assessor?: (args: {
    question: string;
    query: string;
    reranked: readonly LabRerankedCandidate[];
    attempt: number;
  }) => Promise<LabSufficiencyAssessment> | LabSufficiencyAssessment;
  reformulator?: (args: {
    originalQuestion: string;
    previousQuery: string;
    gaps: readonly string[];
    attempt: number;
  }) => Promise<string> | string;
  generator?: (question: string, selected: readonly LabVectorHit[]) => Promise<string> | string;
}): Promise<LabCragResult> {
  // Marca de inicio.
  const startedAt = performance.now();
  // Verifica que el modelo de embeddings coincida con el configurado.
  if (input.embedder.modelId !== input.config.embeddingModelId) {
    throw new Error(
      `El modelo de embeddings (${input.embedder.modelId}) no coincide con EMBEDDING_MODEL_ID (${input.config.embeddingModelId}).`,
    );
  }
  // Pregunta limpia.
  const question = input.question.trim();
  // Estado inicial del turno (sin arrastrar estado de preguntas anteriores).
  const initialState: LabCragGraphState = {
    originalQuestion: question,
    currentQuery: question,
    queries: [question],
    retrievalCount: 0,
    reformulationCount: 0,
    candidates: [],
    shown: [],
    reranked: [],
    assessment: null,
    retained: [],
    discarded: [],
    iterations: [],
    visitedNodes: [],
    terminal: "pending",
    generationCalled: false,
    answerText: "",
    citations: [],
  };

  // Construcción del `StateGraph` con nodos explícitamente separados.
  const graph = new StateGraph(LabCragAnnotation)
    // Nodo 1 (`retrieve`): recupera hasta 10 candidatos de PostgreSQL/pgvector (`vector(768)`).
    .addNode("retrieve", async (state) => {
      // Embebe la consulta actual en 768 dimensiones.
      const [queryVector] = await input.embedder.embed([state.currentQuery]);
      if (queryVector === undefined) {
        throw new Error("El proveedor de embeddings no devolvió vector en retrieve.");
      }
      // Consulta hasta 10 candidatos en pgvector.
      const candidates = await input.store.queryNearest({
        queryVector,
        corpusVersion: input.corpusVersion,
        embeddingModel: input.config.embeddingModelId,
        topK: LAB_CRAG_CONFIG.maxCandidates,
      });
      // Incrementa el contador de búsquedas.
      return {
        retrievalCount: state.retrievalCount + 1,
        candidates,
        visitedNodes: [...state.visitedNodes, "retrieve"],
      };
    })
    // Nodo 2 (`rerank`): reordena los candidatos y asigna puntuaciones en la escala [0, 1].
    .addNode("rerank", async (state) => {
      // Une los fragmentos ya conservados con los nuevos candidatos sin duplicar (máximo 10).
      const shown = dedupeHits([...state.retained, ...state.candidates]).slice(
        0,
        LAB_CRAG_CONFIG.maxCandidates,
      );
      // Ejecuta el reordenador (inyectado o por defecto).
      const reranked = input.reranker
        ? await input.reranker({
            question: state.originalQuestion,
            query: state.currentQuery,
            candidates: shown,
            attempt: state.retrievalCount,
          })
        : rerankLabCandidates({
            question: state.originalQuestion,
            query: state.currentQuery,
            candidates: shown,
          });
      // Valida que todas las puntuaciones estén en [0, 1].
      for (const item of reranked) {
        if (
          !Number.isFinite(item.rerankScore) ||
          item.rerankScore < LAB_CRAG_CONFIG.minScore ||
          item.rerankScore > LAB_CRAG_CONFIG.maxScore
        ) {
          throw new Error("El nodo rerank devolvió una puntuación fuera de la escala [0, 1].");
        }
      }
      return {
        shown,
        reranked,
        visitedNodes: [...state.visitedNodes, "rerank"],
      };
    })
    // Nodo 3 (`assess`): valora por separado si los fragmentos reordenados bastan para responder.
    .addNode("assess", async (state) => {
      // Evalúa la cobertura global frente a la relevancia individual de cada fragmento.
      const assessment = input.assessor
        ? await input.assessor({
            question: state.originalQuestion,
            query: state.currentQuery,
            reranked: state.reranked,
            attempt: state.retrievalCount,
          })
        : assessLabEvidence({
            question: state.originalQuestion,
            reranked: state.reranked,
          });
      // Determina la ruta según el veredicto y los límites de iteración (3 búsquedas, 2 reformulaciones).
      const canIterate =
        state.retrievalCount < LAB_CRAG_CONFIG.maxRetrievals &&
        state.reformulationCount < LAB_CRAG_CONFIG.maxReformulations;
      const route: LabCragIterationTrace["route"] =
        assessment.status === "sufficient"
          ? "answer"
          : !canIterate
            ? "refuse"
            : assessment.status === "partial"
              ? "retain"
              : "discard";
      // Registra la traza completa de esta iteración.
      const iterationTrace: LabCragIterationTrace = {
        attempt: state.retrievalCount,
        query: state.currentQuery,
        retrievedIds: state.candidates.map((hit) => ({
          chunkId: hit.chunkId,
          cosineDistance: hit.cosineDistance,
          similarity: hit.similarity,
        })),
        reranked: state.reranked.map((item) => ({
          chunkId: item.hit.chunkId,
          rerankScore: item.rerankScore,
          reason: item.reason,
        })),
        assessment,
        route,
      };
      return {
        assessment,
        iterations: [...state.iterations, iterationTrace],
        visitedNodes: [...state.visitedNodes, "assess"],
      };
    })
    // Nodo 4 (`retain`): conserva los fragmentos útiles en orden validado y sin duplicados.
    .addNode("retain", (state) => {
      // Conjunto de ids útiles de esta pasada.
      const usefulSet = new Set(state.assessment?.usefulIds ?? []);
      // Conserva los ya retenidos más los útiles actuales, ordenados según el último rerank.
      const keepIds = new Set([...state.retained.map((hit) => hit.chunkId), ...usefulSet]);
      const orderedKept: LabVectorHit[] = [];
      for (const item of state.reranked) {
        if (keepIds.has(item.hit.chunkId)) {
          orderedKept.push({
            ...item.hit,
            similarity: item.rerankScore,
          });
        }
      }
      // Los fragmentos mostrados que no quedaron retenidos se anotan como descartados.
      const keptIdSet = new Set(orderedKept.map((hit) => hit.chunkId));
      const newDiscarded: LabDiscardedRecord[] = state.reranked
        .filter((item) => !keptIdSet.has(item.hit.chunkId))
        .map((item) => ({
          chunkId: item.hit.chunkId,
          attempt: state.retrievalCount,
          rerankScore: item.rerankScore,
          reason: item.reason,
        }));
      return {
        retained: orderedKept.slice(0, LAB_CRAG_CONFIG.maxRetained),
        discarded: [...state.discarded, ...newDiscarded],
        candidates: [],
        visitedNodes: [...state.visitedNodes, "retain"],
      };
    })
    // Nodo 5 (`discard`): descarta los candidatos rechazados de una pasada insuficiente.
    .addNode("discard", (state) => {
      // Conserva únicamente lo que ya estuviera retenido de una pasada parcial previa.
      const retainedIds = new Set(state.retained.map((hit) => hit.chunkId));
      const newDiscarded: LabDiscardedRecord[] = state.reranked
        .filter((item) => !retainedIds.has(item.hit.chunkId))
        .map((item) => ({
          chunkId: item.hit.chunkId,
          attempt: state.retrievalCount,
          rerankScore: item.rerankScore,
          reason: item.reason,
        }));
      return {
        discarded: [...state.discarded, ...newDiscarded],
        candidates: [],
        visitedNodes: [...state.visitedNodes, "discard"],
      };
    })
    // Nodo 6 (`reformulate`): reescribe la consulta para cubrir la laguna sin sustituir `originalQuestion`.
    .addNode("reformulate", async (state) => {
      // Número de la nueva reformulación.
      const nextReformulation = state.reformulationCount + 1;
      // Genera la consulta reformulada.
      const nextQuery = (
        input.reformulator
          ? await input.reformulator({
              originalQuestion: state.originalQuestion,
              previousQuery: state.currentQuery,
              gaps: state.assessment?.gaps ?? [],
              attempt: nextReformulation,
            })
          : reformulateLabQuery({
              originalQuestion: state.originalQuestion,
              previousQuery: state.currentQuery,
              gaps: state.assessment?.gaps ?? [],
              attempt: nextReformulation,
            })
      ).trim();
      // Si la reformulación está vacía o repite una consulta ya vista, corta hacia rechazo.
      const normalized = nextQuery.toLowerCase();
      const repeated =
        normalized.length === 0 ||
        state.queries.some((seen) => seen.trim().toLowerCase() === normalized);
      if (repeated) {
        return {
          reformulationCount: nextReformulation,
          terminal: "refuse" as const,
          generationCalled: false,
          answerText:
            "No consta evidencia suficiente en el corpus de AetherCloud y la reformulación no produjo una consulta nueva.",
          visitedNodes: [...state.visitedNodes, "reformulate"],
        };
      }
      return {
        reformulationCount: nextReformulation,
        currentQuery: nextQuery,
        queries: [...state.queries, nextQuery],
        visitedNodes: [...state.visitedNodes, "reformulate"],
      };
    })
    // Nodo 7 (`answer`): genera la respuesta final únicamente con los fragmentos aceptados.
    .addNode("answer", async (state) => {
      // Selecciona los fragmentos útiles en el orden validado por `rerank`.
      const usefulSet = new Set([
        ...state.retained.map((hit) => hit.chunkId),
        ...(state.assessment?.usefulIds ?? []),
      ]);
      const finalEvidence = state.reranked
        .filter((item) => usefulSet.has(item.hit.chunkId))
        .slice(0, LAB_CRAG_CONFIG.maxRetained)
        .map((item) => item.hit);
      // Registra como descartados los fragmentos no incluidos en la evidencia final.
      const finalIds = new Set(finalEvidence.map((hit) => hit.chunkId));
      const extraDiscarded: LabDiscardedRecord[] = state.reranked
        .filter((item) => !finalIds.has(item.hit.chunkId))
        .map((item) => ({
          chunkId: item.hit.chunkId,
          attempt: state.retrievalCount,
          rerankScore: item.rerankScore,
          reason: item.reason,
        }));
      // Invoca al generador fundamentado y filtra citas desconocidas.
      const rawText = input.generator
        ? await input.generator(state.originalQuestion, finalEvidence)
        : synthesizeGroundedLabAnswer(state.originalQuestion, finalEvidence);
      const allowed = new Set(finalEvidence.map((hit) => hit.chunkId));
      const answerText = suppressUnknownCitations(rawText, allowed);
      const citations = [...answerText.matchAll(/\[cite:([^\]]+)\]/g)]
        .map((match) => match[1] ?? "")
        .filter((id, idx, arr) => allowed.has(id) && arr.indexOf(id) === idx);
      return {
        retained: finalEvidence,
        discarded: [...state.discarded, ...extraDiscarded],
        terminal: "answer" as const,
        generationCalled: true,
        answerText,
        citations,
        visitedNodes: [...state.visitedNodes, "answer"],
      };
    })
    // Nodo 8 (`refuse`): rechaza sin llamar al generador tras agotar las búsquedas o sin evidencia útil.
    .addNode("refuse", (state) => {
      // Registra como descartados los candidatos restantes del último intento.
      const retainedIds = new Set(state.retained.map((hit) => hit.chunkId));
      const alreadyLogged = new Set(
        state.discarded.map((item) => `${String(item.attempt)}:${item.chunkId}`),
      );
      const extraDiscarded: LabDiscardedRecord[] = state.reranked
        .filter(
          (item) =>
            !retainedIds.has(item.hit.chunkId) &&
            !alreadyLogged.has(`${String(state.retrievalCount)}:${item.hit.chunkId}`),
        )
        .map((item) => ({
          chunkId: item.hit.chunkId,
          attempt: state.retrievalCount,
          rerankScore: item.rerankScore,
          reason: item.reason,
        }));
      return {
        discarded: [...state.discarded, ...extraDiscarded],
        terminal: "refuse" as const,
        generationCalled: false,
        answerText:
          "No consta evidencia suficiente en la documentación de AetherCloud tras agotar el límite de búsquedas y reformulaciones. No se llama al generador.",
        citations: [],
        visitedNodes: [...state.visitedNodes, "refuse"],
      };
    })
    // Aristas del grafo con separación explícita entre `rerank` y `assess`.
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "rerank")
    .addEdge("rerank", "assess")
    .addConditionalEdges("assess", (state) => {
      // Última ruta decidida en el nodo `assess`.
      const lastRoute = state.iterations.at(-1)?.route ?? "refuse";
      return lastRoute;
    })
    .addEdge("retain", "reformulate")
    .addEdge("discard", "reformulate")
    .addConditionalEdges("reformulate", (state) => (state.terminal === "refuse" ? END : "retrieve"))
    .addEdge("answer", END)
    .addEdge("refuse", END);

  // Compila e invoca el grafo.
  const finalState = await graph.compile().invoke(initialState, { recursionLimit: 30 });
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const decision = finalState.terminal === "answer" ? "answer" : "refuse";
  const finalStatus = finalState.assessment?.status ?? "insufficient";

  return {
    question,
    queries: finalState.queries,
    retrievalCount: finalState.retrievalCount,
    reformulationCount: finalState.reformulationCount,
    finalStatus,
    decision,
    generationCalled: finalState.generationCalled,
    visitedNodes: finalState.visitedNodes,
    retained: decision === "answer" ? finalState.retained : [],
    discarded: finalState.discarded,
    iterations: finalState.iterations,
    answer: finalState.answerText,
    citations: finalState.citations,
    latencyMs,
  };
}
