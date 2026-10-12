// GUÍA DE LECTURA · packages/contracts/src/chat.test.ts
// Pruebas del contrato de chat: historial con respuestas largas, seguimiento tras CRAG y límite
// de longitud del mensaje del alumno. No llaman a la red.
// describe agrupa pruebas, it define una y expect comprueba un resultado.
import { describe, expect, it } from "vite-plus/test";
// Esquema de la petición que se pone a prueba.
import { chatRequestSchema } from "./chat";
// Tipo del resumen de CRAG para construir un ejemplo válido.
import type { CragSummary } from "./crag";

// Grupo de pruebas sobre el historial.
describe("historial", () => {
  // Una respuesta larga del asistente no impide seguir preguntando.
  it("acepta otra pregunta después de una respuesta larga válida", () => {
    // Respuesta de 5.000 caracteres, por debajo del tope del asistente.
    const longAnswer = "a".repeat(5_000);
    // safeParse valida sin lanzar error: devuelve success y los datos o el error.
    const parsed = chatRequestSchema.safeParse({
      mode: "sin-rag",
      audience: "program",
      messages: [
        { id: "u1", role: "user", parts: [{ type: "text", text: "¿Qué es un embedding?" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: longAnswer }] },
        { id: "u2", role: "user", parts: [{ type: "text", text: "¿Puedes seguir?" }] },
      ],
    });
    // La petición es válida.
    expect(parsed.success).toBe(true);
  });

  // Un mensaje del asistente con resumen de CRAG y seis fuentes sigue siendo historial válido.
  it("acepta un seguimiento después del máximo de fuentes y del resumen de CRAG", () => {
    // Resumen de CRAG de prueba con todos los campos obligatorios.
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
    // Seis citas, el máximo que muestra CRAG.
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
    // Historial con la respuesta de CRAG y una nueva pregunta.
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
    // Se acepta.
    expect(parsed.success).toBe(true);
    // Una parte data-step no está en el contrato del historial: debe rechazarse.
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
    // Se rechaza.
    expect(rejected.success).toBe(false);
  });

  // Un mensaje del alumno de 2.001 caracteres supera el límite.
  it("rechaza un mensaje de usuario por encima del límite", () => {
    // Petición con ese mensaje.
    const parsed = chatRequestSchema.safeParse({
      mode: "sin-rag",
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "a".repeat(2_001) }] }],
    });
    // Se rechaza.
    expect(parsed.success).toBe(false);
  });
});
