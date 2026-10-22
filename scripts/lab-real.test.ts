// GUÍA DE LECTURA · scripts/lab-real.test.ts
// Evita regresiones de aislamiento, reservas acumulativas y contrato del proveedor de embeddings.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createLabModels } from "../apps/api/src/lab-models";
import { assertLocalLabDatabase, chooseLabThreshold, LabBudget } from "../lab/src/real-session";

// Restaura las funciones globales simuladas después de cada caso para que no contaminen el siguiente.
afterEach(() => vi.unstubAllGlobals());

// Agrupa las comprobaciones de S10 real sin sustituciones.
describe("S10 real sin sustituciones", () => {
  // Verifica este escenario: rechaza bases remotas y otro puerto o nombre antes de ejecutar SQL.
  it("rechaza bases remotas y otro puerto o nombre antes de ejecutar SQL", () => {
    // Comprueba que la configuración válida supere la validación sin lanzar errores.
    expect(() =>
      assertLocalLabDatabase("postgresql://a:b@127.0.0.1:54329/aether_rag"),
    ).not.toThrow();
    for (const url of [
      "postgresql://a:b@example.com:54329/aether_rag",
      "postgresql://a:b@127.0.0.1:5432/aether_rag",
      "postgresql://a:b@127.0.0.1:54329/production",
    ])
      // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
      expect(() => assertLocalLabDatabase(url)).toThrow("solo admite PostgreSQL local");
  });
  // Verifica este escenario: conserva reservas al cambiar de comando y no reinicia un tope distinto.
  it("conserva reservas al cambiar de comando y no reinicia un tope distinto", () => {
    // Crea un directorio temporal exclusivo para probar persistencia sin tocar el estado de clase.
    const dir = mkdtempSync(path.join(tmpdir(), "s10-budget-"));
    // Sitúa el diario de prueba dentro de ese directorio desechable.
    const file = path.join(dir, "budget.json");
    // Usa tarifas conocidas para que la reserva esperada sea reproducible.
    const rates = { embedding: 0.2, input: 2, output: 10 };
    try {
      // Realiza la primera reserva sobre un límite pequeño que permite observar el agotamiento.
      new LabBudget(file, 0.001, rates).reserve("embedding", "pregunta", 0);
      // Crea otra instancia sobre el mismo archivo para simular un comando posterior del CLI.
      const second = new LabBudget(file, 0.001, rates);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(second.receipt().calls).toBe(1);
      // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
      expect(() => second.reserve("embedding", "otra", 0)).toThrow("insuficiente");
      // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
      expect(() => new LabBudget(file, 1, rates)).toThrow("otro tope");
    } finally {
      // Elimina el estado de prueba incluso si falla una aserción del presupuesto.
      rmSync(dir, { recursive: true, force: true });
    }
  });
  // Verifica este escenario: elige un corte con validación y para si ambas clases se solapan.
  it("elige un corte con validación y para si ambas clases se solapan", () => {
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(chooseLabThreshold([0.8, 0.7], [0.2, 0.4])).toBe(0.55);
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => chooseLabThreshold([0.4], [0.5])).toThrow("solapada");
  });
  // Verifica este escenario: solicita 768 dimensiones al proveedor y rechaza una respuesta incompatible sin reintentos.
  it("solicita 768 dimensiones al proveedor y rechaza una respuesta incompatible sin reintentos", async () => {
    // Captura los cuerpos enviados para poder inspeccionar la dimensión solicitada al proveedor.
    const bodies: Record<string, unknown>[] = [];
    // Sustituye HTTP por un doble que devuelve un vector incompatible de solo dos dimensiones.
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      // Exige un cuerpo JSON textual antes de inspeccionar la petición que construye el SDK.
      if (typeof init?.body !== "string") throw new Error("Falta el cuerpo JSON");
      // Conserva el cuerpo parseado para comprobar sus opciones después de la llamada.
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [1, 0] }],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    // Inyecta el transporte simulado como fetch global; esta prueba no contacta con OpenRouter.
    vi.stubGlobal("fetch", fetcher);
    // Observa la reserva previa sin crear un diario ni gastar dinero real.
    const reserve = vi.fn<() => void>();
    // Construye los adaptadores reales con claves ficticias y el transporte HTTP sustituido.
    const models = createLabModels({
      embeddingProvider: "openrouter",
      embeddingModel: "google/gemini-embedding-2",
      embeddingApiKey: "test-key",
      generation: { apiKey: "test-key", modelId: "claude-sonnet-5-5", provider: "anthropic" },
      beforeCall: reserve,
    });
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    await expect(models.embedder.embed(["dato ficticio"])).rejects.toThrow("768");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(bodies[0]?.dimensions).toBe(768);
    // Comprueba el número de invocaciones para detectar llamadas omitidas o repetidas.
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Comprueba el número de invocaciones para detectar llamadas omitidas o repetidas.
    expect(reserve).toHaveBeenCalledTimes(1);
  });
});
