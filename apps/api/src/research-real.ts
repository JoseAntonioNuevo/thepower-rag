import { RESEARCH_LIMITS, type Audience } from "@thepower-rag/contracts";
import type {
  Consumption,
  CourseEvidence,
  CourseEvidencePort,
  PortResult,
  ResearchModelPort,
  ResearchPorts,
} from "@thepower-rag/research";
import { APICallError, generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
import { z } from "zod";
import type { ResearchSettings, RetrievalSettings } from "./env";
import { createFirecrawlReader, createFirecrawlSearch } from "./firecrawl";
import { createTavilyReader, createTavilySearch } from "./tavily";
import { anthropicProviderOptions } from "./model";
import { tokenEstimateConsumption } from "./provider-cost";
import { excerptChoices, resolveExcerpt } from "./research-excerpts";
import { ASSESS_PROMPT, FOLLOW_UP_PROMPT, PLAN_PROMPT, SYNTHESIS_PROMPT } from "./research-prompts";
import { createCourseSessionTool } from "./research-tool";
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";

const sid = z.enum(["q1", "q2", "q3"]);

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

function boundedAssessmentSchema(catalog: readonly { sourceId: string; excerpts: string[] }[]) {
  // A flat provider schema avoids an anyOf branch for every source. The
  // resolver below still checks each index against its own source.
  const sources = catalog.map((source) => source.sourceId);
  const maxIndex = Math.max(0, ...catalog.map((source) => source.excerpts.length - 1));
  const row = assessSchema.shape.items.element.extend({
    sourceId: sources.length ? z.enum(sources) : z.never(),
    excerptIds: z
      .array(z.number().int().min(0).max(maxIndex))
      .max(RESEARCH_LIMITS.maxExcerptsPerSource),
  });
  return assessSchema.extend({
    items: z.array(row).max(RESEARCH_LIMITS.maxEvidenceItems),
  });
}

const followUpSchema = z.object({
  queries: z
    .array(z.object({ subquestionId: sid, query: z.string().max(RESEARCH_LIMITS.maxQueryChars) }))
    .max(RESEARCH_LIMITS.maxSubquestions),
});

const excerptReference = z.object({
  sourceId: z.string().max(128),
  excerptIndex: z.number().int().min(0),
});

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
const INPUT_TOKENS_PER_CALL = 20_000;

/**
 * Tope estimado de una investigación con los límites de laboratorio. Se
 * redondea al alza un 25 %. No es un cargo ni una medida.
 */
export function estimateResearchMaxUsd(settings: ResearchSettings): number {
  const outputTokens = Object.values(RESEARCH_LIMITS.maxOutputTokens).reduce(
    (max, value) => Math.max(max, value),
    0,
  );
  const model =
    (RESEARCH_LIMITS.maxModelCalls *
      (INPUT_TOKENS_PER_CALL * settings.inputUsdPerMillion +
        outputTokens * settings.outputUsdPerMillion)) /
    1_000_000;
  const crawl =
    settings.searchProvider === "tavily"
      ? (RESEARCH_LIMITS.maxSearchCalls + RESEARCH_LIMITS.maxPagesRead) *
        (settings.tavilyUsdPerCredit ?? 0)
      : (RESEARCH_LIMITS.maxSearchCalls * FIRECRAWL_CREDITS_ESTIMATE.search +
          RESEARCH_LIMITS.maxPagesRead * FIRECRAWL_CREDITS_ESTIMATE.read) *
        settings.firecrawlUsdPerCredit;
  const embeddings = (RESEARCH_LIMITS.maxCourseQueries * 2_000 * 0.0118) / 1_000_000;
  return 1.25 * (model + crawl + embeddings);
}

function consumptionFrom(
  usage:
    | {
        inputTokens?: number | null;
        outputTokens?: number | null;
      }
    | null
    | undefined,
): Consumption {
  return tokenEstimateConsumption(usage);
}

function failed(signal: AbortSignal, error?: unknown): PortResult<never> {
  const structured = NoObjectGeneratedError.isInstance(error);
  const http = APICallError.isInstance(error) ? error.statusCode : undefined;
  // Never expose the generated text, provider body, request or error message.
  const detail = structured
    ? error.finishReason === "length"
      ? "El modelo agotó el tope de salida antes de completar el objeto."
      : `La salida estructurada no cumple el esquema${validationPaths(error.cause)}.`
    : http !== undefined
      ? `El proveedor del modelo respondió HTTP ${String(http)}.`
      : "El modelo no completó la llamada.";
  return {
    ok: false,
    error: signal.aborted
      ? "aborted"
      : structured && error.finishReason !== "length"
        ? "invalid"
        : "provider",
    detail: signal.aborted ? "La llamada se canceló." : detail,
    consumption: structured ? consumptionFrom(error.usage) : { kind: "unknown" },
  };
}

function validationPaths(error: unknown): string {
  let current = error;
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
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    if ("issues" in current && Array.isArray(current.issues)) {
      const paths = current.issues.slice(0, 3).flatMap((issue: unknown) => {
        if (
          typeof issue !== "object" ||
          issue === null ||
          !("path" in issue) ||
          !Array.isArray(issue.path)
        )
          return [];
        const path = issue.path;
        if (
          !path.every(
            (part: unknown) =>
              (typeof part === "number" && Number.isSafeInteger(part)) ||
              (typeof part === "string" && allowed.has(part)),
          )
        )
          return [];
        return [path.join(".")];
      });
      return paths.length ? ` (${paths.join(", ")})` : "";
    }
    current = "cause" in current ? current.cause : null;
  }
  return "";
}

function boundedExplanation(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, RESEARCH_LIMITS.maxReasonChars).trimEnd();
}

export function createResearchModelPort(input: {
  planner: LanguageModel;
  generator: LanguageModel;
  maxOutputTokens?: number;
}): ResearchModelPort {
  return {
    async plan({ question, audience }, context) {
      try {
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
          providerOptions: anthropicProviderOptions,
        });
        return {
          ok: true,
          value: { ...result.object, rationale: boundedExplanation(result.object.rationale) },
          consumption: consumptionFrom(result.usage),
        };
      } catch (error) {
        return failed(context.signal, error);
      }
    },
    async assess({ question, subquestions, evidence, priorCoverage, round }, context) {
      const catalog = evidence.map((item) => ({
        sourceId: item.sourceId,
        kind: item.kind,
        title: item.title,
        excerpts: excerptChoices(item.text),
      }));
      try {
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
          providerOptions: anthropicProviderOptions,
        });
        const consumption = consumptionFrom(result.usage);
        try {
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
          return {
            ok: false,
            error: "invalid",
            detail: "La evaluación seleccionó un extracto inexistente.",
            consumption,
          };
        }
      } catch (error) {
        return failed(context.signal, error);
      }
    },
    async followUp({ question, gaps, previousQueries }, context) {
      try {
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
          providerOptions: anthropicProviderOptions,
        });
        return {
          ok: true,
          value: result.object,
          consumption: consumptionFrom(result.usage),
        };
      } catch (error) {
        return failed(context.signal, error);
      }
    },
    async synthesize({ question, subquestions, coverage, contradictions, evidence }, context) {
      try {
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
          providerOptions: anthropicProviderOptions,
        });
        const consumption = consumptionFrom(result.usage);
        try {
          const answers = result.object.answerRefs.map((ref) => resolveExcerpt(ref, evidence));
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
          return {
            ok: false,
            error: "invalid",
            detail: "El informe seleccionó un extracto inexistente.",
            consumption,
          };
        }
      } catch (error) {
        return failed(context.signal, error);
      }
    },
  };
}

/** Material del curso con la recuperación vectorial existente: Workers AI, Vectorize y D1. */
export function createVectorCoursePort(input: {
  embedder: EmbeddingRunner;
  index: VectorIndex;
  database: SqlDatabase;
  retrieval: RetrievalSettings;
}): CourseEvidencePort {
  return {
    async retrieve({ query, audience, corpusVersion, limit }, context) {
      try {
        const [vector] = await embedWithWorkersAi(
          input.embedder,
          input.retrieval.embeddingModel,
          [query],
          input.retrieval.dimensions,
          context.signal,
          context.timeoutMs,
        );
        if (vector === undefined) {
          return {
            ok: false,
            error: "provider",
            detail: "El embedding no devolvió un vector.",
            consumption: { kind: "unknown" },
          };
        }
        const hits = await queryVectorize(
          input.index,
          { vector, audience, corpusVersion, profileId: input.retrieval.indexProfile, limit },
          context.signal,
          context.timeoutMs,
        );
        const rows: CourseEvidence[] = [];
        for (const hit of hits.slice(0, limit)) {
          if (hit.score === null || hit.score < input.retrieval.minScore) {
            continue;
          }
          const record = await readChunk(input.database, corpusVersion, hit.chunkId);
          if (record !== null) {
            rows.push({ kind: "course", sourceId: record.chunkId, ...record, score: hit.score });
          }
        }
        return { ok: true, value: rows, consumption: { kind: "unknown" } };
      } catch {
        return failed(context.signal);
      }
    },
  };
}

export interface RealResearchInput {
  signal: AbortSignal;
  audience: Audience;
  corpusVersion: string;
  settings: ResearchSettings;
  priceSearchProvider: "firecrawl" | "tavily";
  modelOutputTokenCap?: number;
  retrieval: RetrievalSettings;
  planner: LanguageModel;
  generator: LanguageModel;
  embedder: EmbeddingRunner;
  index: VectorIndex;
  database: SqlDatabase;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
}

/**
 * Puertos reales. Construirlos no llama a la red. En la fase 1 la etapa HTTP
 * no los usa porque la capacidad sigue bloqueada sin contabilidad durable.
 */
export function createRealResearchPorts(input: RealResearchInput): ResearchPorts {
  if (input.priceSearchProvider !== (input.settings.searchProvider ?? "firecrawl")) {
    throw new Error("research-search-provider-price-mismatch");
  }
  const usdPerCredit = input.settings.firecrawlUsdPerCredit;
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
