import {
  DEMO_RESEARCH_QUESTION,
  errorResponseSchema,
  RESEARCH_ACCOUNTING_MISSING,
  researchSummarySchema,
} from "@thepower-rag/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createApp } from "./app";
import type { WorkerEnv } from "./env";
import { fixtureCorpusVersion } from "./fixture";
import { createFixtureResearchPorts } from "./research-fixture";

const originalFetch = globalThis.fetch;

function userMessage(text: string) {
  return { id: "user-1", role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function payloads(body: string): unknown[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}

function ofType(events: unknown[], type: string): unknown[] {
  return events.filter(
    (event) =>
      typeof event === "object" && event !== null && "type" in event && event.type === type,
  );
}

function post(
  body: unknown,
  env: WorkerEnv = {},
  url = "http://localhost/api/chat",
): Promise<Response> {
  return Promise.resolve(
    createApp().request(
      url,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: new URL(url).origin },
        body: JSON.stringify(body),
      },
      env,
    ),
  );
}

beforeEach(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^https?:/i.test(url)) {
      throw new Error(`red no permitida ${url}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("HTTP de investigación", () => {
  it("en demo emite progreso, informe y fuentes tipados", async () => {
    const response = await post({
      mode: "research",
      researchScenario: "sufficient-first-round",
      messages: [userMessage(DEMO_RESEARCH_QUESTION)],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
    const events = payloads(await response.text());
    expect(ofType(events, "data-research-step").length).toBeGreaterThan(0);
    const summaryEvent = ofType(events, "data-research")[0] as { data?: unknown } | undefined;
    const summary = researchSummarySchema.parse(summaryEvent?.data);
    expect(summary.outcome).toBe("complete");
    expect(summary.fixture).toBe(true);
    expect(ofType(events, "data-research-source").length).toBeGreaterThan(0);
    const text = ofType(events, "text-delta")
      .map((event) => (event as { delta: string }).delta)
      .join("");
    expect(text).toContain("Informe de prueba");
    expect(text).toContain("[cite:");
  });

  it("separa un informe parcial, un rechazo y un fallo operativo", async () => {
    const partial = await post({
      mode: "research",
      researchScenario: "internal-fact-missing",
      messages: [
        userMessage(
          "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?",
        ),
      ],
    });
    const refused = await post({
      mode: "research",
      messages: [userMessage("zzzz quark inexistente 9876543210")],
    });
    const failed = await post({
      mode: "research",
      researchScenario: "provider-failure",
      messages: [userMessage(DEMO_RESEARCH_QUESTION)],
    });
    const partialSummary = researchSummarySchema.parse(
      (ofType(payloads(await partial.text()), "data-research")[0] as { data: unknown }).data,
    );
    const refusedSummary = researchSummarySchema.parse(
      (ofType(payloads(await refused.text()), "data-research")[0] as { data: unknown }).data,
    );
    const failedSummary = researchSummarySchema.parse(
      (ofType(payloads(await failed.text()), "data-research")[0] as { data: unknown }).data,
    );
    expect(partialSummary.outcome).toBe("partial");
    expect(partialSummary.coverage.some((entry) => entry.cause === "missing-evidence")).toBe(true);
    expect(refused.status).toBe(200);
    expect(refusedSummary.outcome).toBe("refused");
    expect(failedSummary.stop).toBe("provider-failure");
    expect(failedSummary.coverage.some((entry) => entry.cause === "operational-failure")).toBe(
      true,
    );
    expect(failedSummary.outcome).not.toBe(refusedSummary.outcome);
    const controller = new AbortController();
    const ports = createFixtureResearchPorts({
      signal: controller.signal,
      scenarioId: "course-tool",
      audience: "M/J",
      corpusVersion: fixtureCorpusVersion(),
    });
    const errored = await createApp({
      researchPorts: {
        ...ports,
        tool: {
          getCourseSession: () =>
            Promise.resolve({
              ok: false as const,
              error: "provider" as const,
              detail: "catalog unavailable",
              consumption: { kind: "none" as const },
            }),
        },
      },
    }).request(
      "http://localhost/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({
          mode: "research",
          audience: "M/J",
          researchScenario: "course-tool",
          messages: [userMessage("¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?")],
        }),
      },
      {},
    );
    const errorSummary = researchSummarySchema.parse(
      (ofType(payloads(await errored.text()), "data-research")[0] as { data: unknown }).data,
    );
    expect(errorSummary.outcome).toBe("error");
    expect(errorSummary.coverage[0]?.cause).toBe("operational-failure");
    expect(errorSummary.outcome).not.toBe(partialSummary.outcome);
    expect(errorSummary.outcome).not.toBe(refusedSummary.outcome);
  });

  it("en real responde 409 sin llamada de pago ni guion de prueba", async () => {
    let network = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (/^https?:/i.test(url)) {
        network += 1;
        throw new Error(`red no permitida ${url}`);
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    const response = await post(
      { mode: "research", messages: [userMessage(DEMO_RESEARCH_QUESTION)] },
      {
        APP_MODE: "real",
        ANTHROPIC_API_KEY: "local-test-key",
        MODEL_ID: "example/generator",
        RESEARCH_MODEL_ID: "example/research",
        FIRECRAWL_API_KEY: "local-firecrawl",
        RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
        RESEARCH_BUDGET_USD: "1",
        RESEARCH_INPUT_USD_PER_MILLION: "0.2",
        RESEARCH_OUTPUT_USD_PER_MILLION: "1",
        FIRECRAWL_USD_PER_CREDIT: "0.01",
      },
    );
    expect(response.status).toBe(409);
    const body = errorResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      error: "configuration",
      missing: expect.arrayContaining([RESEARCH_ACCOUNTING_MISSING]),
    });
    expect(body.message).toContain("bloqueada");
    expect(network).toBe(0);
    expect(JSON.stringify(body)).not.toContain("text-delta");
  });

  it("sin RAG, RAG y CRAG de demostración siguen respondiendo", async () => {
    const sinRag = await post({ mode: "sin-rag", messages: [userMessage("Hola")] });
    const rag = await post({
      mode: "rag",
      messages: [userMessage("¿Cómo modela LangGraph un agente con estado y nodos?")],
    });
    const crag = await post({
      mode: "crag",
      messages: [userMessage("¿Qué es un grafo de estado?")],
    });
    expect(sinRag.status).toBe(200);
    expect(sinRag.headers.get("x-thepower-rag-stream")).toBe("offline-demo");
    expect(rag.status).toBe(200);
    expect(rag.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
    expect(crag.status).toBe(200);
    expect(crag.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
    const cragText = await crag.text();
    expect(cragText).toContain("text-delta");
    expect(cragText).not.toContain("data-research");
  });

  it("la protección de origen sigue delante de la investigación", async () => {
    const env: WorkerEnv = {
      APP_MODE: "real",
      PUBLIC_BUDGET_USD: "4.3",
      PUBLIC_ORIGIN: "https://rag-thepower.josenuevo.dev",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "x".repeat(24),
      CHAT_IP_LIMITER: { limit: async () => ({ success: true }) },
      CHAT_SESSION_LIMITER: { limit: async () => ({ success: true }) },
    };
    const foreign = await createApp().request(
      "https://evil.example/api/chat",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          mode: "research",
          messages: [userMessage(DEMO_RESEARCH_QUESTION)],
        }),
      },
      env,
    );
    const mismatched = await createApp().request(
      "https://rag-thepower.josenuevo.dev/api/chat",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "cf-connecting-ip": "203.0.113.8",
        },
        body: JSON.stringify({
          mode: "research",
          messages: [userMessage(DEMO_RESEARCH_QUESTION)],
        }),
      },
      env,
    );
    expect(foreign.status).toBe(403);
    expect(mismatched.status).toBe(403);
    expect(await foreign.text()).not.toContain("data-research");
    expect(await mismatched.text()).not.toContain("text-delta");
  });
});
