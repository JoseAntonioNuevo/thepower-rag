// GUÍA DE LECTURA · apps/web/src/App.tsx
// Interfaz principal: elige etapa (sin RAG, RAG, CRAG o investigación), conversa con useChat del AI SDK
// contra /api/chat y enseña al lado las fuentes citadas, la traza y el grafo CRAG.
// Recorrido de un envío: verificación Turnstile → sendMessage → flujo SSE → mensajes, fuentes y traza.
// useChat gestiona mensajes, envío y streaming.
import { useChat } from "@ai-sdk/react";
// Escenarios de demo, esquema de salud y tipos del contrato.
import {
  // Guiones de investigación y la pregunta de demo.
  DEMO_RESEARCH_QUESTION,
  DEMO_RESEARCH_SCENARIOS,
  // Esquema para validar /api/health.
  healthResponseSchema,
  // Tipos de grupo, modo, pasos y guiones.
  type Audience,
  type ChatMode,
  type CragStep,
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
// Biblioteca de documentos y fragmentos de D1.
import { CorpusBrowser } from "./corpus-browser";
// Modo clase: tipos de los pasos y grafo en directo.
import type { ClassEvent } from "./class-mode";
import { ClassModeView, type ClassModels } from "./class-mode-view";
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

// Grupo de todas las conversaciones: la aplicación ya no separa por grupos.
const AUDIENCE: Audience = "program";

// Pregunta de ejemplo de cada etapa con el material del curso.
const EXAMPLES: Record<ChatMode, string> = {
  "sin-rag": "¿Qué es un embedding?",
  rag: "¿Qué vemos en la sesión 10?",
  crag: "¿Qué cambia CRAG respecto a una sola búsqueda?",
  research: DEMO_RESEARCH_QUESTION,
};

// Preguntas de ejemplo con la tienda ThePower Shop. Son casos de demostración, nunca del test de 20.
// La investigación usa su propia pregunta de demostración.
const STORE_EXAMPLES: Record<ChatMode, string> = {
  "sin-rag": "¿Cuántos días tengo para devolver un pedido en ThePower Shop?",
  rag: "¿A partir de qué importe es gratis el envío estándar a la península?",
  crag: "Devolví en un punto ThePower Shop un pedido que pagué con Bizum. ¿Cuánto puede tardar en llegarme el dinero?",
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
  examples,
  allowScenario,
  onBusy,
  classMode,
  models,
  slow,
  onSlowChange,
}: {
  // Etapa.
  mode: ChatMode;
  // Grupo.
  audience: Audience;
  // Preguntas de ejemplo del corpus del chat; null mientras no se sabe qué corpus consulta.
  examples: Record<ChatMode, string> | null;
  // Si se pueden elegir escenarios.
  allowScenario: boolean;
  // Avisa de si está ocupado.
  onBusy: (busy: boolean) => void;
  // Si se muestra el grafo del modo clase.
  classMode: boolean;
  // Modelos que nombra el grafo.
  models: ClassModels;
  // Modo lento del grafo.
  slow: boolean;
  // Cambia el modo lento.
  onSlowChange: (slow: boolean) => void;
}) {
  // Turnstile.
  const {
    container: verificationContainer,
    ready: verificationReady,
    pending: verifying,
    error: verificationError,
    beforeSend,
    cancel: cancelVerification,
    retry: retryVerification,
  } = useTurnstile();
  // Error de envío.
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Cerrojo síncrono: dos eventos antes del siguiente render no pueden enviar dos preguntas.
  const submitting = useRef(false);
  // Pasos CRAG en directo.
  const [liveSteps, setLiveSteps] = useState<CragStep[]>([]);
  // Pasos del modo clase (RAG y CRAG) con su instante de llegada.
  const [classEvents, setClassEvents] = useState<ClassEvent[]>([]);
  // Instante del envío, para medir cuándo llega cada paso.
  const sentAt = useRef(0);
  // Turno del modo clase: cambia en cada envío para que el grafo vuelva al directo.
  const [classTurn, setClassTurn] = useState(0);
  // Escenario de investigación.
  const [researchScenario, setResearchScenario] = useState<ResearchScenarioId | null>(null);
  // Pasos de investigación en directo.
  const [researchSteps, setResearchSteps] = useState<ResearchStep[]>([]);
  // Escenario de investigación efectivo.
  const selectedResearch = allowScenario && mode === "research" ? researchScenario : null;
  // Transporte HTTP de useChat con el cuerpo del curso.
  const transport = useMemo(
    () =>
      new DefaultChatTransport<CourseUIMessage>({
        api: "/api/chat",
        // Atiende la petición HTTP con el adaptador y el entorno de este recorrido.
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
        // Construye el cuerpo del envío con etapa, grupo y mensajes de la conversación actual.
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
            ...(selectedResearch === null ? {} : { researchScenario: selectedResearch }),
          },
        }),
      }),
    // useMemo recrea el transporte solo si cambia el modo, el grupo o un guion.
    [mode, audience, selectedResearch],
  );
  // useChat: mensajes, envío, estado, parada y errores.
  const { messages, sendMessage, status, stop, error, clearError, setMessages } =
    useChat<CourseUIMessage>({
      transport,
      // Incorpora al estado visual las partes de datos que llegan por el stream del chat.
      onData: (part) => {
        // Paso CRAG.
        if (part.type === "data-step") {
          // Lo añade (máximo 16).
          setLiveSteps((current) => [...current, part.data].slice(-16));
          // Y al grafo del modo clase, con su instante (máximo 40).
          const at = performance.now() - sentAt.current;
          setClassEvents((current) =>
            [...current, { stage: "crag" as const, at, step: part.data }].slice(-40),
          );
        }
        // Paso del RAG básico para el modo clase.
        if (part.type === "data-rag-step") {
          // Instante de llegada.
          const at = performance.now() - sentAt.current;
          // Lo añade (máximo 40).
          setClassEvents((current) =>
            [...current, { stage: "rag" as const, at, step: part.data }].slice(-40),
          );
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
    if (text.length === 0 || busy || submitting.current || !verificationReady) {
      // Nada.
      return;
    }
    // Sin error.
    setSubmitError(null);
    // Mantiene la exclusión desde la verificación hasta el final del stream.
    submitting.current = true;
    // Un fallo de verificación conserva el borrador y nunca inserta un mensaje en el chat.
    try {
      // Token.
      const verificationToken = await beforeSend();
      // Limpia el error de useChat.
      clearError();
      // Limpia los pasos.
      setLiveSteps([]);
      // Limpia los pasos del modo clase y empieza a medir desde aquí.
      setClassEvents([]);
      setClassTurn((current) => current + 1);
      sentAt.current = performance.now();
      // Limpia los pasos.
      setResearchSteps([]);
      // Conserva cualquier borrador que se haya editado durante la espera.
      setInput((current) => (current.trim() === text ? "" : current));
      // Envía con la cabecera del token.
      await sendMessage(
        { text },
        { headers: verificationToken ? { "x-turnstile-token": verificationToken } : {} },
      );
    } catch (caught: unknown) {
      // Error visible.
      setSubmitError(caught instanceof Error ? caught.message : "No se pudo enviar la pregunta.");
    } finally {
      // El siguiente desafío solo se iniciará con otra intención de envío.
      submitting.current = false;
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
  const statusLabel = verifying ? "Verificando antes de enviar…" : conversationStatus(status, mode);
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

  // Diseño con o sin panel lateral, y el grafo del modo clase encima en RAG y CRAG.
  return (
    <>
      {/* Grafo en directo y repetición paso a paso. */}
      {classMode && (mode === "rag" || mode === "crag") ? (
        <ClassModeView
          key={classTurn}
          stage={mode}
          events={classEvents}
          live={busy}
          models={models}
          slow={slow}
          onSlowChange={onSlowChange}
        />
      ) : null}
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
                  <option value="">Libre, con las políticas de la tienda de prueba</option>
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
            <div className="composer-caption">
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
                <div className="conversation-status" role="status">
                  {/* Indicador de carga. */}
                  <div className="status-loader">
                    {/* Matriz. */}
                    <MatrixLoader variant="scan" />
                  </div>
                  {/* Estado. */}
                  <ThinkStatus label={statusLabel} live />
                </div>
              ) : messages.length === 0 ? (
                // Sin corpus conocido todavía, ningún ejemplo (ni del curso ni de la tienda).
                examples === null ? null : (
                  <button
                    className="caption-action"
                    type="button"
                    onClick={() => {
                      // Ocupado.
                      if (!acceptScenarioChange(busy)) {
                        // Nada.
                        return;
                      }
                      // Sin guion de investigación.
                      setResearchScenario(null);
                      // Pregunta de ejemplo del corpus del chat.
                      setInput(examples[mode]);
                      // Foco en el textarea.
                      questionRef.current?.focus();
                    }}
                  >
                    {/* Ejemplo. */}
                    {examples[mode]}
                  </button>
                )
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
            </div>
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
                  // Si el texto ya no es el del guion de investigación, lo quita.
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
                // Antes del envío cancela la verificación; después, detiene el stream.
                <button
                  className="send"
                  type="button"
                  onClick={(event) => {
                    // El mismo nodo puede volver a type=submit durante este clic: evita su acción por defecto.
                    event.preventDefault();
                    if (verifying) cancelVerification();
                    else void stop();
                  }}
                >
                  {verifying ? "Cancelar envío" : "Detener"}
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
                              {crag.fixture ? "Guion de prueba." : "Recorrido real."}{" "}
                              {crag.terminal}. {crag.reason}
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
    </>
  );
}

// Opción activada por la URL (?clase, ?lento), para dejarla lista antes de proyectar.
function flagFromUrl(name: string): boolean {
  // Sin ventana (pruebas): apagada.
  if (typeof window === "undefined") {
    return false;
  }
  // Parámetro presente.
  return new URLSearchParams(window.location.search).has(name);
}

// Aplicación: barra de etapa y el panel que corresponde.
export function App() {
  // Etapa.
  const [mode, setMode] = useState<ChatMode>("sin-rag");
  // Contador para reiniciar la conversación.
  const [epoch, setEpoch] = useState(0);
  // ¿Ocupado?
  const [busy, setBusy] = useState(false);
  // Salud del servidor.
  const [health, setHealth] = useState<HealthResponse | null>(null);
  // Si /api/health falló: la página se enseña sin saber qué corpus consulta el chat.
  const [healthFailed, setHealthFailed] = useState(false);
  // Modo clase: grafo en directo encima del chat.
  const [classMode, setClassMode] = useState(() => flagFromUrl("clase") || flagFromUrl("lento"));
  // Modo lento del grafo: un paso cada pocos segundos, aunque lleguen antes.
  const [slowMode, setSlowMode] = useState(() => flagFromUrl("lento"));
  // Pantalla: el chat o la biblioteca de documentos (también con ?documentos).
  const [screen, setScreen] = useState<"chat" | "library">(() =>
    flagFromUrl("documentos") ? "library" : "chat",
  );
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
      .catch(() => {
        // Cancelada al desmontar: nada.
        if (controller.signal.aborted) return;
        // Sin estado del servidor.
        setHealthFailed(true);
      });
    // Limpieza.
    return () => {
      // Cancela.
      controller.abort();
    };
  }, []);

  // Corpus del chat. Solo lo dice /api/health; hasta que responde es null, para no enseñar durante
  // ese medio segundo textos del curso (ni de la tienda).
  const chatCorpus =
    health === null ? null : health.chatCorpus?.id === "thepower-shop" ? "thepower-shop" : "course";
  // ¿El chat consulta la tienda?
  const store = chatCorpus === "thepower-shop";
  // Cabecera en espera: ocupa su sitio, invisible, hasta saber el corpus (o hasta que falle /api/health).
  const mastheadPending = chatCorpus === null && !healthFailed;
  // Cambia de etapa (nunca con una respuesta en curso).
  function choose(nextMode: ChatMode) {
    // Ocupado o sin cambios.
    if (busy || nextMode === mode) {
      // Nada.
      return;
    }
    // Etapa.
    setMode(nextMode);
    // Conversación nueva.
    setEpoch((value) => value + 1);
  }

  // Página.
  return (
    <main className="shell">
      {/* Cabecera. */}
      {/* En espera lleva el texto de la tienda, invisible, para reservar su alto sin saltos. */}
      <header
        className="masthead"
        data-pending={mastheadPending ? "true" : undefined}
        aria-busy={mastheadPending}
      >
        {/* Título. */}
        <h1>
          {chatCorpus === "course"
            ? "The Power RAG, CRAG e investigación"
            : chatCorpus === null && healthFailed
              ? "RAG, CRAG e investigación"
              : "ThePower Shop: RAG, CRAG e investigación"}
        </h1>
        {/* Descripción según el corpus del chat. */}
        {chatCorpus === null && healthFailed ? (
          <p>
            No se pudo leer el estado del servidor, así que no se sabe qué material consulta el
            chat. Recarga la página para volver a intentarlo.
          </p>
        ) : chatCorpus !== "course" ? (
          <p>
            Sin RAG, RAG básico y CRAG consultan las políticas de ThePower Shop, una tienda en línea
            ficticia: devoluciones, envíos, pagos, garantías y vendedores. La investigación añade la
            consulta de un pedido, la normativa de consumo y la foto o la nota de voz del cliente.
          </p>
        ) : // Con el curso, solo el título: sin descripción de clases.
        null}
      </header>
      {/* Biblioteca de documentos: sustituye a la barra y al chat, que siguen montados y ocultos. */}
      {screen === "library" ? (
        <CorpusBrowser
          onClose={() => {
            setScreen("chat");
          }}
        />
      ) : null}
      {/* Chat y barra: ocultos (no desmontados) mientras se ve la biblioteca. */}
      <div hidden={screen === "library"}>
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
                choose(nextMode);
              }}
            />
            {/* Estado de la etapa. */}
            <p className="stage-note">{capabilityNote(health?.capabilities[mode].status)}</p>
          </div>
          {/* Acceso a la biblioteca de documentos y fragmentos de la base de datos. */}
          <div className="library-open">
            <button
              type="button"
              className="class-button"
              disabled={busy}
              onClick={() => {
                setScreen("library");
              }}
            >
              Ver documentos y fragmentos
            </button>
          </div>
          {/* Modo clase: solo en las etapas con grafo. */}
          {mode === "rag" || mode === "crag" ? (
            <div className="class-switch">
              {/* Interruptor con rebote de transitions.dev. */}
              <button
                type="button"
                role="switch"
                className="t-toggle"
                aria-checked={classMode}
                aria-labelledby="modo-clase-etiqueta"
                data-on={classMode ? "true" : "false"}
                onClick={(event) => {
                  // Activa los fotogramas solo tras la primera interacción.
                  event.currentTarget.classList.add("is-init");
                  // Alterna.
                  setClassMode((current) => !current);
                }}
              >
                {/* Pulgar. */}
                <span className="t-toggle-thumb" />
              </button>
              {/* Etiqueta. */}
              <span id="modo-clase-etiqueta">Modo clase: grafo en directo</span>
            </div>
          ) : null}
        </div>
        {/* Investigación durable o chat, con clave para reiniciar al cambiar. */}
        {health?.durableResearch && mode === "research" ? (
          // Con investigación durable configurada: la mesa de investigación.
          <ResearchDesk allowScenario={health.execution === "demo"} onBusy={onBusy} />
        ) : (
          // En el resto de modos: el chat.
          <ChatPane
            key={conversationKey(mode, AUDIENCE, epoch)}
            mode={mode}
            audience={AUDIENCE}
            examples={chatCorpus === null ? null : store ? STORE_EXAMPLES : EXAMPLES}
            allowScenario={health?.execution === "demo"}
            onBusy={onBusy}
            classMode={classMode}
            slow={slowMode}
            onSlowChange={setSlowMode}
            models={{
              embedding: health?.corpus.embedding ?? null,
              generator: health?.modelConfiguration?.generator ?? null,
              evaluator: health?.modelConfiguration?.evaluator ?? null,
            }}
          />
        )}
      </div>
    </main>
  );
}
