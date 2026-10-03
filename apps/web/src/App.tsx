import { useChat } from "@ai-sdk/react";
import {
  DEMO_CRAG_SCENARIOS,
  healthResponseSchema,
  type Audience,
  type ChatMode,
  type CragStep,
  type DemoScenarioId,
  type HealthResponse,
} from "@thepower-rag/contracts";
import { DefaultChatTransport, type CourseUIMessage } from "./chat";
import {
  ChatError,
  MatrixLoader,
  PanelSlide,
  RevealSlot,
  RunNote,
  ThinkStatus,
} from "./chat-motion-view";
import { conversationStatus, prefersReducedMotion } from "./chat-motion";
import { CourseAnswer } from "./course-answer";
import { acceptScenarioChange, discardedRowKey, retainedRowKey } from "./crag-panel";
import { conversationKey } from "./scope";
import { useTurnstile } from "./use-turnstile";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from "react";

const STAGES: readonly { id: ChatMode; label: string }[] = [
  { id: "sin-rag", label: "Sin RAG" },
  { id: "rag", label: "RAG básico" },
  { id: "crag", label: "CRAG" },
];

const AUDIENCES: readonly { id: Audience; label: string; title?: string }[] = [
  { id: "program", label: "General" },
  { id: "L/X", label: "L/X", title: "Grupo con clases los lunes y miércoles" },
  { id: "M/J", label: "M/J", title: "Grupo con clases los martes y jueves" },
];

const EXAMPLES: Record<ChatMode, string> = {
  "sin-rag": "¿Qué es un embedding?",
  rag: "¿Qué vemos en la sesión 10?",
  crag: "¿Qué cambia CRAG respecto a una sola búsqueda?",
};

function citationKind(source: {
  chunkId: string;
  title: string;
  section: string;
}): "calendar" | "exercise" | "session" | "note" {
  const hay = `${source.chunkId} ${source.title} ${source.section}`.toLowerCase();
  if (hay.includes("calendario") || hay.includes("calendar")) {
    return "calendar";
  }
  if (hay.includes("ejercicio")) {
    return "exercise";
  }
  if (
    /(?:^|[^a-z])s0*\d{1,2}(?!\d)/.test(hay) ||
    hay.includes("sesión") ||
    hay.includes("sesion")
  ) {
    return "session";
  }
  return "note";
}

function sessionLabel(source: { chunkId: string; title: string }): string | null {
  const match = /s0*(\d{1,2})(?!\d)/i.exec(`${source.chunkId} ${source.title}`);
  if (match === null) {
    return null;
  }
  return `S${String(Number(match[1]))}`;
}

function friendlyExcerpt(excerpt: string): string {
  return excerpt
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const KIND_LABEL = {
  calendar: "Calendario",
  exercise: "Ejercicio",
  session: "Sesión",
  note: "Nota",
} as const;

function CitationCard({
  index,
  title,
  section,
  excerpt,
  chunkId,
}: {
  index: number;
  title: string;
  section: string;
  excerpt: string;
  chunkId: string;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(prefersReducedMotion);
  const [hiding, setHiding] = useState(false);
  useEffect(() => {
    if (shown) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setShown(true);
    });
    const timer = window.setTimeout(() => {
      setShown(true);
    }, 50);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [shown]);
  useEffect(() => {
    const node = bodyRef.current;
    const root = node?.closest(".panel-scroll");
    if (node === null || root === null || prefersReducedMotion()) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) {
          return;
        }
        const above = entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 4;
        setHiding(!entry.isIntersecting && above);
      },
      { root, rootMargin: "-72px 0px 0px 0px", threshold: [0, 1] },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);
  const kind = citationKind({ chunkId, title, section });
  const session = sessionLabel({ chunkId, title });
  const showSection = section.trim().length > 0 && section !== title && section !== session;
  return (
    <li
      className={shown ? "citation t-stagger is-shown" : "citation t-stagger"}
      style={{ "--cite-index": `${String(Math.min(index, 6) * 40)}ms` } as CSSProperties}
      title={chunkId}
    >
      <div className="citation-head">
        <p className="chip-row t-stagger-line t-stagger-line--1">
          <span className={`chip chip-${kind}`}>
            {kind === "session" && session !== null ? session : KIND_LABEL[kind]}
          </span>
          {kind !== "session" && session !== null ? (
            <span className="chip chip-session">{session}</span>
          ) : null}
          {showSection ? <span className="chip chip-note">{section}</span> : null}
        </p>
        <p className="citation-title t-stagger-line t-stagger-line--2">{title}</p>
      </div>
      <div
        ref={bodyRef}
        className={
          hiding ? "citation-body t-stagger is-hiding" : "citation-body t-stagger is-shown"
        }
      >
        <p className="citation-excerpt t-stagger-line">{friendlyExcerpt(excerpt)}</p>
      </div>
    </li>
  );
}

function originLabel(origin: string): string {
  if (origin === "provider") {
    return "Proveedor";
  }
  return origin;
}

function visibleError(message: string): string {
  const folded = message.trim().toLowerCase();
  if (
    folded === "failed to fetch" ||
    folded === "load failed" ||
    folded.startsWith("networkerror")
  ) {
    return "No se ha podido comprobar el envío. Comprueba la conexión.";
  }
  return message;
}

function readableError(error: Error): string {
  const raw = error.message.trim();
  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      const parsed: unknown = JSON.parse(raw.slice(start));
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "message" in parsed &&
        typeof parsed.message === "string"
      ) {
        return parsed.message;
      }
    } catch {
      return raw || "La solicitud ha fallado.";
    }
  }
  return raw || "La solicitud ha fallado.";
}

function partText(message: CourseUIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function capabilityNote(status: string | undefined): string {
  switch (status) {
    case "offline-demo":
      return "Demostración local, sin modelo";
    case "offline-fixture":
      return "Canalización local de prueba";
    case "ready":
      return "Proveedor configurado";
    case "blocked":
      return "Falta configuración";
    default:
      return "No implementado";
  }
}

function SegmentedChoice<T extends string>({
  legend,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { id: T; label: string; title?: string }[];
  disabled: boolean;
  onChange: (id: T) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const seen = useRef(false);

  const placePill = useCallback((animate: boolean) => {
    const bar = barRef.current;
    const pill = pillRef.current;
    if (bar === null || pill === null) {
      return;
    }
    const active = bar.querySelector<HTMLElement>(".segment:has(input:checked)");
    if (active === null) {
      return;
    }
    const write = () => {
      pill.style.transform = `translateX(${String(active.offsetLeft)}px)`;
      pill.style.width = `${String(active.offsetWidth)}px`;
    };
    if (!animate) {
      const previous = pill.style.transition;
      pill.style.transition = "none";
      write();
      void pill.offsetWidth;
      pill.style.transition = previous;
      return;
    }
    write();
  }, []);

  useLayoutEffect(() => {
    placePill(seen.current);
    seen.current = true;
  }, [placePill, value, disabled, options]);

  useEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return;
    }
    const snap = () => {
      placePill(false);
    };
    const observer = new ResizeObserver(snap);
    observer.observe(bar);
    observer.observe(document.documentElement);
    window.addEventListener("resize", snap);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", snap);
    };
  }, [placePill]);

  return (
    <fieldset className="choice" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="t-tabs" ref={barRef}>
        <span className="t-tabs-pill" ref={pillRef} aria-hidden="true" />
        {options.map((option) => (
          <label key={option.id} className="segment" title={option.title}>
            <input
              type="radio"
              name={name}
              value={option.id}
              aria-label={option.title ?? option.label}
              checked={value === option.id}
              onChange={() => {
                onChange(option.id);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function metric(value: number | null | undefined, offline: boolean): string {
  if (offline) {
    return "no medido";
  }
  return value === undefined || value === null ? "desconocido" : String(value);
}

function costLabel(cost: { amount: number } | null, offline: boolean): string {
  if (cost === null) {
    return offline ? "no medido" : "desconocido";
  }
  return String(cost.amount);
}

function AssistantMessage({ message }: { message: CourseUIMessage }) {
  const metadata = message.metadata;
  const offline = metadata?.origin === "offline-demo" || metadata?.origin === "offline-fixture";
  const settled = metadata !== undefined && metadata.completion !== "streaming";
  return (
    <article className="message message-assistant">
      <CourseAnswer text={partText(message)} />
      {settled && metadata !== undefined ? (
        <RunNote
          summary={`${originLabel(metadata.origin)}. Estado: ${metadata.completion}.`}
          detail={`Uso entrada: ${metric(metadata.usage?.inputTokens, offline)}. Uso salida: ${metric(metadata.usage?.outputTokens, offline)}. Coste: ${costLabel(metadata.cost, offline)}.`}
        />
      ) : null}
    </article>
  );
}

function ChatPane({
  mode,
  audience,
  allowScenario,
  onBusy,
}: {
  mode: ChatMode;
  audience: Audience;
  allowScenario: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const {
    container: verificationContainer,
    ready: verificationReady,
    error: verificationError,
    beforeSend,
    reset: resetVerification,
    retry: retryVerification,
  } = useTurnstile();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [scenario, setScenario] = useState<DemoScenarioId | null>(null);
  const [liveSteps, setLiveSteps] = useState<CragStep[]>([]);
  const selectedScenario = allowScenario && mode === "crag" ? scenario : null;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<CourseUIMessage>({
        api: "/api/chat",
        fetch: async (url, init) => {
          const response = await fetch(url, init);
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { message?: string } | null;
            throw new Error(body?.message ?? `La petición respondió HTTP ${response.status}.`);
          }
          return response;
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            mode,
            audience,
            messages: messages.map((message) => ({
              id: message.id,
              role: message.role,
              parts: [{ type: "text", text: partText(message) }],
            })),
            ...(selectedScenario === null ? {} : { demoScenario: selectedScenario }),
          },
        }),
      }),
    [mode, audience, selectedScenario],
  );
  const { messages, sendMessage, status, stop, error, clearError, setMessages } =
    useChat<CourseUIMessage>({
      transport,
      onData: (part) => {
        if (part.type === "data-step") {
          setLiveSteps((current) => [...current, part.data].slice(-16));
        }
      },
    });
  const [input, setInput] = useState("");
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const busy = verifying || status === "submitted" || status === "streaming";
  useEffect(() => {
    onBusy(busy);
    return () => {
      onBusy(false);
    };
  }, [busy, onBusy]);
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const sources = lastAssistant?.parts.filter((part) => part.type === "data-source") ?? [];
  const trace = lastAssistant?.parts.find((part) => part.type === "data-trace");
  const cragPart = lastAssistant?.parts.find((part) => part.type === "data-crag");
  const crag = cragPart?.type === "data-crag" ? cragPart.data : null;
  const answerPending = busy || lastAssistant?.metadata?.completion === "streaming";
  const sourcesLoading = mode !== "sin-rag" && sources.length === 0 && answerPending;
  const traceLoading =
    answerPending &&
    (mode === "crag" ? crag === null && liveSteps.length === 0 : trace?.type !== "data-trace");

  async function sendQuestion() {
    const text = input.trim();
    if (text.length === 0 || busy || !verificationReady) {
      return;
    }
    setSubmitError(null);
    setVerifying(true);
    try {
      const verificationToken = await beforeSend();
      clearError();
      setLiveSteps([]);
      setInput("");
      await sendMessage(
        { text },
        { headers: verificationToken ? { "x-turnstile-token": verificationToken } : {} },
      );
    } catch (caught: unknown) {
      setSubmitError(caught instanceof Error ? caught.message : "No se pudo enviar la pregunta.");
    } finally {
      setVerifying(false);
      resetVerification();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion();
  }

  function onQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    void sendQuestion();
  }

  const statusLabel = conversationStatus(status, mode);
  const showRail = messages.some((message) => message.role === "assistant");
  const alertMessage = verificationError ?? submitError;
  useLayoutEffect(() => {
    const node = questionRef.current;
    if (node === null) {
      return;
    }
    node.style.height = "auto";
    node.style.height = `${String(Math.min(node.scrollHeight, 140))}px`;
  }, [input]);

  return (
    <div className={showRail ? "layout" : "layout layout-single"}>
      <section className="conversation" aria-label="Conversación">
        <div className="transcript" aria-live="polite">
          {messages.map((message) => (
            <PanelSlide key={message.id}>
              {message.role === "assistant" ? (
                <AssistantMessage message={message} />
              ) : (
                <article className="message message-user">
                  <p>{partText(message)}</p>
                </article>
              )}
            </PanelSlide>
          ))}
        </div>
        {error === undefined ? null : <ChatError message={readableError(error)} />}
        <form className="composer" onSubmit={onSubmit}>
          {mode === "crag" && allowScenario ? (
            <label className="composer-script" htmlFor="guion-crag">
              Guion
              <select
                id="guion-crag"
                value={scenario ?? ""}
                disabled={busy || !acceptScenarioChange(busy)}
                onChange={(event) => {
                  if (!acceptScenarioChange(busy)) {
                    return;
                  }
                  const next = event.target.value;
                  if (next === "") {
                    setScenario(null);
                    setMessages([]);
                    setLiveSteps([]);
                    return;
                  }
                  const found = DEMO_CRAG_SCENARIOS.find((item) => item.id === next);
                  if (found === undefined) {
                    return;
                  }
                  setScenario(found.id);
                  setInput(found.question);
                  setMessages([]);
                  setLiveSteps([]);
                }}
              >
                <option value="">Libre, con el índice lexical de prueba</option>
                {DEMO_CRAG_SCENARIOS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="composer-caption">
            {alertMessage !== null ? (
              <span role="alert">
                {visibleError(alertMessage)}
                {verificationError !== null ? (
                  <button className="caption-action" type="button" onClick={retryVerification}>
                    Reintentar
                  </button>
                ) : null}
              </span>
            ) : busy ? (
              <span className="conversation-status" role="status">
                <span className="status-loader">
                  <MatrixLoader variant="scan" />
                </span>
                <ThinkStatus label={statusLabel} live />
              </span>
            ) : messages.length === 0 ? (
              <button
                className="caption-action"
                type="button"
                onClick={() => {
                  if (!acceptScenarioChange(busy)) {
                    return;
                  }
                  setScenario(null);
                  setInput(EXAMPLES[mode]);
                  questionRef.current?.focus();
                }}
              >
                {EXAMPLES[mode]}
              </button>
            ) : (
              <button
                className="caption-action"
                type="button"
                onClick={() => {
                  clearError();
                  setMessages([]);
                  setInput("");
                }}
              >
                Nueva conversación
              </button>
            )}
          </p>
          <div className="composer-pill">
            <textarea
              id="pregunta"
              ref={questionRef}
              aria-label="Pregunta"
              rows={1}
              value={input}
              onChange={(event) => {
                const next = event.target.value;
                setInput(next);
                if (!acceptScenarioChange(busy)) {
                  return;
                }
                setScenario((current) => {
                  const selected = DEMO_CRAG_SCENARIOS.find((item) => item.id === current);
                  return selected !== undefined && selected.question === next ? current : null;
                });
              }}
              placeholder="Escribe una pregunta"
              onKeyDown={onQuestionKeyDown}
            />
            {busy ? (
              <button className="send" type="button" onClick={() => void stop()}>
                Detener
              </button>
            ) : (
              <button
                className="send"
                type="submit"
                disabled={!verificationReady || input.trim().length === 0}
              >
                Enviar
              </button>
            )}
          </div>
          <div ref={verificationContainer} aria-label="Verificación de seguridad" />
        </form>
      </section>
      {showRail ? (
        <PanelSlide as="aside" className="panel">
          <div className="panel-scroll">
            <section className="sources-section">
              <h2 className="sources-sticky">Fuentes</h2>
              {mode === "sin-rag" ? (
                <p>Sin fuentes. Este modo no recupera documentos.</p>
              ) : (
                <RevealSlot
                  loading={sourcesLoading}
                  label="Fuentes"
                  skeleton={
                    <>
                      <span className="skel-line skel-line-short" />
                      <span className="skel-line" />
                      <span className="skel-line skel-line-mid" />
                    </>
                  }
                >
                  {sources.length === 0 ? (
                    <p>Sin fuentes en esta respuesta.</p>
                  ) : (
                    <ul className="citations">
                      {sources.map((source, index) =>
                        source.type === "data-source" ? (
                          <CitationCard
                            key={source.data.chunkId}
                            index={index}
                            title={source.data.title}
                            section={source.data.section}
                            excerpt={source.data.excerpt}
                            chunkId={source.data.chunkId}
                          />
                        ) : null,
                      )}
                    </ul>
                  )}
                </RevealSlot>
              )}
            </section>
            <section>
              <h2>Traza de la clase</h2>
              <RevealSlot
                loading={traceLoading}
                label="Traza de la clase"
                skeleton={
                  <>
                    <span className="skel-line skel-line-mid" />
                    <span className="skel-line" />
                  </>
                }
              >
                {mode === "crag" ? (
                  <div>
                    {crag === null ? (
                      <p>La traza aparece con la respuesta.</p>
                    ) : (
                      <PanelSlide>
                        <div>
                          <p className="trace-summary">
                            {crag.fixture ? "Guion de prueba." : "Recorrido real."} {crag.terminal}.{" "}
                            {crag.reason}
                          </p>
                          <ul className="trace-list">
                            <li>
                              Búsquedas {crag.retrievalCount}. Quedan {crag.attemptsRemaining}.
                            </li>
                            <li>
                              Reformulaciones {crag.reformulationCount}. Quedan{" "}
                              {crag.rewritesRemaining}.
                            </li>
                            <li>
                              Llamadas de pago:{" "}
                              {crag.measured
                                ? "contadas por separado, sin total inventado"
                                : "no medidas"}
                              . Uso:{" "}
                              {crag.usage === null
                                ? crag.measured
                                  ? "desconocido"
                                  : "no medido"
                                : "parcial"}
                              . Coste:{" "}
                              {crag.cost === null
                                ? crag.measured
                                  ? "desconocido"
                                  : "no medido"
                                : crag.cost.amount}
                              .
                            </li>
                            <li>Consulta original: {crag.originalQuestion}</li>
                            <li>Consulta de búsqueda: {crag.currentQuery}</li>
                            {crag.retained.map((item, index) => (
                              <li key={retainedRowKey(item.chunkId, index)}>
                                Conservado {item.chunkId}
                                {item.score === null ? "" : ` (${item.score.toFixed(3)})`}:{" "}
                                {item.reason}
                              </li>
                            ))}
                            {crag.discarded.map((item, index) => (
                              <li key={discardedRowKey(item, index)}>
                                Descartado {item.chunkId}, intento {item.attempt}: {item.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </PanelSlide>
                    )}
                    {liveSteps.length === 0 ? null : (
                      <ol className="steps" aria-live="polite" aria-label="Pasos del grafo">
                        {liveSteps.map((step, index) => (
                          <PanelSlide key={`${step.kind}-${String(index)}`} as="li">
                            {step.kind}. Búsqueda {step.retrieval ?? 0}. {step.status}
                          </PanelSlide>
                        ))}
                      </ol>
                    )}
                  </div>
                ) : trace?.type === "data-trace" ? (
                  <PanelSlide>
                    <ul className="trace-list">
                      <li>Consulta: {trace.data.query}</li>
                      <li>
                        {trace.data.queryRewrite === "context-complete"
                          ? "El modelo dispone del contexto completo del grupo y del historial para interpretar seguimientos."
                          : "Reescritura de seguimiento: pendiente."}
                      </li>
                      <li>{trace.data.scoreMeaning}</li>
                      {trace.data.retrieved.map((item) => (
                        <li key={item.chunkId}>
                          {item.chunkId}:{" "}
                          {item.score === null ? "puntuación desconocida" : item.score.toFixed(3)}{" "}
                          {item.selected ? "seleccionado" : "descartado"}
                        </li>
                      ))}
                      <li>
                        Decisión: {trace.data.decision}. Generación: {trace.data.generation}.
                      </li>
                      <li>{trace.data.status}</li>
                    </ul>
                  </PanelSlide>
                ) : (
                  <p>
                    {mode === "sin-rag"
                      ? "Sin RAG no recupera ni puntúa documentos."
                      : "La traza aparece con la respuesta."}
                  </p>
                )}
              </RevealSlot>
            </section>
          </div>
        </PanelSlide>
      ) : null}
    </div>
  );
}

export function App() {
  const [mode, setMode] = useState<ChatMode>("sin-rag");
  const [audience, setAudience] = useState<Audience>("program");
  const [epoch, setEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const onBusy = useCallback((value: boolean) => {
    setBusy(value);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`El estado del servidor respondió HTTP ${String(response.status)}.`);
        }
        const parsed = healthResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          throw new Error("La respuesta de salud no cumple el contrato.");
        }
        setHealth(parsed.data);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);

  function choose(nextMode: ChatMode, nextAudience: Audience) {
    if (busy || (nextMode === mode && nextAudience === audience)) {
      return;
    }
    setMode(nextMode);
    setAudience(nextAudience);
    setEpoch((value) => value + 1);
  }

  return (
    <main className="shell">
      <header className="masthead">
        <h1>The Power RAG y CRAG</h1>
        <p>
          Clases 10 y 11. RAG y CRAG consultan el mismo material del curso: el temario de las
          sesiones 1 a 20, los ejercicios documentados y el calendario de cada grupo, con fechas,
          horario y profesor.
        </p>
      </header>
      <div className="toolbar">
        <div>
          <SegmentedChoice
            legend="Etapa"
            name="stage"
            value={mode}
            options={STAGES}
            disabled={busy}
            onChange={(nextMode) => {
              choose(nextMode, audience);
            }}
          />
          <p className="stage-note">{capabilityNote(health?.capabilities[mode].status)}</p>
        </div>
        <div>
          <SegmentedChoice
            legend="Grupo del curso"
            name="audience"
            value={audience}
            options={AUDIENCES}
            disabled={busy}
            onChange={(nextAudience) => {
              choose(mode, nextAudience);
            }}
          />
          <p className="group-note">L/X, lunes y miércoles. M/J, martes y jueves.</p>
        </div>
      </div>
      <ChatPane
        key={conversationKey(mode, audience, epoch)}
        mode={mode}
        audience={audience}
        allowScenario={health?.execution === "demo"}
        onBusy={onBusy}
      />
    </main>
  );
}
