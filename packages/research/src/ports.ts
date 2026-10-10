import type {
  Audience,
  ResearchSource,
  ResearchStep,
  ResearchSummary,
} from "@thepower-rag/contracts";

/**
 * Puertos del núcleo de investigación. No dependen del navegador ni de los
 * bindings de Cloudflare. Los adaptadores reales y los de prueba viven en
 * apps/api y se inyectan al grafo.
 */

export interface CancelLike {
  readonly aborted: boolean;
}

export interface CallContext {
  /** Señal de esta llamada: se aborta por cancelación o por su plazo. */
  signal: AbortSignal;
  /** Plazo de esta llamada: el menor entre su tope y lo que queda del total. */
  timeoutMs: number;
}

/**
 * Consumo de una llamada. Desconocido no es cero: un adaptador que no puede
 * medir el cargo devuelve `unknown`.
 */
export type Consumption =
  | { kind: "none" }
  | { kind: "reported"; usd: number | null; credits: number | null }
  | { kind: "unknown" };

export type PortFailure = "timeout" | "aborted" | "provider" | "invalid" | "blocked";

export type PortResult<T> =
  | { ok: true; value: T; consumption: Consumption }
  | { ok: false; error: PortFailure; detail: string; consumption: Consumption };

export interface CourseEvidence {
  kind: "course";
  sourceId: string;
  documentId: string;
  title: string;
  section: string;
  text: string;
  audience: Audience;
  corpusVersion: string;
  score: number | null;
}

export interface ToolEvidence {
  kind: "tool";
  sourceId: string;
  toolName: "get_course_session";
  title: string;
  text: string;
  backingSourceIds: string[];
  audience: Audience;
  corpusVersion: string;
}

export interface WebEvidence {
  kind: "web";
  sourceId: string;
  requestedUrl: string;
  url: string;
  domain: string;
  title: string;
  text: string;
  retrievedAt: string;
  /** Desconocida salvo que el proveedor la dé. No se inventa. */
  publishedAt: string | null;
  contentHash: string;
  fixture: boolean;
}

export type EvidenceItem = CourseEvidence | ToolEvidence | WebEvidence;

/** Resultado de búsqueda: sirve para descubrir páginas, no es una lectura. */
export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export interface PageSnapshot {
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text: string;
  retrievedAt: string;
  publishedAt: string | null;
  contentHash: string;
}

export interface SearchPort {
  search(
    input: { query: string; allowedDomains: readonly string[]; limit: number },
    context: CallContext,
  ): Promise<PortResult<SearchHit[]>>;
}

export interface PageReadPort {
  read(input: { url: string }, context: CallContext): Promise<PortResult<PageSnapshot>>;
}

export interface CourseEvidencePort {
  retrieve(
    input: {
      query: string;
      audience: Audience;
      corpusVersion: string;
      limit: number;
    },
    context: CallContext,
  ): Promise<PortResult<CourseEvidence[]>>;
}

export interface SessionToolArgs {
  sessionId: string;
  audience: Audience;
}

export interface CourseSessionToolPort {
  getCourseSession(
    args: SessionToolArgs,
    context: CallContext,
  ): Promise<PortResult<ToolEvidence | null>>;
}

export interface ShownEvidence {
  sourceId: string;
  kind: EvidenceItem["kind"];
  title: string;
  /** Texto exacto que se enseña al modelo. Los extractos se comprueban contra él. */
  text: string;
}

export interface ModelSubquestion {
  id: string;
  text: string;
  kind: "course" | "session" | "technical";
  external: boolean;
}

/** Las salidas del modelo son `unknown` hasta pasar los validadores del núcleo. */
export interface ResearchModelPort {
  plan(
    input: { question: string; audience: Audience },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
  assess(
    input: {
      question: string;
      subquestions: readonly ModelSubquestion[];
      evidence: readonly ShownEvidence[];
      /** Cobertura ya registrada. La ronda siguiente reevalúa con la evidencia acumulada. */
      priorCoverage: readonly { subquestionId: string; status: string; gap: string | null }[];
      round: number;
    },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
  followUp(
    input: {
      question: string;
      gaps: readonly { subquestionId: string; text: string; gap: string; external: boolean }[];
      previousQueries: readonly string[];
    },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
  synthesize(
    input: {
      question: string;
      subquestions: readonly ModelSubquestion[];
      coverage: readonly { subquestionId: string; status: string; gap: string | null }[];
      contradictions: readonly string[];
      evidence: readonly (ShownEvidence & { subquestionIds: string[]; excerpts: string[] })[];
    },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
}

export interface ResearchPorts {
  /** true cuando los adaptadores pueden medir llamadas y consumo. */
  measured: boolean;
  fixture: boolean;
  now(): number;
  signal: AbortSignal;
  allowedDomains: readonly string[];
  /** Tope estimado y reservado de esta ejecución, o null si no hay reserva. */
  estimatedMaxUsd: number | null;
  model: ResearchModelPort;
  course: CourseEvidencePort;
  tool: CourseSessionToolPort;
  search: SearchPort;
  reader: PageReadPort;
}

/**
 * Observación de entrada. La fase 1 solo admite texto. La fase 3 añadirá
 * observaciones derivadas de imagen y audio con referencia a su archivo, sin
 * cambiar el núcleo: el grafo solo ve texto y su procedencia.
 */
export interface TextObservation {
  kind: "text";
  text: string;
}

export type ResearchObservation = TextObservation;

export interface ResearchRequest {
  runId: string;
  /** La fase 2 dará memoria por hilo. En la fase 1 siempre es null. */
  threadId: null;
  question: string;
  observations: readonly ResearchObservation[];
  audience: Audience;
  corpusVersion: string;
  scenarioId: ResearchSummary["scenarioId"];
}

export interface ResearchResult {
  summary: ResearchSummary;
  reportText: string;
  sources: ResearchSource[];
}

/**
 * Ejecutor de una investigación. La fase 1 lo implementa en primer plano,
 * ligado a la petición HTTP. La fase 2 puede aportar otro ejecutor durable con
 * checkpointer sin cambiar los nodos del grafo.
 */
export interface ResearchExecutor {
  run(
    request: ResearchRequest,
    ports: ResearchPorts,
    onStep?: (step: ResearchStep) => void,
  ): Promise<ResearchResult>;
}
