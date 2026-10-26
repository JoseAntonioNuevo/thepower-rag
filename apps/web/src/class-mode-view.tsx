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
  chunkIndex,
  chunkName,
  classView,
  explainNode,
  fitLabel,
  formatScore,
  formatSeconds,
  graphFor,
  modelLabel,
  nodeOf,
  pendingSteps,
  readableStatus,
  stepCursor,
  stepGuide,
  type ChunkInfo,
  type ClassEvent,
  type ClassStage,
  type ClassView,
  type GraphNode,
} from "./class-mode";
// Movimiento: panel que se desliza y estado con fundido.
import { PanelSlide, ThinkStatus } from "./chat-motion-view";

// Ritmo de la repetición automática: tiempo para explicar cada paso en clase (no es una animación).
const REPLAY_STEP_MS = 1500;
// Ritmo del modo lento: cada paso se queda en pantalla el tiempo de leerlo y comentarlo en voz alta.
const SLOW_STEP_MS = 3500;
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
    if (node.id === "search" && step) return `${String(step.candidates.length)} parecidos`;
    // Filtro: la nota mínima de este turno.
    if (node.id === "threshold" && step?.threshold != null)
      return `mínimo ${formatScore(step.threshold)}`;
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
  if (node.id === "rank") return modelLabel(models.evaluator) ?? node.subtitle;
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

// Nombre de un fragmento: documento, sección y número; el id técnico queda en el tooltip.
function ChunkTitle({
  chunkId,
  info,
  names,
}: {
  // Id del fragmento.
  chunkId: string;
  // Título y sección que trae el propio paso.
  info?: ChunkInfo;
  // Nombres reunidos de todo el turno, por si el paso no los trae.
  names: ReadonlyMap<string, ChunkInfo>;
}) {
  // Nombre legible.
  const name = chunkName(chunkId, info?.title === undefined ? names.get(chunkId) : info);
  // Documento, sección y número.
  return (
    <span className="class-chunk" title={chunkId}>
      {/* Documento. */}
      <span className="class-chunk-doc">{name.document}</span>
      {/* Sección. */}
      {name.section === null ? null : (
        <span className="class-chunk-section"> › {name.section}</span>
      )}
      {/* Número de fragmento. */}
      {name.fragment === null ? null : (
        <span className="class-chunk-id">fragmento {String(name.fragment)}</span>
      )}
    </span>
  );
}

// Lista de fragmentos por su nombre (conservados, descartados, evidencia o citas).
function ChunkList({
  ids,
  names,
}: {
  ids: readonly string[];
  names: ReadonlyMap<string, ChunkInfo>;
}) {
  // Un nombre por línea.
  return (
    <ul className="class-ids">
      {ids.map((id) => (
        <li key={id}>
          <ChunkTitle chunkId={id} names={names} />
        </li>
      ))}
    </ul>
  );
}

// Detalle de un paso del RAG básico.
function RagDetail({ step, names }: { step: RagStep; names: ReadonlyMap<string, ChunkInfo> }) {
  // Umbral para marcar en las barras.
  const cut = step.threshold;
  // Contenido.
  return (
    <>
      {/* Estado del paso. */}
      <p className="class-status">{readableStatus(step.status, names)}</p>
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
        <ChunkList ids={step.candidates.map((item) => item.chunkId)} names={names} />
      ) : null}
      {/* Candidatos con su similitud. */}
      {step.candidates.length === 0 ||
      step.candidates.every((item) => item.score === null) ? null : (
        <ol className="class-candidates">
          {step.candidates.map((item) => (
            <li key={item.chunkId} data-selected={item.selected ? "true" : "false"}>
              {/* Nombre del fragmento: documento, sección y número. */}
              <ChunkTitle
                chunkId={item.chunkId}
                info={{ title: item.title, section: item.section }}
                names={names}
              />
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
function CragDetail({ step, names }: { step: CragStep; names: ReadonlyMap<string, ChunkInfo> }) {
  // Candidatos con nota del juez (solo tras evaluar).
  const judged = step.candidates?.some((item) => item.relevance !== null) ?? false;
  // Contenido.
  return (
    <>
      {/* Estado del paso. */}
      <p className="class-status">{readableStatus(step.status, names)}</p>
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
            <dd>
              <ChunkList ids={step.retainedIds} names={names} />
            </dd>
          </>
        )}
        {/* Descartados. */}
        {step.discardedIds.length === 0 ? null : (
          <>
            <dt>Descartados</dt>
            <dd>
              <ChunkList ids={step.discardedIds} names={names} />
            </dd>
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
              {/* Nombre del fragmento: documento, sección y número. */}
              <ChunkTitle
                chunkId={item.chunkId}
                info={{ title: item.title, section: item.section }}
                names={names}
              />
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
  slow,
  onSlowChange,
}: {
  // RAG básico o CRAG.
  stage: ClassStage;
  // Pasos recibidos en este turno.
  events: readonly ClassEvent[];
  // Si la respuesta sigue en curso.
  live: boolean;
  // Modelos que se nombran en el grafo.
  models: ClassModels;
  // Modo lento: los pasos se muestran de uno en uno, a ritmo de lectura, aunque lleguen antes.
  slow: boolean;
  // Cambia el modo lento (el estado vive fuera para conservarlo entre turnos).
  onSlowChange: (slow: boolean) => void;
}) {
  // Cursor: null sigue el directo; en modo lento empieza en el primer paso.
  const [cursor, setCursor] = useState<number | null>(slow ? 0 : null);
  // Avance automático (repetición o modo lento); los botones manuales lo pausan.
  const [auto, setAuto] = useState(slow);
  // Pasos de esta etapa.
  const total = events.filter((event) => event.stage === stage).length;
  // Avanza mientras quede algún paso por delante; un turno nuevo remonta el componente
  // (key en ChatPane), así que cada turno empieza en el directo o en el primer paso.
  const advancing = auto && cursor !== null && cursor < total - 1;
  // Ritmo del avance automático.
  const pace = slow ? SLOW_STEP_MS : REPLAY_STEP_MS;
  // Avance automático: un paso cada «pace» sin pasar del último recibido.
  useEffect(() => {
    // Parada.
    if (!advancing) {
      return;
    }
    // Temporizador.
    const timer = window.setInterval(() => {
      setCursor((current) => Math.min(total - 1, (current ?? -1) + 1));
    }, pace);
    // Limpieza.
    return () => {
      window.clearInterval(timer);
    };
  }, [advancing, total, pace]);
  // Vista del grafo.
  const view = classView(stage, events, cursor);
  // Pasos recibidos que el modo lento aún no ha enseñado.
  const pending = pendingSteps(view);
  // Definición del grafo.
  const graph = graphFor(stage);
  // Aristas usadas.
  const used = new Set(view.edges);
  // Nodo activo, para la línea de estado corta (el detalle completo va en el inspector).
  const activeNode = graph.nodes.find((node) => node.id === view.active);
  // Texto de estado: nodo y su modelo o dato.
  const label =
    view.active === null
      ? "Esperando una pregunta"
      : activeNode === undefined
        ? // Paso sin nodo dibujado (pedir grupo): su explicación.
          (explainNode(stage, view.active) ?? view.active)
        : `${activeNode.title} · ${subtitleFor(stage, activeNode, models, events, view)}`;
  // Qué hace el nodo activo, en una frase, y cómo leer sus datos.
  const explanation = explainNode(stage, view.active);
  const guide = stepGuide(stage, view.active);
  // Nombres de los fragmentos que han aparecido en el turno.
  const names = chunkIndex(events);
  // ¿Directo?
  const following = cursor === null;
  // Pasos de la etapa para la línea de pasos.
  const own = events.filter((event) => event.stage === stage);
  // Cambia el modo lento: al activarlo vuelve al primer paso y avanza solo; al quitarlo, al directo.
  function toggleSlow(next: boolean) {
    // Estado compartido.
    onSlowChange(next);
    // Recorrido local.
    setCursor(next ? 0 : null);
    setAuto(next);
  }
  // Sección.
  return (
    <section className="class-mode" aria-label="Modo clase">
      {/* Cabecera con el estado del paso y el interruptor del modo lento. */}
      <div className="class-mode-head">
        {/* Título. */}
        <h2>{stage === "rag" ? "Grafo en directo · RAG básico" : "Grafo en directo · CRAG"}</h2>
        {/* Interruptor del modo lento, con el rebote de transitions.dev. */}
        <span className="class-slow">
          <button
            type="button"
            role="switch"
            className="t-toggle"
            aria-checked={slow}
            aria-labelledby={`modo-lento-${stage}`}
            data-on={slow ? "true" : "false"}
            onClick={(event) => {
              // Activa los fotogramas solo tras la primera interacción.
              event.currentTarget.classList.add("is-init");
              // Alterna.
              toggleSlow(!slow);
            }}
          >
            {/* Pulgar. */}
            <span className="t-toggle-thumb" />
          </button>
          {/* Etiqueta. */}
          <span id={`modo-lento-${stage}`}>Modo lento</span>
        </span>
      </div>
      {/* Estado con fundido; brilla mientras quedan pasos por llegar o por enseñar. */}
      <ThinkStatus label={label} live={(live && following) || (auto && pending > 0)} />
      {/* Grafo. */}
      <svg
        className="class-graph"
        viewBox={`0 0 680 ${String(graph.height)}`}
        role="img"
        aria-label={`Grafo de ${stage === "rag" ? "RAG básico" : "CRAG"}; nodo activo: ${view.active ?? "ninguno"}.`}
      >
        {/* Puntas de flecha: gris, recorrida y la de llegada al nodo activo. */}
        <defs>
          {(["idle", "used", "current"] as const).map((kind) => (
            <marker
              key={kind}
              id={`class-arrow-${kind}-${stage}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M2 1L8 5L2 9" className={`class-arrow class-arrow-${kind}`} />
            </marker>
          ))}
        </defs>
        {/* Aristas: la de llegada al nodo activo destaca sobre las ya recorridas. */}
        {graph.edges.map((edge) => {
          // Clave y estado de la arista.
          const key = `${edge.from}->${edge.to}`;
          const kind = key === view.current ? "current" : used.has(key) ? "used" : "idle";
          return (
            <g key={key}>
              <path
                d={edge.path}
                className="class-edge"
                data-state={kind}
                markerEnd={`url(#class-arrow-${kind}-${stage})`}
              />
              {/* Etiqueta de la rama, si la tiene. */}
              {edge.label === undefined ? null : (
                <text
                  className="class-edge-label"
                  x={edge.label.x}
                  y={edge.label.y}
                  textAnchor="middle"
                >
                  {edge.label.text}
                </text>
              )}
            </g>
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
      {/* Línea de pasos: cada paso recibido, en orden; pulsar uno lo fija. */}
      {own.length === 0 ? null : (
        <ol className="class-timeline" aria-label="Pasos recibidos">
          {own.map((event, index) => {
            // Nodo del paso.
            const node = graph.nodes.find((item) => item.id === nodeOf(event));
            return (
              <li key={`${String(index)}-${event.step.kind}`}>
                <button
                  type="button"
                  className="class-chip"
                  data-state={
                    index === view.index ? "active" : index < (view.index ?? 0) ? "done" : "next"
                  }
                  aria-current={index === view.index ? "step" : undefined}
                  onClick={() => {
                    // Fija el paso y pausa el avance.
                    setAuto(false);
                    setCursor(index);
                  }}
                >
                  {String(index + 1)} · {node?.title ?? event.step.kind}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {/* Controles de repetición. */}
      <div className="class-controls">
        {/* Paso anterior. */}
        <button
          type="button"
          className="class-button"
          disabled={total === 0 || view.index === 0}
          onClick={() => {
            setAuto(false);
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
            setAuto(false);
            setCursor((current) => stepCursor(current, total, 1));
          }}
        >
          Siguiente
        </button>
        {/* Seguir solo: reanuda el avance automático desde el paso fijado. */}
        {!auto && cursor !== null && cursor < total - 1 ? (
          <button
            type="button"
            className="class-button"
            onClick={() => {
              setAuto(true);
            }}
          >
            Seguir solo
          </button>
        ) : null}
        {/* Repetir desde el principio, al ritmo elegido. */}
        <button
          type="button"
          className="class-button"
          disabled={total < 2 || live}
          onClick={() => {
            setCursor(0);
            setAuto(true);
          }}
        >
          Repetir paso a paso
        </button>
        {/* Volver al directo (o saltar al último en modo lento). */}
        <button
          type="button"
          className="class-button"
          disabled={following || (slow && pending === 0 && !auto)}
          onClick={() => {
            setAuto(false);
            setCursor(slow ? Math.max(0, total - 1) : null);
          }}
        >
          {slow ? "Ir al último" : "Directo"}
        </button>
        {/* Posición, momento de llegada y pasos pendientes. */}
        <span className="class-position">
          {view.index === null
            ? "Sin pasos todavía"
            : `Paso ${String(view.index + 1)} de ${String(view.total)} · llegó a ${formatSeconds(view.event!.at)}${view.visits > 1 ? ` · ${String(view.visits)}.ª vez en este nodo` : ""}${pending > 0 ? ` · ${String(pending)} por mostrar` : ""}`}
        </span>
      </div>
      {/* Inspector del paso mostrado; se desliza al cambiar de paso. */}
      {view.event === null ? null : (
        <PanelSlide key={`${stage}-${String(view.index)}`} className="class-inspector">
          {/* Qué hace este nodo, para explicarlo en voz alta. */}
          {explanation === null ? null : (
            <p className="class-explain">
              <span className="class-explain-node">{activeNode?.title}</span> {explanation}
            </p>
          )}
          {/* Cómo leer este paso: qué es cada dato que aparece debajo. */}
          {guide.length === 0 ? null : (
            <details className="class-guide" open>
              <summary>Cómo leer este paso</summary>
              <dl>
                {guide.map((entry) => (
                  <div key={entry.term}>
                    <dt>{entry.term}</dt>
                    <dd>{entry.text}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {/* Datos del paso. */}
          {view.event.stage === "rag" ? (
            <RagDetail step={view.event.step} names={names} />
          ) : (
            <CragDetail step={view.event.step} names={names} />
          )}
        </PanelSlide>
      )}
    </section>
  );
}
