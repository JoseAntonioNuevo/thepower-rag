// GUÍA DE LECTURA · apps/web/src/App.tsx
// Interfaz principal del curso: elige etapa (sin RAG, RAG, CRAG o investigación) y grupo, conversa con
// useChat del AI SDK contra /api/chat y enseña al lado las fuentes citadas, la traza y el grafo CRAG.
// Recorrido de un envío: verificación Turnstile → sendMessage → flujo SSE → mensajes, fuentes y traza.
// useChat gestiona mensajes, envío y streaming.
import { useChat } from "@ai-sdk/react";
// Escenarios de demo, esquema de salud y tipos del contrato.
import {
  // Guiones de CRAG y de investigación y la pregunta de demo.
  DEMO_CRAG_SCENARIOS,
  DEMO_RESEARCH_QUESTION,
  DEMO_RESEARCH_SCENARIOS,
  // Esquema para validar /api/health.
  healthResponseSchema,
  // Tipos de grupo, modo, pasos y guiones.
  type Audience,
  type ChatMode,
  type CragStep,
  type DemoScenarioId,
  type HealthResponse,
  type ResearchScenarioId,
  type ResearchStep,
} from "@thepower-rag/contracts";
// Transporte HTTP y tipo de mensaje.
import { DefaultChatTransport, type CourseUIMessage } from "./chat";
// Componentes de movimiento.
import {
  ChatError,
  MatrixLoader,
  PanelSlide,
  RevealSlot,
  RunNote,
  ThinkStatus,
} from "./chat-motion-view";
// Etiqueta de estado y movimiento reducido.
import { conversationStatus, prefersReducedMotion } from "./chat-motion";
// Respuesta con el Markdown del curso.
import { CourseAnswer } from "./course-answer";
// Utilidades del panel CRAG.
import { acceptScenarioChange, discardedRowKey, retainedRowKey } from "./crag-panel";
// Mesa de investigación durable.
import { ResearchDesk } from "./research-desk";
// Fuentes, pasos y traza de investigación.
import { ResearchSources, ResearchSteps, ResearchTrace } from "./research-panel";
// Clave de conversación.
import { conversationKey } from "./scope";
// Verificación con Turnstile.
import { useTurnstile } from "./use-turnstile";
// Hooks y tipos de React.
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

// Etapas del recorrido del curso.
const STAGES: readonly { id: ChatMode; label: string }[] = [
  { id: "sin-rag", label: "Sin RAG" },
  { id: "rag", label: "RAG básico" },
  { id: "crag", label: "CRAG" },
  { id: "research", label: "Investigación" },
];

// Grupos: general o un calendario concreto.
const AUDIENCES: readonly { id: Audience; label: string; title?: string }[] = [
  { id: "program", label: "General" },
  { id: "L/X", label: "L/X", title: "Grupo con clases los lunes y miércoles" },
  { id: "M/J", label: "M/J", title: "Grupo con clases los martes y jueves" },
];

// Pregunta de ejemplo de cada etapa.
const EXAMPLES: Record<ChatMode, string> = {
  "sin-rag": "¿Qué es un embedding?",
  rag: "¿Qué vemos en la sesión 10?",
  crag: "¿Qué cambia CRAG respecto a una sola búsqueda?",
  research: DEMO_RESEARCH_QUESTION,
};

// Tipo de cita según su id, título y sección.
function citationKind(source: {
  // Id del fragmento.
  chunkId: string;
  // Título.
  title: string;
  // Sección.
  section: string;
}): "calendar" | "exercise" | "session" | "note" {
  // Texto donde buscar.
  const hay = `${source.chunkId} ${source.title} ${source.section}`.toLowerCase();
  // Calendario.
  if (hay.includes("calendario") || hay.includes("calendar")) {
    // calendar.
    return "calendar";
  }
  // Ejercicio.
  if (hay.includes("ejercicio")) {
    // exercise.
    return "exercise";
  }
  // Sesión.
  if (
    /(?:^|[^a-z])s0*\d{1,2}(?!\d)/.test(hay) ||
    hay.includes("sesión") ||
    hay.includes("sesion")
  ) {
    // session.
    return "session";
  }
  // Nota.
  return "note";
}

// Sesión (S1…S20) de una cita, si la hay.
function sessionLabel(source: { chunkId: string; title: string }): string | null {
  // Número de sesión.
  const match = /s0*(\d{1,2})(?!\d)/i.exec(`${source.chunkId} ${source.title}`);
  // Sin sesión.
  if (match === null) {
    // null.
    return null;
  }
  // S y número.
  return `S${String(Number(match[1]))}`;
}

// Extracto legible: sin almohadillas de título ni saltos.
function friendlyExcerpt(excerpt: string): string {
  // Limpia.
  return excerpt
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Texto de cada tipo de cita.
const KIND_LABEL = {
  calendar: "Calendario",
  exercise: "Ejercicio",
  session: "Sesión",
  note: "Nota",
} as const;

// Tarjeta de una cita con su extracto, que se oculta al subir el panel.
function CitationCard({
  index,
  title,
  section,
  excerpt,
  chunkId,
}: {
  // Posición.
  index: number;
  // Título.
  title: string;
  // Sección.
  section: string;
  // Extracto.
  excerpt: string;
  // Id del fragmento.
  chunkId: string;
}) {
  // Cuerpo.
  const bodyRef = useRef<HTMLDivElement>(null);
  // ¿Visible?
  const [shown, setShown] = useState(prefersReducedMotion);
  // ¿Ocultándose al hacer scroll?
  const [hiding, setHiding] = useState(false);
  // Aparece en el siguiente fotograma.
  useEffect(() => {
    // Ya visible.
    if (shown) {
      // Nada.
      return;
    }
    // Siguiente fotograma.
    const frame = window.requestAnimationFrame(() => {
      // Visible.
      setShown(true);
    });
    // Por si no hay fotograma.
    const timer = window.setTimeout(() => {
      // Visible.
      setShown(true);
    }, 50);
    // Limpieza.
    return () => {
      // Cancela.
      window.cancelAnimationFrame(frame);
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [shown]);
  // Oculta el cuerpo cuando sale por arriba del panel.
  useEffect(() => {
    // Nodo.
    const node = bodyRef.current;
    // Panel con scroll.
    const root = node?.closest(".panel-scroll");
    // Sin nodo, sin panel o sin movimiento.
    if (node === null || root === null || prefersReducedMotion()) {
      // Nada.
      return;
    }
    // Observa la intersección con el panel.
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Sin entrada.
        if (entry === undefined) {
          // Nada.
          return;
        }
        // ¿Salió por arriba?
        const above = entry.boundingClientRect.bottom <= (entry.rootBounds?.top ?? 0) + 4;
        // Oculta.
        setHiding(!entry.isIntersecting && above);
      },
      { root, rootMargin: "-72px 0px 0px 0px", threshold: [0, 1] },
    );
    // Observa.
    observer.observe(node);
    // Limpieza.
    return () => {
      // Deja de observar.
      observer.disconnect();
    };
  }, []);
  // Tipo.
  const kind = citationKind({ chunkId, title, section });
  // Sesión.
  const session = sessionLabel({ chunkId, title });
  // ¿Mostrar la sección?
  const showSection = section.trim().length > 0 && section !== title && section !== session;
  // Tarjeta escalonada.
  return (
    <li
      className={shown ? "citation t-stagger is-shown" : "citation t-stagger"}
      style={{ "--cite-index": `${String(Math.min(index, 6) * 40)}ms` } as CSSProperties}
      title={chunkId}
    >
      {/* Cabecera. */}
      <div className="citation-head">
        {/* Etiquetas. */}
        <p className="chip-row t-stagger-line t-stagger-line--1">
          {/* Tipo o sesión. */}
          <span className={`chip chip-${kind}`}>
            {/* Texto. */}
            {kind === "session" && session !== null ? session : KIND_LABEL[kind]}
          </span>
          {/* Sesión aparte si no es de tipo sesión. */}
          {kind !== "session" && session !== null ? (
            <span className="chip chip-session">{session}</span>
          ) : null}
          {/* Sección. */}
          {showSection ? <span className="chip chip-note">{section}</span> : null}
        </p>
        {/* Título. */}
        <p className="citation-title t-stagger-line t-stagger-line--2">{title}</p>
      </div>
      {/* Cuerpo que se oculta al hacer scroll. */}
      <div
        ref={bodyRef}
        className={
          hiding ? "citation-body t-stagger is-hiding" : "citation-body t-stagger is-shown"
        }
      >
        {/* Extracto. */}
        <p className="citation-excerpt t-stagger-line">{friendlyExcerpt(excerpt)}</p>
      </div>
    </li>
  );
}

// Texto del origen de una respuesta.
function originLabel(origin: string): string {
  // Proveedor.
  if (origin === "provider") {
    // Texto.
    return "Proveedor";
  }
  // Otro origen tal cual.
  return origin;
}

// Mensaje de error de red más claro.
function visibleError(message: string): string {
  // Normalizado.
  const folded = message.trim().toLowerCase();
  // Errores típicos de red del navegador.
  if (
    folded === "failed to fetch" ||
    folded === "load failed" ||
    folded.startsWith("networkerror")
  ) {
    // Mensaje claro.
    return "No se ha podido comprobar el envío. Comprueba la conexión.";
  }
  // Mensaje original.
  return message;
}

// Mensaje de un error del servidor (JSON dentro del texto).
function readableError(error: Error): string {
  // Texto.
  const raw = error.message.trim();
  // ¿Contiene JSON?
  const start = raw.indexOf("{");
  // Sí.
  if (start >= 0) {
    // JSON inválido: texto.
    try {
      // JSON.
      const parsed: unknown = JSON.parse(raw.slice(start));
      // Con message.
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "message" in parsed &&
        typeof parsed.message === "string"
      ) {
        // Mensaje.
        return parsed.message;
      }
    } catch {
      // Texto.
      return raw || "La solicitud ha fallado.";
    }
  }
  // Texto o genérico.
  return raw || "La solicitud ha fallado.";
}

// Texto de un mensaje (une sus partes de texto).
function partText(message: CourseUIMessage): string {
  // Partes de texto unidas.
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

// Nota de la capacidad según /api/health.
function capabilityNote(status: string | undefined): string {
  // Según el estado.
  switch (status) {
    // Demo sin modelo.
    case "offline-demo":
      // Texto.
      return "Demostración local, sin modelo";
    // Canalización de prueba.
    case "offline-fixture":
      // Texto.
      return "Canalización local de prueba";
    // Proveedor listo.
    case "ready":
      // Texto.
      return "Proveedor configurado";
    // Bloqueado.
    case "blocked":
      // Texto.
      return "Falta configuración";
    // Otro.
    default:
      // Texto.
      return "No implementado";
  }
}

// Selector segmentado con una píldora que se desliza a la opción elegida.
function SegmentedChoice<T extends string>({
  legend,
  name,
  value,
  options,
  disabled,
  onChange,
}: {
  // Leyenda.
  legend: string;
  // Nombre del grupo de radios.
  name: string;
  // Valor elegido.
  value: T;
  // Opciones.
  options: readonly { id: T; label: string; title?: string }[];
  // Deshabilitado.
  disabled: boolean;
  // Al cambiar.
  onChange: (id: T) => void;
}) {
  // Barra.
  const barRef = useRef<HTMLDivElement>(null);
  // Píldora.
  const pillRef = useRef<HTMLSpanElement>(null);
  // ¿Ya se pintó una vez?
  const seen = useRef(false);

  // Coloca la píldora sobre la opción marcada.
  const placePill = useCallback((animate: boolean) => {
    // Barra.
    const bar = barRef.current;
    // Píldora.
    const pill = pillRef.current;
    // Falta alguna.
    if (bar === null || pill === null) {
      // Nada.
      return;
    }
    // Opción marcada.
    const active = bar.querySelector<HTMLElement>(".segment:has(input:checked)");
    // Ninguna.
    if (active === null) {
      // Nada.
      return;
    }
    // Escribe posición y ancho.
    const write = () => {
      // Posición.
      pill.style.transform = `translateX(${String(active.offsetLeft)}px)`;
      // Ancho.
      pill.style.width = `${String(active.offsetWidth)}px`;
    };
    // Sin animación.
    if (!animate) {
      // Transición previa.
      const previous = pill.style.transition;
      // Sin transición.
      pill.style.transition = "none";
      // Coloca.
      write();
      // Reflow.
      void pill.offsetWidth;
      // Restaura.
      pill.style.transition = previous;
      // Sale.
      return;
    }
    // Con animación.
    write();
  }, []);

  // Recoloca al cambiar el valor (sin animar la primera vez).
  useLayoutEffect(() => {
    // Coloca.
    placePill(seen.current);
    // Ya pintada.
    seen.current = true;
  }, [placePill, value, disabled, options]);

  // Recoloca sin animar al cambiar el tamaño.
  useEffect(() => {
    // Barra.
    const bar = barRef.current;
    // Sin barra.
    if (bar === null) {
      // Nada.
      return;
    }
    // Recolocar.
    const snap = () => {
      // Sin animación.
      placePill(false);
    };
    // Observa el tamaño.
    const observer = new ResizeObserver(snap);
    // De la barra.
    observer.observe(bar);
    // Y del documento.
    observer.observe(document.documentElement);
    // Y de la ventana.
    window.addEventListener("resize", snap);
    // Limpieza.
    return () => {
      // Deja de observar.
      observer.disconnect();
      // Quita el oyente.
      window.removeEventListener("resize", snap);
    };
  }, [placePill]);

  // Grupo de radios.
  return (
    <fieldset className="choice" disabled={disabled}>
      {/* Leyenda. */}
      <legend>{legend}</legend>
      {/* Barra. */}
      <div className="t-tabs" ref={barRef}>
        {/* Píldora. */}
        <span className="t-tabs-pill" ref={pillRef} aria-hidden="true" />
        {/* Una opción por elemento. */}
        {options.map((option) => (
          <label key={option.id} className="segment" title={option.title}>
            {/* Radio. */}
            <input
              type="radio"
              name={name}
              value={option.id}
              aria-label={option.title ?? option.label}
              checked={value === option.id}
              onChange={() => {
                // Avisa.
                onChange(option.id);
              }}
            />
            {/* Texto. */}
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// Métrica o por qué no la hay.
function metric(value: number | null | undefined, offline: boolean): string {
  // Demo: no medido.
  if (offline) {
    // Texto.
    return "no medido";
  }
  // Valor o desconocido.
  return value === undefined || value === null ? "desconocido" : String(value);
}

// Coste o por qué no lo hay.
function costLabel(cost: { amount: number } | null, offline: boolean): string {
  // Sin coste.
  if (cost === null) {
    // Demo: no medido; real: desconocido.
    return offline ? "no medido" : "desconocido";
  }
  // Importe.
  return String(cost.amount);
}

// Mensaje del asistente con nota de origen, consumo y coste.
function AssistantMessage({ message }: { message: CourseUIMessage }) {
  // Metadatos.
  const metadata = message.metadata;
  // ¿Demo?
  const offline = metadata?.origin === "offline-demo" || metadata?.origin === "offline-fixture";
  // ¿Terminado?
  const settled = metadata !== undefined && metadata.completion !== "streaming";
  // Mensaje.
  return (
    <article className="message message-assistant">
      {/* Respuesta. */}
      <CourseAnswer text={partText(message)} />
      {/* Nota al terminar. */}
      {settled && metadata !== undefined ? (
        <RunNote
          summary={`${originLabel(metadata.origin)}. Estado: ${metadata.completion}.`}
          detail={`Uso entrada: ${metric(metadata.usage?.inputTokens, offline)}. Uso salida: ${metric(metadata.usage?.outputTokens, offline)}. Coste: ${costLabel(metadata.cost, offline)}.`}
        />
      ) : null}
    </article>
  );
}

// Panel de chat de una etapa y un grupo.
function ChatPane({
  mode,
  audience,
  allowScenario,
  onBusy,
}: {
  // Etapa.
  mode: ChatMode;
  // Grupo.
  audience: Audience;
  // Si se pueden elegir escenarios.
  allowScenario: boolean;
  // Avisa de si está ocupado.
  onBusy: (busy: boolean) => void;
}) {
  // Turnstile.
  const {
    container: verificationContainer,
    ready: verificationReady,
    error: verificationError,
    beforeSend,
    reset: resetVerification,
    retry: retryVerification,
  } = useTurnstile();
  // Error de envío.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // ¿Verificando?
  const [verifying, setVerifying] = useState(false);
  // Escenario CRAG.
  const [scenario, setScenario] = useState<DemoScenarioId | null>(null);
  // Pasos CRAG en directo.
  const [liveSteps, setLiveSteps] = useState<CragStep[]>([]);
  // Escenario de investigación.
  const [researchScenario, setResearchScenario] = useState<ResearchScenarioId | null>(null);
  // Pasos de investigación en directo.
  const [researchSteps, setResearchSteps] = useState<ResearchStep[]>([]);
  // Escenario CRAG efectivo.
  const selectedScenario = allowScenario && mode === "crag" ? scenario : null;
  // Escenario de investigación efectivo.
  const selectedResearch = allowScenario && mode === "research" ? researchScenario : null;
  // Transporte HTTP de useChat con el cuerpo del curso.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<CourseUIMessage>({
        api: "/api/chat",
        fetch: async (url, init) => {
          // Petición.
          const response = await fetch(url, init);
          // Error HTTP.
          if (!response.ok) {
            // Cuerpo.
            const body = (await response.json().catch(() => null)) as { message?: string } | null;
            // Error con el mensaje del servidor.
            throw new Error(body?.message ?? `La petición respondió HTTP ${response.status}.`);
          }
          // Respuesta.
          return response;
        },
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            mode,
            audience,
            // La investigación de la fase 1 no tiene memoria: solo envía la última pregunta.
            messages: (mode === "research" ? messages.slice(-1) : messages).map((message) => ({
              // Solo texto: las tarjetas y trazas no se reenvían al servidor.
              id: message.id,
              role: message.role,
              parts: [{ type: "text", text: partText(message) }],
            })),
            // Guiones de demo, solo si se eligieron.
            ...(selectedScenario === null ? {} : { demoScenario: selectedScenario }),
            ...(selectedResearch === null ? {} : { researchScenario: selectedResearch }),
          },
        }),
      }),
    // useMemo recrea el transporte solo si cambia el modo, el grupo o un guion.
    [mode, audience, selectedScenario, selectedResearch],
  );
  // useChat: mensajes, envío, estado, parada y errores.
  const { messages, sendMessage, status, stop, error, clearError, setMessages } =
    useChat<CourseUIMessage>({
      transport,
      onData: (part) => {
        // Paso CRAG.
        if (part.type === "data-step") {
          // Lo añade (máximo 16).
          setLiveSteps((current) => [...current, part.data].slice(-16));
        }
        // Paso de investigación.
        if (part.type === "data-research-step") {
          // Lo añade (máximo 40).
          setResearchSteps((current) => [...current, part.data].slice(-40));
        }
      },
    });
  // Texto del formulario.
  const [input, setInput] = useState("");
  // Textarea.
  const questionRef = useRef<HTMLTextAreaElement>(null);
  // ¿Ocupado?
  const busy = verifying || status === "submitted" || status === "streaming";
  // Avisa al padre.
  useEffect(() => {
    // Estado.
    onBusy(busy);
    // Limpieza.
    return () => {
      // Libre.
      onBusy(false);
    };
  }, [busy, onBusy]);
  // Última respuesta.
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  // Sus fuentes.
  const sources = lastAssistant?.parts.filter((part) => part.type === "data-source") ?? [];
  // Su traza.
  const trace = lastAssistant?.parts.find((part) => part.type === "data-trace");
  // Resumen CRAG.
  const cragPart = lastAssistant?.parts.find((part) => part.type === "data-crag");
  // Datos CRAG.
  const crag = cragPart?.type === "data-crag" ? cragPart.data : null;
  // Resumen de investigación.
  const researchPart = lastAssistant?.parts.find((part) => part.type === "data-research");
  // Datos de investigación.
  const research = researchPart?.type === "data-research" ? researchPart.data : null;
  // Fuentes de investigación.
  const researchSources =
    lastAssistant?.parts.flatMap((part) =>
      part.type === "data-research-source" ? [part.data] : [],
    ) ?? [];
  // ¿Respuesta pendiente?
  const answerPending = busy || lastAssistant?.metadata?.completion === "streaming";
  // Fuentes visibles.
  const visibleSources = mode === "research" ? researchSources.length : sources.length;
  // ¿Esqueleto de fuentes?
  const sourcesLoading = mode !== "sin-rag" && visibleSources === 0 && answerPending;
  // ¿Esqueleto de traza?
  const traceLoading =
    answerPending &&
    (mode === "crag"
      ? crag === null && liveSteps.length === 0
      : mode === "research"
        ? research === null && researchSteps.length === 0
        : trace?.type !== "data-trace");

  // Envía la pregunta con un token nuevo de Turnstile.
  async function sendQuestion() {
    // Texto.
    const text = input.trim();
    // Vacío, ocupado o sin verificación.
    if (text.length === 0 || busy || !verificationReady) {
      // Nada.
      return;
    }
    // Sin error.
    setSubmitError(null);
    // Verificando.
    setVerifying(true);
    // try/catch/finally: error visible y token renovado.
    try {
      // Token.
      const verificationToken = await beforeSend();
      // Limpia el error de useChat.
      clearError();
      // Limpia los pasos.
      setLiveSteps([]);
      // Limpia los pasos.
      setResearchSteps([]);
      // Vacía el formulario.
      setInput("");
      // Envía con la cabecera del token.
      await sendMessage(
        { text },
        { headers: verificationToken ? { "x-turnstile-token": verificationToken } : {} },
      );
    } catch (caught: unknown) {
      // Error visible.
      setSubmitError(caught instanceof Error ? caught.message : "No se pudo enviar la pregunta.");
    } finally {
      // Fin de la verificación.
      setVerifying(false);
      // Pide otro token.
      resetVerification();
    }
  }

  // Envío del formulario.
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Evita recargar.
    event.preventDefault();
    // Envía.
    void sendQuestion();
  }

  // Enter envía; Mayús+Enter salta de línea.
  function onQuestionKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Otra tecla, Mayús o composición de texto (IME).
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      // Nada.
      return;
    }
    // Evita el salto.
    event.preventDefault();
    // Envía.
    void sendQuestion();
  }

  // Etiqueta del estado.
  const statusLabel = conversationStatus(status, mode);
  // ¿Hay respuestas? Entonces se muestra el panel lateral.
  const showRail = messages.some((message) => message.role === "assistant");
  // Error visible.
  const alertMessage = verificationError ?? submitError;
  // Ajusta la altura del textarea al texto (máximo 140 px).
  useLayoutEffect(() => {
    // Nodo.
    const node = questionRef.current;
    // Sin nodo.
    if (node === null) {
      // Nada.
      return;
    }
    // Altura automática.
    node.style.height = "auto";
    // Altura del contenido con tope.
    node.style.height = `${String(Math.min(node.scrollHeight, 140))}px`;
  }, [input]);

  // Diseño con o sin panel lateral.
  return (
    <div className={showRail ? "layout" : "layout layout-single"}>
      {/* Conversación. */}
      <section className="conversation" aria-label="Conversación">
        {/* Mensajes. */}
        <div className="transcript" aria-live="polite">
          {/* Cada mensaje. */}
          {messages.map((message) => (
            <PanelSlide key={message.id}>
              {/* Respuesta o pregunta. */}
              {message.role === "assistant" ? (
                <AssistantMessage message={message} />
              ) : (
                <article className="message message-user">
                  {/* Pregunta. */}
                  <p>{partText(message)}</p>
                </article>
              )}
            </PanelSlide>
          ))}
        </div>
        {/* Error de useChat. */}
        {error === undefined ? null : <ChatError message={readableError(error)} />}
        {/* Formulario. */}
        <form className="composer" onSubmit={onSubmit}>
          {/* Selector de guion CRAG. */}
          {mode === "crag" && allowScenario ? (
            <label className="composer-script" htmlFor="guion-crag">
              Guion
              <select
                id="guion-crag"
                value={scenario ?? ""}
                disabled={busy || !acceptScenarioChange(busy)}
                onChange={(event) => {
                  // Ocupado.
                  if (!acceptScenarioChange(busy)) {
                    // Nada.
                    return;
                  }
                  // Valor.
                  const next = event.target.value;
                  // Sin guion.
                  if (next === "") {
                    // Libre.
                    setScenario(null);
                    // Vacía la conversación.
                    setMessages([]);
                    // Vacía los pasos.
                    setLiveSteps([]);
                    // Sale.
                    return;
                  }
                  // Escenario.
                  const found = DEMO_CRAG_SCENARIOS.find((item) => item.id === next);
                  // Desconocido.
                  if (found === undefined) {
                    // Nada.
                    return;
                  }
                  // Lo elige.
                  setScenario(found.id);
                  // Rellena su pregunta.
                  setInput(found.question);
                  // Vacía la conversación.
                  setMessages([]);
                  // Vacía los pasos.
                  setLiveSteps([]);
                }}
              >
                {/* Sin guion. */}
                <option value="">Libre, con el índice lexical de prueba</option>
                {/* Un guion por escenario. */}
                {DEMO_CRAG_SCENARIOS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {/* Nombre. */}
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {/* Selector de guion de investigación. */}
          {mode === "research" && allowScenario ? (
            <label className="composer-script" htmlFor="guion-investigacion">
              Guion
              <select
                id="guion-investigacion"
                value={researchScenario ?? ""}
                disabled={busy || !acceptScenarioChange(busy)}
                onChange={(event) => {
                  // Ocupado.
                  if (!acceptScenarioChange(busy)) {
                    // Nada.
                    return;
                  }
                  // Escenario.
                  const found = DEMO_RESEARCH_SCENARIOS.find(
                    (item) => item.id === event.target.value,
                  );
                  // Lo elige.
                  setResearchScenario(found?.id ?? null);
                  // Si existe.
                  if (found !== undefined) {
                    // Rellena su pregunta.
                    setInput(found.question);
                  }
                  // Vacía la conversación.
                  setMessages([]);
                  // Vacía los pasos.
                  setResearchSteps([]);
                }}
              >
                {/* Sin guion. */}
                <option value="">Libre, con el material del curso de prueba</option>
                {/* Un guion por escenario. */}
                {DEMO_RESEARCH_SCENARIOS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {/* Nombre. */}
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {/* Aviso de la investigación sin trabajo durable. */}
          {mode === "research" ? (
            <p className="composer-caption">
              Se ejecuta mientras la petición sigue abierta. No es un trabajo en segundo plano ni
              recuerda turnos anteriores.
            </p>
          ) : null}
          {/* Línea de estado bajo el formulario: error, actividad, ejemplo o nueva conversación. */}
          <p className="composer-caption">
            {/* Según el estado. */}
            {alertMessage !== null ? (
              <span role="alert">
                {/* Error. */}
                {visibleError(alertMessage)}
                {/* Reintentar la verificación. */}
                {verificationError !== null ? (
                  <button className="caption-action" type="button" onClick={retryVerification}>
                    Reintentar
                  </button>
                ) : null}
              </span>
            ) : busy ? (
              <span className="conversation-status" role="status">
                {/* Indicador de carga. */}
                <span className="status-loader">
                  {/* Matriz. */}
                  <MatrixLoader variant="scan" />
                </span>
                {/* Estado. */}
                <ThinkStatus label={statusLabel} live />
              </span>
            ) : messages.length === 0 ? (
              <button
                className="caption-action"
                type="button"
                onClick={() => {
                  // Ocupado.
                  if (!acceptScenarioChange(busy)) {
                    // Nada.
                    return;
                  }
                  // Sin guion CRAG.
                  setScenario(null);
                  // Sin guion de investigación.
                  setResearchScenario(null);
                  // Pregunta de ejemplo.
                  setInput(EXAMPLES[mode]);
                  // Foco en el textarea.
                  questionRef.current?.focus();
                }}
              >
                {/* Ejemplo. */}
                {EXAMPLES[mode]}
              </button>
            ) : (
              <button
                className="caption-action"
                type="button"
                onClick={() => {
                  // Limpia el error.
                  clearError();
                  // Vacía la conversación.
                  setMessages([]);
                  // Vacía el texto.
                  setInput("");
                }}
              >
                Nueva conversación
              </button>
            )}
          </p>
          {/* Caja de la pregunta. */}
          <div className="composer-pill">
            {/* Textarea. */}
            <textarea
              id="pregunta"
              ref={questionRef}
              aria-label="Pregunta"
              rows={1}
              value={input}
              onChange={(event) => {
                // Texto.
                const next = event.target.value;
                // Lo guarda.
                setInput(next);
                // Ocupado.
                if (!acceptScenarioChange(busy)) {
                  // Nada.
                  return;
                }
                // Si el texto ya no es el del guion CRAG, lo quita.
                setScenario((current) => {
                  // Escenario.
                  const selected = DEMO_CRAG_SCENARIOS.find((item) => item.id === current);
                  // Se conserva solo si coincide.
                  return selected !== undefined && selected.question === next ? current : null;
                });
                // Lo mismo con el guion de investigación.
                setResearchScenario((current) => {
                  // Escenario.
                  const selected = DEMO_RESEARCH_SCENARIOS.find((item) => item.id === current);
                  // Se conserva solo si coincide.
                  return selected !== undefined && selected.question === next ? current : null;
                });
              }}
              placeholder="Escribe una pregunta"
              onKeyDown={onQuestionKeyDown}
            />
            {/* Detener o enviar. */}
            {busy ? (
              // Mientras responde: botón para cortar el stream.
              <button className="send" type="button" onClick={() => void stop()}>
                Detener
              </button>
            ) : (
              // En reposo: enviar, desactivado sin verificación o sin texto.
              <button
                className="send"
                type="submit"
                disabled={!verificationReady || input.trim().length === 0}
              >
                Enviar
              </button>
            )}
          </div>
          {/* Contenedor del widget de Turnstile. */}
          <div ref={verificationContainer} aria-label="Verificación de seguridad" />
        </form>
      </section>
      {/* Panel lateral. */}
      {showRail ? (
        <PanelSlide as="aside" className="panel">
          {/* Zona con scroll. */}
          <div className="panel-scroll">
            {/* Fuentes. */}
            <section className="sources-section">
              {/* Título fijo. */}
              <h2 className="sources-sticky">Fuentes</h2>
              {/* Según la etapa. */}
              {mode === "sin-rag" ? (
                <p>Sin fuentes. Este modo no recupera documentos.</p>
              ) : mode === "research" ? (
                <RevealSlot
                  loading={sourcesLoading}
                  label="Fuentes"
                  skeleton={
                    <>
                      {/* Línea de esqueleto. */}
                      <span className="skel-line skel-line-short" />
                      {/* Línea. */}
                      <span className="skel-line" />
                    </>
                  }
                >
                  {/* Fuentes de investigación. */}
                  <ResearchSources sources={researchSources} />
                </RevealSlot>
              ) : (
                <RevealSlot
                  loading={sourcesLoading}
                  label="Fuentes"
                  skeleton={
                    <>
                      {/* Línea. */}
                      <span className="skel-line skel-line-short" />
                      {/* Línea. */}
                      <span className="skel-line" />
                      {/* Línea. */}
                      <span className="skel-line skel-line-mid" />
                    </>
                  }
                >
                  {/* Sin fuentes o con su lista. */}
                  {sources.length === 0 ? (
                    <p>Sin fuentes en esta respuesta.</p>
                  ) : (
                    <ul className="citations">
                      {/* Una tarjeta por fuente. */}
                      {sources.map((source, index) =>
                        // Solo las partes de tipo data-source son fuentes citables.
                        source.type === "data-source" ? (
                          // La clave es el id del fragmento: estable entre renders.
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
            {/* Traza. */}
            <section>
              {/* Título. */}
              <h2>Traza de la clase</h2>
              {/* Traza con esqueleto mientras carga. */}
              <RevealSlot
                loading={traceLoading}
                label="Traza de la clase"
                skeleton={
                  <>
                    {/* Línea. */}
                    <span className="skel-line skel-line-mid" />
                    {/* Línea. */}
                    <span className="skel-line" />
                  </>
                }
              >
                {/* Según la etapa. */}
                {mode === "research" ? (
                  research === null ? (
                    <div aria-live="polite">
                      {/* Aviso. */}
                      <p>La traza completa aparece con el resultado.</p>
                      {/* Pasos en directo. */}
                      <ResearchSteps steps={researchSteps} />
                    </div>
                  ) : (
                    <PanelSlide>
                      {/* Traza completa. */}
                      <ResearchTrace summary={research} />
                    </PanelSlide>
                  )
                ) : mode === "crag" ? (
                  <div>
                    {/* Resumen CRAG. */}
                    {crag === null ? (
                      <p>La traza aparece con la respuesta.</p>
                    ) : (
                      <PanelSlide>
                        {/* Resumen. */}
                        <div>
                          {/* Resultado. */}
                          <p className="trace-summary">
                            {/* Origen, final y motivo. */}
                            {crag.fixture ? "Guion de prueba." : "Recorrido real."} {crag.terminal}.{" "}
                            {crag.reason}
                          </p>
                          {/* Detalles. */}
                          <ul className="trace-list">
                            {/* Búsquedas. */}
                            <li>
                              Búsquedas {crag.retrievalCount}. Quedan {crag.attemptsRemaining}.
                            </li>
                            {/* Reformulaciones. */}
                            <li>
                              Reformulaciones {crag.reformulationCount}. Quedan{" "}
                              {crag.rewritesRemaining}.
                            </li>
                            {/* Consumo sin totales inventados. */}
                            <li>
                              {/* Llamadas de pago: medidas una a una, nunca un total inventado. */}
                              Llamadas de pago:{" "}
                              {crag.measured
                                ? "contadas por separado, sin total inventado"
                                : "no medidas"}
                              . Uso: {/* Uso de tokens: desconocido, no medido o parcial. */}
                              {crag.usage === null
                                ? crag.measured
                                  ? "desconocido"
                                  : "no medido"
                                : "parcial"}
                              . Coste: {/* Coste: importe o por qué no se conoce. */}
                              {crag.cost === null
                                ? crag.measured
                                  ? "desconocido"
                                  : "no medido"
                                : crag.cost.amount}
                              .
                            </li>
                            {/* Pregunta original. */}
                            <li>Consulta original: {crag.originalQuestion}</li>
                            {/* Consulta actual. */}
                            <li>Consulta de búsqueda: {crag.currentQuery}</li>
                            {/* Conservados. */}
                            {crag.retained.map((item, index) => (
                              <li key={retainedRowKey(item.chunkId, index)}>
                                Conservado {item.chunkId}
                                {item.score === null ? "" : ` (${item.score.toFixed(3)})`}:{" "}
                                {item.reason}
                              </li>
                            ))}
                            {/* Descartados. */}
                            {crag.discarded.map((item, index) => (
                              <li key={discardedRowKey(item, index)}>
                                Descartado {item.chunkId}, intento {item.attempt}: {item.reason}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </PanelSlide>
                    )}
                    {/* Pasos en directo. */}
                    {liveSteps.length === 0 ? null : (
                      <ol className="steps" aria-live="polite" aria-label="Pasos del grafo">
                        {/* Un paso por línea. */}
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
                    {/* Traza del RAG. */}
                    <ul className="trace-list">
                      {/* Consulta. */}
                      <li>Consulta: {trace.data.query}</li>
                      {/* Reescritura. */}
                      <li>
                        {/* Contexto completo o pendiente. */}
                        {trace.data.queryRewrite === "context-complete"
                          ? "El modelo dispone del contexto completo del grupo y del historial para interpretar seguimientos."
                          : "Reescritura de seguimiento: pendiente."}
                      </li>
                      {/* Significado de la puntuación. */}
                      <li>{trace.data.scoreMeaning}</li>
                      {/* Fragmentos recuperados. */}
                      {trace.data.retrieved.map((item) => (
                        <li key={item.chunkId}>
                          {item.chunkId}:{" "}
                          {item.score === null ? "puntuación desconocida" : item.score.toFixed(3)}{" "}
                          {item.selected ? "seleccionado" : "descartado"}
                        </li>
                      ))}
                      {/* Decisión y generación. */}
                      <li>
                        Decisión: {trace.data.decision}. Generación: {trace.data.generation}.
                      </li>
                      {/* Estado. */}
                      <li>{trace.data.status}</li>
                    </ul>
                  </PanelSlide>
                ) : (
                  <p>
                    {/* Sin traza. */}
                    {mode === "sin-rag"
                      ? // Mensaje según el modo.
                        "Sin RAG no recupera ni puntúa documentos."
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

// Aplicación: barra de etapa y grupo, y el panel que corresponde.
export function App() {
  // Etapa.
  const [mode, setMode] = useState<ChatMode>("sin-rag");
  // Grupo.
  const [audience, setAudience] = useState<Audience>("program");
  // Contador para reiniciar la conversación.
  const [epoch, setEpoch] = useState(0);
  // ¿Ocupado?
  const [busy, setBusy] = useState(false);
  // Salud del servidor.
  const [health, setHealth] = useState<HealthResponse | null>(null);
  // Callback estable.
  const onBusy = useCallback((value: boolean) => {
    // Actualiza.
    setBusy(value);
  }, []);

  // Lee /api/health al montar.
  useEffect(() => {
    // Controlador.
    const controller = new AbortController();
    // Petición.
    void fetch("/api/health", { signal: controller.signal })
      .then(async (response) => {
        // Error HTTP.
        if (!response.ok) {
          // Error.
          throw new Error(`El estado del servidor respondió HTTP ${String(response.status)}.`);
        }
        // Valida con el esquema.
        const parsed = healthResponseSchema.safeParse(await response.json());
        // Inválida.
        if (!parsed.success) {
          // Error.
          throw new Error("La respuesta de salud no cumple el contrato.");
        }
        // Guarda.
        setHealth(parsed.data);
      })
      .catch(() => undefined);
    // Limpieza.
    return () => {
      // Cancela.
      controller.abort();
    };
  }, []);

  // Cambia de etapa o grupo (nunca con una respuesta en curso).
  function choose(nextMode: ChatMode, nextAudience: Audience) {
    // Ocupado o sin cambios.
    if (busy || (nextMode === mode && nextAudience === audience)) {
      // Nada.
      return;
    }
    // Etapa.
    setMode(nextMode);
    // Grupo.
    setAudience(nextAudience);
    // Conversación nueva.
    setEpoch((value) => value + 1);
  }

  // Página.
  return (
    <main className="shell">
      {/* Cabecera. */}
      <header className="masthead">
        {/* Título. */}
        <h1>The Power RAG, CRAG e investigación</h1>
        {/* Descripción. */}
        <p>
          Clases 10, 11 y 12. Las cuatro etapas consultan el mismo material del curso: el temario de
          las sesiones 1 a 20, los ejercicios documentados y el calendario de cada grupo. La
          investigación añade un plan acotado, documentación técnica externa y un informe con
          fuentes.
        </p>
      </header>
      {/* Barra de herramientas. */}
      <div className="toolbar">
        {/* Etapa. */}
        <div>
          {/* Selector de etapa. */}
          <SegmentedChoice
            legend="Etapa"
            name="stage"
            value={mode}
            options={STAGES}
            disabled={busy}
            onChange={(nextMode) => {
              // Cambia.
              choose(nextMode, audience);
            }}
          />
          {/* Estado de la etapa. */}
          <p className="stage-note">{capabilityNote(health?.capabilities[mode].status)}</p>
        </div>
        {/* Grupo. */}
        <div>
          {/* Selector de grupo. */}
          <SegmentedChoice
            legend="Grupo del curso"
            name="audience"
            value={audience}
            options={AUDIENCES}
            disabled={busy}
            onChange={(nextAudience) => {
              // Cambia.
              choose(mode, nextAudience);
            }}
          />
          {/* Leyenda de los grupos. */}
          <p className="group-note">L/X, lunes y miércoles. M/J, martes y jueves.</p>
        </div>
      </div>
      {/* Investigación durable o chat, con clave para reiniciar al cambiar. */}
      {health?.durableResearch && mode === "research" ? (
        // Con investigación durable configurada: la mesa de investigación.
        <ResearchDesk
          key={audience}
          audience={audience}
          allowScenario={health.execution === "demo"}
          onBusy={onBusy}
        />
      ) : (
        // En el resto de modos: el chat.
        <ChatPane
          key={conversationKey(mode, audience, epoch)}
          mode={mode}
          audience={audience}
          allowScenario={health?.execution === "demo"}
          onBusy={onBusy}
        />
      )}
    </main>
  );
}
