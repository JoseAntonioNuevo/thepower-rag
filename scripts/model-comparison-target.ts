// GUÍA DE LECTURA · scripts/model-comparison-target.ts
// Impide atribuir una comparación congelada a un despliegue con modelos, índice o plazo distintos.
// La respuesta health es pública y no invoca modelos.
import { healthResponseSchema } from "@thepower-rag/contracts";

// Identidad mínima que debe compartir RAG y CRAG en el experimento.
export interface FrozenModelTarget {
  provider: string;
  model: string;
  evaluator: string;
  corpus: string;
  profile: string;
  embedding: string;
  dimensions: number;
  turnDeadlineMs: number;
  ragContextMode: string;
  minScore: number;
  generationTimeoutMs?: number;
}

// Falla antes del primer POST si la lectura no demuestra el objetivo del experimento.
export function assertModelComparisonTarget(frozen: FrozenModelTarget, body: unknown): void {
  // Valida la respuesta pública de health antes de utilizar sus campos como evidencia.
  const health = healthResponseSchema.parse(body);
  // Extrae las identidades y parámetros declarados por el despliegue consultado.
  const models = health.modelConfiguration;
  // Contrasta ejecución real, capacidades, modelos, plazos, corpus, perfil y corte con la referencia congelada.
  if (
    health.execution !== "real" ||
    health.capabilities.rag.status !== "ready" ||
    health.capabilities.crag.status !== "ready" ||
    !models ||
    models.provider !== frozen.provider ||
    models.generator !== frozen.model ||
    models.evaluator !== frozen.evaluator ||
    models.ragContextMode !== frozen.ragContextMode ||
    models.retrievalMinScore !== frozen.minScore ||
    (frozen.generationTimeoutMs !== undefined &&
      models.generationTimeoutMs !== frozen.generationTimeoutMs) ||
    models.cragExecutionBudgetMs !== frozen.turnDeadlineMs ||
    health.corpus.version !== frozen.corpus ||
    health.corpus.profileId !== frozen.profile ||
    health.corpus.embedding !== frozen.embedding ||
    health.corpus.dimensions !== frozen.dimensions ||
    health.corpus.coverage.remote !== "index-verified"
  ) {
    // Cualquier discrepancia cancela el lote antes de enviar preguntas de pago a un objetivo distinto.
    throw new Error(
      "La web no demuestra los modelos, índice y plazo congelados. No se ejecuta el lote.",
    );
  }
}
