// GUÍA DE LECTURA · apps/web/src/research-labels.ts
// Textos en español para mostrar los valores del resumen de investigación y formatos pequeños.
// Tipo del resumen.
import type { ResearchSummary } from "@thepower-rag/contracts";

// Texto de cada resultado.
export const OUTCOME_LABEL: Record<ResearchSummary["outcome"], string> = {
  complete: "Informe completo",
  partial: "Informe parcial",
  refused: "Sin informe: falta evidencia",
  clarify: "Hace falta una aclaración",
  error: "Error operativo",
  aborted: "Cancelado por el usuario",
};

// Texto de cada motivo de parada.
export const STOP_LABEL: Record<ResearchSummary["stop"], string> = {
  // Paradas normales.
  "all-covered": "Todas las subpreguntas tienen evidencia",
  "course-answer": "Respuesta con el material del curso, sin búsqueda externa",
  clarify: "Falta información para empezar",
  // Topes del laboratorio.
  "max-rounds": "Máximo de rondas alcanzado",
  "search-budget": "Sin búsquedas externas disponibles",
  "page-budget": "Sin lecturas de páginas disponibles",
  deadline: "Plazo total agotado",
  // Falta de progreso o de lagunas concretas.
  "no-progress": "La ronda de seguimiento no añadió evidencia",
  "repeated-queries": "Las consultas de seguimiento repetían búsquedas",
  "no-specific-gap": "No queda una laguna con búsqueda concreta",
  // Fallos y cancelación.
  "provider-failure": "Fallo operativo de búsqueda o lectura",
  "model-failure": "Fallo de una llamada de modelo",
  "invalid-output": "Salida del modelo no válida",
  aborted: "Petición detenida",
  // Nada sostenido o contradicción.
  "nothing-supported": "Ninguna afirmación superó la comprobación",
  "unresolved-contradiction": "Contradicción sin resolver",
};

// Texto de cada ruta.
export const ROUTE_LABEL: Record<NonNullable<ResearchSummary["route"]>, string> = {
  course: "Material del curso",
  tool: "Herramienta de sesión",
  investigate: "Investigación externa acotada",
  clarify: "Aclaración",
};

// Tipo de subpregunta.
export const KIND_LABEL = {
  course: "Curso",
  session: "Sesión",
  technical: "Técnica",
} as const;

// Estado de cobertura.
export const COVERAGE_LABEL = {
  covered: "cubierta",
  partial: "parcial",
  uncovered: "sin cubrir",
} as const;

// Causa de una laguna.
export const CAUSE_LABEL = {
  evidence: "con evidencia",
  "missing-evidence": "falta evidencia",
  "operational-failure": "fallo operativo",
  "not-allowed": "fuente no autorizada",
} as const;

// Decisión sobre una URL descubierta.
export const DECISION_LABEL = {
  selected: "seleccionada",
  "not-allowed": "dominio no permitido",
  duplicate: "duplicada",
  "already-read": "ya leída",
  "over-budget": "fuera del tope",
} as const;

// Tipo de fuente.
export const SOURCE_KIND_LABEL = {
  course: "Curso",
  tool: "Herramienta",
  web: "Web",
  attachment: "Entrada del alumno",
} as const;

// Importe en USD con 4 decimales, o por qué no hay.
export function money(value: number | null, measured: boolean): string {
  // Sin medir.
  if (!measured) {
    // Texto.
    return "no medido";
  }
  // Desconocido o importe.
  return value === null ? "desconocido" : `${value.toFixed(4)} USD`;
}

// Hash recortado.
export function shortHash(hash: string | null): string {
  // 15 caracteres y puntos suspensivos.
  return hash === null ? "sin hash" : `${hash.slice(0, 15)}…`;
}

// Dominio de una URL.
export function hostOf(url: string): string {
  // Si no es URL, se devuelve tal cual.
  try {
    // Host.
    return new URL(url).hostname;
  } catch {
    // Texto original.
    return url;
  }
}
