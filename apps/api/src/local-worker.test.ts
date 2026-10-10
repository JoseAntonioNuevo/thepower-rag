import { describe, expect, it } from "vite-plus/test";
import worker from "./local-worker";
const context = {} as ExecutionContext;

describe("entrada privada local", () => {
  it("rechaza un hostname público y una configuración de presupuesto público", async () => {
    expect(
      (
        await worker.fetch(
          new Request("https://rag-thepower.josenuevo.dev/api/security"),
          {},
          context,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await worker.fetch(
          new Request("http://localhost:5173/api/security"),
          { PUBLIC_BUDGET_USD: "4.3" },
          context,
        )
      ).status,
    ).toBe(403);
  });
  it("rechaza solicitudes de chat de otro origen antes de reservar o consumir APIs", async () => {
    const request = new Request("http://localhost:5173/api/chat", {
      method: "POST",
      headers: { origin: "https://other.example" },
      body: "{}",
    });
    expect((await worker.fetch(request, {}, context)).status).toBe(403);
  });
  it("la investigación no reserva el presupuesto local del RAG", async () => {
    let prepares = 0;
    const env = {
      APP_MODE: "demo",
      LOCAL_BUDGET_USD: "4.3",
      MODEL_INPUT_USD_PER_MILLION: "0.2",
      MODEL_OUTPUT_USD_PER_MILLION: "1",
      DB: {
        prepare() {
          prepares += 1;
          return { bind: () => ({ first: async () => ({ id: "course-2026" }) }) };
        },
      },
    };
    const research = await worker.fetch(
      new Request("http://127.0.0.1:5173/api/chat", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
        body: JSON.stringify({
          mode: "research",
          audience: "M/J",
          researchScenario: "course-tool",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "¿Cuándo es la sesión 12 de mi grupo y qué ejercicio tiene?",
                },
              ],
            },
          ],
        }),
      }),
      env,
      context,
    );
    expect(research.status).toBe(200);
    expect(prepares).toBe(0);
    const sinRag = await worker.fetch(
      new Request("http://127.0.0.1:5173/api/chat", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
        body: JSON.stringify({
          mode: "sin-rag",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hola" }] }],
        }),
      }),
      env,
      context,
    );
    expect(sinRag.status).toBe(200);
    expect(prepares).toBe(1);
  });
  it("declara la ausencia de Turnstile únicamente en loopback", async () => {
    const response = await worker.fetch(
      new Request("http://127.0.0.1:5173/api/security"),
      {},
      context,
    );
    expect(await response.json()).toEqual({ enabled: false, siteKey: null, sessionId: null });
  });
});
