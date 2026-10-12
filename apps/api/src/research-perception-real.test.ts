import { MEDIA_LIMITS } from "@thepower-rag/contracts";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vite-plus/test";
import { readFixtureBytes } from "./fixture-bytes";
import { TOKEN_ESTIMATE_PROVENANCE } from "./provider-cost";
import {
  auraInput,
  bytesFromAiOutput,
  parseWhisper,
  visionUserPrompt,
  whisperInput,
} from "./research-perception";
import {
  visionImage,
  parseVisionJson,
  workersSpeech,
  workersTranscript,
} from "./research-perception-real";
import { addConsumption, emptyLedger } from "./research-state";
import { settlementOf } from "./research-store";
import { researchSummary } from "./research-summary";
import { initialResearchState } from "./research-graph";
import { researchSummarySchema } from "@thepower-rag/contracts";

const imageBytes = async () => readFixtureBytes("dimension-mismatch.png");

function usage(input: number | undefined, output: number | undefined) {
  return {
    inputTokens: {
      total: input,
      noCache: input,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: output,
      text: output,
      reasoning: undefined,
    },
    raw: undefined,
  };
}

describe("adaptadores reales de medios con dobles", () => {
  const outputCases: [string, (size: number) => unknown][] = [
    ["Uint8Array", (size) => new Uint8Array(size)],
    ["ArrayBuffer", (size) => new ArrayBuffer(size)],
    ["base64", (size) => btoa("a".repeat(size))],
    ["arrayBuffer()", (size) => ({ arrayBuffer: async () => new ArrayBuffer(size) })],
    [
      "ReadableStream",
      (size) =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(size));
            controller.close();
          },
        }),
    ],
    ["Response", (size) => new Response(new Uint8Array(size))],
  ];

  it.each(outputCases)("aplica el tope de voz a %s", async (_name, makeOutput) => {
    expect((await bytesFromAiOutput(makeOutput(MEDIA_LIMITS.maxAudioBytes)))?.byteLength).toBe(
      MEDIA_LIMITS.maxAudioBytes,
    );
    expect(await bytesFromAiOutput(makeOutput(MEDIA_LIMITS.maxAudioBytes + 1))).toBeNull();
  });

  it("lee el cuerpo acotado antes del método arrayBuffer y rechaza base64 inválido", async () => {
    let unboundedReads = 0;
    const output = {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(64));
          controller.close();
        },
      }),
      arrayBuffer: async () => {
        unboundedReads += 1;
        return new ArrayBuffer(MEDIA_LIMITS.maxAudioBytes + 1);
      },
    };
    expect((await bytesFromAiOutput(output))?.byteLength).toBe(64);
    expect(unboundedReads).toBe(0);
    expect(await bytesFromAiOutput("invalid-base64!")).toBeNull();
  });

  it("pide la imagen a Anthropic una sola vez y estima el USD con los tokens", async () => {
    const bytes = await imageBytes();
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        return {
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
          finishReason: { unified: "stop", raw: undefined },
          usage: usage(1000, 100),
          warnings: [],
        };
      },
    });
    const result = await visionImage(model, bytes, "image/png", new AbortController().signal);
    expect(calls).toBe(1);
    expect(result.ok).toBe(true);
    expect(result.consumption).toMatchObject({
      kind: "estimated",
      usd: 0.00015,
      complete: true,
      inputTokens: 1000,
      outputTokens: 100,
      provenance: TOKEN_ESTIMATE_PROVENANCE,
    });
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt, (_key, value) =>
      value instanceof Uint8Array ? `bytes:${String(value.byteLength)}:${String(value[0])}` : value,
    );
    expect(prompt).toContain("image/png");
    expect(prompt).toContain("bytes:");
    expect(prompt).toContain(visionUserPrompt().slice(0, 24));
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0]?.maxOutputTokens).toBe(MEDIA_LIMITS.visionOutputTokens);
  });

  it("no reintenta y deja el cargo desconocido si la visión falla o se aborta", async () => {
    const bytes = await imageBytes();
    let calls = 0;
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        throw new Error("provider down");
      },
    });
    const failed = await visionImage(failing, bytes, "image/png", new AbortController().signal);
    expect(calls).toBe(1);
    expect(failed).toMatchObject({
      ok: false,
      error: "provider",
      consumption: { kind: "unknown" },
    });
    const controller = new AbortController();
    const aborting = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        controller.abort();
        throw new Error("aborted");
      },
    });
    const aborted = await visionImage(aborting, bytes, "image/png", controller.signal);
    expect(calls).toBe(2);
    expect(aborted).toMatchObject({
      ok: false,
      error: "aborted",
      consumption: { kind: "unknown" },
    });
  });

  it("trata el uso incompleto como estimación sin cerrar el cargo", async () => {
    const bytes = await imageBytes();
    const partial = new MockLanguageModelV4({
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
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(1000, undefined),
        warnings: [],
      }),
    });
    const missing = new MockLanguageModelV4({
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
        finishReason: { unified: "stop", raw: undefined },
        usage: usage(undefined, undefined),
        warnings: [],
      }),
    });
    const partialResult = await visionImage(
      partial,
      bytes,
      "image/png",
      new AbortController().signal,
    );
    const missingResult = await visionImage(
      missing,
      bytes,
      "image/png",
      new AbortController().signal,
    );
    expect(partialResult.consumption).toMatchObject({
      kind: "estimated",
      usd: 0.0001,
      complete: false,
      inputTokens: 1000,
      outputTokens: null,
    });
    expect(missingResult.consumption).toEqual({ kind: "unknown" });
    expect(settlementOf(partialResult.consumption, 250)).toEqual({ consumed: 0, unknownHold: 250 });
    expect(settlementOf({ kind: "unknown" }, 250)).toEqual({ consumed: 0, unknownHold: 250 });
    expect(settlementOf({ kind: "reported", usd: 0.02, credits: null }, 250)).toEqual({
      consumed: 20_000,
      unknownHold: 0,
    });
    const ledger = addConsumption(emptyLedger(), partialResult.consumption);
    expect(ledger.reportedUsd).toBeNull();
    expect(ledger.estimatedUsd).toBeCloseTo(0.0001);
    expect(ledger.estimateIncomplete).toBe(true);
    expect(ledger.unknownCalls).toBe(1);
  });

  it("rechaza una extracción que no es el JSON pedido", () => {
    expect(parseVisionJson("sin json")).toBeNull();
    expect(parseVisionJson('{"notes":"x"}')).toBeNull();
    expect(
      parseVisionJson('{"observedText":"expected 1024, got 768","notes":"","uncertain":false}')
        ?.observedText,
    ).toContain("1024");
  });

  it("envía el audio a Whisper y no inventa una transcripción", async () => {
    const audio = await readFixtureBytes("embedding-request.wav");
    const seen: unknown[] = [];
    const ok = await workersTranscript(
      {
        run: async (model, input) => {
          seen.push({ model, input });
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
    expect(seen[0]).toMatchObject({
      model: MEDIA_LIMITS.sttModelId,
      input: whisperInput(audio),
    });
    expect(ok).toMatchObject({
      ok: true,
      consumption: { kind: "reported", usd: null, credits: null },
    });
    expect(parseWhisper({ text: "  " })).toBeNull();
    const invalid = await workersTranscript(
      { run: async () => ({ duration: 1 }) },
      MEDIA_LIMITS.sttModelId,
      audio,
      new AbortController().signal,
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "reported", usd: null, credits: null },
    });
    const failed = await workersTranscript(
      {
        run: async () => {
          throw new Error("down");
        },
      },
      MEDIA_LIMITS.sttModelId,
      audio,
      new AbortController().signal,
    );
    expect(failed).toMatchObject({
      ok: false,
      error: "provider",
      consumption: { kind: "unknown" },
    });
  });

  it("pide la voz, acota un flujo que no termina y no cierra un fallo", async () => {
    const signal = new AbortController();
    const seen: unknown[] = [];
    const spoken = await workersSpeech(
      {
        run: async (model, input) => {
          seen.push({ model, input });
          return new Uint8Array(64).fill(7);
        },
      },
      MEDIA_LIMITS.ttsModelId,
      "Informe de prueba.",
      signal.signal,
    );
    expect(seen[0]).toMatchObject({
      model: MEDIA_LIMITS.ttsModelId,
      input: auraInput("Informe de prueba."),
    });
    expect(spoken.ok).toBe(true);
    const oversized = await workersSpeech(
      { run: async () => new Uint8Array(MEDIA_LIMITS.maxAudioBytes + 1) },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      new AbortController().signal,
    );
    expect(oversized).toMatchObject({ ok: false, error: "invalid" });
    const invalid = await workersSpeech(
      { run: async () => ({}) },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      new AbortController().signal,
    );
    expect(invalid).toMatchObject({
      ok: false,
      error: "invalid",
      consumption: { kind: "reported", usd: null, credits: null },
    });
    const failed = await workersSpeech(
      {
        run: async () => {
          throw new Error("down");
        },
      },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      new AbortController().signal,
    );
    expect(failed).toMatchObject({
      ok: false,
      error: "provider",
      consumption: { kind: "unknown" },
    });
    const hanging = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise(() => undefined);
      },
    });
    const controller = new AbortController();
    const started = Date.now();
    const pending = workersSpeech(
      { run: async () => hanging },
      MEDIA_LIMITS.ttsModelId,
      "hola",
      controller.signal,
    );
    setTimeout(() => controller.abort(), 40);
    const stopped = await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(stopped).toMatchObject({
      ok: false,
      error: "aborted",
      consumption: { kind: "unknown" },
    });
  });

  it("muestra la estimación en el resumen y sigue leyendo un resultado antiguo", () => {
    const state = initialResearchState(
      {
        runId: "run",
        threadId: null,
        question: "pregunta",
        observations: [{ kind: "text", text: "pregunta" }],
        audience: "program",
        corpusVersion: "fixture",
        scenarioId: null,
      },
      0,
    );
    state.stop = "all-covered";
    state.outcome = "complete";
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
    const summary = researchSummary(state, {
      measured: true,
      fixture: false,
      estimatedMaxUsd: 1.25,
      now: () => 20,
    });
    expect(summary.accounting.providerReportedUsd).toBeCloseTo(0.02);
    expect(summary.accounting.estimatedUsd).toBeCloseTo(0.00015);
    expect(summary.accounting.estimateProvenance).toContain("no es un importe del proveedor");
    expect(summary.accounting.totalComplete).toBe(false);
    const legacy = researchSummarySchema.parse({
      ...summary,
      accounting: {
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
    expect(legacy.accounting.providerReportedUsd).toBe(0.02);
    expect(legacy.accounting.estimatedUsd).toBeUndefined();
  });
});
