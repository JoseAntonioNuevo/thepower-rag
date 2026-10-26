// GUÍA DE LECTURA · packages/research/src/report.ts
// Verificación del informe de la investigación: cada afirmación del modelo tiene que ser un tramo
// ordenado de un extracto admitido, con las mismas cifras y negaciones. Lo que no pasa se retira
// y el informe deja de ser completo. Al final se compone el texto Markdown con sus citas.
// Límites y tipo del resultado.
import { RESEARCH_LIMITS, type ResearchOutcome } from "@thepower-rag/contracts";
// Autoridad de las fuentes y tipos de evidencia y cobertura.
import { authorityAllows, type AcceptedEvidence, type CoverageEntry } from "./evidence";
// Texto acotado y tipo de subpregunta.
import { boundedText, type PlanItem } from "./plan";
// Causa de cada laguna.
import type { GapCause } from "./policy";

// Afirmación del informe.
export interface ReportClaim {
  // Subpregunta que responde, o null en la respuesta directa.
  subquestionId: string | null;
  // Texto.
  text: string;
  // Fuentes que cita.
  sourceIds: string[];
}

// Afirmación retirada.
export interface DroppedClaim {
  // Texto retirado.
  claim: string;
  // Motivo.
  reason: string;
}

// Informe verificado.
export interface VerifiedReport {
  // Completo, parcial o rechazado.
  outcome: Exclude<ResearchOutcome, "clarify" | "aborted" | "error">;
  // Texto Markdown.
  markdown: string;
  // Fuentes citadas.
  citedSourceIds: string[];
  // Afirmaciones comprobadas.
  checked: number;
  // Afirmaciones retiradas.
  dropped: DroppedClaim[];
}

// Método de comprobación que se documenta en el resumen.
export const CLAIM_CHECK_METHOD =
  "Cada cláusula tiene que ser un tramo ordenado de un extracto admitido. No vale reordenar cifras, cualificar distinto ni omitir una negación.";

// Palabras vacías en español e inglés, sin tildes, que no cuentan como contenido.
const STOPWORDS = new Set(
  [
    // Conectores y verbos frecuentes en español.
    "para",
    "como",
    "este",
    "esta",
    "estos",
    "estas",
    "pero",
    "porque",
    "cuando",
    "donde",
    "desde",
    "hasta",
    "sobre",
    "entre",
    "tiene",
    "tienen",
    "puede",
    "pueden",
    "debe",
    "deben",
    "hace",
    "hacer",
    "otra",
    "otro",
    "cada",
    "todo",
    "toda",
    "todos",
    "todas",
    "solo",
    "también",
    "tambien",
    // Palabras frecuentes en inglés (las páginas técnicas suelen estar en inglés).
    "with",
    "that",
    "this",
    "from",
    "have",
    "your",
    "when",
    "will",
    "into",
    "than",
    "then",
    "they",
    "them",
    // Se quitan las tildes para comparar igual con o sin ellas.
  ].map((word) => word.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
);

// Palabras de contenido de un texto: cifras de 2+ caracteres y palabras de 4+ letras.
export function contentTokens(text: string): Set<string> {
  // Sin tildes y en minúsculas.
  const folded = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  // Palabras encontradas.
  const tokens = new Set<string>();
  // Separa por cualquier carácter que no sea letra o número.
  for (const token of folded.split(/[^a-z0-9]+/)) {
    // ¿Tiene cifras?
    const numeric = /\d/.test(token);
    // Cifras de al menos 2 caracteres o palabras de al menos 4 letras.
    if ((numeric && token.length >= 2) || (!numeric && token.length >= 4)) {
      // Sin palabras vacías.
      if (!STOPWORDS.has(token)) {
        // Añade la palabra.
        tokens.add(token);
      }
    }
  }
  // Palabras de contenido.
  return tokens;
}

// Quita tildes y pasa a minúsculas.
function fold(text: string): string {
  // NFD separa las tildes y la expresión las elimina.
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// Palabras de negación.
const NEGATION = /\b(no|nunca|jamas|tampoco|ningun|ninguna|ninguno|ningunos|ningunas|imposible)\b/;

// Polaridad de un texto: negativa si contiene una negación.
function polarity(text: string): "negative" | "positive" {
  // Busca una negación en el texto sin tildes.
  return NEGATION.test(fold(text)) ? "negative" : "positive";
}

// Divide un texto en oraciones con contenido.
function clauses(text: string): string[] {
  // Corta tras . ! ? o ; y descarta las vacías.
  const parts = text
    .split(/(?<=[.!?;])\s+/)
    .map((part) => part.trim())
    .filter((part) => contentTokens(part).size > 0);
  // Si no queda ninguna, el texto entero.
  return parts.length > 0 ? parts : [text.trim()].filter((part) => part.length > 0);
}

/** Parte una oración en cláusulas coordinadas. No reescribe si un lado no es una afirmación. */
export function atomicClauses(text: string): string[] {
  // Cláusulas resultantes.
  const result: string[] = [];
  // Recorre las oraciones.
  for (const sentence of clauses(text)) {
    // Divide por «y», «pero» o «aunque».
    const raw = sentence
      .split(/\s+(?:y|pero|aunque)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    // Piezas con al menos dos palabras de contenido.
    const pieces = raw.filter((part) => contentTokens(part).size >= 2);
    // Solo se parte si todas las piezas son afirmaciones; si no, la oración entera.
    result.push(...(raw.length > 1 && raw.length === pieces.length ? pieces : [sentence]));
  }
  // Cláusulas, o el texto entero.
  return result.length > 0 ? result : [text.trim()].filter((part) => part.length > 0);
}

// Palabras sin tildes, en minúsculas y en orden.
function wordTokens(text: string): string[] {
  // Separa por cualquier carácter que no sea letra o número.
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** No se puede empezar un tramo justo después de una negación o un cuantificador. */
const SCOPE_TOKENS = new Set([
  // Negaciones.
  "no",
  "nunca",
  "jamas",
  "tampoco",
  "ningun",
  "ninguna",
  "ninguno",
  "ningunos",
  "ningunas",
  // Restricciones y cuantificadores que cambian el sentido.
  "imposible",
  "sin",
  "solo",
  "solamente",
  "exactamente",
  "aproximadamente",
  "casi",
  "siempre",
]);

// ¿Aparece la cláusula como tramo consecutivo del extracto?
function orderedSpan(clause: string, excerpt: string): "ok" | "polarity" | "miss" {
  // Palabras de la cláusula.
  const want = wordTokens(clause);
  // Palabras del extracto.
  const have = wordTokens(excerpt);
  // Vacía o más larga que el extracto.
  if (want.length === 0 || want.length > have.length) {
    // No cabe.
    return "miss";
  }
  // true si aparece pero precedida de una negación o un cuantificador.
  let scoped = false;
  // Prueba cada posición inicial.
  for (let start = 0; start <= have.length - want.length; start += 1) {
    // ¿Coinciden todas las palabras?
    let same = true;
    // Compara palabra a palabra.
    for (let offset = 0; offset < want.length; offset += 1) {
      // Una diferencia.
      if (have[start + offset] !== want[offset]) {
        // No coincide.
        same = false;
        // Deja de comparar.
        break;
      }
    }
    // No coincide aquí.
    if (!same) {
      // Siguiente posición.
      continue;
    }
    // Palabra anterior al tramo.
    const before = start > 0 ? have[start - 1] : undefined;
    // Precedido de negación o cuantificador: cambia el sentido.
    if (before !== undefined && SCOPE_TOKENS.has(before)) {
      // Se recuerda.
      scoped = true;
      // Siguiente posición.
      continue;
    }
    // Tramo válido.
    return "ok";
  }
  // Solo con negación delante, o no aparece.
  return scoped ? "polarity" : "miss";
}

// Veredicto sobre una cláusula: válida, polaridad, cifra, sin relación o añadido.
export type ClauseVerdict = "ok" | "polarity" | "number" | "overlap" | "addition";

/**
 * Fase 1 no acepta paráfrasis. La cláusula tiene que ser un tramo consecutivo
 * del extracto, con el mismo orden, las mismas cifras y la negación que lo rige.
 */
export function clauseVerdict(clause: string, excerpts: readonly string[]): ClauseVerdict {
  // Sin palabras: no hay relación.
  if (wordTokens(clause).length === 0) {
    // Sin relación.
    return "overlap";
  }
  // Todos los extractos juntos.
  const joined = excerpts.join(" ");
  // Toda cifra de la cláusula tiene que aparecer en lo citado.
  if (!numbersPresent(clause, joined)) {
    // Cifra cambiada.
    return "number";
  }
  // true si algún extracto la contiene con una negación delante.
  let scoped = false;
  // Revisa cada extracto.
  for (const excerpt of excerpts) {
    // ¿Es un tramo de este extracto?
    const span = orderedSpan(clause, excerpt);
    // Sí.
    if (span === "ok") {
      // Válida.
      return "ok";
    }
    // Aparece negada.
    if (span === "polarity") {
      // Se recuerda.
      scoped = true;
    }
  }
  // Solo aparece negada.
  if (scoped) {
    // Polaridad opuesta.
    return "polarity";
  }
  // Comparte vocabulario pero no es un tramo: añadido; si no, sin relación.
  return overlaps(contentTokens(clause), joined) ? "addition" : "overlap";
}

// ¿Comparte el texto suficiente vocabulario con la afirmación?
function overlaps(claimTokens: Set<string>, text: string): boolean {
  // Palabras de la evidencia.
  const evidenceTokens = contentTokens(text);
  // Palabras compartidas.
  let shared = 0;
  // Recorre las palabras de la afirmación.
  for (const token of claimTokens) {
    // Si aparece en la evidencia.
    if (evidenceTokens.has(token)) {
      // Cuenta.
      shared += 1;
    }
  }
  // Al menos dos compartidas y un 30 % de las de la afirmación.
  return claimTokens.size > 0 && shared >= 2 && shared / claimTokens.size >= 0.3;
}

// ¿Aparecen en la evidencia todas las cifras de la afirmación?
function numbersPresent(claim: string, evidence: string): boolean {
  // Cifras de la evidencia.
  const have = new Set(fold(evidence).match(/\d+(?:[.,]\d+)?/g) ?? []);
  // Cifras de la afirmación.
  const want = fold(claim).match(/\d+(?:[.,]\d+)?/g) ?? [];
  // Todas presentes.
  return want.every((token) => have.has(token));
}

// Veredicto de apoyo léxico de una afirmación.
export type ClaimSupport = "supported" | "empty" | "overlap" | "polarity" | "number";

/**
 * El solapamiento léxico no verifica una afirmación cuyo sentido o cuyas cifras
 * contradicen el extracto. Una coincidencia de palabras con polaridad opuesta
 * no cuenta como apoyo.
 */
export function claimSupportVerdict(claim: string, evidence: readonly string[]): ClaimSupport {
  // Palabras de la afirmación.
  const claimTokens = contentTokens(claim);
  // Sin contenido.
  if (claimTokens.size === 0) {
    // Vacía.
    return "empty";
  }
  // Evidencia junta.
  const joined = evidence.join(" ");
  // Cifras cambiadas.
  if (!numbersPresent(claim, joined)) {
    // Rechazo por cifra.
    return "number";
  }
  // Oraciones de la evidencia.
  const spans = evidence.flatMap((item) => clauses(item));
  // Si no hay oraciones, la evidencia entera.
  const usable = spans.length > 0 ? spans : [joined];
  // Revisa cada oración de la afirmación.
  for (const part of clauses(claim)) {
    // Palabras de la oración.
    const tokens = contentTokens(part);
    // Sin contenido.
    if (tokens.size === 0) {
      // Siguiente.
      continue;
    }
    // Polaridad de la oración.
    const partPolarity = polarity(part);
    // Hay apoyo con la misma polaridad.
    let same = false;
    // Hay apoyo con polaridad opuesta.
    let opposite = false;
    // Revisa cada oración de la evidencia.
    for (const span of usable) {
      // Sin vocabulario común.
      if (!overlaps(tokens, span)) {
        // Siguiente.
        continue;
      }
      // Misma polaridad.
      if (polarity(span) === partPolarity) {
        // Apoyo.
        same = true;
      } else {
        // Polaridad opuesta.
        opposite = true;
      }
    }
    // Sin apoyo con la misma polaridad.
    if (!same) {
      // Polaridad opuesta o sin relación.
      return opposite ? "polarity" : "overlap";
    }
  }
  // Todas las oraciones tienen apoyo.
  return "supported";
}

/** Comprueba que la afirmación comparte vocabulario suficiente con lo que cita. */
export function claimSupported(claim: string, evidence: readonly string[]): boolean {
  // Comprobación booleana.
  return claimSupportVerdict(claim, evidence) === "supported";
}

// Objeto plano o null.
function record(value: unknown): Record<string, unknown> | null {
  // Rechaza null, arrays y no objetos.
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// Marca de cita [cite:…].
const CITE = /\[cite:[^\]]*\]/g;

// Texto sin marcas de cita y con tope, o null.
function cleanClaim(value: unknown, max: number): string | null {
  // Quita las citas y recorta.
  return typeof value === "string" ? boundedText(value.replace(CITE, " "), max) : null;
}

// Ids de texto sin repetir, con un máximo.
function ids(value: unknown): string[] {
  // Debe ser una lista.
  if (!Array.isArray(value)) {
    // Sin ids.
    return [];
  }
  // Filtra textos, quita repetidos y recorta.
  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(
    0,
    RESEARCH_LIMITS.maxEvidenceItems,
  );
}

// Texto de cada causa de laguna para el informe.
const CAUSE_LABEL: Record<GapCause, string> = {
  evidence: "con evidencia",
  "missing-evidence": "no consta en la evidencia admitida",
  "operational-failure": "no se pudo comprobar por un fallo operativo, no por falta de evidencia",
  "not-allowed": "las fuentes externas no pueden documentar un dato interno de la tienda",
};

/**
 * Valida el informe estructurado del modelo y lo convierte en texto con citas.
 * Solo se citan ids admitidos que apoyan la subpregunta de cada hallazgo. Una
 * afirmación que no supera la comprobación se retira y el informe deja de ser
 * completo.
 */
export function verifyReport(
  raw: unknown,
  input: {
    // Subpreguntas.
    subquestions: readonly PlanItem[];
    // Cobertura.
    coverage: readonly CoverageEntry[];
    // Causa de cada laguna.
    causes: Readonly<Record<string, GapCause>>;
    // Evidencia aceptada.
    accepted: readonly AcceptedEvidence[];
    // Contradicciones.
    contradictions: readonly string[];
    // true si viene de la demo.
    fixture: boolean;
    // true si la investigación paró por un fallo.
    stopIsFailure: boolean;
  },
): { ok: true; value: VerifiedReport } | { ok: false; reason: string } {
  // Informe como objeto.
  const body = record(raw);
  // Respuesta directa.
  const answer = record(body?.answer);
  // Debe traer respuesta, hallazgos y comprobaciones.
  if (
    body === null ||
    answer === null ||
    !Array.isArray(body.findings) ||
    !Array.isArray(body.checks)
  ) {
    // Rechazo.
    return { ok: false, reason: "El informe no tiene la forma esperada." };
  }
  // No más hallazgos ni comprobaciones que el máximo.
  if (
    body.findings.length > RESEARCH_LIMITS.maxFindings ||
    body.checks.length > RESEARCH_LIMITS.maxChecks
  ) {
    // Rechazo.
    return { ok: false, reason: "El informe supera el número de hallazgos permitido." };
  }
  // Evidencia aceptada por id.
  const byId = new Map(input.accepted.map((entry) => [entry.item.sourceId, entry]));
  // Subpreguntas por id.
  const subById = new Map<string, PlanItem>(input.subquestions.map((item) => [item.id, item]));
  // Cobertura por subpregunta.
  const coverageById = new Map(input.coverage.map((entry) => [entry.subquestionId, entry]));
  // Afirmaciones retiradas.
  const dropped: DroppedClaim[] = [];
  // Fuentes citadas.
  const cited = new Set<string>();
  // Afirmaciones comprobadas.
  let checked = 0;

  // Retiradas que se registran como máximo.
  const dropLimit = RESEARCH_LIMITS.maxFindings + RESEARCH_LIMITS.maxChecks + 1;
  // Registra una afirmación retirada.
  const drop = (claim: string, reason: string) => {
    // Si queda sitio.
    if (dropped.length < dropLimit) {
      // Se guarda.
      dropped.push({ claim, reason });
    }
  };

  // Extractos de las fuentes citadas que apoyan una subpregunta cubierta.
  const admittedExcerpts = (sourceIds: readonly string[], subquestionId: string | null) => {
    // Extractos.
    const excerpts: string[] = [];
    // Recorre las fuentes citadas.
    for (const sourceId of sourceIds) {
      // Evidencia aceptada.
      const entry = byId.get(sourceId);
      // No admitida.
      if (entry === undefined) {
        // Siguiente.
        continue;
      }
      // ¿Apoya alguna subpregunta válida?
      const supports = entry.subquestionIds.some((id) => {
        // Si se pide una subpregunta concreta, solo esa.
        if (subquestionId !== null && id !== subquestionId) {
          // Otra subpregunta.
          return false;
        }
        // Subpregunta.
        const sub = subById.get(id as PlanItem["id"]);
        // Su cobertura.
        const coverage = coverageById.get(id);
        // Existe, está cubierta y la fuente tiene autoridad.
        return (
          sub !== undefined &&
          coverage !== undefined &&
          coverage.status !== "uncovered" &&
          authorityAllows(entry.item.kind, sub)
        );
      });
      // Si apoya.
      if (supports) {
        // Añade sus extractos.
        excerpts.push(...entry.excerpts);
      }
    }
    // Extractos admitidos.
    return excerpts;
  };

  // Motivo legible de cada veredicto.
  const clauseReason = (verdict: ClauseVerdict) => {
    // Polaridad.
    if (verdict === "polarity") {
      // Mensaje.
      return "La afirmación contradice la polaridad de lo citado.";
    }
    // Cifra.
    if (verdict === "number") {
      // Mensaje.
      return "La afirmación cambia una cifra que no está en lo citado.";
    }
    // Añadido.
    if (verdict === "addition") {
      // Mensaje.
      return "La cláusula no es un tramo ordenado del extracto admitido.";
    }
    // Sin relación.
    return "La afirmación no comparte contenido suficiente con lo que cita.";
  };

  /**
   * La fuente cita un tema. La cláusula tiene que caber en el extracto de una
   * subpregunta cubierta que esa fuente puede apoyar. Si no, se retira sola.
   */
  const verifyClaim = (claim: ReportClaim): string | null => {
    // Una afirmación más comprobada.
    checked += 1;
    // Sin fuentes.
    if (claim.sourceIds.length === 0) {
      // Se retira.
      drop(claim.text, "La afirmación no cita evidencia admitida.");
      // No se usa.
      return null;
    }
    // Id citado que no está admitido.
    const unknown = claim.sourceIds.find((id) => !byId.has(id));
    // Si lo hay.
    if (unknown !== undefined) {
      // Se retira.
      drop(claim.text, `Cita un id no admitido: ${unknown.slice(0, 64)}.`);
      // No se usa.
      return null;
    }
    // Afirmación de una subpregunta concreta.
    if (claim.subquestionId !== null) {
      // Subpregunta.
      const sub = subById.get(claim.subquestionId as PlanItem["id"]);
      // Su cobertura.
      const coverage = coverageById.get(claim.subquestionId);
      // Debe existir y estar cubierta.
      if (sub === undefined || coverage === undefined || coverage.status === "uncovered") {
        // Se retira.
        drop(claim.text, "La subpregunta no tiene evidencia admitida.");
        // No se usa.
        return null;
      }
      // ¿Alguna fuente citada apoya esa subpregunta con autoridad?
      const support = claim.sourceIds.some((sourceId) => {
        // Evidencia citada.
        const entry = byId.get(sourceId);
        // Debe existir, cubrir esa subpregunta y tener autoridad para ella.
        return (
          entry !== undefined &&
          entry.subquestionIds.includes(sub.id) &&
          authorityAllows(entry.item.kind, sub)
        );
      });
      // Ninguna la apoya.
      if (!support) {
        // Se retira.
        drop(claim.text, "La fuente citada no apoya esa subpregunta.");
        // No se usa.
        return null;
      }
    }
    // Extractos admitidos.
    const excerpts = admittedExcerpts(claim.sourceIds, claim.subquestionId);
    // Sin extractos.
    if (excerpts.length === 0) {
      // Se retira.
      drop(claim.text, "La afirmación no se relaciona con una subpregunta cubierta.");
      // No se usa.
      return null;
    }
    // Cláusulas de la afirmación.
    const pieces = atomicClauses(claim.text);
    // Cláusulas que pasan.
    const kept: string[] = [];
    // Revisa cada cláusula.
    for (const piece of pieces) {
      // Veredicto.
      const verdict = clauseVerdict(piece, excerpts);
      // Válida.
      if (verdict === "ok") {
        // Se conserva.
        kept.push(piece);
      } else {
        // Se retira con su motivo.
        drop(piece, clauseReason(verdict));
      }
    }
    // Ninguna válida.
    if (kept.length === 0) {
      // No se usa.
      return null;
    }
    // Marca las fuentes como citadas.
    for (const id of claim.sourceIds) {
      // Citada.
      cited.add(id);
    }
    // Afirmación completa o solo las cláusulas válidas.
    return kept.length === pieces.length ? claim.text : kept.join(". ");
  };

  // Respuesta directa limpia.
  const answerText = cleanClaim(answer.text, RESEARCH_LIMITS.maxAnswerChars);
  // Sin respuesta directa.
  if (answerText === null) {
    // Rechazo.
    return { ok: false, reason: "El informe no trae una respuesta directa." };
  }
  // Comprueba la respuesta directa.
  const answerKept = verifyClaim({
    subquestionId: null,
    text: answerText,
    sourceIds: ids(answer.sourceIds),
  });
  // ¿Pasó la respuesta directa?
  const answerOk = answerKept !== null;

  // Hallazgos verificados.
  const findings: ReportClaim[] = [];
  // Revisa cada hallazgo.
  for (const entry of body.findings) {
    // Fila como objeto.
    const row = record(entry);
    // Texto limpio.
    const text = cleanClaim(row?.text, RESEARCH_LIMITS.maxClaimChars);
    // Subpregunta.
    const subquestionId = typeof row?.subquestionId === "string" ? row.subquestionId : null;
    // Debe tener texto y subpregunta.
    if (text === null || subquestionId === null) {
      // Rechazo.
      return { ok: false, reason: "Un hallazgo no tiene texto o subpregunta." };
    }
    // Comprueba el hallazgo.
    const kept = verifyClaim({ subquestionId, text, sourceIds: ids(row?.sourceIds) });
    // Si pasa.
    if (kept !== null) {
      // Se guarda.
      findings.push({ subquestionId, text: kept, sourceIds: ids(row?.sourceIds) });
    }
  }
  // Comprobaciones verificadas.
  const checks: ReportClaim[] = [];
  // Revisa cada comprobación.
  for (const entry of body.checks) {
    // Fila como objeto.
    const row = record(entry);
    // Texto limpio.
    const text = cleanClaim(row?.text, RESEARCH_LIMITS.maxClaimChars);
    // Sin texto.
    if (text === null) {
      // Rechazo.
      return { ok: false, reason: "Una comprobación no tiene texto." };
    }
    // Fuentes citadas.
    const sourceIds = ids(row?.sourceIds);
    // Comprueba.
    const kept = verifyClaim({ subquestionId: null, text, sourceIds });
    // Si pasa.
    if (kept !== null) {
      // Se guarda.
      checks.push({ subquestionId: null, text: kept, sourceIds });
    }
  }

  // Marcas de cita de una lista de fuentes.
  const cite = (sourceIds: readonly string[]) => sourceIds.map((id) => `[cite:${id}]`).join(" ");
  // Puntos sin resolver.
  const unresolved: string[] = [];
  // Subpreguntas no cubiertas.
  for (const sub of input.subquestions) {
    // Cobertura.
    const coverage = coverageById.get(sub.id);
    // Cubiertas o desconocidas: se saltan.
    if (coverage === undefined || coverage.status === "covered") {
      // Siguiente.
      continue;
    }
    // Causa de la laguna.
    const cause = input.causes[sub.id] ?? "missing-evidence";
    // Línea con estado, causa y laguna.
    unresolved.push(
      `${sub.id} · ${sub.text} (${coverage.status === "partial" ? "parcial" : "sin cubrir"}: ${CAUSE_LABEL[cause]}).${coverage.gap === null ? "" : ` ${coverage.gap}`}`,
    );
  }
  // Subpreguntas cubiertas sin hallazgo verificado.
  for (const sub of input.subquestions) {
    // Si no tienen hallazgo.
    if (
      coverageById.get(sub.id)?.status === "covered" &&
      !findings.some((item) => item.subquestionId === sub.id)
    ) {
      // Se informa.
      unresolved.push(`${sub.id} · ${sub.text} (sin hallazgo verificado en el informe).`);
    }
  }
  // Puntos sin resolver que propone el modelo.
  if (Array.isArray(body.unresolved)) {
    // Como mucho el máximo.
    for (const item of body.unresolved.slice(0, RESEARCH_LIMITS.maxUnresolved)) {
      // Texto limpio.
      const text = cleanClaim(item, RESEARCH_LIMITS.maxReasonChars);
      // Si cabe.
      if (text !== null && unresolved.length < RESEARCH_LIMITS.maxUnresolved + 3) {
        // Se añade.
        unresolved.push(text);
      }
    }
  }

  // ¿Todo cubierto?
  const allCovered = input.coverage.every((entry) => entry.status === "covered");
  // ¿Cada subpregunta tiene hallazgo?
  const everyAnswered = input.subquestions.every((sub) =>
    findings.some((item) => item.subquestionId === sub.id),
  );
  // ¿Hay contradicciones?
  const contradicted = input.contradictions.length > 0;
  // Completo solo si todo pasa; parcial si queda algo verificado; si no, rechazado.
  const outcome: VerifiedReport["outcome"] =
    answerOk &&
    allCovered &&
    everyAnswered &&
    dropped.length === 0 &&
    !input.stopIsFailure &&
    !contradicted
      ? "complete"
      : findings.length > 0 || answerOk
        ? "partial"
        : "refused";

  // Líneas del informe.
  const lines: string[] = [];
  // Aviso de informe de prueba.
  if (input.fixture) {
    // Texto del aviso.
    lines.push(
      "**Informe de prueba.** Adaptadores fijos: demuestra el control del grafo, no la calidad de un modelo ni una investigación real en internet.",
      "",
    );
  }
  // Aviso de informe no concluyente.
  if (contradicted) {
    // Texto del aviso.
    lines.push(
      "**Informe no concluyente.** Hay una contradicción relevante sin resolver. No es un informe completo.",
      "",
    );
  }
  // Parcial sin contradicción.
  if (outcome === "partial" && !contradicted) {
    // Aviso.
    lines.push("**Informe parcial.** Parte de la pregunta queda sin evidencia verificada.", "");
  }
  // Parcial con contradicción.
  if (outcome === "partial" && contradicted) {
    // Aviso.
    lines.push("**Informe parcial.** La contradicción impide dar la pregunta por cerrada.", "");
  }
  // Rechazado.
  if (outcome === "refused") {
    // Aviso.
    lines.push(
      "**Sin informe.** Ninguna afirmación del borrador superó la comprobación con la evidencia admitida.",
      "",
    );
  }
  // Respuesta directa verificada.
  if (answerKept !== null) {
    // Con sus citas.
    lines.push(`**Respuesta directa.** ${answerKept} ${cite(ids(answer.sourceIds))}`, "");
  } else if (outcome !== "refused") {
    // Respuesta no mostrada.
    lines.push(
      "**Respuesta directa.** No se muestra: no superó la comprobación con sus fuentes. Consulta los hallazgos verificados.",
      "",
    );
  }
  // Hallazgos.
  if (findings.length > 0) {
    // Título.
    lines.push("**Hallazgos con evidencia**");
    // Cada hallazgo.
    for (const item of findings) {
      // Con su subpregunta y citas.
      lines.push(`- ${item.subquestionId} · ${item.text} ${cite(item.sourceIds)}`);
    }
    // Línea en blanco.
    lines.push("");
  }
  // Comprobaciones.
  if (checks.length > 0) {
    // Título.
    lines.push("**Comprobaciones y opciones**");
    // Cada comprobación.
    for (const item of checks) {
      // Con sus citas.
      lines.push(`- ${item.text} ${cite(item.sourceIds)}`);
    }
    // Línea en blanco.
    lines.push("");
  }
  // Puntos sin resolver.
  if (unresolved.length > 0) {
    // Título.
    lines.push("**Puntos sin resolver**");
    // Cada punto.
    for (const item of unresolved) {
      // Viñeta.
      lines.push(`- ${item}`);
    }
    // Línea en blanco.
    lines.push("");
  }
  // Contradicciones.
  if (contradicted) {
    // Título.
    lines.push("**Contradicciones sin resolver**");
    // Cada contradicción.
    for (const item of input.contradictions) {
      // Viñeta.
      lines.push(`- ${item}`);
    }
    // Línea en blanco.
    lines.push("");
  }
  // Aviso de afirmaciones retiradas.
  if (dropped.length > 0) {
    // Texto con el recuento.
    lines.push(
      `**Comprobación de afirmaciones.** Se retiraron ${String(dropped.length)} afirmaciones del borrador. El detalle está en la traza.`,
      "",
    );
  }
  // Nota final sobre las fuentes.
  lines.push("**Fuentes.** Solo las citadas, en el panel lateral, con sus extractos.");
  // Informe verificado.
  return {
    ok: true,
    value: {
      outcome,
      markdown: lines.join("\n").trim(),
      citedSourceIds: [...cited],
      checked,
      dropped,
    },
  };
}
