import type { Audience } from "@thepower-rag/contracts";
import { allowsAudience, type ChunkRecord } from "@thepower-rag/core";
import {
  validateSessionArgs,
  type CourseSessionToolPort,
  type PortResult,
  type ToolEvidence,
} from "@thepower-rag/research";
import prepared from "../../../corpus/prepared/corpus.json";

/** Lector de un fragmento del catálogo. Solo lectura. */
export type ChunkReader = (corpusVersion: string, chunkId: string) => Promise<ChunkRecord | null>;

interface ManifestDocument {
  id: string;
  title: string;
  audience: string;
  chunks: { chunkId: string; section: string }[];
}

const documents = (prepared as { documents: ManifestDocument[] }).documents;

/** Mapa S1..S20 al documento de sesión del manifiesto empaquetado. */
function sessionDocument(sessionNumber: number): ManifestDocument | null {
  const prefix = `s${String(sessionNumber).padStart(2, "0")}-`;
  return documents.find((doc) => doc.id.startsWith(prefix) && doc.audience === "program") ?? null;
}

function calendarChunkId(corpusVersion: string, audience: Audience, sessionNumber: number) {
  if (audience === "program") {
    return null;
  }
  const group = audience === "L/X" ? "lx" : "mj";
  return `${corpusVersion}:calendario-${group}:${String(sessionNumber).padStart(2, "0")}`;
}

function field(text: string, name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, "m").exec(text);
  const value = match?.[1]?.trim();
  return value === undefined || value.length === 0 ? null : value.slice(0, 120);
}

function sentence(text: string, marker: RegExp): string | null {
  const flat = text.replace(/\s+/g, " ");
  const match = marker.exec(flat);
  if (match === null) {
    return null;
  }
  const rest = flat.slice(match.index);
  const end = rest.search(/\.\s/);
  return (end === -1 ? rest : rest.slice(0, end + 1)).slice(0, 400);
}

const ok = <T>(value: T): PortResult<T> => ({ ok: true, value, consumption: { kind: "none" } });

/**
 * get_course_session({ sessionId, audience }) en modo solo lectura.
 * - Valida los argumentos y exige el grupo de la petición.
 * - Lee la ficha de la sesión y, si hay grupo, solo el calendario de ese grupo.
 * - No inventa campos: lo que no está en los fragmentos aparece como «no consta».
 */
export function createCourseSessionTool(input: {
  corpusVersion: string;
  audience: Audience;
  read: ChunkReader;
}): CourseSessionToolPort {
  return {
    async getCourseSession(raw, context) {
      const args = validateSessionArgs(raw, input.audience);
      if (!args.ok) {
        return { ok: false, error: "invalid", detail: args.reason, consumption: { kind: "none" } };
      }
      if (context.signal.aborted) {
        return {
          ok: false,
          error: "aborted",
          detail: "Petición detenida.",
          consumption: { kind: "none" },
        };
      }
      const number = Number(args.value.sessionId.slice(1));
      const doc = sessionDocument(number);
      if (doc === null) {
        return ok(null);
      }
      const sessionChunks: ChunkRecord[] = [];
      try {
        for (const chunk of doc.chunks.slice(0, 3)) {
          const row = await input.read(
            input.corpusVersion,
            chunk.chunkId.replace(/^[^:]+:/, `${input.corpusVersion}:`),
          );
          if (row !== null && allowsAudience(row.audience, input.audience)) {
            sessionChunks.push(row);
          }
        }
        if (sessionChunks.length === 0) {
          return ok(null);
        }
        const calendarId = calendarChunkId(input.corpusVersion, input.audience, number);
        const calendar =
          calendarId === null ? null : await input.read(input.corpusVersion, calendarId);
        const calendarOk =
          calendar !== null &&
          calendar.audience === input.audience &&
          calendar.section.trim() === `S${String(number)}`;
        const text = sessionChunks.map((chunk) => chunk.text).join(" ");
        const objective = sentence(text, /Objetivo para el alumno:/);
        const exercise =
          sentence(text, /Ejercicio resumido:/) ?? sentence(text, /El ejercicio del temario es/);
        const lines = [
          `Sesión ${args.value.sessionId}: ${sessionChunks[0]?.title ?? doc.title}.`,
          objective ?? "Objetivo: no consta en la ficha.",
          exercise ?? "Ejercicio: no consta en la ficha.",
        ];
        if (input.audience === "program") {
          lines.push("Fecha y profesor: el grupo General no muestra calendarios; elige L/X o M/J.");
        } else if (calendarOk) {
          lines.push(
            `Grupo ${input.audience}: fecha ${field(calendar.text, "fecha") ?? "no consta"}; profesor ${field(calendar.text, "profesor") ?? "no consta"}; horario ${field(calendar.text, "horario") ?? "no consta"}.`,
          );
        } else {
          lines.push(`Grupo ${input.audience}: la fecha no consta en el calendario del grupo.`);
        }
        const group =
          input.audience === "program" ? "general" : input.audience === "L/X" ? "lx" : "mj";
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
        return ok(evidence);
      } catch {
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
