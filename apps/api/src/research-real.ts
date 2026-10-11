import { RESEARCH_LIMITS, type Audience } from "@thepower-rag/contracts";
import type {
  Consumption,
  CourseEvidence,
  CourseEvidencePort,
  PortResult,
  ResearchModelPort,
  ResearchPorts,
} from "@thepower-rag/research";
import { generateObject, NoObjectGeneratedError, type LanguageModel } from "ai";
import { z } from "zod";
import type { ResearchSettings, RetrievalSettings } from "./env";
import { createFirecrawlReader, createFirecrawlSearch } from "./firecrawl";
import { createTavilyReader, createTavilySearch } from "./tavily";
import { anthropicProviderOptions } from "./model";
import { tokenEstimateConsumption } from "./provider-cost";
import {
  ASSESS_PROMPT,
  FOLLOW_UP_PROMPT,
  PLAN_PROMPT,
  SYNTHESIS_PROMPT,
  dataBlock,
} from "./research-prompts";
import { createCourseSessionTool } from "./research-tool";
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";

const sid = z.enum(["q1", "q2", "q3"]);

const planSchema = z.object({
  route: z.enum(["course", "tool", "investigate", "clarify"]),
  rationale: z.string().max(RESEARCH_LIMITS.maxReasonChars),
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
        excerpts: z
          .array(z.string().max(RESEARCH_LIMITS.maxExcerptChars))
          .max(RESEARCH_LIMITS.maxExcerptsPerSource),
        reason: z.string().max(RESEARCH_LIMITS.maxReasonChars),
      }),
    )
    .max(RESEARCH_LIMITS.maxEvidenceItems),
  coverage: z
    .array(
      z.object({
        subquestionId: sid,
        status: z.enum(["covered", "partial", "uncovered"]),
        gap: z.string().max(RESEARCH_LIMITS.maxReasonChars).nullable(),
        followUp: z.boolean(),
      }),
    )
    .max(RESEARCH_LIMITS.maxSubquestions),
  contradictions: z.array(z.string().max(RESEARCH_LIMITS.maxReasonChars)).max(3),
});

const followUpSchema = z.object({
  queries: z
    .array(z.object({ subquestionId: sid, query: z.string().max(RESEARCH_LIMITS.maxQueryChars) }))
    .max(RESEARCH_LIMITS.maxSubquestions),
});

const ids = z.array(z.string().max(128)).max(RESEARCH_LIMITS.maxEvidenceItems);

const synthesisSchema = z.object({
  answer: z.object({ text: z.string().max(RESEARCH_LIMITS.maxAnswerChars), sourceIds: ids }),
  findings: z
    .array(
      z.object({
        subquestionId: sid,
        text: z.string().max(RESEARCH_LIMITS.maxClaimChars),
        sourceIds: ids,
      }),
    )
    .max(RESEARCH_LIMITS.maxFindings),
  checks: z
    .array(z.object({ text: z.string().max(RESEARCH_LIMITS.maxClaimChars), sourceIds: ids }))
    .max(RESEARCH_LIMITS.maxChecks),
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
  // Never expose the generated text, provider body, request or error message.
  const detail = structured
    ? error.finishReason === "length"
      ? "El modelo agotó el tope de salida antes de completar el objeto."
      : "La salida estructurada del modelo no cumple el esquema."
    : "El modelo no completó la llamada.";
  return {
    ok: false,
    error: signal.aborted ? "aborted" : "provider",
    detail: signal.aborted ? "La llamada se canceló." : detail,
    consumption: structured ? consumptionFrom(error.usage) : { kind: "unknown" },
  };
}

export function createResearchModelPort(input: {
  planner: LanguageModel;
  generator: LanguageModel;
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
          maxOutputTokens: RESEARCH_LIMITS.maxOutputTokens.plan,
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
    async assess({ question, subquestions, evidence, priorCoverage, round }, context) {
      try {
        const result = await generateObject({
          model: input.planner,
          schema: assessSchema,
          schemaName: "research-evidence",
          system: ASSESS_PROMPT,
          prompt: `Pregunta original:\n${question}\n\nRonda: ${String(round)}\n\nSubpreguntas:\n${JSON.stringify(subquestions)}\n\nCobertura previa:\n${JSON.stringify(priorCoverage)}\n\nDATOS:\n${dataBlock(evidence)}`,
          maxOutputTokens: RESEARCH_LIMITS.maxOutputTokens.assess,
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
    async followUp({ question, gaps, previousQueries }, context) {
      try {
        const result = await generateObject({
          model: input.planner,
          schema: followUpSchema,
          schemaName: "research-follow-up",
          system: FOLLOW_UP_PROMPT,
          prompt: `Pregunta original:\n${question}\n\nLagunas:\n${JSON.stringify(gaps)}\n\nConsultas anteriores:\n${previousQueries.join("\n")}`,
          maxOutputTokens: RESEARCH_LIMITS.maxOutputTokens.followUp,
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
          prompt: `Pregunta original:\n${question}\n\nSubpreguntas:\n${JSON.stringify(subquestions)}\n\nCobertura:\n${JSON.stringify(coverage)}\n\nContradicciones:\n${JSON.stringify(contradictions)}\n\nDATOS:\n${dataBlock(evidence)}\n\nExtractos admitidos:\n${JSON.stringify(evidence.map((item) => ({ sourceId: item.sourceId, subquestionIds: item.subquestionIds, excerpts: item.excerpts })))}`,
          maxOutputTokens: RESEARCH_LIMITS.maxOutputTokens.synthesis,
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
    model: createResearchModelPort({ planner: input.planner, generator: input.generator }),
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
