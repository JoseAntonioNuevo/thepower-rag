// GUÍA DE LECTURA · apps/api/src/model-quality.test.ts
// Protege el contrato de la migración: roles y tarifas coherentes, presupuesto sin ampliar,
// configuración inválida cerrada y lectura pública de identidad sin secretos ni inferencia.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { COURSE_QUALITY_PROFILE } from "../apps/api/src/course-models";
import {
  cragExecutionBudgetMs,
  modelTimeoutMs,
  generationSettings,
  type WorkerEnv,
} from "../apps/api/src/env";
import { reservePublicTurn } from "../apps/api/src/public-budget";
import { createApp } from "../apps/api/src/app";
import { healthResponseSchema } from "@thepower-rag/contracts";
import { assertModelComparisonTarget } from "./model-comparison-target";

// Configuración pública versionada; no se leen archivos de credenciales.
const config = JSON.parse(
  readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1"),
) as { env: Record<string, { vars: WorkerEnv }> };

// Agrupa las comprobaciones de perfil de calidad de modelos.
describe("perfil de calidad de modelos", () => {
  // Verifica este escenario: mantiene Sonnet y sus tarifas en ambos perfiles sin tocar investigación o presupuestos.
  it("mantiene Sonnet y sus tarifas en ambos perfiles sin tocar investigación o presupuestos", () => {
    for (const name of ["production", "local"]) {
      // Lee las variables del entorno actual para contrastar ambos destinos con el mismo perfil.
      const vars = config.env[name]!.vars;
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(vars.MODEL_ID).toBe(COURSE_QUALITY_PROFILE.modelId);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(vars.EVALUATOR_MODEL_ID).toBe(vars.MODEL_ID);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(Number(vars.MODEL_INPUT_USD_PER_MILLION)).toBe(2);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(Number(vars.MODEL_OUTPUT_USD_PER_MILLION)).toBe(10);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(vars.EVALUATOR_INPUT_USD_PER_MILLION).toBe(vars.MODEL_INPUT_USD_PER_MILLION);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(vars.EVALUATOR_OUTPUT_USD_PER_MILLION).toBe(vars.MODEL_OUTPUT_USD_PER_MILLION);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(cragExecutionBudgetMs(vars)).toBe(60_000);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(modelTimeoutMs(vars)).toBe(30_000);
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(vars.RESEARCH_MODEL_ID).toBe("claude-haiku-5-5");
      // Contrasta el valor observado con el resultado exacto que define este caso.
      expect(vars.EMBEDDING_MODEL).toBe("@cf/baai/bge-m3");
    }
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(config.env.production!.vars.PUBLIC_BUDGET_USD).toBe("4.3");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(config.env.production!.vars.RESEARCH_BUDGET_USD).toBe("1.000000");
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(config.env.production!.vars.RESEARCH_JOB_LIMIT_USD).toBe("0.250000");
  });

  // Verifica este escenario: rechaza plazos inválidos y conserva el contrato anterior cuando no se configura.
  it("rechaza plazos inválidos y conserva el contrato anterior cuando no se configura", () => {
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(cragExecutionBudgetMs({})).toBe(20_000);
    for (const value of ["", "NaN", "Infinity", "6e4", "999", "120001", "-1", "1.5"]) {
      // Comprueba que la validación cierre el recorrido con ausencia de resultado.
      expect(cragExecutionBudgetMs({ CRAG_EXECUTION_BUDGET_MS: value })).toBeNull();
    }
    // Comprueba que la validación cierre el recorrido con ausencia de resultado.
    expect(
      generationSettings({
        APP_MODE: "real",
        MODEL_ID: "claude-sonnet-5-5",
        ANTHROPIC_API_KEY: "test-key",
        MODEL_TIMEOUT_MS: "Infinity",
      }),
    ).toBeNull();
  });

  // Verifica este escenario: reserva la tarifa Sonnet completa y no reinicia ni amplía el límite de la cuenta.
  it("reserva la tarifa Sonnet completa y no reinicia ni amplía el límite de la cuenta", async () => {
    // Captura la cantidad que la reserva intenta descontar en el doble de D1.
    let quoted = 0;
    // Inyecta las variables versionadas y un puerto SQL simulado para inspeccionar la reserva.
    const env: WorkerEnv = {
      ...config.env.production!.vars,
      DB: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare: () => ({
          // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
          bind: (quote: number) => ({
            // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
            first: async () => {
              // Conserva la cantidad enlazada a SQL sin ejecutar una escritura en una base real.
              quoted = quote;
              return { id: "course-2026" };
            },
          }),
        }),
      },
    };
    // Solicita la reserva de un turno CRAG con las tarifas del entorno versionado.
    const ledger = await reservePublicTurn(env, "crag");
    // Contrasta el cálculo numérico con el valor esperado admitiendo la precisión indicada.
    expect(quoted).toBeCloseTo(0.9000885);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(ledger?.snapshot().prices.generativeUsdPerMillionInput).toBe(2);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(ledger?.snapshot().prices.generativeUsdPerMillionOutput).toBe(10);
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(env.PUBLIC_BUDGET_USD).toBe("4.3");
  });

  // Verifica este escenario: expone modelos y plazo por health sin revelar la clave.
  it("expone modelos y plazo por health sin revelar la clave", async () => {
    // Consulta la ruta health dentro de Hono sin abrir un servidor ni invocar modelos.
    const response = await createApp().request(
      "/api/health",
      {},
      {
        ...config.env.production!.vars,
        ANTHROPIC_API_KEY: "sentinel-never-return-this-secret",
      },
    );
    // Valida el cuerpo de salud con el mismo esquema que utiliza el consumidor del comparador.
    const body = healthResponseSchema.parse(await response.json());
    // Contrasta los campos relevantes sin exigir igualdad de los metadatos adicionales.
    expect(body.modelConfiguration).toMatchObject({
      provider: "anthropic",
      generator: "claude-sonnet-5-5",
      evaluator: "claude-sonnet-5-5",
      research: "claude-haiku-5-5",
      cragExecutionBudgetMs: 60_000,
    });
    // Comprueba que la salida no incluya el dato que este caso debe excluir.
    expect(JSON.stringify(body)).not.toContain("sentinel-never-return-this-secret");
    // El comparador debe rechazar una web anterior aunque esté sana y el índice exista.
    const target = {
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      evaluator: "claude-sonnet-5-5",
      corpus: "c-test",
      profile: "p-test",
      embedding: "@cf/baai/bge-m3",
      dimensions: 1024,
      turnDeadlineMs: 60_000,
      generationTimeoutMs: 30_000,
      ragContextMode: "semantic",
      minScore: 0.5,
    };
    // Clona la lectura para preparar un objetivo verificable sin alterar la respuesta original.
    const ready = structuredClone(body);
    // Simula la disponibilidad RAG de un índice ya verificado.
    ready.capabilities.rag.status = "ready";
    // Simula también la disponibilidad CRAG para aislar la comprobación de identidad.
    ready.capabilities.crag.status = "ready";
    // Asocia la referencia del experimento a los campos públicos del corpus.
    Object.assign(ready.corpus, {
      version: target.corpus,
      profileId: target.profile,
      embedding: target.embedding,
      dimensions: target.dimensions,
    });
    // Marca la lectura remota como verificada para satisfacer el requisito del comparador.
    ready.corpus.coverage.remote = "index-verified";
    // Fija el mismo umbral que declara la referencia congelada.
    ready.modelConfiguration!.retrievalMinScore = 0.5;
    // Comprueba que la configuración válida supere la validación sin lanzar errores.
    expect(() => assertModelComparisonTarget(target, ready)).not.toThrow();
    // Cambia solo el generador para demostrar que un despliegue anterior se rechaza.
    ready.modelConfiguration!.generator = "claude-haiku-5-5";
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => assertModelComparisonTarget(target, ready)).toThrow("La web no demuestra");
    // Elimina después la identidad de modelos para demostrar que una lectura incompleta también bloquea.
    delete ready.modelConfiguration;
    // Comprueba que la entrada inválida produzca el error previsto antes de continuar.
    expect(() => assertModelComparisonTarget(target, ready)).toThrow("La web no demuestra");
  });

  // Verifica este escenario: un plazo inválido se rechaza antes de reservar dinero.
  it("un plazo inválido se rechaza antes de reservar dinero", async () => {
    // Envía una petición CRAG local con plazo inválido y un puerto SQL que fallaría si se usase.
    const response = await createApp().request(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "crag",
          audience: "program",
          messages: [
            { id: "user", role: "user", parts: [{ type: "text", text: "Explica LangGraph" }] },
          ],
        }),
      },
      {
        APP_MODE: "real",
        MODEL_ID: "claude-sonnet-5-5",
        EVALUATOR_MODEL_ID: "claude-sonnet-5-5",
        ANTHROPIC_API_KEY: "test-key",
        MODEL_TIMEOUT_MS: "Infinity",
        DB: {
          // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
          prepare: () => {
            // Detiene el recorrido con el diagnóstico: No debe reservarse en D1.
            throw new Error("No debe reservarse en D1");
          },
        },
      },
    );
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(response.status).toBe(409);
    // Comprueba que la salida incluya la evidencia o el mensaje previsto por el caso.
    expect(await response.text()).toContain("MODEL_TIMEOUT_MS");
    // Comprueba que la validación cierre el recorrido con ausencia de resultado.
    expect(
      await reservePublicTurn(
        {
          PUBLIC_BUDGET_USD: "4.3",
          MODEL_INPUT_USD_PER_MILLION: "2",
          MODEL_OUTPUT_USD_PER_MILLION: "10",
          MODEL_TIMEOUT_MS: "Infinity",
          DB: {
            // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
            prepare: () => {
              // Detiene el recorrido con el diagnóstico: No debe reservarse en D1.
              throw new Error("No debe reservarse en D1");
            },
          },
        },
        "crag",
      ),
    ).toBeNull();
  });
});
