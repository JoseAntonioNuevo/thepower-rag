export type ChatStage = "sin-rag" | "rag" | "crag" | "research";

const STATUS_LABELS = [
  "Listo",
  "Enviando",
  "Recibiendo la respuesta",
  "Recibiendo RAG",
  "Recorriendo el grafo",
  "Investigando",
  "Error",
] as const;

export const THINK_SIZER = STATUS_LABELS.reduce((longest, label) =>
  label.length > longest.length ? label : longest,
);

export function conversationStatus(status: string, mode: ChatStage): string {
  if (status === "submitted") {
    return "Enviando";
  }
  if (status === "streaming") {
    if (mode === "crag") {
      return "Recorriendo el grafo";
    }
    if (mode === "research") {
      return "Investigando";
    }
    if (mode === "sin-rag") {
      return "Recibiendo la respuesta";
    }
    return "Recibiendo RAG";
  }
  if (status === "error") {
    return "Error";
  }
  return "Listo";
}

export type StreamToken = { kind: "word"; text: string } | { kind: "gap"; text: string };

export function splitStreamTokens(text: string): StreamToken[] {
  if (text.length === 0) {
    return [];
  }
  const tokens: StreamToken[] = [];
  const pattern = /\s+/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      tokens.push({ kind: "word", text: text.slice(cursor, index) });
    }
    tokens.push({ kind: "gap", text: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: "word", text: text.slice(cursor) });
  }
  return tokens;
}

export function readCssMs(name: string, fallback: number): number {
  if (typeof document === "undefined") {
    return fallback;
  }
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  return Number.isFinite(value) ? value : fallback;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const MATRIX_CORNERS = [0, 3, 12, 15];
const MATRIX_RING = [1, 2, 7, 11, 14, 13, 8, 4];
const MATRIX_INNER = [5, 6, 9, 10];
const MATRIX_TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

export type MatrixDotPlan = { gap: boolean; delayMs: number | null; steady: boolean };

export function matrixDotPlan(
  variant: string,
  index: number,
  cycle: number,
  rounded: boolean,
): MatrixDotPlan {
  if (rounded && MATRIX_CORNERS.includes(index)) {
    return { gap: true, delayMs: null, steady: false };
  }
  if (variant === "scan") {
    return { gap: false, delayMs: Math.round((index % 4) * (cycle / 10)), steady: false };
  }
  if (variant === "twinkle") {
    const step = MATRIX_TWINKLE[index] ?? 0;
    return { gap: false, delayMs: Math.round(step * (cycle / 16)), steady: false };
  }
  if (variant === "orbit") {
    const place = MATRIX_RING.indexOf(index);
    if (place === -1) {
      return { gap: false, delayMs: null, steady: true };
    }
    return { gap: false, delayMs: Math.round(place * (cycle / 8)), steady: false };
  }
  if (variant === "pulse") {
    const ring = MATRIX_INNER.includes(index) ? 0 : 1;
    return { gap: false, delayMs: Math.round(ring * (cycle * 0.16)), steady: false };
  }
  return { gap: false, delayMs: null, steady: false };
}

export function fillMatrix(loader: HTMLElement, variant: string): void {
  const rounded = loader.getAttribute("data-rounded") === "true";
  const cycle = readCssMs("--matrix-cycle", 1200);
  for (let index = 0; index < 16; index += 1) {
    const dot = document.createElement("i");
    const plan = matrixDotPlan(variant, index, cycle, rounded);
    if (plan.gap) {
      dot.className = "is-gap";
    } else if (plan.steady) {
      dot.style.animation = "none";
    } else if (plan.delayMs !== null) {
      dot.style.setProperty("--d", String(plan.delayMs));
    }
    loader.appendChild(dot);
  }
}
