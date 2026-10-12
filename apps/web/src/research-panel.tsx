// GUÍA DE LECTURA · apps/web/src/research-panel.tsx
// Componentes que enseñan el resultado de una investigación: tarjetas de fuentes con sus extractos, pasos
// del grafo y la traza completa (plan, curso, búsquedas, lecturas, evidencia, seguimiento, comprobación y consumo).
// Tipos de fuente, paso y resumen.
import type { ResearchSource, ResearchStep, ResearchSummary } from "@thepower-rag/contracts";
// Tipo de los hijos de React.
import type { ReactNode } from "react";
// Textos y formatos del resumen.
import {
  CAUSE_LABEL,
  COVERAGE_LABEL,
  DECISION_LABEL,
  KIND_LABEL,
  OUTCOME_LABEL,
  ROUTE_LABEL,
  SOURCE_KIND_LABEL,
  STOP_LABEL,
  hostOf,
  money,
  shortHash,
} from "./research-labels";

// Sección con título.
function Section({ title, children }: { title: string; children: ReactNode }) {
  // Bloque.
  return (
    <section className="research-block">
      {/* Título. */}
      <h3>{title}</h3>
      {/* Contenido. */}
      {children}
    </section>
  );
}

// Tarjeta de una fuente citada.
export function ResearchSourceCard({ source }: { source: ResearchSource }) {
  // Color según el tipo de fuente.
  const tone =
    source.kind === "web"
      ? "web"
      : source.kind === "tool"
        ? "tool"
        : source.kind === "attachment"
          ? "note"
          : "session";
  // Elemento de la lista con el id en el título.
  return (
    <li className="citation is-shown research-source" title={source.sourceId}>
      {/* Cabecera. */}
      <div className="citation-head">
        {/* Etiquetas. */}
        <p className="chip-row">
          {/* Tipo de fuente. */}
          <span className={`chip chip-${tone}`}>{SOURCE_KIND_LABEL[source.kind]}</span>
          {/* Subpreguntas que apoya. */}
          {source.subquestionIds.map((id) => (
            <span key={id} className="chip chip-note">
              {/* Id. */}
              {id}
            </span>
          ))}
          {/* Página sintética de la demo. */}
          {source.kind === "web" && source.fixture ? (
            <span className="chip chip-note">Página sintética</span>
          ) : null}
        </p>
        {/* Título. */}
        <p className="citation-title">{source.title}</p>
      </div>
      {/* Datos según el tipo. */}
      {source.kind === "web" ? (
        <p className="research-meta">
          {/* Enlace a la página. */}
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {/* Dominio. */}
            {source.domain}
          </a>{" "}
          · leída {source.retrievedAt.slice(0, 10)} · publicación{" "}
          {/* Fecha de publicación y hash. */}
          {source.publishedAt ?? "desconocida"} · {shortHash(source.contentHash)}
        </p>
      ) : source.kind === "tool" ? (
        <p className="research-meta">
          get_course_session · grupo {source.audience} · fuentes del curso:{" "}
          {/* Fuentes del curso que respaldan la herramienta. */}
          {source.backingSourceIds.join(", ")}
        </p>
      ) : source.kind === "attachment" ? (
        <p className="research-meta">
          {/* Imagen o audio del alumno. */}
          {source.role === "image" ? "Imagen" : "Audio"} · {shortHash(source.contentHash)}. No es
          evidencia del curso ni de una fuente técnica.
        </p>
      ) : (
        <p className="research-meta">
          {/* Fragmento del curso. */}
          {source.section} · corpus {source.corpusVersion} · grupo {source.audience}
        </p>
      )}
      {/* Extractos plegables. */}
      <details className="research-excerpts">
        {/* Resumen con el número de extractos. */}
        <summary>Extractos que apoyan la cita ({source.excerpts.length})</summary>
        {/* Lista. */}
        <ul>
          {/* Cada extracto. */}
          {source.excerpts.map((excerpt, index) => (
            <li key={index}>
              {/* Cita literal. */}
              <q>{excerpt}</q>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

// Lista de fuentes citadas.
export function ResearchSources({ sources }: { sources: readonly ResearchSource[] }) {
  // Sin fuentes.
  if (sources.length === 0) {
    // Aviso.
    return <p>Sin fuentes citadas en este resultado.</p>;
  }
  // Lista.
  return (
    <ul className="citations">
      {/* Una tarjeta por fuente. */}
      {sources.map((source) => (
        <ResearchSourceCard key={source.sourceId} source={source} />
      ))}
    </ul>
  );
}

// Pasos del grafo de investigación.
export function ResearchSteps({ steps }: { steps: readonly ResearchStep[] }) {
  // Sin pasos.
  if (steps.length === 0) {
    // Nada.
    return null;
  }
  // Lista ordenada.
  return (
    <ol className="steps" aria-label="Pasos del grafo de investigación">
      {/* Cada paso. */}
      {steps.map((step, index) => (
        <li key={`${step.node}-${String(index)}`}>
          {/* Nodo. */}
          {step.node}
          {/* Ronda y estado. */}
          {step.round > 0 ? ` · ronda ${String(step.round)}` : ""}. {step.status}
        </li>
      ))}
    </ol>
  );
}

// Traza completa de la investigación.
export function ResearchTrace({ summary }: { summary: ResearchSummary }) {
  // Texto de cada subpregunta.
  const subText = new Map(summary.subquestions.map((item) => [item.id, item.text]));
  // Consumo.
  const a = summary.accounting;
  // Contenedor.
  return (
    <div className="research-trace">
      {/* Aviso de datos de prueba. */}
      {summary.fixture ? (
        <p className="research-banner" role="note">
          Guion de prueba con adaptadores fijos. Demuestra el flujo de control del grafo, no la
          calidad de un modelo ni una búsqueda real en internet.
        </p>
      ) : null}
      {/* Resultado y parada. */}
      <p className="trace-summary">
        {/* Resultado y motivo. */}
        <strong>{OUTCOME_LABEL[summary.outcome]}.</strong> Parada: {STOP_LABEL[summary.stop]}.{" "}
        {/* Detalle. */}
        {summary.stopDetail}
      </p>
      {/* Pregunta original. */}
      <Section title="Pregunta original">
        {/* Texto. */}
        <p className="research-question">{summary.originalQuestion}</p>
        {/* Aviso si se contextualizó. */}
        {summary.contextualizedQuestion ? (
          <p className="research-meta">
            Pregunta contextualizada, distinta de la original. La memoria no es evidencia del curso.
          </p>
        ) : null}
      </Section>
      {/* Identificadores del trabajo durable. */}
      {summary.jobId ? (
        <Section title="Identificadores">
          {/* Hilo, trabajo y recorrido. */}
          <p className="research-meta">
            Hilo {summary.threadId ?? "sin hilo"} · trabajo {summary.jobId} · recorrido{" "}
            {/* Recorrido. */}
            {summary.runId}
          </p>
        </Section>
      ) : null}
      {/* Plan. */}
      <Section title="Plan">
        {/* Sin plan o con ruta y subpreguntas. */}
        {summary.route === null ? (
          <p>Sin plan: el recorrido terminó antes de planificar.</p>
        ) : (
          <>
            {/* Ruta y explicación. */}
            <p>
              Ruta: {ROUTE_LABEL[summary.route]}. {summary.planRationale}
            </p>
            {/* Subpreguntas. */}
            <ul className="trace-list">
              {/* Cada subpregunta. */}
              {summary.subquestions.map((item) => {
                // Su cobertura.
                const coverage = summary.coverage.find((entry) => entry.subquestionId === item.id);
                // Elemento.
                return (
                  <li key={item.id}>
                    {/* Id y tipo. */}
                    <strong>{item.id}</strong> · {KIND_LABEL[item.kind]}
                    {/* Si necesita fuentes externas y texto. */}
                    {item.external ? " · fuentes externas" : " · sin búsqueda externa"}: {item.text}
                    {/* Cobertura, si la hay. */}
                    {coverage === undefined ? null : (
                      // Estado de cobertura, causa de la laguna y su texto si lo hay.
                      <>
                        {" "}
                        — {COVERAGE_LABEL[coverage.status]} ({CAUSE_LABEL[coverage.cause]})
                        {coverage.gap === null ? "" : `. ${coverage.gap}`}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Section>
      {/* Curso y herramienta. */}
      <Section title="Material del curso y herramienta">
        {/* Sin consultas o con la lista. */}
        {summary.courseQueries.length === 0 && summary.toolCalls.length === 0 ? (
          <p>Sin consultas al curso.</p>
        ) : (
          <ul className="trace-list">
            {/* Consultas al curso. */}
            {summary.courseQueries.map((item, index) => (
              <li key={`c-${String(index)}`}>
                Ronda {item.round} · {item.subquestionId} · {item.status}: {item.sourceIds.length}{" "}
                fragmentos en alcance.
              </li>
            ))}
            {/* Llamadas a la herramienta. */}
            {summary.toolCalls.map((item, index) => (
              <li key={`t-${String(index)}`}>
                get_course_session({item.args.sessionId}, {item.args.audience}) · {item.status}:{" "}
                {/* Detalle. */}
                {item.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {/* Búsquedas externas. */}
      <Section title="Búsquedas externas">
        {/* Sin búsquedas o con la lista. */}
        {summary.searches.length === 0 ? (
          <p>Sin búsquedas externas.</p>
        ) : (
          <ul className="trace-list">
            {/* Búsquedas. */}
            {summary.searches.map((item, index) => (
              <li key={`s-${String(index)}`}>
                Ronda {item.round} · {item.subquestionId} · {item.status} · {item.resultCount}{" "}
                resultados: «{item.query}». {item.detail}
              </li>
            ))}
            {/* URL descubiertas. */}
            {summary.discovered.map((item, index) => (
              <li key={`d-${String(index)}`}>
                Descubierta {hostOf(item.url)}: {DECISION_LABEL[item.decision]}.
              </li>
            ))}
          </ul>
        )}
      </Section>
      {/* Páginas leídas. */}
      <Section title="Páginas leídas">
        {/* Sin lecturas o con la lista. */}
        {summary.pagesRead.length === 0 ? (
          <p>Ninguna página leída. Un resultado de búsqueda no cuenta como lectura.</p>
        ) : (
          <ul className="trace-list">
            {/* Cada lectura. */}
            {summary.pagesRead.map((item, index) => (
              <li key={`p-${String(index)}`}>
                {/* Dominio, estado y caracteres. */}
                {hostOf(item.finalUrl ?? item.url)} · {item.status} · {item.chars} caracteres ·{" "}
                {/* Hash. */}
                {shortHash(item.contentHash)}
                {/* Aviso de instrucciones embebidas. */}
                {item.instructionsFlagged
                  ? " · instrucciones embebidas tratadas como dato"
                  : ""}.{" "}
                {/* Detalle. */}
                {item.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {/* Evidencia. */}
      <Section title="Evidencia">
        {/* Lista. */}
        <ul className="trace-list">
          {/* Aceptadas. */}
          {summary.accepted.map((item) => (
            <li key={`a-${item.sourceId}`}>
              Aceptada {SOURCE_KIND_LABEL[item.kind]} {item.sourceId} para{" "}
              {/* Subpreguntas y motivo. */}
              {item.subquestionIds.join(", ")}: {item.reason}
            </li>
          ))}
          {/* Descartadas. */}
          {summary.rejected.map((item, index) => (
            <li key={`r-${item.sourceId}-${String(index)}`}>
              Descartada {SOURCE_KIND_LABEL[item.kind]} {item.sourceId}, ronda {item.round}:{" "}
              {/* Motivo. */}
              {item.reason}
            </li>
          ))}
          {/* Sin evidencia. */}
          {summary.accepted.length === 0 && summary.rejected.length === 0 ? (
            <li>Sin evidencia evaluada.</li>
          ) : null}
        </ul>
        {/* Contradicciones. */}
        {summary.contradictions.length > 0 ? (
          <p>Contradicciones: {summary.contradictions.join(" · ")}</p>
        ) : null}
      </Section>
      {/* Seguimiento. */}
      <Section title="Seguimiento">
        {/* Sin seguimiento o con sus consultas. */}
        {summary.followUp === null ? (
          <p>Sin ronda de seguimiento.</p>
        ) : (
          <ul className="trace-list">
            {/* Motivo. */}
            <li>{summary.followUp.reason}</li>
            {/* Consultas. */}
            {summary.followUp.queries.map((item) => (
              <li key={item.subquestionId}>
                {/* Subpregunta y consulta. */}
                {item.subquestionId} ({subText.get(item.subquestionId) ?? ""}): «{item.query}»
              </li>
            ))}
          </ul>
        )}
      </Section>
      {/* Comprobación de afirmaciones. */}
      <Section title="Comprobación de afirmaciones">
        {/* Recuento y método. */}
        <p>
          {/* Comprobadas y retiradas. */}
          {summary.claimCheck.checked} comprobadas, {summary.claimCheck.dropped.length} retiradas.{" "}
          {/* Método. */}
          {summary.claimCheck.method}
        </p>
        {/* Afirmaciones retiradas. */}
        {summary.claimCheck.dropped.length > 0 ? (
          <ul className="trace-list">
            {/* Cada una. */}
            {summary.claimCheck.dropped.map((item, index) => (
              <li key={`x-${String(index)}`}>
                «{item.claim}»: {item.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      {/* Límites y consumo. */}
      <Section title="Límites y consumo">
        {/* Lista. */}
        <ul className="trace-list">
          {/* Contadores frente a límites. */}
          <li>
            Rondas {summary.rounds}/{summary.limits.maxRounds}. Búsquedas{" "}
            {summary.counters.searchCalls}/{summary.limits.maxSearchCalls}. Páginas{" "}
            {summary.counters.pagesRead}/{summary.limits.maxPagesRead}. Llamadas de modelo{" "}
            {summary.counters.modelCalls}. Herramienta {summary.counters.toolCalls}. Plazo total{" "}
            {summary.limits.deadlineMs / 1000} s.
          </li>
          {/* Consumo: reserva, informado, estimado, créditos y desconocidos. */}
          <li>
            Reserva estimada: {money(a.estimatedMaxUsd, a.measured)}. USD informado por proveedores:{" "}
            {money(a.providerReportedUsd, a.measured)}.
            {/* Estimación con tarifas publicadas, solo si existe. */}
            {a.estimatedUsd != null || a.estimateProvenance ? (
              <>
                {" "}
                USD calculado con tarifas publicadas: {money(a.estimatedUsd ?? null, a.measured)}.
                {a.estimateProvenance ? ` Procedencia: ${a.estimateProvenance}` : ""} Completo:{" "}
                {a.estimateComplete === true ? "sí" : "no"}. No es un importe informado por el
                proveedor.
              </>
            ) : null}{" "}
            {/* Créditos: no se suman a los USD. */}
            Créditos informados:{" "}
            {a.measured
              ? a.providerReportedCredits === null
                ? "ninguno"
                : a.providerReportedCredits
              : "no medido"}
            . Los créditos no son un total en USD. Llamadas con consumo desconocido:{" "}
            {a.measured ? a.unknownConsumptionCalls : "no medido"}. Informe final:{" "}
            {money(a.finalAnswerUsd, a.measured)}. Total completo: {a.totalComplete ? "sí" : "no"}.
          </li>
          {/* Nota. */}
          <li>{a.note}</li>
        </ul>
      </Section>
      {/* Pasos del grafo. */}
      <Section title="Pasos del grafo">
        {/* Lista de pasos. */}
        <ResearchSteps steps={summary.trace} />
      </Section>
    </div>
  );
}
