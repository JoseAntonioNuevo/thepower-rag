import { z } from "zod";
import { LIMITS } from "./limits";

export const cohortSchema = z.enum(["L/X", "M/J"]);

export type CohortId = z.infer<typeof cohortSchema>;

export const audienceSchema = z.enum(["program", "L/X", "M/J"]);

export type Audience = z.infer<typeof audienceSchema>;

export const evidenceDecisionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("sufficient"),
    reason: z.string(),
  }),
  z.object({
    status: z.literal("partial"),
    reason: z.string(),
    gaps: z.array(z.string()),
  }),
  z.object({
    status: z.literal("insufficient"),
    reason: z.string(),
  }),
]);

export type EvidenceDecision = z.infer<typeof evidenceDecisionSchema>;

export const citationSchema = z.object({
  documentId: z.string(),
  chunkId: z.string(),
  title: z.string(),
  section: z.string(),
  excerpt: z.string().max(LIMITS.maxMessageChars),
  corpusVersion: z.string(),
});

export type Citation = z.infer<typeof citationSchema>;

export const runUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
});

export const runCostSchema = z.object({
  amount: z.number().finite(),
  currency: z.string().min(1),
  source: z.string().min(1),
  method: z.string().min(1),
});

export const runMetadataSchema = z.object({
  runId: z.string().min(1).max(LIMITS.maxIdChars),
  origin: z.enum(["offline-demo", "offline-fixture", "provider", "pipeline"]),
  modelId: z.string().nullable(),
  promptId: z.string(),
  completion: z.enum([
    "streaming",
    "complete",
    "partial",
    "aborted",
    "error",
    "refused",
    "clarified",
  ]),
  usage: runUsageSchema.nullable(),
  cost: runCostSchema.nullable(),
});

export type RunMetadata = z.infer<typeof runMetadataSchema>;

export const demoEventSchema = z.object({
  kind: z.literal("offline-demo"),
  label: z.string(),
  usage: z.null(),
  cost: z.null(),
});

export type DemoEvent = z.infer<typeof demoEventSchema>;

export const traceEventSchema = z.object({
  query: z.string(),
  queryRewrite: z.enum(["pending", "context-complete"]),
  corpusVersion: z.string().nullable(),
  embedding: z.string(),
  scoreMeaning: z.string(),
  retrieved: z.array(
    z.object({
      chunkId: z.string(),
      score: z.number().finite().nullable(),
      selected: z.boolean(),
    }),
  ),
  decision: z.enum(["answer", "refuse", "clarify"]),
  generation: z.enum(["called", "skipped"]),
  status: z.string(),
});

export type TraceEvent = z.infer<typeof traceEventSchema>;

export const capabilityStatusSchema = z.enum([
  "offline-demo",
  "offline-fixture",
  "ready",
  "blocked",
  "not-implemented",
]);

export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;
