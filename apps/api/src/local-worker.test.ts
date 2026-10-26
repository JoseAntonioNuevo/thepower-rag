// GUÍA DE LECTURA · apps/api/src/local-worker.test.ts
// Pruebas de la entrada local: rechaza hostnames públicos y otros orígenes, no reserva presupuesto
// del RAG para la investigación y declara Turnstile desactivado solo en loopback.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Manejador que se prueba.
import worker from "./local-worker";
// Contexto de ejecución vacío.
const context = {} as ExecutionContext;

// Grupo de pruebas de la entrada local.
describe("entrada privada local", () => {
  // Hostname público o presupuesto público: 403.
  it("rechaza un hostname público y una configuración de presupuesto público", async () => {
    // Petición al dominio público.
    expect(
      (
        await worker.fetch(
          new Request("https://rag-thepower.josenuevo.dev/api/security"),
          {},
          context,
        )
      ).status,
    ).toBe(403);
    // Variable de presupuesto público en local.
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
  // Un chat de otro origen se rechaza antes de reservar.
  it("rechaza solicitudes de chat de otro origen antes de reservar o consumir APIs", async () => {
    // Petición con origen ajeno.
    const request = new Request("http://localhost:5173/api/chat", {
      method: "POST",
      headers: { origin: "https://other.example" },
      body: "{}",
    });
    // 403.
    expect((await worker.fetch(request, {}, context)).status).toBe(403);
  });
  // La investigación no reserva el presupuesto local; sin RAG sí.
  it("la investigación no reserva el presupuesto local del RAG", async () => {
    // Llamadas a D1.
    let prepares = 0;
    // Entorno con presupuesto local y una D1 simulada.
    const env = {
      APP_MODE: "demo",
      LOCAL_BUDGET_USD: "4.3",
      MODEL_INPUT_USD_PER_MILLION: "0.2",
      MODEL_OUTPUT_USD_PER_MILLION: "1",
      DB: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare() {
          // Cuenta la llamada.
          prepares += 1;
          // Reserva siempre aceptada.
          return {
            // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
            bind: () => ({
              // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
              first: async () => ({ id: "course-2026" }),
            }),
          };
        },
      },
    };
    // Petición de investigación de la demo.
    const research = await worker.fetch(
      new Request("http://127.0.0.1:5173/api/chat", {
        method: "POST",
        headers: { origin: "http://127.0.0.1:5173", "content-type": "application/json" },
        body: JSON.stringify({
          mode: "research",
          researchScenario: "order-tool",
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "¿En qué estado está mi pedido TPS-20481 y cómo lo pagué?",
                },
              ],
            },
          ],
        }),
      }),
      env,
      context,
    );
    // Responde.
    expect(research.status).toBe(200);
    // Sin reservar.
    expect(prepares).toBe(0);
    // Petición sin RAG.
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
    // Responde.
    expect(sinRag.status).toBe(200);
    // Una reserva.
    expect(prepares).toBe(1);
  });
  // En loopback la seguridad declara Turnstile desactivado.
  it("declara la ausencia de Turnstile únicamente en loopback", async () => {
    // Petición de configuración.
    const response = await worker.fetch(
      new Request("http://127.0.0.1:5173/api/security"),
      {},
      context,
    );
    // Sin Turnstile.
    expect(await response.json()).toEqual({ enabled: false, siteKey: null, sessionId: null });
  });
});
