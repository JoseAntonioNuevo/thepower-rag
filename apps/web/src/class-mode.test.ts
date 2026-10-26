// GUÍA DE LECTURA · apps/web/src/class-mode.test.ts
// Pruebas de la lógica del modo clase: nodo de cada paso, nodo activo y recorrido en directo y en
// repetición, bucle de CRAG, cursor acotado y que las aristas solo unan nodos que existen.
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Tipos de los pasos.
import type { CragStep, RagStep } from "@thepower-rag/contracts";
// Lógica que se prueba.
import {
  CRAG_GRAPH,
  RAG_GRAPH,
  classView,
  explainNode,
  formatScore,
  fitLabel,
  formatSeconds,
  modelLabel,
  nodeOf,
  pendingSteps,
  stepCursor,
  type ClassEvent,
} from "./class-mode";

// Paso RAG mínimo de un tipo.
function rag(kind: RagStep["kind"], at: number): ClassEvent {
  // Campos obligatorios del contrato.
  return {
    stage: "rag",
    at,
    step: {
      kind,
      status: kind,
      query: "q",
      model: null,
      durationMs: null,
      threshold: null,
      candidates: [],
    },
  };
}

// Paso CRAG mínimo de un tipo.
function crag(kind: CragStep["kind"], at: number): ClassEvent {
  // Campos obligatorios del contrato.
  return {
    stage: "crag",
    at,
    step: {
      runId: "run",
      kind,
      retrieval: 1,
      reformulation: 0,
      query: "q",
      status: kind,
      evidenceStatus: null,
      retainedIds: [],
      discardedIds: [],
    },
  };
}

// Grupo.
describe("modo clase", () => {
  // En directo, el último paso es el activo y los anteriores quedan recorridos.
  it("sigue el último paso en directo con su recorrido", () => {
    // Recorrido de una respuesta.
    const events = [rag("embed", 10), rag("search", 40), rag("threshold", 41), rag("generate", 60)];
    // Vista en directo.
    const view = classView("rag", events, null);
    // Activo: generar.
    expect(view.active).toBe("generate");
    expect(view.index).toBe(3);
    // Recorridos.
    expect(view.visited).toEqual(["embed", "search", "threshold"]);
    // Aristas usadas.
    expect(view.edges).toEqual(["embed->search", "search->threshold", "threshold->generate"]);
  });

  // En repetición, el cursor fija un paso anterior.
  it("muestra un paso anterior al repetir", () => {
    // Recorrido de un rechazo.
    const events = [rag("embed", 10), rag("search", 40), rag("threshold", 41), rag("refuse", 42)];
    // Vista del segundo paso.
    const view = classView("rag", events, 1);
    // Activo: buscar; solo una arista.
    expect(view.active).toBe("search");
    expect(view.edges).toEqual(["embed->search"]);
    // Al final, la arista hacia «no consta».
    expect(classView("rag", events, null).edges).toContain("threshold->refuse");
  });

  // CRAG: el bucle cuenta las visitas y marca las aristas de vuelta.
  it("recorre el bucle de CRAG y cuenta la segunda búsqueda", () => {
    // Parcial, reformula y responde.
    const events = [
      crag("retrieve", 100),
      crag("rank", 3000),
      crag("assess", 3001),
      crag("retain", 3002),
      crag("reformulate", 5000),
      crag("retrieve", 5400),
    ];
    // Vista en directo.
    const view = classView("crag", events, null);
    // Segunda visita a buscar.
    expect(view.active).toBe("retrieve");
    expect(view.visits).toBe(2);
    // Aristas del bucle.
    expect(view.edges).toEqual(
      expect.arrayContaining(["assess->retain", "retain->reformulate", "reformulate->retrieve"]),
    );
    // Buscar no aparece como recorrido mientras está activo.
    expect(view.visited).not.toContain("retrieve");
  });

  // Error y cancelación de CRAG comparten nodo; los pasos de otra etapa se ignoran.
  it("agrupa errores y filtra la etapa", () => {
    // Error y cancelación.
    expect(nodeOf(crag("error", 1))).toBe("error");
    expect(nodeOf(crag("abort", 1))).toBe("error");
    // Un paso RAG no cuenta en el grafo CRAG.
    expect(classView("crag", [rag("embed", 1)], null).total).toBe(0);
    // Sin pasos: vista vacía.
    expect(classView("rag", [], null).active).toBeNull();
  });

  // El cursor no se sale de los pasos recibidos.
  it("acota el cursor al avanzar y retroceder", () => {
    // Desde el directo, retroceder va al penúltimo.
    expect(stepCursor(null, 4, -1)).toBe(2);
    // No baja de cero ni pasa del último.
    expect(stepCursor(0, 4, -1)).toBe(0);
    expect(stepCursor(3, 4, 1)).toBe(3);
    // Sin pasos no hay cursor.
    expect(stepCursor(null, 0, 1)).toBeNull();
    // Un cursor fuera de rango se acota.
    expect(classView("rag", [rag("embed", 1)], 9).index).toBe(0);
  });

  // Cada arista une dos nodos del mismo grafo.
  it("solo dibuja aristas entre nodos existentes", () => {
    // Los dos grafos.
    for (const graph of [RAG_GRAPH, CRAG_GRAPH]) {
      // Ids de sus nodos.
      const ids = new Set(graph.nodes.map((node) => node.id));
      // Cada arista.
      for (const edge of graph.edges) {
        expect(ids.has(edge.from) && ids.has(edge.to)).toBe(true);
      }
      // Ningún nodo se sale del lienzo de 680.
      expect(graph.nodes.every((node) => node.x + 110 <= 680)).toBe(true);
    }
  });

  // La arista de llegada al nodo activo se distingue de las ya recorridas.
  it("marca la arista por la que se llega al nodo activo", () => {
    // Recorrido hasta el umbral.
    const events = [rag("embed", 1), rag("search", 2), rag("threshold", 3)];
    // En directo: se llegó al umbral desde la búsqueda.
    expect(classView("rag", events, null).current).toBe("search->threshold");
    // En el primer paso no hay arista de llegada.
    expect(classView("rag", events, 0).current).toBeNull();
  });

  // Modo lento: cuenta los pasos que quedan por mostrar.
  it("cuenta los pasos pendientes del modo lento", () => {
    // Cinco pasos recibidos y el cursor en el segundo.
    const events = [
      rag("embed", 1),
      rag("search", 2),
      rag("threshold", 3),
      rag("generate", 4),
      rag("answer", 5),
    ];
    // Quedan tres.
    expect(pendingSteps(classView("rag", events, 1))).toBe(3);
    // En directo no queda ninguno.
    expect(pendingSteps(classView("rag", events, null))).toBe(0);
    // Sin pasos tampoco.
    expect(pendingSteps(classView("rag", [], 0))).toBe(0);
  });

  // Cada nodo de los dos grafos tiene su frase para explicarlo.
  it("explica cada nodo de los dos grafos", () => {
    // RAG y CRAG.
    for (const [stage, graph] of [
      ["rag", RAG_GRAPH],
      ["crag", CRAG_GRAPH],
    ] as const) {
      // Ningún nodo sin explicación.
      for (const node of graph.nodes) expect(explainNode(stage, node.id)).not.toBeNull();
    }
    // Un nodo desconocido o vacío no tiene frase.
    expect(explainNode("rag", "rank")).toBeNull();
    expect(explainNode("crag", null)).toBeNull();
  });

  // Formatos con coma decimal.
  it("formatea segundos y puntuaciones", () => {
    // Segundos.
    expect(formatSeconds(1234)).toBe("1,2 s");
    // Puntuaciones.
    expect(formatScore(0.6126)).toBe("0,613");
    expect(formatScore(null)).toBe("—");
  });

  // Nombres legibles de los modelos que aparecen en los nodos.
  it("traduce los ids de modelo a nombres legibles", () => {
    // Claude.
    expect(modelLabel("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
    expect(modelLabel("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    // Workers AI.
    expect(modelLabel("@cf/baai/bge-m3")).toBe("BGE-M3");
    // Otros y vacíos.
    expect(modelLabel("z-ai/glm-5.3")).toBe("z-ai/glm-5.3");
    expect(modelLabel(null)).toBeNull();
    // Subtítulos largos recortados para caber en el nodo.
    expect(fitLabel("fixture-token-hash-v1")).toBe("fixture-token-ha…");
    expect(fitLabel("BGE-M3")).toBe("BGE-M3");
  });
});
