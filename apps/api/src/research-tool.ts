// GUÍA DE LECTURA · apps/api/src/research-tool.ts
// Herramienta get_course_session de la investigación: devuelve en solo lectura la ficha de una
// sesión y, si hay grupo, su fecha y profesor del calendario de ese grupo. Lo que no consta se dice.
// Tipo de audiencia.
import type { Audience } from "@thepower-rag/contracts";
// Regla de visibilidad y tipo de fragmento.
import { allowsAudience, type ChunkRecord } from "@thepower-rag/core";
// Validación de argumentos y tipos de la herramienta.
import {
  validateSessionArgs,
  type CourseSessionToolPort,
  type PortResult,
  type ToolEvidence,
} from "@thepower-rag/research";
// Corpus preparado incluido en el bundle.
import prepared from "../../../corpus/prepared/corpus.json";

/** Lector de un fragmento del catálogo. Solo lectura. */
export type ChunkReader = (corpusVersion: string, chunkId: string) => Promise<ChunkRecord | null>;

// Documento del manifiesto.
interface ManifestDocument {
  // Id.
  id: string;
  // Título.
  title: string;
  // Audiencia.
  audience: string;
  // Fragmentos.
  chunks: { chunkId: string; section: string }[];
}

// Documentos del manifiesto.
const documents = (prepared as { documents: ManifestDocument[] }).documents;

/** Mapa S1..S20 al documento de sesión del manifiesto empaquetado. */
function sessionDocument(sessionNumber: number): ManifestDocument | null {
  // Prefijo del documento: s01-, s02-…
  const prefix = `s${String(sessionNumber).padStart(2, "0")}-`;
  // Documento del programa con ese prefijo.
  return documents.find((doc) => doc.id.startsWith(prefix) && doc.audience === "program") ?? null;
}

// Id del fragmento de calendario de una sesión para un grupo.
function calendarChunkId(corpusVersion: string, audience: Audience, sessionNumber: number) {
  // El programa completo no tiene calendario.
  if (audience === "program") {
    // null.
    return null;
  }
  // lx o mj.
  const group = audience === "L/X" ? "lx" : "mj";
  // Id del fragmento.
  return `${corpusVersion}:calendario-${group}:${String(sessionNumber).padStart(2, "0")}`;
}

// Lee un campo «nombre: valor» de un texto.
function field(text: string, name: string): string | null {
  // Busca la línea del campo.
  const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(text);
  // Valor sin espacios.
  const value = match?.[1]?.trim();
  // Recortado a 120 caracteres, o null.
  return value === undefined || value.length === 0 ? null : value.slice(0, 120);
}

// Frase que empieza por un marcador.
function sentence(text: string, marker: RegExp): string | null {
  // Texto en una línea.
  const flat = text.replace(/\s+/g, " ");
  // Busca el marcador.
  const match = marker.exec(flat);
  // No está.
  if (match === null) {
    // null.
    return null;
  }
  // Texto desde el marcador.
  const rest = flat.slice(match.index);
  // Fin de la frase.
  const end = rest.search(/\.\s/);
  // Frase recortada a 400 caracteres.
  return (end === -1 ? rest : rest.slice(0, end + 1)).slice(0, 400);
}

// Resultado correcto sin consumo (es una lectura local).
const ok = <T>(value: T): PortResult<T> => ({ ok: true, value, consumption: { kind: "none" } });

/**
 * get_course_session({ sessionId, audience }) en modo solo lectura.
 * - Valida los argumentos y exige el grupo de la petición.
 * - Lee la ficha de la sesión y, si hay grupo, solo el calendario de ese grupo.
 * - No inventa campos: lo que no está en los fragmentos aparece como «no consta».
 */
export function createCourseSessionTool(input: {
  // Versión del corpus.
  corpusVersion: string;
  // Grupo de la petición.
  audience: Audience;
  // Lector de fragmentos.
  read: ChunkReader;
}): CourseSessionToolPort {
  // Puerto de la herramienta.
  return {
    // Resuelve una ficha del curso usando el ámbito y los filtros del recorrido.
    async getCourseSession(raw, context) {
      // Valida los argumentos del modelo.
      const args = validateSessionArgs(raw, input.audience);
      // Inválidos.
      if (!args.ok) {
        // Error.
        return { ok: false, error: "invalid", detail: args.reason, consumption: { kind: "none" } };
      }
      // Cancelado.
      if (context.signal.aborted) {
        // Error.
        return {
          ok: false,
          error: "aborted",
          detail: "Petición detenida.",
          consumption: { kind: "none" },
        };
      }
      // Número de la sesión.
      const number = Number(args.value.sessionId.slice(1));
      // Documento de la sesión.
      const doc = sessionDocument(number);
      // No existe.
      if (doc === null) {
        // Sin resultado.
        return ok(null);
      }
      // Fragmentos leídos de la sesión.
      const sessionChunks: ChunkRecord[] = [];
      // Fallos del catálogo se devuelven como error.
      try {
        // Hasta tres fragmentos de la ficha.
        for (const chunk of doc.chunks.slice(0, 3)) {
          // Lee el fragmento en la versión actual.
          const row = await input.read(
            input.corpusVersion,
            chunk.chunkId.replace(/^[^:]+:/, `${input.corpusVersion}:`),
          );
          // Solo los visibles para el grupo.
          if (row !== null && allowsAudience(row.audience, input.audience)) {
            // Se guardan.
            sessionChunks.push(row);
          }
        }
        // Ninguno.
        if (sessionChunks.length === 0) {
          // Sin resultado.
          return ok(null);
        }
        // Id del calendario de la sesión.
        const calendarId = calendarChunkId(input.corpusVersion, input.audience, number);
        // Fragmento del calendario.
        const calendar =
          calendarId === null ? null : await input.read(input.corpusVersion, calendarId);
        // Válido si es del grupo y de esa sesión.
        const calendarOk =
          calendar !== null &&
          calendar.audience === input.audience &&
          calendar.section.trim() === `S${String(number)}`;
        // Texto de la ficha.
        const text = sessionChunks.map((chunk) => chunk.text).join(" ");
        // Objetivo.
        const objective = sentence(text, /Objetivo para el alumno:/);
        // Ejercicio.
        const exercise =
          sentence(text, /Ejercicio resumido:/) ?? sentence(text, /El ejercicio del temario es/);
        // Líneas de la respuesta.
        const lines = [
          `Sesión ${args.value.sessionId}: ${sessionChunks[0]?.title ?? doc.title}.`,
          objective ?? "Objetivo: no consta en la ficha.",
          exercise ?? "Ejercicio: no consta en la ficha.",
        ];
        // Programa completo: sin calendario.
        if (input.audience === "program") {
          // Se pide elegir grupo.
          lines.push("Fecha y profesor: el grupo General no muestra calendarios; elige L/X o M/J.");
        } else if (calendarOk) {
          // Calendario válido: fecha, profesor y horario.
          lines.push(
            `Grupo ${input.audience}: fecha ${field(calendar.text, "fecha") ?? "no consta"}; profesor ${field(calendar.text, "profesor") ?? "no consta"}; horario ${field(calendar.text, "horario") ?? "no consta"}.`,
          );
        } else {
          // Sin calendario: no consta.
          lines.push(`Grupo ${input.audience}: la fecha no consta en el calendario del grupo.`);
        }
        // Grupo para el id.
        const group =
          input.audience === "program" ? "general" : input.audience === "L/X" ? "lx" : "mj";
        // Evidencia de la herramienta.
        const evidence: ToolEvidence = {
          kind: "tool",
          sourceId: `tool:session:${group}:s${String(number)}`,
          toolName: "get_course_session",
          title: `get_course_session · ${args.value.sessionId} · ${input.audience === "program" ? "General" : input.audience}`,
          text: lines.join("\n").slice(0, 1_200),
          backingSourceIds: [
            ...sessionChunks.map((chunk) => chunk.chunkId),
            ...(calendarOk ? [calendar.chunkId] : []),
          ].slice(0, 4),
          audience: input.audience,
          corpusVersion: input.corpusVersion,
        };
        // Resultado.
        return ok(evidence);
      } catch {
        // El catálogo falló.
        return {
          ok: false,
          error: "provider",
          detail: "El catálogo del curso no respondió.",
          consumption: { kind: "none" },
        };
      }
    },
  };
}
