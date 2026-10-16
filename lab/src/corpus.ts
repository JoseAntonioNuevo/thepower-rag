// GUÍA DE LECTURA · lab/src/corpus.ts
// Lectura, limpieza y fragmentación con solapamiento de los documentos ficticios del laboratorio.
// Reutiliza las primitivas de troceado e identificadores estables de @thepower-rag/core.
// Lectura de archivos y directorios en Node/Bun.
import { readdirSync, readFileSync } from "node:fs";
// Rutas de archivos.
import path from "node:path";
// Funciones de fragmentación y huella FNV-1a del núcleo RAG.
import { chunkId, chunkMarkdown, fnv1a64 } from "@thepower-rag/core";
// Parámetros de troceado del laboratorio.
import { LAB_CHUNKING } from "./config";

// Documento ficticio limpio listo para trocear.
export interface LabDocument {
  // Identificador estable derivado del nombre del archivo (sin extensión).
  documentId: string;
  // Título extraído del primer encabezado H1.
  title: string;
  // Ruta relativa del archivo fuente.
  sourcePath: string;
  // Texto limpio y normalizado.
  cleanText: string;
  // Huella FNV-1a del contenido limpio.
  contentHash: string;
}

// Fragmento preparado del laboratorio antes de calcular su vector de 768 dimensiones.
export interface LabPreparedChunk {
  // Identificador estable: <version>:<documentId>:<ordinal>.
  chunkId: string;
  // Versión del corpus a la que pertenece.
  corpusVersion: string;
  // Identificador del documento origen.
  documentId: string;
  // Posición del fragmento dentro del documento (0, 1, 2...).
  ordinal: number;
  // Título del documento.
  title: string;
  // Sección Markdown de la que procede el fragmento.
  section: string;
  // Texto del fragmento.
  content: string;
}

// Corpus completo preparado a partir de los documentos en bruto.
export interface LabPreparedCorpus {
  // Identificador determinista de la versión del corpus.
  corpusVersion: string;
  // Parámetros de troceado aplicados.
  chunking: { maxChars: number; overlapChars: number };
  // Lista de documentos limpios.
  documents: LabDocument[];
  // Lista de fragmentos generados.
  chunks: LabPreparedChunk[];
}

// Limpia caracteres de control, normaliza saltos de línea y recorta espacios redundantes.
export function cleanDocumentText(raw: string): string {
  // Unifica CRLF a LF, elimina caracteres de control no imprimibles por código ASCII y colapsa líneas vacías.
  const withoutControls = Array.from(raw.replace(/\r\n?/g, "\n"))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || (code >= 32 && code !== 127);
    })
    .join("");
  return withoutControls
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Extrae el título principal (primer `# ...`) y el cuerpo Markdown para `chunkMarkdown`.
function extractTitleAndBody(
  cleanText: string,
  fallbackId: string,
): { title: string; body: string } {
  // Líneas del documento limpio.
  const lines = cleanText.split("\n");
  // Primera línea si empieza por `# `.
  const first = lines[0]?.trim() ?? "";
  // Si hay H1 inicial, se usa como título y el resto como cuerpo.
  if (first.startsWith("# ")) {
    // Título sin el prefijo `# `.
    const title = first.slice(2).trim() || fallbackId;
    // Cuerpo restante.
    const body = lines.slice(1).join("\n").trim();
    // par título y cuerpo.
    return { title, body: body.length > 0 ? body : title };
  }
  // Si no hay H1, usa el identificador como título.
  return { title: fallbackId, body: cleanText };
}

// Lee todos los documentos `.md` y `.txt` de un directorio y construye el corpus preparado.
export function prepareLabCorpusFromDirectory(
  sourcesDir: string,
  options: { maxChars?: number; overlapChars?: number } = {},
): LabPreparedCorpus {
  // Tamaño máximo de fragmento.
  const maxChars = options.maxChars ?? LAB_CHUNKING.maxChars;
  // Solapamiento entre fragmentos.
  const overlapChars = options.overlapChars ?? LAB_CHUNKING.overlapChars;
  // Nombres de archivos Markdown o TXT ordenados alfabéticamente.
  const entries = readdirSync(sourcesDir)
    .filter((name) => name.endsWith(".md") || name.endsWith(".txt"))
    .sort();
  // Exige al menos los ocho documentos ficticios que piden los enunciados de S10 y S11.
  if (entries.length < 8) {
    // Error explícito si faltan documentos.
    throw new Error(
      `El laboratorio exige al menos 8 documentos ficticios; se encontraron ${String(entries.length)}.`,
    );
  }
  // Documentos limpios.
  const documents: LabDocument[] = [];
  // Recorre cada archivo fuente.
  for (const name of entries) {
    // Ruta absoluta.
    const fullPath = path.join(sourcesDir, name);
    // Contenido bruto.
    const raw = readFileSync(fullPath, "utf8");
    // Contenido limpio.
    const cleanText = cleanDocumentText(raw);
    // Identificador estable sin extensión.
    const documentId = name.replace(/\.(md|txt)$/i, "");
    // Título del documento.
    const { title } = extractTitleAndBody(cleanText, documentId);
    // Guarda el documento limpio con su huella.
    documents.push({
      documentId,
      title,
      sourcePath: `lab/corpus/sources/${name}`,
      cleanText,
      contentHash: fnv1a64(cleanText),
    });
  }
  // Huella global de versión a partir de los hashes de documentos y los parámetros de troceado.
  const versionInput = JSON.stringify({
    maxChars,
    overlapChars,
    docs: documents.map((doc) => ({ id: doc.documentId, hash: doc.contentHash })),
  });
  // Versión con prefijo `lab-` y 12 caracteres hexadecimales.
  const corpusVersion = `lab-${fnv1a64(versionInput).slice(0, 12)}`;
  // Lista de fragmentos preparados.
  const chunks: LabPreparedChunk[] = [];
  // Trocea cada documento con `chunkMarkdown`.
  for (const doc of documents) {
    // Separa título y cuerpo.
    const { title, body } = extractTitleAndBody(doc.cleanText, doc.documentId);
    // Trocea por encabezados `##` y párrafos con solapamiento.
    const pieces = chunkMarkdown(body, { maxChars, overlap: overlapChars });
    // Convierte cada trozo en un `LabPreparedChunk` con id estable.
    for (const piece of pieces) {
      // Añade el fragmento.
      chunks.push({
        chunkId: chunkId(corpusVersion, doc.documentId, piece.ordinal),
        corpusVersion,
        documentId: doc.documentId,
        ordinal: piece.ordinal,
        title,
        section: piece.section,
        content: piece.text,
      });
    }
  }
  // Devuelve el corpus preparado.
  return {
    corpusVersion,
    chunking: { maxChars, overlapChars },
    documents,
    chunks,
  };
}
