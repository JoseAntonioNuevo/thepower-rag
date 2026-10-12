// GUÍA DE LECTURA · apps/api/src/research-real.ts
// Adaptadores reales de la investigación: el modelo planifica, evalúa, pide más búsquedas y sintetiza
// con salida estructurada; el curso sale de Vectorize y la web de Firecrawl o Tavily. Construir los
// puertos no llama a la red; las llamadas ocurren cuando el grafo las pide.
// Límites de la investigación y tipo de audiencia.
import { RESEARCH_LIMITS, type Audience } from "@thepower-rag/contracts";
// Tipos de los puertos de la investigación.
import type {
  Consumption,
  CourseEvidence,
  CourseEvidencePort,
  PortResult,
  ResearchModelPort,
  ResearchPorts,
} from "@thepower-rag/research";
// AI SDK: errores HTTP, error de objeto no generado y generateObject.
import { APICallError, generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
// Zod define los esquemas.
import { z } from "zod";
// Tipos de ajustes y tarifas.
import type { ResearchSettings, RetrievalSettings, TokenPrices } from "./env";
// Cliente de Firecrawl.
import { createFirecrawlReader, createFirecrawlSearch } from "./firecrawl";
// Cliente de Tavily.
import { createTavilyReader, createTavilySearch } from "./tavily";
// Consumo estimado por tokens.
import { tokenEstimateConsumption } from "./provider-cost";
// Extractos numerados de un texto.
import { excerptChoices, resolveExcerpt } from "./research-excerpts";
// Prompts de cada etapa.
import { ASSESS_PROMPT, FOLLOW_UP_PROMPT, PLAN_PROMPT, SYNTHESIS_PROMPT } from "./research-prompts";
// Herramienta de sesiones del curso.
import { createCourseSessionTool } from "./research-tool";
// Acceso a Vectorize y D1.
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";
// Embeddings con Workers AI.
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";

// Ids de subpregunta admitidos.
const sid = z.enum(["q1", "q2", "q3"]);

// Esquema del plan: ruta, explicación, aclaración, subpreguntas y herramienta.
const planSchema = z.object({
  route: z.enum(["course", "tool", "investigate", "clarify"]),
  // Explanatory metadata is bounded after generation; factual questions and
  // provider/tool arguments retain their strict schema constraints.
  rationale: z.string(),
  clarification: z.string().max(RESEARCH_LIMITS.maxReasonChars).nullable(),
  subquestions: z
    .array(
      z.object({
        id: sid,
        text: z.string().max(RESEARCH_LIMITS.maxSubquestionChars),
        kind: z.enum(["course", "session", "technical"]),
        external: z.boolean(),
        query: z.string().max(RESEARCH_LIMITS.maxQueryChars).nullable(),
      }),
    )
    .max(RESEARCH_LIMITS.maxSubquestions),
  tool: z
    .object({ sessionId: z.string().max(8), audience: z.enum(["program", "L/X", "M/J"]) })
    .nullable(),
});

// Esquema de la evaluación: decisión por fuente, cobertura por subpregunta y contradicciones.
const assessSchema = z.object({
  items: z
    .array(
      z.object({
        sourceId: z.string().max(128),
        decision: z.enum(["accept", "reject"]),
        subquestionIds: z.array(sid).max(RESEARCH_LIMITS.maxSubquestions),
        excerptIds: z.array(z.number().int().min(0)).max(RESEARCH_LIMITS.maxExcerptsPerSource),
        reason: z.string(),
      }),
    )
    .max(RESEARCH_LIMITS.maxEvidenceItems),
  coverage: z
    .array(
      z.object({
        subquestionId: sid,
        status: z.enum(["covered", "partial", "uncovered"]),
        gap: z.string().nullable(),
        followUp: z.boolean(),
      }),
    )
    .max(RESEARCH_LIMITS.maxSubquestions),
  contradictions: z.array(z.string().max(RESEARCH_LIMITS.maxReasonChars)).max(3),
});

// Esquema de evaluación limitado a las fuentes y extractos que existen en esta ronda.
function boundedAssessmentSchema(catalog: readonly { sourceId: string; excerpts: string[] }[]) {
  // A flat provider schema avoids an anyOf branch for every source. The
  // resolver below still checks each index against its own source.
  const sources = catalog.map((source) => source.sourceId);
  // Índice máximo de extracto entre todas las fuentes.
  const maxIndex = Math.max(0, ...catalog.map((source) => source.excerpts.length - 1));
  // Fila con sourceId de la lista y excerptIds dentro del rango.
  const row = assessSchema.shape.items.element.extend({
    sourceId: sources.length ? z.enum(sources) : z.never(),
    excerptIds: z
      .array(z.number().int().min(0).max(maxIndex))
      .max(RESEARCH_LIMITS.maxExcerptsPerSource),
  });
  // Esquema con esas filas.
  return assessSchema.extend({
    items: z.array(row).max(RESEARCH_LIMITS.maxEvidenceItems),
  });
}

// Esquema de las búsquedas de seguimiento.
const followUpSchema = z.object({
  queries: z
    .array(z.object({ subquestionId: sid, query: z.string().max(RESEARCH_LIMITS.maxQueryChars) }))
    .max(RESEARCH_LIMITS.maxSubquestions),
});

// Referencia a un extracto: fuente y número.
const excerptReference = z.object({
  sourceId: z.string().max(128),
  excerptIndex: z.number().int().min(0),
});

// Esquema del informe: referencias de respuesta, hallazgos, comprobaciones y pendientes.
const synthesisSchema = z.object({
  answerRefs: z.array(excerptReference).max(2),
  findings: z
    .array(
      z.object({
        subquestionId: sid,
        reference: excerptReference,
      }),
    )
    .max(RESEARCH_LIMITS.maxFindings),
  checks: z.array(excerptReference).max(RESEARCH_LIMITS.maxChecks),
  unresolved: z
    .array(z.string().max(RESEARCH_LIMITS.maxReasonChars))
    .max(RESEARCH_LIMITS.maxUnresolved),
});

/** Créditos supuestos por operación de Firecrawl para la reserva. Es un tope, no una medida. */
export const FIRECRAWL_CREDITS_ESTIMATE = { search: 2, read: 2 } as const;
// Tokens de entrada supuestos por llamada al calcular el tope.
const INPUT_TOKENS_PER_CALL = 20_000;

/**
 * Tope estimado de una investigación con los límites de laboratorio. Se
 * redondea al alza un 25 %. No es un cargo ni una medida.
 */
export function estimateResearchMaxUsd(settings: ResearchSettings): number {
  // Mayor tope de salida entre las etapas.
  const outputTokens = Object.values(RESEARCH_LIMITS.maxOutputTokens).reduce(
    (max, value) => Math.max(max, value),
    0,
  );
  // Coste máximo de las llamadas al modelo.
  const model =
    (RESEARCH_LIMITS.maxModelCalls *
      (INPUT_TOKENS_PER_CALL * settings.inputUsdPerMillion +
        outputTokens * settings.outputUsdPerMillion)) /
    1_000_000;
  // Coste máximo de búsquedas y lecturas según el buscador.
  const crawl =
    settings.searchProvider === "tavily"
      ? (RESEARCH_LIMITS.maxSearchCalls + RESEARCH_LIMITS.maxPagesRead) *
        (settings.tavilyUsdPerCredit ?? 0)
      : (RESEARCH_LIMITS.maxSearchCalls * FIRECRAWL_CREDITS_ESTIMATE.search +
          RESEARCH_LIMITS.maxPagesRead * FIRECRAWL_CREDITS_ESTIMATE.read) *
        settings.firecrawlUsdPerCredit;
  // Coste aproximado de los embeddings del curso.
  const embeddings = (RESEARCH_LIMITS.maxCourseQueries * 2_000 * 0.0118) / 1_000_000;
  // Suma con un 25 % de margen.
  return 1.25 * (model + crawl + embeddings);
}

// Consumo estimado a partir de tokens y tarifa.
function consumptionFrom(
  usage:
    | {
        // Tokens de entrada.
        inputTokens?: number | null;
        // Tokens de salida.
        outputTokens?: number | null;
      }
    | null
    | undefined,
  prices?: TokenPrices,
): Consumption {
  // Delegado en tokenEstimateConsumption.
  return tokenEstimateConsumption(usage, prices);
}

// Convierte un error del modelo en un resultado sin datos privados.
function failed(signal: AbortSignal, error?: unknown, prices?: TokenPrices): PortResult<never> {
  // ¿Falló la salida estructurada?
  const structured = NoObjectGeneratedError.isInstance(error);
  // Estado HTTP si fue un error de la API.
  const http = APICallError.isInstance(error) ? error.statusCode : undefined;
  // Never expose the generated text, provider body, request or error message.
  const detail = structured
    ? error.finishReason === "length"
      ? "El modelo agotó el tope de salida antes de completar el objeto."
      : `La salida estructurada no cumple el esquema${validationPaths(error.cause)}.`
    : http !== undefined
      ? `El proveedor del modelo respondió HTTP ${String(http)}.`
      : "El modelo no completó la llamada.";
  // Cancelado, inválido o fallo del proveedor, con su consumo si se conoce.
  return {
    ok: false,
    error: signal.aborted
      ? "aborted"
      : structured && error.finishReason !== "length"
        ? "invalid"
        : "provider",
    detail: signal.aborted ? "La llamada se canceló." : detail,
    consumption: structured ? consumptionFrom(error.usage, prices) : { kind: "unknown" },
  };
}

// Rutas del esquema que fallaron, solo con nombres conocidos.
function validationPaths(error: unknown): string {
  // Error que se inspecciona.
  let current = error;
  // Nombres de campo que se pueden mostrar.
  const allowed = new Set([
    "rationale",
    "clarification",
    "subquestions",
    "id",
    "text",
    "kind",
    "external",
    "query",
    "tool",
    "sessionId",
    "audience",
    "route",
    "items",
    "sourceId",
    "decision",
    "excerptIds",
    "reason",
    "coverage",
    "subquestionId",
    "status",
    "gap",
    "followUp",
    "contradictions",
    "answerRefs",
    "findings",
    "reference",
    "checks",
    "unresolved",
    "excerptIndex",
  ]);
  // Baja hasta 4 niveles de causa.
  for (let depth = 0; depth < 4; depth += 1) {
    // No es objeto: termina.
    if (typeof current !== "object" || current === null) break;
    // Si tiene issues de Zod.
    if ("issues" in current && Array.isArray(current.issues)) {
      // Rutas de los 3 primeros problemas.
      const paths = current.issues.slice(0, 3).flatMap((issue: unknown) => {
        // Sin ruta: nada.
        if (
          typeof issue !== "object" ||
          issue === null ||
          !("path" in issue) ||
          !Array.isArray(issue.path)
        )
          return [];
        // Ruta del problema.
        const path = issue.path;
        // Solo índices o nombres conocidos.
        if (
          !path.every(
            (part: unknown) =>
              (typeof part === "number" && Number.isSafeInteger(part)) ||
              (typeof part === "string" && allowed.has(part)),
          )
        )
          return [];
        // Ruta unida por puntos.
        return [path.join(".")];
      });
      // Rutas entre paréntesis o nada.
      return paths.length ? ` (${paths.join(", ")})` : "";
    }
    // Baja a la causa.
    current = "cause" in current ? current.cause : null;
  }
  // Sin rutas.
  return "";
}

// Explicación en una línea y recortada.
function boundedExplanation(text: string): string {
  // Une espacios y recorta.
  return text.replace(/\s+/g, " ").trim().slice(0, RESEARCH_LIMITS.maxReasonChars).trimEnd();
}

// Puerto del modelo de investigación: cuatro etapas con salida estructurada.
export function createResearchModelPort(input: {
  // Modelo que planifica y evalúa.
  planner: LanguageModel;
  // Modelo que sintetiza el informe.
  generator: LanguageModel;
  // Tope de salida por llamada que permite el presupuesto.
  maxOutputTokens?: number;
  /** Tarifa de RESEARCH_*_USD_PER_MILLION para el consumo estimado; sin valor, la de Haiku 5.5. */
  prices?: TokenPrices;
}): ResearchModelPort {
  // Métodos del puerto.
  return {
    async plan({ question, audience }, context) {
      // try/catch: un fallo se convierte en resultado tipado.
      try {
        // Plan con esquema, sin reintentos.
        const result = await generateObject({
          model: input.planner,
          schema: planSchema,
          schemaName: "research-plan",
          system: PLAN_PROMPT,
          prompt: `Grupo seleccionado: ${audience}\n\nPregunta original:\n${question}`,
          maxOutputTokens: Math.min(
            RESEARCH_LIMITS.maxOutputTokens.plan,
            input.maxOutputTokens ?? Infinity,
          ),
          maxRetries: 0,
          abortSignal: context.signal,
        });
        // Plan con explicación recortada y consumo.
        return {
          ok: true,
          value: { ...result.object, rationale: boundedExplanation(result.object.rationale) },
          consumption: consumptionFrom(result.usage, input.prices),
        };
      } catch (error) {
        // Fallo tipado.
        return failed(context.signal, error, input.prices);
      }
    },
    async assess({ question, subquestions, evidence, priorCoverage, round }, context) {
      // Catálogo de extractos numerados por fuente.
      const catalog = evidence.map((item) => ({
        sourceId: item.sourceId,
        kind: item.kind,
        title: item.title,
        excerpts: excerptChoices(item.text),
      }));
      // try/catch.
      try {
        // Evaluación limitada al catálogo.
        const result = await generateObject({
          model: input.planner,
          schema: boundedAssessmentSchema(catalog),
          schemaName: "research-evidence",
          system: ASSESS_PROMPT,
          prompt: `Pregunta original:\n${question}\n\nRonda: ${String(round)}\n\nSubpreguntas:\n${JSON.stringify(subquestions)}\n\nCobertura previa:\n${JSON.stringify(priorCoverage)}\n\nDATOS (usa únicamente los números excerptIndex mostrados):\n${JSON.stringify(catalog.map((source) => ({ ...source, excerpts: source.excerpts.map((text, excerptIndex) => ({ excerptIndex, text })) })))}`,
          maxOutputTokens: Math.min(
            RESEARCH_LIMITS.maxOutputTokens.assess,
            input.maxOutputTokens ?? Infinity,
          ),
          maxRetries: 0,
          abortSignal: context.signal,
        });
        // Consumo.
        const consumption = consumptionFrom(result.usage, input.prices);
        // Un extracto inexistente lanza al resolverlo.
        try {
          // Evaluación con explicaciones recortadas y extractos resueltos a texto.
          return {
            ok: true,
            value: {
              ...result.object,
              coverage: result.object.coverage.map((entry) => ({
                ...entry,
                gap: entry.gap === null ? null : boundedExplanation(entry.gap),
              })),
              items: result.object.items.map(({ excerptIds, ...item }) => ({
                ...item,
                reason: boundedExplanation(item.reason),
                excerpts: excerptIds.map(
                  (excerptIndex) =>
                    resolveExcerpt({ sourceId: item.sourceId, excerptIndex }, catalog).text,
                ),
              })),
            },
            consumption,
          };
        } catch {
          // Extracto inexistente: inválido.
          return {
            ok: false,
            error: "invalid",
            detail: "La evaluación seleccionó un extracto inexistente.",
            consumption,
          };
        }
      } catch (error) {
        // Fallo tipado.
        return failed(context.signal, error, input.prices);
      }
    },
    async followUp({ question, gaps, previousQueries }, context) {
      // try/catch.
      try {
        // Nuevas consultas para cubrir lagunas.
        const result = await generateObject({
          model: input.planner,
          schema: followUpSchema,
          schemaName: "research-follow-up",
          system: FOLLOW_UP_PROMPT,
          prompt: `Pregunta original:\n${question}\n\nLagunas:\n${JSON.stringify(gaps)}\n\nConsultas anteriores:\n${previousQueries.join("\n")}`,
          maxOutputTokens: Math.min(
            RESEARCH_LIMITS.maxOutputTokens.followUp,
            input.maxOutputTokens ?? Infinity,
          ),
          maxRetries: 0,
          abortSignal: context.signal,
        });
        // Consultas con consumo.
        return {
          ok: true,
          value: result.object,
          consumption: consumptionFrom(result.usage, input.prices),
        };
      } catch (error) {
        // Fallo tipado.
        return failed(context.signal, error, input.prices);
      }
    },
    async synthesize({ question, subquestions, coverage, contradictions, evidence }, context) {
      // try/catch.
      try {
        // Informe con referencias a extractos admitidos.
        const result = await generateObject({
          model: input.generator,
          schema: synthesisSchema,
          schemaName: "research-report",
          system: SYNTHESIS_PROMPT,
          prompt: `Pregunta original:\n${question}\n\nSubpreguntas:\n${JSON.stringify(subquestions)}\n\nCobertura:\n${JSON.stringify(coverage)}\n\nContradicciones:\n${JSON.stringify(contradictions)}\n\nDATOS: extractos admitidos con excerptIndex explícito:\n${JSON.stringify(evidence.map((item) => ({ sourceId: item.sourceId, subquestionIds: item.subquestionIds, excerpts: item.excerpts.map((text, excerptIndex) => ({ excerptIndex, text })) })))}`,
          maxOutputTokens: Math.min(
            RESEARCH_LIMITS.maxOutputTokens.synthesis,
            input.maxOutputTokens ?? Infinity,
          ),
          maxRetries: 0,
          abortSignal: context.signal,
        });
        // Consumo.
        const consumption = consumptionFrom(result.usage, input.prices);
        // Resolver referencias puede lanzar.
        try {
          // Extractos de la respuesta.
          const answers = result.object.answerRefs.map((ref) => resolveExcerpt(ref, evidence));
          // Informe con textos y fuentes resueltos.
          return {
            ok: true,
            value: {
              answer: {
                text: answers.map((item) => item.text).join(";\n"),
                sourceIds: [...new Set(answers.flatMap((item) => item.sourceIds))],
              },
              findings: result.object.findings.map((item) => ({
                subquestionId: item.subquestionId,
                ...resolveExcerpt(item.reference, evidence),
              })),
              checks: result.object.checks.map((ref) => resolveExcerpt(ref, evidence)),
              unresolved: result.object.unresolved,
            },
            consumption,
          };
        } catch {
          // Referencia inexistente: inválido.
          return {
            ok: false,
            error: "invalid",
            detail: "El informe seleccionó un extracto inexistente.",
            consumption,
          };
        }
      } catch (error) {
        // Fallo tipado.
        return failed(context.signal, error, input.prices);
      }
    },
  };
}

/** Material del curso con la recuperación vectorial existente: Workers AI, Vectorize y D1. */
export function createVectorCoursePort(input: {
  // Ejecutor de embeddings.
  embedder: EmbeddingRunner;
  // Índice vectorial.
  index: VectorIndex;
  // Base D1.
  database: SqlDatabase;
  // Ajustes de búsqueda.
  retrieval: RetrievalSettings;
}): CourseEvidencePort {
  // Puerto con retrieve.
  return {
    async retrieve({ query, audience, corpusVersion, limit }, context) {
      // try/catch: cualquier fallo se tipa.
      try {
        // Embedding de la consulta.
        const [vector] = await embedWithWorkersAi(
          input.embedder,
          input.retrieval.embeddingModel,
          [query],
          input.retrieval.dimensions,
          context.signal,
          context.timeoutMs,
        );
        // Sin vector.
        if (vector === undefined) {
          // Error de proveedor.
          return {
            ok: false,
            error: "provider",
            detail: "El embedding no devolvió un vector.",
            consumption: { kind: "unknown" },
          };
        }
        // Vecinos en Vectorize.
        const hits = await queryVectorize(
          input.index,
          { vector, audience, corpusVersion, profileId: input.retrieval.indexProfile, limit },
          context.signal,
          context.timeoutMs,
        );
        // Evidencia del curso.
        const rows: CourseEvidence[] = [];
        // Hasta el límite pedido.
        for (const hit of hits.slice(0, limit)) {
          // Por debajo del umbral: se descarta.
          if (hit.score === null || hit.score < input.retrieval.minScore) {
            // Siguiente.
            continue;
          }
          // Texto de D1.
          const record = await readChunk(input.database, corpusVersion, hit.chunkId);
          // Si existe.
          if (record !== null) {
            // Lo añade como evidencia del curso.
            rows.push({ kind: "course", sourceId: record.chunkId, ...record, score: hit.score });
          }
        }
        // Evidencia con consumo desconocido.
        return { ok: true, value: rows, consumption: { kind: "unknown" } };
      } catch {
        // Fallo tipado.
        return failed(context.signal);
      }
    },
  };
}

// Todo lo que necesitan los puertos reales.
export interface RealResearchInput {
  // Señal de cancelación.
  signal: AbortSignal;
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Ajustes de investigación.
  settings: ResearchSettings;
  // Buscador con el que se congelaron las tarifas.
  priceSearchProvider: "firecrawl" | "tavily";
  // Tope de salida por llamada.
  modelOutputTokenCap?: number;
  // Ajustes de búsqueda vectorial.
  retrieval: RetrievalSettings;
  // Modelo planificador.
  planner: LanguageModel;
  // Modelo sintetizador.
  generator: LanguageModel;
  // Embeddings.
  embedder: EmbeddingRunner;
  // Índice.
  index: VectorIndex;
  // D1.
  database: SqlDatabase;
  // fetch alternativo.
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  // Reloj alternativo.
  now?: () => number;
}

/**
 * Puertos reales. Construirlos no llama a la red. En la fase 1 la etapa HTTP
 * no los usa porque la capacidad sigue bloqueada sin contabilidad durable.
 */
export function createRealResearchPorts(input: RealResearchInput): ResearchPorts {
  // El buscador debe coincidir con el de las tarifas congeladas.
  if (input.priceSearchProvider !== (input.settings.searchProvider ?? "firecrawl")) {
    // Error de configuración.
    throw new Error("research-search-provider-price-mismatch");
  }
  // Precio por crédito de Firecrawl.
  const usdPerCredit = input.settings.firecrawlUsdPerCredit;
  // Puertos con modelo, curso, herramienta, buscador y lector.
  return {
    measured: true,
    fixture: false,
    now: input.now ?? Date.now,
    signal: input.signal,
    allowedDomains: input.settings.allowedDomains,
    estimatedMaxUsd: estimateResearchMaxUsd(input.settings),
    model: createResearchModelPort({
      planner: input.planner,
      generator: input.generator,
      maxOutputTokens: input.modelOutputTokenCap,
      // El consumo estimado usa la misma tarifa con la que se reservó la investigación.
      prices: {
        inputUsdPerMillion: input.settings.inputUsdPerMillion,
        outputUsdPerMillion: input.settings.outputUsdPerMillion,
      },
    }),
    course: createVectorCoursePort({
      embedder: input.embedder,
      index: input.index,
      database: input.database,
      retrieval: input.retrieval,
    }),
    tool: createCourseSessionTool({
      corpusVersion: input.corpusVersion,
      audience: input.audience,
      read: (corpusVersion, chunkId) => readChunk(input.database, corpusVersion, chunkId),
    }),
    search:
      input.settings.searchProvider === "tavily"
        ? createTavilySearch({ apiKey: input.settings.tavilyApiKey ?? "", fetch: input.fetch })
        : createFirecrawlSearch({
            apiKey: input.settings.firecrawlApiKey,
            usdPerCredit,
            fetch: input.fetch,
          }),
    reader:
      input.settings.searchProvider === "tavily"
        ? createTavilyReader({
            apiKey: input.settings.tavilyApiKey ?? "",
            allowedDomains: input.settings.allowedDomains,
            fetch: input.fetch,
            now: input.now,
          })
        : createFirecrawlReader({
            apiKey: input.settings.firecrawlApiKey,
            usdPerCredit,
            fetch: input.fetch,
            now: input.now,
          }),
  };
}
