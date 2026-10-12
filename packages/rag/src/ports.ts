// GUÍA DE LECTURA · packages/rag/src/ports.ts
// Puertos del RAG: interfaces que describen qué necesita la lógica (buscar, generar embeddings,
// generar texto, evaluar, guardar documentos). Los adaptadores de Cloudflare o de prueba las cumplen.
// Tipos del contrato compartido.
import type { Audience, EvidenceDecision } from "@thepower-rag/contracts";
// Tipos del corpus.
import type { RetrievedChunk, SourceDocument } from "./types";

// Señal mínima de cancelación (compatible con AbortSignal).
export interface CancelSignal {
  // true si la operación se canceló.
  readonly aborted: boolean;
}

// Consulta al índice vectorial.
export interface RetrievalQuery {
  // Vector de la pregunta.
  vector: readonly number[];
  // Audiencia para filtrar.
  audience: Audience;
  // Versión del corpus.
  corpusVersion: string;
  // Resultados pedidos.
  limit: number;
}

// Resultado de una búsqueda.
export interface RetrievalHit {
  // Fragmento encontrado.
  chunkId: string;
  // Puntuación de similitud, o null.
  score: number | null;
}

// Puerto de búsqueda en el índice.
export interface RetrievalPort {
  // Busca los fragmentos más parecidos a un vector.
  retrieve(query: RetrievalQuery, signal: CancelSignal): Promise<readonly RetrievalHit[]>;
}

// Puerto de embeddings.
export interface EmbeddingPort {
  // Convierte textos en vectores.
  embed(texts: readonly string[], signal: CancelSignal): Promise<readonly (readonly number[])[]>;
}

// Mensaje de la conversación para el modelo.
export interface ModelMessage {
  // Papel del mensaje.
  role: "user" | "assistant";
  // Texto.
  text: string;
}

// Petición de generación.
export interface GenerationRequest {
  // Modelo.
  modelId: string;
  // Instrucciones usadas.
  promptId: string;
  // Instrucciones de sistema.
  system: string;
  // Historial.
  messages: readonly ModelMessage[];
  // Señal de cancelación.
  signal: CancelSignal;
}

// Consumo medido; null significa desconocido.
export interface MeasuredUsage {
  // Tokens de entrada.
  inputTokens: number | null;
  // Tokens de salida.
  outputTokens: number | null;
  // Tokens totales.
  totalTokens: number | null;
}

// Coste estimado.
export interface MeasuredCost {
  // Importe.
  amount: number;
  // Moneda.
  currency: string;
  // Origen de la tarifa.
  source: string;
  // Método de cálculo.
  method: string;
}

// Resultado de una generación.
export interface GenerationResult {
  // Texto generado.
  text: string;
  // Consumo, si se conoce.
  usage: MeasuredUsage | null;
  // Coste, si se conoce.
  cost: MeasuredCost | null;
}

// Puerto del modelo generador.
export interface GenerationPort {
  // Genera una respuesta.
  generate(request: GenerationRequest): Promise<GenerationResult>;
}

// Puerto del evaluador de evidencia.
export interface EvaluationPort {
  // Evalúa si los fragmentos responden a la pregunta.
  evaluate(
    input: {
      // Pregunta del alumno.
      question: string;
      // Fragmentos recuperados.
      chunks: readonly RetrievedChunk[];
    },
    signal: CancelSignal,
  ): Promise<EvidenceDecision>;
}

// Documento guardado.
export interface StoredDocument {
  // Identificador.
  id: string;
  // Versión.
  versionId: string;
  // Tipo MIME.
  mediaType: string;
  // Contenido en bytes.
  body: Uint8Array;
}

// Puerto del almacén de documentos.
export interface DocumentStorePort {
  // Guarda un documento.
  put(document: StoredDocument): Promise<void>;
  // Lee un documento, o null si no existe.
  get(id: string, versionId: string): Promise<StoredDocument | null>;
}

// Fragmento guardado en la base de datos.
export interface ChunkRecord {
  // Identificador del fragmento.
  chunkId: string;
  // Documento al que pertenece.
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
}

// Puerto del catálogo de fragmentos.
export interface ChunkCatalogPort {
  // Lee un fragmento por versión e id.
  getChunk(corpusVersion: string, chunkId: string): Promise<ChunkRecord | null>;
}

// Puerto del catálogo del corpus.
export interface CorpusCatalogPort {
  // Lista las versiones.
  listVersions(): Promise<readonly { id: string; label: string }[]>;
  // Lista los documentos de una versión.
  listDocuments(versionId: string): Promise<readonly SourceDocument[]>;
}
