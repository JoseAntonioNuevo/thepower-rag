// GUÍA DE LECTURA · apps/api/src/rag-steps.ts
// Pasos del RAG básico para el modo clase. La búsqueda ocurre antes de abrir el stream (así un fallo
// sigue respondiendo 409 o 502), de modo que sus pasos llegan juntos al empezar la respuesta con la
// duración medida en el servidor; la generación sí se emite en directo desde course-stream.ts.
// Es lógica pura: recibe la traza que ya se envía y los tiempos, y no llama a la red.
// Tipos del contrato.
import type { RagStep, TraceEvent } from "@thepower-rag/contracts";

// Duraciones medidas de la búsqueda real (null en la demo o si no se midió).
export interface RagTimings {
  // Embedding de la pregunta en Workers AI.
  embedMs: number | null;
  // Consulta a Vectorize y lectura del texto en D1.
  searchMs: number | null;
}

// Tiempos vacíos: la demo y las rutas sin embedding no miden nada.
export const NO_RAG_TIMINGS: RagTimings = { embedMs: null, searchMs: null };

// Nombre legible de un fragmento: título del documento y sección.
export interface ChunkLabel {
  title: string;
  section: string;
}

// Añade a un candidato el título y la sección si se conocen, recortados al contrato.
function named<T extends { chunkId: string }>(
  item: T,
  labels: ReadonlyMap<string, ChunkLabel> | undefined,
): T & { title?: string; section?: string } {
  // Nombre del fragmento.
  const label = labels?.get(item.chunkId);
  // Sin nombre: tal cual.
  if (label === undefined) {
    return item;
  }
  // Con título y sección.
  return { ...item, title: label.title.slice(0, 200), section: label.section.slice(0, 200) };
}

// Redondea una duración medida a milisegundos enteros no negativos.
function duration(value: number | null): number | null {
  // Sin medida.
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  // Entero y no negativo.
  return Math.max(0, Math.round(value));
}

// Cantidad con singular o plural («1 fragmento», «2 fragmentos»).
function fragments(count: number, one: string, many: string): string {
  // Concordancia.
  return `${String(count)} ${count === 1 ? one : many}`;
}

// Formatea el umbral con coma decimal, como en el resto de la interfaz.
function formatThreshold(value: number): string {
  // Tres decimales bastan para distinguir 0,662 de 0,66.
  return value.toFixed(3).replace(".", ",");
}

// Pasos de la búsqueda y de la decisión del RAG básico a partir de su traza.
export function ragRetrievalSteps(input: {
  // Traza que también se envía como data-trace.
  trace: TraceEvent;
  // Umbral aplicado, o null si la ruta no usa umbral.
  threshold: number | null;
  // Tiempos medidos.
  timings: RagTimings;
  // Nombres de los fragmentos por id, si se conocen.
  labels?: ReadonlyMap<string, ChunkLabel>;
}): RagStep[] {
  // Traza y consulta recortada al contrato.
  const { trace } = input;
  const query = trace.query.slice(0, 500);
  // Candidatos tal como los dejó el umbral, como mucho diez, con su nombre.
  const judged = trace.retrieved
    .slice(0, 10)
    .map((item) =>
      named({ chunkId: item.chunkId, score: item.score, selected: item.selected }, input.labels),
    );
  // Pasos acumulados.
  const steps: RagStep[] = [];
  // Aclaración de calendario: no hay búsqueda ni modelo.
  if (trace.decision === "clarify" && judged.length === 0) {
    // Un único paso.
    steps.push({
      kind: "clarify",
      status: "Pregunta de calendario sin grupo: pide aclaración sin buscar ni llamar al modelo.",
      query,
      model: null,
      durationMs: null,
      threshold: null,
      candidates: [],
    });
    // Termina.
    return steps;
  }
  // Contexto completo: lee todo el grupo desde D1, sin embeddings ni umbral.
  if (trace.queryRewrite === "context-complete") {
    // Lectura del contexto.
    steps.push({
      kind: "search",
      status: `Lee el contexto completo del grupo desde D1: ${String(trace.retrieved.length)} fragmentos, sin embeddings.`,
      query,
      model: null,
      durationMs: duration(input.timings.searchMs),
      threshold: null,
      candidates: judged,
    });
  } else {
    // Embedding de la pregunta.
    steps.push({
      kind: "embed",
      status: `Convierte la pregunta en un vector con ${trace.embedding}.`,
      query,
      model: trace.embedding.slice(0, 128),
      durationMs: duration(input.timings.embedMs),
      threshold: null,
      candidates: [],
    });
    // Búsqueda de vecinos: todavía sin el corte del umbral.
    steps.push({
      kind: "search",
      status: `El índice devuelve ${String(judged.length)} vecinos ordenados por similitud.`,
      query,
      model: null,
      durationMs: duration(input.timings.searchMs),
      threshold: null,
      candidates: judged.map((item) => ({ ...item, selected: false })),
    });
    // Umbral: decide el código, sin modelo.
    if (input.threshold !== null) {
      // Cuántos pasan.
      const passed = judged.filter((item) => item.selected).length;
      // Paso del umbral.
      steps.push({
        kind: "threshold",
        status:
          passed === 0
            ? `Ninguno alcanza ${formatThreshold(input.threshold)}: no se llama al generador.`
            : `${String(passed)} de ${String(judged.length)} alcanzan ${formatThreshold(input.threshold)} y pasan al generador.`,
        query,
        model: null,
        durationMs: null,
        threshold: input.threshold,
        candidates: judged,
      });
    }
  }
  // Rechazo o aclaración tras buscar: termina sin generar.
  if (trace.decision !== "answer") {
    // Paso final.
    steps.push({
      kind: trace.decision === "clarify" ? "clarify" : "refuse",
      status:
        trace.decision === "clarify"
          ? "Pide aclaración sin llamar al modelo."
          : "Responde «no consta» sin llamar al modelo.",
      query,
      model: null,
      durationMs: null,
      threshold: input.threshold,
      candidates: judged.filter((item) => item.selected),
    });
  }
  // Pasos de la búsqueda.
  return steps;
}

// Paso de generación que course-stream.ts emite al empezar a escribir la respuesta.
export function ragGenerateStep(input: {
  // Pregunta.
  query: string;
  // Generador, o null si la respuesta es una plantilla.
  model: string | null;
  // Fragmentos que recibe el generador.
  chunkIds: readonly string[];
  // Nombres de los fragmentos por id, si se conocen.
  labels?: ReadonlyMap<string, ChunkLabel>;
}): RagStep {
  // Paso.
  return {
    kind: "generate",
    status:
      input.model === null
        ? "Respuesta de plantilla de la demo, sin llamar a un modelo."
        : `${input.model} escribe con ${fragments(input.chunkIds.length, "fragmento", "fragmentos")} de evidencia.`,
    query: input.query.slice(0, 500),
    model: input.model === null ? null : input.model.slice(0, 128),
    durationMs: null,
    threshold: null,
    candidates: input.chunkIds
      .slice(0, 10)
      .map((chunkId) => named({ chunkId, score: null, selected: true }, input.labels)),
  };
}

// Paso final con la respuesta ya escrita y las citas validadas.
export function ragAnswerStep(input: {
  // Pregunta.
  query: string;
  // Generador, o null en la plantilla.
  model: string | null;
  // Duración de la generación medida en el servidor.
  durationMs: number | null;
  // Fragmentos citados en la respuesta.
  citedIds: readonly string[];
  // Nombres de los fragmentos por id, si se conocen.
  labels?: ReadonlyMap<string, ChunkLabel>;
}): RagStep {
  // Paso.
  return {
    kind: "answer",
    status:
      input.citedIds.length === 0
        ? "Respuesta terminada, sin citas válidas."
        : `Respuesta terminada. Cita ${fragments(input.citedIds.length, "fragmento validado", "fragmentos validados")}.`,
    query: input.query.slice(0, 500),
    model: input.model === null ? null : input.model.slice(0, 128),
    durationMs: duration(input.durationMs),
    threshold: null,
    candidates: input.citedIds
      .slice(0, 10)
      .map((chunkId) => named({ chunkId, score: null, selected: true }, input.labels)),
  };
}
