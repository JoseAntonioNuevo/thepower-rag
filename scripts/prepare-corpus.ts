// GUÍA DE LECTURA · scripts/prepare-corpus.ts
// Prepara un corpus: por defecto el del curso (corpus/sources → corpus/prepared/corpus.json y
// corpus/COVERAGE.md); con --corpus thepower-shop, la tienda ficticia del chat (corpus/thepower-shop/sources →
// corpus/prepared/thepower-shop.json, sin informe de cobertura del temario). No llama a ningún proveedor.
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
// Corpus pedido: --corpus thepower-shop o --corpus=thepower-shop; sin la opción, el del curso.
const corpusFlagIndex = process.argv.findIndex(
  (arg) => arg === "--corpus" || arg.startsWith("--corpus="),
);
// Valor de la opción en cualquiera de sus dos formas.
const corpusName =
  corpusFlagIndex < 0
    ? "course"
    : (process.argv[corpusFlagIndex]!.split("=")[1] ?? process.argv[corpusFlagIndex + 1] ?? "");
// Solo hay dos corpus preparados; cualquier otro nombre se rechaza antes de leer archivos.
if (corpusName !== "course" && corpusName !== "thepower-shop") {
  // Detiene el script sin escribir nada.
  throw new Error("--corpus debe ser course o thepower-shop.");
}
// ¿Es la tienda ficticia del chat?
const store = corpusName === "thepower-shop";
// Carpeta de las fuentes.
const sourceRoot = path.join(root, store ? "corpus/thepower-shop/sources" : "corpus/sources");

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
// Escribe corpus.json (curso) o thepower-shop.json (tienda).
writeFileSync(
  path.join(preparedDir, store ? "thepower-shop.json" : "corpus.json"),
  `${JSON.stringify(publicCorpus, null, 2)}\n`,
);
// La tienda no tiene temario ni calendarios: solo el curso escribe el informe de cobertura.
if (!store) {
  // Escribe el informe de cobertura.
  writeFileSync(path.join(root, "corpus/COVERAGE.md"), formatCoverage(corpus));
  // Lo formatea con vp fmt.
  execFileSync(path.join(root, "node_modules/.bin/vp"), ["fmt", "corpus/COVERAGE.md"], {
    cwd: root,
    stdio: "ignore",
  });
}
// Resumen del corpus.
console.log(
  `corpus ${corpus.preparationId} contenido ${corpus.contentVersion} perfil ${corpus.indexProfile.id}: ${String(corpus.documents.length)} documentos`,
);
// Resumen de cobertura (solo tiene sentido en el curso).
if (!store)
  console.log(
    `cobertura temario ${corpus.coverage.curriculum}, L/X ${corpus.coverage.calendarLx}, M/J ${corpus.coverage.calendarMj}, ejercicios ${corpus.coverage.exerciseDetail}`,
  );
