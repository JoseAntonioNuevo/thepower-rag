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
  it("declara la ausencia de Turnstile únicamente en loopback", async () => {
    const response = await worker.fetch(
      new Request("http://127.0.0.1:5173/api/security"),
      {},
      context,
    );
    expect(await response.json()).toEqual({ enabled: false, siteKey: null, sessionId: null });
  });
});
