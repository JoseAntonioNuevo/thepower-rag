import { MEDIA_LIMITS } from "@thepower-rag/contracts";
import type { ResearchOutcome } from "@thepower-rag/contracts";
import { atomicClauses, clauseVerdict } from "./report";

const STATUS: Partial<Record<ResearchOutcome, string>> = {
  partial: "El informe es parcial y no cubre todo lo preguntado.",
  clarify: "Hace falta aclarar la petición antes de dar una respuesta.",
  refused: "No hay un informe que se pueda sostener con la evidencia admitida.",
  error: "La investigación terminó con un error.",
  aborted: "La investigación se interrumpió.",
};

const CONSULT =
  "El informe verificado no tiene una frase que se pueda leer en voz sin parafrasear. Consulta el informe.";

function spanishish(text: string): boolean {
  return /[áéíóúñ¿¡]/i.test(text) || /\b(el|la|los|que|para|con|una|del)\b/i.test(text);
}

/**
 * Selecciona cláusulas ya verificadas. No resume ni añade hechos.
 * Las frases de estado son fijas y no hablan de una norma del curso.
 */
export function spokenScript(input: {
  outcome: ResearchOutcome;
  reportText: string;
  excerpts: readonly string[];
  conflict: string | null;
  perceptionFailed: boolean;
}): string {
  const sentences: string[] = [];
  if (input.perceptionFailed) {
    sentences.push("No se pudo leer toda la entrada.");
  } else if (input.conflict) {
    sentences.push("La imagen y el audio no coinciden.");
  }
  const status = STATUS[input.outcome];
  if (status !== undefined && sentences.length < MEDIA_LIMITS.maxSpeechSentences) {
    sentences.push(status);
  }
  const factual = atomicClauses(input.reportText)
    .filter((clause) => clauseVerdict(clause, input.excerpts) === "ok")
    .sort((left, right) => Number(spanishish(right)) - Number(spanishish(left)));
  for (const clause of factual) {
    if (sentences.length >= MEDIA_LIMITS.maxSpeechSentences) {
      break;
    }
    const next = [...sentences, clause.endsWith(".") ? clause : `${clause}.`].join(" ");
    if (next.length > MEDIA_LIMITS.maxSpeechChars) {
      break;
    }
    sentences.push(clause.endsWith(".") ? clause : `${clause}.`);
  }
  const hasFact = sentences.some((sentence) => clauseVerdict(sentence, input.excerpts) === "ok");
  if (!hasFact && sentences.length < MEDIA_LIMITS.maxSpeechSentences) {
    sentences.push(CONSULT);
  }
  return sentences.join(" ").slice(0, MEDIA_LIMITS.maxSpeechChars);
}
