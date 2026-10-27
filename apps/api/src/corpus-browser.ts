// GUÍA DE LECTURA · apps/api/src/corpus-browser.ts
// Biblioteca de documentos: lectura de los documentos y fragmentos del corpus del chat (la tienda
// ThePower Shop en producción). Solo se ofrece ese corpus. En real lee D1 en cada petición (sin caché)
// con consultas preparadas de solo lectura; en la demo usa el corpus preparado de ThePower Shop empaquetado.
// No llama a modelos ni a Vectorize y no escribe nada.
// Tipos del contrato.
import type {
  Audience,
  CorpusChunk,
  CorpusDocument,
  CorpusKey,
  CorpusChunksResponse,
  CorpusDocumentsResponse,
} from "@thepower-rag/contracts";
// Valor configurado frente a marcador.
import { isConfiguredValue } from "@thepower-rag/contracts";
// Tipo del corpus preparado.
import type { PreparedCorpus } from "@thepower-rag/core";
// Corpus preparado de la tienda, para la demo sin D1.
import rawStoreCorpus from "../../../corpus/prepared/thepower-shop.json";
// Nombres de los corpus del chat.
import { CHAT_CORPUS_LABELS, chatCorpusId } from "./chat-corpus";

// Corpus preparado de ThePower Shop tipado.
const storeCorpus = rawStoreCorpus as PreparedCorpus;
// Entorno del Worker.
import type { WorkerEnv } from "./env";

// Un corpus consultable con su versión.
export interface CorpusOption {
  key: CorpusKey;
  label: string;
  version: string;
}

// Sentencia de D1 que devuelve varias filas o una.
interface ReadStatement {
  bind(...values: unknown[]): {
    all<T>(): Promise<{ results: T[] }>;
    first<T>(): Promise<T | null>;
  };
}

// Base de datos D1 de solo lectura para la biblioteca.
export interface ReadDatabase {
  prepare(query: string): ReadStatement;
}

// Id de documento válido: letras, números y guiones, como los de las fichas del corpus.
export const DOCUMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

// Documentos de una versión con su número de fragmentos y caracteres.
const DOCUMENTS_SQL = `SELECT d.document_id AS documentId, d.title AS title, d.audience AS audience,
  COUNT(c.chunk_id) AS chunks, COALESCE(SUM(LENGTH(c.text)), 0) AS chars
  FROM documents d
  LEFT JOIN chunks c ON c.version_id = d.version_id AND c.document_id = d.document_id
  WHERE d.version_id = ?
  GROUP BY d.document_id, d.title, d.audience
  ORDER BY d.document_id`;

// Un documento de una versión.
const DOCUMENT_SQL = `SELECT d.document_id AS documentId, d.title AS title, d.audience AS audience,
  COUNT(c.chunk_id) AS chunks, COALESCE(SUM(LENGTH(c.text)), 0) AS chars
  FROM documents d
  LEFT JOIN chunks c ON c.version_id = d.version_id AND c.document_id = d.document_id
  WHERE d.version_id = ? AND d.document_id = ?
  GROUP BY d.document_id, d.title, d.audience`;

// Fragmentos de un documento en su orden.
const CHUNKS_SQL = `SELECT chunk_id AS chunkId, ordinal, section, text
  FROM chunks
  WHERE version_id = ? AND document_id = ?
  ORDER BY ordinal`;

// Corpus consultable: solo el del chat. En la demo, la tienda preparada y empaquetada.
export function corpusOptions(env: WorkerEnv, demo: boolean): CorpusOption[] {
  // Demo: el corpus preparado de ThePower Shop.
  if (demo) {
    return [
      {
        key: "thepower-shop",
        label: CHAT_CORPUS_LABELS["thepower-shop"],
        version: storeCorpus.preparationId,
      },
    ];
  }
  // Corpus del chat (sin valor o desconocido: el curso).
  const chat = chatCorpusId(env.CHAT_CORPUS) ?? "course";
  // Su versión.
  const version = chat === "thepower-shop" ? env.STORE_CORPUS_VERSION : env.CORPUS_VERSION;
  // Solo si está configurada.
  return version !== undefined && isConfiguredValue(version)
    ? [{ key: chat, label: CHAT_CORPUS_LABELS[chat], version: version.trim() }]
    : [];
}

// Documentos del corpus preparado de la demo, con sus fragmentos.
function preparedDocuments() {
  // Documentos con grupo válido.
  return storeCorpus.documents.flatMap((document) => {
    const group = audience(document.audience);
    return group === null ? [] : [{ ...document, audience: group }];
  });
}

// Grupo válido o null.
function audience(value: unknown): Audience | null {
  // Solo los tres grupos del contrato.
  return value === "program" || value === "L/X" || value === "M/J" ? value : null;
}

// Fila de documento a contrato, o null si no es válida.
function toDocument(row: Record<string, unknown>): CorpusDocument | null {
  // Grupo.
  const group = audience(row.audience);
  // Campos obligatorios.
  if (typeof row.documentId !== "string" || group === null) {
    return null;
  }
  // Documento.
  return {
    documentId: row.documentId,
    title: typeof row.title === "string" ? row.title.slice(0, 240) : "",
    audience: group,
    chunks: Number(row.chunks) || 0,
    chars: Number(row.chars) || 0,
  };
}

// Número de fragmento a partir del final del id («…:02» → 2), para la demo.
export function ordinalOf(chunkId: string): number {
  // Último tramo numérico.
  const value = Number(chunkId.split(":").at(-1));
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

// Documentos de un corpus.
export async function listDocuments(input: {
  option: CorpusOption;
  options: readonly CorpusOption[];
  database: ReadDatabase | null;
}): Promise<CorpusDocumentsResponse> {
  // Momento de la lectura.
  const readAt = new Date().toISOString();
  // Demo: documentos del corpus preparado de la tienda.
  if (input.database === null) {
    return {
      corpora: [...input.options],
      corpus: input.option,
      source: "fixture",
      readAt,
      documents: preparedDocuments()
        .map((document) => ({
          documentId: document.id,
          title: document.title,
          audience: document.audience,
          chunks: document.chunks.length,
          chars: document.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
        }))
        .sort((a, b) => a.documentId.localeCompare(b.documentId)),
    };
  }
  // D1: una consulta de solo lectura.
  const { results } = await input.database
    .prepare(DOCUMENTS_SQL)
    .bind(input.option.version)
    .all<Record<string, unknown>>();
  // Respuesta.
  return {
    corpora: [...input.options],
    corpus: input.option,
    source: "d1",
    readAt,
    documents: results.flatMap((row) => {
      const document = toDocument(row);
      return document === null ? [] : [document];
    }),
  };
}

// Fragmentos de un documento, o null si el documento no existe en ese corpus.
export async function listChunks(input: {
  option: CorpusOption;
  documentId: string;
  database: ReadDatabase | null;
}): Promise<CorpusChunksResponse | null> {
  // Momento de la lectura.
  const readAt = new Date().toISOString();
  // Demo: fragmentos del documento en el corpus preparado de la tienda.
  if (input.database === null) {
    // Documento pedido.
    const document = preparedDocuments().find((item) => item.id === input.documentId);
    if (document === undefined) {
      return null;
    }
    // Fragmentos en orden.
    const chunks = [...document.chunks].sort((a, b) => ordinalOf(a.chunkId) - ordinalOf(b.chunkId));
    return {
      corpus: input.option,
      source: "fixture",
      readAt,
      document: {
        documentId: document.id,
        title: document.title,
        audience: document.audience,
        chunks: chunks.length,
        chars: chunks.reduce((sum, chunk) => sum + chunk.text.length, 0),
      },
      chunks: chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        ordinal: ordinalOf(chunk.chunkId),
        section: chunk.section,
        text: chunk.text,
        chars: chunk.text.length,
      })),
    };
  }
  // D1: el documento y sus fragmentos.
  const row = await input.database
    .prepare(DOCUMENT_SQL)
    .bind(input.option.version, input.documentId)
    .first<Record<string, unknown>>();
  // Documento inexistente o no válido.
  const document = row === null ? null : toDocument(row);
  if (document === null) {
    return null;
  }
  // Fragmentos en orden.
  const { results } = await input.database
    .prepare(CHUNKS_SQL)
    .bind(input.option.version, input.documentId)
    .all<Record<string, unknown>>();
  // Solo filas completas.
  const chunks: CorpusChunk[] = results.flatMap((item) =>
    typeof item.chunkId === "string" && typeof item.text === "string"
      ? [
          {
            chunkId: item.chunkId,
            ordinal: Number(item.ordinal) || 0,
            section: typeof item.section === "string" ? item.section.slice(0, 240) : "",
            text: item.text.slice(0, 4000),
            chars: item.text.length,
          },
        ]
      : [],
  );
  // Respuesta.
  return { corpus: input.option, source: "d1", readAt, document, chunks };
}
