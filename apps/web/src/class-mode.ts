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
  // Etiqueta opcional de la rama (por ejemplo «pasa»), con su posición en el lienzo.
  label?: { text: string; x: number; y: number };
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

// Nodos del RAG básico: una fila y, debajo del filtro, la salida sin modelo. El chat ya no tiene
// grupos, así que «pedir grupo» no se dibuja (si llega, el inspector lo explica igualmente).
const RAG_NODES = {
  embed: { id: "embed", title: "Embedding", subtitle: "BGE-M3", x: 20, y: 30 },
  search: { id: "search", title: "Buscar", subtitle: "en Vectorize", x: 145, y: 30 },
  threshold: { id: "threshold", title: "Filtrar", subtitle: "nota mínima", x: 270, y: 30 },
  generate: { id: "generate", title: "Generar", subtitle: "generador", x: 395, y: 30 },
  answer: { id: "answer", title: "Responder", subtitle: "citas validadas", x: 520, y: 30 },
  refuse: { id: "refuse", title: "Rechazar", subtitle: "«no consta»", x: 270, y: 120 },
} satisfies Record<string, GraphNode>;

// Grafo del RAG básico.
export const RAG_GRAPH: GraphDefinition = {
  nodes: Object.values(RAG_NODES),
  edges: [
    across(RAG_NODES.embed, RAG_NODES.search),
    across(RAG_NODES.search, RAG_NODES.threshold),
    // Algún fragmento llega a la nota mínima: pasa al generador.
    { ...across(RAG_NODES.threshold, RAG_NODES.generate), label: { text: "pasa", x: 387, y: 24 } },
    across(RAG_NODES.generate, RAG_NODES.answer),
    // Ninguno llega: rechazo sin llamar al modelo.
    {
      ...down(RAG_NODES.threshold, RAG_NODES.refuse),
      label: { text: "ninguno pasa", x: 368, y: 102 },
    },
  ],
  height: 186,
};

// Nodos de CRAG en cuatro columnas centradas en el lienzo de 680: la fila central es el camino
// feliz; arriba, el bucle correctivo; abajo, las dos salidas sin respuesta.
const CRAG_NODES = {
  retrieve: { id: "retrieve", title: "Buscar", subtitle: "10 candidatos", x: 60, y: 110 },
  rank: { id: "rank", title: "Juez", subtitle: "nota de 0 a 1", x: 210, y: 110 },
  assess: { id: "assess", title: "¿Basta?", subtitle: "decide el código", x: 360, y: 110 },
  answer: { id: "answer", title: "Responder", subtitle: "generador", x: 510, y: 110 },
  reformulate: { id: "reformulate", title: "Reformular", subtitle: "otra consulta", x: 60, y: 20 },
  retain: { id: "retain", title: "Conservar", subtitle: "lo que sirve", x: 210, y: 20 },
  discard: { id: "discard", title: "Descartar", subtitle: "todo", x: 360, y: 20 },
  refuse: { id: "refuse", title: "Rechazar", subtitle: "«no consta»", x: 360, y: 200 },
  error: { id: "error", title: "Detenido", subtitle: "error o tiempo", x: 510, y: 200 },
} satisfies Record<string, GraphNode>;

// Grafo de CRAG con el bucle de reformulación. Cada salida de «¿Basta?» lleva su etiqueta.
export const CRAG_GRAPH: GraphDefinition = {
  nodes: Object.values(CRAG_NODES),
  edges: [
    across(CRAG_NODES.retrieve, CRAG_NODES.rank),
    across(CRAG_NODES.rank, CRAG_NODES.assess),
    // Evidencia suficiente: responde.
    { ...across(CRAG_NODES.assess, CRAG_NODES.answer), label: { text: "sí", x: 490, y: 128 } },
    // Sin búsquedas ni reformulaciones restantes: rechaza.
    {
      ...down(CRAG_NODES.assess, CRAG_NODES.refuse),
      label: { text: "sin intentos", x: 452, y: 181 },
    },
    // Evidencia parcial: sube y gira a la izquierda sin cruzar el juez.
    {
      from: "assess",
      to: "retain",
      path: "M385 110 L385 90 L265 90 L265 72",
      label: { text: "a medias", x: 325, y: 85 },
    },
    // Nada sirve: recto hacia arriba.
    {
      from: "assess",
      to: "discard",
      path: "M435 110 L435 72",
      label: { text: "nada sirve", x: 470, y: 95 },
    },
    // Conservar → reformular: hacia la izquierda, del borde de conservar al de reformular.
    { from: "retain", to: "reformulate", path: "M210 44 L174 44" },
    // Descartar → reformular: por encima de la fila superior.
    { from: "discard", to: "reformulate", path: "M415 20 L415 8 L115 8 L115 16" },
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
      "El código compara la similitud de cada fragmento con la nota mínima calibrada (el corte): solo lo que llega pasa al generador.",
    generate: "El generador escribe la respuesta usando solo los fragmentos que pasaron el umbral.",
    answer: "Se validan las citas: solo se aceptan ids de la evidencia que recibió el generador.",
    refuse:
      "Ningún fragmento llegó a la nota mínima: responde «no consta» sin llamar al modelo, así que no gasta ni inventa.",
    clarify:
      "Solo con el material del curso: una pregunta de horario sin grupo (L/X o M/J) pide el grupo antes de buscar. Con la tienda no ocurre.",
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
    refuse:
      "Se agotaron las búsquedas o las reformulaciones sin evidencia suficiente: responde «no consta».",
    error: "Error o plazo agotado: el turno se detiene sin reintentar ni cambiar de etapa.",
    clarify:
      "Solo con el material del curso: una pregunta de horario sin grupo (L/X o M/J) pide el grupo antes de buscar. Con la tienda no ocurre.",
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

// Nombre legible de un fragmento para la clase: documento, sección y número de fragmento.
export interface ChunkName {
  // Título del documento (o su id humanizado si no se conoce).
  document: string;
  // Sección del fragmento, o null si no se conoce.
  section: string | null;
  // Número de fragmento dentro del documento, empezando en 1, o null si el id no lo trae.
  fragment: number | null;
  // Id técnico completo, para el tooltip.
  id: string;
}

// Título y sección conocidos de un fragmento.
export interface ChunkInfo {
  title?: string;
  section?: string;
}

// Id de documento convertido en texto: «03-electronica-y-garantia» → «Electronica y garantia».
function humanizeDocument(slug: string): string {
  // Sin el prefijo numérico y con espacios.
  const words = slug.replace(/^\d+-/, "").replace(/-/g, " ").trim();
  // Primera letra en mayúscula.
  return words.length === 0 ? slug : words.charAt(0).toUpperCase() + words.slice(1);
}

// Nombre de un fragmento a partir de su id («versión:documento:NN») y de lo que se sepa de él.
export function chunkName(chunkId: string, info?: ChunkInfo): ChunkName {
  // Partes del id: la versión delante, el número de fragmento detrás.
  const parts = chunkId.split(":");
  const ordinal = parts.length >= 3 ? Number(parts[parts.length - 1]) : Number.NaN;
  const slug = parts.length >= 3 ? parts.slice(1, -1).join(":") : chunkId;
  // Documento y sección; la sección se omite si repite el título.
  const document = info?.title?.trim() || humanizeDocument(slug);
  const section = info?.section?.trim() || null;
  // Nombre.
  return {
    document,
    section: section === document ? null : section,
    fragment: Number.isInteger(ordinal) ? ordinal + 1 : null,
    id: chunkId,
  };
}

// Cambia los ids de fragmento de un texto de estado por su nombre legible (documento y número).
export function readableStatus(status: string, names: ReadonlyMap<string, ChunkInfo>): string {
  // Ids «versión:documento:NN» y, si le sigue, su puntuación en inglés («0.800»).
  return status.replace(
    /\b([a-z0-9]{8,}:[a-z0-9-]+:\d{2})\b(?: (\d\.\d{3}))?/g,
    (_match, id: string, score: string | undefined) => {
      // Nombre del fragmento.
      const name = chunkName(id, names.get(id));
      // Documento, número de fragmento y puntuación con coma.
      const label =
        name.fragment === null
          ? name.document
          : `${name.document} (fragmento ${String(name.fragment)})`;
      return score === undefined ? label : `${label} ${score.replace(".", ",")}`;
    },
  );
}

// Título y sección de cada fragmento que ya ha aparecido en algún paso del turno.
export function chunkIndex(events: readonly ClassEvent[]): Map<string, ChunkInfo> {
  // Índice por id.
  const index = new Map<string, ChunkInfo>();
  // Candidatos de todos los pasos.
  for (const event of events) {
    for (const item of event.step.candidates ?? []) {
      // Solo los que traen nombre.
      if (item.title !== undefined && !index.has(item.chunkId)) {
        index.set(item.chunkId, { title: item.title, section: item.section });
      }
    }
  }
  // Índice.
  return index;
}

// Una entrada de la guía de lectura: qué es cada cosa que se ve en el paso.
export interface GuideEntry {
  term: string;
  text: string;
}

// Guía «Cómo leer este paso» de cada nodo, para leerla en clase.
const STEP_GUIDES: Record<ClassStage, Record<string, readonly GuideEntry[]>> = {
  rag: {
    embed: [
      {
        term: "Modelo",
        text: "BGE-M3, en Workers AI, convierte el texto en un vector de 1024 números.",
      },
      { term: "Duración medida", text: "Tiempo que tardó este paso en el servidor." },
      { term: "Pregunta", text: "El texto exacto que se convierte en vector y se busca." },
    ],
    search: [
      {
        term: "Fragmento",
        text: "Trozo de una política, de 900 caracteres como mucho: primero el documento, después su sección.",
      },
      {
        term: "Barra y número",
        text: "Similitud coseno entre la pregunta y el fragmento, de 0 a 1: más alto es más parecido. No es una probabilidad de acierto.",
      },
      { term: "Vecinos", text: "RAG básico solo mira los 4 fragmentos más parecidos." },
    ],
    threshold: [
      {
        term: "Marca azul",
        text: "El umbral calibrado: solo pasa al generador lo que llega a la marca.",
      },
      {
        term: "pasa / fuera",
        text: "«pasa» llega al generador; «fuera» se ignora aunque trate del tema.",
      },
      {
        term: "Calibración",
        text: "El umbral se eligió con preguntas de validación, a medio camino entre la peor con respuesta y la mejor sin ella.",
      },
    ],
    generate: [
      {
        term: "Generador",
        text: "Escribe la respuesta con los fragmentos que pasaron, marcados como datos no fiables: no ve nada más del corpus.",
      },
      { term: "Lista", text: "Los fragmentos que recibe el generador." },
    ],
    answer: [
      {
        term: "Citas",
        text: "Cada [cite:id] se comprueba contra la evidencia; un id inventado se borra antes de mostrarlo.",
      },
      { term: "Duración medida", text: "Tiempo de la generación en el servidor." },
    ],
    refuse: [
      {
        term: "Rechazar",
        text: "Sin evidencia que pase la nota mínima no se llama al modelo: responde «no consta», no gasta y no inventa.",
      },
    ],
    clarify: [
      {
        term: "Pedir grupo",
        text: "Una pregunta de horario necesita saber el grupo (L/X o M/J); se pide antes de buscar o generar. Solo con el material del curso.",
      },
    ],
  },
  crag: {
    retrieve: [
      {
        term: "Consulta",
        text: "Lo que se busca en esta vuelta: la pregunta original o su reformulación.",
      },
      {
        term: "Búsquedas y reformulaciones",
        text: "Cuántas lleva de su máximo: 3 búsquedas y 2 reformulaciones por turno.",
      },
      {
        term: "Barra y número",
        text: "Similitud coseno de Vectorize, de 0 a 1. Aquí no se corta: los 10 candidatos pasan al juez.",
      },
    ],
    rank: [
      {
        term: "Nota del juez",
        text: "De 0 a 1, cuánto sirve el fragmento para responder. La marca azul es 0,50: desde ahí cuenta como útil.",
      },
      {
        term: "Coseno",
        text: "La similitud de la búsqueda, para comparar: el juez puede subir un fragmento que la búsqueda dejó abajo.",
      },
      { term: "Motivo", text: "Por qué el juez le pone esa nota, con sus palabras." },
    ],
    assess: [
      {
        term: "Evidencia",
        text: "Suficiente (cobertura de 0,75 o más, sin lagunas) responde; parcial (0,40 a 0,75) conserva y reformula; insuficiente (menos de 0,40) descarta y reformula.",
      },
      { term: "Lagunas", text: "Lo que falta para responder; guía la siguiente búsqueda." },
      {
        term: "Conservados",
        text: "Fragmentos útiles que pasan a la respuesta o a la siguiente vuelta.",
      },
      {
        term: "Quién decide",
        text: "El juez solo pone notas; los umbrales viven en el código, no en el prompt.",
      },
    ],
    retain: [
      {
        term: "Conservados",
        text: "Lo útil se guarda para no perderlo cuando se vuelva a buscar.",
      },
    ],
    discard: [
      {
        term: "Descartados",
        text: "Lo recuperado no sirve y queda fuera de la respuesta, con su motivo.",
      },
    ],
    reformulate: [
      {
        term: "Consulta nueva",
        text: "El evaluador reescribe la búsqueda para cubrir la laguna; la pregunta original no cambia.",
      },
      { term: "Reformulaciones", text: "Como mucho 2 por turno." },
    ],
    answer: [
      {
        term: "Generador",
        text: "Responde solo con los fragmentos conservados y cita sus ids, que se validan.",
      },
      {
        term: "Coste",
        text: "Un turno CRAG puede hacer hasta 6 llamadas; por eso reserva más que RAG básico.",
      },
    ],
    refuse: [
      {
        term: "Rechazar",
        text: "Se agotaron las búsquedas o las reformulaciones sin evidencia suficiente.",
      },
    ],
    error: [
      {
        term: "Detenido",
        text: "Un error o el plazo del turno agotado; no se reintenta ni se cambia de etapa.",
      },
    ],
    clarify: [
      {
        term: "Pedir grupo",
        text: "Una pregunta de horario necesita saber el grupo (L/X o M/J); se pide antes de buscar. Solo con el material del curso.",
      },
    ],
  },
};

// Guía de lectura de un nodo; vacía si el nodo no existe en esa etapa.
export function stepGuide(stage: ClassStage, node: string | null): readonly GuideEntry[] {
  // Sin nodo.
  if (node === null) {
    return [];
  }
  // Entradas del nodo.
  return STEP_GUIDES[stage][node] ?? [];
}
