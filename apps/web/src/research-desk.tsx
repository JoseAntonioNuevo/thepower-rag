import {
  DEMO_RESEARCH_QUESTION,
  DEMO_RESEARCH_SCENARIOS,
  type Audience,
  type ResearchScenarioId,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { CourseAnswer } from "./course-answer";
import { ResearchSources, ResearchTrace } from "./research-panel";
import { useTurnstile } from "./use-turnstile";

interface ConversationItem {
  id: string;
  audience: Audience;
}

interface JobView {
  jobId: string;
  conversationId: string;
  execution: string;
  reportOutcome: string | null;
  attention: string | null;
  progress: string | null;
  events: { seq: number; text: string }[];
}

const EXECUTION_LABEL: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  complete: "Ejecución terminada",
  cancelled: "Cancelación registrada",
  attention: "Hace falta revisión",
  failed: "Fallo de ejecución",
};

const RECOVERY_SCENARIO = {
  id: "crash-after-plan" as const,
  label: "Interrupción recuperable tras el plan",
  question: DEMO_RESEARCH_QUESTION,
};

interface ResultPayload {
  summary?: ResearchSummary;
  sources?: ResearchSource[];
  report?: { text?: string } | null;
  reportAvailability?: string;
}

function shownReport(payload: ResultPayload | null): { text: string | null; note: string | null } {
  if (payload?.reportAvailability === "legacy-missing") {
    return {
      text: null,
      note: "Este resultado se guardó sin el texto del informe. No se reconstruye desde la memoria.",
    };
  }
  if (payload?.reportAvailability === "missing-artifact") {
    return {
      text: null,
      note: "El informe guardado no está disponible. No se vuelve a generar.",
    };
  }
  if (typeof payload?.report?.text === "string" && payload.report.text.length > 0) {
    return { text: payload.report.text, note: null };
  }
  return { text: null, note: null };
}

function StatusLine({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    if (element.textContent === text) {
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (element.textContent === "" || reduce) {
      element.textContent = text;
      return;
    }
    element.classList.add("is-exit");
    const timer = window.setTimeout(() => {
      element.textContent = text;
      element.classList.remove("is-exit");
      element.classList.add("is-enter-start");
      void element.offsetHeight;
      element.classList.remove("is-enter-start");
    }, 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [text]);
  return <span ref={ref} className="t-text-swap" />;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function messageOf(body: unknown, fallback: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }
  return fallback;
}

export function ResearchDesk({
  audience,
  allowScenario,
  onBusy,
}: {
  audience: Audience;
  allowScenario: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<ResearchScenarioId | null>(null);
  const [question, setQuestion] = useState("");
  const [job, setJob] = useState<JobView | null>(null);
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [reportText, setReportText] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const idempotency = useRef<string | null>(null);
  const {
    container: verificationContainer,
    ready: verificationReady,
    error: verificationError,
    beforeSend,
  } = useTurnstile();

  async function refreshBudget() {
    const response = await fetch("/api/research/budget");
    const body = (await readJson(response)) as {
      reserved?: string;
      unknown?: string;
      consumed?: string;
      note?: string;
    } | null;
    if (response.ok && body?.reserved) {
      setBudget(
        `Reservado ${body.reserved}. Consumido ${body.consumed ?? ""}. Desconocido ${body.unknown ?? ""}. ${body.note ?? ""}`,
      );
    }
  }

  const loadConversations = useCallback(
    async (preferred: string | null) => {
      const response = await fetch("/api/research/conversations");
      const body = (await readJson(response)) as { conversations?: ConversationItem[] } | null;
      const mine = (body?.conversations ?? []).filter((item) => item.audience === audience);
      setConversations(mine);
      const stored = preferred ?? sessionStorage.getItem(`research-conversation:${audience}`);
      const selected = mine.find((item) => item.id === stored) ?? mine[0] ?? null;
      setConversationId(selected?.id ?? null);
      if (selected) {
        sessionStorage.setItem(`research-conversation:${audience}`, selected.id);
      }
    },
    [audience],
  );

  useEffect(() => {
    let ignore = false;
    void (async () => {
      const session = await fetch("/api/research/session");
      if (!session.ok || ignore) {
        return;
      }
      await loadConversations(null);
      await refreshBudget();
    })();
    return () => {
      ignore = true;
    };
  }, [audience, loadConversations]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }
    let ignore = false;
    void (async () => {
      setReportText(null);
      setReportNote(null);
      setSummary(null);
      setSources([]);
      const response = await fetch(`/api/research/conversations/${conversationId}`);
      const body = (await readJson(response)) as {
        messages?: { role: string; job_id: string | null; text: string }[];
      } | null;
      const last = [...(body?.messages ?? [])].reverse().find((message) => message.job_id);
      if (ignore || !last?.job_id) {
        return;
      }
      const status = await fetch(`/api/research/jobs/${last.job_id}`);
      const view = (await readJson(status)) as JobView | null;
      if (!ignore && view && "execution" in view) {
        setJob({ ...view, events: view.events ?? [] });
      }
      if (view?.reportOutcome) {
        const result = await fetch(`/api/research/jobs/${last.job_id}/result`);
        const payload = (await readJson(result)) as ResultPayload | null;
        if (!ignore && payload?.summary) {
          const shown = shownReport(payload);
          setSummary(payload.summary);
          setSources(payload.sources ?? []);
          setReportText(shown.text);
          setReportNote(shown.note);
        }
      }
    })();
    return () => {
      ignore = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (
      job === null ||
      job.execution === "complete" ||
      job.execution === "cancelled" ||
      job.execution === "failed" ||
      job.execution === "attention"
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void poll(job.jobId, job.events.at(-1)?.seq ?? 0);
    }, 800);
    return () => {
      window.clearInterval(timer);
    };
  }, [job]);

  useEffect(() => {
    onBusy(job?.execution === "queued" || job?.execution === "running");
    return () => {
      onBusy(false);
    };
  }, [job, onBusy]);

  async function poll(jobId: string, after: number) {
    const response = await fetch(`/api/research/jobs/${jobId}?after=${String(after)}`);
    const body = (await readJson(response)) as JobView | null;
    if (!response.ok || body === null || !("execution" in body)) {
      return;
    }
    setJob((current) =>
      current && current.jobId === body.jobId
        ? {
            ...body,
            events: [...current.events, ...body.events.filter((event) => event.seq > after)],
          }
        : body,
    );
    if (body.execution === "complete" || body.reportOutcome) {
      const result = await fetch(`/api/research/jobs/${jobId}/result`);
      if (result.ok) {
        const payload = (await readJson(result)) as ResultPayload | null;
        if (payload?.summary) {
          const shown = shownReport(payload);
          setSummary(payload.summary);
          setSources(payload.sources ?? []);
          setReportText(shown.text);
          setReportNote(shown.note);
        }
      }
      await refreshBudget();
    }
  }

  async function mutationHeaders(jsonBody: boolean): Promise<HeadersInit | null> {
    try {
      const token = await beforeSend();
      return {
        ...(jsonBody ? { "content-type": "application/json" } : {}),
        ...(token ? { "x-turnstile-token": token } : {}),
      };
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "No se pudo verificar el envío.");
      return null;
    }
  }

  async function createConversation() {
    setNotice(null);
    const headers = await mutationHeaders(true);
    if (headers === null) {
      return;
    }
    const response = await fetch("/api/research/conversations", {
      method: "POST",
      headers,
      body: JSON.stringify({ audience }),
    });
    const body = (await readJson(response)) as { id?: string; message?: string } | null;
    if (!response.ok || !body?.id) {
      setNotice(messageOf(body, "No se pudo crear la conversación."));
      return;
    }
    sessionStorage.setItem(`research-conversation:${audience}`, body.id);
    setSummary(null);
    setSources([]);
    setReportText(null);
    setReportNote(null);
    setJob(null);
    await loadConversations(body.id);
  }

  async function submit() {
    if (!conversationId || question.trim().length === 0) {
      return;
    }
    setNotice(null);
    const headers = await mutationHeaders(true);
    if (headers === null) {
      return;
    }
    setSummary(null);
    setSources([]);
    setReportText(null);
    setReportNote(null);
    idempotency.current ??= crypto.randomUUID();
    const response = await fetch(`/api/research/conversations/${conversationId}/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        idempotencyKey: idempotency.current,
        question: question.trim(),
        scenarioId,
      }),
    });
    const body = (await readJson(response)) as {
      jobId?: string;
      message?: string;
      execution?: string;
    } | null;
    if (!response.ok || !body?.jobId) {
      setNotice(messageOf(body, "No se pudo crear el trabajo."));
      return;
    }
    idempotency.current = null;
    setQuestion("");
    setJob({
      jobId: body.jobId,
      conversationId,
      execution: body.execution ?? "queued",
      reportOutcome: null,
      attention: null,
      progress: null,
      events: [],
    });
  }

  async function cancel() {
    if (!job) {
      return;
    }
    const headers = await mutationHeaders(false);
    if (headers === null) {
      return;
    }
    const response = await fetch(`/api/research/jobs/${job.jobId}/cancel`, {
      method: "POST",
      headers,
    });
    const body = await readJson(response);
    if (!response.ok) {
      setNotice(messageOf(body, "No se pudo cancelar."));
      return;
    }
    await poll(job.jobId, 0);
  }

  async function recover() {
    if (!job) {
      return;
    }
    const headers = await mutationHeaders(false);
    if (headers === null) {
      return;
    }
    const response = await fetch(`/api/research/jobs/${job.jobId}/recover`, {
      method: "POST",
      headers,
    });
    const body = await readJson(response);
    setNotice(
      messageOf(body, response.ok ? "Recuperación registrada." : "Hace falta conciliación."),
    );
    await poll(job.jobId, 0);
  }

  const status =
    job === null
      ? "Sin trabajo activo."
      : job.execution === "attention" && job.attention === "recoverable"
        ? "Se puede recuperar"
        : job.execution === "attention" && job.attention === "reconciliation-required"
          ? "Hace falta conciliación"
          : (EXECUTION_LABEL[job.execution] ?? job.execution);
  const detail =
    job?.attention === "recoverable"
      ? "Hay un checkpoint del mismo trabajo. Recuperar continúa sin otro plan ni otro plazo."
      : job?.attention === "reconciliation-required"
        ? "Hay una operación ambigua. No se reenvía ni se libera la reserva."
        : (job?.progress ?? "Puedes cerrar la página: el trabajo sigue hasta que lo canceles.");

  return (
    <div className="research-desk">
      <p className="composer-caption">
        Conversación anónima de esta demostración. No es una cuenta de alumno. Cerrar la página no
        cancela el trabajo.
      </p>
      <div className="conversation-list">
        {conversations.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="caption-action"
            aria-pressed={item.id === conversationId}
            onClick={() => {
              setConversationId(item.id);
              sessionStorage.setItem(`research-conversation:${audience}`, item.id);
              setSummary(null);
              setReportText(null);
              setReportNote(null);
              setJob(null);
            }}
          >
            Conversación {index + 1}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void createConversation()}
          disabled={!verificationReady}
        >
          Nueva conversación
        </button>
      </div>
      {allowScenario ? (
        <label className="composer-script" htmlFor="guion-durable">
          Guion
          <select
            id="guion-durable"
            value={scenarioId ?? ""}
            onChange={(event) => {
              const found = [...DEMO_RESEARCH_SCENARIOS, RECOVERY_SCENARIO].find(
                (item) => item.id === event.target.value,
              );
              setScenarioId(found?.id ?? null);
              if (found) {
                setQuestion(found.question);
              }
            }}
          >
            <option value="">Libre, con el material del curso de prueba</option>
            {[...DEMO_RESEARCH_SCENARIOS, RECOVERY_SCENARIO].map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Pregunta de investigación"
          value={question}
          rows={3}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />
        <button
          type="submit"
          disabled={!verificationReady || !conversationId || question.trim().length === 0}
        >
          Investigar
        </button>
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={
            !verificationReady ||
            !job ||
            job.execution === "complete" ||
            job.execution === "cancelled"
          }
        >
          Cancelar trabajo
        </button>
        <button
          type="button"
          onClick={() => void recover()}
          disabled={
            !verificationReady ||
            job == null ||
            (job.execution !== "queued" &&
              job.execution !== "running" &&
              job.execution !== "attention")
          }
        >
          Recuperar
        </button>
        <div ref={verificationContainer} aria-label="Verificación de seguridad" />
      </form>
      <div className={`t-skel research-status-skel${summary ? " is-revealed" : ""}`}>
        <div className="t-skel-skeleton is-pulsing">
          <p>Consultando el trabajo…</p>
        </div>
        <div className="t-skel-content">
          <p>
            <StatusLine text={status} /> {detail}
          </p>
        </div>
      </div>
      {verificationError ? <p role="alert">{verificationError}</p> : null}
      {notice ? <p role="alert">{notice}</p> : null}
      {budget ? <p className="research-meta">{budget}</p> : null}
      {summary ? (
        <>
          <p className="trace-summary">
            La ejecución puede haber terminado y el informe seguir siendo parcial, un rechazo o un
            error.
          </p>
          {reportText ? <CourseAnswer text={reportText} /> : null}
          {reportNote ? <p>{reportNote}</p> : null}
          <ResearchTrace summary={summary} />
          <ResearchSources sources={sources} />
        </>
      ) : null}
    </div>
  );
}
