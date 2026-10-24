// GUÍA DE LECTURA · lab/ui/src/inspectors.tsx
// Representaciones legibles de los valores capturados: SQL, vectores, candidatos, prompts y citas.
import { useState } from "react";
import type { AulaJson, AulaRun, AulaStageId } from "@thepower-rag/contracts";
import { list, record, stageData, words } from "./data";

// Los valores completos permanecen disponibles aunque la vista inicial los resuma.
export function Json({ value, label = "Ver datos completos" }: { value: unknown; label?: string }) {
  return (
    <details className="data-disclosure">
      <summary>{label}</summary>
      <pre>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

// Cada barra es una componente real. La escala se declara: no es una proyección del espacio vectorial.
export function Vector({ value }: { value: AulaJson | undefined }) {
  const values = list(value).map(Number);
  const preview = values.slice(0, 48);
  const max = Math.max(...preview.map(Math.abs), 0.000001);
  if (!values.length)
    return <p className="muted">El vector aparecerá cuando termine la llamada de embeddings.</p>;
  return (
    <section className="vector-view">
      <div className="section-line">
        <h3>{values.length} componentes reales</h3>
        <span>Primeras 48</span>
      </div>
      <svg
        viewBox="0 0 480 112"
        role="img"
        aria-label="Primeras 48 componentes del vector real; escala relativa al máximo visible"
      >
        <line x1="0" y1="56" x2="480" y2="56" stroke="currentColor" opacity="0.2" />
        {preview.map((value, index) => (
          <rect
            key={index}
            x={index * 10 + 1}
            y={value >= 0 ? 56 - (Math.abs(value) / max) * 48 : 56}
            width="6"
            height={(Math.abs(value) / max) * 48}
            fill={value >= 0 ? "#255b53" : "#b35a35"}
          >
            <title>
              {index}: {String(value)}
            </title>
          </rect>
        ))}
      </svg>
      <p className="caption">
        Componentes 0–47, con escala relativa al mayor valor visible. No representa posiciones en
        dos dimensiones.
      </p>
      <Json value={values} label={`Abrir las ${values.length} componentes`} />
    </section>
  );
}

// Conserva contenido, documento, sección e id al desplegar un vecino o una cita.
export function Evidence({ items, selected = [] }: { items: AulaJson[]; selected?: AulaJson[] }) {
  const accepted = new Set(selected.map((item) => words(record(item).chunkId)));
  if (!items.length) return <p className="muted">Todavía no hay fragmentos en esta etapa.</p>;
  return (
    <div className="evidence-list">
      {items.map((item, index) => {
        const hit = record(item);
        const id = words(hit.chunkId);
        const score = typeof hit.similarity === "number" ? hit.similarity : null;
        return (
          <details key={id} className={accepted.has(id) ? "evidence is-selected" : "evidence"}>
            <summary>
              <span className="rank">{String(index + 1).padStart(2, "0")}</span>
              <span className="evidence-title">
                {words(hit.title) || words(hit.documentId)}
                <small>{words(hit.section)}</small>
              </span>
              {score !== null ? (
                <span className="score">
                  {score.toFixed(6)}
                  <small>{accepted.has(id) ? "seleccionado" : "similitud"}</small>
                </span>
              ) : null}
            </summary>
            <div className="evidence-body">
              <code>{id}</code>
              <p>{words(hit.content)}</p>
              {hit.cosineDistance !== undefined ? (
                <p className="caption">
                  Distancia coseno: {words(hit.cosineDistance)} · Similitud: {words(hit.similarity)}
                </p>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// Permite seguir las citas hasta los fragmentos exactos entregados en esa ejecución.
function CitedAnswer({ answer, sources }: { answer: string; sources: AulaJson[] }) {
  const [focus, setFocus] = useState<string | null>(null);
  const parts = answer.split(/(\[cite:[^\]]+\])/g);
  const source = sources.find((item) => words(record(item).chunkId) === focus);
  return (
    <>
      <div className="answer">
        {parts.map((part, index) =>
          part.startsWith("[cite:") ? (
            <button className="citation" key={index} onClick={() => setFocus(part.slice(6, -1))}>
              fuente{" "}
              {sources.findIndex((item) => words(record(item).chunkId) === part.slice(6, -1)) + 1}
            </button>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </div>
      {source ? (
        <aside className="source-proof">
          <div className="section-line">
            <h3>Fragmento de esta ejecución</h3>
            <button className="text-button" onClick={() => setFocus(null)}>
              Cerrar
            </button>
          </div>
          <Evidence items={[source]} selected={[source]} />
        </aside>
      ) : null}
    </>
  );
}

// Cada inspector se alimenta del evento de la etapa, incluso al leer una ejecución histórica.
export function StageInspector({ run, stage }: { run: AulaRun; stage: AulaStageId }) {
  const { input, output, events, after } = stageData(run, stage);
  if (stage === "documents")
    return (
      <>
        <p className="lead">Las fuentes entran como texto, antes de convertirlas en fragmentos.</p>
        {list(output.documents).map((item) => {
          const doc = record(item);
          return (
            <details className="document" key={words(doc.documentId)}>
              <summary>
                {words(doc.title)}
                <small>{words(doc.sourcePath)}</small>
              </summary>
              <h4>Texto original</h4>
              <pre>{words(doc.rawText)}</pre>
              <h4>Texto limpio</h4>
              <pre>{words(doc.cleanText)}</pre>
            </details>
          );
        })}
        <Json value={input} label="Entrada de la lectura" />
      </>
    );
  if (stage === "chunking")
    return (
      <>
        <p className="lead">Cada fragmento conserva su origen, sección, posición y versión.</p>
        <div className="facts">
          <span>
            Tamaño máximo <b>{words(record(output.chunking).maxChars) || "—"}</b>
          </span>
          <span>
            Solapamiento <b>{words(record(output.chunking).overlapChars) || "—"}</b>
          </span>
          <span>
            Fragmentos <b>{list(output.chunks).length}</b>
          </span>
        </div>
        <Evidence items={list(output.chunks)} />
        <Json value={output} />
      </>
    );
  if (stage === "schema")
    return (
      <>
        <p className="lead">
          Comprueba la extensión vector, las tablas y el índice HNSW con sentencias idempotentes.
        </p>
        <Json value={input.statements} label="Sentencias del esquema antes de ejecutarlas" />
        <Json value={output} label="Resultado de la preparación" />
        <SqlEvents events={events.filter((event) => event.type === "sql")} />
      </>
    );
  if (stage === "question-embedding")
    return (
      <>
        <blockquote>{words(input.question)}</blockquote>
        <p className="caption">{words(input.model)}</p>
        <Vector value={output.vector} />
        <Json value={input} label="Entrada real del proveedor" />
      </>
    );
  if (stage === "document-embeddings")
    return (
      <>
        <p className="lead">Un vector por fragmento, devuelto por el proveedor configurado.</p>
        <p className="caption">
          {words(input.model)} · {list(output.vectors).length} vectores recibidos
        </p>
        {list(output.vectors).map((vector, index) => (
          <details className="document" key={words(list(output.chunkIds)[index])}>
            <summary>
              Fragmento {String(index + 1).padStart(2, "0")}
              <small>{words(list(output.chunkIds)[index])}</small>
            </summary>
            <Vector value={vector} />
          </details>
        ))}
        <Json value={input.texts} label="Textos exactos enviados a embeddings" />
      </>
    );
  if (stage === "search")
    return (
      <>
        <p className="lead">
          pgvector ordena por distancia coseno. Menor distancia significa mayor proximidad.
        </p>
        <h3>SQL parametrizado</h3>
        <pre>{words(input.sql)}</pre>
        <Json
          value={input.parameters}
          label="Parámetros reales, incluido el vector de la pregunta"
        />
        <Evidence items={list(output.retrieved)} />
        <SqlEvents events={events.filter((event) => event.type === "sql")} />
      </>
    );
  if (stage === "selection")
    return (
      <>
        <p className="lead">Este filtro decide qué evidencia puede recibir el generador.</p>
        <div className="facts">
          <span>
            Umbral calibrado <b>{words(input.minSimilarity)}</b>
          </span>
          <span>
            Recuperados <b>{list(input.retrieved).length}</b>
          </span>
          <span>
            Seleccionados <b>{list(output.selected).length}</b>
          </span>
        </div>
        <Evidence items={list(input.retrieved)} selected={list(output.selected)} />
        {after && list(output.selected).length === 0 ? (
          <p className="notice">
            Ningún fragmento superó el umbral. El recorrido termina sin llamar al generador.
          </p>
        ) : null}
        <Json value={output} label="Selección y descartes completos" />
      </>
    );
  if (stage === "prompt")
    return (
      <>
        <p className="lead">
          El modelo recibe estas instrucciones y este contexto. Los vectores se usaron para buscar;
          aquí entra texto.
        </p>
        <h3>Instrucciones del sistema</h3>
        <pre>{words(output.system) || "Ejecuta el paso para construir el prompt."}</pre>
        <h3>Pregunta y documentos</h3>
        <pre>{words(output.prompt)}</pre>
        <Json value={input.selected} label="Fragmentos de entrada con sus metadatos" />
      </>
    );
  if (stage === "generation") {
    const streamed = events
      .filter((event) => event.type === "delta")
      .map((event) => words(record(event.data).text))
      .join("");
    const usage = record(output.usage);
    return (
      <>
        <p className="caption">
          {words(input.provider)} / {words(input.model)} · Máximo {words(input.maxOutputTokens)}{" "}
          tokens de salida
        </p>
        <div className="stream-answer" aria-label="Respuesta real en streaming">
          {streamed || words(output.rawAnswer) || (
            <span className="muted">
              El texto aparecerá cuando el proveedor empiece a responder.
            </span>
          )}
        </div>
        <div className="facts">
          <span>
            Entrada <b>{words(usage.inputTokens) || "—"}</b>
          </span>
          <span>
            Salida <b>{words(usage.outputTokens) || "—"}</b>
          </span>
          <span>
            Finalización <b>{words(output.finishReason) || "—"}</b>
          </span>
        </div>
        <Json value={input} label="Petición de generación: instrucciones y prompt" />
        <Json value={output.requestMessages} label="Mensajes normalizados observados por el SDK" />
      </>
    );
  }
  if (stage === "citations")
    return (
      <>
        <p className="lead">Comprueba cada referencia contra los fragmentos suministrados.</p>
        <CitedAnswer
          answer={words(output.answer) || words(input.rawAnswer)}
          sources={list(output.sources)}
        />
        <Json value={input.allowedIds} label="IDs permitidos para las citas" />
        <Json value={output} label="Resultado de la validación" />
      </>
    );
  return (
    <>
      <p className="lead">
        {stage === "store"
          ? "La sustitución del índice se hace dentro de una transacción, sin pausas mientras se escribe."
          : "Lee de vuelta las filas y la definición del índice; no basta con aceptar la escritura."}
      </p>
      <Json value={input} label="Entrada del paso" />
      <Json value={output} label="Resultado leído de PostgreSQL" />
      <SqlEvents events={events.filter((event) => event.type === "sql")} />
    </>
  );
}

// Son las sentencias interceptadas en el ejecutor real; el diario no se captura a sí mismo.
export function SqlEvents({ events }: { events: AulaRun["events"] }) {
  return (
    <section className="sql-log">
      <h3>
        SQL observado{" "}
        <span>{events.filter((event) => event.phase === "complete").length} operaciones</span>
      </h3>
      {events
        .filter((event) => event.phase === "complete")
        .map((event) => {
          const data = record(event.data);
          return (
            <details className="data-disclosure" key={event.seq}>
              <summary>
                <code>{words(data.statement).slice(0, 100)}</code>
              </summary>
              <pre>{words(data.statement)}</pre>
              <Json value={data.parameters} label="Parámetros" />
              <Json value={data.rows} label="Filas devueltas" />
            </details>
          );
        })}
    </section>
  );
}
