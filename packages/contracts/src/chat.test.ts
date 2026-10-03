import { describe, expect, it } from "vite-plus/test";
import { chatRequestSchema } from "./chat";
import type { CragSummary } from "./crag";

describe("historial", () => {
  it("acepta otra pregunta después de una respuesta larga válida", () => {
    const longAnswer = "a".repeat(5_000);
    const parsed = chatRequestSchema.safeParse({
      mode: "sin-rag",
      audience: "program",
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "¿Qué es un embedding?" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: longAnswer }] },
        { id: "u2", role: "user", parts: [{ type: "text", text: "¿Puedes seguir?" }] },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("acepta un seguimiento después del máximo de fuentes y del resumen de CRAG", () => {
    const summary: CragSummary = {
      runId: "run-1",
      fixture: true,
      scenarioId: "partial-s5-s6",
      measured: false,
      partial: true,
      audience: "program",
      corpusVersion: "c-test",
      profileId: "p-test",
      originalQuestion: "estado y observabilidad",
      currentQuery: "observabilidad",
      retrievalCount: 2,
      reformulationCount: 1,
      attemptsRemaining: 1,
      rewritesRemaining: 1,
      evidenceStatus: "sufficient",
      terminal: "answer",
      reason: "Guion de prueba.",
      retained: [{ chunkId: "s5", reason: "Útil.", score: 0.8 }],
      discarded: [
        { chunkId: "s16", reason: "Rechazado.", attempt: 1 },
        { chunkId: "s16", reason: "Rechazado otra vez.", attempt: 2 },
        { chunkId: "s16", reason: "Rechazado al final.", attempt: 3 },
      ],
      calls: {
        retrieval: { executions: 2, providerCalls: null, durationMs: null },
        evaluation: { executions: 2, providerCalls: null, durationMs: null },
        reformulation: { executions: 1, providerCalls: null, durationMs: null },
        generation: { executions: 1, providerCalls: null, durationMs: null },
      },
      usage: null,
      cost: null,
    };
    const sources = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => ({
      type: "data-source" as const,
      data: {
        documentId: id,
        chunkId: id,
        title: id,
        section: id,
        excerpt: "fragmento",
        corpusVersion: "c-test",
      },
    }));
    const parsed = chatRequestSchema.safeParse({
      mode: "crag",
      audience: "program",
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "estado y observabilidad" }] },
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "text", text: "Respuesta con fuentes." },
            { type: "data-crag", data: summary },
            ...sources,
          ],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "¿Puedes seguir?" }] },
      ],
    });
    expect(parsed.success).toBe(true);
    const rejected = chatRequestSchema.safeParse({
      mode: "crag",
      messages: [
        {
          id: "a1",
          role: "assistant",
          parts: [
            { type: "text", text: "hola" },
            {
              type: "data-step",
              data: {
                runId: "run-1",
                kind: "retrieve",
                retrieval: 1,
                reformulation: 0,
                query: "hola",
                status: "paso",
                evidenceStatus: null,
                retainedIds: [],
                discardedIds: [],
              },
            },
          ],
        },
        { id: "u2", role: "user", parts: [{ type: "text", text: "sigue" }] },
      ],
    });
    expect(rejected.success).toBe(false);
  });

  it("rechaza un mensaje de usuario por encima del límite", () => {
    const parsed = chatRequestSchema.safeParse({
      mode: "sin-rag",
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "a".repeat(2_001) }] }],
    });
    expect(parsed.success).toBe(false);
  });
});
