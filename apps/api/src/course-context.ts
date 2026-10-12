// GUÍA DE LECTURA · apps/api/src/course-context.ts
// RAG con contexto completo (variante publicada): lee de D1 todos los fragmentos del programa y del
// grupo y comprueba que coinciden exactamente con el manifiesto desplegado antes de usarlos.
// Manifiesto del corpus preparado, incluido en el bundle.
import prepared from "../../../corpus/prepared/corpus.json";
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Tipos del fragmento y del resultado.
import type { IndexedChunk, RetrievalOutcome } from "@thepower-rag/core";
// Regla de visibilidad por audiencia.
import { allowsAudience } from "@thepower-rag/core";
// Tipo de D1.
import type { SqlDatabase } from "./stores";
// Error propio del contexto completo.
export class CourseContextError extends Error {}
// Fragmentos máximos.
const MAX_CHUNKS = 200;
// Caracteres máximos del contexto.
const MAX_CHARS = 32000;
// Lee y valida el contexto completo de una versión y un grupo.
export async function readCourseContext(
  database: SqlDatabase,
  corpusVersion: string,
  audience: Audience,
  signal: AbortSignal,
): Promise<IndexedChunk[]> {
  // Cancelado antes de empezar.
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  // Consulta los fragmentos del programa y del grupo, en orden.
  const statement = database
    .prepare(`SELECT chunks.chunk_id AS chunkId, chunks.document_id AS documentId,
 documents.title AS title, chunks.section AS section, chunks.text AS text,
 documents.audience AS audience, chunks.version_id AS corpusVersion
 FROM chunks JOIN documents ON documents.version_id=chunks.version_id AND documents.document_id=chunks.document_id
 WHERE chunks.version_id=? AND documents.audience IN ('program',?)
 ORDER BY documents.document_id,chunks.ordinal LIMIT 201`)
    .bind(corpusVersion, audience) as unknown as { all<T>(): Promise<{ results: T[] }> };
  // Ejecuta la consulta.
  const result = await statement.all<Omit<IndexedChunk, "vector">>();
  // Cancelado durante la consulta.
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  // Filas leídas.
  const rows = result.results;
  // Debe haber filas, como mucho el máximo, todas válidas y sin pasar de los caracteres.
  if (
    !Array.isArray(rows) ||
    !rows.length ||
    rows.length > MAX_CHUNKS ||
    rows.some(
      (row) =>
        row.corpusVersion !== corpusVersion ||
        !allowsAudience(row.audience, audience) ||
        typeof row.text !== "string" ||
        !row.text.trim() ||
        !row.chunkId.startsWith(corpusVersion + ":"),
    ) ||
    rows.reduce((n, row) => n + row.text.length, 0) > MAX_CHARS
  )
    throw new CourseContextError(
      "El contexto completo no está validado o excede el límite. No se trunca silenciosamente.",
    );
  // La versión debe ser la del manifiesto desplegado.
  if (corpusVersion !== prepared.preparationId)
    throw new CourseContextError("El corpus no coincide con el manifiesto desplegado.");
  // Fragmentos esperados según el manifiesto.
  const expected = new Map(
    prepared.documents
      .filter((doc) => allowsAudience(doc.audience as Audience, audience))
      .flatMap((doc) => doc.chunks.map((chunk) => [chunk.chunkId, { doc, chunk }] as const)),
  );
  // D1 debe tener exactamente esos fragmentos con el mismo texto.
  if (
    rows.length !== expected.size ||
    new Set(rows.map((row) => row.chunkId)).size !== expected.size ||
    rows.some((row) => {
      // Fragmento original del manifiesto.
      const original = expected.get(row.chunkId);
      // Debe coincidir en documento, título, sección, audiencia y texto.
      return (
        !original ||
        row.documentId !== original.doc.id ||
        row.title !== original.doc.title ||
        row.section !== original.chunk.section ||
        row.audience !== original.doc.audience ||
        row.text !== original.chunk.text
      );
    })
  )
    throw new CourseContextError(
      "El catálogo no tiene todo el contexto autorizado del manifiesto.",
    );
  // Fragmentos sin vector (no hace falta en esta variante).
  return rows.map((row) => ({ ...row, vector: [] }));
}
// Resultado con todo el contexto como evidencia y su traza.
export function completeContextOutcome(
  question: string,
  corpusVersion: string,
  chunks: IndexedChunk[],
): RetrievalOutcome {
  // Documentos distintos.
  const docs = new Set(chunks.map((c) => c.documentId));
  // Responder con todos los fragmentos.
  return {
    decision: "answer",
    evidence: chunks,
    trace: {
      query: question,
      queryRewrite: "context-complete",
      corpusVersion,
      embedding: "No ejecutado: contexto completo del programa y del grupo seleccionado",
      scoreMeaning:
        "Recuperación del catálogo por versión y grupo. El corpus es pequeño y cabe completo; no se filtra por coseno.",
      retrieved: [],
      decision: "answer",
      generation: "called",
      status: `Contexto completo: ${chunks.length} fragmentos de ${docs.size} documentos. Las fuentes se muestran cuando la respuesta las cita.`,
    },
  };
}
