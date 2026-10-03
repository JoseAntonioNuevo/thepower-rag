import type { CragChunk, CragPorts, CragScope } from "@thepower-rag/core";
import { describe, expect, it } from "vite-plus/test";
import { runCragTurn } from "./crag-graph";

const scope: CragScope = {
  runId: "run-test",
  audience: "program",
  corpusVersion: "c-test",
  profileId: "p-test",
  embeddingLabel: "prueba",
};

function chunk(id: string, audience: CragChunk["audience"] = "program"): CragChunk {
  return {
    documentId: id,
    chunkId: id,
    title: id,
    section: "S",
    text: `texto ${id}`,
    audience,
    corpusVersion: "c-test",
    profileId: "p-test",
    score: 0.5,
  };
}

function decision(
  chunks: readonly CragChunk[],
  status: "sufficient" | "partial" | "insufficient",
  usefulIds: string[],
  gaps: string[] = [],
): unknown {
  return {
    ranking: chunks.map((item) => ({
      chunkId: item.chunkId,
      score: item.score ?? 0,
      reason: `motivo ${item.chunkId}`,
    })),
    status,
    reason: status === "partial" ? "falta una parte" : `decision ${status}`,
    gaps,
    usefulIds,
  };
}

function ports(overrides: Partial<CragPorts> = {}): CragPorts & {
  counts: { retrieve: number; rank: number; rewrite: number; generate: number };
} {
  const counts = { retrieve: 0, rank: 0, rewrite: 0, generate: 0 };
  const signal = overrides.signal ?? { aborted: false };
  return {
    counts,
    measured: false,
    now: overrides.now ?? (() => 0),
    signal,
    reserve: overrides.reserve ?? (() => ({ ok: true })),
    retrieve:
      overrides.retrieve ??
      (async () => {
        counts.retrieve += 1;
        return { ok: true, providerCall: false, chunks: [chunk("s5")] };
      }),
    rankAndAssess:
      overrides.rankAndAssess ??
      (async ({ chunks }) => {
        counts.rank += 1;
        return {
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "sufficient",
            chunks.map((item) => item.chunkId),
          ),
        };
      }),
    reformulate:
      overrides.reformulate ??
      (async () => {
        counts.rewrite += 1;
        return { ok: true, providerCall: false, raw: { query: "consulta nueva" } };
      }),
    generate:
      overrides.generate ??
      (async ({ evidence }) => {
        counts.generate += 1;
        return {
          ok: true,
          providerCall: false,
          text: evidence.map((item) => `[cite:${item.chunkId}]`).join(" "),
          usage: null,
          cost: null,
        };
      }),
  };
}

async function turn(question: string, custom: Partial<CragPorts> = {}, audience = scope.audience) {
  const used = ports(custom);
  const result = await runCragTurn({
    question,
    scope: { ...scope, audience },
    ports: used,
    fixture: true,
    scenarioId: null,
  });
  return { result, counts: used.counts };
}

describe("grafo CRAG", () => {
  it("responde en la primera búsqueda sin reformular", async () => {
    const { result, counts } = await turn("estado y nodos");
    expect(result.terminal).toBe("answer");
    expect(result.summary.retrievalCount).toBe(1);
    expect(result.summary.reformulationCount).toBe(0);
    expect(counts).toEqual({ retrieve: 1, rank: 1, rewrite: 0, generate: 1 });
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["s5"]);
    expect(result.summary.calls.generation.providerCalls).toBeNull();
    expect(result.summary.partial).toBe(true);
  });

  it("conserva la evidencia parcial, deduplica y responde con las dos fuentes", async () => {
    let retrieval = 0;
    const { result } = await turn("estado y observabilidad", {
      retrieve: async () => {
        retrieval += 1;
        return {
          ok: true,
          providerCall: false,
          chunks: retrieval === 1 ? [chunk("s5")] : [chunk("s5"), chunk("s6")],
        };
      },
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: chunks.some((item) => item.chunkId === "s6")
          ? decision(chunks, "sufficient", ["s5", "s6"])
          : decision(chunks, "partial", ["s5"], ["falta observar la ejecución"]),
      }),
      reformulate: async () => ({
        ok: true,
        providerCall: false,
        raw: { query: "observabilidad del agente" },
      }),
    });
    expect(result.terminal).toBe("answer");
    expect(result.summary.retrievalCount).toBe(2);
    expect(result.summary.reformulationCount).toBe(1);
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["s5", "s6"]);
    expect(result.summary.originalQuestion).toBe("estado y observabilidad");
    expect(result.summary.currentQuery).toBe("observabilidad del agente");
  });

  it("no cita el contexto rechazado", async () => {
    let retrieval = 0;
    const { result } = await turn("observabilidad", {
      retrieve: async () => {
        retrieval += 1;
        return {
          ok: true,
          providerCall: false,
          chunks: retrieval === 1 ? [chunk("s16")] : [chunk("s6")],
        };
      },
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: chunks.some((item) => item.chunkId === "s6")
          ? decision(chunks, "sufficient", ["s6"])
          : decision(chunks, "insufficient", []),
      }),
      reformulate: async () => ({
        ok: true,
        providerCall: false,
        raw: { query: "langfuse langsmith" },
      }),
    });
    expect(result.answerText).toContain("[cite:s6]");
    expect(result.answerText).not.toContain("s16");
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["s6"]);
    expect(result.summary.discarded.some((item) => item.chunkId === "s16")).toBe(true);
  });

  it("se detiene a los tres intentos y dos reformulaciones, y el siguiente turno empieza de cero", async () => {
    const seen: string[] = [];
    const custom: Partial<CragPorts> = {
      retrieve: async ({ query }) => {
        seen.push(query);
        return { ok: true, providerCall: false, chunks: [chunk("s16")] };
      },
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: decision(chunks, "insufficient", []),
      }),
      reformulate: async ({ attempt }) => ({
        ok: true,
        providerCall: false,
        raw: { query: `consulta ${String(attempt)}` },
      }),
    };
    const first = await turn("beca 1991", custom);
    expect(first.result.terminal).toBe("refuse");
    expect(first.result.summary.retrievalCount).toBe(3);
    expect(first.result.summary.reformulationCount).toBe(2);
    expect(first.counts.generate).toBe(0);
    const second = await turn("otra pregunta", {
      ...custom,
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: decision(chunks, "sufficient", ["s16"]),
      }),
    });
    expect(second.result.summary.retrievalCount).toBe(1);
    expect(second.result.summary.reformulationCount).toBe(0);
  });

  it("termina si la reformulación no avanza y si el evaluador devuelve un id desconocido", async () => {
    const stalled = await turn("pregunta", {
      reformulate: async ({ query }) => ({ ok: true, providerCall: false, raw: { query } }),
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: decision(chunks, "insufficient", []),
      }),
    });
    expect(stalled.result.terminal).toBe("refuse");
    expect(stalled.result.summary.retrievalCount).toBe(1);
    expect(stalled.counts.generate).toBe(0);

    let ranks = 0;
    const invalid = await turn("pregunta", {
      rankAndAssess: async () => {
        ranks += 1;
        return {
          ok: true,
          providerCall: false,
          raw: {
            ranking: [{ chunkId: "no-existe", score: 1, reason: "falso" }],
            status: "sufficient",
            reason: "falso",
            gaps: [],
            usefulIds: ["no-existe"],
          },
        };
      },
    });
    expect(invalid.result.terminal).toBe("error");
    expect(ranks).toBe(1);
    expect(invalid.result.summary.calls.generation.executions).toBe(0);
    expect(invalid.result.summary.reformulationCount).toBe(0);
  });

  it("filtra otra audiencia o perfil y aclara el calendario sin llamadas", async () => {
    let seen: string[] = [];
    const filtered = await turn("memoria", {
      retrieve: async () => ({
        ok: true,
        providerCall: false,
        chunks: [
          chunk("calendario", "L/X"),
          { ...chunk("s5"), profileId: "otro-perfil" },
          chunk("s5"),
        ],
      }),
      rankAndAssess: async ({ chunks }) => {
        seen = chunks.map((item) => item.chunkId);
        return {
          ok: true,
          providerCall: false,
          raw: decision(
            chunks,
            "sufficient",
            chunks.map((item) => item.chunkId),
          ),
        };
      },
    });
    expect(seen).toEqual(["s5"]);
    expect(filtered.result.evidence.map((item) => item.chunkId)).toEqual(["s5"]);

    const clarify = await turn("¿Cuándo es la sesión de RAG avanzado?");
    expect(clarify.result.terminal).toBe("clarify");
    expect(clarify.counts).toEqual({ retrieve: 0, rank: 0, rewrite: 0, generate: 0 });
  });

  it("aplica el orden devuelto y no acepta una generación fuera de plazo", async () => {
    const ranked = await turn("orden", {
      retrieve: async () => ({
        ok: true,
        providerCall: false,
        chunks: [chunk("a"), chunk("b")],
      }),
      rankAndAssess: async () => ({
        ok: true,
        providerCall: false,
        raw: {
          ranking: [
            { chunkId: "b", score: 0.2, reason: "va delante" },
            { chunkId: "a", score: 0.9, reason: "va detrás" },
          ],
          status: "sufficient",
          reason: "las dos sirven",
          gaps: [],
          usefulIds: ["a", "b"],
        },
      }),
    });
    expect(ranked.result.evidence.map((item) => item.chunkId)).toEqual(["b", "a"]);
    expect(ranked.result.evidence.map((item) => item.score)).toEqual([0.2, 0.9]);
    expect(ranked.result.summary.retained.map((item) => item.chunkId)).toEqual(["b", "a"]);
    expect(ranked.result.steps.some((step) => step.status.includes("b 0.200"))).toBe(true);

    let retrieval = 0;
    const across = await turn("sigue", {
      retrieve: async () => {
        retrieval += 1;
        return {
          ok: true,
          providerCall: false,
          chunks: retrieval === 1 ? [chunk("a"), chunk("b")] : [chunk("c")],
        };
      },
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: chunks.some((item) => item.chunkId === "c")
          ? {
              ranking: [
                { chunkId: "c", score: 0.4, reason: "nuevo" },
                { chunkId: "b", score: 0.4, reason: "empate conservado" },
              ],
              status: "sufficient",
              reason: "cubre las dos",
              gaps: [],
              usefulIds: ["b", "c"],
            }
          : {
              ranking: [
                { chunkId: "b", score: 0.3, reason: "útil" },
                { chunkId: "a", score: 0.1, reason: "no" },
              ],
              status: "partial",
              reason: "falta c",
              gaps: ["falta c"],
              usefulIds: ["b"],
            },
      }),
      reformulate: async () => ({
        ok: true,
        providerCall: false,
        raw: { query: "busca c" },
      }),
    });
    expect(across.result.terminal).toBe("answer");
    expect(across.result.evidence.map((item) => item.chunkId)).toEqual(["c", "b"]);

    let now = 0;
    let seenRemaining = -1;
    let generations = 0;
    const late = await turn("tarde", {
      now: () => now,
      generate: async ({ remainingMs }) => {
        generations += 1;
        seenRemaining = remainingMs;
        now = 21_000;
        return { ok: true, providerCall: false, text: "tarde", usage: null, cost: null };
      },
    });
    expect(generations).toBe(1);
    expect(seenRemaining).toBe(20_000);
    expect(late.result.terminal).toBe("error");
    expect(late.result.answerText).not.toContain("tarde");
    expect(late.result.evidence).toEqual([]);
  });

  it("no sigue después de cancelar y una reserva fallida no busca", async () => {
    const signal = { aborted: true };
    const cancelled = await turn("pregunta", { signal });
    expect(cancelled.result.terminal).toBe("aborted");
    expect(cancelled.counts.retrieve).toBe(0);

    let retrievals = 0;
    const signalLater = { aborted: false };
    const interrupted = await turn("pregunta", {
      signal: signalLater,
      retrieve: async () => {
        retrievals += 1;
        signalLater.aborted = true;
        return { ok: true, providerCall: false, chunks: [chunk("s5")] };
      },
    });
    expect(retrievals).toBe(1);
    expect(interrupted.result.terminal).toBe("aborted");
    expect(interrupted.result.summary.calls.evaluation.executions).toBe(0);

    let started = 0;
    const blocked = await turn("pregunta", {
      reserve: (kind) =>
        kind === "retrieval" ? { ok: false, reason: "sin reserva" } : { ok: true },
      retrieve: async () => {
        started += 1;
        return { ok: true, providerCall: false, chunks: [] };
      },
    });
    expect(started).toBe(0);
    expect(blocked.result.terminal).toBe("error");
  });
});
