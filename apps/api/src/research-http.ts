// GUÍA DE LECTURA · apps/api/src/research-http.ts
// Investigación en primer plano (fase 1 de S12): ejecuta el grafo mientras la petición sigue abierta
// y envía por streaming los pasos, el resumen, las fuentes citadas y el informe.
// Esquema y tipos del contrato.
import {
  researchSummarySchema,
  type ChatRequest,
  type ResearchOutcome,
  type ResearchStep,
  type RunMetadata,
} from "@thepower-rag/contracts";
// Tipos de puertos y petición de la investigación.
import type { ResearchPorts, ResearchRequest } from "@thepower-rag/research";
// Utilidades del AI SDK para el stream.
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
// Mensaje genérico de fallo del proveedor.
import { PUBLIC_PROVIDER_MESSAGE } from "./course-stream";
// Tipo del diagnóstico.
import type { Assessment } from "./env";
// Versión del corpus de la demo.
import { storeFixtureCorpusVersion } from "./fixture";
// Puertos de la demo y su guion.
import { createFixtureResearchPorts, resolveResearchScenario } from "./research-fixture";
// Grafo de la investigación.
import { runResearchGraph } from "./research-graph";
// Versión de las instrucciones.
import { RESEARCH_PROMPT_ID } from "./research-prompts";
// Resumen y fuentes citadas.
import { citedSources, researchSummary } from "./research-summary";

// Dependencias inyectables.
export interface ResearchHttpDeps {
  /** Solo para pruebas: puertos inyectados con red simulada. */
  researchPorts?: ResearchPorts;
}

// Traduce el resultado de la investigación al estado de la respuesta.
function completionFor(outcome: ResearchOutcome): RunMetadata["completion"] {
  // Un caso por resultado.
  switch (outcome) {
    // Completa.
    case "complete":
      // Completa.
      return "complete";
    // Parcial.
    case "partial":
      // Parcial.
      return "partial";
    // Rechazada.
    case "refused":
      // Rechazada.
      return "refused";
    // Aclaración.
    case "clarify":
      // Aclarada.
      return "clarified";
    // Cancelada.
    case "aborted":
      // Cancelada.
      return "aborted";
    // Cualquier otro: error.
    default:
      // Error.
      return "error";
  }
}

/**
 * Etapa de investigación en primer plano: el grafo corre mientras la petición
 * sigue conectada. No es un trabajo durable ni usa waitUntil. Sin la petición
 * no hay ejecución en segundo plano.
 */
export async function researchHttpResponse(input: {
  // Diagnóstico.
  assessment: Assessment;
  // Petición validada.
  request: ChatRequest;
  // Pregunta.
  question: string;
  // Señal de cancelación.
  signal: AbortSignal;
  // Dependencias.
  deps: ResearchHttpDeps;
}): Promise<Response | { status: 409; missing: string[]; message: string }> {
  // ¿Modo real?
  const real = input.assessment.execution === "real";
  // En real sin puertos inyectados.
  if (real && input.deps.researchPorts === undefined) {
    // Estado de la investigación.
    const capability = input.assessment.capabilities.research;
    // Si no está lista, se informa sin usar la demo.
    if (capability.status !== "ready") {
      // Respuesta 409.
      return {
        status: 409,
        missing: capability.missing,
        message:
          "La investigación real está bloqueada: necesita su propia autorización de gasto y una contabilidad durable del coste total. No se usan los adaptadores de prueba.",
      };
    }
  }
  // Guion de la demo, o null en real.
  const scenarioId = real
    ? null
    : resolveResearchScenario(input.request.researchScenario, input.question);
  // Versión del corpus de la tienda.
  const corpusVersion = real
    ? (input.assessment.storeRetrieval?.corpusVersion ?? storeFixtureCorpusVersion())
    : storeFixtureCorpusVersion();
  // Puertos inyectados o los de la demo.
  const ports =
    input.deps.researchPorts ??
    createFixtureResearchPorts({
      signal: input.signal,
      scenarioId,
      corpusVersion,
    });
  // Petición al grafo.
  const request: ResearchRequest = {
    runId: crypto.randomUUID(),
    threadId: null,
    question: input.question,
    observations: [{ kind: "text", text: input.question }],
    corpusVersion,
    scenarioId,
  };
  // Metadatos de la respuesta.
  const metadata: RunMetadata = {
    runId: request.runId,
    origin: ports.fixture ? "offline-fixture" : "pipeline",
    modelId: null,
    promptId: RESEARCH_PROMPT_ID,
    completion: "streaming",
    usage: null,
    cost: null,
  };
  // Stream de la respuesta.
  const stream = createUIMessageStream({
    // Produce las partes del stream dentro del ciclo de ejecución del protocolo de mensajes.
    execute: async ({ writer }) => {
      // Inicio.
      writer.write({ type: "start", messageMetadata: metadata });
      // Ejecuta el grafo enviando cada paso.
      const state = await runResearchGraph(request, ports, (step: ResearchStep) => {
        // Paso transitorio (no se guarda en el historial).
        writer.write({ type: "data-research-step", data: step, transient: true });
      });
      // Resumen validado.
      const summary = researchSummarySchema.parse(researchSummary(state, ports));
      // Envía el resumen.
      writer.write({ type: "data-research", id: "research", data: summary });
      // Fuentes citadas.
      for (const source of citedSources(state)) {
        // Envía cada fuente.
        writer.write({ type: "data-research-source", id: source.sourceId, data: source });
      }
      // Texto del informe.
      const text = state.reportText;
      // Inicio del texto.
      writer.write({ type: "text-start", id: "report" });
      // Envía el informe en trozos de 160 caracteres.
      for (let index = 0; index < text.length; index += 160) {
        // Trozo.
        writer.write({ type: "text-delta", id: "report", delta: text.slice(index, index + 160) });
      }
      // Fin del texto.
      writer.write({ type: "text-end", id: "report" });
      // Final con el estado.
      writer.write({
        type: "finish",
        messageMetadata: { ...metadata, completion: completionFor(summary.outcome) },
      });
    },
    // Transforma el fallo del stream en el mensaje que recibirá el consumidor.
    onError: () => PUBLIC_PROVIDER_MESSAGE,
  });
  // Respuesta HTTP sin caché.
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "cache-control": "no-store",
      "x-thepower-rag-stream": ports.fixture ? "offline-fixture" : "pipeline",
    },
  });
}
