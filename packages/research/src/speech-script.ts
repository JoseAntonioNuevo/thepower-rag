// GUÍA DE LECTURA · packages/research/src/speech-script.ts
// Guion de la locución opcional de S12: solo lee frases completas del informe que estén
// respaldadas por los extractos citados, con un máximo de frases y caracteres.
// Límites de la voz.
import { MEDIA_LIMITS } from "@thepower-rag/contracts";
// Tipo del resultado de la investigación.
import type { ResearchOutcome } from "@thepower-rag/contracts";
// Comprueba si una frase está respaldada por los extractos.
import { clauseVerdict } from "./report";

// Frases fijas de estado según cómo terminó la investigación.
const STATUS: Partial<Record<ResearchOutcome, string>> = {
  partial: "El informe es parcial y no cubre todo lo preguntado.",
  clarify: "Hace falta aclarar la petición antes de dar una respuesta.",
  refused: "No hay un informe que se pueda sostener con la evidencia admitida.",
  error: "La investigación terminó con un error.",
  aborted: "La investigación se interrumpió.",
};

// Frase para cuando no hay nada verificado que leer.
const CONSULT =
  "El informe verificado no tiene una frase que se pueda leer en voz sin parafrasear. Consulta el informe.";

// ¿Parece texto en español? Se usa para preferir esas frases.
function spanishish(text: string): boolean {
  // Tildes, eñes, signos de apertura o palabras frecuentes.
  return /[áéíóúñ¿¡]/i.test(text) || /\b(el|la|los|que|para|con|una|del)\b/i.test(text);
}

// Extrae del informe solo las secciones factuales, ya limpias para leerlas.
function factualText(report: string): string {
  // Secciones separadas por líneas en blanco.
  const sections = report.split(/\n\s*\n/);
  // ¿Tiene el informe las secciones con título en negrita?
  const rendered = sections.some((section) =>
    /^\*\*(Respuesta directa\.|Hallazgos con evidencia|Comprobaciones y opciones|Puntos sin resolver|Sin informe\.|Informe parcial\.|Informe no concluyente\.|Fuentes\.)\*\*/.test(
      section,
    ),
  );
  // Sin secciones conocidas se usa el texto tal cual.
  if (!rendered) return report;
  // Solo respuesta, hallazgos y comprobaciones; sin títulos, viñetas, citas ni negritas.
  return (
    sections
      // Se queda con las tres secciones que se pueden leer en voz alta.
      .filter((section) =>
        /^\*\*(Respuesta directa\.|Hallazgos con evidencia|Comprobaciones y opciones)\*\*/.test(
          section,
        ),
      )
      // Cada línea por separado.
      .flatMap((section) => section.split("\n"))
      .map((line) =>
        // Quita el título de la sección, las viñetas con id de subpregunta, las citas y el formato.
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
      // Descarta líneas vacías y une con «;» para marcar pausas.
      .filter(Boolean)
      .join(";\n")
  );
}

/**
 * Selecciona frases completas verificadas de las secciones factuales.
 * No lee las lagunas libres del modelo ni separa cláusulas coordinadas.
 * Las frases de estado son fijas y no hablan de una norma del curso.
 */
export function spokenScript(input: {
  // Cómo terminó la investigación.
  outcome: ResearchOutcome;
  // Texto del informe en Markdown.
  reportText: string;
  // Extractos citados que respaldan las frases.
  excerpts: readonly string[];
  // Conflicto entre imagen y audio, o null.
  conflict: string | null;
  // true si falló la lectura de algún medio.
  perceptionFailed: boolean;
}): string {
  // Frases que se leerán.
  const sentences: string[] = [];
  // Si falló la lectura de algún medio, se avisa primero.
  if (input.perceptionFailed) {
    // Aviso de lectura incompleta.
    sentences.push("No se pudo leer toda la entrada.");
  } else if (input.conflict) {
    // Aviso de conflicto entre imagen y audio.
    sentences.push("La imagen y el audio no coinciden.");
  }
  // Frase de estado del resultado.
  const status = STATUS[input.outcome];
  // Si hay frase de estado y cabe.
  if (status !== undefined && sentences.length < MEDIA_LIMITS.maxSpeechSentences) {
    // Se añade.
    sentences.push(status);
  }
  // Frases factuales respaldadas, primero las que parecen en español.
  const factual = factualText(input.reportText)
    .split(/(?<=[.!?;])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .filter((clause) => clauseVerdict(clause, input.excerpts) === "ok")
    .sort((left, right) => Number(spanishish(right)) - Number(spanishish(left)));
  // Añade frases mientras quepan.
  for (const clause of factual) {
    // Máximo de frases alcanzado.
    if (sentences.length >= MEDIA_LIMITS.maxSpeechSentences) {
      // Termina.
      break;
    }
    // Quita los punto y coma finales.
    const clean = clause.replace(/;+$/, "").trimEnd();
    // Termina la frase con punto si no lo tiene.
    const sentence = /[.!?]$/.test(clean) ? clean : `${clean}.`;
    // Texto resultante si se añade.
    const next = [...sentences, sentence].join(" ");
    // Superaría el máximo de caracteres.
    if (next.length > MEDIA_LIMITS.maxSpeechChars) {
      // Termina.
      break;
    }
    // Añade la frase.
    sentences.push(sentence);
  }
  // ¿Hay al menos una frase respaldada?
  const hasFact = sentences.some((sentence) => clauseVerdict(sentence, input.excerpts) === "ok");
  // Si no, se remite al informe.
  if (!hasFact && sentences.length < MEDIA_LIMITS.maxSpeechSentences) {
    // Frase para consultar el informe.
    sentences.push(CONSULT);
  }
  // Guion final recortado al máximo de caracteres.
  return sentences.join(" ").slice(0, MEDIA_LIMITS.maxSpeechChars);
}
