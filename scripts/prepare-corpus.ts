import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  FIXTURE_DIMENSIONS,
  FIXTURE_EMBEDDING_MODEL,
  formatCoverage,
  prepareCorpus,
  type SourceFile,
} from "@thepower-rag/core";

const root = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.join(root, "corpus/sources");

function collect(directory: string): SourceFile[] {
  const files: SourceFile[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collect(full));
    } else if (entry.name.endsWith(".md")) {
      files.push({ path: path.relative(sourceRoot, full), text: readFileSync(full, "utf8") });
    }
  }
  return files;
}

const corpus = prepareCorpus(collect(sourceRoot), {
  family: "fixture",
  model: FIXTURE_EMBEDDING_MODEL,
  dimensions: FIXTURE_DIMENSIONS,
  providerRevision: null,
});
const publicCorpus = {
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
    chunks: document.chunks,
  })),
};
const preparedDir = path.join(root, "corpus/prepared");
mkdirSync(preparedDir, { recursive: true });
writeFileSync(path.join(preparedDir, "corpus.json"), `${JSON.stringify(publicCorpus, null, 2)}\n`);
writeFileSync(path.join(root, "corpus/COVERAGE.md"), formatCoverage(corpus));
execFileSync(path.join(root, "node_modules/.bin/vp"), ["fmt", "corpus/COVERAGE.md"], {
  cwd: root,
  stdio: "ignore",
});
console.log(
  `corpus ${corpus.preparationId} contenido ${corpus.contentVersion} perfil ${corpus.indexProfile.id}: ${String(corpus.documents.length)} documentos`,
);
console.log(
  `cobertura temario ${corpus.coverage.curriculum}, L/X ${corpus.coverage.calendarLx}, M/J ${corpus.coverage.calendarMj}, ejercicios ${corpus.coverage.exerciseDetail}`,
);
