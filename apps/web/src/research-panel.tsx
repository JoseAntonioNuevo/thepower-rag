import type { ResearchSource, ResearchStep, ResearchSummary } from "@thepower-rag/contracts";
import type { ReactNode } from "react";
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="research-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function ResearchSourceCard({ source }: { source: ResearchSource }) {
  const tone = source.kind === "web" ? "web" : source.kind === "tool" ? "tool" : "session";
  return (
    <li className="citation is-shown research-source" title={source.sourceId}>
      <div className="citation-head">
        <p className="chip-row">
          <span className={`chip chip-${tone}`}>{SOURCE_KIND_LABEL[source.kind]}</span>
          {source.subquestionIds.map((id) => (
            <span key={id} className="chip chip-note">
              {id}
            </span>
          ))}
          {source.kind === "web" && source.fixture ? (
            <span className="chip chip-note">Página sintética</span>
          ) : null}
        </p>
        <p className="citation-title">{source.title}</p>
      </div>
      {source.kind === "web" ? (
        <p className="research-meta">
          <a href={source.url} target="_blank" rel="noopener noreferrer">
            {source.domain}
          </a>{" "}
          · leída {source.retrievedAt.slice(0, 10)} · publicación{" "}
          {source.publishedAt ?? "desconocida"} · {shortHash(source.contentHash)}
        </p>
      ) : source.kind === "tool" ? (
        <p className="research-meta">
          get_course_session · grupo {source.audience} · fuentes del curso:{" "}
          {source.backingSourceIds.join(", ")}
        </p>
      ) : (
        <p className="research-meta">
          {source.section} · corpus {source.corpusVersion} · grupo {source.audience}
        </p>
      )}
      <details className="research-excerpts">
        <summary>Extractos que apoyan la cita ({source.excerpts.length})</summary>
        <ul>
          {source.excerpts.map((excerpt, index) => (
            <li key={index}>
              <q>{excerpt}</q>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export function ResearchSources({ sources }: { sources: readonly ResearchSource[] }) {
  if (sources.length === 0) {
    return <p>Sin fuentes citadas en este resultado.</p>;
  }
  return (
    <ul className="citations">
      {sources.map((source) => (
        <ResearchSourceCard key={source.sourceId} source={source} />
      ))}
    </ul>
  );
}

export function ResearchSteps({ steps }: { steps: readonly ResearchStep[] }) {
  if (steps.length === 0) {
    return null;
  }
  return (
    <ol className="steps" aria-label="Pasos del grafo de investigación">
      {steps.map((step, index) => (
        <li key={`${step.node}-${String(index)}`}>
          {step.node}
          {step.round > 0 ? ` · ronda ${String(step.round)}` : ""}. {step.status}
        </li>
      ))}
    </ol>
  );
}

export function ResearchTrace({ summary }: { summary: ResearchSummary }) {
  const subText = new Map(summary.subquestions.map((item) => [item.id, item.text]));
  const a = summary.accounting;
  return (
    <div className="research-trace">
      {summary.fixture ? (
        <p className="research-banner" role="note">
          Guion de prueba con adaptadores fijos. Demuestra el flujo de control del grafo, no la
          calidad de un modelo ni una búsqueda real en internet.
        </p>
      ) : null}
      <p className="trace-summary">
        <strong>{OUTCOME_LABEL[summary.outcome]}.</strong> Parada: {STOP_LABEL[summary.stop]}.{" "}
        {summary.stopDetail}
      </p>
      <Section title="Pregunta original">
        <p className="research-question">{summary.originalQuestion}</p>
      </Section>
      <Section title="Plan">
        {summary.route === null ? (
          <p>Sin plan: el recorrido terminó antes de planificar.</p>
        ) : (
          <>
            <p>
              Ruta: {ROUTE_LABEL[summary.route]}. {summary.planRationale}
            </p>
            <ul className="trace-list">
              {summary.subquestions.map((item) => {
                const coverage = summary.coverage.find((entry) => entry.subquestionId === item.id);
                return (
                  <li key={item.id}>
                    <strong>{item.id}</strong> · {KIND_LABEL[item.kind]}
                    {item.external ? " · fuentes externas" : " · sin búsqueda externa"}: {item.text}
                    {coverage === undefined ? null : (
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
      <Section title="Material del curso y herramienta">
        {summary.courseQueries.length === 0 && summary.toolCalls.length === 0 ? (
          <p>Sin consultas al curso.</p>
        ) : (
          <ul className="trace-list">
            {summary.courseQueries.map((item, index) => (
              <li key={`c-${String(index)}`}>
                Ronda {item.round} · {item.subquestionId} · {item.status}: {item.sourceIds.length}{" "}
                fragmentos en alcance.
              </li>
            ))}
            {summary.toolCalls.map((item, index) => (
              <li key={`t-${String(index)}`}>
                get_course_session({item.args.sessionId}, {item.args.audience}) · {item.status}:{" "}
                {item.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Búsquedas externas">
        {summary.searches.length === 0 ? (
          <p>Sin búsquedas externas.</p>
        ) : (
          <ul className="trace-list">
            {summary.searches.map((item, index) => (
              <li key={`s-${String(index)}`}>
                Ronda {item.round} · {item.subquestionId} · {item.status} · {item.resultCount}{" "}
                resultados: «{item.query}». {item.detail}
              </li>
            ))}
            {summary.discovered.map((item, index) => (
              <li key={`d-${String(index)}`}>
                Descubierta {hostOf(item.url)}: {DECISION_LABEL[item.decision]}.
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Páginas leídas">
        {summary.pagesRead.length === 0 ? (
          <p>Ninguna página leída. Un resultado de búsqueda no cuenta como lectura.</p>
        ) : (
          <ul className="trace-list">
            {summary.pagesRead.map((item, index) => (
              <li key={`p-${String(index)}`}>
                {hostOf(item.finalUrl ?? item.url)} · {item.status} · {item.chars} caracteres ·{" "}
                {shortHash(item.contentHash)}
                {item.instructionsFlagged
                  ? " · instrucciones embebidas tratadas como dato"
                  : ""}.{" "}
                {item.detail}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Evidencia">
        <ul className="trace-list">
          {summary.accepted.map((item) => (
            <li key={`a-${item.sourceId}`}>
              Aceptada {SOURCE_KIND_LABEL[item.kind]} {item.sourceId} para{" "}
              {item.subquestionIds.join(", ")}: {item.reason}
            </li>
          ))}
          {summary.rejected.map((item, index) => (
            <li key={`r-${item.sourceId}-${String(index)}`}>
              Descartada {SOURCE_KIND_LABEL[item.kind]} {item.sourceId}, ronda {item.round}:{" "}
              {item.reason}
            </li>
          ))}
          {summary.accepted.length === 0 && summary.rejected.length === 0 ? (
            <li>Sin evidencia evaluada.</li>
          ) : null}
        </ul>
        {summary.contradictions.length > 0 ? (
          <p>Contradicciones: {summary.contradictions.join(" · ")}</p>
        ) : null}
      </Section>
      <Section title="Seguimiento">
        {summary.followUp === null ? (
          <p>Sin ronda de seguimiento.</p>
        ) : (
          <ul className="trace-list">
            <li>{summary.followUp.reason}</li>
            {summary.followUp.queries.map((item) => (
              <li key={item.subquestionId}>
                {item.subquestionId} ({subText.get(item.subquestionId) ?? ""}): «{item.query}»
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Comprobación de afirmaciones">
        <p>
          {summary.claimCheck.checked} comprobadas, {summary.claimCheck.dropped.length} retiradas.{" "}
          {summary.claimCheck.method}
        </p>
        {summary.claimCheck.dropped.length > 0 ? (
          <ul className="trace-list">
            {summary.claimCheck.dropped.map((item, index) => (
              <li key={`x-${String(index)}`}>
                «{item.claim}»: {item.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      <Section title="Límites y consumo">
        <ul className="trace-list">
          <li>
            Rondas {summary.rounds}/{summary.limits.maxRounds}. Búsquedas{" "}
            {summary.counters.searchCalls}/{summary.limits.maxSearchCalls}. Páginas{" "}
            {summary.counters.pagesRead}/{summary.limits.maxPagesRead}. Llamadas de modelo{" "}
            {summary.counters.modelCalls}. Herramienta {summary.counters.toolCalls}. Plazo total{" "}
            {summary.limits.deadlineMs / 1000} s.
          </li>
          <li>
            Reserva estimada: {money(a.estimatedMaxUsd, a.measured)}. USD informado por proveedores:{" "}
            {money(a.providerReportedUsd, a.measured)}. Créditos informados:{" "}
            {a.measured
              ? a.providerReportedCredits === null
                ? "ninguno"
                : a.providerReportedCredits
              : "no medido"}
            . Los créditos no son un total en USD. Llamadas con consumo desconocido:{" "}
            {a.measured ? a.unknownConsumptionCalls : "no medido"}. Informe final:{" "}
            {money(a.finalAnswerUsd, a.measured)}. Total completo: {a.totalComplete ? "sí" : "no"}.
          </li>
          <li>{a.note}</li>
        </ul>
      </Section>
      <Section title="Pasos del grafo">
        <ResearchSteps steps={summary.trace} />
      </Section>
    </div>
  );
}
