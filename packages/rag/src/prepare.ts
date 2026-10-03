import type { Audience } from "@thepower-rag/contracts";
import { chunkId, chunkMarkdown } from "./chunk";
import { fnv1a64 } from "./hash";
import {
  PREP_CHUNKING,
  contentVersionId,
  indexProfileId,
  preparationId,
  utf8Bytes,
  vectorIdFor,
  METADATA_VALUE_MAX_BYTES,
  type ProfileIdentity,
} from "./ids";

export interface SourceFile {
  path: string;
  text: string;
}

export interface PreparedDocument {
  id: string;
  title: string;
  audience: Audience;
  session: string | null;
  verified: string;
  source: string;
  sourcePath: string;
  sourceHash: string;
  curriculum: "present" | "absent";
  exerciseDetail: "summary" | "title-only" | "absent";
  body: string;
  chunks: {
    chunkId: string;
    vectorId: string;
    section: string;
    text: string;
    ordinal: number;
  }[];
}

export interface CoverageReport {
  curriculum: "complete" | "partial";
  calendarLx: "complete" | "partial";
  calendarMj: "complete" | "partial";
  exerciseDetail: "complete" | "partial";
  remote: "not-verified";
  sessions: {
    session: string;
    curriculum: "present" | "absent";
    exerciseDetail: "summary" | "title-only" | "absent";
    dateLx: string | null;
    dateMj: string | null;
    instructorLx: string | null;
    instructorMj: string | null;
  }[];
}

export interface PreparedCorpus {
  contentVersion: string;
  preparationId: string;
  version: string;
  verifiedDate: string;
  embeddingModel: string;
  dimensions: number;
  remoteRevision: null;
  coverage: CoverageReport;
  indexProfile: ProfileIdentity & { id: string };
  documents: PreparedDocument[];
}

const FIELD = /^(id|title|audience|session|verified|source|curriculum|exerciseDetail):\s*(.+)$/;
const SESSIONS = Array.from({ length: 20 }, (_, index) => `S${String(index + 1)}`);

function frontmatter(text: string): Record<string, string> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  const fields: Record<string, string> = {};
  if (match?.[1] === undefined) {
    return fields;
  }
  for (const line of match[1].split("\n")) {
    const parsed = FIELD.exec(line.trim());
    if (parsed?.[1] !== undefined && parsed[2] !== undefined) {
      fields[parsed[1]] = parsed[2];
    }
  }
  return fields;
}

function calendarFacts(text: string): Map<string, { date: string; instructor: string | null }> {
  const found = new Map<string, { date: string; instructor: string | null }>();
  let current = "";
  let date = "";
  let instructor: string | null = null;
  const flush = () => {
    if (current !== "" && date !== "") {
      found.set(current, { date, instructor });
    }
    date = "";
    instructor = null;
  };
  for (const line of text.split("\n")) {
    const heading = /^## (S\d+)\b/.exec(line.trim());
    if (heading?.[1] !== undefined) {
      flush();
      current = heading[1];
      continue;
    }
    const parsedDate = /^fecha:\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line.trim());
    if (parsedDate?.[1] !== undefined) {
      date = parsedDate[1];
    }
    const parsedInstructor = /^profesor:\s*(.+)$/.exec(line.trim());
    if (parsedInstructor?.[1] !== undefined) {
      instructor = parsedInstructor[1];
    }
  }
  flush();
  return found;
}

function exerciseDetail(value: string | undefined): PreparedDocument["exerciseDetail"] {
  if (value === "summary" || value === "title-only" || value === "absent") {
    return value;
  }
  return "absent";
}

export function coverageFrom(
  documents: readonly Pick<
    PreparedDocument,
    "audience" | "session" | "curriculum" | "exerciseDetail" | "body"
  >[],
): CoverageReport {
  const program = new Map<string, Pick<PreparedDocument, "curriculum" | "exerciseDetail">>();
  for (const document of documents) {
    if (document.audience === "program" && document.session !== null) {
      program.set(document.session, document);
    }
  }
  const lx = calendarFacts(documents.find((document) => document.audience === "L/X")?.body ?? "");
  const mj = calendarFacts(documents.find((document) => document.audience === "M/J")?.body ?? "");
  const sessions = SESSIONS.map((session) => {
    const card = program.get(session);
    return {
      session,
      curriculum: card?.curriculum ?? "absent",
      exerciseDetail: card?.exerciseDetail ?? "absent",
      dateLx: lx.get(session)?.date ?? null,
      dateMj: mj.get(session)?.date ?? null,
      instructorLx: lx.get(session)?.instructor ?? null,
      instructorMj: mj.get(session)?.instructor ?? null,
    };
  });
  const every = (pick: (session: (typeof sessions)[number]) => boolean) => sessions.every(pick);
  return {
    curriculum: every((session) => session.curriculum === "present") ? "complete" : "partial",
    calendarLx: every((session) => session.dateLx !== null) ? "complete" : "partial",
    calendarMj: every((session) => session.dateMj !== null) ? "complete" : "partial",
    exerciseDetail: every((session) => session.exerciseDetail === "summary")
      ? "complete"
      : "partial",
    remote: "not-verified",
    sessions,
  };
}

export function formatCoverage(corpus: PreparedCorpus): string {
  const counts = {
    summary: corpus.coverage.sessions.filter((session) => session.exerciseDetail === "summary")
      .length,
    title: corpus.coverage.sessions.filter((session) => session.exerciseDetail === "title-only")
      .length,
    absentCard: corpus.coverage.sessions.filter((session) => session.curriculum === "absent")
      .length,
    missingLx: corpus.coverage.sessions.filter((session) => session.dateLx === null).length,
    missingMj: corpus.coverage.sessions.filter((session) => session.dateMj === null).length,
  };
  const lines = [
    "# Cobertura del corpus",
    "",
    `Versión de contenido: ${corpus.contentVersion}.`,
    `Versión de preparación: ${corpus.preparationId}.`,
    `Perfil de índice local: ${corpus.indexProfile.id} (${corpus.indexProfile.family}, ${corpus.indexProfile.model}, ${String(corpus.indexProfile.dimensions)} dimensiones, ${corpus.indexProfile.metric}).`,
    "La revisión remota del índice no está verificada.",
    "El programa de Desarrollo Agéntico no forma parte de este corpus.",
    "",
    `Temario: ${corpus.coverage.curriculum}. Fichas ausentes: ${String(counts.absentCard)}.`,
    `Calendario L/X: ${corpus.coverage.calendarLx}. Fechas ausentes: ${String(counts.missingLx)}.`,
    `Calendario M/J: ${corpus.coverage.calendarMj}. Fechas ausentes: ${String(counts.missingMj)}.`,
    `Detalle de ejercicios: ${corpus.coverage.exerciseDetail}. Resúmenes: ${String(counts.summary)}. Solo título: ${String(counts.title)}.`,
    "Verificación remota: no verificada.",
    "",
    "| Sesión | Temario | Ejercicio | Fecha L/X | Profesor L/X | Fecha M/J | Profesor M/J |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const session of corpus.coverage.sessions) {
    lines.push(
      `| ${session.session} | ${session.curriculum} | ${session.exerciseDetail} | ${session.dateLx ?? "no consta"} | ${session.instructorLx ?? "no consta"} | ${session.dateMj ?? "no consta"} | ${session.instructorMj ?? "no consta"} |`,
    );
  }
  lines.push(
    "",
    "Las celdas salen de los metadatos de cada documento. Una fecha de una cohorte no se copia a la otra.",
    "Un ejercicio en `title-only` no incluye rúbrica, plazo ni decisiones técnicas que la fuente no trae.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

export function prepareCorpus(
  files: readonly SourceFile[],
  embedding: {
    family: ProfileIdentity["family"];
    model: string;
    dimensions: number;
    metric?: "cosine";
    providerRevision?: string | null;
    chunking?: { maxChars: number; overlap: number };
  },
): PreparedCorpus {
  const chunking = embedding.chunking ?? PREP_CHUNKING;
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  const sourceMaterial = ordered.map((file) => `${file.path}\n${file.text}`).join("\n");
  const content = contentVersionId(sourceMaterial);
  const preparation = preparationId(sourceMaterial, chunking);
  if (utf8Bytes(preparation) > METADATA_VALUE_MAX_BYTES) {
    throw new Error("La versión de preparación no cabe en un metadato filtrable.");
  }
  const seenDocuments = new Set<string>();
  const seenChunks = new Set<string>();
  const documents: PreparedDocument[] = ordered.map((file) => {
    const fields = frontmatter(file.text);
    const id = fields.id;
    const title = fields.title;
    const audience = fields.audience;
    if (id === undefined || title === undefined || audience === undefined) {
      throw new Error(`Falta id, title o audience en ${file.path}`);
    }
    if (audience !== "program" && audience !== "L/X" && audience !== "M/J") {
      throw new Error(`Audiencia no válida en ${file.path}`);
    }
    if (seenDocuments.has(id)) {
      throw new Error(`Documento duplicado: ${id}`);
    }
    seenDocuments.add(id);
    const chunks = chunkMarkdown(file.text, chunking).map((chunk) => {
      const idForChunk = chunkId(preparation, id, chunk.ordinal);
      const vectorId = vectorIdFor(idForChunk);
      if (seenChunks.has(idForChunk)) {
        throw new Error(`Fragmento duplicado: ${idForChunk}`);
      }
      seenChunks.add(idForChunk);
      return {
        chunkId: idForChunk,
        vectorId,
        section: chunk.section,
        text: chunk.text,
        ordinal: chunk.ordinal,
      };
    });
    return {
      id,
      title,
      audience,
      session: fields.session ?? null,
      verified: fields.verified ?? "",
      source: fields.source ?? "",
      sourcePath: file.path,
      sourceHash: fnv1a64(file.text),
      curriculum: fields.curriculum === "present" ? "present" : "absent",
      exerciseDetail: exerciseDetail(fields.exerciseDetail),
      body: file.text,
      chunks,
    };
  });
  const profileBase: ProfileIdentity = {
    family: embedding.family,
    model: embedding.model,
    dimensions: embedding.dimensions,
    metric: embedding.metric ?? "cosine",
    chunkMaxChars: chunking.maxChars,
    chunkOverlap: chunking.overlap,
    providerRevision: embedding.providerRevision ?? null,
    preparationId: preparation,
  };
  const profileId = indexProfileId(profileBase);
  if (utf8Bytes(profileId) > METADATA_VALUE_MAX_BYTES) {
    throw new Error("El perfil no cabe en un metadato filtrable.");
  }
  const verifiedDates = documents
    .map((document) => document.verified)
    .filter((value) => value !== "");
  return {
    contentVersion: content,
    preparationId: preparation,
    version: preparation,
    verifiedDate: verifiedDates.sort().at(-1) ?? "",
    embeddingModel: embedding.model,
    dimensions: embedding.dimensions,
    remoteRevision: null,
    coverage: coverageFrom(documents),
    indexProfile: { ...profileBase, id: profileId },
    documents,
  };
}
