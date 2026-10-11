import { MEDIA_LIMITS } from "@thepower-rag/contracts";
import type { ResearchOutcome } from "@thepower-rag/contracts";
import { clauseVerdict } from "./report";

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

function factualText(report: string): string {
  const sections = report.split(/\n\s*\n/);
  const rendered = sections.some((section) =>
    /^\*\*(Respuesta directa\.|Hallazgos con evidencia|Comprobaciones y opciones|Puntos sin resolver|Sin informe\.|Informe parcial\.|Informe no concluyente\.|Fuentes\.)\*\*/.test(
      section,
    ),
  );
  if (!rendered) return report;
  return sections
    .filter((section) =>
      /^\*\*(Respuesta directa\.|Hallazgos con evidencia|Comprobaciones y opciones)\*\*/.test(
        section,
      ),
    )
    .flatMap((section) => section.split("\n"))
    .map((line) =>
      line
        .replace(
          /^\*\*(Respuesta directa\.|Hallazgos con evidencia|Comprobaciones y opciones)\*\*\s*/,
          "",
        )
        .replace(/^-\s+(?:q[1-3]\s*·\s*)?/, "")
        .replace(/\[cite:[^\]\n]+\]/g, "")
        .replace(/[*`]/g, "")
        .trim(),
    )
    .filter(Boolean)
    .join(";\n");
}

/**
 * Selecciona frases completas verificadas de las secciones factuales.
 * No lee las lagunas libres del modelo ni separa cláusulas coordinadas.
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
  const factual = factualText(input.reportText)
    .split(/(?<=[.!?;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
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
