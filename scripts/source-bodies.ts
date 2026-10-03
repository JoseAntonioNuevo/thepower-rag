import { readFile } from "node:fs/promises";
import path from "node:path";
import { fnv1a64, type PreparedCorpus } from "@thepower-rag/core";

export async function attachSourceBodies(
  corpus: PreparedCorpus,
  sourcesRoot: string,
): Promise<PreparedCorpus> {
  const documents = await Promise.all(
    corpus.documents.map(async (document) => {
      if (typeof document.body === "string" && fnv1a64(document.body) === document.sourceHash) {
        return document;
      }
      const text = await readFile(path.join(sourcesRoot, document.sourcePath), "utf8");
      if (fnv1a64(text) !== document.sourceHash) {
        throw new Error(
          `El archivo ${document.sourcePath} no coincide con el hash congelado. No se ingesta.`,
        );
      }
      return { ...document, body: text };
    }),
  );
  return { ...corpus, documents };
}
