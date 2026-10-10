import { z } from "zod";
import { capabilityStatusSchema } from "./domain";

const capabilitySchema = z.object({
  status: capabilityStatusSchema,
  missing: z.array(z.string()),
});

export const healthResponseSchema = z.object({
  app: z.literal("thepower-rag"),
  phase: z.literal("crag"),
  execution: z.enum(["demo", "real", "misconfigured"]),
  runtime: z.string().min(1),
  capabilities: z.object({
    "sin-rag": capabilitySchema,
    rag: capabilitySchema,
    crag: capabilitySchema,
    research: capabilitySchema,
  }),
  corpus: z.object({
    version: z.string().nullable(),
    contentVersion: z.string().nullable(),
    profileId: z.string().nullable(),
    profileFamily: z.enum(["fixture", "workers-ai", "unknown"]),
    coverage: z.object({
      curriculum: z.enum(["complete", "partial", "unknown"]),
      calendarLx: z.enum(["complete", "partial", "unknown"]),
      calendarMj: z.enum(["complete", "partial", "unknown"]),
      exerciseDetail: z.enum(["complete", "partial", "unknown"]),
      remote: z.enum(["not-verified", "index-verified"]),
    }),
    embedding: z.string(),
    dimensions: z.number().int().positive().nullable(),
    remoteRevision: z.null(),
  }),
  compatibility: z.object({
    langgraph: z.enum(["ok", "failed"]),
    anthropic: z.enum(["loaded", "failed"]),
    note: z.string(),
  }),
  /** True cuando hay base y flujo durable. No autoriza gasto real. */
  durableResearch: z.boolean(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
