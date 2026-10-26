// GUÍA DE LECTURA · apps/api/src/research-excerpts.test.ts
// Pruebas de los extractos: los bloques son tramos literales del texto, y la evaluación y la síntesis
// del modelo solo pueden elegir índices; nunca se copia texto escrito por el modelo.
// Modelo simulado del AI SDK para pruebas.
import { MockLanguageModelV4 } from "ai/test";
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Extractos de un texto.
import { excerptChoices } from "./research-excerpts";
// Puerto del modelo de la investigación.
import { createResearchModelPort } from "./research-real";

// Texto de prueba con una negación y dos cifras.
const text =
  "No se puede devolver por desistimiento. El plazo general es de 30 días y el de la electrónica abierta es de 14.";
// Evidencia mostrada al modelo.
const evidence = [{ sourceId: "web-test", kind: "web" as const, title: "Devoluciones", text }];
// Contexto de una llamada.
const call = { signal: new AbortController().signal, timeoutMs: 5000 };

// Crea un puerto con un modelo simulado que responde con el JSON dado.
function modelFor(value: unknown) {
  // Llamadas al modelo.
  let calls = 0;
  // Tope de salida que recibió el modelo.
  let outputCap: number | undefined;
  // Modelo simulado.
  const model = new MockLanguageModelV4({
    // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
    doGenerate: async (options) => {
      // Guarda el tope.
      outputCap = options.maxOutputTokens;
      // Cuenta la llamada.
      calls += 1;
      // Respuesta fija con uso de tokens.
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
  // Puerto y accesos a los contadores.
  return {
    port: createResearchModelPort({ planner: model, generator: model, maxOutputTokens: 1800 }),
    // Doble de prueba: expone las llamadas observadas para verificar el número de inferencias de la prueba.
    calls: () => calls,
    // Doble de prueba: expone el límite de salida solicitado al modelo para comprobar que esté acotado.
    outputCap: () => outputCap,
  };
}

// Grupo de pruebas de la selección de extractos.
describe("selección de extractos del proveedor real", () => {
  // Los bloques largos se dividen en frases literales sin cortar negaciones.
  it("los bloques largos conservan tramos literales, números y negaciones", () => {
    // Fuente larga con relleno.
    const source = `${text} ${"A".repeat(1100)} ${text.repeat(20)}`;
    // Extractos.
    const choices = excerptChoices(source);
    // Hay varios.
    expect(choices.length).toBeGreaterThan(3);
    // Cada uno.
    for (const choice of choices) {
      // Dentro del tope.
      expect(choice.length).toBeLessThanOrEqual(500);
      // Literal en la fuente.
      expect(source).toContain(choice);
    }
    // El texto original aparece entre ellos.
    expect(choices.join(" ")).toContain(text);
    // Una frase demasiado larga no se corta.
    expect(excerptChoices(`No ${"dato ".repeat(200)}se puede cambiar.`)).toEqual([]);
  });

  // Para cada índice, la evaluación copia el extracto exacto o falla.
  it.each([0, 1, 999])(
    "la evaluación resuelve el índice %i sin usar texto del modelo",
    async (index) => {
      // Modelo que acepta con el índice y además intenta escribir texto propio.
      const mock = modelFor({
        items: [
          {
            sourceId: "web-test",
            decision: "accept",
            subquestionIds: ["q1"],
            excerptIds: [index],
            reason: "Plazos documentados.",
            excerpts: ["Se puede devolver en 14 días."],
          },
        ],
        coverage: [{ subquestionId: "q1", status: "covered", gap: null, followUp: false }],
        contradictions: [],
      });
      // Evaluación.
      const result = await mock.port.assess(
        { question: "Plazos", subquestions: [], evidence, priorCoverage: [], round: 1 },
        call,
      );
      // Una llamada.
      expect(mock.calls()).toBe(1);
      // Con el tope esperado.
      expect(mock.outputCap()).toBe(1800);
      // Extracto que corresponde al índice, o ninguno.
      const selected = [
        "No se puede devolver por desistimiento.",
        "El plazo general es de 30 días y el de la electrónica abierta es de 14.",
      ][index];
      // Resultado esperado.
      const expected = selected
        ? { ok: true, value: { items: [{ excerpts: [selected] }] } }
        : { ok: false, error: "invalid" };
      // Coincide.
      expect(result).toMatchObject(expected);
      // El texto inventado no aparece.
      expect(JSON.stringify(result)).not.toContain("Se puede devolver en 14 días.");
      // Consumo estimado con los tokens.
      expect(result.consumption).toMatchObject({ kind: "estimated", inputTokens: 10 });
    },
  );

  // La síntesis solo copia fuentes admitidas.
  it.each(["web-test", "unknown-source"])(
    "la síntesis copia exclusivamente la fuente %s admitida",
    async (sourceId) => {
      // Referencia al primer extracto.
      const reference = { sourceId, excerptIndex: 0 };
      // Modelo que referencia y además escribe una respuesta propia.
      const mock = modelFor({
        answerRefs: [reference],
        findings: [{ subquestionId: "q1", reference }],
        checks: [reference],
        unresolved: [],
        answer: { text: "El plazo general es de 14 días y el de la electrónica abierta es de 30." },
      });
      // Síntesis.
      const result = await mock.port.synthesize(
        {
          question: "Plazos",
          subquestions: [],
          coverage: [],
          contradictions: [],
          evidence: [{ ...evidence[0]!, subquestionIds: ["q1"], excerpts: [text] }],
        },
        call,
      );
      // Una llamada.
      expect(mock.calls()).toBe(1);
      // Con el tope esperado.
      expect(mock.outputCap()).toBe(1800);
      // Fuente admitida: texto exacto; desconocida: inválida.
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
      // Coincide.
      expect(result).toMatchObject(expected);
      // El texto inventado no aparece.
      expect(JSON.stringify(result)).not.toContain(
        "El plazo general es de 14 días y el de la electrónica abierta es de 30.",
      );
    },
  );
});
