// GUÍA DE LECTURA · apps/web/src/chat-motion-view.tsx
// Componentes de movimiento del chat: estado que cambia con fundido, matriz de puntos de carga, texto que
// aparece palabra a palabra, error con sacudida, esqueletos que se revelan y paneles que se deslizan.
// Todos respetan prefers-reduced-motion: con movimiento reducido se muestran sin animar.
// Hooks de React y tipo de los hijos.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
// Lógica del movimiento.
import {
  THINK_SIZER,
  fillMatrix,
  prefersReducedMotion,
  readCssMs,
  splitStreamTokens,
} from "./chat-motion";

// Hook: ¿el usuario pidió menos movimiento? Se actualiza si cambia la preferencia.
function useReducedMotion(): boolean {
  // Valor inicial.
  const [value, setValue] = useState(prefersReducedMotion);
  // Escucha cambios de la preferencia.
  useEffect(() => {
    // Media query.
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Al cambiar.
    const onChange = () => {
      // Actualiza.
      setValue(media.matches);
    };
    // Se suscribe.
    media.addEventListener("change", onChange);
    // Limpieza.
    return () => {
      // Se da de baja.
      media.removeEventListener("change", onChange);
    };
  }, []);
  // Valor actual.
  return value;
}

// Fase de una línea del estado.
type ThinkPhase = "enter" | "idle" | "exit";

// Línea del estado con su id y fase.
type ThinkLine = { id: number; text: string; phase: ThinkPhase };

// Estado del chat («Enviando», «Recorriendo el grafo»…) con fundido entre etiquetas.
export function ThinkStatus({ label, live }: { label: string; live: boolean }) {
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // Último id.
  const idRef = useRef(1);
  // Líneas visibles (la que sale y la que entra).
  const [lines, setLines] = useState<ThinkLine[]>(() => [
    { id: 1, text: label, phase: prefersReducedMotion() ? "idle" : "enter" },
  ]);
  // Contenedor.
  const boxRef = useRef<HTMLSpanElement>(null);

  // Cuando cambia la etiqueta, la línea actual sale y entra otra.
  useLayoutEffect(() => {
    // Línea viva.
    const liveLine = lines.find((line) => line.phase !== "exit");
    // Sin cambio.
    if (liveLine === undefined || liveLine.text === label) {
      // Nada.
      return;
    }
    // Id nuevo.
    const nextId = idRef.current + 1;
    // Lo guarda.
    idRef.current = nextId;
    // Actualiza las líneas.
    setLines((current) => {
      // Línea viva actual.
      const currentLive = current.find((line) => line.phase !== "exit");
      // Sin cambio.
      if (currentLive === undefined || currentLive.text === label) {
        // Igual.
        return current;
      }
      // Las vivas salen y se añade la nueva.
      return [
        ...current.map((line) =>
          line.phase === "exit" ? line : { ...line, phase: "exit" as const },
        ),
        { id: nextId, text: label, phase: reduce ? "idle" : "enter" },
      ];
    });
  }, [label, lines, reduce]);

  // Tras pintar la línea que entra, la pasa a idle tras un pequeño hueco.
  useLayoutEffect(() => {
    // Contenedor.
    const box = boxRef.current;
    // Sin contenedor.
    if (box === null) {
      // Nada.
      return;
    }
    // Línea que entra.
    const entering = box.querySelector<HTMLElement>(".t-think-text.is-enter-start");
    // Ninguna.
    if (entering === null) {
      // Nada.
      return;
    }
    // Fuerza el reflow para que la transición arranque.
    void entering.offsetWidth;
    // Id.
    const id = Number(entering.dataset.lineId);
    // Hueco en ms.
    const gap = readCssMs("--think-gap", 50);
    // Tras el hueco.
    const timer = window.setTimeout(() => {
      // La pasa a idle.
      setLines((current) =>
        current.map((line) =>
          line.id === id && line.phase === "enter" ? { ...line, phase: "idle" } : line,
        ),
      );
    }, gap);
    // Limpieza.
    return () => {
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [lines]);

  // Quita las líneas que salen al terminar su transición.
  useEffect(() => {
    // Ninguna sale.
    if (!lines.some((line) => line.phase === "exit")) {
      // Nada.
      return;
    }
    // Duración del cambio.
    const swap = readCssMs("--think-swap", 150);
    // Hueco.
    const gap = readCssMs("--think-gap", 50);
    // Tras ambos.
    const timer = window.setTimeout(() => {
      // Quita las que salen.
      setLines((current) => current.filter((line) => line.phase !== "exit"));
    }, swap + gap);
    // Limpieza.
    return () => {
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [lines]);

  // Caja con el tamaño de la etiqueta más larga.
  return (
    <span ref={boxRef} className="t-think" data-live={live ? "true" : "false"}>
      {/* Medidor invisible del ancho. */}
      <span className="t-think-sizer" aria-hidden="true">
        {/* Etiqueta más larga. */}
        {THINK_SIZER}
      </span>
      {/* Cada línea. */}
      {lines.map((line) => (
        <span
          key={line.id}
          className={
            line.phase === "exit"
              ? "t-think-text is-exit"
              : line.phase === "enter"
                ? "t-think-text is-enter-start"
                : "t-think-text"
          }
          data-text={line.text}
          data-line-id={line.id}
          aria-hidden={line.phase === "exit" ? true : undefined}
        >
          {/* Texto. */}
          {line.text}
        </span>
      ))}
    </span>
  );
}

// Matriz de 4×4 puntos animados mientras carga.
export function MatrixLoader({ variant = "scan" }: { variant?: string }) {
  // Contenedor.
  const ref = useRef<HTMLDivElement>(null);
  // Crea los puntos al montar o cambiar de patrón.
  useLayoutEffect(() => {
    // Nodo.
    const loader = ref.current;
    // Sin nodo.
    if (loader === null) {
      // Nada.
      return;
    }
    // Rellena la matriz.
    fillMatrix(loader, variant);
    // Limpieza.
    return () => {
      // Quita los puntos.
      loader.replaceChildren();
    };
  }, [variant]);
  // Contenedor oculto para lectores de pantalla.
  return <div ref={ref} className="t-matrix" data-variant={variant} aria-hidden="true" />;
}

// Una palabra que entra con fundido.
function StreamWord({ text, enter }: { text: string; enter: boolean }) {
  // Nodo.
  const ref = useRef<HTMLSpanElement>(null);
  // ¿Visible?
  const [on, setOn] = useState(false);
  // Activa la animación en el siguiente fotograma.
  useEffect(() => {
    // No toca o ya está.
    if (!enter || on) {
      // Nada.
      return;
    }
    // Siguiente fotograma.
    const frame = window.requestAnimationFrame(() => {
      // Nodo.
      const node = ref.current;
      // Si existe.
      if (node !== null) {
        // Reflow.
        void node.offsetWidth;
      }
      // Visible.
      setOn(true);
    });
    // Limpieza.
    return () => {
      // Cancela.
      window.cancelAnimationFrame(frame);
    };
  }, [enter, on]);
  // Palabra.
  return (
    <span ref={ref} className={on ? "t-stream-w is-in" : "t-stream-w"}>
      {/* Texto. */}
      {text}
    </span>
  );
}

// Texto de la respuesta que aparece palabra a palabra.
export function StreamedText({ text }: { text: string }) {
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // Trozos.
  const tokens = splitStreamTokens(text);
  // Palabras.
  const wordCount = tokens.reduce((count, token) => count + (token.kind === "word" ? 1 : 0), 0);
  // Palabras ya visibles.
  const [cursor, setCursor] = useState(0);
  // Con movimiento reducido, todas.
  const visible = reduce ? wordCount : cursor;

  // Avanza una palabra cada --stream-gap.
  useEffect(() => {
    // Sin animación o completo.
    if (reduce || cursor >= wordCount) {
      // Nada.
      return;
    }
    // El catálogo revela una palabra por --stream-gap. En una respuesta larga solo se anima la
    // cola final (12 palabras) para que el párrafo no se quede en blanco.
    const tail = 12;
    // Inicio de la cola animada.
    const floor = Math.max(0, wordCount - tail);
    // Si va por detrás.
    if (cursor < floor) {
      // Salta al inicio de la cola.
      const frame = window.requestAnimationFrame(() => {
        // Salto.
        setCursor(floor);
      });
      // Limpieza.
      return () => {
        // Cancela.
        window.cancelAnimationFrame(frame);
      };
    }
    // Espera.
    const delay = cursor === 0 ? 0 : readCssMs("--stream-gap", 60);
    // Siguiente palabra.
    const timer = window.setTimeout(() => {
      // Una más.
      setCursor((current) => Math.min(wordCount, current + 1));
    }, delay);
    // Limpieza.
    return () => {
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [reduce, cursor, wordCount]);

  // Sin texto.
  if (text.length === 0) {
    // Nada.
    return null;
  }
  // Número de orden de cada palabra (-1 en los espacios).
  const ordinals = tokens.reduce<{ next: number; values: number[] }>(
    (state, token) => {
      // Espacio.
      if (token.kind !== "word") {
        // Sin número.
        return { next: state.next, values: [...state.values, -1] };
      }
      // Palabra numerada.
      return { next: state.next + 1, values: [...state.values, state.next] };
    },
    { next: 0, values: [] },
  ).values;
  // Párrafo.
  return (
    <p className="t-stream">
      {/* Cada trozo. */}
      {tokens.map((token, index) => {
        // Espacio.
        if (token.kind === "gap") {
          // Tal cual.
          return <span key={`gap-${String(index)}`}>{token.text}</span>;
        }
        // Palabra que entra si ya toca.
        return (
          <StreamWord
            key={`word-${String(index)}`}
            text={token.text}
            enter={(ordinals[index] ?? 0) < visible}
          />
        );
      })}
    </p>
  );
}

// Error del chat que aparece y se sacude una vez.
export function ChatError({ message }: { message: string }) {
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // Nodo.
  const inputRef = useRef<HTMLParagraphElement>(null);
  // ¿Visible?
  const [revealed, setRevealed] = useState(prefersReducedMotion);
  // ¿Sacudiéndose?
  const [shaking, setShaking] = useState(false);

  // Al cambiar el mensaje: aparece y vuelve a sacudirse.
  useEffect(() => {
    // Cancelado.
    let cancel = false;
    // Segundo fotograma.
    let inner = 0;
    // Primer fotograma.
    const frame = window.requestAnimationFrame(() => {
      // Cancelado.
      if (cancel) {
        // Nada.
        return;
      }
      // Visible.
      setRevealed(true);
      // Sin movimiento.
      if (reduce) {
        // Nada más.
        return;
      }
      // Quita la sacudida.
      setShaking(false);
      // Siguiente fotograma.
      inner = window.requestAnimationFrame(() => {
        // Cancelado.
        if (cancel) {
          // Nada.
          return;
        }
        // Nodo.
        const node = inputRef.current;
        // Si existe.
        if (node !== null) {
          // Reflow.
          void node.offsetWidth;
        }
        // Sacude.
        setShaking(true);
      });
    });
    // Limpieza.
    return () => {
      // Cancelado.
      cancel = true;
      // Cancela el primero.
      window.cancelAnimationFrame(frame);
      // Cancela el segundo.
      window.cancelAnimationFrame(inner);
    };
  }, [message, reduce]);

  // Quita la sacudida al terminar.
  useEffect(() => {
    // No se sacude.
    if (!shaking) {
      // Nada.
      return;
    }
    // Duración total de la sacudida.
    const shakeMs = readCssMs("--shake-dur-a", 80) * 2 + readCssMs("--shake-dur-b", 60) * 2;
    // Al terminar.
    const timer = window.setTimeout(() => {
      // Sin sacudida.
      setShaking(false);
    }, shakeMs + 20);
    // Limpieza.
    return () => {
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [shaking]);

  // Clases según el estado.
  const inputClass = shaking
    ? "error t-input is-error is-shaking"
    : revealed
      ? "error t-input is-error"
      : "error t-input";
  // Error.
  return (
    <div className={revealed ? "t-input-wrap is-error" : "t-input-wrap"}>
      {/* Párrafo con role=alert para lectores de pantalla. */}
      <p ref={inputRef} className={inputClass} role="alert">
        {/* Mensaje. */}
        <span className="t-error-msg">{message}</span>
      </p>
    </div>
  );
}

// Zona que muestra un esqueleto mientras carga y revela el contenido al terminar.
export function RevealSlot({
  loading,
  label,
  skeleton,
  children,
  className = "source-skel",
}: {
  // ¿Cargando?
  loading: boolean;
  // Etiqueta accesible.
  label: string;
  // Esqueleto.
  skeleton: ReactNode;
  // Contenido.
  children: ReactNode;
  // Clase extra.
  className?: string;
}) {
  // Nodo.
  const ref = useRef<HTMLDivElement>(null);
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // Revela el contenido al terminar de cargar.
  useEffect(() => {
    // Nodo.
    const node = ref.current;
    // Sin nodo.
    if (node === null) {
      // Nada.
      return;
    }
    // Cargando.
    if (loading) {
      // Oculta.
      node.classList.remove("is-revealed");
      // Sale.
      return;
    }
    // Sin movimiento.
    if (reduce) {
      // Revela.
      node.classList.add("is-revealed");
      // Sale.
      return;
    }
    // Siguiente fotograma.
    const frame = window.requestAnimationFrame(() => {
      // Revela.
      node.classList.add("is-revealed");
    });
    // Por si no hay fotograma (pestaña oculta).
    const timer = window.setTimeout(() => {
      // Revela.
      node.classList.add("is-revealed");
    }, 50);
    // Limpieza.
    return () => {
      // Cancela.
      window.cancelAnimationFrame(frame);
      // Cancela.
      window.clearTimeout(timer);
    };
  }, [loading, reduce]);
  // Contenedor con el estado.
  return (
    <div ref={ref} className={`t-skel ${className}`} data-state={loading ? "loading" : "ready"}>
      {/* Esqueleto. */}
      <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
        {/* Contenido del esqueleto. */}
        {skeleton}
      </div>
      {/* Contenido real. */}
      <div
        className="t-skel-content"
        aria-busy={loading || undefined}
        aria-hidden={loading || undefined}
        aria-label={label}
      >
        {/* Hijos. */}
        {children}
      </div>
    </div>
  );
}

// Nota de dos líneas que aparece escalonada.
export function RunNote({ summary, detail }: { summary: string; detail: string }) {
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // ¿Visible?
  const [shown, setShown] = useState(prefersReducedMotion);
  // Muestra en el siguiente fotograma.
  useEffect(() => {
    // Ya visible.
    if (reduce || shown) {
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
  }, [reduce, shown]);
  // Contenedor.
  return (
    <div className={reduce || shown ? "t-stagger is-shown run-note" : "t-stagger run-note"}>
      {/* Resumen. */}
      <p className="t-stagger-line t-stagger-line--1">{summary}</p>
      {/* Detalle. */}
      <p className="t-stagger-line t-stagger-line--2">{detail}</p>
    </div>
  );
}

// Texto de conversación vacía que aparece con fundido.
export function EmptyThread({ text }: { text: string }) {
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // ¿Visible?
  const [shown, setShown] = useState(prefersReducedMotion);
  // Muestra en el siguiente fotograma.
  useEffect(() => {
    // Ya visible.
    if (reduce || shown) {
      // Nada.
      return;
    }
    // Siguiente fotograma.
    const frame = window.requestAnimationFrame(() => {
      // Visible.
      setShown(true);
    });
    // Limpieza.
    return () => {
      // Cancela.
      window.cancelAnimationFrame(frame);
    };
  }, [reduce, shown, text]);
  // Contenedor.
  return (
    <div className={reduce || shown ? "t-stagger is-shown" : "t-stagger"}>
      {/* Texto. */}
      <p className="muted t-stagger-line t-stagger-line--1">{text}</p>
    </div>
  );
}

// Panel que se desliza al montarse.
export function PanelSlide({
  children,
  className,
  as: Tag = "div",
}: {
  // Hijos.
  children: ReactNode;
  // Clase extra.
  className?: string;
  // Etiqueta HTML.
  as?: "div" | "li" | "aside";
}) {
  // ¿Menos movimiento?
  const reduce = useReducedMotion();
  // ¿Abierto?
  const [open, setOpen] = useState(prefersReducedMotion);
  // Abre en el siguiente fotograma.
  useEffect(() => {
    // Ya abierto.
    if (reduce || open) {
      // Nada.
      return;
    }
    // Siguiente fotograma.
    const frame = window.requestAnimationFrame(() => {
      // Abierto.
      setOpen(true);
    });
    // Limpieza.
    return () => {
      // Cancela.
      window.cancelAnimationFrame(frame);
    };
  }, [reduce, open]);
  // Clases.
  const names = className === undefined ? "t-panel-slide" : `t-panel-slide ${className}`;
  // Panel.
  return (
    <Tag className={names} data-open={reduce || open ? "true" : "false"}>
      {/* Hijos. */}
      {children}
    </Tag>
  );
}
