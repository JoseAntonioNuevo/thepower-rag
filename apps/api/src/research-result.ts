// GUÍA DE LECTURA · apps/api/src/research-result.ts
// Resultado guardado de una investigación: resumen, fuentes e informe. Un informe largo se guarda
// aparte como artefacto del mismo trabajo y se lee de vuelta con su dueño.
// Límites y esquemas del contrato.
import {
  RESEARCH_LIMITS,
  researchSourceSchema,
  researchSummarySchema,
  type ResearchSource,
  type ResearchSummary,
} from "@thepower-rag/contracts";
// Zod para validar lo guardado.
import { z } from "zod";
// Tipo de la base de datos de la investigación.
import type { ResearchDatabase } from "./research-db";

/** Texto corto vive en el resultado. Uno más largo queda en un artefacto del mismo trabajo. */
const INLINE_REPORT_CHARS = 24_000;
// Caracteres máximos de un informe como artefacto.
const ARTIFACT_REPORT_CHARS = 100_000;
// Forma de un UUID.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Informe guardado: texto en línea o referencia a un artefacto.
const storedReportSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().max(INLINE_REPORT_CHARS) }),
  z.object({ kind: z.literal("artifact"), artifactId: z.string().regex(UUID) }),
]);

// Resultado guardado completo.
const storedResultSchema = z.object({
  summary: researchSummarySchema,
  sources: z.array(researchSourceSchema).max(RESEARCH_LIMITS.maxEvidenceItems + 2),
  report: storedReportSchema.optional(),
});

// Tipo del resultado guardado.
export type StoredResearchResult = z.infer<typeof storedResultSchema>;

// Resultado listo para enseñar.
export interface PresentedResearchResult {
  // Resumen.
  summary: ResearchSummary;
  // Fuentes.
  sources: ResearchSource[];
  // Informe, o null.
  report: { kind: "text" | "artifact"; text: string; artifactId?: string } | null;
  // Si el informe está, es antiguo o falta el artefacto.
  reportAvailability: "stored" | "legacy-missing" | "missing-artifact";
}

/**
 * Guarda el informe validado junto al resumen. No usa la memoria de la
 * conversación: esa copia puede estar recortada.
 */
export async function buildStoredResult(
  database: ResearchDatabase,
  input: {
    // Dueño.
    ownerId: string;
    // Trabajo.
    jobId: string;
    // Resumen.
    summary: ResearchSummary;
    // Fuentes.
    sources: ResearchSource[];
    // Texto del informe.
    reportText: string;
    // Hora actual.
    now: number;
  },
): Promise<StoredResearchResult | null> {
  // Demasiado largo: no se guarda.
  if (input.reportText.length > ARTIFACT_REPORT_CHARS) {
    // Sin resultado.
    return null;
  }
  // Corto: en línea; largo: como artefacto.
  const report =
    input.reportText.length <= INLINE_REPORT_CHARS
      ? { kind: "text" as const, text: input.reportText }
      : await storeArtifact(database, input);
  // No se pudo guardar.
  if (report === null) {
    // Sin resultado.
    return null;
  }
  // Valida lo que se va a guardar.
  const parsed = storedResultSchema.safeParse({
    summary: input.summary,
    sources: input.sources,
    report,
  });
  // Resultado válido o null.
  return parsed.success ? parsed.data : null;
}

// Guarda el informe largo en su tabla.
async function storeArtifact(
  database: ResearchDatabase,
  input: { ownerId: string; jobId: string; reportText: string; now: number },
): Promise<{ kind: "artifact"; artifactId: string } | null> {
  // Id del artefacto.
  const artifactId = crypto.randomUUID();
  // Inserta el informe con su trabajo y dueño.
  await database
    .prepare(
      `INSERT INTO research_report_artifacts (id, job_id, owner_id, text, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(artifactId, input.jobId, input.ownerId, input.reportText, input.now)
    .run();
  // Referencia al artefacto.
  return { kind: "artifact", artifactId };
}

/** Lee el resultado guardado. Un registro antiguo no se reconstruye desde la memoria. */
export async function presentResearchResult(
  database: ResearchDatabase,
  ownerId: string,
  jobId: string,
  resultJson: string,
): Promise<PresentedResearchResult | null> {
  // JSON leído.
  let parsedJson: unknown;
  // JSON inválido: null.
  try {
    // Lee el JSON.
    parsedJson = JSON.parse(resultJson) as unknown;
  } catch {
    // Inválido.
    return null;
  }
  // Valida con el esquema.
  const stored = storedResultSchema.safeParse(parsedJson);
  // Forma incorrecta.
  if (!stored.success) {
    // Sin resultado.
    return null;
  }
  // Registro antiguo sin informe.
  if (stored.data.report === undefined) {
    // Se marca como antiguo.
    return {
      summary: stored.data.summary,
      sources: stored.data.sources,
      report: null,
      reportAvailability: "legacy-missing",
    };
  }
  // Informe en línea.
  if (stored.data.report.kind === "text") {
    // Se devuelve.
    return {
      summary: stored.data.summary,
      sources: stored.data.sources,
      report: { kind: "text", text: stored.data.report.text },
      reportAvailability: "stored",
    };
  }
  // Informe como artefacto: se lee comprobando trabajo y dueño.
  const artifact = await database
    .prepare(
      `SELECT text FROM research_report_artifacts
       WHERE id = ? AND job_id = ? AND owner_id = ?`,
    )
    .bind(stored.data.report.artifactId, jobId, ownerId)
    .first<{ text: string }>();
  // Falta el artefacto.
  if (artifact === null) {
    // Se marca como ausente.
    return {
      summary: stored.data.summary,
      sources: stored.data.sources,
      report: null,
      reportAvailability: "missing-artifact",
    };
  }
  // Informe del artefacto.
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
