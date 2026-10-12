// GUÍA DE LECTURA · apps/web/src/chat-motion.ts
// Lógica del movimiento del chat: etiquetas de estado, texto troceado para animar el streaming, lectura de
// duraciones CSS, movimiento reducido y plan de retardos de la matriz de puntos del indicador.
// Etapa del chat.
export type ChatStage = "sin-rag" | "rag" | "crag" | "research";

// Etiquetas posibles del estado.
const STATUS_LABELS = [
  "Listo",
  "Enviando",
  "Recibiendo la respuesta",
  "Recibiendo RAG",
  "Recorriendo el grafo",
  "Investigando",
  "Error",
] as const;

// La más larga: reserva el ancho para que no salte el diseño.
export const THINK_SIZER = STATUS_LABELS.reduce((longest, label) =>
  label.length > longest.length ? label : longest,
);

// Etiqueta según el estado de useChat y el modo.
export function conversationStatus(status: string, mode: ChatStage): string {
  // Enviando.
  if (status === "submitted") {
    // Texto.
    return "Enviando";
  }
  // Recibiendo.
  if (status === "streaming") {
    // CRAG.
    if (mode === "crag") {
      // Texto.
      return "Recorriendo el grafo";
    }
    // Investigación.
    if (mode === "research") {
      // Texto.
      return "Investigando";
    }
    // Sin RAG.
    if (mode === "sin-rag") {
      // Texto.
      return "Recibiendo la respuesta";
    }
    // RAG.
    return "Recibiendo RAG";
  }
  // Error.
  if (status === "error") {
    // Texto.
    return "Error";
  }
  // Listo.
  return "Listo";
}

// Trozo de texto: palabra o espacio.
export type StreamToken = { kind: "word"; text: string } | { kind: "gap"; text: string };

// Divide el texto en palabras y espacios sin perder nada.
export function splitStreamTokens(text: string): StreamToken[] {
  // Vacío.
  if (text.length === 0) {
    // Sin trozos.
    return [];
  }
  // Trozos.
  const tokens: StreamToken[] = [];
  // Espacios en blanco.
  const pattern = /\s+/g;
  // Posición.
  let cursor = 0;
  // Cada espacio.
  for (const match of text.matchAll(pattern)) {
    // Inicio del espacio.
    const index = match.index ?? 0;
    // Hay palabra antes.
    if (index > cursor) {
      // Palabra.
      tokens.push({ kind: "word", text: text.slice(cursor, index) });
    }
    // Espacio.
    tokens.push({ kind: "gap", text: match[0] });
    // Avanza.
    cursor = index + match[0].length;
  }
  // Queda texto final.
  if (cursor < text.length) {
    // Palabra.
    tokens.push({ kind: "word", text: text.slice(cursor) });
  }
  // Trozos.
  return tokens;
}

// Duración en ms de una variable CSS, o el valor por defecto.
export function readCssMs(name: string, fallback: number): number {
  // Sin DOM (tests).
  if (typeof document === "undefined") {
    // Valor por defecto.
    return fallback;
  }
  // Valor de la variable.
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
  // Número o por defecto.
  return Number.isFinite(value) ? value : fallback;
}

// ¿El usuario pidió menos movimiento?
export function prefersReducedMotion(): boolean {
  // Media query.
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Esquinas de la matriz 4×4.
const MATRIX_CORNERS = [0, 3, 12, 15];
// Anillo exterior en orden.
const MATRIX_RING = [1, 2, 7, 11, 14, 13, 8, 4];
// Centro.
const MATRIX_INNER = [5, 6, 9, 10];
// Orden del parpadeo.
const MATRIX_TWINKLE = [7, 2, 11, 5, 14, 9, 0, 12, 3, 15, 6, 10, 13, 1, 8, 4];

// Plan de un punto: hueco, retardo o fijo.
export type MatrixDotPlan = { gap: boolean; delayMs: number | null; steady: boolean };

// Calcula el plan de un punto según el patrón (scan, twinkle, orbit o pulse).
export function matrixDotPlan(
  variant: string,
  index: number,
  cycle: number,
  rounded: boolean,
): MatrixDotPlan {
  // Esquinas redondeadas: hueco.
  if (rounded && MATRIX_CORNERS.includes(index)) {
    // Hueco.
    return { gap: true, delayMs: null, steady: false };
  }
  // scan: retardo por columna.
  if (variant === "scan") {
    // Retardo.
    return { gap: false, delayMs: Math.round((index % 4) * (cycle / 10)), steady: false };
  }
  // twinkle: retardo por orden.
  if (variant === "twinkle") {
    // Paso.
    const step = MATRIX_TWINKLE[index] ?? 0;
    // Retardo.
    return { gap: false, delayMs: Math.round(step * (cycle / 16)), steady: false };
  }
  // orbit: recorre el anillo.
  if (variant === "orbit") {
    // Posición en el anillo.
    const place = MATRIX_RING.indexOf(index);
    // Centro: fijo.
    if (place === -1) {
      // Fijo.
      return { gap: false, delayMs: null, steady: true };
    }
    // Retardo.
    return { gap: false, delayMs: Math.round(place * (cycle / 8)), steady: false };
  }
  // pulse: centro y exterior desfasados.
  if (variant === "pulse") {
    // Anillo.
    const ring = MATRIX_INNER.includes(index) ? 0 : 1;
    // Retardo.
    return { gap: false, delayMs: Math.round(ring * (cycle * 0.16)), steady: false };
  }
  // Otro: sin retardo.
  return { gap: false, delayMs: null, steady: false };
}

// Crea los 16 puntos de la matriz con su retardo.
export function fillMatrix(loader: HTMLElement, variant: string): void {
  // ¿Esquinas redondeadas?
  const rounded = loader.getAttribute("data-rounded") === "true";
  // Duración del ciclo.
  const cycle = readCssMs("--matrix-cycle", 1200);
  // 16 puntos.
  for (let index = 0; index < 16; index += 1) {
    // Punto.
    const dot = document.createElement("i");
    // Plan.
    const plan = matrixDotPlan(variant, index, cycle, rounded);
    // Hueco.
    if (plan.gap) {
      // Clase.
      dot.className = "is-gap";
    } else if (plan.steady) {
      // Sin animación.
      dot.style.animation = "none";
    } else if (plan.delayMs !== null) {
      // Retardo como variable CSS.
      dot.style.setProperty("--d", String(plan.delayMs));
    }
    // Añade el punto.
    loader.appendChild(dot);
  }
}
