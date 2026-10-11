import {
  RESEARCH_LIMITS,
  researchSourceSchema,
  researchSummarySchema,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
import { z } from "zod";
import type { ResearchDatabase } from "./research-db";

/** Texto corto vive en el resultado. Uno más largo queda en un artefacto del mismo trabajo. */
const INLINE_REPORT_CHARS = 24_000;
const ARTIFACT_REPORT_CHARS = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storedReportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(INLINE_REPORT_CHARS) }),
  z.object({ kind: z.literal("artifact"), artifactId: z.string().regex(UUID) }),
]);

const storedResultSchema = z.object({
  summary: researchSummarySchema,
  sources: z.array(researchSourceSchema).max(RESEARCH_LIMITS.maxEvidenceItems + 2),
  report: storedReportSchema.optional(),
});

export type StoredResearchResult = z.infer<typeof storedResultSchema>;

export interface PresentedResearchResult {
  summary: ResearchSummary;
  sources: ResearchSource[];
  report: { kind: "text" | "artifact"; text: string; artifactId?: string } | null;
  reportAvailability: "stored" | "legacy-missing" | "missing-artifact";
}

/**
 * Guarda el informe validado junto al resumen. No usa la memoria de la
 * conversación: esa copia puede estar recortada.
 */
export async function buildStoredResult(
  database: ResearchDatabase,
  input: {
    ownerId: string;
    jobId: string;
    summary: ResearchSummary;
    sources: ResearchSource[];
    reportText: string;
    now: number;
  },
): Promise<StoredResearchResult | null> {
  if (input.reportText.length > ARTIFACT_REPORT_CHARS) {
    return null;
  }
  const report =
    input.reportText.length <= INLINE_REPORT_CHARS
      ? { kind: "text" as const, text: input.reportText }
      : await storeArtifact(database, input);
  if (report === null) {
    return null;
  }
  const parsed = storedResultSchema.safeParse({
    summary: input.summary,
    sources: input.sources,
    report,
  });
  return parsed.success ? parsed.data : null;
}

async function storeArtifact(
  database: ResearchDatabase,
  input: { ownerId: string; jobId: string; reportText: string; now: number },
): Promise<{ kind: "artifact"; artifactId: string } | null> {
  const artifactId = crypto.randomUUID();
  await database
    .prepare(
      `INSERT INTO research_report_artifacts (id, job_id, owner_id, text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(artifactId, input.jobId, input.ownerId, input.reportText, input.now)
    .run();
  return { kind: "artifact", artifactId };
}

/** Lee el resultado guardado. Un registro antiguo no se reconstruye desde la memoria. */
export async function presentResearchResult(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  resultJson: string,
): Promise<PresentedResearchResult | null> {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(resultJson) as unknown;
  } catch {
    return null;
  }
  const stored = storedResultSchema.safeParse(parsedJson);
  if (!stored.success) {
    return null;
  }
  if (stored.data.report === undefined) {
    return {
      summary: stored.data.summary,
      sources: stored.data.sources,
      report: null,
      reportAvailability: "legacy-missing",
    };
  }
  if (stored.data.report.kind === "text") {
    return {
      summary: stored.data.summary,
      sources: stored.data.sources,
      report: { kind: "text", text: stored.data.report.text },
      reportAvailability: "stored",
    };
  }
  const artifact = await database
    .prepare(
      `SELECT text FROM research_report_artifacts
       WHERE id = ? AND job_id = ? AND owner_id = ?`,
    )
    .bind(stored.data.report.artifactId, jobId, ownerId)
    .first<{ text: string }>();
  if (artifact === null) {
    return {
      summary: stored.data.summary,
      sources: stored.data.sources,
      report: null,
      reportAvailability: "missing-artifact",
    };
  }
  return {
    summary: stored.data.summary,
    sources: stored.data.sources,
    report: {
      kind: "artifact",
      artifactId: stored.data.report.artifactId,
      text: artifact.text,
    },
    reportAvailability: "stored",
  };
}
