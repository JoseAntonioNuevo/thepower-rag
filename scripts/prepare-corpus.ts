// GUÍA DE LECTURA · scripts/prepare-corpus.ts
// Prepara el corpus del curso: lee los Markdown de corpus/sources, los trocea, calcula hashes y escribe
// corpus/prepared/corpus.json y corpus/COVERAGE.md. No llama a ningún proveedor.
// Ejecuta comandos (vp fmt).
import { execFileSync } from "node:child_process";
// Lectura y escritura de archivos.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Preparación del corpus del núcleo.
import {
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  formatCoverage,
  prepareCorpus,
  type SourceFile,
} from "@thepower-rag/core";

// Raíz del repositorio.
const root = path.resolve(import.meta.dirname, "..");
// Carpeta de las fuentes.
const sourceRoot = path.join(root, "corpus/sources");

// Recorre una carpeta y devuelve los Markdown con su ruta relativa y su texto.
function collect(directory: string): SourceFile[] {
  // Archivos encontrados.
  const files: SourceFile[] = [];
  // Cada entrada de la carpeta.
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    // Ruta completa.
    const full = path.join(directory, entry.name);
    // Subcarpeta.
    if (entry.isDirectory()) {
      // Recorre recursivamente.
      files.push(...collect(full));
    } else if (entry.name.endsWith(".md")) {
      // Guarda el Markdown.
      files.push({ path: path.relative(sourceRoot, full), text: readFileSync(full, "utf8") });
    }
  }
  // Archivos.
  return files;
}

// Corpus troceado con el perfil de prueba.
const corpus = prepareCorpus(collect(sourceRoot), {
  family: "fixture",
  model: FIXTURE_EMBEDDING_MODEL,
  dimensions: FIXTURE_DIMENSIONS,
  providerRevision: null,
});
// Versión pública: sin los textos completos, solo metadatos y fragmentos.
const publicCorpus = {
  // Mismos metadatos del documento…
  ...corpus,
  documents: corpus.documents.map((document) => ({
    id: document.id,
    title: document.title,
    audience: document.audience,
    session: document.session,
    verified: document.verified,
    source: document.source,
    sourcePath: document.sourcePath,
    sourceHash: document.sourceHash,
    curriculum: document.curriculum,
    exerciseDetail: document.exerciseDetail,
    // …y sus fragmentos; el campo body (texto completo) se omite.
    chunks: document.chunks,
  })),
};
// Carpeta de salida.
const preparedDir = path.join(root, "corpus/prepared");
// La crea si no existe.
mkdirSync(preparedDir, { recursive: true });
// Escribe corpus.json.
writeFileSync(path.join(preparedDir, "corpus.json"), `${JSON.stringify(publicCorpus, null, 2)}\n`);
// Escribe el informe de cobertura.
writeFileSync(path.join(root, "corpus/COVERAGE.md"), formatCoverage(corpus));
// Lo formatea con vp fmt.
execFileSync(path.join(root, "node_modules/.bin/vp"), ["fmt", "corpus/COVERAGE.md"], {
  cwd: root,
  stdio: "ignore",
});
// Resumen del corpus.
console.log(
  `corpus ${corpus.preparationId} contenido ${corpus.contentVersion} perfil ${corpus.indexProfile.id}: ${String(corpus.documents.length)} documentos`,
);
// Resumen de cobertura.
console.log(
  `cobertura temario ${corpus.coverage.curriculum}, L/X ${corpus.coverage.calendarLx}, M/J ${corpus.coverage.calendarMj}, ejercicios ${corpus.coverage.exerciseDetail}`,
);
