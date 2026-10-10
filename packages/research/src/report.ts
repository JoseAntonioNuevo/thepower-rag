import { RESEARCH_LIMITS, type ResearchOutcome } from "@thepower-rag/contracts";
import { authorityAllows, type AcceptedEvidence, type CoverageEntry } from "./evidence";
import { boundedText, type PlanItem } from "./plan";
import type { GapCause } from "./policy";

export interface ReportClaim {
  subquestionId: string | null;
  text: string;
  sourceIds: string[];
}

export interface DroppedClaim {
  claim: string;
  reason: string;
}

export interface VerifiedReport {
  outcome: Exclude<ResearchOutcome, "clarify" | "aborted" | "error">;
  markdown: string;
  citedSourceIds: string[];
  checked: number;
  dropped: DroppedClaim[];
}

export const CLAIM_CHECK_METHOD =
  "Cada cláusula tiene que ser un tramo ordenado de un extracto admitido. No vale reordenar cifras, cualificar distinto ni omitir una negación.";

const STOPWORDS = new Set(
  [
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
  ].map((word) => word.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
);

export function contentTokens(text: string): Set<string> {
  const folded = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = new Set<string>();
  for (const token of folded.split(/[^a-z0-9]+/)) {
    const numeric = /\d/.test(token);
    if ((numeric && token.length >= 2) || (!numeric && token.length >= 4)) {
      if (!STOPWORDS.has(token)) {
        tokens.add(token);
      }
    }
  }
  return tokens;
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const NEGATION = /\b(no|nunca|jamas|tampoco|ningun|ninguna|ninguno|ningunos|ningunas|imposible)\b/;

function polarity(text: string): "negative" | "positive" {
  return NEGATION.test(fold(text)) ? "negative" : "positive";
}

function clauses(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?;])\s+/)
    .map((part) => part.trim())
    .filter((part) => contentTokens(part).size > 0);
  return parts.length > 0 ? parts : [text.trim()].filter((part) => part.length > 0);
}

/** Parte una oración en cláusulas coordinadas. No reescribe si un lado no es una afirmación. */
export function atomicClauses(text: string): string[] {
  const result: string[] = [];
  for (const sentence of clauses(text)) {
    const raw = sentence
      .split(/\s+(?:y|pero|aunque)\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const pieces = raw.filter((part) => contentTokens(part).size >= 2);
    result.push(...(raw.length > 1 && raw.length === pieces.length ? pieces : [sentence]));
  }
  return result.length > 0 ? result : [text.trim()].filter((part) => part.length > 0);
}

function wordTokens(text: string): string[] {
  return fold(text)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** No se puede empezar un tramo justo después de una negación o un cuantificador. */
const SCOPE_TOKENS = new Set([
  "no",
  "nunca",
  "jamas",
  "tampoco",
  "ningun",
  "ninguna",
  "ninguno",
  "ningunos",
  "ningunas",
  "imposible",
  "sin",
  "solo",
  "solamente",
  "exactamente",
  "aproximadamente",
  "casi",
  "siempre",
]);

function orderedSpan(clause: string, excerpt: string): "ok" | "polarity" | "miss" {
  const want = wordTokens(clause);
  const have = wordTokens(excerpt);
  if (want.length === 0 || want.length > have.length) {
    return "miss";
  }
  let scoped = false;
  for (let start = 0; start <= have.length - want.length; start += 1) {
    let same = true;
    for (let offset = 0; offset < want.length; offset += 1) {
      if (have[start + offset] !== want[offset]) {
        same = false;
        break;
      }
    }
    if (!same) {
      continue;
    }
    const before = start > 0 ? have[start - 1] : undefined;
    if (before !== undefined && SCOPE_TOKENS.has(before)) {
      scoped = true;
      continue;
    }
    return "ok";
  }
  return scoped ? "polarity" : "miss";
}

export type ClauseVerdict = "ok" | "polarity" | "number" | "overlap" | "addition";

/**
 * Fase 1 no acepta paráfrasis. La cláusula tiene que ser un tramo consecutivo
 * del extracto, con el mismo orden, las mismas cifras y la negación que lo rige.
 */
export function clauseVerdict(clause: string, excerpts: readonly string[]): ClauseVerdict {
  if (wordTokens(clause).length === 0) {
    return "overlap";
  }
  const joined = excerpts.join(" ");
  if (!numbersPresent(clause, joined)) {
    return "number";
  }
  let scoped = false;
  for (const excerpt of excerpts) {
    const span = orderedSpan(clause, excerpt);
    if (span === "ok") {
      return "ok";
    }
    if (span === "polarity") {
      scoped = true;
    }
  }
  if (scoped) {
    return "polarity";
  }
  return overlaps(contentTokens(clause), joined) ? "addition" : "overlap";
}

function overlaps(claimTokens: Set<string>, text: string): boolean {
  const evidenceTokens = contentTokens(text);
  let shared = 0;
  for (const token of claimTokens) {
    if (evidenceTokens.has(token)) {
      shared += 1;
    }
  }
  return claimTokens.size > 0 && shared >= 2 && shared / claimTokens.size >= 0.3;
}

function numbersPresent(claim: string, evidence: string): boolean {
  const have = new Set(fold(evidence).match(/\d+(?:[.,]\d+)?/g) ?? []);
  const want = fold(claim).match(/\d+(?:[.,]\d+)?/g) ?? [];
  return want.every((token) => have.has(token));
}

export type ClaimSupport = "supported" | "empty" | "overlap" | "polarity" | "number";

/**
 * El solapamiento léxico no verifica una afirmación cuyo sentido o cuyas cifras
 * contradicen el extracto. Una coincidencia de palabras con polaridad opuesta
 * no cuenta como apoyo.
 */
export function claimSupportVerdict(claim: string, evidence: readonly string[]): ClaimSupport {
  const claimTokens = contentTokens(claim);
  if (claimTokens.size === 0) {
    return "empty";
  }
  const joined = evidence.join(" ");
  if (!numbersPresent(claim, joined)) {
    return "number";
  }
  const spans = evidence.flatMap((item) => clauses(item));
  const usable = spans.length > 0 ? spans : [joined];
  for (const part of clauses(claim)) {
    const tokens = contentTokens(part);
    if (tokens.size === 0) {
      continue;
    }
    const partPolarity = polarity(part);
    let same = false;
    let opposite = false;
    for (const span of usable) {
      if (!overlaps(tokens, span)) {
        continue;
      }
      if (polarity(span) === partPolarity) {
        same = true;
      } else {
        opposite = true;
      }
    }
    if (!same) {
      return opposite ? "polarity" : "overlap";
    }
  }
  return "supported";
}

/** Comprueba que la afirmación comparte vocabulario suficiente con lo que cita. */
export function claimSupported(claim: string, evidence: readonly string[]): boolean {
  return claimSupportVerdict(claim, evidence) === "supported";
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const CITE = /\[cite:[^\]]*\]/g;

function cleanClaim(value: unknown, max: number): string | null {
  return typeof value === "string" ? boundedText(value.replace(CITE, " "), max) : null;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string"))].slice(
    0,
    RESEARCH_LIMITS.maxEvidenceItems,
  );
}

const CAUSE_LABEL: Record<GapCause, string> = {
  evidence: "con evidencia",
  "missing-evidence": "no consta en la evidencia admitida",
  "operational-failure": "no se pudo comprobar por un fallo operativo, no por falta de evidencia",
  "not-allowed": "las fuentes externas no pueden documentar un dato interno del curso",
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
    subquestions: readonly PlanItem[];
    coverage: readonly CoverageEntry[];
    causes: Readonly<Record<string, GapCause>>;
    accepted: readonly AcceptedEvidence[];
    contradictions: readonly string[];
    fixture: boolean;
    stopIsFailure: boolean;
  },
): { ok: true; value: VerifiedReport } | { ok: false; reason: string } {
  const body = record(raw);
  const answer = record(body?.answer);
  if (
    body === null ||
    answer === null ||
    !Array.isArray(body.findings) ||
    !Array.isArray(body.checks)
  ) {
    return { ok: false, reason: "El informe no tiene la forma esperada." };
  }
  if (
    body.findings.length > RESEARCH_LIMITS.maxFindings ||
    body.checks.length > RESEARCH_LIMITS.maxChecks
  ) {
    return { ok: false, reason: "El informe supera el número de hallazgos permitido." };
  }
  const byId = new Map(input.accepted.map((entry) => [entry.item.sourceId, entry]));
  const subById = new Map<string, PlanItem>(input.subquestions.map((item) => [item.id, item]));
  const coverageById = new Map(input.coverage.map((entry) => [entry.subquestionId, entry]));
  const dropped: DroppedClaim[] = [];
  const cited = new Set<string>();
  let checked = 0;

  const dropLimit = RESEARCH_LIMITS.maxFindings + RESEARCH_LIMITS.maxChecks + 1;
  const drop = (claim: string, reason: string) => {
    if (dropped.length < dropLimit) {
      dropped.push({ claim, reason });
    }
  };

  const admittedExcerpts = (sourceIds: readonly string[], subquestionId: string | null) => {
    const excerpts: string[] = [];
    for (const sourceId of sourceIds) {
      const entry = byId.get(sourceId);
      if (entry === undefined) {
        continue;
      }
      const supports = entry.subquestionIds.some((id) => {
        if (subquestionId !== null && id !== subquestionId) {
          return false;
        }
        const sub = subById.get(id as PlanItem["id"]);
        const coverage = coverageById.get(id);
        return (
          sub !== undefined &&
          coverage !== undefined &&
          coverage.status !== "uncovered" &&
          authorityAllows(entry.item.kind, sub)
        );
      });
      if (supports) {
        excerpts.push(...entry.excerpts);
      }
    }
    return excerpts;
  };

  const clauseReason = (verdict: ClauseVerdict) => {
    if (verdict === "polarity") {
      return "La afirmación contradice la polaridad de lo citado.";
    }
    if (verdict === "number") {
      return "La afirmación cambia una cifra que no está en lo citado.";
    }
    if (verdict === "addition") {
      return "La cláusula no es un tramo ordenado del extracto admitido.";
    }
    return "La afirmación no comparte contenido suficiente con lo que cita.";
  };

  /**
   * La fuente cita un tema. La cláusula tiene que caber en el extracto de una
   * subpregunta cubierta que esa fuente puede apoyar. Si no, se retira sola.
   */
  const verifyClaim = (claim: ReportClaim): string | null => {
    checked += 1;
    if (claim.sourceIds.length === 0) {
      drop(claim.text, "La afirmación no cita evidencia admitida.");
      return null;
    }
    const unknown = claim.sourceIds.find((id) => !byId.has(id));
    if (unknown !== undefined) {
      drop(claim.text, `Cita un id no admitido: ${unknown.slice(0, 64)}.`);
      return null;
    }
    if (claim.subquestionId !== null) {
      const sub = subById.get(claim.subquestionId as PlanItem["id"]);
      const coverage = coverageById.get(claim.subquestionId);
      if (sub === undefined || coverage === undefined || coverage.status === "uncovered") {
        drop(claim.text, "La subpregunta no tiene evidencia admitida.");
        return null;
      }
      const support = claim.sourceIds.some((sourceId) => {
        const entry = byId.get(sourceId);
        return (
          entry !== undefined &&
          entry.subquestionIds.includes(sub.id) &&
          authorityAllows(entry.item.kind, sub)
        );
      });
      if (!support) {
        drop(claim.text, "La fuente citada no apoya esa subpregunta.");
        return null;
      }
    }
    const excerpts = admittedExcerpts(claim.sourceIds, claim.subquestionId);
    if (excerpts.length === 0) {
      drop(claim.text, "La afirmación no se relaciona con una subpregunta cubierta.");
      return null;
    }
    const pieces = atomicClauses(claim.text);
    const kept: string[] = [];
    for (const piece of pieces) {
      const verdict = clauseVerdict(piece, excerpts);
      if (verdict === "ok") {
        kept.push(piece);
      } else {
        drop(piece, clauseReason(verdict));
      }
    }
    if (kept.length === 0) {
      return null;
    }
    for (const id of claim.sourceIds) {
      cited.add(id);
    }
    return kept.length === pieces.length ? claim.text : kept.join(". ");
  };

  const answerText = cleanClaim(answer.text, RESEARCH_LIMITS.maxAnswerChars);
  if (answerText === null) {
    return { ok: false, reason: "El informe no trae una respuesta directa." };
  }
  const answerKept = verifyClaim({
    subquestionId: null,
    text: answerText,
    sourceIds: ids(answer.sourceIds),
  });
  const answerOk = answerKept !== null;

  const findings: ReportClaim[] = [];
  for (const entry of body.findings) {
    const row = record(entry);
    const text = cleanClaim(row?.text, RESEARCH_LIMITS.maxClaimChars);
    const subquestionId = typeof row?.subquestionId === "string" ? row.subquestionId : null;
    if (text === null || subquestionId === null) {
      return { ok: false, reason: "Un hallazgo no tiene texto o subpregunta." };
    }
    const kept = verifyClaim({ subquestionId, text, sourceIds: ids(row?.sourceIds) });
    if (kept !== null) {
      findings.push({ subquestionId, text: kept, sourceIds: ids(row?.sourceIds) });
    }
  }
  const checks: ReportClaim[] = [];
  for (const entry of body.checks) {
    const row = record(entry);
    const text = cleanClaim(row?.text, RESEARCH_LIMITS.maxClaimChars);
    if (text === null) {
      return { ok: false, reason: "Una comprobación no tiene texto." };
    }
    const sourceIds = ids(row?.sourceIds);
    const kept = verifyClaim({ subquestionId: null, text, sourceIds });
    if (kept !== null) {
      checks.push({ subquestionId: null, text: kept, sourceIds });
    }
  }

  const cite = (sourceIds: readonly string[]) => sourceIds.map((id) => `[cite:${id}]`).join(" ");
  const unresolved: string[] = [];
  for (const sub of input.subquestions) {
    const coverage = coverageById.get(sub.id);
    if (coverage === undefined || coverage.status === "covered") {
      continue;
    }
    const cause = input.causes[sub.id] ?? "missing-evidence";
    unresolved.push(
      `${sub.id} · ${sub.text} (${coverage.status === "partial" ? "parcial" : "sin cubrir"}: ${CAUSE_LABEL[cause]}).${coverage.gap === null ? "" : ` ${coverage.gap}`}`,
    );
  }
  for (const sub of input.subquestions) {
    if (
      coverageById.get(sub.id)?.status === "covered" &&
      !findings.some((item) => item.subquestionId === sub.id)
    ) {
      unresolved.push(`${sub.id} · ${sub.text} (sin hallazgo verificado en el informe).`);
    }
  }
  if (Array.isArray(body.unresolved)) {
    for (const item of body.unresolved.slice(0, RESEARCH_LIMITS.maxUnresolved)) {
      const text = cleanClaim(item, RESEARCH_LIMITS.maxReasonChars);
      if (text !== null && unresolved.length < RESEARCH_LIMITS.maxUnresolved + 3) {
        unresolved.push(text);
      }
    }
  }

  const allCovered = input.coverage.every((entry) => entry.status === "covered");
  const everyAnswered = input.subquestions.every((sub) =>
    findings.some((item) => item.subquestionId === sub.id),
  );
  const contradicted = input.contradictions.length > 0;
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

  const lines: string[] = [];
  if (input.fixture) {
    lines.push(
      "**Informe de prueba.** Adaptadores fijos: demuestra el control del grafo, no la calidad de un modelo ni una investigación real en internet.",
      "",
    );
  }
  if (contradicted) {
    lines.push(
      "**Informe no concluyente.** Hay una contradicción relevante sin resolver. No es un informe completo.",
      "",
    );
  }
  if (outcome === "partial" && !contradicted) {
    lines.push("**Informe parcial.** Parte de la pregunta queda sin evidencia verificada.", "");
  }
  if (outcome === "partial" && contradicted) {
    lines.push("**Informe parcial.** La contradicción impide dar la pregunta por cerrada.", "");
  }
  if (outcome === "refused") {
    lines.push(
      "**Sin informe.** Ninguna afirmación del borrador superó la comprobación con la evidencia admitida.",
      "",
    );
  }
  if (answerKept !== null) {
    lines.push(`**Respuesta directa.** ${answerKept} ${cite(ids(answer.sourceIds))}`, "");
  } else if (outcome !== "refused") {
    lines.push(
      "**Respuesta directa.** No se muestra: no superó la comprobación con sus fuentes. Consulta los hallazgos verificados.",
      "",
    );
  }
  if (findings.length > 0) {
    lines.push("**Hallazgos con evidencia**");
    for (const item of findings) {
      lines.push(`- ${item.subquestionId} · ${item.text} ${cite(item.sourceIds)}`);
    }
    lines.push("");
  }
  if (checks.length > 0) {
    lines.push("**Comprobaciones y opciones**");
    for (const item of checks) {
      lines.push(`- ${item.text} ${cite(item.sourceIds)}`);
    }
    lines.push("");
  }
  if (unresolved.length > 0) {
    lines.push("**Puntos sin resolver**");
    for (const item of unresolved) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  if (contradicted) {
    lines.push("**Contradicciones sin resolver**");
    for (const item of input.contradictions) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  if (dropped.length > 0) {
    lines.push(
      `**Comprobación de afirmaciones.** Se retiraron ${String(dropped.length)} afirmaciones del borrador. El detalle está en la traza.`,
      "",
    );
  }
  lines.push("**Fuentes.** Solo las citadas, en el panel lateral, con sus extractos.");
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
