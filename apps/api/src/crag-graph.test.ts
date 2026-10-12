// GUÍA DE LECTURA · apps/api/src/crag-graph.test.ts
// Pruebas del grafo CRAG con puertos simulados: respuesta directa, evidencia parcial, contexto rechazado,
// límites de intentos, ids inventados, filtros de audiencia, orden, plazo, cancelación y reservas.
// Tipos del grafo CRAG.
import type { CragChunk, CragPorts, CragScope } from "@thepower-rag/core";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Grafo que se prueba.
import { runCragTurn } from "./crag-graph";

// Ámbito fijo de las pruebas.
const scope: CragScope = {
  runId: "run-test",
  audience: "program",
  corpusVersion: "c-test",
  profileId: "p-test",
  embeddingLabel: "prueba",
};

// Fragmento de prueba con un id y una audiencia.
function chunk(id: string, audience: CragChunk["audience"] = "program"): CragChunk {
  // Campos mínimos de un fragmento.
  return {
    // Mismo id de documento y de fragmento, para que sea fácil leer las aserciones.
    documentId: id,
    chunkId: id,
    title: id,
    section: "S",
    text: `texto ${id}`,
    // Grupo, corpus y perfil que el grafo exige que coincidan.
    audience,
    corpusVersion: "c-test",
    profileId: "p-test",
    // Puntuación neutra.
    score: 0.5,
  };
}

// Decisión del evaluador con todos los fragmentos en el ranking.
function decision(
  chunks: readonly CragChunk[],
  status: "sufficient" | "partial" | "insufficient",
  usefulIds: string[],
  gaps: string[] = [],
): unknown {
  // Objeto con ranking, estado, motivo, lagunas e ids útiles.
  return {
    // Orden con la puntuación de cada candidato.
    ranking: chunks.map((item) => ({
      chunkId: item.chunkId,
      score: item.score ?? 0,
      reason: `motivo ${item.chunkId}`,
    })),
    // Estado de la evaluación, motivo, lagunas e ids útiles.
    status,
    reason: status === "partial" ? "falta una parte" : `decision ${status}`,
    gaps,
    usefulIds,
  };
}

// Puertos simulados que cuentan cada llamada; se pueden sustituir por partes.
function ports(overrides: Partial<CragPorts> = {}): CragPorts & {
  // Contadores por tipo de llamada.
  counts: { retrieve: number; rank: number; rewrite: number; generate: number };
} {
  // Contadores a cero.
  const counts = { retrieve: 0, rank: 0, rewrite: 0, generate: 0 };
  // Señal indicada o no cancelada.
  const signal = overrides.signal ?? { aborted: false };
  // Puertos con los métodos por defecto o los indicados.
  return {
    counts,
    measured: false,
    now: overrides.now ?? (() => 0),
    signal,
    reserve: overrides.reserve ?? (() => ({ ok: true })),
    retrieve:
      overrides.retrieve ??
      (async () => {
        // Cuenta.
        counts.retrieve += 1;
        // Siempre devuelve el fragmento s5.
        return { ok: true, providerCall: false, chunks: [chunk("s5")] };
      }),
    rankAndAssess:
      overrides.rankAndAssess ??
      (async ({ chunks }) => {
        // Cuenta.
        counts.rank += 1;
        // Todo suficiente y útil.
        return {
          // providerCall: false, es un doble de prueba.
          ok: true,
          providerCall: false,
          // Todos los candidatos suficientes y útiles.
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
        // Cuenta.
        counts.rewrite += 1;
        // Nueva consulta fija.
        return { ok: true, providerCall: false, raw: { query: "consulta nueva" } };
      }),
    generate:
      overrides.generate ??
      (async ({ evidence }) => {
        // Cuenta.
        counts.generate += 1;
        // Texto que cita toda la evidencia.
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

// Ejecuta un turno con puertos simulados y devuelve resultado y contadores.
async function turn(question: string, custom: Partial<CragPorts> = {}, audience = scope.audience) {
  // Puertos de este turno.
  const used = ports(custom);
  // Turno del grafo.
  const result = await runCragTurn({
    question,
    scope: { ...scope, audience },
    ports: used,
    fixture: true,
    scenarioId: null,
  });
  // Resultado y contadores.
  return { result, counts: used.counts };
}

// Grupo de pruebas del grafo CRAG.
describe("grafo CRAG", () => {
  // Basta con la primera búsqueda.
  it("responde en la primera búsqueda sin reformular", async () => {
    // Turno.
    const { result, counts } = await turn("estado y nodos");
    // Responde.
    expect(result.terminal).toBe("answer");
    // Una búsqueda.
    expect(result.summary.retrievalCount).toBe(1);
    // Sin reformular.
    expect(result.summary.reformulationCount).toBe(0);
    // Una llamada de cada tipo salvo reformular.
    expect(counts).toEqual({ retrieve: 1, rank: 1, rewrite: 0, generate: 1 });
    // Evidencia s5.
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["s5"]);
    // Sin llamadas medidas.
    expect(result.summary.calls.generation.providerCalls).toBeNull();
    // Datos de prueba: marcado como parcial.
    expect(result.summary.partial).toBe(true);
  });

  // Evidencia parcial que se completa en la segunda búsqueda.
  it("conserva la evidencia parcial, deduplica y responde con las dos fuentes", async () => {
    // Número de búsqueda.
    let retrieval = 0;
    // Turno con puertos propios.
    const { result } = await turn("estado y observabilidad", {
      retrieve: async () => {
        // Cuenta.
        retrieval += 1;
        // Primero s5; después s5 y s6.
        return {
          // La primera búsqueda solo trae s5; la segunda, s5 y s6.
          ok: true,
          providerCall: false,
          chunks: retrieval === 1 ? [chunk("s5")] : [chunk("s5"), chunk("s6")],
        };
      },
      // Con s6 la evidencia basta; sin s6 es parcial y nombra la laguna.
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: chunks.some((item) => item.chunkId === "s6")
          ? decision(chunks, "sufficient", ["s5", "s6"])
          : decision(chunks, "partial", ["s5"], ["falta observar la ejecución"]),
      }),
      // Reformulación fija para la segunda búsqueda.
      reformulate: async () => ({
        ok: true,
        providerCall: false,
        raw: { query: "observabilidad del agente" },
      }),
    });
    // Responde.
    expect(result.terminal).toBe("answer");
    // Dos búsquedas.
    expect(result.summary.retrievalCount).toBe(2);
    // Una reformulación.
    expect(result.summary.reformulationCount).toBe(1);
    // s5 y s6 sin duplicar.
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["s5", "s6"]);
    // Conserva la pregunta original.
    expect(result.summary.originalQuestion).toBe("estado y observabilidad");
    // Y la consulta actual.
    expect(result.summary.currentQuery).toBe("observabilidad del agente");
  });

  // Un fragmento rechazado no se cita.
  it("no cita el contexto rechazado", async () => {
    // Número de búsqueda.
    let retrieval = 0;
    // Turno.
    const { result } = await turn("observabilidad", {
      retrieve: async () => {
        // Cuenta.
        retrieval += 1;
        // Primero s16, después s6.
        return {
          // Primero un fragmento inútil (s16) y después el útil (s6).
          ok: true,
          providerCall: false,
          chunks: retrieval === 1 ? [chunk("s16")] : [chunk("s6")],
        };
      },
      // s16 es insuficiente: el grafo debe descartar ese contexto.
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: chunks.some((item) => item.chunkId === "s6")
          ? decision(chunks, "sufficient", ["s6"])
          : decision(chunks, "insufficient", []),
      }),
      // Reformulación hacia herramientas de observabilidad.
      reformulate: async () => ({
        ok: true,
        providerCall: false,
        raw: { query: "langfuse langsmith" },
      }),
    });
    // Cita s6.
    expect(result.answerText).toContain("[cite:s6]");
    // No cita s16.
    expect(result.answerText).not.toContain("s16");
    // Evidencia s6.
    expect(result.evidence.map((item) => item.chunkId)).toEqual(["s6"]);
    // s16 figura como descartado.
    expect(result.summary.discarded.some((item) => item.chunkId === "s16")).toBe(true);
  });

  // Tres búsquedas y dos reformulaciones como máximo; el turno siguiente empieza de cero.
  it("se detiene a los tres intentos y dos reformulaciones, y el siguiente turno empieza de cero", async () => {
    // Consultas vistas.
    const seen: string[] = [];
    // Puertos que nunca encuentran evidencia.
    const custom: Partial<CragPorts> = {
      retrieve: async ({ query }) => {
        // Guarda la consulta.
        seen.push(query);
        // Siempre s16.
        // La búsqueda siempre devuelve s16…
        return { ok: true, providerCall: false, chunks: [chunk("s16")] };
      },
      // …que nunca basta, así que el grafo agota los intentos.
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: decision(chunks, "insufficient", []),
      }),
      // Cada reformulación es distinta para que no se detecte como repetida.
      reformulate: async ({ attempt }) => ({
        ok: true,
        providerCall: false,
        raw: { query: `consulta ${String(attempt)}` },
      }),
    };
    // Primer turno.
    const first = await turn("beca 1991", custom);
    // Rechaza.
    expect(first.result.terminal).toBe("refuse");
    // Tres búsquedas.
    expect(first.result.summary.retrievalCount).toBe(3);
    // Dos reformulaciones.
    expect(first.result.summary.reformulationCount).toBe(2);
    // Sin generar.
    expect(first.counts.generate).toBe(0);
    // Segundo turno con evidencia suficiente.
    const second = await turn("otra pregunta", {
      ...custom,
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: decision(chunks, "sufficient", ["s16"]),
      }),
    });
    // Una búsqueda.
    expect(second.result.summary.retrievalCount).toBe(1);
    // Sin reformular.
    expect(second.result.summary.reformulationCount).toBe(0);
  });

  // Reformulación repetida o id desconocido terminan el turno.
  it("termina si la reformulación no avanza y si el evaluador devuelve un id desconocido", async () => {
    // La reformulación devuelve la misma consulta.
    const stalled = await turn("pregunta", {
      reformulate: async ({ query }) => ({ ok: true, providerCall: false, raw: { query } }),
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: decision(chunks, "insufficient", []),
      }),
    });
    // Rechaza.
    expect(stalled.result.terminal).toBe("refuse");
    // Una búsqueda.
    expect(stalled.result.summary.retrievalCount).toBe(1);
    // Sin generar.
    expect(stalled.counts.generate).toBe(0);

    // Evaluaciones.
    let ranks = 0;
    // Evaluador que inventa un id.
    const invalid = await turn("pregunta", {
      rankAndAssess: async () => {
        // Cuenta.
        ranks += 1;
        // Ranking con un id que no existe.
        return {
          // Salida «suficiente» pero con un id que no estaba entre los candidatos.
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
    // Error.
    expect(invalid.result.terminal).toBe("error");
    // Una evaluación.
    expect(ranks).toBe(1);
    // Sin generar.
    expect(invalid.result.summary.calls.generation.executions).toBe(0);
    // Sin reformular.
    expect(invalid.result.summary.reformulationCount).toBe(0);
  });

  // Filtra audiencia y perfil; la pregunta de calendario pide aclaración sin llamadas.
  it("filtra otra audiencia o perfil y aclara el calendario sin llamadas", async () => {
    // Ids que llegan al evaluador.
    let seen: string[] = [];
    // Búsqueda que mezcla otra audiencia y otro perfil.
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
        // Guarda los ids.
        seen = chunks.map((item) => item.chunkId);
        // Todo suficiente.
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
    // Solo s5 llega al evaluador.
    expect(seen).toEqual(["s5"]);
    // Solo s5 queda como evidencia.
    expect(filtered.result.evidence.map((item) => item.chunkId)).toEqual(["s5"]);

    // Pregunta de calendario sin grupo.
    const clarify = await turn("¿Cuándo es la sesión de RAG avanzado?");
    // Pide aclaración.
    expect(clarify.result.terminal).toBe("clarify");
    // Sin llamadas.
    expect(clarify.counts).toEqual({ retrieve: 0, rank: 0, rewrite: 0, generate: 0 });
  });

  // Respeta el orden del evaluador y descarta una generación fuera de plazo.
  it("aplica el orden devuelto y no acepta una generación fuera de plazo", async () => {
    // Evaluador que pone b delante de a.
    const ranked = await turn("orden", {
      // Búsqueda con dos candidatos a y b.
      retrieve: async () => ({
        ok: true,
        providerCall: false,
        chunks: [chunk("a"), chunk("b")],
      }),
      // El evaluador pide b antes que a aunque a puntúe más: manda el orden devuelto.
      rankAndAssess: async () => ({
        ok: true,
        providerCall: false,
        raw: {
          // b con menos puntuación va primero.
          ranking: [
            { chunkId: "b", score: 0.2, reason: "va delante" },
            { chunkId: "a", score: 0.9, reason: "va detrás" },
          ],
          // Suficiente y las dos útiles.
          status: "sufficient",
          reason: "las dos sirven",
          gaps: [],
          usefulIds: ["a", "b"],
        },
      }),
    });
    // Orden b, a.
    expect(ranked.result.evidence.map((item) => item.chunkId)).toEqual(["b", "a"]);
    // Puntuaciones del evaluador.
    expect(ranked.result.evidence.map((item) => item.score)).toEqual([0.2, 0.9]);
    // Retenidos en ese orden.
    expect(ranked.result.summary.retained.map((item) => item.chunkId)).toEqual(["b", "a"]);
    // El paso muestra b con su puntuación.
    expect(ranked.result.steps.some((step) => step.status.includes("b 0.200"))).toBe(true);

    // Número de búsqueda.
    let retrieval = 0;
    // Evidencia que se completa entre búsquedas.
    const across = await turn("sigue", {
      retrieve: async () => {
        // Cuenta.
        retrieval += 1;
        // Primero a y b; después c.
        return {
          // Primera búsqueda: a y b. Segunda: c.
          ok: true,
          providerCall: false,
          chunks: retrieval === 1 ? [chunk("a"), chunk("b")] : [chunk("c")],
        };
      },
      // Con c: suficiente, y el empate entre c y b se resuelve por la posición devuelta.
      rankAndAssess: async ({ chunks }) => ({
        ok: true,
        providerCall: false,
        raw: chunks.some((item) => item.chunkId === "c")
          ? {
              // c y b empatan a 0,4: se conserva el orden devuelto.
              ranking: [
                { chunkId: "c", score: 0.4, reason: "nuevo" },
                { chunkId: "b", score: 0.4, reason: "empate conservado" },
              ],
              // Suficiente con b y c.
              status: "sufficient",
              reason: "cubre las dos",
              gaps: [],
              usefulIds: ["b", "c"],
            }
          : // Sin c: parcial, conserva b y nombra la laguna.
            {
              // b útil y a no.
              ranking: [
                { chunkId: "b", score: 0.3, reason: "útil" },
                { chunkId: "a", score: 0.1, reason: "no" },
              ],
              // Parcial con la laguna «falta c».
              status: "partial",
              reason: "falta c",
              gaps: ["falta c"],
              usefulIds: ["b"],
            },
      }),
      // Reformulación hacia c.
      reformulate: async () => ({
        ok: true,
        providerCall: false,
        raw: { query: "busca c" },
      }),
    });
    // Responde.
    expect(across.result.terminal).toBe("answer");
    // c y b en el orden del evaluador.
    expect(across.result.evidence.map((item) => item.chunkId)).toEqual(["c", "b"]);

    // Reloj simulado.
    let now = 0;
    // Tiempo restante visto por la generación.
    let seenRemaining = -1;
    // Generaciones.
    let generations = 0;
    // Generación que tarda más del plazo.
    const late = await turn("tarde", {
      now: () => now,
      generate: async ({ remainingMs }) => {
        // Cuenta.
        generations += 1;
        // Guarda el tiempo restante.
        seenRemaining = remainingMs;
        // Avanza el reloj a 21 s.
        now = 21_000;
        // Texto tardío.
        return { ok: true, providerCall: false, text: "tarde", usage: null, cost: null };
      },
    });
    // Una generación.
    expect(generations).toBe(1);
    // Tenía 20 s.
    expect(seenRemaining).toBe(20_000);
    // Error por plazo.
    expect(late.result.terminal).toBe("error");
    // No muestra el texto tardío.
    expect(late.result.answerText).not.toContain("tarde");
    // Sin evidencia.
    expect(late.result.evidence).toEqual([]);
  });

  // Cancelación y reserva fallida.
  it("no sigue después de cancelar y una reserva fallida no busca", async () => {
    // Señal ya cancelada.
    const signal = { aborted: true };
    // Turno cancelado.
    const cancelled = await turn("pregunta", { signal });
    // aborted.
    expect(cancelled.result.terminal).toBe("aborted");
    // Sin búsquedas.
    expect(cancelled.counts.retrieve).toBe(0);

    // Búsquedas.
    let retrievals = 0;
    // Señal que se cancela durante la búsqueda.
    const signalLater = { aborted: false };
    // Turno.
    const interrupted = await turn("pregunta", {
      signal: signalLater,
      retrieve: async () => {
        // Cuenta.
        retrievals += 1;
        // Cancela.
        signalLater.aborted = true;
        // Fragmento.
        return { ok: true, providerCall: false, chunks: [chunk("s5")] };
      },
    });
    // Una búsqueda.
    expect(retrievals).toBe(1);
    // aborted.
    expect(interrupted.result.terminal).toBe("aborted");
    // Sin evaluar.
    expect(interrupted.result.summary.calls.evaluation.executions).toBe(0);

    // Búsquedas iniciadas.
    let started = 0;
    // Reserva de búsqueda rechazada.
    const blocked = await turn("pregunta", {
      reserve: (kind) =>
        kind === "retrieval" ? { ok: false, reason: "sin reserva" } : { ok: true },
      retrieve: async () => {
        // Cuenta.
        started += 1;
        // Sin fragmentos.
        return { ok: true, providerCall: false, chunks: [] };
      },
    });
    // No busca.
    expect(started).toBe(0);
    // Error.
    expect(blocked.result.terminal).toBe("error");
  });
});
