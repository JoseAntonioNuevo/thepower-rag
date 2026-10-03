import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { openRouterFactoryLoaded } from "./model";

const CompatState = Annotation.Root({
  marker: Annotation<string>,
});

export interface CompatibilityReport {
  langgraph: "ok" | "failed";
  openrouter: "loaded" | "failed";
  note: string;
}

function failureNote(error: unknown): string {
  const message = error instanceof Error ? error.message : "error desconocido";
  return `LangGraph no superó la comprobación de compatibilidad: ${message.replace(/\s+/g, " ").slice(0, 180)}`;
}

async function runDependencyGraph(): Promise<void> {
  const graph = new StateGraph(CompatState)
    .addNode("marcar", () => ({ marker: "ok" }))
    .addEdge(START, "marcar")
    .addEdge("marcar", END)
    .compile();
  const result = await graph.invoke({ marker: "inicio" });
  if (result.marker !== "ok") {
    throw new Error("El grafo de compatibilidad no devolvió el marcador esperado.");
  }
}

let pending: Promise<CompatibilityReport> | undefined;

export function dependencyCompatibility(): Promise<CompatibilityReport> {
  pending ??= (async () => {
    const openrouter = openRouterFactoryLoaded() ? "loaded" : "failed";
    try {
      await runDependencyGraph();
      return {
        langgraph: "ok",
        openrouter,
        note: "LangGraph carga. El grafo de CRAG vive en la ruta de chat. Esta comprobación no es una activación remota.",
      };
    } catch (error) {
      return {
        langgraph: "failed",
        openrouter,
        note: failureNote(error),
      };
    }
  })();
  return pending;
}
