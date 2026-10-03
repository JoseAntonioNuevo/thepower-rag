import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  THINK_SIZER,
  fillMatrix,
  prefersReducedMotion,
  readCssMs,
  splitStreamTokens,
} from "./chat-motion";

function useReducedMotion(): boolean {
  const [value, setValue] = useState(prefersReducedMotion);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setValue(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);
  return value;
}

type ThinkPhase = "enter" | "idle" | "exit";

type ThinkLine = { id: number; text: string; phase: ThinkPhase };

export function ThinkStatus({ label, live }: { label: string; live: boolean }) {
  const reduce = useReducedMotion();
  const idRef = useRef(1);
  const [lines, setLines] = useState<ThinkLine[]>(() => [
    { id: 1, text: label, phase: prefersReducedMotion() ? "idle" : "enter" },
  ]);
  const boxRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const liveLine = lines.find((line) => line.phase !== "exit");
    if (liveLine === undefined || liveLine.text === label) {
      return;
    }
    const nextId = idRef.current + 1;
    idRef.current = nextId;
    setLines((current) => {
      const currentLive = current.find((line) => line.phase !== "exit");
      if (currentLive === undefined || currentLive.text === label) {
        return current;
      }
      return [
        ...current.map((line) =>
          line.phase === "exit" ? line : { ...line, phase: "exit" as const },
        ),
        { id: nextId, text: label, phase: reduce ? "idle" : "enter" },
      ];
    });
  }, [label, lines, reduce]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box === null) {
      return;
    }
    const entering = box.querySelector<HTMLElement>(".t-think-text.is-enter-start");
    if (entering === null) {
      return;
    }
    void entering.offsetWidth;
    const id = Number(entering.dataset.lineId);
    const gap = readCssMs("--think-gap", 50);
    const timer = window.setTimeout(() => {
      setLines((current) =>
        current.map((line) =>
          line.id === id && line.phase === "enter" ? { ...line, phase: "idle" } : line,
        ),
      );
    }, gap);
    return () => {
      window.clearTimeout(timer);
    };
  }, [lines]);

  useEffect(() => {
    if (!lines.some((line) => line.phase === "exit")) {
      return;
    }
    const swap = readCssMs("--think-swap", 150);
    const gap = readCssMs("--think-gap", 50);
    const timer = window.setTimeout(() => {
      setLines((current) => current.filter((line) => line.phase !== "exit"));
    }, swap + gap);
    return () => {
      window.clearTimeout(timer);
    };
  }, [lines]);

  return (
    <span ref={boxRef} className="t-think" data-live={live ? "true" : "false"}>
      <span className="t-think-sizer" aria-hidden="true">
        {THINK_SIZER}
      </span>
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
          {line.text}
        </span>
      ))}
    </span>
  );
}

export function MatrixLoader({ variant = "scan" }: { variant?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const loader = ref.current;
    if (loader === null) {
      return;
    }
    fillMatrix(loader, variant);
    return () => {
      loader.replaceChildren();
    };
  }, [variant]);
  return <div ref={ref} className="t-matrix" data-variant={variant} aria-hidden="true" />;
}

function StreamWord({ text, enter }: { text: string; enter: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!enter || on) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const node = ref.current;
      if (node !== null) {
        void node.offsetWidth;
      }
      setOn(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [enter, on]);
  return (
    <span ref={ref} className={on ? "t-stream-w is-in" : "t-stream-w"}>
      {text}
    </span>
  );
}

export function StreamedText({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const tokens = splitStreamTokens(text);
  const wordCount = tokens.reduce((count, token) => count + (token.kind === "word" ? 1 : 0), 0);
  const [cursor, setCursor] = useState(0);
  const visible = reduce ? wordCount : cursor;

  useEffect(() => {
    if (reduce || cursor >= wordCount) {
      return;
    }
    // The catalog resolves one word per --stream-gap. A long answer keeps
    // that cross-blur on a short tail so the paragraph does not stay blank.
    const tail = 12;
    const floor = Math.max(0, wordCount - tail);
    if (cursor < floor) {
      const frame = window.requestAnimationFrame(() => {
        setCursor(floor);
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    const delay = cursor === 0 ? 0 : readCssMs("--stream-gap", 60);
    const timer = window.setTimeout(() => {
      setCursor((current) => Math.min(wordCount, current + 1));
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [reduce, cursor, wordCount]);

  if (text.length === 0) {
    return null;
  }
  const ordinals = tokens.reduce<{ next: number; values: number[] }>(
    (state, token) => {
      if (token.kind !== "word") {
        return { next: state.next, values: [...state.values, -1] };
      }
      return { next: state.next + 1, values: [...state.values, state.next] };
    },
    { next: 0, values: [] },
  ).values;
  return (
    <p className="t-stream">
      {tokens.map((token, index) => {
        if (token.kind === "gap") {
          return <span key={`gap-${String(index)}`}>{token.text}</span>;
        }
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

export function ChatError({ message }: { message: string }) {
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLParagraphElement>(null);
  const [revealed, setRevealed] = useState(prefersReducedMotion);
  const [shaking, setShaking] = useState(false);

  useEffect(() => {
    let cancel = false;
    let inner = 0;
    const frame = window.requestAnimationFrame(() => {
      if (cancel) {
        return;
      }
      setRevealed(true);
      if (reduce) {
        return;
      }
      setShaking(false);
      inner = window.requestAnimationFrame(() => {
        if (cancel) {
          return;
        }
        const node = inputRef.current;
        if (node !== null) {
          void node.offsetWidth;
        }
        setShaking(true);
      });
    });
    return () => {
      cancel = true;
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(inner);
    };
  }, [message, reduce]);

  useEffect(() => {
    if (!shaking) {
      return;
    }
    const shakeMs = readCssMs("--shake-dur-a", 80) * 2 + readCssMs("--shake-dur-b", 60) * 2;
    const timer = window.setTimeout(() => {
      setShaking(false);
    }, shakeMs + 20);
    return () => {
      window.clearTimeout(timer);
    };
  }, [shaking]);

  const inputClass = shaking
    ? "error t-input is-error is-shaking"
    : revealed
      ? "error t-input is-error"
      : "error t-input";
  return (
    <div className={revealed ? "t-input-wrap is-error" : "t-input-wrap"}>
      <p ref={inputRef} className={inputClass} role="alert">
        <span className="t-error-msg">{message}</span>
      </p>
    </div>
  );
}

export function RevealSlot({
  loading,
  label,
  skeleton,
  children,
  className = "source-skel",
}: {
  loading: boolean;
  label: string;
  skeleton: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (node === null) {
      return;
    }
    if (loading) {
      node.classList.remove("is-revealed");
      return;
    }
    if (reduce) {
      node.classList.add("is-revealed");
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      node.classList.add("is-revealed");
    });
    const timer = window.setTimeout(() => {
      node.classList.add("is-revealed");
    }, 50);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [loading, reduce]);
  return (
    <div ref={ref} className={`t-skel ${className}`} data-state={loading ? "loading" : "ready"}>
      <div className="t-skel-skeleton is-pulsing" aria-hidden="true">
        {skeleton}
      </div>
      <div
        className="t-skel-content"
        aria-busy={loading || undefined}
        aria-hidden={loading || undefined}
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

export function RunNote({ summary, detail }: { summary: string; detail: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(prefersReducedMotion);
  useEffect(() => {
    if (reduce || shown) {
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
  }, [reduce, shown]);
  return (
    <div className={reduce || shown ? "t-stagger is-shown run-note" : "t-stagger run-note"}>
      <p className="t-stagger-line t-stagger-line--1">{summary}</p>
      <p className="t-stagger-line t-stagger-line--2">{detail}</p>
    </div>
  );
}

export function EmptyThread({ text }: { text: string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(prefersReducedMotion);
  useEffect(() => {
    if (reduce || shown) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setShown(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [reduce, shown, text]);
  return (
    <div className={reduce || shown ? "t-stagger is-shown" : "t-stagger"}>
      <p className="muted t-stagger-line t-stagger-line--1">{text}</p>
    </div>
  );
}

export function PanelSlide({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "aside";
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(prefersReducedMotion);
  useEffect(() => {
    if (reduce || open) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      setOpen(true);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [reduce, open]);
  const names = className === undefined ? "t-panel-slide" : `t-panel-slide ${className}`;
  return (
    <Tag className={names} data-open={reduce || open ? "true" : "false"}>
      {children}
    </Tag>
  );
}
