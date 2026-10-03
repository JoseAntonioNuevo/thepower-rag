import { DEMO_CRAG_SCENARIOS, type DemoScenarioId } from "@thepower-rag/contracts";
import {
  cosine,
  CRAG_BOUNDS,
  FIXTURE_EMBEDDING_MODEL,
  FIXTURE_MIN_SCORE,
  fixtureEmbed,
  normalizeQuery,
  type CragChunk,
  type CragPorts,
  type CragSignal,
  type IndexedChunk,
} from "@thepower-rag/core";
import { fixtureChunks, fixtureProfile } from "./fixture";

const S5 = "c3a59a406888b:s05-langgraph:00";
const S6 = "c3a59a406888b:s06-observabilidad:00";
const S16 = "c3a59a406888b:s16-cloud-aws:00";

export function resolveDemoScenario(
  explicit: DemoScenarioId | undefined,
  question: string,
): DemoScenarioId | null {
  if (explicit !== undefined) {
    return explicit;
  }
  const match = DEMO_CRAG_SCENARIOS.find((item) => item.question === question.trim());
  return match?.id ?? null;
}

function scripted(chunk: IndexedChunk, score: number): CragChunk {
  return {
    documentId: chunk.documentId,
    chunkId: chunk.chunkId,
    title: chunk.title,
    section: chunk.section,
    text: chunk.text,
    audience: chunk.audience,
    corpusVersion: chunk.corpusVersion,
    profileId: fixtureProfile().id,
    score,
  };
}

function byId(chunks: readonly IndexedChunk[], id: string, score: number): CragChunk {
  const found = chunks.find((chunk) => chunk.chunkId === id);
  if (found === undefined) {
    throw new Error(`Falta el fragmento de prueba ${id}.`);
  }
  return scripted(found, score);
}

function decision(
  chunks: readonly CragChunk[],
  status: "sufficient" | "partial" | "insufficient",
  reason: string,
  gaps: string[],
  usefulIds: string[],
): unknown {
  return {
    ranking: chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      score: chunk.score ?? 0,
      reason: "Guion de prueba. No es un modelo.",
    })),
    status,
    reason,
    gaps,
    usefulIds,
  };
}

function fixtureAnswer(evidence: readonly CragChunk[]): string {
  const lines = evidence.map(
    (chunk) =>
      `Según [cite:${chunk.chunkId}] (${chunk.section}): ${chunk.text.replace(/\s+/g, " ").slice(0, 280)}`,
  );
  return `Respuesta de prueba del grafo CRAG. El guion no mide calidad ni llama a un modelo.\n${lines.join("\n")}`;
}

export function createDemoCragPorts(input: {
  signal: CragSignal;
  scenarioId: DemoScenarioId | null;
  now?: () => number;
}): CragPorts {
  const library = fixtureChunks();
  const scenario = input.scenarioId;
  return {
    measured: false,
    now: input.now ?? Date.now,
    signal: input.signal,
    reserve: () => ({ ok: true }),
    async retrieve({ query, scope, attempt }) {
      if (scenario === "sufficient-s5") {
        return { ok: true, providerCall: false, chunks: [byId(library, S5, 0.91)] };
      }
      if (scenario === "partial-s5-s6") {
        return {
          ok: true,
          providerCall: false,
          chunks:
            attempt === 1
              ? [byId(library, S5, 0.8)]
              : [byId(library, S5, 0.4), byId(library, S6, 0.86)],
        };
      }
      if (scenario === "irrelevant-then-s6") {
        return {
          ok: true,
          providerCall: false,
          chunks: attempt === 1 ? [byId(library, S16, 0.2)] : [byId(library, S6, 0.88)],
        };
      }
      if (scenario === "missing-info" || scenario === "evaluator-error") {
        return { ok: true, providerCall: false, chunks: [byId(library, S16, 0.1)] };
      }
      const embedded = fixtureEmbed(query);
      const chunks = library
        .filter(
          (chunk) =>
            chunk.corpusVersion === scope.corpusVersion &&
            (scope.audience === "program"
              ? chunk.audience === "program"
              : chunk.audience === "program" || chunk.audience === scope.audience),
        )
        .map((chunk) => scripted(chunk, cosine(embedded, chunk.vector)))
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, CRAG_BOUNDS.maxCandidates);
      return { ok: true, providerCall: false, chunks };
    },
    async rankAndAssess({ chunks }) {
      if (scenario === "evaluator-error") {
        return {
          ok: true,
          providerCall: false,
          raw: {
            ranking: [
              {
                chunkId: "no-existe",
                score: 1,
                reason: "Id que no está en la búsqueda.",
              },
            ],
            status: "sufficient",
            reason: "Salida inválida de prueba.",
            gaps: [],
            usefulIds: ["no-existe"],
          },
        };
      }
      if (scenario === "sufficient-s5") {
        return {
          ok: true,
          providerCall: false,
          raw: decision(chunks, "sufficient", "La ficha de S5 describe estado y nodos.", [], [S5]),
        };
      }
      if (scenario === "partial-s5-s6") {
        const ids = chunks.map((chunk) => chunk.chunkId);
        if (ids.includes(S6)) {
          return {
            ok: true,
            providerCall: false,
            raw: decision(
              chunks,
              "sufficient",
              "S5 y S6 cubren estado y observabilidad.",
              [],
              [S5, S6],
            ),
          };
        }
        return {
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "partial",
            "S5 aporta el estado, falta la observabilidad.",
            ["Falta cómo observar la ejecución del agente."],
            [S5],
          ),
        };
      }
      if (scenario === "irrelevant-then-s6") {
        const ids = chunks.map((chunk) => chunk.chunkId);
        if (ids.includes(S6) && !ids.includes(S16)) {
          return {
            ok: true,
            providerCall: false,
            raw: decision(
              chunks,
              "sufficient",
              "La ficha de S6 cubre la observabilidad.",
              [],
              [S6],
            ),
          };
        }
        return {
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "insufficient",
            "Este fragmento no trata la observabilidad.",
            [],
            [],
          ),
        };
      }
      if (scenario === "missing-info") {
        return {
          ok: true,
          providerCall: false,
          raw: decision(chunks, "insufficient", "Ningún fragmento menciona esa beca.", [], []),
        };
      }
      const useful = chunks.filter(
        (chunk) => chunk.score !== null && chunk.score >= FIXTURE_MIN_SCORE,
      );
      if (useful.length === 0) {
        return {
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "insufficient",
            "Ningún fragmento supera el umbral lexical de prueba.",
            [],
            [],
          ),
        };
      }
      return {
        ok: true,
        providerCall: false,
        raw: decision(
          chunks,
          "sufficient",
          "Supera el umbral lexical de la demostración. No es un evaluador.",
          [],
          useful.slice(0, CRAG_BOUNDS.maxRetained).map((chunk) => chunk.chunkId),
        ),
      };
    },
    async reformulate({ question, query, attempt }) {
      if (scenario === "partial-s5-s6") {
        return {
          ok: true,
          providerCall: false,
          raw: { query: "observabilidad Langfuse y LangSmith de un agente" },
        };
      }
      if (scenario === "irrelevant-then-s6") {
        return {
          ok: true,
          providerCall: false,
          raw: { query: "sesión de observabilidad Langfuse LangSmith" },
        };
      }
      if (scenario === "missing-info") {
        return {
          ok: true,
          providerCall: false,
          raw: { query: `${question} intento ${String(attempt + 1)}` },
        };
      }
      const suffix = "temario AI Engineer";
      if (normalizeQuery(query).includes(normalizeQuery(suffix))) {
        return { ok: true, raw: { query }, providerCall: false };
      }
      return { ok: true, raw: { query: `${query} ${suffix}` }, providerCall: false };
    },
    async generate({ evidence }) {
      return {
        ok: true,
        providerCall: false,
        text: fixtureAnswer(evidence),
        usage: null,
        cost: null,
      };
    },
  };
}

export const DEMO_EMBEDDING_LABEL = FIXTURE_EMBEDDING_MODEL;
