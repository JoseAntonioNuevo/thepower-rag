// GUÍA DE LECTURA · packages/contracts/src/health.ts
// Respuesta de /api/health: modo de ejecución, estado de cada etapa, corpus, compatibilidad
// de dependencias y medios de S12. Leerla no llama a ningún modelo.
import { z } from "zod";
// Estados posibles de una capacidad.
import { capabilityStatusSchema } from "./domain";

// Estado de una etapa y lo que le falta.
const capabilitySchema = z.object({
  // ready, blocked, offline-demo…
  status: capabilityStatusSchema,
  // Nombres de variables o bindings ausentes, nunca sus valores.
  missing: z.array(z.string()),
});

// Esquema completo de la salud del servicio.
export const healthResponseSchema = z.object({
  // Nombre fijo de la aplicación.
  app: z.literal("thepower-rag"),
  // Fase del proyecto.
  phase: z.literal("crag"),
  // demo, real o misconfigured.
  execution: z.enum(["demo", "real", "misconfigured"]),
  // Entorno de ejecución (por ejemplo, Cloudflare-Workers).
  runtime: z.string().min(1),
  // Estado de las cuatro etapas.
  capabilities: z.object({
    "sin-rag": capabilitySchema,
    rag: capabilitySchema,
    crag: capabilitySchema,
    research: capabilitySchema,
  }),
  // Corpus consultado y su perfil de índice.
  corpus: z.object({
    // Versión preparada, de contenido y perfil (null si no se conocen).
    version: z.string().nullable(),
    contentVersion: z.string().nullable(),
    profileId: z.string().nullable(),
    // Familia del índice: léxico de prueba, BGE-M3 real o desconocida.
    profileFamily: z.enum(["fixture", "workers-ai", "unknown"]),
    // Cobertura del corpus por apartado y si el índice remoto se verificó.
    coverage: z.object({
      curriculum: z.enum(["complete", "partial", "unknown"]),
      calendarLx: z.enum(["complete", "partial", "unknown"]),
      calendarMj: z.enum(["complete", "partial", "unknown"]),
      exerciseDetail: z.enum(["complete", "partial", "unknown"]),
      remote: z.enum(["not-verified", "index-verified"]),
    }),
    // Modelo de embeddings, dimensión y revisión remota (siempre null por ahora).
    embedding: z.string(),
    dimensions: z.number().int().positive().nullable(),
    remoteRevision: z.null(),
  }),
  // Comprobación de que LangGraph y el SDK de Anthropic cargan; no es una llamada real.
  compatibility: z.object({
    langgraph: z.enum(["ok", "failed"]),
    anthropic: z.enum(["loaded", "failed"]),
    note: z.string(),
  }),
  /** True cuando hay base y flujo durable. No autoriza gasto real. */
  durableResearch: z.boolean(),
  /** Identidad pública de modelos y plazo. No contiene claves ni acredita inferencia. */
  modelConfiguration: z
    .object({
      provider: z.string().nullable(),
      generator: z.string().nullable(),
      evaluator: z.string().nullable(),
      research: z.string().nullable(),
      cragExecutionBudgetMs: z.number().int().min(1_000).max(120_000).nullable(),
      generationTimeoutMs: z.number().int().min(1_000).max(60_000).nullable().optional(),
      ragContextMode: z.enum(["semantic", "complete", "fixture"]).optional(),
      retrievalMinScore: z.number().nullable().optional(),
    })
    .optional(),
  /** Presencia de almacenamiento y modelos. Inspeccionar no llama al proveedor. */
  media: z
    .object({
      storage: z.enum(["ready", "missing"]),
      vision: z.enum(["fixture", "configured", "missing"]),
      transcription: z.enum(["fixture", "configured", "missing"]),
      speech: z.enum(["fixture", "configured", "missing"]),
      note: z.string().min(1).max(240),
    })
    .optional(),
});

// Tipo de la respuesta de salud.
export type HealthResponse = z.infer<typeof healthResponseSchema>;
