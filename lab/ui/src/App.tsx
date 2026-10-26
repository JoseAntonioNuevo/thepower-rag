// GUÍA DE LECTURA · lab/ui/src/App.tsx
// Consola docente: el servidor ejecuta, React observa los eventos y envía controles explícitos.
// Cambiar de pestaña o reconectar EventSource nunca inicia otra llamada a los modelos.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AULA_STAGES,
  type AulaDocument,
  type AulaEvent,
  type AulaKind,
  type AulaMode,
  type AulaRun,
  type AulaStageId,
  type AulaStatus,
  type AulaStoredChunk,
} from "@thepower-rag/contracts";
import { api, appendEvent, formatMs, list, record, stageData, time, words } from "./data";
import { Json, StageInspector, Vector } from "./inspectors";

// Dos ejemplos didácticos conocidos: uno con evidencia y otro que exige rechazar.
const QUESTIONS = [
  {
    label: "Pregunta con evidencia",
    text: "Devolví en un punto ThePower Shop un pedido que pagué con Bizum. ¿Cuánto puede tardar en llegarme el dinero?",
  },
  {
    label: "Pregunta sin evidencia",
    text: "¿Qué descuento tienen los estudiantes universitarios en ThePower Shop?",
  },
];
const KIND_LABEL = {
  rag: "RAG básico",
  baseline: "Sin documentos",
  ingest: "Indexar corpus",
} as const;
const STATE_LABEL = {
  running: "En ejecución",
  waiting: "En pausa",
  complete: "Completada",
  failed: "Con error",
  cancelled: "Cancelada",
  interrupted: "Interrumpida",
} as const;
type Catalog = { documents: AulaDocument[]; chunks: AulaStoredChunk[] };

// La inspección de la base se mantiene visible aunque no haya una consulta en curso.
function Corpus({ catalog }: { catalog: Catalog }) {
  const [id, setId] = useState(catalog.documents[0]?.documentId ?? "");
  const doc = catalog.documents.find((item) => item.documentId === id) ?? catalog.documents[0];
  const chunks = catalog.chunks.filter((item) => item.documentId === doc?.documentId);
  if (!doc) return <p>No se encontraron fuentes del laboratorio.</p>;
  return (
    <section className="corpus-workspace">
      <div className="corpus-list">
        <p className="eyebrow">Fuentes del corpus</p>
        {catalog.documents.map((item, index) => (
          <button
            key={item.documentId}
            aria-pressed={doc.documentId === item.documentId}
            onClick={() => setId(item.documentId)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.title}
          </button>
        ))}
      </div>
      <article className="corpus-document">
        <p className="eyebrow">Documento original</p>
        <h2>{doc.title}</h2>
        <p className="path">{doc.sourcePath}</p>
        <pre className="source-text">{doc.rawText}</pre>
        <Json value={doc.cleanText} label="Comparar con el texto limpio" />
        <div className="section-line">
          <h3>Fragmentos guardados en PostgreSQL</h3>
          <span>{chunks.length}</span>
        </div>
        {chunks.map((chunk) => (
          <details className="document" key={chunk.chunkId}>
            <summary>
              {chunk.section}
              <small>{chunk.chunkId}</small>
            </summary>
            <p className="preserve">{chunk.content}</p>
            <p className="caption">
              {chunk.embeddingModel} · posición {chunk.ordinal}
            </p>
            <Vector value={chunk.vector} />
          </details>
        ))}
        <Json
          value={{ documentId: doc.documentId, contentHash: doc.contentHash }}
          label="Identidad de la fuente"
        />
      </article>
    </section>
  );
}

// El estado visual se deriva exclusivamente de los eventos confirmados del recorrido.
function stageState(run: AulaRun, stage: AulaStageId) {
  const events = run.events.filter((event) => event.stage === stage && event.type === "stage");
  const last = events.at(-1);
  if (last?.phase === "complete")
    return { label: "Hecho", className: "complete", duration: last.durationMs };
  if (run.waitingStage === stage)
    return { label: "Por ejecutar", className: "waiting", duration: null };
  if (run.currentStage === stage && run.status === "running")
    return { label: "En curso", className: "running", duration: null };
  return {
    label: run.status === "complete" ? "Omitido" : "Pendiente",
    className: "pending",
    duration: null,
  };
}

// Agrupa resultado y consumo con el mismo identificador que aparece en TablePlus.
function Result({ run }: { run: AulaRun }) {
  const receipt = record(run.result);
  const result = record(receipt.result);
  const operations = list(receipt.operations);
  return (
    <section className="run-result">
      <div className="section-line">
        <h3>
          {result.decision === "refuse"
            ? "Rechazo sin generación"
            : run.kind === "ingest"
              ? "Índice comprobado"
              : "Resultado del recorrido"}
        </h3>
        <span>{STATE_LABEL[run.status]}</span>
      </div>
      {result.answer ? (
        <p className="answer">{words(result.answer)}</p>
      ) : (
        <Json value={result} label="Recibo del índice" />
      )}
      <div className="facts">
        <span>
          Recuperaciones <b>{words(result.retrievalCount) || "—"}</b>
        </span>
        <span>
          Generador{" "}
          <b>
            {result.generationCalled === false
              ? "no llamado"
              : result.generationCalled === true
                ? "llamado"
                : "—"}
          </b>
        </span>
        <span>
          Operaciones de modelo <b>{operations.length}</b>
        </span>
      </div>
      <Json value={operations} label="Uso observado por los proveedores" />
      <Json value={receipt.budget} label="Reserva acumulada del laboratorio" />
    </section>
  );
}

// Lectura inicial sin efectos de React ni llamadas a proveedores.
async function readBoot(signal?: AbortSignal) {
  return Promise.all([
    api<AulaStatus>("/api/status", undefined, signal),
    api<Catalog>("/api/corpus", undefined, signal),
    api<Omit<AulaRun, "events">[]>("/api/runs", undefined, signal),
  ]);
}

// La consola usa el mismo origen local para datos, controles y SSE.
export function App() {
  const [status, setStatus] = useState<AulaStatus | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [history, setHistory] = useState<Omit<AulaRun, "events">[]>([]);
  const [run, setRun] = useState<AulaRun | null>(null);
  const [view, setView] = useState<"run" | "corpus" | "history">("run");
  const [kind, setKind] = useState<AulaKind>("rag");
  const [mode, setMode] = useState<AulaMode>("step");
  const [question, setQuestion] = useState(QUESTIONS[0]!.text);
  const [pinned, setPinned] = useState<AulaStageId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [connected, setConnected] = useState(true);
  const action = useRef(false);
  const selection = useRef(0);

  // Preparar la pantalla solo lee datos. Ninguna petición GET ejecuta modelos.
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const [nextStatus, nextCatalog, nextHistory] = await readBoot(signal);
    setStatus(nextStatus);
    setCatalog(nextCatalog);
    setHistory(nextHistory);
    return nextStatus;
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void readBoot(controller.signal)
      .then(async ([next, nextCatalog, nextHistory]) => {
        if (controller.signal.aborted) return;
        setStatus(next);
        setCatalog(nextCatalog);
        setHistory(nextHistory);
        const id = next.activeRunId ?? sessionStorage.getItem("thepower-aula-run");
        if (id && !controller.signal.aborted) {
          const saved = await api<AulaRun>(`/api/runs/${id}`, undefined, controller.signal);
          if (!controller.signal.aborted) {
            setRun(saved);
            setKind(saved.kind);
            setMode(saved.mode);
            if (saved.kind !== "ingest") setQuestion(saved.question);
          }
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "No se pudo preparar el Aula.");
      });
    return () => controller.abort();
  }, []);

  // El snapshot al reconectar sustituye la vista; las actualizaciones tienen una secuencia única.
  const runId = run?.id;
  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.addEventListener("snapshot", (message: MessageEvent<string>) => {
      const next = JSON.parse(message.data) as AulaRun;
      setRun(next);
      setConnected(true);
      if (!["running", "waiting"].includes(next.status)) source.close();
    });
    source.addEventListener("update", (message: MessageEvent<string>) => {
      const next = JSON.parse(message.data) as { event: AulaEvent; run: Omit<AulaRun, "events"> };
      setRun((current) =>
        current?.id === next.run.id ? appendEvent(current, next.event, next.run) : current,
      );
      setConnected(true);
      if (!["running", "waiting"].includes(next.run.status)) {
        source.close();
        void refresh().catch(() => {});
      }
    });
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, [runId, refresh]);

  const live = run !== null && ["running", "waiting"].includes(run.status);
  const displayedMode = live ? run.mode : mode;
  const displayedKind = live ? run.kind : kind;
  const stage = pinned ?? run?.currentStage ?? run?.stages[0] ?? "question-embedding";
  const selected = run ? stageData(run, stage) : null;
  const busyStage = run?.status === "running";
  const activeElsewhere =
    status?.activeRunId !== null &&
    status?.activeRunId !== undefined &&
    status.activeRunId !== run?.id;

  // El cerrojo síncrono cubre dos clics anteriores al siguiente render de React.
  async function mutate(operation: () => Promise<void>) {
    if (action.current) return;
    action.current = true;
    setActing(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo completar la acción.");
    } finally {
      action.current = false;
      setActing(false);
    }
  }
  function start() {
    void mutate(async () => {
      const next = await api<AulaRun>("/api/runs", { kind, mode, question });
      sessionStorage.setItem("thepower-aula-run", next.id);
      setRun(next);
      setPinned(null);
      setView("run");
    });
  }
  function control(name: string) {
    if (!run) return;
    void mutate(async () => {
      const next = await api<AulaRun>(`/api/runs/${run.id}/${name}`, { stage: run.waitingStage });
      if (name === "advance" || name === "automatic") setPinned(null);
      setRun((current) =>
        current?.id === next.id && current.events.length > next.events.length ? current : next,
      );
    });
  }
  async function chooseRun(id: string) {
    const version = ++selection.current;
    try {
      const next = await api<AulaRun>(`/api/runs/${id}`);
      if (version !== selection.current) return;
      setRun(next);
      setKind(next.kind);
      setMode(next.mode);
      if (next.kind !== "ingest") setQuestion(next.question);
      setPinned(null);
      setView("run");
      sessionStorage.setItem("thepower-aula-run", id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo abrir la ejecución.");
    }
  }

  return (
    <div className="aula-shell">
      <header className="masthead">
        <a className="brand" href="/">
          thePower <span>AI ENGINEER</span>
        </a>
        <div className="environment">
          <span className="live-dot" />
          Laboratorio local · datos reales
        </div>
        <a
          className="quiet-link"
          href="https://rag-thepower.josenuevo.dev/"
          target="_blank"
          rel="noreferrer"
        >
          Ver aplicación del curso ↗
        </a>
      </header>
      <section className="intro">
        <div>
          <p className="eyebrow">Aula / Inspector</p>
          <h1>El RAG, por dentro.</h1>
          <p className="intro-copy">Sigue los datos. Detén cada paso. Comprueba la evidencia.</p>
        </div>
        <div className="index-summary">
          <strong>
            {status?.chunks ?? "—"}
            <small>fragmentos en PostgreSQL</small>
          </strong>
          <span>{status?.dimensions ?? "—"} dimensiones · pgvector / HNSW</span>
          <small>{status?.embeddingModel ?? "Conectando al laboratorio…"}</small>
        </div>
      </section>
      <nav className="view-nav" aria-label="Vistas del laboratorio">
        {(
          [
            ["run", "Recorrido"],
            ["corpus", "Documentos e índice"],
            ["history", "Ejecuciones guardadas"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            aria-current={view === id ? "page" : undefined}
            onClick={() => setView(id)}
          >
            {label}
            {id === "history" ? <span>{history.length}</span> : null}
          </button>
        ))}
        <span className="database-label">{status?.database ?? "Preparando PostgreSQL"}</span>
      </nav>
      {error ? (
        <div className="alert" role="alert">
          <strong>No se pudo completar la acción.</strong> {error}
          <button className="text-button" onClick={() => setError(null)}>
            Cerrar
          </button>
        </div>
      ) : null}
      {status && !status.executionEnabled ? (
        <div className="notice">
          Las llamadas reales están desactivadas. Puedes explorar los documentos y los registros.
          Para ejecutar, inicia <code>bun run lab:aula --execute --max-spend-usd 1</code>.
        </div>
      ) : null}
      {view === "corpus" && catalog ? <Corpus catalog={catalog} /> : null}
      {view === "history" ? (
        <section className="history">
          <div className="section-line">
            <h2>Un recorrido, un registro.</h2>
            <button className="text-button" onClick={() => void refresh().catch(() => {})}>
              Actualizar
            </button>
          </div>
          <p>
            Datos de ejecuciones reales guardados en PostgreSQL. Abrir un registro no vuelve a
            ejecutar modelos.
          </p>
          <table>
            <thead>
              <tr>
                <th>Hora</th>
                <th>Recorrido</th>
                <th>Pregunta</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id}>
                  <td>{time(item.createdAt)}</td>
                  <td>{KIND_LABEL[item.kind]}</td>
                  <td>{item.question || "Corpus del laboratorio"}</td>
                  <td>{STATE_LABEL[item.status]}</td>
                  <td>
                    <button className="text-button" onClick={() => void chooseRun(item.id)}>
                      Inspeccionar ↗
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!history.length ? (
            <p className="empty-note">
              La primera ejecución aparecerá aquí cuando prepares un recorrido.
            </p>
          ) : null}
        </section>
      ) : null}
      {view === "run" ? (
        <>
          <section className="composer">
            <div className="composer-top">
              <label>
                Recorrido
                <select
                  value={displayedKind}
                  disabled={live}
                  onChange={(event) => setKind(event.target.value as AulaKind)}
                >
                  <option value="rag">RAG básico</option>
                  <option value="baseline">Sin documentos</option>
                  <option value="ingest">Indexar corpus</option>
                </select>
              </label>
              <fieldset className="mode-picker">
                <legend>Modo</legend>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    checked={displayedMode === "step"}
                    onChange={() => setMode("step")}
                    disabled={live}
                  />
                  Paso a paso
                </label>
                <label>
                  <input
                    type="radio"
                    name="mode"
                    checked={displayedMode === "auto"}
                    onChange={() => setMode("auto")}
                    disabled={live}
                  />
                  Completo
                </label>
              </fieldset>
              <span className="real-model">
                {status?.generationProvider ?? "—"}
                <b>{status?.generationModel ?? "Modelo no disponible"}</b>
              </span>
            </div>
            {displayedKind !== "ingest" ? (
              <>
                <label className="question-label" htmlFor="aula-question">
                  Pregunta del recorrido
                </label>
                <textarea
                  id="aula-question"
                  value={live ? run.question : question}
                  onChange={(event) => setQuestion(event.target.value)}
                  readOnly={live}
                  maxLength={2000}
                  rows={2}
                />
                <div className="question-examples">
                  {QUESTIONS.map((item) => (
                    <button
                      key={item.label}
                      className="text-button"
                      disabled={live}
                      onClick={() => setQuestion(item.text)}
                    >
                      {item.label} ↗
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <p className="ingest-description">
                Recorre las fuentes, la fragmentación y los embeddings antes de sustituir el índice
                local en una transacción. Las ejecuciones anteriores se conservan.
              </p>
            )}
            <div className="composer-bottom">
              <p>
                {mode === "step"
                  ? "Preparar el recorrido se detiene antes de la primera operación."
                  : "El recorrido completo ejecuta las llamadas reales sin pausas."}
              </p>
              <button
                className="primary"
                onClick={start}
                disabled={
                  !status?.executionEnabled ||
                  live ||
                  acting ||
                  !!activeElsewhere ||
                  (kind !== "ingest" && !question.trim())
                }
              >
                {acting
                  ? "Preparando…"
                  : mode === "step"
                    ? "Preparar recorrido →"
                    : "Ejecutar completo →"}
              </button>
            </div>
          </section>
          {run ? (
            <section className="execution" aria-label="Inspector de la ejecución">
              <aside className="step-rail">
                <div className="run-heading">
                  <p className="eyebrow">{KIND_LABEL[run.kind]}</p>
                  <span className={`state state-${run.status}`}>{STATE_LABEL[run.status]}</span>
                </div>
                <ol>
                  {run.stages.map((id, index) => {
                    const state = stageState(run, id);
                    return (
                      <li key={id}>
                        <button
                          className={`step ${state.className} ${stage === id ? "is-active" : ""}`}
                          aria-current={stage === id ? "step" : undefined}
                          onClick={() => setPinned(id)}
                        >
                          <span className="step-number">
                            {state.className === "complete"
                              ? "✓"
                              : String(index + 1).padStart(2, "0")}
                          </span>
                          <span>
                            <b>{AULA_STAGES[id].label}</b>
                            <small>
                              {state.label}
                              {state.duration !== null ? ` · ${formatMs(state.duration)}` : ""}
                            </small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
                <p className="run-identity">
                  {time(run.createdAt)} · {run.id}
                </p>
                <p className="caption">
                  El mismo identificador está en <code>lab_aula_runs</code> y{" "}
                  <code>lab_aula_events</code>.
                </p>
                {pinned ? (
                  <button className="text-button" onClick={() => setPinned(null)}>
                    Seguir el paso actual ↗
                  </button>
                ) : null}
              </aside>
              <div className="step-workspace">
                <header className="step-header">
                  <div>
                    <p className="eyebrow">
                      {live ? "Observación en directo" : "Registro de una ejecución real"}
                    </p>
                    <h2>{AULA_STAGES[stage].label}</h2>
                    <p>{AULA_STAGES[stage].description}</p>
                    {run.kind !== "ingest" ? (
                      <p className="caption">Pregunta de esta ejecución: {run.question}</p>
                    ) : null}
                  </div>
                  {live ? (
                    <div className="execution-controls">
                      {run.waitingStage ? (
                        <button
                          className="primary"
                          disabled={acting}
                          onClick={() => control("advance")}
                        >
                          {stage === run.waitingStage
                            ? "Ejecutar este paso →"
                            : `Ejecutar ${AULA_STAGES[run.waitingStage].label} →`}
                        </button>
                      ) : (
                        <span role="status" className="t-shimmer" data-text="Operación en curso">
                          Operación en curso
                        </span>
                      )}
                      <button
                        className="secondary"
                        disabled={acting}
                        onClick={() => control(run.mode === "step" ? "automatic" : "pause")}
                      >
                        {run.mode === "step" ? "Continuar todo" : "Pausar al terminar el paso"}
                      </button>
                      <button
                        className="text-button danger"
                        disabled={acting}
                        onClick={() => control("cancel")}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : null}
                </header>
                {!connected && live ? (
                  <p className="notice">
                    Reconectando con el registro. La operación continúa en el servidor y no se
                    reenviará.
                  </p>
                ) : null}
                {run.error ? (
                  <p className="notice" role="alert">
                    {run.error}
                  </p>
                ) : null}
                <div className="stage-body">
                  <StageInspector key={`${run.id}:${stage}`} run={run} stage={stage} />
                  {selected?.before?.phase === "waiting" && !selected.after ? (
                    <p className="pause-note">
                      En pausa antes de esta operación. Revisa sus datos y pulsa «Ejecutar este
                      paso».
                    </p>
                  ) : null}
                  {busyStage && run.currentStage && run.currentStage !== stage ? (
                    <p className="caption">
                      La ejecución está avanzando en {AULA_STAGES[run.currentStage!].label}. Estás
                      inspeccionando otro paso.
                    </p>
                  ) : null}
                </div>
                {!live && run.result ? <Result run={run} /> : null}
              </div>
            </section>
          ) : (
            <section className="empty-workspace">
              <span className="empty-number">01 → 06</span>
              <h2>Una pregunta. Todo el recorrido a la vista.</h2>
              <p>
                Prepara una ejecución para observar el vector de la pregunta, el SQL, los
                candidatos, la selección, el prompt y la respuesta real.
              </p>
              <div className="empty-flow">
                <span>Pregunta</span>
                <i>→</i>
                <span>Vector</span>
                <i>→</i>
                <span>Evidencia</span>
                <i>→</i>
                <span>Contexto</span>
                <i>→</i>
                <span>Respuesta</span>
              </div>
            </section>
          )}
        </>
      ) : null}
      <footer className="footer">
        <span>
          {status?.calibration.valid
            ? `Umbral calibrado ${String(status.calibration.threshold)}`
            : "Calibración pendiente de validar"}
          <details>
            <summary>Ver calibración</summary>
            <Json value={status?.calibration.rows} label="Casos y puntuaciones de validación" />
          </details>
        </span>
        <span>
          {status
            ? `${status.budget.reservedUsd.toFixed(4)} / ${status.budget.limitUsd.toFixed(2)} USD reservados`
            : "Leyendo presupuesto"}
          <small>Reserva conservadora; importe facturado desconocido.</small>
        </span>
        <span>
          Lectura directa de PostgreSQL
          <small>Conexión del aula: 127.0.0.1:54329 / aether_rag</small>
        </span>
      </footer>
    </div>
  );
}
