// GUÍA DE LECTURA · apps/api/src/provider-routes.test.ts
// Pruebas de proveedores sin red: qué petición enviaría cada uno (URL, cabeceras y razonamiento), cómo
// se leen LLM_PROVIDER y LLM_REASONING_EFFORT, la visión con cualquier proveedor y el coste mostrado.
// generateText del AI SDK para provocar la petición.
import { generateText } from "ai";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones de configuración que se prueban.
import {
  assessWorker,
  compatibleUrlAllowed,
  generationSettings,
  mediaMissing,
  mediaReadiness,
  type GenerationSettings,
  type WorkerEnv,
} from "./env";
// Fábrica de modelos y catálogo de OpenRouter.
import { OPENROUTER_CATALOG_URL, createLanguageModel, resetOpenRouterCatalog } from "./model";
// Tarifa y coste.
import { generationPricing, providerCost } from "./provider-cost";

// Clave falsa; nunca sale a la red.
const SECRET = "clave-de-prueba-no-real";

// Petición capturada.
interface Captured {
  // URL.
  url: string;
  // Cabeceras.
  headers: Record<string, string>;
  // Cuerpo JSON.
  body: Record<string, unknown>;
}

/** Fichas del catálogo de OpenRouter con la forma real de /api/v1/models. */
const CATALOG = {
  data: [
    // Razonamiento opcional con niveles altos y bajos: se puede apagar.
    {
      id: "anthropic/claude-haiku-5.5",
      supported_parameters: ["max_tokens", "reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["max", "xhigh", "high", "medium", "low"] },
    },
    // Razonamiento obligatorio: se pide el nivel más bajo.
    {
      id: "z-ai/glm-5.3",
      supported_parameters: ["max_tokens", "reasoning", "temperature"],
      reasoning: { mandatory: true, supported_efforts: ["max", "high", "low"] },
    },
    // Solo niveles altos: se omite para no subir el razonamiento.
    {
      id: "deepseek/deepseek-v4-flash",
      supported_parameters: ["max_tokens", "reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["xhigh", "high"] },
    },
    // Sin razonamiento: no se envía nada.
    { id: "meta-llama/llama-4-maverick", supported_parameters: ["max_tokens", "temperature"] },
  ],
};

/**
 * Construye el modelo con un fetch falso que guarda la petición y responde 500. Así se ve qué
 * enviaría cada proveedor sin llamar a la red ni gastar. El catálogo de OpenRouter se sirve con
 * las fichas de prueba, o falla si catalog es null.
 */
async function capture(
  settings: GenerationSettings,
  modelId: string,
  catalog: unknown = CATALOG,
): Promise<Captured> {
  // Petición capturada; null hasta que llegue.
  let captured: Captured | null = null;
  // fetch original.
  const original = globalThis.fetch;
  // Vacía la caché del catálogo.
  resetOpenRouterCatalog();
  // fetch falso.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Petición al catálogo de OpenRouter.
    if (String(input instanceof Request ? input.url : input) === OPENROUTER_CATALOG_URL) {
      // Catálogo de prueba o un 503.
      return catalog === null
        ? new Response("no", { status: 503 })
        : new Response(JSON.stringify(catalog), {
            headers: { "content-type": "application/json" },
          });
    }
    // Guarda URL, cabeceras y cuerpo.
    captured = {
      url: String(input instanceof Request ? input.url : input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    };
    // Responde 500 para que la llamada termine sin gastar.
    return new Response(JSON.stringify({ error: { message: "prueba" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  // try/finally: restaura fetch siempre.
  try {
    // Provoca la petición; el error 500 se ignora.
    await generateText({
      model: createLanguageModel(settings, modelId),
      prompt: "hola",
      maxOutputTokens: 100,
      maxRetries: 0,
    }).catch(() => undefined);
  } finally {
    // Restaura fetch.
    globalThis.fetch = original;
    // Vacía la caché.
    resetOpenRouterCatalog();
  }
  // Si no hubo petición, falla.
  if (captured === null)
    // Detiene el recorrido con el diagnóstico: no hubo petición.
    throw new Error("no hubo petición");
  // Petición capturada.
  return captured;
}

// Grupo: un proveedor para todos los papeles.
describe("un proveedor para todos los papeles", () => {
  // Compatibilidad del SDK instalado con el contrato de Sonnet y Opus, sin red real.
  it("Sonnet 5.5 evita disabled y Opus 5.5 conserva adaptive sin cambiar de modelo", async () => {
    const sonnet = await capture(
      { provider: "anthropic", apiKey: SECRET, modelId: "claude-sonnet-5-5" },
      "claude-sonnet-5-5",
    );
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(sonnet.body.model).toBe("claude-sonnet-5-5");
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(sonnet.body.thinking).toEqual({ type: "between_tools" });
    // Contrasta los campos relevantes sin exigir igualdad de los metadatos adicionales.
    expect(sonnet.body.output_config).toMatchObject({ effort: "low" });
    const opus = await capture(
      { provider: "anthropic", apiKey: SECRET, modelId: "claude-opus-5-5", reasoning: "minimal" },
      "claude-opus-5-5",
    );
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(opus.body.model).toBe("claude-opus-5-5");
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(opus.body.thinking).toEqual({ type: "adaptive" });
    // Contrasta los campos relevantes sin exigir igualdad de los metadatos adicionales.
    expect(opus.body.output_config).toMatchObject({ effort: "low" });
    const high = await capture(
      { provider: "anthropic", apiKey: SECRET, modelId: "claude-sonnet-5-5", reasoning: "xhigh" },
      "claude-sonnet-5-5",
    );
    // Compara la estructura y los valores completos con la referencia de la prueba.
    expect(high.body.thinking).toEqual({ type: "adaptive" });
  });

  // Un cambio de modelo no puede seguir anunciando el coste de Haiku.
  it("calcula Sonnet y Opus con su tarifa y deja desconocidos los modelos sin precio", () => {
    const usage = { inputTokens: 1_000, outputTokens: 100 };
    const sonnet = generationPricing({ apiKey: SECRET, modelId: "claude-sonnet-5-5" });
    const opus = generationPricing({ apiKey: SECRET, modelId: "claude-opus-5-5" });
    // Contrasta el cálculo numérico con el valor esperado admitiendo la precisión indicada.
    expect(providerCost(usage, sonnet)?.amount).toBeCloseTo(0.003);
    // Contrasta el cálculo numérico con el valor esperado admitiendo la precisión indicada.
    expect(providerCost(usage, opus)?.amount).toBeCloseTo(0.006);
    // Comprueba que la validación cierre el recorrido con ausencia de resultado.
    expect(generationPricing({ apiKey: SECRET, modelId: "otro-modelo" })).toBeNull();
  });
  // Anthropic: effort low y cabecera del espacio de trabajo.
  it("anthropic conserva la ruta publicada: effort low y espacio de trabajo", async () => {
    // Captura.
    const sent = await capture(
      { provider: "anthropic", apiKey: SECRET, modelId: "claude-haiku-5-5", workspaceId: "ws" },
      "claude-haiku-5-5",
    );
    // Endpoint de Messages.
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    // Espacio de trabajo.
    expect(sent.headers["anthropic-workspace-id"]).toBe("ws");
    // Esfuerzo bajo.
    expect(JSON.stringify(sent.body)).toContain('"effort":"low"');
    // Sin temperatura.
    expect(sent.body).not.toHaveProperty("temperature");
  });

  // OpenAI: Responses, razonamiento bajo y sin guardar.
  it("openai usa Responses, razonamiento bajo y store=false", async () => {
    // Captura.
    const sent = await capture({ provider: "openai", apiKey: SECRET, modelId: "x" }, "gpt-6-luna");
    // Endpoint de Responses.
    expect(sent.url).toBe("https://api.openai.com/v1/responses");
    // Clave como Bearer.
    expect(sent.headers.authorization).toBe(`Bearer ${SECRET}`);
    // Razonamiento bajo.
    expect(sent.body.reasoning).toMatchObject({ effort: "low" });
    // store=false.
    expect(sent.body.store).toBe(false);
  });

  // OpenAI no envía razonamiento a un modelo sin él.
  it("openai no envía razonamiento a un modelo que no razona", async () => {
    // Captura con gpt-4.1-mini.
    const sent = await capture(
      { provider: "openai", apiKey: SECRET, modelId: "x" },
      "gpt-4.1-mini",
    );
    // Sin reasoning.
    expect(sent.body).not.toHaveProperty("reasoning");
  });

  // Gemini: thinkingLevel y clave en cabecera.
  it("gemini traduce el razonamiento a thinkingLevel y manda la clave en cabecera", async () => {
    // Captura.
    const sent = await capture(
      { provider: "gemini", apiKey: SECRET, modelId: "x" },
      "gemini-3.1-flash-lite",
    );
    // Endpoint generateContent del modelo.
    expect(sent.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    // Clave en x-goog-api-key.
    expect(sent.headers["x-goog-api-key"]).toBe(SECRET);
    // La clave no va en la URL.
    expect(sent.url).not.toContain(SECRET);
    // thinkingLevel low.
    expect(sent.body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "low" } });
  });

  // OpenRouter elige el razonamiento según el catálogo.
  it("openrouter adapta el razonamiento a la ficha de cada modelo", async () => {
    // Modelo y razonamiento esperado.
    const expected: [string, unknown][] = [
      // Se puede apagar: apagado.
      ["anthropic/claude-haiku-5.5", { enabled: false }],
      ["deepseek/deepseek-v4-flash", { enabled: false }],
      // Razona siempre: su nivel más bajo.
      ["z-ai/glm-5.3", { effort: "low" }],
      // Un sufijo de enrutado usa la ficha del modelo sin sufijo.
      ["z-ai/glm-5.3:nitro", { effort: "low" }],
      // Fuera del catálogo: el nivel bajo de siempre.
      ["proveedor/modelo-nuevo", { effort: "low" }],
    ];
    // Cada caso.
    for (const [modelId, reasoning] of expected) {
      // Captura.
      const sent = await capture({ provider: "openrouter", apiKey: SECRET, modelId }, modelId);
      // Endpoint de Chat Completions.
      expect(sent.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      // Mismo modelo.
      expect(sent.body.model).toBe(modelId);
      // Razonamiento esperado.
      expect(sent.body.reasoning).toEqual(reasoning);
      // Sin temperatura.
      expect(sent.body).not.toHaveProperty("temperature");
    }
    // Modelo sin razonamiento.
    const llama = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x" },
      "meta-llama/llama-4-maverick",
    );
    // No se envía.
    expect(llama.body).not.toHaveProperty("reasoning");
  });

  // Sin catálogo: nivel bajo, sin bloquear.
  it("openrouter sin catálogo pide el nivel bajo y no bloquea la llamada", async () => {
    // Captura con catálogo caído.
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x" },
      "deepseek/deepseek-v4-flash",
      null,
    );
    // effort low.
    expect(sent.body.reasoning).toEqual({ effort: "low" });
  });

  // Con nivel fijado no se consulta el catálogo.
  it("openrouter con LLM_REASONING_EFFORT fijado envía ese nivel sin mirar el catálogo", async () => {
    // Captura.
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x", reasoning: "medium" },
      "deepseek/deepseek-v4-flash",
      null,
    );
    // effort medium.
    expect(sent.body.reasoning).toEqual({ effort: "medium" });
  });

  // max se traduce a xhigh.
  it("openrouter traduce max a xhigh, su nivel más alto", async () => {
    // Captura.
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x", reasoning: "max" },
      "x-ai/grok-4.7",
    );
    // xhigh.
    expect(sent.body.reasoning).toEqual({ effort: "xhigh" });
  });

  // compatible: sin razonamiento por defecto y sin clave vacía.
  it("compatible no envía razonamiento salvo que se pida y omite la clave vacía", async () => {
    // Servidor local sin clave.
    const quiet = await capture(
      { provider: "compatible", apiKey: "", modelId: "x", baseURL: "http://localhost:11434/v1" },
      "qwen3:0.6b",
    );
    // URL del servidor.
    expect(quiet.url).toBe("http://localhost:11434/v1/chat/completions");
    // Sin reasoning_effort.
    expect(quiet.body).not.toHaveProperty("reasoning_effort");
    // Sin authorization.
    expect(quiet.headers).not.toHaveProperty("authorization");
    // Servidor remoto con clave y nivel.
    const asked = await capture(
      {
        provider: "compatible",
        apiKey: SECRET,
        modelId: "x",
        baseURL: "https://api.groq.com/openai/v1",
        reasoning: "low",
      },
      "llama-demo",
    );
    // reasoning_effort low.
    expect(asked.body.reasoning_effort).toBe("low");
    // Clave como Bearer.
    expect(asked.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  // «omitir» no envía el campo.
  it("omitir el razonamiento no envía el campo", async () => {
    // Captura con reasoning null.
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x", reasoning: null },
      "meta-llama/llama-4-maverick",
    );
    // Sin reasoning.
    expect(sent.body).not.toHaveProperty("reasoning");
  });
});

// Grupo: lectura del entorno.
describe("configuración del proveedor en el entorno", () => {
  // Variables mínimas comunes.
  const base = { APP_MODE: "real", MODEL_ID: "modelo" } satisfies WorkerEnv;

  // Sin LLM_PROVIDER se usa Anthropic.
  it("sin LLM_PROVIDER sigue siendo anthropic con ANTHROPIC_API_KEY", () => {
    // Ajustes con la clave de Anthropic.
    const settings = generationSettings({ ...base, ANTHROPIC_API_KEY: SECRET });
    // Proveedor y clave.
    expect(settings).toMatchObject({ provider: "anthropic", apiKey: SECRET });
    // Sin LLM_REASONING_EFFORT decide el proveedor (low en Anthropic).
    expect(settings).not.toHaveProperty("reasoning");
    // Sin clave falta ANTHROPIC_API_KEY.
    expect(assessWorker({ ...base }).capabilities["sin-rag"].missing).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
  });

  // Cada proveedor pide su clave.
  it("cada proveedor pide su propia clave", () => {
    // Proveedor y su variable.
    const cases = [
      ["openai", "OPENAI_API_KEY"],
      ["openrouter", "OPENROUTER_API_KEY"],
      ["gemini", "GEMINI_API_KEY"],
      ["compatible", "COMPAT_BASE_URL"],
    ] as const;
    // Cada caso.
    for (const [provider, credential] of cases) {
      // Entorno con ese proveedor y solo la clave de Anthropic.
      const env = { ...base, LLM_PROVIDER: provider, ANTHROPIC_API_KEY: SECRET };
      // Falta la del proveedor.
      expect(assessWorker(env).capabilities["sin-rag"].missing).toEqual([credential]);
      // Con su variable, ajustes válidos.
      const settings = generationSettings({ ...env, [credential]: "https://api.example.com/v1" });
      // Proveedor correcto.
      expect(settings?.provider).toBe(provider);
    }
  });

  // Mayúsculas y espacios se aceptan; un nombre desconocido bloquea.
  it("acepta mayúsculas y espacios en LLM_PROVIDER y rechaza un nombre desconocido", () => {
    // " OpenRouter " vale.
    expect(
      generationSettings({ ...base, LLM_PROVIDER: " OpenRouter ", OPENROUTER_API_KEY: SECRET })
        ?.provider,
    ).toBe("openrouter");
    // "otro" no existe.
    const report = assessWorker({ ...base, LLM_PROVIDER: "otro", ANTHROPIC_API_KEY: SECRET });
    // Bloqueado por LLM_PROVIDER.
    expect(report.capabilities["sin-rag"]).toEqual({
      status: "blocked",
      missing: ["LLM_PROVIDER"],
    });
    // Sin ajustes de generación.
    expect(report.generation).toBeNull();
  });

  // LLM_REASONING_EFFORT: omitir, mayúsculas y valor inválido.
  it("valida LLM_REASONING_EFFORT y admite omitir", () => {
    // Entorno con OpenRouter.
    const env = { ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: SECRET };
    // omitir da null.
    expect(generationSettings({ ...env, LLM_REASONING_EFFORT: "omitir" })?.reasoning).toBeNull();
    // HIGH da high.
    expect(generationSettings({ ...env, LLM_REASONING_EFFORT: "HIGH" })?.reasoning).toBe("high");
    // Valor inválido: sin ajustes.
    expect(assessWorker({ ...env, LLM_REASONING_EFFORT: "mucho" }).generation).toBeNull();
    // Sin valor no se fija nivel: compatible no lo enviará (ver la prueba de su petición).
    expect(
      generationSettings({ ...base, LLM_PROVIDER: "compatible", COMPAT_BASE_URL: "https://x.dev" }),
    ).not.toHaveProperty("reasoning");
  });

  // compatible exige https o este mismo equipo.
  it("compatible solo envía la clave cifrada o a este mismo equipo", () => {
    // https: sí.
    expect(compatibleUrlAllowed("https://api.groq.com/openai/v1")).toBe(true);
    // localhost: sí.
    expect(compatibleUrlAllowed("http://localhost:11434/v1")).toBe(true);
    // 127.0.0.1: sí.
    expect(compatibleUrlAllowed("http://127.0.0.1:8000/v1")).toBe(true);
    // http remoto: no.
    expect(compatibleUrlAllowed("http://servidor.example/v1")).toBe(false);
    // Texto que no es URL: no.
    expect(compatibleUrlAllowed("no es una url")).toBe(false);
    // Entorno con http remoto.
    const env = {
      ...base,
      LLM_PROVIDER: "compatible",
      COMPAT_BASE_URL: "http://servidor.example/v1",
      COMPAT_API_KEY: SECRET,
    };
    // Bloqueado por COMPAT_BASE_URL.
    expect(assessWorker(env).capabilities["sin-rag"].missing).toEqual(["COMPAT_BASE_URL"]);
    // Con localhost, válido.
    const local = generationSettings({ ...env, COMPAT_BASE_URL: "http://localhost:11434/v1" });
    // URL y clave.
    expect(local).toMatchObject({ baseURL: "http://localhost:11434/v1", apiKey: SECRET });
  });

  // El espacio de trabajo solo se usa con Anthropic.
  it("solo Anthropic envía el espacio de trabajo", () => {
    // Ajustes con OpenRouter y espacio de trabajo.
    const settings = generationSettings({
      ...base,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: SECRET,
      ANTHROPIC_WORKSPACE_ID: "ws",
    });
    // Sin workspaceId.
    expect(settings).not.toHaveProperty("workspaceId");
  });
});

// Grupo: visión con cualquier proveedor.
describe("visión con cualquier proveedor", () => {
  // Entorno listo con OpenRouter.
  const ready = {
    APP_MODE: "real",
    RESEARCH_MEDIA: {},
    AI: {},
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: SECRET,
    RESEARCH_MODEL_ID: "google/gemini-3.1-flash-lite",
  } satisfies WorkerEnv;

  // Acepta el modelo y pide la clave del proveedor.
  it("acepta el modelo configurado y pide la clave de ese proveedor", () => {
    // Visión configurada.
    expect(mediaReadiness(ready).vision).toBe("configured");
    // No falta nada.
    expect(mediaMissing(ready, { image: true, audio: false, voice: false })).toEqual([]);
    // Sin la clave de OpenRouter, falta esa.
    expect(
      mediaMissing(
        { ...ready, OPENROUTER_API_KEY: undefined },
        { image: true, audio: false, voice: false },
      ),
    ).toEqual(["OPENROUTER_API_KEY"]);
  });

  // Con Anthropic exige un modelo Claude con imagen.
  it("con anthropic mantiene la lista de Claude con imagen documentada", () => {
    // Entorno con un modelo de solo texto.
    const anthropic = {
      ...ready,
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: SECRET,
      RESEARCH_MODEL_ID: "example/text-only",
    };
    // Falta RESEARCH_VISION_MODEL_ID.
    expect(mediaMissing(anthropic, { image: true, audio: false, voice: false })).toEqual([
      "RESEARCH_VISION_MODEL_ID",
    ]);
  });
});

// Grupo: coste mostrado.
describe("coste mostrado según la tarifa del modelo elegido", () => {
  // Un millón de tokens de entrada y de salida.
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  // Con tarifa configurada se usa esa y el nombre del proveedor.
  it("usa MODEL_*_USD_PER_MILLION y el nombre del proveedor", () => {
    // Ajustes con tarifa 1 y 3 USD.
    const settings = generationSettings({
      APP_MODE: "real",
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: SECRET,
      MODEL_ID: "z-ai/glm-5.3",
      MODEL_INPUT_USD_PER_MILLION: "1",
      MODEL_OUTPUT_USD_PER_MILLION: "3",
    });
    // Coste calculado.
    const cost = providerCost(usage, settings ? generationPricing(settings) : null);
    // 1 + 3 = 4 USD con OpenRouter.
    expect(cost).toMatchObject({ amount: 4, currency: "USD", source: "OpenRouter" });
  });

  // Sin tarifa, solo Haiku 5.5 por Anthropic tiene precio.
  it("sin tarifa solo Claude Haiku 5.5 por Anthropic tiene precio; otro modelo queda null", () => {
    // Tarifa de Haiku.
    const haiku = generationPricing({ apiKey: SECRET, modelId: "claude-haiku-5-5" });
    // 0,1 + 0,5 = 0,6 USD.
    expect(providerCost(usage, haiku)?.amount).toBeCloseTo(0.6);
    // Otro modelo sin tarifa.
    const other = generationPricing({ provider: "openrouter", apiKey: SECRET, modelId: "x/y" });
    // null.
    expect(other).toBeNull();
    // Coste desconocido.
    expect(providerCost(usage, other)).toBeNull();
  });
});
