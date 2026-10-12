// GUÍA DE LECTURA · apps/api/src/research-http.test.ts
// Pruebas HTTP del modo investigación: demo con informe y fuentes, resultados parciales, rechazos,
// fallos operativos, bloqueo en real sin configuración completa y protección de origen.
// Pregunta de demo y esquemas para validar errores y resúmenes.
import {
  DEMO_RESEARCH_QUESTION,
  errorResponseSchema,
  researchSummarySchema,
} from "@thepower-rag/contracts";
// Funciones de prueba de Vite+ (Vitest).
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
// Crea la app Hono que se prueba.
import { createApp } from "./app";
// Tipo de las variables del Worker.
import type { WorkerEnv } from "./env";
// Versión del corpus de ejemplo.
import { fixtureCorpusVersion } from "./fixture";
// Puertos simulados de la investigación.
import { createFixtureResearchPorts } from "./research-fixture";

// fetch original; se restaura tras cada prueba.
const originalFetch = globalThis.fetch;

// Construye un mensaje de usuario con una parte de texto.
function userMessage(text: string) {
  // Objeto con id, papel y partes, como lo envía useChat.
  return { id: "user-1", role: "user" as const, parts: [{ type: "text" as const, text }] };
}

// Extrae los objetos JSON de un flujo SSE (líneas "data: ...").
function payloads(body: string): unknown[] {
  // Divide en líneas, quita espacios, se queda con data: (salvo [DONE]) y parsea el JSON.
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data: ") && line !== "data: [DONE]")
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}

// Filtra los eventos de un tipo concreto.
function ofType(events: unknown[], type: string): unknown[] {
  // Se queda con los objetos cuyo campo type coincide.
  return events.filter(
    (event) =>
      typeof event === "object" && event !== null && "type" in event && event.type === type,
  );
}

// Envía un POST a la app con el mismo origen que la URL.
function post(
  body: unknown,
  env: WorkerEnv = {},
  url = "http://localhost/api/chat",
): Promise<Response> {
  // Promise.resolve unifica el resultado de request en una promesa.
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

// Antes de cada prueba bloquea la red externa.
beforeEach(() => {
  // Sustituye fetch por una versión que rechaza URL http(s).
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // URL como texto, venga como cadena, URL o Request.
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    // Si es una dirección de red, falla.
    if (/^https?:/i.test(url)) {
      // Error que delata una llamada no permitida.
      throw new Error(`red no permitida ${url}`);
    }
    // Cualquier otra cosa usa el fetch original.
    return originalFetch(input, init);
  }) as typeof fetch;
});

// Después de cada prueba restaura fetch.
afterEach(() => {
  // Vuelve al original.
  globalThis.fetch = originalFetch;
});

// Grupo de pruebas del HTTP de investigación.
describe("HTTP de investigación", () => {
  // La demo emite pasos, resumen, fuentes y texto con citas.
  it("en demo emite progreso, informe y fuentes tipados", async () => {
    // Petición de investigación con el escenario que basta en la primera ronda.
    const response = await post({
      mode: "research",
      researchScenario: "sufficient-first-round",
      messages: [userMessage(DEMO_RESEARCH_QUESTION)],
    });
    // Respuesta correcta.
    expect(response.status).toBe(200);
    // La cabecera indica el origen fixture.
    expect(response.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
    // Eventos del flujo.
    const events = payloads(await response.text());
    // Hay pasos de progreso.
    expect(ofType(events, "data-research-step").length).toBeGreaterThan(0);
    // Evento con el resumen.
    const summaryEvent = ofType(events, "data-research")[0] as { data?: unknown } | undefined;
    // El resumen cumple el esquema.
    const summary = researchSummarySchema.parse(summaryEvent?.data);
    // Terminó completo.
    expect(summary.outcome).toBe("complete");
    // Marcado como datos de prueba.
    expect(summary.fixture).toBe(true);
    // Hay fuentes.
    expect(ofType(events, "data-research-source").length).toBeGreaterThan(0);
    // Texto completo uniendo los deltas.
    const text = ofType(events, "text-delta")
      .map((event) => (event as { delta: string }).delta)
      .join("");
    // Contiene el informe.
    expect(text).toContain("Informe de prueba");
    // Contiene citas.
    expect(text).toContain("[cite:");
  });

  // Distingue parcial, rechazo, fallo del proveedor y error de herramienta.
  it("separa un informe parcial, un rechazo y un fallo operativo", async () => {
    // Escenario con un dato interno que falta: informe parcial.
    const partial = await post({
      mode: "research",
      researchScenario: "internal-fact-missing",
      messages: [
        userMessage(
          "¿Qué nota mínima exige el profesor para aprobar el ejercicio de S12? Y, técnicamente, ¿para qué sirve un checkpointer en LangGraph?",
        ),
      ],
    });
    // Pregunta sin sentido: se rechaza.
    const refused = await post({
      mode: "research",
      messages: [userMessage("zzzz quark inexistente 9876543210")],
    });
    // Fallo simulado del proveedor.
    const failed = await post({
      mode: "research",
      researchScenario: "provider-failure",
      messages: [userMessage(DEMO_RESEARCH_QUESTION)],
    });
    // Resumen del parcial.
    const partialSummary = researchSummarySchema.parse(
      (ofType(payloads(await partial.text()), "data-research")[0] as { data: unknown }).data,
    );
    // Resumen del rechazo.
    const refusedSummary = researchSummarySchema.parse(
      (ofType(payloads(await refused.text()), "data-research")[0] as { data: unknown }).data,
    );
    // Resumen del fallo.
    const failedSummary = researchSummarySchema.parse(
      (ofType(payloads(await failed.text()), "data-research")[0] as { data: unknown }).data,
    );
    // Parcial.
    expect(partialSummary.outcome).toBe("partial");
    // Con un hueco por falta de evidencia.
    expect(partialSummary.coverage.some((entry) => entry.cause === "missing-evidence")).toBe(true);
    // El rechazo sigue siendo HTTP 200.
    expect(refused.status).toBe(200);
    // Resultado refused.
    expect(refusedSummary.outcome).toBe("refused");
    // Parada por fallo del proveedor.
    expect(failedSummary.stop).toBe("provider-failure");
    // Con un hueco por fallo operativo.
    expect(failedSummary.coverage.some((entry) => entry.cause === "operational-failure")).toBe(
      true,
    );
    // Un fallo no se confunde con un rechazo.
    expect(failedSummary.outcome).not.toBe(refusedSummary.outcome);
    // Controlador de cancelación para los puertos.
    const controller = new AbortController();
    // Puertos de prueba del escenario con herramienta.
    const ports = createFixtureResearchPorts({
      signal: controller.signal,
      scenarioId: "course-tool",
      audience: "M/J",
      corpusVersion: fixtureCorpusVersion(),
    });
    // App con una herramienta que siempre falla.
    const errored = await createApp({
      researchPorts: {
        ...ports,
        // Herramienta de sesiones que siempre devuelve un fallo del proveedor.
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
      // Petición de investigación del guion «course-tool».
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
    // Resumen de esa ejecución.
    const errorSummary = researchSummarySchema.parse(
      (ofType(payloads(await errored.text()), "data-research")[0] as { data: unknown }).data,
    );
    // Resultado error.
    expect(errorSummary.outcome).toBe("error");
    // Causa: fallo operativo.
    expect(errorSummary.coverage[0]?.cause).toBe("operational-failure");
    // Distinto de parcial.
    expect(errorSummary.outcome).not.toBe(partialSummary.outcome);
    // Distinto de rechazo.
    expect(errorSummary.outcome).not.toBe(refusedSummary.outcome);
  });

  // En real sin bindings de investigación responde 409 sin tocar la red.
  it("en real responde 409 sin llamada de pago ni guion de prueba", async () => {
    // Contador de llamadas de red.
    let network = 0;
    // fetch que cuenta y rechaza la red.
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // URL como texto.
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      // Si es red.
      if (/^https?:/i.test(url)) {
        // Cuenta la llamada.
        network += 1;
        // Y falla.
        throw new Error(`red no permitida ${url}`);
      }
      // Lo demás pasa.
      return originalFetch(input, init);
    }) as typeof fetch;
    // Petición con claves de prueba pero sin RESEARCH_DB ni RESEARCH_WORKFLOW.
    const response = await post(
      { mode: "research", messages: [userMessage(DEMO_RESEARCH_QUESTION)] },
      {
        // Modo real con generación, investigación y precios.
        APP_MODE: "real",
        ANTHROPIC_API_KEY: "local-test-key",
        MODEL_ID: "example/generator",
        RESEARCH_MODEL_ID: "example/research",
        // Buscador, autorización, presupuesto y tarifas.
        FIRECRAWL_API_KEY: "local-firecrawl",
        RESEARCH_SPEND_AUTHORIZATION: "s12-research-phase1",
        RESEARCH_BUDGET_USD: "1",
        RESEARCH_INPUT_USD_PER_MILLION: "0.2",
        RESEARCH_OUTPUT_USD_PER_MILLION: "1",
        FIRECRAWL_USD_PER_CREDIT: "0.01",
      },
    );
    // Conflicto de configuración.
    expect(response.status).toBe(409);
    // Cuerpo de error validado.
    const body = errorResponseSchema.parse(await response.json());
    // Nombra lo que falta.
    expect(body).toMatchObject({
      error: "configuration",
      missing: expect.arrayContaining(["RESEARCH_DB", "RESEARCH_WORKFLOW"]),
    });
    // Mensaje que dice que está bloqueada.
    expect(body.message).toContain("bloqueada");
    // Sin llamadas de red.
    expect(network).toBe(0);
    // Sin texto de respuesta.
    expect(JSON.stringify(body)).not.toContain("text-delta");
  });

  // Los otros modos de demo siguen funcionando.
  it("sin RAG, RAG y CRAG de demostración siguen respondiendo", async () => {
    // Chat sin RAG.
    const sinRag = await post({ mode: "sin-rag", messages: [userMessage("Hola")] });
    // RAG básico.
    const rag = await post({
      mode: "rag",
      messages: [userMessage("¿Cómo modela LangGraph un agente con estado y nodos?")],
    });
    // CRAG.
    const crag = await post({
      mode: "crag",
      messages: [userMessage("¿Qué es un grafo de estado?")],
    });
    // 200.
    expect(sinRag.status).toBe(200);
    // Origen demo.
    expect(sinRag.headers.get("x-thepower-rag-stream")).toBe("offline-demo");
    // 200.
    expect(rag.status).toBe(200);
    // Origen fixture.
    expect(rag.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
    // 200.
    expect(crag.status).toBe(200);
    // Origen fixture.
    expect(crag.headers.get("x-thepower-rag-stream")).toBe("offline-fixture");
    // Texto del flujo CRAG.
    const cragText = await crag.text();
    // Tiene texto.
    expect(cragText).toContain("text-delta");
    // Sin eventos de investigación.
    expect(cragText).not.toContain("data-research");
  });

  // Origen ajeno o distinto del publicado: 403 antes de investigar.
  it("la protección de origen sigue delante de la investigación", async () => {
    // Entorno real con Turnstile y limitadores que siempre aceptan.
    const env: WorkerEnv = {
      APP_MODE: "real",
      PUBLIC_BUDGET_USD: "4.3",
      PUBLIC_ORIGIN: "https://rag-thepower.josenuevo.dev",
      TURNSTILE_SITE_KEY: "site-key",
      TURNSTILE_SECRET_KEY: "x".repeat(24),
      CHAT_IP_LIMITER: { limit: async () => ({ success: true }) },
      CHAT_SESSION_LIMITER: { limit: async () => ({ success: true }) },
    };
    // Petición desde un dominio ajeno.
    const foreign = await createApp().request(
      // URL y Origin de otro dominio.
      "https://evil.example/api/chat",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        // Petición de investigación normal.
        body: JSON.stringify({
          mode: "research",
          messages: [userMessage(DEMO_RESEARCH_QUESTION)],
        }),
      },
      env,
    );
    // URL publicada pero Origin ajeno.
    const mismatched = await createApp().request(
      // Dominio publicado, pero con un Origin ajeno y una IP de cliente.
      "https://rag-thepower.josenuevo.dev/api/chat",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "cf-connecting-ip": "203.0.113.8",
        },
        // Petición de investigación normal.
        body: JSON.stringify({
          mode: "research",
          messages: [userMessage(DEMO_RESEARCH_QUESTION)],
        }),
      },
      env,
    );
    // Prohibido.
    expect(foreign.status).toBe(403);
    // Prohibido.
    expect(mismatched.status).toBe(403);
    // Sin investigación.
    expect(await foreign.text()).not.toContain("data-research");
    // Sin texto.
    expect(await mismatched.text()).not.toContain("text-delta");
  });
});
