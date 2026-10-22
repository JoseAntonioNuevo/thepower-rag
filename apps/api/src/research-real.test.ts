// GUÍA DE LECTURA · apps/api/src/research-real.test.ts
// Pruebas de los adaptadores reales de investigación con modelos y almacenes simulados: errores del
// proveedor sin filtrar datos, umbral de búsqueda, herramienta del catálogo, consumo y construcción sin red.
// Tipo de fragmento del corpus.
import type { ChunkRecord } from "@thepower-rag/core";
// Validador del plan de investigación.
import { validatePlan } from "@thepower-rag/research";
// Error HTTP del AI SDK.
import { APICallError } from "ai";
// Modelo simulado del AI SDK.
import { MockLanguageModelV4 } from "ai/test";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Tipos de ajustes.
import type { ResearchSettings, RetrievalSettings } from "./env";
// Fragmentos y versión de ejemplo.
import { fixtureChunks, fixtureCorpusVersion } from "./fixture";
// Adaptadores reales que se prueban.
import {
  createRealResearchPorts,
  createResearchModelPort,
  createVectorCoursePort,
  estimateResearchMaxUsd,
  type RealResearchInput,
} from "./research-real";
// Herramienta de sesiones del curso.
import { createCourseSessionTool } from "./research-tool";
// Tipos de D1 y Vectorize.
import type { SqlDatabase, VectorIndex } from "./stores";
// Modelo de embeddings BGE-M3.
import { BGE_M3_MODEL } from "./vectors";

// Versión del corpus de ejemplo.
const corpus = fixtureCorpusVersion();
// Fragmentos de ejemplo.
const library = fixtureChunks();
// Opciones de llamada: señal y plazo.
const call = { signal: new AbortController().signal, timeoutMs: 5_000 };

// Ajustes de búsqueda de prueba.
const retrieval: RetrievalSettings = {
  embeddingModel: BGE_M3_MODEL,
  dimensions: 4,
  corpusVersion: corpus,
  indexProfile: "profile-test",
  metric: "cosine",
  minScore: 0.5,
};

// Ajustes de investigación de prueba.
const settings: ResearchSettings = {
  plannerModelId: "example/planner",
  firecrawlApiKey: "test-key",
  allowedDomains: ["docs.langchain.com"],
  budgetUsd: 1,
  inputUsdPerMillion: 0.2,
  outputUsdPerMillion: 1,
  firecrawlUsdPerCredit: 0.01,
};

// Devuelve un fragmento por id o falla.
function chunk(id: string): ChunkRecord {
  // Lo busca.
  const found = library.find((item) => item.chunkId === id);
  // Si falta, error.
  if (found === undefined) {
    // Mensaje.
    throw new Error(`falta ${id}`);
  }
  // Fragmento encontrado.
  return found;
}

// Grupo de pruebas de los adaptadores.
describe("adaptadores reales simulados", () => {
  // Un HTTP 429 se informa sin cuerpo privado y sin reintento.
  it("muestra el HTTP del proveedor sin revelar su cuerpo ni reintentar", async () => {
    // Contador de llamadas.
    let calls = 0;
    // Modelo que siempre lanza un 429.
    const model = new MockLanguageModelV4({
      // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
      doGenerate: async () => {
        // Cuenta.
        calls += 1;
        // Error con datos privados.
        throw new APICallError({
          message: "private-provider-body",
          url: "https://provider.example",
          requestBodyValues: { private: "private-question" },
          statusCode: 429,
          responseBody: "private-provider-body",
          isRetryable: true,
        });
      },
    });
    // Pide un plan.
    const result = await createResearchModelPort({ planner: model, generator: model }).plan(
      { question: "Vectorize", audience: "program" },
      call,
    );
    // Una sola llamada.
    expect(calls).toBe(1);
    // Error de proveedor con el estado HTTP.
    expect(result).toMatchObject({
      ok: false,
      error: "provider",
      detail: "El proveedor del modelo respondió HTTP 429.",
      consumption: { kind: "unknown" },
    });
    // Nada privado en el resultado.
    expect(JSON.stringify(result)).not.toContain("private");
  });
  // Salida cortada por tope de tokens: error claro, sin exponerla.
  it("identifica la salida estructurada truncada sin exponerla ni reintentar", async () => {
    // Contador.
    let calls = 0;
    // Modelo que corta el JSON por max_tokens.
    const model = new MockLanguageModelV4({
      // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
      doGenerate: async () => {
        // Cuenta.
        calls += 1;
        // Respuesta truncada con consumo.
        return {
          content: [{ type: "text", text: '{"private-input":' }],
          finishReason: { unified: "length", raw: "max_tokens" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    // Pide un plan.
    const result = await createResearchModelPort({ planner: model, generator: model }).plan(
      { question: "Vectorize", audience: "program" },
      call,
    );
    // Una llamada.
    expect(calls).toBe(1);
    // Error del tope de salida con consumo estimado.
    expect(result).toMatchObject({
      ok: false,
      error: "provider",
      detail: "El modelo agotó el tope de salida antes de completar el objeto.",
      consumption: { kind: "estimated", inputTokens: 10, outputTokens: 8 },
    });
    // Sin el texto truncado.
    expect(JSON.stringify(result)).not.toContain("private-input");
  });
  // El curso vectorial filtra por umbral de similitud.
  it("el curso vectorial devuelve solo fragmentos por encima del umbral", async () => {
    // Consultas recibidas.
    const seen: unknown[] = [];
    // Índice simulado con un resultado alto y uno bajo.
    const index: VectorIndex = {
      // Doble de prueba: ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
      query: async (vector, options) => {
        // Guarda la consulta.
        seen.push({ vector, options });
        // Dos resultados.
        return {
          matches: [
            { id: `${corpus}:s12-deep-research:00`, score: 0.91 },
            { id: `${corpus}:s12-deep-research:01`, score: 0.1 },
          ],
        };
      },
      // Doble de prueba: inserta o actualiza el lote de vectores por sus identificadores.
      upsert: async () => ({}),
    };
    // D1 simulado: solo existe el fragmento :00.
    const database: SqlDatabase = {
      // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
      prepare: () => ({
        // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
        bind: (...values: unknown[]) => ({
          // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
          first: async <T>(): Promise<T | null> => {
            // Id enlazado.
            const id = String(values[1]);
            // Fragmento o null.
            return (id.endsWith(":00") ? chunk(id) : null) as T | null;
          },
        }),
      }),
    };
    // Puerto del curso.
    const course = createVectorCoursePort({
      embedder: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] }),
      },
      index,
      database,
      retrieval,
    });
    // Busca.
    const result = await course.retrieve(
      { query: "deep research", audience: "program", corpusVersion: corpus, limit: 4 },
      call,
    );
    // Correcto.
    expect(result.ok).toBe(true);
    // Solo el de puntuación alta.
    expect(result.ok ? result.value.map((item) => item.sourceId) : []).toEqual([
      `${corpus}:s12-deep-research:00`,
    ]);
    // Consumo desconocido.
    expect(result.consumption).toEqual({ kind: "unknown" });
    // Filtró por perfil.
    expect(JSON.stringify(seen)).toContain("profile-test");
  });

  // Una cancelación no se presenta como falta de evidencia.
  it("un embedding abortado no se convierte en evidencia ausente", async () => {
    // Controlador.
    const controller = new AbortController();
    // Cancela ya.
    controller.abort();
    // Puerto del curso.
    const course = createVectorCoursePort({
      embedder: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ data: [[0.1, 0.2, 0.3, 0.4]] }),
      },
      index: {
        // Doble de prueba: ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
        query: async () => ({ matches: [] }),
        // Doble de prueba: inserta o actualiza el lote de vectores por sus identificadores.
        upsert: async () => ({}),
      },
      database: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare: () => ({
          // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
          bind: () => ({
            // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
            first: async () => null,
          }),
        }),
      },
      retrieval,
    });
    // Busca con la señal cancelada.
    const result = await course.retrieve(
      { query: "deep research", audience: "program", corpusVersion: corpus, limit: 2 },
      { signal: controller.signal, timeoutMs: 5_000 },
    );
    // Error aborted.
    expect(result).toMatchObject({ ok: false, error: "aborted", consumption: { kind: "unknown" } });
  });

  // La herramienta no inventa la fecha si falta el calendario.
  it("la herramienta lee el catálogo y no inventa un campo ausente", async () => {
    // Herramienta sin el fragmento del calendario.
    const tool = createCourseSessionTool({
      corpusVersion: corpus,
      audience: "M/J",
      // Doble de prueba: lee el recurso solicitado y devuelve el resultado de este adaptador al consumidor.
      read: async (_version, id) =>
        id.includes("calendario") ? null : (library.find((item) => item.chunkId === id) ?? null),
    });
    // Pide S12.
    const result = await tool.getCourseSession({ sessionId: "S12", audience: "M/J" }, call);
    // Correcto.
    expect(result.ok).toBe(true);
    // Texto de la ficha.
    const text = result.ok && result.value !== null ? result.value.text : "";
    // Con el ejercicio.
    expect(text).toContain("Ejercicio resumido");
    // Dice que la fecha no consta.
    expect(text).toContain("la fecha no consta");
    // Cita su fragmento.
    expect(result.ok && result.value !== null ? result.value.backingSourceIds : []).toContain(
      `${corpus}:s12-deep-research:00`,
    );
  });

  // Un catálogo que falla da error, no una ficha.
  it("un catálogo que lanza un error no fabrica la ficha", async () => {
    // Herramienta con lectura que lanza.
    const tool = createCourseSessionTool({
      corpusVersion: corpus,
      audience: "M/J",
      // Doble de prueba: lee el recurso solicitado y devuelve el resultado de este adaptador al consumidor.
      read: async () => {
        // Error simulado.
        throw new Error("catalog unavailable");
      },
    });
    // Pide S12.
    const result = await tool.getCourseSession({ sessionId: "S12", audience: "M/J" }, call);
    // Error de proveedor.
    expect(result).toMatchObject({
      ok: false,
      error: "provider",
      detail: "El catálogo del curso no respondió.",
    });
  });

  // El plan se valida, sin reintentos, con consumo estimado.
  it("el modelo estructurado no reintenta y registra el USD informado", async () => {
    // Contador.
    let calls = 0;
    // Plan válido de ejemplo.
    const plan = {
      route: "course",
      rationale: "Basta el material del curso. ".repeat(20),
      clarification: null,
      subquestions: [
        {
          id: "q1",
          text: "Qué es un checkpointer.",
          kind: "technical",
          external: false,
          query: null,
        },
      ],
      tool: null,
    };
    // Modelo que devuelve el plan en JSON.
    const model = new MockLanguageModelV4({
      // Implementa la respuesta del modelo de prueba compatible con el contrato del AI SDK.
      doGenerate: async () => {
        // Cuenta.
        calls += 1;
        // Respuesta con consumo.
        return {
          content: [{ type: "text", text: JSON.stringify(plan) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 8, text: 8, reasoning: undefined },
          },
          warnings: [],
          providerMetadata: undefined,
        };
      },
    });
    // Puerto del modelo.
    const port = createResearchModelPort({ planner: model, generator: model });
    // Pide el plan.
    const result = await port.plan(
      { question: "¿Qué es un checkpointer?", audience: "program" },
      call,
    );
    // Una llamada.
    expect(calls).toBe(1);
    // Correcto.
    expect(result.ok).toBe(true);
    // Plan normalizado.
    expect(result.ok ? result.value : null).toMatchObject({
      route: "course",
      rationale: plan.rationale.trim().slice(0, 240).trimEnd(),
      subquestions: plan.subquestions,
    });
    // El plan pasa la validación.
    expect(result.ok && validatePlan(result.value, "program").ok).toBe(true);
    // Consumo estimado: (4 × 0,2 + 8 × 1) / 1.000.000 USD.
    expect(result.consumption).toMatchObject({
      kind: "estimated",
      usd: 0.0000044,
      complete: true,
      inputTokens: 4,
      outputTokens: 8,
    });
    // Procedencia: no es un importe del proveedor.
    expect(result.consumption.kind === "estimated" ? result.consumption.provenance : "").toContain(
      "no es un importe del proveedor",
    );
  });

  // Construir los puertos no llama a la red.
  it("construir los puertos reales no llama a la red", async () => {
    // Contador.
    let calls = 0;
    // Entrada completa con fetch que cuenta.
    const input = {
      signal: new AbortController().signal,
      audience: "program",
      corpusVersion: corpus,
      settings,
      priceSearchProvider: "firecrawl",
      retrieval,
      planner: new MockLanguageModelV4({}),
      generator: new MockLanguageModelV4({}),
      embedder: {
        // Doble de prueba: ejecuta la operación del puerto y devuelve su resultado al llamador.
        run: async () => ({ data: [] }),
      },
      index: {
        // Doble de prueba: ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
        query: async () => ({ matches: [] }),
        // Doble de prueba: inserta o actualiza el lote de vectores por sus identificadores.
        upsert: async () => ({}),
      },
      database: {
        // Doble de prueba: prepara una sentencia y devuelve el objeto que permitirá enlazar valores y ejecutarla.
        prepare: () => ({
          // Doble de prueba: asocia los parámetros a la sentencia sin concatenarlos al texto SQL.
          bind: () => ({
            // Doble de prueba: resuelve la primera fila o el valor de ausencia que define este adaptador.
            first: async () => null,
          }),
        }),
      },
      // Doble de prueba: atiende la petición HTTP con el adaptador y el entorno de este recorrido.
      fetch: async () => {
        // Cuenta.
        calls += 1;
        // Respuesta de error.
        return new Response("no", { status: 500 });
      },
    } satisfies RealResearchInput;
    // Construye los puertos.
    const ports = createRealResearchPorts(input);
    // Sin red.
    expect(calls).toBe(0);
    // Puertos medidos.
    expect(ports.measured).toBe(true);
    // No son de prueba.
    expect(ports.fixture).toBe(false);
    // Con tope estimado.
    expect(ports.estimatedMaxUsd).toBeGreaterThan(0);
    // Igual que el cálculo directo.
    expect(estimateResearchMaxUsd(settings)).toBe(ports.estimatedMaxUsd);
    // Precio de otro buscador: error.
    expect(() => createRealResearchPorts({ ...input, priceSearchProvider: "tavily" })).toThrow(
      "research-search-provider-price-mismatch",
    );
  });
});
