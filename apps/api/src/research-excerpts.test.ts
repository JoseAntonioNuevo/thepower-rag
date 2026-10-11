import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { excerptChoices } from "./research-excerpts";
import { createResearchModelPort } from "./research-real";

const text = "No se puede cambiar la dimensión. El índice espera 1024 y el vector contiene 768.";
const evidence = [{ sourceId: "web-test", kind: "web" as const, title: "Vectorize", text }];
const call = { signal: new AbortController().signal, timeoutMs: 5000 };

function modelFor(value: unknown) {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      return {
        content: [{ type: "text", text: JSON.stringify(value) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 20, text: 20, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return {
    port: createResearchModelPort({ planner: model, generator: model }),
    calls: () => calls,
  };
}

describe("selección de extractos del proveedor real", () => {
  it("los bloques largos conservan tramos literales, números y negaciones", () => {
    const source = `${text} ${"A".repeat(1100)} ${text.repeat(20)}`;
    const choices = excerptChoices(source);
    expect(choices.length).toBeGreaterThan(3);
    for (const choice of choices) {
      expect(choice.length).toBeLessThanOrEqual(500);
      expect(source).toContain(choice);
    }
    expect(choices.join(" ")).toContain(text);
    expect(excerptChoices(`No ${"dato ".repeat(200)}se puede cambiar.`)).toEqual([]);
  });

  it.each([0, 1, 999])(
    "la evaluación resuelve el índice %i sin usar texto del modelo",
    async (index) => {
      const mock = modelFor({
        items: [
          {
            sourceId: "web-test",
            decision: "accept",
            subquestionIds: ["q1"],
            excerptIds: [index],
            reason: "Dimensiones documentadas.",
            excerpts: ["Se puede cambiar a 768."],
          },
        ],
        coverage: [{ subquestionId: "q1", status: "covered", gap: null, followUp: false }],
        contradictions: [],
      });
      const result = await mock.port.assess(
        { question: "Dimensiones", subquestions: [], evidence, priorCoverage: [], round: 1 },
        call,
      );
      expect(mock.calls()).toBe(1);
      const selected = [
        "No se puede cambiar la dimensión.",
        "El índice espera 1024 y el vector contiene 768.",
      ][index];
      const expected = selected
        ? { ok: true, value: { items: [{ excerpts: [selected] }] } }
        : { ok: false, error: "invalid" };
      expect(result).toMatchObject(expected);
      expect(JSON.stringify(result)).not.toContain("Se puede cambiar a 768.");
      expect(result.consumption).toMatchObject({ kind: "estimated", inputTokens: 10 });
    },
  );

  it.each(["web-test", "unknown-source"])(
    "la síntesis copia exclusivamente la fuente %s admitida",
    async (sourceId) => {
      const reference = { sourceId, excerptIndex: 0 };
      const mock = modelFor({
        answerRefs: [reference],
        findings: [{ subquestionId: "q1", reference }],
        checks: [reference],
        unresolved: [],
        answer: { text: "El índice espera 768 y el vector contiene 1024." },
      });
      const result = await mock.port.synthesize(
        {
          question: "Dimensiones",
          subquestions: [],
          coverage: [],
          contradictions: [],
          evidence: [{ ...evidence[0]!, subquestionIds: ["q1"], excerpts: [text] }],
        },
        call,
      );
      expect(mock.calls()).toBe(1);
      const expected =
        sourceId === "web-test"
          ? {
              ok: true,
              value: {
                answer: { text, sourceIds: [sourceId] },
                findings: [{ text }],
                checks: [{ text }],
              },
            }
          : { ok: false, error: "invalid" };
      expect(result).toMatchObject(expected);
      expect(JSON.stringify(result)).not.toContain(
        "El índice espera 768 y el vector contiene 1024.",
      );
    },
  );
});
