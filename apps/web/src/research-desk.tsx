// GUÍA DE LECTURA · apps/web/src/research-desk.tsx
// Mesa de investigación durable en el navegador: conversaciones por grupo, pregunta con imagen, audio y voz
// opcionales, envío protegido con Turnstile, sondeo del trabajo, informe con fuentes, traza y presupuesto.
// El trabajo sigue en el Worker aunque se cierre la página; al volver se recupera desde la conversación.
// Pregunta y escenarios de demo; tipos de audiencia, escenario, fuente y resumen.
import {
  DEMO_RESEARCH_QUESTION,
  DEMO_RESEARCH_SCENARIOS,
  type Audience,
  type ResearchScenarioId,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
// Hooks de React.
import { useCallback, useEffect, useRef, useState } from "react";
// Respuesta con el Markdown del curso.
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
  // Grupo.
  audience: Audience;
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

// Línea de estado que cambia con fundido.
function StatusLine({ text }: { text: string }) {
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
      // Sale.
      return;
    }
    // Animación de salida.
    element.classList.add("is-exit");
    // Tras 150 ms.
    const timer = window.setTimeout(() => {
      // Texto nuevo.
      element.textContent = text;
      // Quita la salida.
      element.classList.remove("is-exit");
      // Prepara la entrada.
      element.classList.add("is-enter-start");
      // Reflow.
      void element.offsetHeight;
      // Entra.
      element.classList.remove("is-enter-start");
    }, 150);
    // Limpieza.
    return () => {
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [text]);
  // Contenedor del texto.
  return <span ref={ref} className="t-text-swap" />;
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

// Mesa de investigación de un grupo.
export function ResearchDesk({
  audience,
  allowScenario,
  onBusy,
}: {
  // Grupo.
  audience: Audience;
  // Si se pueden elegir escenarios de prueba.
  allowScenario: boolean;
  // Avisa de si hay un trabajo en curso.
  onBusy: (busy: boolean) => void;
}) {
  // Conversaciones del grupo.
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
  const [budget, setBudget] = useState<string | null>(null);
  // Clave del trabajo.
  const idempotency = useRef<string | null>(null);
  // Turnstile.
  const {
    container: verificationContainer,
    ready: verificationReady,
    error: verificationError,
    beforeSend,
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
      // Texto del presupuesto.
      setBudget(
        `Reservado ${body.reserved}. Consumido ${body.consumed ?? ""}. Desconocido ${body.unknown ?? ""}. ${body.note ?? ""}`,
      );
    }
  }

  // Carga las conversaciones del grupo y elige la guardada o la primera.
  const loadConversations = useCallback(
    async (preferred: string | null) => {
      // GET /api/research/conversations.
      const response = await fetch("/api/research/conversations");
      // Cuerpo.
      const body = (await readJson(response)) as { conversations?: ConversationItem[] } | null;
      // Solo las del grupo.
      const mine = (body?.conversations ?? []).filter((item) => item.audience === audience);
      // Guarda.
      setConversations(mine);
      // Conversación preferida o guardada en la sesión.
      const stored = preferred ?? sessionStorage.getItem(`research-conversation:${audience}`);
      // La elegida.
      const selected = mine.find((item) => item.id === stored) ?? mine[0] ?? null;
      // La selecciona.
      setConversationId(selected?.id ?? null);
      // Si hay.
      if (selected) {
        // La recuerda.
        sessionStorage.setItem(`research-conversation:${audience}`, selected.id);
      }
    },
    [audience],
  );

  // Al montar o cambiar de grupo: sesión, conversaciones y presupuesto.
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
  }, [audience, loadConversations]);

  // Al desmontar, libera las URL locales.
  useEffect(() => {
    // Limpieza.
    return () => {
      // Imagen.
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
      // Audio.
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
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
    if (imageInput.current) imageInput.current.value = "";
    // Vacía el input.
    if (audioInput.current) audioInput.current.value = "";
    // Sin voz.
    setVoice(false);
  }

  // Sustituye la URL local de la imagen.
  function replaceImageUrl(file: File | null) {
    // URL nueva o null.
    const next = file ? URL.createObjectURL(file) : null;
    // Libera la anterior.
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
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
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
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

  // Crea una conversación nueva del grupo.
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
      body: JSON.stringify({ audience }),
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
    sessionStorage.setItem(`research-conversation:${audience}`, body.id);
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
    if (!submitGate.enter()) return;
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
      ? "Sin trabajo activo."
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

  // Mesa.
  return (
    <div className="research-desk">
      {/* Aviso de privacidad y duración. */}
      <p className="composer-caption">
        Conversación anónima de esta demostración. No es una cuenta de alumno. Cerrar la página no
        cancela el trabajo.
      </p>
      {/* Lista de conversaciones. */}
      <div className="conversation-list">
        {/* Un botón por conversación. */}
        {conversations.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className="caption-action"
            aria-pressed={item.id === conversationId}
            onClick={() => {
              // Nueva generación.
              generation.current += 1;
              // Selecciona.
              setConversationId(item.id);
              // La recuerda.
              sessionStorage.setItem(`research-conversation:${audience}`, item.id);
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
        {/* Nueva conversación. */}
        <button
          type="button"
          onClick={() => void createConversation()}
          disabled={!verificationReady}
        >
          Nueva conversación
        </button>
      </div>
      {/* Selector de guion de prueba. */}
      {allowScenario ? (
        <label className="composer-script" htmlFor="guion-durable">
          Guion
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
            <option value="">Libre, con el material del curso de prueba</option>
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
        className="composer"
        onSubmit={(event) => {
          // Evita recargar.
          event.preventDefault();
          // Envía.
          void submit();
        }}
      >
        {/* Pregunta. */}
        <textarea
          aria-label="Pregunta de investigación"
          value={question}
          rows={3}
          onChange={(event) => {
            // Actualiza.
            setQuestion(event.target.value);
          }}
        />
        {/* Archivos y voz. */}
        <div className="media-row">
          {/* Imagen. */}
          <label>
            Imagen PNG o JPEG
            <input
              ref={imageInput}
              aria-label="Imagen"
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
          <label>
            Audio WAV
            <input
              ref={audioInput}
              aria-label="Audio"
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
          {/* Voz. */}
          <label>
            {/* Casilla. */}
            <input
              type="checkbox"
              checked={voice}
              onChange={(event) => {
                // Actualiza.
                setVoice(event.target.checked);
              }}
            />{" "}
            Generar voz
          </label>
        </div>
        {/* Vista previa de la imagen. */}
        {imageUrl ? (
          <figure>
            {/* Imagen. */}
            <img
              className="media-preview"
              src={imageUrl}
              alt="Vista previa de la imagen seleccionada"
            />
            {/* Nombre, tamaño y botón para quitarla. */}
            <figcaption className="research-meta">
              {imageFile?.name} · {imageFile ? `${String(imageFile.size)} bytes` : ""}
              {/* Quitar. */}
              <button
                type="button"
                onClick={() => {
                  // Sin archivo.
                  setImageFile(null);
                  // Sin clave.
                  imageKey.current = null;
                  // Vacía el input.
                  if (imageInput.current) imageInput.current.value = "";
                  // Libera la URL.
                  replaceImageUrl(null);
                }}
              >
                Quitar imagen
              </button>
            </figcaption>
          </figure>
        ) : null}
        {/* Vista previa del audio. */}
        {audioUrl ? (
          <div>
            {/* Reproductor. */}
            <audio className="media-audio" controls preload="none" src={audioUrl} />
            {/* Nombre y botón para quitarlo. */}
            <p className="research-meta">
              {/* Nombre. */}
              {audioFile?.name}
              {/* Quitar. */}
              <button
                type="button"
                onClick={() => {
                  // Sin archivo.
                  setAudioFile(null);
                  // Sin clave.
                  audioKey.current = null;
                  // Vacía el input.
                  if (audioInput.current) audioInput.current.value = "";
                  // Libera la URL.
                  replaceAudioUrl(null);
                }}
              >
                Quitar audio
              </button>
            </p>
          </div>
        ) : null}
        {/* Enviar. */}
        <button
          type="submit"
          disabled={
            !verificationReady ||
            !conversationId ||
            (question.trim().length === 0 && !imageFile && !audioFile)
          }
        >
          Investigar
        </button>
        {/* Cancelar. */}
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
        {/* Recuperar. */}
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
        {/* Contenedor del widget de Turnstile. */}
        <div ref={verificationContainer} aria-label="Verificación de seguridad" />
      </form>
      {/* Estado con esqueleto hasta tener resumen. */}
      <div className={`t-skel research-status-skel${summary ? " is-revealed" : ""}`}>
        {/* Esqueleto. */}
        <div className="t-skel-skeleton is-pulsing">
          {/* Texto. */}
          <p>Consultando el trabajo…</p>
        </div>
        {/* Contenido. */}
        <div className="t-skel-content">
          {/* Estado y detalle. */}
          <p>
            {/* Estado con fundido. */}
            <StatusLine text={status} /> {detail}
          </p>
        </div>
      </div>
      {/* Error de verificación. */}
      {verificationError ? <p role="alert">{verificationError}</p> : null}
      {/* Aviso. */}
      {notice ? <p role="alert">{notice}</p> : null}
      {/* Presupuesto. */}
      {budget ? <p className="research-meta">{budget}</p> : null}
      {/* Resultado. */}
      {summary ? (
        <>
          {/* Aviso: terminar no significa informe completo. */}
          <p className="trace-summary">
            La ejecución puede haber terminado y el informe seguir siendo parcial, un rechazo o un
            error.
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
          {summary.media?.conflict ? <p role="alert">{summary.media.conflict}</p> : null}
          {/* Informe. */}
          {reportText ? <CourseAnswer text={reportText} /> : null}
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
          {reportNote ? <p>{reportNote}</p> : null}
          {/* Traza. */}
          <ResearchTrace summary={summary} />
          {/* Fuentes. */}
          <ResearchSources sources={sources} />
        </>
      ) : null}
    </div>
  );
}
