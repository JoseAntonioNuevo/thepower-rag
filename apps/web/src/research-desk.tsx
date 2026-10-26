// GUÍA DE LECTURA · apps/web/src/research-desk.tsx
// Mesa de investigación durable en el navegador sobre ThePower Shop: conversaciones, pregunta con imagen, audio y voz
// opcionales, envío protegido con Turnstile, sondeo del trabajo, informe con fuentes, traza y presupuesto.
// El trabajo sigue en el Worker aunque se cierre la página; al volver se recupera desde la conversación.
// Pregunta y escenarios de demo; tipos de escenario, fuente y resumen.
import {
  DEMO_RESEARCH_QUESTION,
  DEMO_RESEARCH_SCENARIOS,
  type ResearchScenarioId,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
// Hooks de React.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
// Componentes de movimiento compartidos con el chat.
import { ChatError, MatrixLoader, PanelSlide, RevealSlot } from "./chat-motion-view";
// Duración leída de las variables CSS.
import { readCssMs } from "./chat-motion";
// Respuesta con el Markdown reducido de la aplicación.
import { CourseAnswer } from "./course-answer";
// Fuentes y traza de la investigación.
import { ResearchSources, ResearchTrace } from "./research-panel";
// Envío protegido y cerrojo.
import { createSubmitGate, submitResearch, type SubmitGate } from "./research-submit";
// Verificación con Turnstile.
import { useTurnstile } from "./use-turnstile";

// Conversación de la lista.
interface ConversationItem {
  // Id.
  id: string;
}

// Estado de un trabajo según /api/research/jobs/:id.
interface JobView {
  // Id.
  jobId: string;
  // Conversación.
  conversationId: string;
  // Ejecución.
  execution: string;
  // Resultado del informe.
  reportOutcome: string | null;
  // Motivo de atención.
  attention: string | null;
  // Progreso.
  progress: string | null;
  // Eventos.
  events: { seq: number; text: string }[];
}

// Clave de la sesión del navegador con la conversación elegida.
const CONVERSATION_KEY = "research-conversation";

// Texto de cada estado de ejecución.
const EXECUTION_LABEL: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  complete: "Ejecución terminada",
  cancelled: "Cancelación registrada",
  attention: "Hace falta revisión",
  failed: "Fallo de ejecución",
};

// Escenario de interrupción recuperable (solo para demostrar la recuperación).
const RECOVERY_SCENARIO = {
  id: "crash-after-plan" as const,
  label: "Interrupción recuperable tras el plan",
  question: DEMO_RESEARCH_QUESTION,
};

// Resultado guardado de un trabajo.
interface ResultPayload {
  // Resumen.
  summary?: ResearchSummary;
  // Fuentes.
  sources?: ResearchSource[];
  // Informe.
  report?: { text?: string } | null;
  // Disponibilidad del informe.
  reportAvailability?: string;
}

// Texto del informe o nota de por qué no está.
function shownReport(payload: ResultPayload | null): { text: string | null; note: string | null } {
  // Registro antiguo sin informe.
  if (payload?.reportAvailability === "legacy-missing") {
    // Nota.
    return {
      text: null,
      note: "Este resultado se guardó sin el texto del informe. No se reconstruye desde la memoria.",
    };
  }
  // Artefacto perdido.
  if (payload?.reportAvailability === "missing-artifact") {
    // Nota.
    return {
      text: null,
      note: "El informe guardado no está disponible. No se vuelve a generar.",
    };
  }
  // Informe disponible.
  if (typeof payload?.report?.text === "string" && payload.report.text.length > 0) {
    // Texto.
    return { text: payload.report.text, note: null };
  }
  // Sin informe.
  return { text: null, note: null };
}

// Tono visual de cada estado de ejecución (color del punto y del borde).
const EXECUTION_TONE: Record<string, string> = {
  queued: "live",
  running: "live",
  complete: "ok",
  cancelled: "muted",
  attention: "warn",
  failed: "bad",
};

// Presupuesto de la sesión según /api/research/budget.
interface BudgetView {
  // Reservado.
  reserved: string;
  // Consumido.
  consumed: string;
  // Desconocido.
  unknown: string;
  // Nota.
  note: string;
}

// Tamaño legible de un archivo.
function formatBytes(size: number): string {
  // Menos de 1 KB.
  if (size < 1024) {
    // Bytes.
    return `${String(size)} B`;
  }
  // Menos de 1 MB.
  if (size < 1024 * 1024) {
    // KB.
    return `${(size / 1024).toFixed(1)} KB`;
  }
  // MB.
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// Icono de 16 px con trazo (imagen, audio, más, cerrar, enviar, parar, recuperar).
function Icon({
  name,
}: {
  name: "image" | "audio" | "plus" | "close" | "send" | "stop" | "retry";
}) {
  // Trazos de cada icono.
  const paths: Record<typeof name, string> = {
    image: "M2.5 3.5h11v9h-11zM2.5 10.5l3-3 3 3 2-2 3 3M10.5 6.5h.01",
    audio: "M6 12V4l7-1.5v8M6 12a2 2 0 1 1-2-2 2 2 0 0 1 2 2zM13 10.5a2 2 0 1 1-2-2 2 2 0 0 1 2 2z",
    plus: "M8 3v10M3 8h10",
    close: "M4 4l8 8M12 4l-8 8",
    send: "M3 8h10M9 4l4 4-4 4",
    stop: "M4.5 4.5h7v7h-7z",
    retry: "M3 8a5 5 0 1 0 1.5-3.5M3 3v2.5h2.5",
  };
  // SVG decorativo.
  return (
    <svg className="icon" viewBox="0 0 16 16" aria-hidden="true">
      {/* Trazo. */}
      <path d={paths[name]} />
    </svg>
  );
}

// Línea de estado que cambia con fundido y, si está viva, con brillo que recorre el texto.
function StatusLine({ text, shimmer = false }: { text: string; shimmer?: boolean }) {
  // Nodo.
  const ref = useRef<HTMLSpanElement>(null);
  // Cambia el texto con animación.
  useEffect(() => {
    // Nodo.
    const element = ref.current;
    // Sin nodo.
    if (element === null) {
      // Nada.
      return;
    }
    // Mismo texto.
    if (element.textContent === text) {
      // Nada.
      return;
    }
    // ¿Menos movimiento?
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Primera vez o sin animación: directo.
    if (element.textContent === "" || reduce) {
      // Texto.
      element.textContent = text;
      // Copia para la capa del brillo.
      element.dataset.text = text;
      // Sale.
      return;
    }
    // Animación de salida.
    element.classList.add("is-exit");
    // Tras la duración del cambio de texto.
    const timer = window.setTimeout(
      () => {
        // Texto nuevo.
        element.textContent = text;
        // Copia para la capa del brillo.
        element.dataset.text = text;
        // Quita la salida.
        element.classList.remove("is-exit");
        // Prepara la entrada.
        element.classList.add("is-enter-start");
        // Reflow.
        void element.offsetHeight;
        // Entra.
        element.classList.remove("is-enter-start");
      },
      readCssMs("--text-swap-dur", 150),
    );
    // Limpieza.
    return () => {
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [text]);
  // Contenedor del texto.
  return <span ref={ref} className={shimmer ? "t-text-swap t-shimmer" : "t-text-swap"} />;
}

// Sección plegable: la altura crece con grid-template-rows y el chevrón se voltea.
function Accordion({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  // Título.
  title: string;
  // Número opcional junto al título.
  count?: number;
  // ¿Abierta al montar?
  defaultOpen?: boolean;
  // Contenido.
  children: ReactNode;
}) {
  // ¿Abierta?
  const [open, setOpen] = useState(defaultOpen);
  // Id del panel.
  const panelId = useId();
  // Contenedor.
  return (
    <div className="t-acc desk-acc" data-open={open ? "true" : "false"}>
      {/* Cabecera que abre y cierra. */}
      <button
        type="button"
        className="t-acc-head"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          // Alterna.
          setOpen((current) => !current);
        }}
      >
        {/* Título. */}
        <span className="desk-acc-title">{title}</span>
        {/* Contador. */}
        {count === undefined ? null : <span className="desk-count">{count}</span>}
        {/* Chevrón. */}
        <span className="t-acc-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16">
            <path d="M4 6.5L8 10.5L12 6.5" />
          </svg>
        </span>
      </button>
      {/* Pista de la rejilla. */}
      <div className="t-acc-panel" id={panelId}>
        {/* Interior con el relleno (inerte si está cerrada). */}
        <div className="t-acc-panel-inner" inert={!open}>
          {/* Contenido. */}
          <div className="desk-acc-body">{children}</div>
        </div>
      </div>
    </div>
  );
}

// JSON de una respuesta o null.
async function readJson(response: Response): Promise<unknown> {
  // Sin JSON: null.
  return response.json().catch(() => null);
}

// Mensaje de error del cuerpo o uno por defecto.
function messageOf(body: unknown, fallback: string): string {
  // Cuerpo con message de texto.
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    // Mensaje.
    return body.message;
  }
  // Por defecto.
  return fallback;
}

// Mesa de investigación.
export function ResearchDesk({
  allowScenario,
  onBusy,
}: {
  // Si se pueden elegir escenarios de prueba.
  allowScenario: boolean;
  // Avisa de si hay un trabajo en curso.
  onBusy: (busy: boolean) => void;
}) {
  // Conversaciones del propietario.
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  // Conversación seleccionada.
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Escenario elegido.
  const [scenarioId, setScenarioId] = useState<ResearchScenarioId | null>(null);
  // Pregunta.
  const [question, setQuestion] = useState("");
  // Voz pedida.
  const [voice, setVoice] = useState(false);
  // Imagen elegida.
  const [imageFile, setImageFile] = useState<File | null>(null);
  // Audio elegido.
  const [audioFile, setAudioFile] = useState<File | null>(null);
  // URL local de la imagen.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  // URL local del audio.
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Clave de idempotencia de la imagen.
  const imageKey = useRef<string | null>(null);
  // Clave del audio.
  const audioKey = useRef<string | null>(null);
  // Input de la imagen.
  const imageInput = useRef<HTMLInputElement>(null);
  // Input del audio.
  const audioInput = useRef<HTMLInputElement>(null);
  // URL de la imagen para liberarla.
  const imageUrlRef = useRef<string | null>(null);
  // URL del audio para liberarla.
  const audioUrlRef = useRef<string | null>(null);
  // Generación: cambia al cambiar de conversación.
  const generation = useRef(0);
  // Cerrojo de envíos.
  const submission = useRef<SubmitGate | null>(null);
  // Se crea una sola vez.
  if (submission.current === null) {
    // Cerrojo.
    submission.current = createSubmitGate();
  }
  // Cerrojo.
  const submitGate = submission.current;
  // Trabajo actual.
  const [job, setJob] = useState<JobView | null>(null);
  // Resumen.
  const [summary, setSummary] = useState<ResearchSummary | null>(null);
  // Fuentes.
  const [sources, setSources] = useState<ResearchSource[]>([]);
  // Informe.
  const [reportText, setReportText] = useState<string | null>(null);
  // Nota del informe.
  const [reportNote, setReportNote] = useState<string | null>(null);
  // Aviso visible.
  const [notice, setNotice] = useState<string | null>(null);
  // Presupuesto.
  const [budget, setBudget] = useState<BudgetView | null>(null);
  // Clave del trabajo.
  const idempotency = useRef<string | null>(null);
  // Turnstile.
  const {
    container: verificationContainer,
    ready: verificationReady,
    pending: verificationPending,
    error: verificationError,
    beforeSend,
    cancel: cancelVerification,
    retry: retryVerification,
  } = useTurnstile();

  // Lee el estado del presupuesto.
  async function refreshBudget() {
    // GET /api/research/budget.
    const response = await fetch("/api/research/budget");
    // Cuerpo.
    const body = (await readJson(response)) as {
      // Reservado.
      reserved?: string;
      // Desconocido.
      unknown?: string;
      // Consumido.
      consumed?: string;
      // Nota.
      note?: string;
    } | null;
    // Correcto.
    if (response.ok && body?.reserved) {
      // Presupuesto por partes.
      setBudget({
        reserved: body.reserved,
        consumed: body.consumed ?? "",
        unknown: body.unknown ?? "",
        note: body.note ?? "",
      });
    }
  }

  // Carga las conversaciones y elige la guardada o la primera.
  const loadConversations = useCallback(async (preferred: string | null) => {
    // GET /api/research/conversations.
    const response = await fetch("/api/research/conversations");
    // Cuerpo.
    const body = (await readJson(response)) as { conversations?: ConversationItem[] } | null;
    // Conversaciones del propietario.
    const mine = body?.conversations ?? [];
    // Guarda.
    setConversations(mine);
    // Conversación preferida o guardada en la sesión.
    const stored = preferred ?? sessionStorage.getItem(CONVERSATION_KEY);
    // La elegida.
    const selected = mine.find((item) => item.id === stored) ?? mine[0] ?? null;
    // La selecciona.
    setConversationId(selected?.id ?? null);
    // Si hay.
    if (selected) {
      // La recuerda.
      sessionStorage.setItem(CONVERSATION_KEY, selected.id);
    }
  }, []);

  // Al montar: sesión, conversaciones y presupuesto.
  useEffect(() => {
    // ¿Desmontado?
    let ignore = false;
    // Tarea asíncrona.
    void (async () => {
      // Sesión.
      const session = await fetch("/api/research/session");
      // Fallo o desmontado.
      if (!session.ok || ignore) {
        // Nada.
        return;
      }
      // Conversaciones.
      await loadConversations(null);
      // Presupuesto.
      await refreshBudget();
    })();
    // Limpieza.
    return () => {
      // Ignora resultados tardíos.
      ignore = true;
    };
  }, [loadConversations]);

  // Al desmontar, libera las URL locales.
  useEffect(() => {
    // Limpieza.
    return () => {
      // Imagen.
      if (imageUrlRef.current)
        // Libera la URL temporal del adjunto para que el navegador pueda recuperar su memoria.
        URL.revokeObjectURL(imageUrlRef.current);
      // Audio.
      if (audioUrlRef.current)
        // Libera la URL temporal del adjunto para que el navegador pueda recuperar su memoria.
        URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  // Quita imagen, audio y voz del formulario.
  function clearLocalMedia() {
    // Sin imagen.
    setImageFile(null);
    // Sin audio.
    setAudioFile(null);
    // Libera la URL.
    replaceImageUrl(null);
    // Libera la URL.
    replaceAudioUrl(null);
    // Sin clave.
    imageKey.current = null;
    // Sin clave.
    audioKey.current = null;
    // Vacía el input.
    if (imageInput.current)
      // Vacía el selector del adjunto para permitir volver a elegir el mismo archivo.
      imageInput.current.value = "";
    // Vacía el input.
    if (audioInput.current)
      // Vacía el selector del adjunto para permitir volver a elegir el mismo archivo.
      audioInput.current.value = "";
    // Sin voz.
    setVoice(false);
  }

  // Sustituye la URL local de la imagen.
  function replaceImageUrl(file: File | null) {
    // URL nueva o null.
    const next = file ? URL.createObjectURL(file) : null;
    // Libera la anterior.
    if (imageUrlRef.current)
      // Libera la URL temporal del adjunto para que el navegador pueda recuperar su memoria.
      URL.revokeObjectURL(imageUrlRef.current);
    // Guarda.
    imageUrlRef.current = next;
    // Estado.
    setImageUrl(next);
  }

  // Sustituye la URL local del audio.
  function replaceAudioUrl(file: File | null) {
    // URL nueva o null.
    const next = file ? URL.createObjectURL(file) : null;
    // Libera la anterior.
    if (audioUrlRef.current)
      // Libera la URL temporal del adjunto para que el navegador pueda recuperar su memoria.
      URL.revokeObjectURL(audioUrlRef.current);
    // Guarda.
    audioUrlRef.current = next;
    // Estado.
    setAudioUrl(next);
  }

  // Al cambiar de conversación, carga su último trabajo y su resultado.
  useEffect(() => {
    // Sin conversación.
    if (!conversationId) {
      // Nada.
      return;
    }
    // ¿Desmontado?
    let ignore = false;
    // Tarea asíncrona.
    void (async () => {
      // Limpia el informe.
      setReportText(null);
      // Limpia la nota.
      setReportNote(null);
      // Limpia el resumen.
      setSummary(null);
      // Limpia las fuentes.
      setSources([]);
      // Mensajes.
      const response = await fetch(`/api/research/conversations/${conversationId}`);
      // Cuerpo.
      const body = (await readJson(response)) as {
        // Mensajes.
        messages?: { role: string; job_id: string | null; text: string }[];
      } | null;
      // Último mensaje con trabajo.
      const last = [...(body?.messages ?? [])].reverse().find((message) => message.job_id);
      // Sin trabajo o desmontado.
      if (ignore || !last?.job_id) {
        // Nada.
        return;
      }
      // Estado del trabajo.
      const status = await fetch(`/api/research/jobs/${last.job_id}`);
      // Vista.
      const view = (await readJson(status)) as JobView | null;
      // Válida.
      if (!ignore && view && "execution" in view) {
        // La guarda.
        setJob({ ...view, events: view.events ?? [] });
      }
      // Con resultado.
      if (view?.reportOutcome) {
        // Resultado.
        const result = await fetch(`/api/research/jobs/${last.job_id}/result`);
        // Cuerpo.
        const payload = (await readJson(result)) as ResultPayload | null;
        // Con resumen.
        if (!ignore && payload?.summary) {
          // Informe o nota.
          const shown = shownReport(payload);
          // Resumen.
          setSummary(payload.summary);
          // Fuentes.
          setSources(payload.sources ?? []);
          // Informe.
          setReportText(shown.text);
          // Nota.
          setReportNote(shown.note);
        }
      }
    })();
    // Limpieza.
    return () => {
      // Ignora.
      ignore = true;
    };
  }, [conversationId]);

  // Sondea el trabajo cada 800 ms mientras siga en curso.
  useEffect(() => {
    // Sin trabajo o terminado.
    if (
      job === null ||
      job.execution === "complete" ||
      job.execution === "cancelled" ||
      job.execution === "failed" ||
      job.execution === "attention"
    ) {
      // Nada.
      return;
    }
    // Intervalo.
    const timer = window.setInterval(() => {
      // Sondea desde el último evento.
      void poll(job.jobId, job.events.at(-1)?.seq ?? 0);
    }, 800);
    // Limpieza.
    return () => {
      // Para.
      window.clearInterval(timer);
    };
  }, [job]);

  // Avisa al padre de si hay un trabajo en curso.
  useEffect(() => {
    // Ocupado si está en cola o en curso.
    onBusy(job?.execution === "queued" || job?.execution === "running");
    // Limpieza.
    return () => {
      // Libre.
      onBusy(false);
    };
  }, [job, onBusy]);

  // Lee el estado y, si terminó, el resultado.
  async function poll(jobId: string, after: number) {
    // Estado con eventos nuevos.
    const response = await fetch(`/api/research/jobs/${jobId}?after=${String(after)}`);
    // Cuerpo.
    const body = (await readJson(response)) as JobView | null;
    // Inválido.
    if (!response.ok || body === null || !("execution" in body)) {
      // Nada.
      return;
    }
    // Añade los eventos nuevos.
    setJob((current) =>
      current && current.jobId === body.jobId
        ? {
            ...body,
            events: [...current.events, ...body.events.filter((event) => event.seq > after)],
          }
        : body,
    );
    // Terminado.
    if (body.execution === "complete" || body.reportOutcome) {
      // Resultado.
      const result = await fetch(`/api/research/jobs/${jobId}/result`);
      // Correcto.
      if (result.ok) {
        // Cuerpo.
        const payload = (await readJson(result)) as ResultPayload | null;
        // Con resumen.
        if (payload?.summary) {
          // Informe o nota.
          const shown = shownReport(payload);
          // Resumen.
          setSummary(payload.summary);
          // Fuentes.
          setSources(payload.sources ?? []);
          // Informe.
          setReportText(shown.text);
          // Nota.
          setReportNote(shown.note);
        }
      }
      // Presupuesto.
      await refreshBudget();
    }
  }

  // Cabeceras de una mutación con el token de Turnstile.
  async function mutationHeaders(jsonBody: boolean): Promise<Record<string, string> | null> {
    // Un fallo de verificación se muestra como aviso.
    try {
      // Token.
      const token = await beforeSend();
      // Cabeceras.
      return {
        ...(jsonBody ? { "content-type": "application/json" } : {}),
        ...(token ? { "x-turnstile-token": token } : {}),
      };
    } catch (caught: unknown) {
      // Aviso.
      setNotice(caught instanceof Error ? caught.message : "No se pudo verificar el envío.");
      // null.
      return null;
    }
  }

  // Crea una conversación nueva.
  async function createConversation() {
    // Nueva generación.
    generation.current += 1;
    // Sin aviso.
    setNotice(null);
    // Cabeceras.
    const headers = await mutationHeaders(true);
    // Sin verificación.
    if (headers === null) {
      // Nada.
      return;
    }
    // POST /api/research/conversations.
    const response = await fetch("/api/research/conversations", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    // Cuerpo.
    const body = (await readJson(response)) as { id?: string; message?: string } | null;
    // Fallo.
    if (!response.ok || !body?.id) {
      // Aviso.
      setNotice(messageOf(body, "No se pudo crear la conversación."));
      // Sale.
      return;
    }
    // La recuerda.
    sessionStorage.setItem(CONVERSATION_KEY, body.id);
    // Limpia el formulario.
    clearLocalMedia();
    // Limpia el resumen.
    setSummary(null);
    // Limpia las fuentes.
    setSources([]);
    // Limpia el informe.
    setReportText(null);
    // Limpia la nota.
    setReportNote(null);
    // Sin trabajo.
    setJob(null);
    // Recarga y la selecciona.
    await loadConversations(body.id);
  }

  // Envía el trabajo: sube los archivos, pide el trabajo y empieza a sondear.
  async function submit() {
    // Sin conversación o sin nada que enviar.
    if (!conversationId || (question.trim().length === 0 && !imageFile && !audioFile)) {
      // Nada.
      return;
    }
    // Ya hay un envío en curso.
    if (!submitGate.enter())
      // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
      return;
    // Generación al empezar.
    const generationAtStart = generation.current;
    // Conversación al empezar.
    const conversationAtStart = conversationId;
    // Sin aviso.
    setNotice(null);
    // Limpia el resumen.
    setSummary(null);
    // Limpia las fuentes.
    setSources([]);
    // Limpia el informe.
    setReportText(null);
    // Limpia la nota.
    setReportNote(null);
    // Clave del trabajo (se conserva si hay que reintentar).
    idempotency.current ??= crypto.randomUUID();
    // Clave de la imagen.
    imageKey.current ??= imageFile ? crypto.randomUUID() : null;
    // Clave del audio.
    audioKey.current ??= audioFile ? crypto.randomUUID() : null;
    // Clave.
    const idempotencyKey = idempotency.current;
    // try/finally: libera el cerrojo.
    try {
      // Envío protegido.
      const result = await submitResearch({
        conversationId: conversationAtStart,
        question: question.trim(),
        scenarioId,
        voice,
        image: imageFile && imageKey.current ? { file: imageFile, key: imageKey.current } : null,
        audio: audioFile && audioKey.current ? { file: audioFile, key: audioKey.current } : null,
        idempotencyKey,
        generation: generationAtStart,
        // Lee la generación vigente de la conversación para descartar respuestas de un envío anterior.
        currentGeneration: () => generation.current,
        beforeSend,
      });
      // Cambió la conversación.
      if (generation.current !== generationAtStart) {
        // Aviso.
        setNotice("La conversación cambió. El envío no se ha mezclado.");
        // Sale.
        return;
      }
      // Fallo.
      if (!result.ok) {
        // Aviso.
        setNotice(result.message);
        // Sale.
        return;
      }
      // Envío hecho: nueva clave la próxima vez.
      idempotency.current = null;
      // Limpia el formulario.
      clearLocalMedia();
      // Vacía la pregunta.
      setQuestion("");
      // Trabajo nuevo en cola.
      setJob({
        jobId: result.jobId,
        conversationId: conversationAtStart,
        execution: result.execution,
        reportOutcome: null,
        attention: null,
        progress: null,
        events: [],
      });
    } finally {
      // Libera el cerrojo.
      submitGate.leave();
    }
  }

  // Cancela el trabajo actual.
  async function cancel() {
    // Sin trabajo.
    if (!job) {
      // Nada.
      return;
    }
    // Cabeceras.
    const headers = await mutationHeaders(false);
    // Sin verificación.
    if (headers === null) {
      // Nada.
      return;
    }
    // POST cancel.
    const response = await fetch(`/api/research/jobs/${job.jobId}/cancel`, {
      method: "POST",
      headers,
    });
    // Cuerpo.
    const body = await readJson(response);
    // Fallo.
    if (!response.ok) {
      // Aviso.
      setNotice(messageOf(body, "No se pudo cancelar."));
      // Sale.
      return;
    }
    // Relee el estado.
    await poll(job.jobId, 0);
  }

  // Pide recuperar el trabajo.
  async function recover() {
    // Sin trabajo.
    if (!job) {
      // Nada.
      return;
    }
    // Cabeceras.
    const headers = await mutationHeaders(false);
    // Sin verificación.
    if (headers === null) {
      // Nada.
      return;
    }
    // POST recover.
    const response = await fetch(`/api/research/jobs/${job.jobId}/recover`, {
      method: "POST",
      headers,
    });
    // Cuerpo.
    const body = await readJson(response);
    // Aviso con el resultado.
    setNotice(
      messageOf(body, response.ok ? "Recuperación registrada." : "Hace falta conciliación."),
    );
    // Relee el estado.
    await poll(job.jobId, 0);
  }

  // Texto del estado.
  const status =
    job === null
      ? "Sin trabajo activo"
      : job.execution === "attention" && job.attention === "recoverable"
        ? "Se puede recuperar"
        : job.execution === "attention" && job.attention === "reconciliation-required"
          ? "Hace falta conciliación"
          : (EXECUTION_LABEL[job.execution] ?? job.execution);
  // Detalle del estado.
  const detail =
    job?.attention === "recoverable"
      ? "Hay un checkpoint del mismo trabajo. Recuperar continúa sin otro plan ni otro plazo."
      : job?.attention === "reconciliation-required"
        ? "Hay una operación ambigua. No se reenvía ni se libera la reserva."
        : (job?.progress ?? "Puedes cerrar la página: el trabajo sigue hasta que lo canceles.");

  // Tono del estado.
  const tone = job === null ? "idle" : (EXECUTION_TONE[job.execution] ?? "idle");
  // ¿Trabajo vivo (en cola o en curso)?
  const live = tone === "live";
  // ¿Se puede enviar?
  const canSubmit =
    verificationReady &&
    conversationId !== null &&
    (question.trim().length > 0 || imageFile !== null || audioFile !== null);
  // ¿Se puede cancelar?
  const canCancel =
    verificationReady &&
    job !== null &&
    job.execution !== "complete" &&
    job.execution !== "cancelled";
  // ¿Se puede recuperar?
  const canRecover =
    verificationReady &&
    job !== null &&
    (job.execution === "queued" || job.execution === "running" || job.execution === "attention");
  // ¿El estado del trabajo admite alguna acción? Si no, no se muestran los botones.
  const jobActionable =
    job !== null && job.execution !== "complete" && job.execution !== "cancelled";
  // Últimos eventos del trabajo, del más antiguo al más reciente.
  const recentEvents = job?.events.slice(-6) ?? [];

  // Mesa.
  return (
    <div className="research-desk">
      {/* Tarjeta de la pregunta. */}
      <section className="desk-card" aria-labelledby="desk-title">
        {/* Cabecera con título, aviso y nueva conversación. */}
        <header className="desk-head">
          {/* Título y aviso. */}
          <div className="desk-heading">
            {/* Título. */}
            <h2 id="desk-title" className="desk-title">
              Investigación durable
            </h2>
            {/* Aviso de privacidad y duración. */}
            <p className="desk-caption">
              Conversación anónima de esta demostración. No es una cuenta de cliente. Cerrar la
              página no cancela el trabajo.
            </p>
          </div>
          {/* Nueva conversación. */}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void createConversation()}
            disabled={!verificationReady}
          >
            {/* Icono. */}
            <Icon name="plus" />
            Nueva conversación
          </button>
        </header>
        {/* Lista de conversaciones o invitación a crear una. */}
        {conversations.length > 0 ? (
          <div className="conversation-list" role="group" aria-label="Conversaciones">
            {/* Un botón por conversación. */}
            {conversations.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="conv-chip"
                aria-pressed={item.id === conversationId}
                onClick={() => {
                  // Nueva generación.
                  generation.current += 1;
                  // Selecciona.
                  setConversationId(item.id);
                  // La recuerda.
                  sessionStorage.setItem(CONVERSATION_KEY, item.id);
                  // Limpia el resumen.
                  setSummary(null);
                  // Limpia el informe.
                  setReportText(null);
                  // Limpia la nota.
                  setReportNote(null);
                  // Sin trabajo.
                  setJob(null);
                  // Limpia el formulario.
                  clearLocalMedia();
                }}
              >
                Conversación {index + 1}
              </button>
            ))}
          </div>
        ) : (
          <p className="desk-empty">Crea una conversación para empezar a investigar.</p>
        )}
        {/* Selector de guion de prueba. */}
        {allowScenario ? (
          <label className="desk-field" htmlFor="guion-durable">
            {/* Etiqueta. */}
            <span className="desk-field-label">Guion</span>
            <select
              id="guion-durable"
              value={scenarioId ?? ""}
              onChange={(event) => {
                // Escenario elegido.
                const found = [...DEMO_RESEARCH_SCENARIOS, RECOVERY_SCENARIO].find(
                  (item) => item.id === event.target.value,
                );
                // Lo guarda.
                setScenarioId(found?.id ?? null);
                // Si existe.
                if (found) {
                  // Rellena su pregunta.
                  setQuestion(found.question);
                }
              }}
            >
              {/* Sin guion. */}
              <option value="">Libre, con las políticas de la tienda de prueba</option>
              {/* Un guion por escenario. */}
              {[...DEMO_RESEARCH_SCENARIOS, RECOVERY_SCENARIO].map((item) => (
                <option key={item.id} value={item.id}>
                  {/* Nombre. */}
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {/* Formulario. */}
        <form
          className="desk-composer"
          onSubmit={(event) => {
            // Evita recargar.
            event.preventDefault();
            // Envía.
            void submit();
          }}
        >
          {/* Caja de la pregunta con sus herramientas. */}
          <div className="desk-input">
            {/* Pregunta. */}
            <textarea
              aria-label="Pregunta de investigación"
              placeholder="¿Qué quieres investigar? Puedes añadir una imagen o un audio."
              value={question}
              rows={3}
              onChange={(event) => {
                // Actualiza.
                setQuestion(event.target.value);
              }}
            />
            {/* Herramientas: archivos, voz y envío. */}
            <div className="desk-tools">
              {/* Imagen: la etiqueta hace de botón y el input queda oculto. */}
              <label className="btn-attach" data-active={imageFile ? "true" : "false"}>
                {/* Icono. */}
                <Icon name="image" />
                {/* Texto. */}
                <span>Imagen</span>
                <input
                  ref={imageInput}
                  className="visually-hidden"
                  aria-label="Imagen PNG o JPEG"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(event) => {
                    // Archivo.
                    const file = event.target.files?.[0] ?? null;
                    // Vacía el input para poder repetir.
                    event.target.value = "";
                    // Lo guarda.
                    setImageFile(file);
                    // Clave nueva.
                    imageKey.current = file ? crypto.randomUUID() : null;
                    // URL local.
                    replaceImageUrl(file);
                  }}
                />
              </label>
              {/* Audio. */}
              <label className="btn-attach" data-active={audioFile ? "true" : "false"}>
                {/* Icono. */}
                <Icon name="audio" />
                {/* Texto. */}
                <span>Audio WAV</span>
                <input
                  ref={audioInput}
                  className="visually-hidden"
                  aria-label="Audio WAV"
                  type="file"
                  accept="audio/wav,audio/wave,audio/x-wav"
                  onChange={(event) => {
                    // Archivo.
                    const file = event.target.files?.[0] ?? null;
                    // Vacía el input.
                    event.target.value = "";
                    // Lo guarda.
                    setAudioFile(file);
                    // Clave nueva.
                    audioKey.current = file ? crypto.randomUUID() : null;
                    // URL local.
                    replaceAudioUrl(file);
                  }}
                />
              </label>
              {/* Voz: interruptor con rebote. */}
              <span className="desk-voice">
                <button
                  type="button"
                  role="switch"
                  className="t-toggle"
                  aria-checked={voice}
                  aria-labelledby="voz-etiqueta"
                  data-on={voice ? "true" : "false"}
                  onClick={(event) => {
                    // Activa los fotogramas solo tras la primera interacción.
                    event.currentTarget.classList.add("is-init");
                    // Alterna.
                    setVoice((current) => !current);
                  }}
                >
                  {/* Pulgar. */}
                  <span className="t-toggle-thumb" />
                </button>
                {/* Etiqueta. */}
                <span id="voz-etiqueta">Generar voz</span>
              </span>
              {/* Enviar. */}
              <button type="submit" className="btn btn-primary desk-send" disabled={!canSubmit}>
                Investigar
                {/* Icono. */}
                <Icon name="send" />
              </button>
            </div>
          </div>
          {/* Adjuntos elegidos. */}
          {imageUrl || audioUrl ? (
            <div className="desk-attachments">
              {/* Vista previa de la imagen. */}
              {imageUrl ? (
                <PanelSlide className="attachment">
                  {/* Miniatura. */}
                  <img
                    className="attachment-thumb"
                    src={imageUrl}
                    alt="Vista previa de la imagen seleccionada"
                  />
                  {/* Nombre y tamaño. */}
                  <span className="attachment-text">
                    <span className="attachment-name">{imageFile?.name}</span>
                    <span className="attachment-size">
                      {imageFile ? formatBytes(imageFile.size) : ""}
                    </span>
                  </span>
                  {/* Quitar. */}
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Quitar imagen"
                    onClick={() => {
                      // Sin archivo.
                      setImageFile(null);
                      // Sin clave.
                      imageKey.current = null;
                      // Vacía el input.
                      if (imageInput.current)
                        // Vacía el selector del adjunto para permitir volver a elegir el mismo archivo.
                        imageInput.current.value = "";
                      // Libera la URL.
                      replaceImageUrl(null);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                </PanelSlide>
              ) : null}
              {/* Vista previa del audio. */}
              {audioUrl ? (
                <PanelSlide className="attachment attachment-audio">
                  {/* Nombre y tamaño. */}
                  <span className="attachment-text">
                    <span className="attachment-name">{audioFile?.name}</span>
                    <span className="attachment-size">
                      {audioFile ? formatBytes(audioFile.size) : ""}
                    </span>
                  </span>
                  {/* Quitar. */}
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label="Quitar audio"
                    onClick={() => {
                      // Sin archivo.
                      setAudioFile(null);
                      // Sin clave.
                      audioKey.current = null;
                      // Vacía el input.
                      if (audioInput.current)
                        // Vacía el selector del adjunto para permitir volver a elegir el mismo archivo.
                        audioInput.current.value = "";
                      // Libera la URL.
                      replaceAudioUrl(null);
                    }}
                  >
                    <Icon name="close" />
                  </button>
                  {/* Reproductor. */}
                  <audio className="media-audio" controls preload="none" src={audioUrl} />
                </PanelSlide>
              ) : null}
            </div>
          ) : null}
          {/* Contenedor del widget de Turnstile. */}
          {verificationPending ? (
            <p role="status">
              Verificando antes de continuar. Si aparece un desafío, complétalo.
              <button type="button" className="caption-action" onClick={cancelVerification}>
                Cancelar verificación
              </button>
            </p>
          ) : null}
          <div ref={verificationContainer} aria-label="Verificación de seguridad" />
        </form>
      </section>
      {/* Estado del trabajo con su tono, acciones y registro. */}
      <section className="desk-status" data-tone={tone} aria-label="Estado del trabajo">
        {/* Fila principal. */}
        <div className="desk-status-head">
          {/* Indicador: matriz viva o punto de color. */}
          {live ? (
            <span className="status-loader">
              {/* Matriz. */}
              <MatrixLoader variant="scan" />
            </span>
          ) : (
            <span className="status-dot" aria-hidden="true" />
          )}
          {/* Estado con fundido. */}
          <strong className="desk-status-label" role="status">
            <StatusLine text={status} shimmer={live} />
          </strong>
          {/* Acciones sobre el trabajo. */}
          {jobActionable ? (
            <span className="desk-status-actions">
              {/* Recuperar. */}
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => void recover()}
                disabled={!canRecover}
              >
                {/* Icono. */}
                <Icon name="retry" />
                Recuperar
              </button>
              {/* Cancelar. */}
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void cancel()}
                disabled={!canCancel}
              >
                {/* Icono. */}
                <Icon name="stop" />
                Cancelar trabajo
              </button>
            </span>
          ) : null}
        </div>
        {/* Detalle. */}
        <p className="desk-status-detail">{detail}</p>
        {/* Registro de los últimos eventos. */}
        {recentEvents.length > 0 ? (
          <ol className="desk-log" aria-label="Registro del trabajo">
            {/* Cada evento entra deslizándose. */}
            {recentEvents.map((event) => (
              <PanelSlide key={event.seq} as="li">
                {/* Número. */}
                <span className="desk-log-seq">{event.seq}</span>
                {/* Texto. */}
                <span>{event.text}</span>
              </PanelSlide>
            ))}
          </ol>
        ) : null}
      </section>
      {/* Error de verificación. */}
      {verificationError ? (
        <div>
          <ChatError message={verificationError} />
          <button type="button" className="caption-action" onClick={retryVerification}>
            Reintentar verificación
          </button>
        </div>
      ) : null}
      {/* Aviso. */}
      {notice ? <ChatError message={notice} /> : null}
      {/* Presupuesto. */}
      {budget ? (
        <section className="desk-budget" aria-label="Presupuesto de la sesión">
          {/* Tres cifras. */}
          <dl className="budget-grid">
            {/* Reservado. */}
            <div className="budget-tile">
              <dt>Reservado</dt>
              <dd>
                <StatusLine text={budget.reserved} />
              </dd>
            </div>
            {/* Consumido. */}
            <div className="budget-tile">
              <dt>Consumido</dt>
              <dd>
                <StatusLine text={budget.consumed} />
              </dd>
            </div>
            {/* Desconocido. */}
            <div className="budget-tile">
              <dt>Desconocido</dt>
              <dd>
                <StatusLine text={budget.unknown} />
              </dd>
            </div>
          </dl>
          {/* Nota. */}
          {budget.note ? <p className="research-meta">{budget.note}</p> : null}
        </section>
      ) : null}
      {/* Resultado: esqueleto mientras el trabajo sigue y revelado al terminar. */}
      {live || summary ? (
        <RevealSlot
          loading={summary === null}
          label="Resultado de la investigación"
          className="source-skel desk-result"
          skeleton={
            <div className="desk-result-skel">
              <span className="skel-line skel-line-short" />
              <span className="skel-line" />
              <span className="skel-line skel-line-mid" />
              <span className="skel-line" />
            </div>
          }
        >
          {summary ? (
            <div className="desk-result-body">
              {/* Aviso: terminar no significa informe completo. */}
              <p className="trace-summary">
                La ejecución puede haber terminado y el informe seguir siendo parcial, un rechazo o
                un error.
              </p>
              {/* Imagen admitida. */}
              {summary.media?.image ? (
                <section className="research-block">
                  {/* Título. */}
                  <h3>Imagen</h3>
                  {/* Imagen guardada. */}
                  <img
                    className="media-preview"
                    src={`/api/research/media/${summary.media.image.assetId}`}
                    alt="Imagen admitida de esta investigación"
                  />
                  {/* Detalle. */}
                  <p>{summary.media.image.detail}</p>
                  {/* Texto observado. */}
                  {summary.media.image.observedText ? (
                    <p>
                      Texto observado: <q>{summary.media.image.observedText}</q>
                    </p>
                  ) : null}
                  {/* Notas. */}
                  {summary.media.image.notes ? <p>{summary.media.image.notes}</p> : null}
                </section>
              ) : null}
              {/* Audio admitido. */}
              {summary.media?.audio ? (
                <section className="research-block">
                  {/* Título. */}
                  <h3>Audio</h3>
                  {/* Detalle. */}
                  <p>{summary.media.audio.detail}</p>
                  {/* Transcripción. */}
                  {summary.media.audio.transcript ? (
                    <p>
                      Transcripción: <q>{summary.media.audio.transcript}</q>
                    </p>
                  ) : null}
                </section>
              ) : null}
              {/* Conflicto entre entradas. */}
              {summary.media?.conflict ? (
                <p className="research-banner" role="alert">
                  {summary.media.conflict}
                </p>
              ) : null}
              {/* Informe. */}
              {reportText ? (
                <div className="desk-report">
                  <CourseAnswer text={reportText} />
                </div>
              ) : null}
              {/* Voz. */}
              {summary.media?.speech ? (
                <section className="research-block">
                  {/* Título. */}
                  <h3>Voz</h3>
                  {/* Guion hablado. */}
                  <p>{summary.media.speech.text}</p>
                  {/* Detalle. */}
                  <p className="research-meta">{summary.media.speech.detail}</p>
                  {/* Reproductor. */}
                  {summary.media.speech.assetId ? (
                    <audio
                      className="media-audio"
                      controls
                      preload="none"
                      src={`/api/research/media/${summary.media.speech.assetId}`}
                    />
                  ) : null}
                </section>
              ) : null}
              {/* Nota del informe. */}
              {reportNote ? <p className="research-meta">{reportNote}</p> : null}
              {/* Fuentes, abiertas al llegar. */}
              <Accordion title="Fuentes" count={sources.length} defaultOpen>
                <ResearchSources sources={sources} />
              </Accordion>
              {/* Traza, plegada para no tapar el informe. */}
              <Accordion title="Traza del grafo">
                <ResearchTrace summary={summary} />
              </Accordion>
            </div>
          ) : null}
        </RevealSlot>
      ) : null}
    </div>
  );
}
