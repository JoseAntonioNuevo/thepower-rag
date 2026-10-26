// GUÍA DE LECTURA · apps/api/src/chat-corpus.ts
// Corpus del chat (Sin RAG, RAG básico y CRAG): el material del curso o la tienda ficticia Zocomar.
// Lo elige CHAT_CORPUS. La investigación de S12 no pasa por aquí: siempre lee el curso con
// CORPUS_VERSION, INDEX_PROFILE y el binding VECTORIZE, aunque el chat use la tienda.
// Identificador del corpus del chat, compartido con la interfaz.
import type { ChatCorpusId } from "@thepower-rag/contracts";

// Variables propias de la tienda: versión, perfil y umbral calibrado con BGE-M3 sobre su índice.
export const STORE_SETTING_VARIABLES = [
  "STORE_CORPUS_VERSION",
  "STORE_INDEX_PROFILE",
  "STORE_MIN_RETRIEVAL_SCORE",
] as const;

// Ajustes de embeddings que comparten los dos corpus: mismo modelo, dimensión y métrica.
export const SHARED_RETRIEVAL_VARIABLES = [
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "VECTOR_METRIC",
] as const;

// Bindings del chat con la tienda: su propio índice de Vectorize y los demás compartidos.
export const STORE_BINDING_NAMES = ["AI", "VECTORIZE_STORE", "DB", "CORPUS"] as const;

// Lee CHAT_CORPUS. Sin valor es el curso; un valor desconocido devuelve null y bloquea el chat.
export function chatCorpusId(value: string | undefined): ChatCorpusId | null {
  // Valor limpio.
  const trimmed = value?.trim() ?? "";
  // Sin valor: el comportamiento de siempre.
  if (trimmed === "") return "course";
  // Solo dos corpus conocidos; no se adivina otro.
  return trimmed === "course" || trimmed === "zocomar" ? trimmed : null;
}

// ¿Usa grupos y calendario? Solo el curso: la tienda no tiene L/X ni M/J y no debe pedirlos.
export function usesCourseGroups(corpus: ChatCorpusId): boolean {
  // El curso sí; la tienda no.
  return corpus === "course";
}

// Nombre del binding de Vectorize que consulta el chat con cada corpus.
export function chatVectorBinding(corpus: ChatCorpusId): "VECTORIZE" | "VECTORIZE_STORE" {
  // El curso usa el índice de siempre; la tienda, el suyo.
  return corpus === "course" ? "VECTORIZE" : "VECTORIZE_STORE";
}

// Nombre visible de cada corpus en la interfaz y en /api/health.
export const CHAT_CORPUS_LABELS: Record<ChatCorpusId, string> = {
  course: "Material del curso AI Engineer",
  zocomar: "Zocomar, tienda en línea ficticia",
};
