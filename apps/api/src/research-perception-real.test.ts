// GUÍA DE LECTURA · apps/api/src/research-perception-real.test.ts
// Pruebas de visión, transcripción y voz con dobles: topes de bytes, una sola llamada, consumo estimado
// o desconocido, JSON inválido y resumen con la estimación.
// Límites de medios.
import { MEDIA_LIMITS } from "@thepower-rag/contracts";
// Modelo simulado del AI SDK.
import { MockLanguageModelV4 } from "ai/test";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Lee archivos de ejemplo.
import { readFixtureBytes } from "./fixture-bytes";
// Texto de procedencia de la estimación.
import { TOKEN_ESTIMATE_PROVENANCE } from "./provider-cost";
// Utilidades de percepción.
import {
  auraInput,
  bytesFromAiOutput,
  parseWhisper,
  visionUserPrompt,
  whisperInput,
} from "./research-perception";
// Adaptadores reales de medios.
import {
  visionImage,
  parseVisionJson,
  workersSpeech,
  workersTranscript,
} from "./research-perception-real";
// Suma de consumo y libro vacío.
import { addConsumption, emptyLedger } from "./research-state";
// Liquidación de un consumo.
import { settlementOf } from "./research-store";
// Resumen público.
import { researchSummary } from "./research-summary";
// Estado inicial del grafo.
import { initialResearchState } from "./research-graph";
// Esquema del resumen.
import { researchSummarySchema } from "@thepower-rag/contracts";

// Bytes de la imagen del aula.
const imageBytes = async () => readFixtureBytes("dimension-mismatch.png");

// Consumo simulado en el formato del proveedor.
function usage(input: number | undefined, output: number | undefined) {
  // Tokens de entrada y salida.
  return {
    // Formato de consumo del AI SDK: tokens de entrada (con y sin caché)…
    inputTokens: {
      total: input,
      noCache: input,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    // …y de salida (texto y razonamiento).
    outputTokens: {
      total: output,
      text: output,
      reasoning: undefined,
    },
    raw: undefined,
  };
}

// Grupo de pruebas de medios.
describe("adaptadores reales de medios con dobles", () => {
  // Formas de salida de voz que debe aceptar bytesFromAiOutput.
  const outputCases: [string, (size: number) => unknown][] = [
    ["Uint8Array", (size) => new Uint8Array(size)],
    ["ArrayBuffer", (size) => new ArrayBuffer(size)],
    ["base64", (size) => btoa("a".repeat(size))],
    [
      "arrayBuffer()",
      (size) => ({
        // Doble de prueba: entrega los bytes del recurso con el contrato binario que espera el consumidor.
        arrayBuffer: async () => new ArrayBuffer(size),
      }),
    ],
    [
      "ReadableStream",
      (size) =>
        new ReadableStream({
          // Doble de prueba: inicializa la fuente del stream y encola los datos definidos por este adaptador.
          start(controller) {
            // Encola los bytes.
            controller.enqueue(new Uint8Array(size));
            // Cierra.
            controller.close();
          },
        }),
    ],
    ["Response", (size) => new Response(new Uint8Array(size))],
  ];

  // Cada forma respeta el tope de audio.
  it.each(outputCases)("aplica el tope de voz a %s", async (_name, makeOutput) => {
    // En el tope: acepta.
    expect((await bytesFromAiOutput(makeOutput(MEDIA_LIMITS.maxAudioBytes)))?.byteLength).toBe(
      MEDIA_LIMITS.maxAudioBytes,
    );
    // Un byte más: null.
    expect(await bytesFromAiOutput(makeOutput(MEDIA_LIMITS.maxAudioBytes + 1))).toBeNull();
  });

  // Prefiere el cuerpo acotado y rechaza base64 inválido.
  it("lee el cuerpo acotado antes del método arrayBuffer y rechaza base64 inválido", async () => {
    // Lecturas sin tope.
    let unboundedReads = 0;
    // Objeto con body y arrayBuffer.
    const output = {
      body: new ReadableStream({
        // Doble de prueba: inicializa la fuente del stream y encola los datos definidos por este adaptador.
        start(controller) {
          // 64 bytes.
          controller.enqueue(new Uint8Array(64));
          // Cierra.
          controller.close();
        },
      }),
      // Doble de prueba: entrega los bytes del recurso con el contrato binario que espera el consumidor.
      arrayBuffer: async () => {
        // Cuenta.
        unboundedReads += 1;
        // Demasiado grande.
        return new ArrayBuffer(MEDIA_LIMITS.maxAudioBytes + 1);
      },
    };
    // Lee el cuerpo.
    expect((await bytesFromAiOutput(output))?.byteLength).toBe(64);
    // Sin usar arrayBuffer.
    expect(unboundedReads).toBe(0);
    // Base64 inválido.
    expect(await bytesFromAiOutput("invalid-base64!")).toBeNull();
  });

  // Una llamada de visión con consumo estimado.
  it("pide la imagen a Anthropic una sola vez y estima el USD con los tokens", async () => {
    // Imagen.
    const bytes = await imageBytes();
    // Contador.
    let calls = 0;
    // Modelo que devuelve el JSON esperado.
    const model = new MockLanguageModelV4({
      // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
      doGenerate: async () => {
        // Cuenta.
        calls += 1;
        // Respuesta con consumo.
        return {
          // Respuesta simulada del modelo de visión: JSON con el texto leído.
          content: [
            {
              type: "text",
              text: JSON.stringify({
                observedText: "expected 1024, got 768",
                notes: "contraste",
                uncertain: false,
              }),
            },
          ],
          // Fin normal y consumo de 1000 tokens de entrada y 100 de salida.
          finishReason: { unified: "stop", raw: undefined },
          usage: usage(1000, 100),
          warnings: [],
        };
      },
    });
    // Lee la imagen.
    const result = await visionImage(model, bytes, "image/png", new AbortController().signal);
    // Una llamada.
    expect(calls).toBe(1);
    // Correcto.
    expect(result.ok).toBe(true);
    // (1.000 × 0,1 + 100 × 0,5) / 1.000.000 = 0,00015 USD.
    expect(result.consumption).toMatchObject({
      kind: "estimated",
      usd: 0.00015,
      complete: true,
      inputTokens: 1000,
      outputTokens: 100,
      provenance: TOKEN_ESTIMATE_PROVENANCE,
    });
    // Prompt enviado con los bytes resumidos.
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt, (_key, value) =>
      value instanceof Uint8Array ? `bytes:${String(value.byteLength)}:${String(value[0])}` : value,
    );
    // Tipo de imagen.
    expect(prompt).toContain("image/png");
    // Con bytes.
    expect(prompt).toContain("bytes:");
    // Con la petición de visión.
    expect(prompt).toContain(visionUserPrompt().slice(0, 24));
    // Una llamada.
    expect(model.doGenerateCalls).toHaveLength(1);
    // Tope de salida de visión.
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(MEDIA_LIMITS.visionOutputTokens);
  });

  // Fallo o cancelación: sin reintentos y cargo desconocido.
  it("no reintenta y deja el cargo desconocido si la visión falla o se aborta", async () => {
    // Imagen.
    const bytes = await imageBytes();
    // Contador.
    let calls = 0;
    // Modelo que falla.
    const failing = new MockLanguageModelV4({
      // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
      doGenerate: async () => {
        // Cuenta.
        calls += 1;
        // Error.
        throw new Error("provider down");
      },
    });
    // Lee.
    const failed = await visionImage(failing, bytes, "image/png", new AbortController().signal);
    // Una llamada.
    expect(calls).toBe(1);
    // Error de proveedor.
    expect(failed).toMatchObject({
      ok: false,
      error: "provider",
      consumption: { kind: "unknown" },
    });
    // Controlador.
    const controller = new AbortController();
    // Modelo que cancela y falla.
    const aborting = new MockLanguageModelV4({
      // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
      doGenerate: async () => {
        // Cuenta.
        calls += 1;
        // Cancela.
        controller.abort();
        // Error.
        throw new Error("aborted");
      },
    });
    // Lee.
    const aborted = await visionImage(aborting, bytes, "image/png", controller.signal);
    // Dos llamadas en total.
    expect(calls).toBe(2);
    // aborted.
    expect(aborted).toMatchObject({
      ok: false,
      error: "aborted",
      consumption: { kind: "unknown" },
    });
  });

  // Uso incompleto: estimación sin cerrar el cargo.
  it("trata el uso incompleto como estimación sin cerrar el cargo", async () => {
    // Imagen.
    const bytes = await imageBytes();
    // Modelo con salida sin contar.
    const partial = new MockLanguageModelV4({
      // Responde bien, pero sin contar los tokens de salida.
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              observedText: "expected 1024, got 768",
              notes: "",
              uncertain: false,
            }),
          },
        ],
        // Consumo incompleto: salida desconocida.
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(1000, undefined),
        warnings: [],
      }),
    });
    // Modelo sin consumo.
    const missing = new MockLanguageModelV4({
      // Responde bien, pero sin ningún dato de consumo.
      doGenerate: async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              observedText: "expected 1024, got 768",
              notes: "",
              uncertain: false,
            }),
          },
        ],
        // Consumo totalmente desconocido.
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(undefined, undefined),
        warnings: [],
      }),
    });
    // Lee con el primero.
    const partialResult = await visionImage(
      partial,
      bytes,
      "image/png",
      new AbortController().signal,
    );
    // Lee con el segundo.
    const missingResult = await visionImage(
      missing,
      bytes,
      "image/png",
      new AbortController().signal,
    );
    // Estimación incompleta.
    expect(partialResult.consumption).toMatchObject({
      kind: "estimated",
      usd: 0.0001,
      complete: false,
      inputTokens: 1000,
      outputTokens: null,
    });
    // Sin consumo: desconocido.
    expect(missingResult.consumption).toEqual({ kind: "unknown" });
    // Una estimación incompleta retiene la reserva.
    expect(settlementOf(partialResult.consumption, 250)).toEqual({ consumed: 0, unknownHold: 250 });
    // Desconocido también.
    expect(settlementOf({ kind: "unknown" }, 250)).toEqual({ consumed: 0, unknownHold: 250 });
    // Un importe informado se consume (0,02 USD = 20.000 micro-USD).
    expect(settlementOf({ kind: "reported", usd: 0.02, credits: null }, 250)).toEqual({
      consumed: 20_000,
      unknownHold: 0,
    });
    // Libro con la estimación.
    const ledger = addConsumption(emptyLedger(), partialResult.consumption);
    // Sin importe informado.
    expect(ledger.reportedUsd).toBeNull();
    // Estimado.
    expect(ledger.estimatedUsd).toBeCloseTo(0.0001);
    // Incompleto.
    expect(ledger.estimateIncomplete).toBe(true);
    // Una llamada desconocida.
    expect(ledger.unknownCalls).toBe(1);
  });

  // JSON de visión inválido.
  it("rechaza una extracción que no es el JSON pedido", () => {
    // Sin JSON.
    expect(parseVisionJson("sin json")).toBeNull();
    // Sin observedText.
    expect(parseVisionJson('{"notes":"x"}')).toBeNull();
    // Válido.
    expect(
      parseVisionJson('{"observedText":"expected 1024, got 768","notes":"","uncertain":false}')
        ?.observedText,
    ).toContain("1024");
  });

  // Whisper: petición, transcripción y fallos.
  it("envía el audio a Whisper y no inventa una transcripción", async () => {
    // Audio del aula.
    const audio = await readFixtureBytes("embedding-request.wav");
    // Peticiones vistas.
    const seen: unknown[] = [];
    // Transcripción correcta.
    const ok = await workersTranscript(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async (model, input) => {
          // Guarda la petición.
          seen.push({ model, input });
          // Respuesta de Whisper.
          return {
            text: "He cambiado el modelo de embeddings.",
            word_count: 6,
            transcription_info: { language: "es", duration: 4.2 },
          };
        },
      },
      MEDIA_LIMITS.sttModelId,
      audio,
      new AbortController().signal,
    );
    // Modelo y entrada.
    expect(seen[0]).toMatchObject({
      model: MEDIA_LIMITS.sttModelId,
      input: whisperInput(audio),
    });
    // Correcto con consumo informado sin importe.
    expect(ok).toMatchObject({
      ok: true,
      consumption: { kind: "reported", usd: null, credits: null },
    });
    // Texto vacío: null.
    expect(parseWhisper({ text: "  " })).toBeNull();
    // Respuesta sin texto.
    const invalid = await workersTranscript(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ duration: 1 }),
      },
      MEDIA_LIMITS.sttModelId,
      audio,
      new AbortController().signal,
    );
    // Inválida.
    expect(invalid).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "reported", usd: null, credits: null },
    });
    // Workers AI falla.
    const failed = await workersTranscript(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => {
          // Error.
          throw new Error("down");
        },
      },
      MEDIA_LIMITS.sttModelId,
      audio,
      new AbortController().signal,
    );
    // Error de proveedor.
    expect(failed).toMatchObject({
      ok: false,
      error: "provider",
      consumption: { kind: "unknown" },
    });
  });

  // Voz: petición, tope, salida inválida, fallo y stream que no termina.
  it("pide la voz, acota un flujo que no termina y no cierra un fallo", async () => {
    // Controlador.
    const signal = new AbortController();
    // Peticiones vistas.
    const seen: unknown[] = [];
    // Voz correcta.
    const spoken = await workersSpeech(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async (model, input) => {
          // Guarda.
          seen.push({ model, input });
          // 64 bytes.
          return new Uint8Array(64).fill(7);
        },
      },
      MEDIA_LIMITS.ttsModelId,
      "Informe de prueba.",
      signal.signal,
    );
    // Modelo y entrada.
    expect(seen[0]).toMatchObject({
      model: MEDIA_LIMITS.ttsModelId,
      input: auraInput("Informe de prueba."),
    });
    // Correcto.
    expect(spoken.ok).toBe(true);
    // Salida mayor del tope.
    const oversized = await workersSpeech(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => new Uint8Array(MEDIA_LIMITS.maxAudioBytes + 1),
      },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      new AbortController().signal,
    );
    // Inválida.
    expect(oversized).toMatchObject({ ok: false, error: "invalid" });
    // Salida vacía.
    const invalid = await workersSpeech(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({}),
      },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      new AbortController().signal,
    );
    // Inválida.
    expect(invalid).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "reported", usd: null, credits: null },
    });
    // Workers AI falla.
    const failed = await workersSpeech(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => {
          // Error.
          throw new Error("down");
        },
      },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      new AbortController().signal,
    );
    // Error de proveedor.
    expect(failed).toMatchObject({
      ok: false,
      error: "provider",
      consumption: { kind: "unknown" },
    });
    // Stream que nunca entrega datos.
    const hanging = new ReadableStream<Uint8Array>({
      // Doble de prueba: proporciona el siguiente fragmento de bytes cuando el lector solicita más datos.
      pull() {
        // Promesa que no se resuelve.
        return new Promise(() => undefined);
      },
    });
    // Controlador.
    const controller = new AbortController();
    // Inicio.
    const started = Date.now();
    // Pide la voz.
    const pending = workersSpeech(
      {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => hanging,
      },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      controller.signal,
    );
    // Cancela a los 40 ms.
    setTimeout(() => controller.abort(), 40);
    // Espera.
    const stopped = await pending;
    // Termina rápido.
    expect(Date.now() - started).toBeLessThan(1_000);
    // aborted.
    expect(stopped).toMatchObject({
      ok: false,
      error: "aborted",
      consumption: { kind: "unknown" },
    });
  });

  // El resumen muestra la estimación y lee resultados antiguos.
  it("muestra la estimación en el resumen y sigue leyendo un resultado antiguo", () => {
    // Estado inicial.
    const state = initialResearchState(
      // Petición mínima: ids, pregunta, observaciones, grupo, corpus y sin guion.
      {
        runId: "run",
        threadId: null,
        question: "pregunta",
        observations: [{ kind: "text", text: "pregunta" }],
        audience: "program",
        corpusVersion: "fixture",
        scenarioId: null,
      },
      // Inicio en el instante 0.
      0,
    );
    // Parada.
    state.stop = "all-covered";
    // Completo.
    state.outcome = "complete";
    // Libro con una estimación y un importe informado.
    state.ledger = addConsumption(
      addConsumption(emptyLedger(), {
        kind: "estimated",
        usd: 0.00015,
        provenance: TOKEN_ESTIMATE_PROVENANCE,
        complete: true,
        inputTokens: 1000,
        outputTokens: 100,
      }),
      { kind: "reported", usd: 0.02, credits: null },
    );
    // Resumen.
    const summary = researchSummary(state, {
      measured: true,
      fixture: false,
      estimatedMaxUsd: 1.25,
      // Doble de prueba: proporciona el reloj del recorrido para calcular plazos y tiempos transcurridos.
      now: () => 20,
    });
    // Importe informado.
    expect(summary.accounting.providerReportedUsd).toBeCloseTo(0.02);
    // Estimado.
    expect(summary.accounting.estimatedUsd).toBeCloseTo(0.00015);
    // Procedencia.
    expect(summary.accounting.estimateProvenance).toContain("no es un importe del proveedor");
    // Total incompleto.
    expect(summary.accounting.totalComplete).toBe(false);
    // Resumen antiguo sin estimación.
    const legacy = researchSummarySchema.parse({
      // Mismo resumen con la contabilidad de un formato anterior (sin estimación).
      ...summary,
      accounting: {
        // Medido, con USD informado por el proveedor y total completo.
        measured: true,
        estimatedMaxUsd: 1.25,
        providerReportedUsd: 0.02,
        providerReportedCredits: null,
        unknownConsumptionCalls: 0,
        finalAnswerUsd: null,
        totalComplete: true,
        note: "Consumo en USD informado por los proveedores. La reserva estimada es un tope, no un cargo.",
      },
    });
    // Importe.
    expect(legacy.accounting.providerReportedUsd).toBe(0.02);
    // Sin estimación.
    expect(legacy.accounting.estimatedUsd).toBeUndefined();
  });
});
