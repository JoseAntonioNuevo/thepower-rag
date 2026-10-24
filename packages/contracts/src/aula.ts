// GUÍA DE LECTURA · packages/contracts/src/aula.ts
// Contratos públicos del Aula local. Solo datos observados: ningún cliente recibe credenciales.

// Etapas compartidas por el pipeline, la interfaz y el registro de PostgreSQL.
export const AULA_STAGES = {
  documents: { label: "Documentos", description: "Lee las fuentes originales del corpus." },
  chunking: { label: "Fragmentación", description: "Limpia el texto y prepara sus fragmentos." },
  schema: {
    label: "Preparar el esquema",
    description: "Comprueba las tablas, la extensión vector y el índice HNSW.",
  },
  "document-embeddings": {
    label: "Embeddings del corpus",
    description: "Obtiene los vectores reales de cada fragmento.",
  },
  store: {
    label: "Guardar el índice",
    description: "Escribe documentos y vectores en una transacción.",
  },
  "verify-index": {
    label: "Leer de vuelta",
    description: "Comprueba los datos guardados en PostgreSQL.",
  },
  "question-embedding": {
    label: "Embedding de la pregunta",
    description: "Representa la pregunta con el mismo modelo del índice.",
  },
  search: {
    label: "Búsqueda vectorial",
    description: "Ejecuta el SQL y recupera los vecinos más próximos.",
  },
  selection: {
    label: "Selección de evidencia",
    description: "Aplica el umbral antes de llamar al generador.",
  },
  prompt: {
    label: "Contexto y prompt",
    description: "Muestra las instrucciones y los fragmentos que recibirá el modelo.",
  },
  generation: {
    label: "Generación",
    description: "Observa la respuesta real mientras llega del proveedor.",
  },
  citations: {
    label: "Comprobar las citas",
    description: "Contrasta las citas con la evidencia entregada al modelo.",
  },
} as const;

// Identidades y estados; las pausas ocurren antes de una operación, nunca dentro de una llamada de pago.
export type AulaStageId = keyof typeof AULA_STAGES;
export type AulaKind = "rag" | "baseline" | "ingest";
export type AulaMode = "step" | "auto";
export type AulaRunStatus =
  | "running"
  | "waiting"
  | "complete"
  | "failed"
  | "cancelled"
  | "interrupted";
export type AulaJson = null | boolean | number | string | AulaJson[] | { [key: string]: AulaJson };

// Observador opcional del pipeline original; sin observador, CLI y pruebas mantienen su recorrido.
export interface AulaObserver {
  before(stage: AulaStageId, input: unknown): Promise<void>;
  after(stage: AulaStageId, output: unknown): Promise<void>;
  delta?(text: string): Promise<void>;
}

// Evento persistido antes de notificarse al navegador y visible también en TablePlus.
export interface AulaEvent {
  runId: string;
  seq: number;
  stage: AulaStageId | null;
  type: "stage" | "sql" | "delta" | "usage" | "status";
  phase: "waiting" | "running" | "complete" | "error" | "info";
  at: string;
  durationMs: number | null;
  data: AulaJson;
}

// Ejecución completa, recuperable para lectura tras recargar la página.
export interface AulaRun {
  id: string;
  kind: AulaKind;
  mode: AulaMode;
  status: AulaRunStatus;
  question: string;
  createdAt: string;
  updatedAt: string;
  waitingStage: AulaStageId | null;
  currentStage: AulaStageId | null;
  stages: AulaStageId[];
  events: AulaEvent[];
  result: AulaJson;
  error: string | null;
}

// Índice leído directamente de la base; vector contiene las componentes almacenadas, sin proyección.
export interface AulaStoredChunk {
  chunkId: string;
  documentId: string;
  title: string;
  section: string;
  content: string;
  ordinal: number;
  corpusVersion: string;
  embeddingModel: string;
  vector: number[];
}

// Fuentes que el profesor puede comparar con los fragmentos y con las citas.
export interface AulaDocument {
  documentId: string;
  title: string;
  sourcePath: string;
  rawText: string;
  cleanText: string;
  contentHash: string;
}

// Estado de preparación y de gasto: los importes reservados no son una factura.
export interface AulaStatus {
  executionEnabled: boolean;
  missing: string[];
  backend: "postgresql-pgvector";
  database: string;
  generationModel: string;
  generationProvider: string;
  embeddingModel: string;
  corpusVersion: string;
  profile: string;
  documents: number;
  chunks: number;
  dimensions: number | null;
  hnsw: string | null;
  calibration: { valid: boolean; threshold: number | null; rows: AulaJson };
  budget: { limitUsd: number; reservedUsd: number; calls: number; actualProviderUsd: null };
  activeRunId: string | null;
}

// El orden de cada recorrido es explícito para que una pausa no dependa de una animación.
export function aulaStages(kind: AulaKind): AulaStageId[] {
  if (kind === "ingest")
    return ["documents", "chunking", "schema", "document-embeddings", "store", "verify-index"];
  if (kind === "baseline") return ["prompt", "generation", "citations"];
  return ["question-embedding", "search", "selection", "prompt", "generation", "citations"];
}
