import type { ResearchSummary } from "@thepower-rag/contracts";

export const OUTCOME_LABEL: Record<ResearchSummary["outcome"], string> = {
  complete: "Informe completo",
  partial: "Informe parcial",
  refused: "Sin informe: falta evidencia",
  clarify: "Hace falta una aclaración",
  error: "Error operativo",
  aborted: "Cancelado por el usuario",
};

export const STOP_LABEL: Record<ResearchSummary["stop"], string> = {
  "all-covered": "Todas las subpreguntas tienen evidencia",
  "course-answer": "Respuesta con el material del curso, sin búsqueda externa",
  clarify: "Falta información para empezar",
  "max-rounds": "Máximo de rondas alcanzado",
  "search-budget": "Sin búsquedas externas disponibles",
  "page-budget": "Sin lecturas de páginas disponibles",
  deadline: "Plazo total agotado",
  "no-progress": "La ronda de seguimiento no añadió evidencia",
  "repeated-queries": "Las consultas de seguimiento repetían búsquedas",
  "no-specific-gap": "No queda una laguna con búsqueda concreta",
  "provider-failure": "Fallo operativo de búsqueda o lectura",
  "model-failure": "Fallo de una llamada de modelo",
  "invalid-output": "Salida del modelo no válida",
  aborted: "Petición detenida",
  "nothing-supported": "Ninguna afirmación superó la comprobación",
  "unresolved-contradiction": "Contradicción sin resolver",
};

export const ROUTE_LABEL: Record<NonNullable<ResearchSummary["route"]>, string> = {
  course: "Material del curso",
  tool: "Herramienta de sesión",
  investigate: "Investigación externa acotada",
  clarify: "Aclaración",
};

export const KIND_LABEL = {
  course: "Curso",
  session: "Sesión",
  technical: "Técnica",
} as const;

export const COVERAGE_LABEL = {
  covered: "cubierta",
  partial: "parcial",
  uncovered: "sin cubrir",
} as const;

export const CAUSE_LABEL = {
  evidence: "con evidencia",
  "missing-evidence": "falta evidencia",
  "operational-failure": "fallo operativo",
  "not-allowed": "fuente no autorizada",
} as const;

export const DECISION_LABEL = {
  selected: "seleccionada",
  "not-allowed": "dominio no permitido",
  duplicate: "duplicada",
  "already-read": "ya leída",
  "over-budget": "fuera del tope",
} as const;

export const SOURCE_KIND_LABEL = {
  course: "Curso",
  tool: "Herramienta",
  web: "Web",
  attachment: "Entrada del alumno",
} as const;

export function money(value: number | null, measured: boolean): string {
  if (!measured) {
    return "no medido";
  }
  return value === null ? "desconocido" : `${value.toFixed(4)} USD`;
}

export function shortHash(hash: string | null): string {
  return hash === null ? "sin hash" : `${hash.slice(0, 15)}…`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
