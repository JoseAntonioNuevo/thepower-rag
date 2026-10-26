// GUÍA DE LECTURA · apps/web/src/class-mode.ts
// Lógica pura del modo clase: los grafos de RAG básico y CRAG que se dibujan, a qué nodo corresponde
// cada paso que llega por el stream y qué está activo, recorrido o pendiente en cada momento, tanto
// en directo como al repetir el turno paso a paso. No toca React ni la red: se prueba sin navegador.
// Tipos de los pasos que emite la API.
import type { CragStep, RagStep } from "@thepower-rag/contracts";

// Etapas con grafo en el modo clase.
export type ClassStage = "rag" | "crag";

// Paso recibido con el instante de llegada, en milisegundos desde el envío de la pregunta.
export type ClassEvent =
  | { stage: "rag"; at: number; step: RagStep }
  | { stage: "crag"; at: number; step: CragStep };

// Nodo del grafo: id, textos y posición en el lienzo de 680 de ancho.
export interface GraphNode {
  // Id estable (coincide con el tipo de paso o con su agrupación).
  id: string;
  // Título y subtítulo por defecto.
  title: string;
  subtitle: string;
  // Esquina superior izquierda.
  x: number;
  y: number;
}

// Arista entre dos nodos con su trazado SVG.
export interface GraphEdge {
  // Origen y destino.
  from: string;
  to: string;
  // Trazado.
  path: string;
}

// Grafo completo: nodos, aristas y alto del lienzo.
export interface GraphDefinition {
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  height: number;
}

// Tamaño común de los nodos.
export const NODE_WIDTH = 110;
export const NODE_HEIGHT = 48;

// Arista horizontal entre dos nodos de la misma fila.
function across(from: GraphNode, to: GraphNode): GraphEdge {
  // Del borde derecho del origen al izquierdo del destino, dejando sitio a la punta.
  const y = from.y + NODE_HEIGHT / 2;
  return {
    from: from.id,
    to: to.id,
    path: `M${String(from.x + NODE_WIDTH)} ${String(y)} L${String(to.x - 4)} ${String(y)}`,
  };
}

// Arista vertical entre dos nodos de la misma columna.
function down(from: GraphNode, to: GraphNode): GraphEdge {
  // Del borde inferior del origen al superior del destino.
  const x = from.x + NODE_WIDTH / 2;
  return {
    from: from.id,
    to: to.id,
    path: `M${String(x)} ${String(from.y + NODE_HEIGHT)} L${String(x)} ${String(to.y - 4)}`,
  };
}

// Nodos del RAG básico: una fila y dos salidas sin modelo debajo.
const RAG_NODES = {
  embed: { id: "embed", title: "Embedding", subtitle: "BGE-M3", x: 20, y: 30 },
  search: { id: "search", title: "Vectorize", subtitle: "vecinos", x: 145, y: 30 },
  threshold: { id: "threshold", title: "Umbral", subtitle: "decide el código", x: 270, y: 30 },
  generate: { id: "generate", title: "Generar", subtitle: "generador", x: 395, y: 30 },
  answer: { id: "answer", title: "Citas", subtitle: "validadas", x: 520, y: 30 },
  refuse: { id: "refuse", title: "No consta", subtitle: "sin modelo", x: 270, y: 120 },
  clarify: { id: "clarify", title: "Aclarar", subtitle: "sin buscar", x: 20, y: 120 },
} satisfies Record<string, GraphNode>;

// Grafo del RAG básico.
export const RAG_GRAPH: GraphDefinition = {
  nodes: Object.values(RAG_NODES),
  edges: [
    across(RAG_NODES.embed, RAG_NODES.search),
    across(RAG_NODES.search, RAG_NODES.threshold),
    across(RAG_NODES.threshold, RAG_NODES.generate),
    across(RAG_NODES.generate, RAG_NODES.answer),
    down(RAG_NODES.threshold, RAG_NODES.refuse),
  ],
  height: 186,
};

// Nodos de CRAG: la fila central es el camino feliz; arriba, el bucle correctivo; abajo, las salidas.
const CRAG_NODES = {
  retrieve: { id: "retrieve", title: "Buscar", subtitle: "10 candidatos", x: 20, y: 110 },
  rank: { id: "rank", title: "Juez", subtitle: "nota 0–1", x: 150, y: 110 },
  assess: { id: "assess", title: "Decidir", subtitle: "suficiencia", x: 280, y: 110 },
  answer: { id: "answer", title: "Responder", subtitle: "generador", x: 410, y: 110 },
  reformulate: { id: "reformulate", title: "Reformular", subtitle: "evaluador", x: 20, y: 20 },
  retain: { id: "retain", title: "Conservar", subtitle: "parcial", x: 150, y: 20 },
  discard: { id: "discard", title: "Descartar", subtitle: "insuficiente", x: 280, y: 20 },
  refuse: { id: "refuse", title: "No consta", subtitle: "sin intentos", x: 280, y: 200 },
  error: { id: "error", title: "Detenido", subtitle: "error o plazo", x: 410, y: 200 },
  clarify: { id: "clarify", title: "Aclarar", subtitle: "sin buscar", x: 540, y: 110 },
} satisfies Record<string, GraphNode>;

// Grafo de CRAG con el bucle de reformulación.
export const CRAG_GRAPH: GraphDefinition = {
  nodes: Object.values(CRAG_NODES),
  edges: [
    across(CRAG_NODES.retrieve, CRAG_NODES.rank),
    across(CRAG_NODES.rank, CRAG_NODES.assess),
    across(CRAG_NODES.assess, CRAG_NODES.answer),
    down(CRAG_NODES.assess, CRAG_NODES.refuse),
    // Decidir → conservar: sube y gira a la izquierda sin cruzar el juez.
    { from: "assess", to: "retain", path: "M305 110 L305 90 L205 90 L205 72" },
    // Decidir → descartar: recto hacia arriba.
    { from: "assess", to: "discard", path: "M345 110 L345 72" },
    // Conservar → reformular: hacia la izquierda, del borde de conservar al de reformular.
    { from: "retain", to: "reformulate", path: "M150 44 L134 44" },
    // Descartar → reformular: por encima de la fila superior.
    { from: "discard", to: "reformulate", path: "M335 20 L335 8 L75 8 L75 16" },
    // Reformular → buscar otra vez.
    down(CRAG_NODES.reformulate, CRAG_NODES.retrieve),
  ],
  height: 262,
};

// Grafo de una etapa.
export function graphFor(stage: ClassStage): GraphDefinition {
  // RAG o CRAG.
  return stage === "rag" ? RAG_GRAPH : CRAG_GRAPH;
}

// Nodo que representa un paso: los de CRAG que fallan o se cancelan comparten «Detenido».
export function nodeOf(event: ClassEvent): string {
  // RAG: el tipo es el nodo.
  if (event.stage === "rag") {
    return event.step.kind;
  }
  // CRAG: error y cancelación van al mismo nodo.
  return event.step.kind === "error" || event.step.kind === "abort" ? "error" : event.step.kind;
}

// Vista del grafo en un instante: paso mostrado, nodo activo, recorrido y aristas usadas.
export interface ClassView {
  // Índice del paso mostrado, o null si aún no ha llegado ninguno.
  index: number | null;
  // Paso mostrado.
  event: ClassEvent | null;
  // Nodo activo.
  active: string | null;
  // Nodos ya recorridos antes del activo.
  visited: readonly string[];
  // Aristas usadas hasta el paso mostrado, como «origen->destino».
  edges: readonly string[];
  // Veces que se ha pasado por el nodo activo (búsqueda 2, reformulación 1…).
  visits: number;
  // Arista por la que se acaba de llegar al nodo activo, o null si es el primero.
  current: string | null;
  // Pasos totales recibidos.
  total: number;
}

// Calcula la vista: cursor null sigue el último paso (directo); un número fija ese paso (repetición).
export function classView(
  stage: ClassStage,
  events: readonly ClassEvent[],
  cursor: number | null,
): ClassView {
  // Solo los pasos de la etapa del grafo.
  const own = events.filter((event) => event.stage === stage);
  // Sin pasos.
  if (own.length === 0) {
    return {
      index: null,
      event: null,
      active: null,
      visited: [],
      edges: [],
      visits: 0,
      current: null,
      total: 0,
    };
  }
  // Índice dentro de los límites.
  const index = cursor === null ? own.length - 1 : Math.max(0, Math.min(cursor, own.length - 1));
  // Nodos hasta ese paso, en orden.
  const path = own.slice(0, index + 1).map(nodeOf);
  // Aristas conocidas entre nodos consecutivos.
  const known = new Set(graphFor(stage).edges.map((edge) => `${edge.from}->${edge.to}`));
  const edges = new Set<string>();
  for (let position = 1; position < path.length; position++) {
    // Arista del paso anterior al actual.
    const key = `${path[position - 1]!}->${path[position]!}`;
    if (known.has(key)) edges.add(key);
  }
  // Nodo activo y cuántas veces se ha visitado.
  const active = path[path.length - 1]!;
  const visits = path.filter((node) => node === active).length;
  // Arista de llegada al nodo activo, si el grafo la dibuja.
  const arrival = path.length > 1 ? `${path[path.length - 2]!}->${active}` : null;
  // Vista.
  return {
    index,
    event: own[index]!,
    active,
    visited: [...new Set(path.slice(0, -1))].filter((node) => node !== active),
    edges: [...edges],
    visits,
    current: arrival !== null && known.has(arrival) ? arrival : null,
    total: own.length,
  };
}

// Qué hace cada nodo, en una frase para explicarlo en voz alta durante la clase.
const NODE_EXPLANATIONS: Record<ClassStage, Record<string, string>> = {
  rag: {
    embed: "Convierte la pregunta en un vector de números para compararla con los fragmentos.",
    search: "Busca en Vectorize los fragmentos cuyo vector se parece más al de la pregunta.",
    threshold:
      "El código compara cada similitud con el umbral calibrado: lo que no llega, no pasa al generador.",
    generate: "El generador escribe la respuesta usando solo los fragmentos que pasaron el umbral.",
    answer: "Se validan las citas: solo se aceptan ids de la evidencia que recibió el generador.",
    refuse: "Ningún fragmento alcanzó el umbral: responde «no consta» sin llamar al modelo.",
    clarify: "Falta el grupo para una pregunta de calendario: pide aclaración sin buscar.",
  },
  crag: {
    retrieve: "Busca 10 candidatos en Vectorize. Aquí no corta ningún umbral: decidirá el juez.",
    rank: "El juez lee el texto de cada candidato y le pone una nota de 0 a 1 con su motivo.",
    assess:
      "El código decide con las notas y la cobertura: suficiente responde, parcial conserva, insuficiente descarta.",
    retain: "La evidencia es parcial: guarda lo útil y anota la laguna que falta cubrir.",
    discard: "Nada de lo recuperado sirve: lo descarta y prepara otra búsqueda.",
    reformulate:
      "El evaluador reescribe la búsqueda para cubrir la laguna, sin cambiar la pregunta.",
    answer: "El generador responde solo con los fragmentos conservados y cita sus ids.",
    refuse: "Se agotaron las búsquedas o las reformulaciones: responde «no consta».",
    error: "Error o plazo agotado: el turno se detiene sin reintentar ni cambiar de etapa.",
    clarify: "Falta el grupo para una pregunta de calendario: pide aclaración sin buscar.",
  },
};

// Frase didáctica de un nodo, o null si el nodo no existe en esa etapa.
export function explainNode(stage: ClassStage, node: string | null): string | null {
  // Sin nodo.
  if (node === null) {
    return null;
  }
  // Frase de la etapa.
  return NODE_EXPLANATIONS[stage][node] ?? null;
}

// Pasos recibidos que el modo lento todavía no ha mostrado.
export function pendingSteps(view: ClassView): number {
  // Sin pasos o en el último.
  if (view.index === null) {
    return 0;
  }
  // Los que quedan por delante.
  return Math.max(0, view.total - 1 - view.index);
}

// Siguiente posición del cursor al avanzar o retroceder; desde el directo parte del último paso.
export function stepCursor(cursor: number | null, total: number, direction: -1 | 1): number | null {
  // Sin pasos no hay cursor.
  if (total === 0) {
    return null;
  }
  // Posición actual.
  const current = cursor ?? total - 1;
  // Nueva posición acotada.
  return Math.max(0, Math.min(total - 1, current + direction));
}

// Segundos con coma decimal para la línea de tiempo.
export function formatSeconds(ms: number): string {
  // Una cifra decimal.
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

// Puntuación con tres decimales y coma.
export function formatScore(value: number | null): string {
  // Desconocida.
  if (value === null) {
    return "—";
  }
  // Tres decimales.
  return value.toFixed(3).replace(".", ",");
}

// Nombre legible de un modelo: «claude-haiku-5-5» → «Claude Haiku 5.5»; BGE-M3 sin prefijo.
export function modelLabel(id: string | null | undefined): string | null {
  // Sin modelo.
  if (id === null || id === undefined || id.trim() === "") {
    return null;
  }
  // Claude: familia y versión.
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(id);
  if (claude) {
    // Familia con mayúscula inicial.
    const family = claude[1]!.charAt(0).toUpperCase() + claude[1]!.slice(1);
    return `Claude ${family} ${claude[2]!}.${claude[3]!}`;
  }
  // Workers AI: el último tramo del id («@cf/baai/bge-m3» → «BGE-M3»).
  if (id.startsWith("@cf/")) {
    return (id.split("/").at(-1) ?? id).toUpperCase();
  }
  // Cualquier otro id, tal cual.
  return id;
}

// Recorta un texto para que quepa en el subtítulo de un nodo (unos 17 caracteres a 12 px).
export function fitLabel(text: string, max = 17): string {
  // Cabe tal cual.
  if (text.length <= max) {
    return text;
  }
  // Recorta y marca el corte.
  return `${text.slice(0, max - 1)}…`;
}
