// GUÍA DE LECTURA · packages/rag/src/prepare.ts
// Preparación del corpus: lee los Markdown de corpus/sources, valida su cabecera, los trocea,
// calcula versiones y perfil de índice, y resume la cobertura (temario, calendarios y ejercicios).
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Troceado de Markdown e identificador de fragmento.
import { chunkId, chunkMarkdown } from "./chunk";
// Huella FNV-1a.
import { fnv1a64 } from "./hash";
// Constantes e identificadores derivados del contenido.
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

// Archivo fuente leído del disco.
export interface SourceFile {
  // Ruta relativa del archivo.
  path: string;
  // Contenido.
  text: string;
}

// Documento preparado con sus metadatos y fragmentos.
export interface PreparedDocument {
  // Identificador (cabecera id).
  id: string;
  // Título.
  title: string;
  // Audiencia: programa o cohorte.
  audience: Audience;
  // Sesión (S1…S20) o null.
  session: string | null;
  // Fecha en que se verificó el contenido.
  verified: string;
  // Fuente original del contenido.
  source: string;
  // Ruta del archivo fuente.
  sourcePath: string;
  // Huella del archivo.
  sourceHash: string;
  // Si la sesión tiene temario.
  curriculum: "present" | "absent";
  // Detalle del ejercicio: resumen, solo título o ausente.
  exerciseDetail: "summary" | "title-only" | "absent";
  // Texto completo.
  body: string;
  // Fragmentos del documento.
  chunks: {
    // Id del fragmento.
    chunkId: string;
    // Id del vector en Vectorize.
    vectorId: string;
    // Sección.
    section: string;
    // Texto.
    text: string;
    // Posición.
    ordinal: number;
  }[];
}

// Informe de cobertura del corpus.
export interface CoverageReport {
  // Temario completo o parcial.
  curriculum: "complete" | "partial";
  // Calendario L/X completo o parcial.
  calendarLx: "complete" | "partial";
  // Calendario M/J completo o parcial.
  calendarMj: "complete" | "partial";
  // Detalle de ejercicios completo o parcial.
  exerciseDetail: "complete" | "partial";
  // El índice remoto no se verifica aquí.
  remote: "not-verified";
  // Cobertura por sesión.
  sessions: {
    // S1…S20.
    session: string;
    // Si hay ficha de temario.
    curriculum: "present" | "absent";
    // Detalle del ejercicio.
    exerciseDetail: "summary" | "title-only" | "absent";
    // Fecha en L/X, o null.
    dateLx: string | null;
    // Fecha en M/J, o null.
    dateMj: string | null;
    // Profesor en L/X, o null.
    instructorLx: string | null;
    // Profesor en M/J, o null.
    instructorMj: string | null;
  }[];
}

// Corpus preparado completo.
export interface PreparedCorpus {
  // Versión del contenido.
  contentVersion: string;
  // Versión de preparación (contenido y troceado).
  preparationId: string;
  // Versión usada en los ids.
  version: string;
  // Fecha de verificación más reciente.
  verifiedDate: string;
  // Modelo de embeddings.
  embeddingModel: string;
  // Dimensiones.
  dimensions: number;
  // Revisión remota sin verificar.
  remoteRevision: null;
  // Cobertura.
  coverage: CoverageReport;
  // Perfil de índice con su id.
  indexProfile: ProfileIdentity & { id: string };
  // Documentos preparados.
  documents: PreparedDocument[];
}

// Línea «campo: valor» de la cabecera; solo campos conocidos.
const FIELD = /^(id|title|audience|session|verified|source|curriculum|exerciseDetail):\s*(.+)$/;
// Lista S1…S20.
const SESSIONS = Array.from({ length: 20 }, (_, index) => `S${String(index + 1)}`);

// Lee la cabecera YAML simple (entre ---) de un documento.
function frontmatter(text: string): Record<string, string> {
  // Bloque entre los dos ---.
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  // Campos encontrados.
  const fields: Record<string, string> = {};
  // Sin cabecera: objeto vacío.
  if (match?.[1] === undefined) {
    // Sale con lo que hay.
    return fields;
  }
  // Revisa cada línea de la cabecera.
  for (const line of match[1].split("\n")) {
    // ¿Es un campo conocido?
    const parsed = FIELD.exec(line.trim());
    // Si lo es, se guarda.
    if (parsed?.[1] !== undefined && parsed[2] !== undefined) {
      // Nombre → valor.
      fields[parsed[1]] = parsed[2];
    }
  }
  // Campos leídos.
  return fields;
}

// Lee fechas y profesores de un calendario: cada «## S<n>» abre una sesión.
function calendarFacts(text: string): Map<string, { date: string; instructor: string | null }> {
  // Sesión → fecha y profesor.
  const found = new Map<string, { date: string; instructor: string | null }>();
  // Sesión actual.
  let current = "";
  // Fecha de la sesión actual.
  let date = "";
  // Profesor de la sesión actual.
  let instructor: string | null = null;
  // Guarda la sesión actual si tiene fecha y reinicia los datos.
  const flush = () => {
    // Solo si hay sesión y fecha.
    if (current !== "" && date !== "") {
      // Guarda la sesión.
      found.set(current, { date, instructor });
    }
    // Reinicia la fecha.
    date = "";
    // Reinicia el profesor.
    instructor = null;
  };
  // Recorre el calendario línea a línea.
  for (const line of text.split("\n")) {
    // ¿Empieza una sesión?
    const heading = /^## (S\d+)\b/.exec(line.trim());
    // Nueva sesión.
    if (heading?.[1] !== undefined) {
      // Guarda la anterior.
      flush();
      // Recuerda la nueva.
      current = heading[1];
      // Pasa a la línea siguiente.
      continue;
    }
    // ¿Línea con la fecha (AAAA-MM-DD)?
    const parsedDate = /^fecha:\s*(\d{4}-\d{2}-\d{2})\s*$/.exec(line.trim());
    // Si la hay.
    if (parsedDate?.[1] !== undefined) {
      // Guarda la fecha.
      date = parsedDate[1];
    }
    // ¿Línea con el profesor?
    const parsedInstructor = /^profesor:\s*(.+)$/.exec(line.trim());
    // Si la hay.
    if (parsedInstructor?.[1] !== undefined) {
      // Guarda el profesor.
      instructor = parsedInstructor[1];
    }
  }
  // Guarda la última sesión.
  flush();
  // Calendario leído.
  return found;
}

// Normaliza el detalle del ejercicio; cualquier otro valor cuenta como ausente.
function exerciseDetail(value: string | undefined): PreparedDocument["exerciseDetail"] {
  // Valor conocido.
  if (value === "summary" || value === "title-only" || value === "absent") {
    // Se devuelve tal cual.
    return value;
  }
  // Desconocido: ausente.
  return "absent";
}

// Calcula la cobertura de temario, calendarios y ejercicios de S1 a S20.
export function coverageFrom(
  documents: readonly Pick<
    PreparedDocument,
    "audience" | "session" | "curriculum" | "exerciseDetail" | "body"
  >[],
): CoverageReport {
  // Fichas del programa por sesión.
  const program = new Map<string, Pick<PreparedDocument, "curriculum" | "exerciseDetail">>();
  // Recorre los documentos.
  for (const document of documents) {
    // Solo las fichas de sesión del programa.
    if (document.audience === "program" && document.session !== null) {
      // Guarda la ficha.
      program.set(document.session, document);
    }
  }
  // Calendario L/X.
  const lx = calendarFacts(documents.find((document) => document.audience === "L/X")?.body ?? "");
  // Calendario M/J.
  const mj = calendarFacts(documents.find((document) => document.audience === "M/J")?.body ?? "");
  // Datos de cada sesión.
  const sessions = SESSIONS.map((session) => {
    // Ficha de la sesión, si existe.
    const card = program.get(session);
    // Fila de cobertura con lo que consta.
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
  // ¿Cumplen todas las sesiones la condición?
  const every = (pick: (session: (typeof sessions)[number]) => boolean) => sessions.every(pick);
  // Completo solo si se cumple en las 20 sesiones.
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

// Texto Markdown de la cobertura (corpus/COVERAGE.md).
export function formatCoverage(corpus: PreparedCorpus): string {
  // Recuentos para el resumen.
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
  // Cabecera y resumen.
  const lines = [
    // Título y versiones del corpus.
    "# Cobertura del corpus",
    "",
    `Versión de contenido: ${corpus.contentVersion}.`,
    `Versión de preparación: ${corpus.preparationId}.`,
    // Perfil de índice local y avisos sobre lo no verificado.
    `Perfil de índice local: ${corpus.indexProfile.id} (${corpus.indexProfile.family}, ${corpus.indexProfile.model}, ${String(corpus.indexProfile.dimensions)} dimensiones, ${corpus.indexProfile.metric}).`,
    "La revisión remota del índice no está verificada.",
    "El programa de Desarrollo Agéntico no forma parte de este corpus.",
    "",
    // Cobertura del temario, de cada calendario y de los ejercicios.
    `Temario: ${corpus.coverage.curriculum}. Fichas ausentes: ${String(counts.absentCard)}.`,
    `Calendario L/X: ${corpus.coverage.calendarLx}. Fechas ausentes: ${String(counts.missingLx)}.`,
    `Calendario M/J: ${corpus.coverage.calendarMj}. Fechas ausentes: ${String(counts.missingMj)}.`,
    `Detalle de ejercicios: ${corpus.coverage.exerciseDetail}. Resúmenes: ${String(counts.summary)}. Solo título: ${String(counts.title)}.`,
    "Verificación remota: no verificada.",
    "",
    // Cabecera de la tabla por sesión.
    "| Sesión | Temario | Ejercicio | Fecha L/X | Profesor L/X | Fecha M/J | Profesor M/J |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  // Una fila de tabla por sesión.
  for (const session of corpus.coverage.sessions) {
    // Fila con lo que consta o «no consta».
    lines.push(
      `| ${session.session} | ${session.curriculum} | ${session.exerciseDetail} | ${session.dateLx ?? "no consta"} | ${session.instructorLx ?? "no consta"} | ${session.dateMj ?? "no consta"} | ${session.instructorMj ?? "no consta"} |`,
    );
  }
  // Notas finales.
  lines.push(
    "",
    "Las celdas salen de los metadatos de cada documento. Una fecha de una cohorte no se copia a la otra.",
    "Un ejercicio en `title-only` no incluye rúbrica, plazo ni decisiones técnicas que la fuente no trae.",
    "",
  );
  // Texto con salto de línea final.
  return `${lines.join("\n")}\n`;
}

// Prepara el corpus completo a partir de los archivos fuente.
export function prepareCorpus(
  files: readonly SourceFile[],
  embedding: {
    // Familia del perfil (demostración o Workers AI).
    family: ProfileIdentity["family"];
    // Modelo de embeddings.
    model: string;
    // Dimensiones.
    dimensions: number;
    // Métrica (por defecto, coseno).
    metric?: "cosine";
    // Revisión del proveedor.
    providerRevision?: string | null;
    // Troceado (por defecto, el del curso).
    chunking?: { maxChars: number; overlap: number };
  },
): PreparedCorpus {
  // Troceado efectivo.
  const chunking = embedding.chunking ?? PREP_CHUNKING;
  // Orden alfabético estable por ruta.
  const ordered = [...files].sort((left, right) => left.path.localeCompare(right.path));
  // Material fuente: ruta y texto de cada archivo.
  const sourceMaterial = ordered.map((file) => `${file.path}\n${file.text}`).join("\n");
  // Versión del contenido.
  const content = contentVersionId(sourceMaterial);
  // Versión de preparación.
  const preparation = preparationId(sourceMaterial, chunking);
  // Debe caber en un metadato filtrable de Vectorize.
  if (utf8Bytes(preparation) > METADATA_VALUE_MAX_BYTES) {
    // Error si no cabe.
    throw new Error("La versión de preparación no cabe en un metadato filtrable.");
  }
  // Ids de documento ya vistos.
  const seenDocuments = new Set<string>();
  // Ids de fragmento ya vistos.
  const seenChunks = new Set<string>();
  // Prepara cada archivo.
  const documents: PreparedDocument[] = ordered.map((file) => {
    // Cabecera del archivo.
    const fields = frontmatter(file.text);
    // Id.
    const id = fields.id;
    // Título.
    const title = fields.title;
    // Audiencia.
    const audience = fields.audience;
    // Los tres campos son obligatorios.
    if (id === undefined || title === undefined || audience === undefined) {
      // Error con la ruta del archivo.
      throw new Error(`Falta id, title o audience en ${file.path}`);
    }
    // Audiencia válida.
    if (audience !== "program" && audience !== "L/X" && audience !== "M/J") {
      // Error si no.
      throw new Error(`Audiencia no válida en ${file.path}`);
    }
    // Ids de documento únicos.
    if (seenDocuments.has(id)) {
      // Error si se repite.
      throw new Error(`Documento duplicado: ${id}`);
    }
    // Marca el id como visto.
    seenDocuments.add(id);
    // Trocea el documento.
    const chunks = chunkMarkdown(file.text, chunking).map((chunk) => {
      // Id del fragmento.
      const idForChunk = chunkId(preparation, id, chunk.ordinal);
      // Id del vector (comprobando su longitud).
      const vectorId = vectorIdFor(idForChunk);
      // Ids de fragmento únicos.
      if (seenChunks.has(idForChunk)) {
        // Error si se repite.
        throw new Error(`Fragmento duplicado: ${idForChunk}`);
      }
      // Marca el fragmento como visto.
      seenChunks.add(idForChunk);
      // Fragmento preparado.
      return {
        chunkId: idForChunk,
        vectorId,
        section: chunk.section,
        text: chunk.text,
        ordinal: chunk.ordinal,
      };
    });
    // Documento preparado.
    return {
      // Identidad, título y grupo.
      id,
      title,
      audience,
      // Metadatos de la cabecera del Markdown.
      session: fields.session ?? null,
      verified: fields.verified ?? "",
      source: fields.source ?? "",
      // Ruta y huella de la fuente.
      sourcePath: file.path,
      sourceHash: fnv1a64(file.text),
      // Si hay temario y qué detalle tiene el ejercicio.
      curriculum: fields.curriculum === "present" ? "present" : "absent",
      exerciseDetail: exerciseDetail(fields.exerciseDetail),
      // Texto completo y fragmentos.
      body: file.text,
      chunks,
    };
  });
  // Datos del perfil de índice.
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
  // Id del perfil.
  const profileId = indexProfileId(profileBase);
  // Debe caber en un metadato filtrable.
  if (utf8Bytes(profileId) > METADATA_VALUE_MAX_BYTES) {
    // Error si no cabe.
    throw new Error("El perfil no cabe en un metadato filtrable.");
  }
  // Fechas de verificación conocidas.
  const verifiedDates = documents
    .map((document) => document.verified)
    .filter((value) => value !== "");
  // Corpus preparado.
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
