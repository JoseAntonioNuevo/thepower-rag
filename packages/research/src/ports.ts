// GUÍA DE LECTURA · packages/research/src/ports.ts
// Puertos de la investigación: tipos de evidencia (curso, herramienta, web), resultados de cada
// llamada con su consumo y las interfaces que implementan los adaptadores reales o de prueba.
// Tipos del contrato compartido.
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

// Señal de cancelación mínima.
export interface CancelLike {
  // true si se canceló.
  readonly aborted: boolean;
}

// Contexto de cada llamada: señal y plazo.
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
  | {
      /** USD calculado con tarifas publicadas a partir de tokens. No es un importe del proveedor. */
      kind: "estimated";
      // Importe estimado, o null.
      usd: number | null;
      // De dónde sale la tarifa.
      provenance: string;
      /** Falso cuando falta el uso de entrada o de salida. La cifra parcial no cierra el cargo. */
      complete: boolean;
      // Tokens de entrada observados.
      inputTokens: number | null;
      // Tokens de salida observados.
      outputTokens: number | null;
    }
  | { kind: "unknown" };

// Tipo de fallo de un puerto: plazo, cancelación, proveedor, salida inválida o bloqueo.
export type PortFailure = "timeout" | "aborted" | "provider" | "invalid" | "blocked";

// Resultado de un puerto: valor o fallo, siempre con su consumo.
export type PortResult<T> =
  | { ok: true; value: T; consumption: Consumption }
  | { ok: false; error: PortFailure; detail: string; consumption: Consumption };

// Evidencia del corpus del curso.
export interface CourseEvidence {
  // Tipo de evidencia.
  kind: "course";
  // Id de la fuente.
  sourceId: string;
  // Documento.
  documentId: string;
  // Título.
  title: string;
  // Sección.
  section: string;
  // Texto.
  text: string;
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Puntuación de la búsqueda.
  score: number | null;
}

// Evidencia de la herramienta de sesiones.
export interface ToolEvidence {
  // Tipo de evidencia.
  kind: "tool";
  // Id de la fuente.
  sourceId: string;
  // Nombre de la herramienta.
  toolName: "get_course_session";
  // Título.
  title: string;
  // Texto devuelto.
  text: string;
  // Fragmentos del curso que la respaldan.
  backingSourceIds: string[];
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
}

// Evidencia de una página web leída.
export interface WebEvidence {
  // Tipo de evidencia.
  kind: "web";
  // Id de la fuente.
  sourceId: string;
  // URL pedida.
  requestedUrl: string;
  // URL final tras redirecciones.
  url: string;
  // Dominio.
  domain: string;
  // Título.
  title: string;
  // Texto leído.
  text: string;
  // Momento de la lectura.
  retrievedAt: string;
  /** Desconocida salvo que el proveedor la dé. No se inventa. */
  publishedAt: string | null;
  // Hash del contenido.
  contentHash: string;
  // true si viene de la demo.
  fixture: boolean;
}

// Cualquier tipo de evidencia.
export type EvidenceItem = CourseEvidence | ToolEvidence | WebEvidence;

/** Resultado de búsqueda: sirve para descubrir páginas, no es una lectura. */
export interface SearchHit {
  // URL encontrada.
  url: string;
  // Título.
  title: string;
  // Resumen del buscador.
  snippet: string;
}

// Página leída.
export interface PageSnapshot {
  // URL pedida.
  requestedUrl: string;
  // URL final.
  finalUrl: string;
  // Título.
  title: string;
  // Texto.
  text: string;
  // Momento de la lectura.
  retrievedAt: string;
  // Fecha de publicación, si se conoce.
  publishedAt: string | null;
  // Hash del contenido.
  contentHash: string;
}

// Puerto del buscador.
export interface SearchPort {
  // Busca en los dominios permitidos.
  search(
    input: { query: string; allowedDomains: readonly string[]; limit: number },
    context: CallContext,
  ): Promise<PortResult<SearchHit[]>>;
}

// Puerto del lector de páginas.
export interface PageReadPort {
  // Lee una URL.
  read(input: { url: string }, context: CallContext): Promise<PortResult<PageSnapshot>>;
}

// Puerto del corpus del curso.
export interface CourseEvidencePort {
  // Busca fragmentos del curso.
  retrieve(
    input: {
      // Consulta.
      query: string;
      // Audiencia.
      audience: Audience;
      // Versión del corpus.
      corpusVersion: string;
      // Fragmentos pedidos.
      limit: number;
    },
    context: CallContext,
  ): Promise<PortResult<CourseEvidence[]>>;
}

// Argumentos de la herramienta de sesiones.
export interface SessionToolArgs {
  // Sesión (por ejemplo, S12).
  sessionId: string;
  // Grupo.
  audience: Audience;
}

// Puerto de la herramienta de sesiones.
export interface CourseSessionToolPort {
  // Devuelve la ficha de una sesión, o null.
  getCourseSession(
    args: SessionToolArgs,
    context: CallContext,
  ): Promise<PortResult<ToolEvidence | null>>;
}

// Evidencia tal como se enseña al modelo.
export interface ShownEvidence {
  // Id de la fuente.
  sourceId: string;
  // Tipo.
  kind: EvidenceItem["kind"];
  // Título.
  title: string;
  /** Texto exacto que se enseña al modelo. Los extractos se comprueban contra él. */
  text: string;
}

// Subpregunta tal como la recibe el modelo.
export interface ModelSubquestion {
  // Id (q1, q2, q3).
  id: string;
  // Texto.
  text: string;
  // Tipo.
  kind: "course" | "session" | "technical";
  // Si necesita fuentes externas.
  external: boolean;
}

/** Las salidas del modelo son `unknown` hasta pasar los validadores del núcleo. */
export interface ResearchModelPort {
  // Plan de la investigación.
  plan(
    input: { question: string; audience: Audience },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
  // Evaluación de la evidencia.
  assess(
    input: {
      // Pregunta.
      question: string;
      // Subpreguntas.
      subquestions: readonly ModelSubquestion[];
      // Evidencia mostrada.
      evidence: readonly ShownEvidence[];
      /** Cobertura ya registrada. La ronda siguiente reevalúa con la evidencia acumulada. */
      priorCoverage: readonly { subquestionId: string; status: string; gap: string | null }[];
      // Ronda.
      round: number;
    },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
  // Consultas de seguimiento.
  followUp(
    input: {
      // Pregunta.
      question: string;
      // Lagunas por cubrir.
      gaps: readonly { subquestionId: string; text: string; gap: string; external: boolean }[];
      // Consultas ya hechas.
      previousQueries: readonly string[];
    },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
  // Síntesis del informe.
  synthesize(
    input: {
      // Pregunta.
      question: string;
      // Subpreguntas.
      subquestions: readonly ModelSubquestion[];
      // Cobertura.
      coverage: readonly { subquestionId: string; status: string; gap: string | null }[];
      // Contradicciones.
      contradictions: readonly string[];
      // Evidencia con sus extractos.
      evidence: readonly (ShownEvidence & { subquestionIds: string[]; excerpts: string[] })[];
    },
    context: CallContext,
  ): Promise<PortResult<unknown>>;
}

// Puertos que necesita el grafo de investigación.
export interface ResearchPorts {
  /** true cuando los adaptadores pueden medir llamadas y consumo. */
  measured: boolean;
  // true si los datos son de la demo.
  fixture: boolean;
  // Hora actual.
  now(): number;
  // Señal de cancelación del trabajo.
  signal: AbortSignal;
  // Dominios permitidos.
  allowedDomains: readonly string[];
  /** Tope estimado y reservado de esta ejecución, o null si no hay reserva. */
  estimatedMaxUsd: number | null;
  // Modelo.
  model: ResearchModelPort;
  // Corpus del curso.
  course: CourseEvidencePort;
  // Herramienta de sesiones.
  tool: CourseSessionToolPort;
  // Buscador.
  search: SearchPort;
  // Lector de páginas.
  reader: PageReadPort;
}

/**
 * Observación de entrada. La fase 1 solo admite texto. La fase 3 añadirá
 * observaciones derivadas de imagen y audio con referencia a su archivo, sin
 * cambiar el núcleo: el grafo solo ve texto y su procedencia.
 */
export interface TextObservation {
  // Tipo de observación.
  kind: "text";
  // Texto.
  text: string;
}

// Por ahora, solo observaciones de texto.
export type ResearchObservation = TextObservation;

// Petición de investigación.
export interface ResearchRequest {
  // Id de la ejecución.
  runId: string;
  /** Identificador del hilo ya autorizado. No es una credencial. */
  threadId: string | null;
  // Pregunta.
  question: string;
  // Observaciones de entrada.
  observations: readonly ResearchObservation[];
  // Audiencia.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Guion de la demo, si lo hay.
  scenarioId: ResearchSummary["scenarioId"];
}

// Resultado de una investigación.
export interface ResearchResult {
  // Resumen.
  summary: ResearchSummary;
  // Texto del informe.
  reportText: string;
  // Fuentes citadas.
  sources: ResearchSource[];
}

/**
 * Ejecutor de una investigación. La fase 1 lo implementa en primer plano,
 * ligado a la petición HTTP. La fase 2 puede aportar otro ejecutor durable con
 * checkpointer sin cambiar los nodos del grafo.
 */
export interface ResearchExecutor {
  // Ejecuta una investigación y avisa de cada paso.
  run(
    request: ResearchRequest,
    ports: ResearchPorts,
    onStep?: (step: ResearchStep) => void,
  ): Promise<ResearchResult>;
}
