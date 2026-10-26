// GUÍA DE LECTURA · apps/web/src/class-mode-view.tsx
// Modo clase: dibuja el grafo de RAG básico o de CRAG, resalta en directo el nodo por el que pasa
// cada turno y explica en un inspector qué entró y qué salió de ese paso (candidatos, coseno, nota del
// juez, umbral, lagunas, consulta reformulada, generador y citas). Al terminar se puede repetir paso a
// paso sin volver a llamar a ningún modelo: solo se recorren los pasos que ya llegaron.
// Hooks de React.
import { useEffect, useState } from "react";
// Tipos de los pasos.
import type { CragStep, RagStep } from "@thepower-rag/contracts";
// Lógica pura del grafo.
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  classView,
  fitLabel,
  formatScore,
  formatSeconds,
  graphFor,
  modelLabel,
  stepCursor,
  type ClassEvent,
  type ClassStage,
  type ClassView,
  type GraphNode,
} from "./class-mode";
// Movimiento: panel que se desliza y estado con fundido.
import { PanelSlide, ThinkStatus } from "./chat-motion-view";

// Ritmo de la repetición automática: tiempo para explicar cada paso en clase (no es una animación).
const REPLAY_STEP_MS = 1500;
// Corte de fragmento útil del juez de CRAG.
const JUDGE_USEFUL = 0.5;

// Modelos que se nombran en los nodos.
export interface ClassModels {
  // Modelo de embeddings.
  embedding: string | null;
  // Generador.
  generator: string | null;
  // Evaluador de CRAG.
  evaluator: string | null;
}

// Subtítulo de un nodo según la etapa, los modelos y el último paso que pasó por él.
function subtitleFor(
  stage: ClassStage,
  node: GraphNode,
  models: ClassModels,
  events: readonly ClassEvent[],
  view: ClassView,
): string {
  // Pasos ya mostrados de ese nodo.
  const shown = view.index === null ? [] : events.slice(0, view.index + 1);
  // RAG.
  if (stage === "rag") {
    // Último paso RAG de este nodo.
    const last = [...shown]
      .reverse()
      .find((event) => event.stage === "rag" && event.step.kind === node.id);
    const step = last?.stage === "rag" ? last.step : null;
    // Embedding: modelo.
    if (node.id === "embed") return modelLabel(models.embedding) ?? node.subtitle;
    // Búsqueda: cuántos vecinos.
    if (node.id === "search" && step) return `${String(step.candidates.length)} vecinos`;
    // Umbral: su valor.
    if (node.id === "threshold" && step?.threshold != null)
      return `corte ${formatScore(step.threshold)}`;
    // Generación: generador.
    if (node.id === "generate") return modelLabel(step?.model ?? models.generator) ?? "plantilla";
    // Resto: texto por defecto.
    return node.subtitle;
  }
  // CRAG: búsqueda con su número; juez y reformulación con el evaluador; respuesta con el generador.
  if (node.id === "retrieve") {
    // Búsquedas mostradas hasta ahora.
    const count = shown.filter(
      (event) => event.stage === "crag" && event.step.kind === "retrieve",
    ).length;
    return count === 0 ? node.subtitle : `búsqueda ${String(count)} de 3`;
  }
  if (node.id === "rank" || node.id === "reformulate")
    return modelLabel(models.evaluator) ?? node.subtitle;
  if (node.id === "answer") return modelLabel(models.generator) ?? node.subtitle;
  // Resto: texto por defecto.
  return node.subtitle;
}

// Barra horizontal de una puntuación en [0, 1], con una marca opcional para el corte.
function ScoreBar({
  value,
  cut,
  strong,
}: {
  // Puntuación, o null si se desconoce.
  value: number | null;
  // Corte que se marca sobre la barra.
  cut: number | null;
  // Si la barra destaca (pasa el corte o es útil).
  strong: boolean;
}) {
  // Ancho en porcentaje, acotado.
  const width = value === null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  // Barra con relleno y marca.
  return (
    <span className="class-bar" aria-hidden="true">
      {/* Relleno. */}
      <span
        className="class-bar-fill"
        data-strong={strong ? "true" : "false"}
        style={{ width: `${String(width)}%` }}
      />
      {/* Marca del corte. */}
      {cut === null ? null : (
        <span className="class-bar-cut" style={{ left: `${String(cut * 100)}%` }} />
      )}
    </span>
  );
}

// Detalle de un paso del RAG básico.
function RagDetail({ step }: { step: RagStep }) {
  // Umbral para marcar en las barras.
  const cut = step.threshold;
  // Contenido.
  return (
    <>
      {/* Estado del paso. */}
      <p className="class-status">{step.status}</p>
      {/* Datos del paso. */}
      <dl className="class-facts">
        {/* Modelo. */}
        {step.model === null ? null : (
          <>
            <dt>Modelo</dt>
            <dd>{modelLabel(step.model)}</dd>
          </>
        )}
        {/* Duración medida. */}
        {step.durationMs === null ? null : (
          <>
            <dt>Duración medida</dt>
            <dd>{formatSeconds(step.durationMs)}</dd>
          </>
        )}
        {/* Pregunta. */}
        <dt>Pregunta</dt>
        <dd>{step.query}</dd>
      </dl>
      {/* Ids sin puntuación (generación y citas): lista simple. */}
      {step.candidates.length > 0 && step.candidates.every((item) => item.score === null) ? (
        <ul className="class-ids">
          {step.candidates.map((item) => (
            <li key={item.chunkId}>{item.chunkId}</li>
          ))}
        </ul>
      ) : null}
      {/* Candidatos con su similitud. */}
      {step.candidates.length === 0 ||
      step.candidates.every((item) => item.score === null) ? null : (
        <ol className="class-candidates">
          {step.candidates.map((item) => (
            <li key={item.chunkId} data-selected={item.selected ? "true" : "false"}>
              {/* Id del fragmento. */}
              <span className="class-chunk">{item.chunkId}</span>
              {/* Barra con el corte. */}
              <ScoreBar value={item.score} cut={cut} strong={item.selected} />
              {/* Puntuación. */}
              <span className="class-score">{formatScore(item.score)}</span>
              {/* Si pasa al generador. */}
              <span className="class-flag">
                {step.kind === "threshold" ? (item.selected ? "pasa" : "fuera") : ""}
              </span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// Detalle de un paso de CRAG.
function CragDetail({ step }: { step: CragStep }) {
  // Candidatos con nota del juez (solo tras evaluar).
  const judged = step.candidates?.some((item) => item.relevance !== null) ?? false;
  // Contenido.
  return (
    <>
      {/* Estado del paso. */}
      <p className="class-status">{step.status}</p>
      {/* Datos del paso. */}
      <dl className="class-facts">
        {/* Consulta. */}
        <dt>Consulta</dt>
        <dd>{step.query}</dd>
        {/* Contadores. */}
        <dt>Búsquedas y reformulaciones</dt>
        <dd>
          {String(step.retrieval ?? 0)} de 3 · {String(step.reformulation ?? 0)} de 2
        </dd>
        {/* Veredicto. */}
        {step.evidenceStatus === null ? null : (
          <>
            <dt>Evidencia</dt>
            <dd>
              {step.evidenceStatus === "sufficient"
                ? "suficiente"
                : step.evidenceStatus === "partial"
                  ? "parcial"
                  : "insuficiente"}
            </dd>
          </>
        )}
        {/* Lagunas. */}
        {step.gaps === undefined || step.gaps.length === 0 ? null : (
          <>
            <dt>Lagunas</dt>
            <dd>{step.gaps.join(" · ")}</dd>
          </>
        )}
        {/* Conservados. */}
        {step.retainedIds.length === 0 ? null : (
          <>
            <dt>Conservados</dt>
            <dd>{step.retainedIds.join(", ")}</dd>
          </>
        )}
        {/* Descartados. */}
        {step.discardedIds.length === 0 ? null : (
          <>
            <dt>Descartados</dt>
            <dd>{step.discardedIds.join(", ")}</dd>
          </>
        )}
      </dl>
      {/* Candidatos: coseno de la búsqueda y, si ya hay juez, su nota y su motivo. */}
      {step.candidates === undefined || step.candidates.length === 0 ? null : (
        <ol className="class-candidates">
          {step.candidates.map((item) => (
            <li
              key={item.chunkId}
              data-selected={
                judged && item.relevance !== null && item.relevance >= JUDGE_USEFUL
                  ? "true"
                  : "false"
              }
            >
              {/* Id del fragmento. */}
              <span className="class-chunk">{item.chunkId}</span>
              {/* Barra: la nota del juez si existe; si no, el coseno. */}
              <ScoreBar
                value={judged ? item.relevance : item.cosine}
                cut={judged ? JUDGE_USEFUL : null}
                strong={judged && item.relevance !== null && item.relevance >= JUDGE_USEFUL}
              />
              {/* Números: nota del juez y coseno. */}
              <span className="class-score">
                {judged ? `juez ${formatScore(item.relevance)}` : formatScore(item.cosine)}
              </span>
              {/* Coseno de referencia junto a la nota. */}
              <span className="class-flag">
                {judged ? `coseno ${formatScore(item.cosine)}` : ""}
              </span>
              {/* Motivo del juez. */}
              {item.reason === null ? null : <span className="class-reason">{item.reason}</span>}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

// Modo clase de una etapa con grafo.
export function ClassModeView({
  stage,
  events,
  live,
  models,
}: {
  // RAG básico o CRAG.
  stage: ClassStage;
  // Pasos recibidos en este turno.
  events: readonly ClassEvent[];
  // Si la respuesta sigue en curso.
  live: boolean;
  // Modelos que se nombran en el grafo.
  models: ClassModels;
}) {
  // Cursor de repetición: null sigue el directo.
  const [cursor, setCursor] = useState<number | null>(null);
  // Repetición automática en marcha.
  const [playing, setPlaying] = useState(false);
  // Pasos de esta etapa.
  const total = events.filter((event) => event.stage === stage).length;
  // La repetición sigue mientras quede algún paso por delante; un turno nuevo remonta el
  // componente (key en ChatPane), así que vuelve solo al directo.
  const replaying = playing && cursor !== null && cursor < total - 1;
  // Repetición automática: avanza un paso cada REPLAY_STEP_MS sin pasar del último.
  useEffect(() => {
    // Parada.
    if (!replaying) {
      return;
    }
    // Temporizador.
    const timer = window.setInterval(() => {
      setCursor((current) => Math.min(total - 1, (current ?? -1) + 1));
    }, REPLAY_STEP_MS);
    // Limpieza.
    return () => {
      window.clearInterval(timer);
    };
  }, [replaying, total]);
  // Vista del grafo.
  const view = classView(stage, events, cursor);
  // Definición del grafo.
  const graph = graphFor(stage);
  // Aristas usadas.
  const used = new Set(view.edges);
  // Nodo activo, para la línea de estado corta (el detalle completo va en el inspector).
  const activeNode = graph.nodes.find((node) => node.id === view.active);
  // Texto de estado: nodo y su modelo o dato.
  const label =
    activeNode === undefined
      ? "Esperando una pregunta"
      : `${activeNode.title} · ${subtitleFor(stage, activeNode, models, events, view)}`;
  // ¿Directo?
  const following = cursor === null;
  // Sección.
  return (
    <section className="class-mode" aria-label="Modo clase">
      {/* Cabecera con el estado del paso. */}
      <div className="class-mode-head">
        {/* Título. */}
        <h2>{stage === "rag" ? "Grafo en directo · RAG básico" : "Grafo en directo · CRAG"}</h2>
        {/* Estado con fundido; brilla mientras la respuesta está en curso. */}
        <ThinkStatus label={label} live={live && following} />
      </div>
      {/* Grafo. */}
      <svg
        className="class-graph"
        viewBox={`0 0 680 ${String(graph.height)}`}
        role="img"
        aria-label={`Grafo de ${stage === "rag" ? "RAG básico" : "CRAG"}; nodo activo: ${view.active ?? "ninguno"}.`}
      >
        {/* Puntas de flecha: una gris y otra para el camino recorrido. */}
        <defs>
          <marker
            id={`class-arrow-${stage}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M2 1L8 5L2 9" className="class-arrow" />
          </marker>
          <marker
            id={`class-arrow-used-${stage}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M2 1L8 5L2 9" className="class-arrow class-arrow-used" />
          </marker>
        </defs>
        {/* Aristas. */}
        {graph.edges.map((edge) => {
          // ¿Recorrida?
          const isUsed = used.has(`${edge.from}->${edge.to}`);
          return (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edge.path}
              className="class-edge"
              data-used={isUsed ? "true" : "false"}
              markerEnd={`url(#${isUsed ? "class-arrow-used-" : "class-arrow-"}${stage})`}
            />
          );
        })}
        {/* Nodos. */}
        {graph.nodes.map((node) => {
          // Estado del nodo.
          const state =
            node.id === view.active
              ? "active"
              : view.visited.includes(node.id)
                ? "visited"
                : "idle";
          return (
            <g key={node.id} className="class-node" data-state={state}>
              {/* Caja. */}
              <rect x={node.x} y={node.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx={8} />
              {/* Título. */}
              <text
                className="class-node-title"
                x={node.x + NODE_WIDTH / 2}
                y={node.y + 19}
                textAnchor="middle"
              >
                {node.title}
              </text>
              {/* Subtítulo con el modelo o el dato del paso. */}
              <text
                className="class-node-sub"
                x={node.x + NODE_WIDTH / 2}
                y={node.y + 36}
                textAnchor="middle"
              >
                {fitLabel(subtitleFor(stage, node, models, events, view))}
              </text>
            </g>
          );
        })}
      </svg>
      {/* Controles de repetición. */}
      <div className="class-controls">
        {/* Paso anterior. */}
        <button
          type="button"
          className="class-button"
          disabled={total === 0 || view.index === 0}
          onClick={() => {
            setPlaying(false);
            setCursor((current) => stepCursor(current, total, -1));
          }}
        >
          Anterior
        </button>
        {/* Paso siguiente. */}
        <button
          type="button"
          className="class-button"
          disabled={total === 0 || view.index === total - 1}
          onClick={() => {
            setPlaying(false);
            setCursor((current) => stepCursor(current, total, 1));
          }}
        >
          Siguiente
        </button>
        {/* Repetir desde el principio, a ritmo de clase. */}
        <button
          type="button"
          className="class-button"
          disabled={total < 2 || live}
          onClick={() => {
            setCursor(0);
            setPlaying(true);
          }}
        >
          Repetir paso a paso
        </button>
        {/* Volver al directo. */}
        <button
          type="button"
          className="class-button"
          disabled={following}
          onClick={() => {
            setPlaying(false);
            setCursor(null);
          }}
        >
          Directo
        </button>
        {/* Posición y momento de llegada. */}
        <span className="class-position">
          {view.index === null
            ? "Sin pasos todavía"
            : `Paso ${String(view.index + 1)} de ${String(view.total)} · llegó a ${formatSeconds(view.event!.at)}${view.visits > 1 ? ` · ${String(view.visits)}.ª vez en este nodo` : ""}`}
        </span>
      </div>
      {/* Inspector del paso mostrado; se desliza al cambiar de paso. */}
      {view.event === null ? null : (
        <PanelSlide key={`${stage}-${String(view.index)}`} className="class-inspector">
          {view.event.stage === "rag" ? (
            <RagDetail step={view.event.step} />
          ) : (
            <CragDetail step={view.event.step} />
          )}
        </PanelSlide>
      )}
    </section>
  );
}
