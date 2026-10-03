import prepared from "../../../corpus/prepared/corpus.json";
import type { Audience } from "@thepower-rag/contracts";
import type { IndexedChunk, RetrievalOutcome } from "@thepower-rag/core";
import { allowsAudience } from "@thepower-rag/core";
import type { SqlDatabase } from "./stores";
export class CourseContextError extends Error {}
const MAX_CHUNKS = 200;
const MAX_CHARS = 32000;
export async function readCourseContext(
  database: SqlDatabase,
  corpusVersion: string,
  audience: Audience,
  signal: AbortSignal,
): Promise<IndexedChunk[]> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const statement = database
    .prepare(`SELECT chunks.chunk_id AS chunkId, chunks.document_id AS documentId,
 documents.title AS title, chunks.section AS section, chunks.text AS text,
 documents.audience AS audience, chunks.version_id AS corpusVersion
 FROM chunks JOIN documents ON documents.version_id=chunks.version_id AND documents.document_id=chunks.document_id
 WHERE chunks.version_id=? AND documents.audience IN ('program',?)
 ORDER BY documents.document_id,chunks.ordinal LIMIT 201`)
    .bind(corpusVersion, audience) as unknown as { all<T>(): Promise<{ results: T[] }> };
  const result = await statement.all<Omit<IndexedChunk, "vector">>();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  const rows = result.results;
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
  if (corpusVersion !== prepared.preparationId)
    throw new CourseContextError("El corpus no coincide con el manifiesto desplegado.");
  const expected = new Map(
    prepared.documents
      .filter((doc) => allowsAudience(doc.audience as Audience, audience))
      .flatMap((doc) => doc.chunks.map((chunk) => [chunk.chunkId, { doc, chunk }] as const)),
  );
  if (
    rows.length !== expected.size ||
    new Set(rows.map((row) => row.chunkId)).size !== expected.size ||
    rows.some((row) => {
      const original = expected.get(row.chunkId);
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
  return rows.map((row) => ({ ...row, vector: [] }));
}
export function completeContextOutcome(
  question: string,
  corpusVersion: string,
  chunks: IndexedChunk[],
): RetrievalOutcome {
  const docs = new Set(chunks.map((c) => c.documentId));
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
