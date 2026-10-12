// GUÍA DE LECTURA · packages/rag/src/types.ts
// Tipos básicos del RAG: versión del corpus, documentos fuente, fragmentos y estado de CRAG.
// Solo tipos: no generan código JavaScript.
// Tipos del contrato compartido.
import type { Audience, CohortId, EvidenceDecision } from "@thepower-rag/contracts";

// Versión del corpus preparado.
export interface CorpusVersion {
  // Identificador de la versión.
  id: string;
  // Nombre legible.
  label: string;
  // Modelo de embeddings usado.
  embeddingModel: string;
  // Dimensiones de sus vectores.
  dimensions: number;
  // Revisión remota: null porque no se verifica aquí.
  remoteRevision: null;
}

// A quién va dirigido un documento: el programa entero o una cohorte concreta.
export type DocumentAudience = { kind: "program" } | { kind: "cohort"; cohort: CohortId };

// Documento fuente del corpus.
export interface SourceDocument {
  // Identificador (por ejemplo, s05-langgraph).
  id: string;
  // Versión de preparación.
  versionId: string;
  // Título del documento.
  title: string;
  // Audiencia del documento.
  audience: DocumentAudience;
  // Hash del archivo fuente, para detectar cambios.
  sourceHash: string;
}

// Fragmento de texto de un documento.
export interface TextChunk {
  // Documento al que pertenece.
  documentId: string;
  // Identificador del fragmento.
  chunkId: string;
  // Título del documento.
  title: string;
  // Sección del fragmento.
  section: string;
  // Texto del fragmento.
  text: string;
  // Versión del corpus.
  corpusVersion: string;
}

// Fragmento recuperado por una búsqueda: añade la puntuación y la audiencia.
export interface RetrievedChunk extends TextChunk {
  // Puntuación de similitud, o null si no se calculó.
  score: number | null;
  // Audiencia del fragmento.
  audience: Audience;
}

// Estado de un turno de CRAG.
export interface CragState {
  // Pregunta original del alumno.
  originalQuestion: string;
  // Consulta actual (puede ser una reformulación).
  currentQuery: string;
  // Búsquedas hechas.
  retrievalCount: number;
  // Reformulaciones hechas.
  reformulationCount: number;
  // Fragmentos conservados como evidencia.
  retainedChunks: RetrievedChunk[];
  // Fragmentos descartados.
  discardedChunks: RetrievedChunk[];
  // Veredicto actual sobre la evidencia.
  evidence: EvidenceDecision;
}
