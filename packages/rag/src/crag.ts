// GUÍA DE LECTURA · packages/rag/src/crag.ts
// Lógica pura de CRAG, sin red: topes del grafo, puertos que implementan los adaptadores,
// plazo único de 20 s y validadores estrictos de lo que devuelven el evaluador y el reformulador.
// Una salida del modelo no se usa hasta pasar estas comprobaciones.
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Regla de visibilidad por audiencia.
import { allowsAudience } from "./pipeline";
// Topes de búsquedas y reformulaciones.
import { CRAG_LIMITS } from "./limits";

// Topes del grafo CRAG.
export const CRAG_BOUNDS = {
  // Búsquedas por turno (3).
  maxRetrievals: CRAG_LIMITS.maxRetrievals,
  // Reformulaciones por turno (2).
  maxReformulations: CRAG_LIMITS.maxReformulations,
  // Fragmentos candidatos por búsqueda.
  maxCandidates: 10,
  // Fragmentos conservados como evidencia.
  maxRetained: 6,
  // Caracteres de un motivo.
  maxReasonChars: 240,
  // Caracteres de una consulta.
  maxQueryChars: 500,
  // Lagunas que puede nombrar el evaluador.
  maxGaps: 4,
  // Caracteres de una laguna.
  maxGapChars: 160,
  // Caracteres de un id.
  maxIdChars: 128,
  // Descartes registrados.
  maxDiscarded: 24,
  // Plazo total del turno: 20 segundos.
  executionBudgetMs: 20_000,
} as const;

// Escala de puntuaciones [0, 1] y umbrales calibrados para reordenamiento y valoración de suficiencia.
export const CRAG_SCORE_THRESHOLDS = {
  // Mínimo permitido en la escala de relevancia del reordenador.
  minScore: 0,
  // Máximo permitido en la escala de relevancia del reordenador.
  maxScore: 1,
  // Umbral de relevancia individual a partir del cual un fragmento se considera útil en calibración.
  minChunkRelevance: 0.5,
  // Umbral de cobertura mínima para considerar evidencia parcial (al menos una parte cubierta).
  partialCoverageMin: 0.4,
  // Umbral de cobertura completa para declarar evidencia suficiente cuando no quedan lagunas.
  sufficientCoverageMin: 0.75,
} as const;

// Veredicto posible sobre la evidencia.
export type EvidenceStatus = "sufficient" | "partial" | "insufficient";

// Alcance de una ejecución: qué grupo, versión y perfil puede consultar.
export interface CragScope {
  // Identificador de la ejecución.
  runId: string;
  // Grupo del alumno.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Perfil de índice.
  profileId: string;
  // Nombre del embedding usado.
  embeddingLabel: string;
}

// Fragmento candidato dentro de CRAG.
export interface CragChunk {
  // Documento.
  documentId: string;
  // Id del fragmento.
  chunkId: string;
  // Título.
  title: string;
  // Sección.
  section: string;
  // Texto.
  text: string;
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Perfil de índice.
  profileId: string;
  // Puntuación de la búsqueda o del evaluador.
  score: number | null;
}

// Fragmento ordenado por el evaluador.
export interface RankedHit {
  // Id del fragmento.
  chunkId: string;
  // Puntuación de relevancia.
  score: number;
  // Motivo de la puntuación.
  reason: string;
}

// Valoración del evaluador.
export interface CragAssessment {
  // Suficiente, parcial o insuficiente.
  status: EvidenceStatus;
  // Motivo.
  reason: string;
  // Lagunas que faltan por cubrir.
  gaps: string[];
  // Ids de los fragmentos útiles.
  usefulIds: string[];
}

// Siguiente paso tras evaluar: responder, rechazar, conservar, descartar o parar.
export type CragRoute = "answer" | "refuse" | "retain" | "discard" | "stop";

// Señal de cancelación.
export interface CragSignal {
  // true si el turno se canceló.
  readonly aborted: boolean;
}

// Puertos de CRAG: lo que el grafo necesita del exterior (demo o servicios reales).
export interface CragPorts {
  // true si las llamadas se miden de verdad.
  measured: boolean;
  // Hora actual en milisegundos.
  now(): number;
  // Señal de cancelación.
  signal: CragSignal;
  // Reserva presupuesto para una operación antes de hacerla.
  reserve(
    kind: "retrieval" | "evaluation" | "reformulation" | "generation",
  ): { ok: true } | { ok: false; reason: string };
  // Busca fragmentos en el índice.
  retrieve(input: {
    // Consulta.
    query: string;
    // Alcance.
    scope: CragScope;
    // Fragmentos pedidos.
    limit: number;
    // Número de búsqueda.
    attempt: number;
    // Tiempo que queda del plazo.
    remainingMs: number;
  }): Promise<
    { ok: true; chunks: CragChunk[]; providerCall: boolean } | { ok: false; reason: string }
  >;
  // Ordena y evalúa los fragmentos con el modelo evaluador.
  rankAndAssess(input: {
    // Pregunta original.
    question: string;
    // Consulta usada.
    query: string;
    // Fragmentos candidatos.
    chunks: readonly CragChunk[];
    // Número de intento.
    attempt: number;
    // Tiempo restante.
    remainingMs: number;
  }): Promise<
    | { ok: true; raw: unknown; providerCall: boolean }
    | { ok: false; reason: string; providerCall: boolean }
  >;
  // Reordena los fragmentos candidatos devolviendo una lista con puntuaciones en [0, 1] (opcional).
  rerank?(input: {
    // Pregunta original.
    question: string;
    // Consulta usada.
    query: string;
    // Fragmentos candidatos.
    chunks: readonly CragChunk[];
    // Número de intento.
    attempt: number;
    // Tiempo restante.
    remainingMs: number;
  }): Promise<
    | { ok: true; raw: unknown; providerCall: boolean }
    | { ok: false; reason: string; providerCall: boolean }
  >;
  // Valora si los fragmentos ya reordenados cubren la pregunta completa (opcional).
  assess?(input: {
    // Pregunta original.
    question: string;
    // Consulta usada.
    query: string;
    // Fragmentos mostrados.
    chunks: readonly CragChunk[];
    // Ordenación ya validada.
    ranking: readonly RankedHit[];
    // Número de intento.
    attempt: number;
    // Tiempo restante.
    remainingMs: number;
  }): Promise<
    | { ok: true; raw: unknown; providerCall: boolean }
    | { ok: false; reason: string; providerCall: boolean }
  >;
  // Reformula la consulta para cubrir las lagunas.
  reformulate(input: {
    // Pregunta original.
    question: string;
    // Consulta anterior.
    query: string;
    // Lagunas.
    gaps: readonly string[];
    // Número de intento.
    attempt: number;
    // Tiempo restante.
    remainingMs: number;
  }): Promise<
    | { ok: true; raw: unknown; providerCall: boolean }
    | { ok: false; reason: string; providerCall: boolean }
  >;
  // Genera la respuesta final con la evidencia.
  generate(input: {
    // Pregunta.
    question: string;
    // Evidencia conservada.
    evidence: readonly CragChunk[];
    // Tiempo restante.
    remainingMs: number;
  }): Promise<
    | {
        // Generación correcta.
        ok: true;
        // Texto de la respuesta.
        text: string;
        // Si hubo llamada real al proveedor.
        providerCall: boolean;
        // Consumo de tokens, o null.
        usage: {
          // Tokens de entrada.
          inputTokens: number | null;
          // Tokens de salida.
          outputTokens: number | null;
          // Tokens totales.
          totalTokens: number | null;
        } | null;
        // Coste estimado, o null.
        cost: { amount: number; currency: string; source: string; method: string } | null;
      }
    | { ok: false; reason: string; providerCall: boolean }
  >;
}

// Normaliza una consulta para comparar: sin espacios sobrantes y en minúsculas.
export function normalizeQuery(value: string): string {
  // Recorta, junta espacios y pasa a minúsculas.
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

// Milisegundos que quedan del plazo único; por defecto se conserva la referencia histórica de 20 s.
export function remainingBudgetMs(
  startedAt: number,
  now: number,
  executionBudgetMs: number = CRAG_BOUNDS.executionBudgetMs,
): number {
  // Relojes inválidos o hacia atrás: no queda tiempo.
  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(now) ||
    now < startedAt ||
    !Number.isSafeInteger(executionBudgetMs) ||
    executionBudgetMs < 1_000 ||
    executionBudgetMs > 120_000
  ) {
    // Cero.
    return 0;
  }
  // Plazo menos lo transcurrido, nunca negativo.
  return Math.max(0, executionBudgetMs - (now - startedAt));
}

// ¿Queda tiempo?
export function budgetOpen(
  startedAt: number,
  now: number,
  executionBudgetMs: number = CRAG_BOUNDS.executionBudgetMs,
): boolean {
  // Más de 0 ms.
  return remainingBudgetMs(startedAt, now, executionBudgetMs) > 0;
}

// ¿Pertenece el fragmento al alcance de esta ejecución?
export function chunkInScope(chunk: CragChunk, scope: CragScope): boolean {
  // Misma versión y perfil, con texto, y visible para la audiencia.
  return (
    chunk.corpusVersion === scope.corpusVersion &&
    chunk.profileId === scope.profileId &&
    chunk.text.trim().length > 0 &&
    allowsAudience(chunk.audience, scope.audience)
  );
}

// Quita fragmentos repetidos conservando el primero.
export function dedupeChunks(chunks: readonly CragChunk[]): CragChunk[] {
  // Ids ya vistos.
  const seen = new Set<string>();
  // Resultado sin repetidos.
  const result: CragChunk[] = [];
  // Recorre los fragmentos.
  for (const chunk of chunks) {
    // Repetido: se salta.
    if (seen.has(chunk.chunkId)) {
      // Siguiente.
      continue;
    }
    // Marca el id.
    seen.add(chunk.chunkId);
    // Guarda el fragmento.
    result.push(chunk);
  }
  // Lista sin repetidos.
  return result;
}

// Decide el siguiente paso después de evaluar.
export function routeAfterAssessment(input: {
  // Veredicto, o null si no lo hay.
  status: EvidenceStatus | null;
  // Búsquedas hechas.
  retrievalCount: number;
  // Reformulaciones hechas.
  reformulationCount: number;
}): CragRoute {
  // Evidencia suficiente: responder.
  if (input.status === "sufficient") {
    // Responder.
    return "answer";
  }
  // Sin búsquedas o reformulaciones disponibles: rechazar.
  if (
    input.retrievalCount >= CRAG_BOUNDS.maxRetrievals ||
    input.reformulationCount >= CRAG_BOUNDS.maxReformulations
  ) {
    // Rechazar.
    return "refuse";
  }
  // Parcial: conservar lo útil y seguir buscando.
  if (input.status === "partial") {
    // Conservar.
    return "retain";
  }
  // Insuficiente: descartar y reformular.
  if (input.status === "insufficient") {
    // Descartar.
    return "discard";
  }
  // Sin veredicto: parar.
  return "stop";
}

// Devuelve el valor como objeto plano, o null.
function record(value: unknown): Record<string, unknown> | null {
  // null, arrays y no objetos se rechazan.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // No es un objeto plano.
    return null;
  }
  // Objeto con claves de texto.
  return value as Record<string, unknown>;
}

// Texto recortado con un tope, o null si no es válido.
function boundedText(value: unknown, max: number): string | null {
  // Tiene que ser texto.
  if (typeof value !== "string") {
    // No lo es.
    return null;
  }
  // Sin espacios a los lados.
  const trimmed = value.trim();
  // Vacío o demasiado largo.
  if (trimmed.length === 0 || trimmed.length > max) {
    // No válido.
    return null;
  }
  // Texto válido.
  return trimmed;
}

// Valida únicamente el paso de reordenamiento: todos los candidatos, sin repetir y con puntuación en [0, 1].
export function validateRanking(
  candidates: readonly CragChunk[],
  raw: unknown,
): { ok: true; ranking: RankedHit[] } | { ok: false; reason: string } {
  // Admite tanto un objeto { ranking: [...] } como directamente el array de filas.
  const list = Array.isArray(raw) ? raw : record(raw)?.ranking;
  // Debe ser una lista.
  if (!Array.isArray(list)) {
    // Forma incorrecta.
    return { ok: false, reason: "La salida del evaluador no tiene la forma esperada." };
  }
  // La ordenación debe incluir cada candidato.
  if (list.length !== candidates.length) {
    // Falta alguno.
    return { ok: false, reason: "La ordenación no cubre los fragmentos recuperados." };
  }
  // Ids esperados.
  const expected = new Set(candidates.map((chunk) => chunk.chunkId));
  // Ordenación validada.
  const ranking: RankedHit[] = [];
  // Ids ya vistos en la ordenación.
  const seen = new Set<string>();
  // Revisa cada fila de la ordenación.
  for (const item of list) {
    // Fila como objeto.
    const row = record(item);
    // Id del fragmento.
    const chunkId = row === null ? null : boundedText(row.chunkId, CRAG_BOUNDS.maxIdChars);
    // Motivo.
    const reason = row === null ? null : boundedText(row.reason, CRAG_BOUNDS.maxReasonChars);
    // Puntuación.
    const score = row?.score;
    // Id real y no repetido, motivo y puntuación finita en la escala [0, 1].
    if (
      chunkId === null ||
      reason === null ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < CRAG_SCORE_THRESHOLDS.minScore ||
      score > CRAG_SCORE_THRESHOLDS.maxScore ||
      !expected.has(chunkId) ||
      seen.has(chunkId)
    ) {
      // Fila inválida: se rechaza toda la salida.
      return {
        ok: false,
        reason: "La ordenación trae un id, una puntuación o un motivo inválido.",
      };
    }
    // Marca el id.
    seen.add(chunkId);
    // Guarda la fila.
    ranking.push({ chunkId, score, reason });
  }
  // Todos los candidatos tienen que aparecer.
  if (seen.size !== expected.size) {
    // Falta alguno.
    return { ok: false, reason: "La ordenación omite un fragmento recuperado." };
  }
  // Ranking válido.
  return { ok: true, ranking };
}

// Valida únicamente el paso de valoración de suficiencia contra los fragmentos mostrados.
export function validateAssessment(
  candidates: readonly CragChunk[],
  raw: unknown,
): { ok: true; assessment: CragAssessment } | { ok: false; reason: string } {
  // Salida como objeto.
  const body = record(raw);
  // Debe traer usefulIds como lista.
  if (body === null || !Array.isArray(body.usefulIds)) {
    // Forma incorrecta.
    return { ok: false, reason: "La salida del evaluador no tiene la forma esperada." };
  }
  // Ids esperados.
  const expected = new Set(candidates.map((chunk) => chunk.chunkId));
  // Veredicto.
  const status = body.status;
  // Tiene que ser uno de los tres.
  if (status !== "sufficient" && status !== "partial" && status !== "insufficient") {
    // Veredicto inválido.
    return { ok: false, reason: "El estado de la evidencia no es válido." };
  }
  // Motivo del veredicto.
  const reason = boundedText(body.reason, CRAG_BOUNDS.maxReasonChars);
  // Vacío o demasiado largo.
  if (reason === null) {
    // Motivo inválido.
    return { ok: false, reason: "El motivo de la evidencia está vacío o es demasiado largo." };
  }
  // Lagunas como lista con su tope.
  if (!Array.isArray(body.gaps) || body.gaps.length > CRAG_BOUNDS.maxGaps) {
    // Forma incorrecta.
    return { ok: false, reason: "Las lagunas no tienen la forma esperada." };
  }
  // Lagunas validadas.
  const gaps: string[] = [];
  // Revisa cada laguna.
  for (const gap of body.gaps) {
    // Texto con tope.
    const text = boundedText(gap, CRAG_BOUNDS.maxGapChars);
    // Vacía o larga.
    if (text === null) {
      // Laguna inválida.
      return { ok: false, reason: "Una laguna está vacía o es demasiado larga." };
    }
    // Guarda la laguna.
    gaps.push(text);
  }
  // No más útiles que el máximo conservado.
  if (body.usefulIds.length > CRAG_BOUNDS.maxRetained) {
    // Demasiados.
    return { ok: false, reason: "Hay demasiados fragmentos marcados como útiles." };
  }
  // Ids útiles validados.
  const usefulIds: string[] = [];
  // Ids útiles vistos.
  const usefulSeen = new Set<string>();
  // Revisa cada id útil.
  for (const id of body.usefulIds) {
    // Id con tope.
    const chunkId = boundedText(id, CRAG_BOUNDS.maxIdChars);
    // Debe ser real y no repetido.
    if (chunkId === null || !expected.has(chunkId) || usefulSeen.has(chunkId)) {
      // Id inválido.
      return { ok: false, reason: "Los ids útiles no coinciden con los fragmentos recuperados." };
    }
    // Marca el id.
    usefulSeen.add(chunkId);
    // Guarda el id.
    usefulIds.push(chunkId);
  }
  // Texto de cada candidato por id.
  const usefulText = new Map(candidates.map((chunk) => [chunk.chunkId, chunk.text.trim()]));
  // Insuficiente: no puede conservar nada.
  if (status === "insufficient") {
    // Ni fragmentos útiles ni lagunas.
    if (usefulIds.length > 0 || gaps.length > 0) {
      // Incoherente.
      return {
        ok: false,
        reason: "Una evidencia insuficiente no puede conservar fragmentos ni lagunas.",
      };
    }
  }
  // Comprueba cada id útil: una lista vacía o un fragmento sin texto no respaldan la valoración.
  else if (
    usefulIds.length === 0 ||
    usefulIds.some(
      // Un id marcado como útil debe conservar texto recuperado que pueda respaldar la respuesta.
      (id) => usefulText.get(id) === "",
    )
  ) {
    // Útiles vacíos o sin texto.
    return { ok: false, reason: "La evidencia útil no tiene texto recuperado." };
  } else if (status === "partial" && gaps.length === 0) {
    // Parcial sin laguna nombrada.
    return { ok: false, reason: "Una evidencia parcial tiene que nombrar la laguna." };
  } else if (status === "sufficient" && gaps.length > 0) {
    // Suficiente con lagunas.
    return { ok: false, reason: "Una evidencia suficiente no lleva lagunas." };
  }
  // Valoración válida.
  return { ok: true, assessment: { status, reason, gaps, usefulIds } };
}

// Evalúa suficiencia con los umbrales calibrados separando relevancia del fragmento y cobertura global.
export function assessCoverageByThresholds(input: {
  // Ordenación ya validada en [0, 1].
  ranking: readonly RankedHit[];
  // Cobertura estimada de la pregunta completa en [0, 1].
  coverageScore: number;
  // Lagunas concretas aún no cubiertas por los fragmentos útiles.
  gaps?: readonly string[];
  // Umbral mínimo de relevancia individual (por defecto 0,50).
  minChunkRelevance?: number;
}): CragAssessment {
  // Umbral de fragmento útil.
  const minRelevance = input.minChunkRelevance ?? CRAG_SCORE_THRESHOLDS.minChunkRelevance;
  // Fragmentos cuya relevancia individual supera el umbral, hasta maxRetained.
  const usefulIds = input.ranking
    .filter((hit) => hit.score >= minRelevance)
    .slice(0, CRAG_BOUNDS.maxRetained)
    .map((hit) => hit.chunkId);
  // Lagunas limpias.
  const gaps = (input.gaps ?? [])
    .map((gap) => gap.trim())
    .filter((gap) => gap.length > 0)
    .slice(0, CRAG_BOUNDS.maxGaps);
  // Sin fragmentos relevantes o con cobertura por debajo del corte parcial: insuficiente.
  if (usefulIds.length === 0 || input.coverageScore < CRAG_SCORE_THRESHOLDS.partialCoverageMin) {
    // Veredicto insuficiente.
    return {
      status: "insufficient",
      reason: `Ningún fragmento supera el umbral de utilidad (${minRelevance.toFixed(2)}) o la cobertura (${input.coverageScore.toFixed(2)}) no alcanza ${CRAG_SCORE_THRESHOLDS.partialCoverageMin.toFixed(2)}.`,
      gaps: [],
      usefulIds: [],
    };
  }
  // Cobertura completa (>= 0,75) y sin lagunas: suficiente.
  if (gaps.length === 0 && input.coverageScore >= CRAG_SCORE_THRESHOLDS.sufficientCoverageMin) {
    // Veredicto suficiente.
    return {
      status: "sufficient",
      reason: `Fragmentos relevantes (>= ${minRelevance.toFixed(2)}) y cobertura global suficiente (${input.coverageScore.toFixed(2)} >= ${CRAG_SCORE_THRESHOLDS.sufficientCoverageMin.toFixed(2)}).`,
      gaps: [],
      usefulIds,
    };
  }
  // Hay fragmentos útiles pero la cobertura de la pregunta es incompleta: parcial.
  return {
    status: "partial",
    reason: `Hay fragmentos relevantes (>= ${minRelevance.toFixed(2)}), pero la cobertura global (${input.coverageScore.toFixed(2)}) deja lagunas pendientes.`,
    gaps:
      gaps.length > 0 ? gaps : ["Falta cubrir parte de la pregunta original con otra búsqueda."],
    usefulIds,
  };
}

// Valida la salida del evaluador: ordenación completa, ids reales y veredicto coherente.
export function validateRankingAndAssessment(
  candidates: readonly CragChunk[],
  raw: unknown,
): { ok: true; ranking: RankedHit[]; assessment: CragAssessment } | { ok: false; reason: string } {
  // Salida como objeto.
  const body = record(raw);
  // Debe traer ranking y usefulIds como listas.
  if (body === null || !Array.isArray(body.ranking) || !Array.isArray(body.usefulIds)) {
    // Forma incorrecta.
    return { ok: false, reason: "La salida del evaluador no tiene la forma esperada." };
  }
  // Paso 1: valida el reordenamiento.
  const ranked = validateRanking(candidates, body);
  // Si falla el reordenamiento, propaga el motivo.
  if (!ranked.ok) {
    // Motivo de error.
    return ranked;
  }
  // Paso 2: valida la valoración de suficiencia.
  const assessed = validateAssessment(candidates, body);
  // Si falla la valoración, propaga el motivo.
  if (!assessed.ok) {
    // Motivo de error.
    return assessed;
  }
  // Salida válida.
  return { ok: true, ranking: ranked.ranking, assessment: assessed.assessment };
}

// Valida la reformulación: consulta no vacía y distinta de las anteriores.
export function validateReformulation(
  raw: unknown,
  seenQueries: readonly string[],
): { ok: true; query: string } | { ok: false; reason: string } {
  // Salida como objeto.
  const body = record(raw);
  // Consulta con tope.
  const query = body === null ? null : boundedText(body.query, CRAG_BOUNDS.maxQueryChars);
  // Vacía o inválida.
  if (query === null) {
    // Rechazo.
    return { ok: false, reason: "La reformulación está vacía o no es válida." };
  }
  // Consulta normalizada.
  const normalized = normalizeQuery(query);
  // No puede repetir una consulta anterior.
  if (seenQueries.some((seen) => normalizeQuery(seen) === normalized)) {
    // Rechazo.
    return { ok: false, reason: "La reformulación no cambia la búsqueda." };
  }
  // Consulta válida.
  return { ok: true, query };
}

// Ordena la evidencia útil según el ranking del evaluador.
export function orderByRanking(
  chunks: readonly CragChunk[],
  ranking: readonly RankedHit[],
  usefulIds: readonly string[],
): { ok: true; chunks: CragChunk[] } | { ok: false; reason: string } {
  // Sin útiles no hay respuesta.
  if (usefulIds.length === 0) {
    // Rechazo.
    return { ok: false, reason: "No hay fragmentos útiles para responder." };
  }
  // Ids útiles sin repetir.
  const useful = new Set<string>();
  // Recorre los útiles.
  for (const id of usefulIds) {
    // Repetido.
    if (useful.has(id)) {
      // Rechazo.
      return { ok: false, reason: "Los ids útiles están repetidos." };
    }
    // Guarda el id.
    useful.add(id);
  }
  // Mapa id → fragmento.
  const byId = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  // Evidencia ordenada.
  const ordered: CragChunk[] = [];
  // Ids añadidos.
  const seen = new Set<string>();
  // Sigue el orden del ranking.
  for (const hit of ranking) {
    // Solo útiles y sin repetir.
    if (!useful.has(hit.chunkId) || seen.has(hit.chunkId)) {
      // Siguiente.
      continue;
    }
    // Fragmento del id.
    const chunk = byId.get(hit.chunkId);
    // Debe existir y tener texto.
    if (chunk === undefined || chunk.text.trim().length === 0) {
      // Rechazo.
      return { ok: false, reason: "Un id útil no está entre la evidencia mostrada." };
    }
    // Marca el id.
    seen.add(hit.chunkId);
    // Guarda el fragmento con la puntuación del evaluador.
    ordered.push({ ...chunk, score: hit.score });
  }
  // Cada útil tiene que aparecer en el ranking.
  if (seen.size !== useful.size) {
    // Rechazo.
    return { ok: false, reason: "La ordenación no cubre la evidencia útil." };
  }
  // Como mucho seis fragmentos.
  return { ok: true, chunks: ordered.slice(0, CRAG_BOUNDS.maxRetained) };
}

// Une la evidencia ya conservada con la nueva útil, sin repetidos y ordenada.
export function retainEvidence(input: {
  // Evidencia conservada antes.
  retained: readonly CragChunk[];
  // Fragmentos mostrados al evaluador ahora.
  shown: readonly CragChunk[];
  // Ids útiles de esta evaluación.
  usefulIds: readonly string[];
  // Ranking de esta evaluación.
  ranking: readonly RankedHit[];
}): { ok: true; chunks: CragChunk[] } | { ok: false; reason: string } {
  // Ids finales.
  const ids: string[] = [];
  // Ids vistos.
  const seen = new Set<string>();
  // Primero, los ya conservados.
  for (const chunk of input.retained) {
    // Sin repetir.
    if (!seen.has(chunk.chunkId)) {
      // Marca.
      seen.add(chunk.chunkId);
      // Añade.
      ids.push(chunk.chunkId);
    }
  }
  // Después, los nuevos útiles.
  for (const id of input.usefulIds) {
    // Sin repetir.
    if (!seen.has(id)) {
      // Marca.
      seen.add(id);
      // Añade.
      ids.push(id);
    }
  }
  // Ordena según el ranking actual.
  return orderByRanking(dedupeChunks([...input.shown, ...input.retained]), input.ranking, ids);
}

// Evidencia final para generar la respuesta.
export function evidenceForAnswer(
  shown: readonly CragChunk[],
  usefulIds: readonly string[],
  ranking: readonly RankedHit[],
): { ok: true; chunks: CragChunk[] } | { ok: false; reason: string } {
  // Útiles ordenados por el ranking.
  return orderByRanking(shown, ranking, usefulIds);
}
