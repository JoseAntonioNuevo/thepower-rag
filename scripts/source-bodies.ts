// GUÍA DE LECTURA · scripts/source-bodies.ts
// Añade el texto de cada documento al corpus preparado, comprobando que su hash coincide con el congelado.
// Lectura de archivos.
import { readFile } from "node:fs/promises";
// Rutas.
import path from "node:path";
// Hash FNV-1a y tipo del corpus preparado.
import { fnv1a64, type PreparedCorpus } from "@thepower-rag/core";

// Devuelve el corpus con los textos de las fuentes.
export async function attachSourceBodies(
  corpus: PreparedCorpus,
  sourcesRoot: string,
): Promise<PreparedCorpus> {
  // Lee todos los documentos en paralelo.
  const documents = await Promise.all(
    corpus.documents.map(async (document) => {
      // Ya trae texto con el hash correcto: se conserva.
      if (typeof document.body === "string" && fnv1a64(document.body) === document.sourceHash) {
        // Sin cambios.
        return document;
      }
      // Lee el archivo fuente.
      const text = await readFile(path.join(sourcesRoot, document.sourcePath), "utf8");
      // Hash distinto: el archivo cambió.
      if (fnv1a64(text) !== document.sourceHash) {
        // Error: no se ingesta.
        throw new Error(
          `El archivo ${document.sourcePath} no coincide con el hash congelado. No se ingesta.`,
        );
      }
      // Documento con su texto.
      return { ...document, body: text };
    }),
  );
  // Corpus con los textos.
  return { ...corpus, documents };
}
