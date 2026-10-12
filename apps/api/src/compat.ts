// GUÍA DE LECTURA · apps/api/src/compat.ts
// Comprobación de compatibilidad que publica /api/health: LangGraph ejecuta un grafo mínimo y el
// SDK de Anthropic carga. No llama a ningún proveedor ni es una activación remota.
// Piezas de LangGraph para construir un grafo.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
// Comprueba que la fábrica de Anthropic se cargó.
import { anthropicFactoryLoaded } from "./model";

// Estado del grafo mínimo: un solo campo.
const CompatState = Annotation.Root({
  marker: Annotation<string>,
});

// Resultado de la comprobación.
export interface CompatibilityReport {
  // ok si el grafo se ejecutó.
  langgraph: "ok" | "failed";
  // loaded si el SDK de Anthropic cargó.
  anthropic: "loaded" | "failed";
  // Explicación legible.
  note: string;
}

// Mensaje de error recortado.
function failureNote(error: unknown): string {
  // Mensaje del error, o uno genérico.
  const message = error instanceof Error ? error.message : "error desconocido";
  // Una línea de como mucho 180 caracteres.
  return `LangGraph no superó la comprobación de compatibilidad: ${message.replace(/\s+/g, " ").slice(0, 180)}`;
}

// Ejecuta un grafo de un nodo que marca el estado.
async function runDependencyGraph(): Promise<void> {
  // Grafo: inicio → marcar → fin.
  const graph = new StateGraph(CompatState)
    .addNode("marcar", () => ({ marker: "ok" }))
    .addEdge(START, "marcar")
    .addEdge("marcar", END)
    .compile();
  // Lo ejecuta.
  const result = await graph.invoke({ marker: "inicio" });
  // Debe devolver el marcador.
  if (result.marker !== "ok") {
    // Error si no.
    throw new Error("El grafo de compatibilidad no devolvió el marcador esperado.");
  }
}

// Promesa compartida: la comprobación se hace una vez por instancia.
let pending: Promise<CompatibilityReport> | undefined;

// Devuelve el informe de compatibilidad.
export function dependencyCompatibility(): Promise<CompatibilityReport> {
  // Solo la primera vez se ejecuta (??= asigna si está vacío).
  pending ??= (async () => {
    // ¿Cargó el SDK de Anthropic?
    const anthropic = anthropicFactoryLoaded() ? "loaded" : "failed";
    // Si el grafo falla, se informa.
    try {
      // Ejecuta el grafo.
      await runDependencyGraph();
      // Todo correcto.
      return {
        langgraph: "ok",
        anthropic,
        note: "LangGraph carga. El grafo de CRAG vive en la ruta de chat. Esta comprobación no es una activación remota.",
      };
    } catch (error) {
      // Fallo de LangGraph.
      return {
        langgraph: "failed",
        anthropic,
        note: failureNote(error),
      };
    }
  })();
  // Misma promesa en todas las llamadas.
  return pending;
}
