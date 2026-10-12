import { generateText } from "ai";
import { describe, expect, it } from "vite-plus/test";
import {
  assessWorker,
  compatibleUrlAllowed,
  generationSettings,
  mediaMissing,
  mediaReadiness,
  type GenerationSettings,
  type WorkerEnv,
} from "./env";
import { OPENROUTER_CATALOG_URL, createLanguageModel, resetOpenRouterCatalog } from "./model";
import { generationPricing, providerCost } from "./provider-cost";

const SECRET = "clave-de-prueba-no-real";

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Fichas del catálogo de OpenRouter con la forma real de /api/v1/models. */
const CATALOG = {
  data: [
    {
      id: "anthropic/claude-haiku-5.5",
      supported_parameters: ["max_tokens", "reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["max", "xhigh", "high", "medium", "low"] },
    },
    {
      id: "z-ai/glm-5.3",
      supported_parameters: ["max_tokens", "reasoning", "temperature"],
      reasoning: { mandatory: true, supported_efforts: ["max", "high", "low"] },
    },
    {
      id: "deepseek/deepseek-v4-flash",
      supported_parameters: ["max_tokens", "reasoning"],
      reasoning: { mandatory: false, supported_efforts: ["xhigh", "high"] },
    },
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
  let captured: Captured | null = null;
  const original = globalThis.fetch;
  resetOpenRouterCatalog();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input instanceof Request ? input.url : input) === OPENROUTER_CATALOG_URL) {
      return catalog === null
        ? new Response("no", { status: 503 })
        : new Response(JSON.stringify(catalog), {
            headers: { "content-type": "application/json" },
          });
    }
    captured = {
      url: String(input instanceof Request ? input.url : input),
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
        string,
        unknown
      >,
    };
    return new Response(JSON.stringify({ error: { message: "prueba" } }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await generateText({
      model: createLanguageModel(settings, modelId),
      prompt: "hola",
      maxOutputTokens: 100,
      maxRetries: 0,
    }).catch(() => undefined);
  } finally {
    globalThis.fetch = original;
    resetOpenRouterCatalog();
  }
  if (captured === null) throw new Error("no hubo petición");
  return captured;
}

describe("un proveedor para todos los papeles", () => {
  it("anthropic conserva la ruta publicada: effort low y espacio de trabajo", async () => {
    const sent = await capture(
      { provider: "anthropic", apiKey: SECRET, modelId: "claude-haiku-5-5", workspaceId: "ws" },
      "claude-haiku-5-5",
    );
    expect(sent.url).toBe("https://api.anthropic.com/v1/messages");
    expect(sent.headers["anthropic-workspace-id"]).toBe("ws");
    expect(JSON.stringify(sent.body)).toContain('"effort":"low"');
    expect(sent.body).not.toHaveProperty("temperature");
  });

  it("openai usa Responses, razonamiento bajo y store=false", async () => {
    const sent = await capture({ provider: "openai", apiKey: SECRET, modelId: "x" }, "gpt-6-luna");
    expect(sent.url).toBe("https://api.openai.com/v1/responses");
    expect(sent.headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(sent.body.reasoning).toMatchObject({ effort: "low" });
    expect(sent.body.store).toBe(false);
  });

  it("openai no envía razonamiento a un modelo que no razona", async () => {
    const sent = await capture(
      { provider: "openai", apiKey: SECRET, modelId: "x" },
      "gpt-4.1-mini",
    );
    expect(sent.body).not.toHaveProperty("reasoning");
  });

  it("gemini traduce el razonamiento a thinkingLevel y manda la clave en cabecera", async () => {
    const sent = await capture(
      { provider: "gemini", apiKey: SECRET, modelId: "x" },
      "gemini-3.1-flash-lite",
    );
    expect(sent.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    );
    expect(sent.headers["x-goog-api-key"]).toBe(SECRET);
    expect(sent.url).not.toContain(SECRET);
    expect(sent.body.generationConfig).toMatchObject({ thinkingConfig: { thinkingLevel: "low" } });
  });

  it("openrouter adapta el razonamiento a la ficha de cada modelo", async () => {
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
    for (const [modelId, reasoning] of expected) {
      const sent = await capture({ provider: "openrouter", apiKey: SECRET, modelId }, modelId);
      expect(sent.url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(sent.body.model).toBe(modelId);
      expect(sent.body.reasoning).toEqual(reasoning);
      expect(sent.body).not.toHaveProperty("temperature");
    }
    const llama = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x" },
      "meta-llama/llama-4-maverick",
    );
    expect(llama.body).not.toHaveProperty("reasoning");
  });

  it("openrouter sin catálogo pide el nivel bajo y no bloquea la llamada", async () => {
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x" },
      "deepseek/deepseek-v4-flash",
      null,
    );
    expect(sent.body.reasoning).toEqual({ effort: "low" });
  });

  it("openrouter con LLM_REASONING_EFFORT fijado envía ese nivel sin mirar el catálogo", async () => {
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x", reasoning: "medium" },
      "deepseek/deepseek-v4-flash",
      null,
    );
    expect(sent.body.reasoning).toEqual({ effort: "medium" });
  });

  it("openrouter traduce max a xhigh, su nivel más alto", async () => {
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x", reasoning: "max" },
      "x-ai/grok-4.7",
    );
    expect(sent.body.reasoning).toEqual({ effort: "xhigh" });
  });

  it("compatible no envía razonamiento salvo que se pida y omite la clave vacía", async () => {
    const quiet = await capture(
      { provider: "compatible", apiKey: "", modelId: "x", baseURL: "http://localhost:11434/v1" },
      "qwen3:0.6b",
    );
    expect(quiet.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(quiet.body).not.toHaveProperty("reasoning_effort");
    expect(quiet.headers).not.toHaveProperty("authorization");
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
    expect(asked.body.reasoning_effort).toBe("low");
    expect(asked.headers.authorization).toBe(`Bearer ${SECRET}`);
  });

  it("omitir el razonamiento no envía el campo", async () => {
    const sent = await capture(
      { provider: "openrouter", apiKey: SECRET, modelId: "x", reasoning: null },
      "meta-llama/llama-4-maverick",
    );
    expect(sent.body).not.toHaveProperty("reasoning");
  });
});

describe("configuración del proveedor en el entorno", () => {
  const base = { APP_MODE: "real", MODEL_ID: "modelo" } satisfies WorkerEnv;

  it("sin LLM_PROVIDER sigue siendo anthropic con ANTHROPIC_API_KEY", () => {
    const settings = generationSettings({ ...base, ANTHROPIC_API_KEY: SECRET });
    expect(settings).toMatchObject({ provider: "anthropic", apiKey: SECRET });
    // Sin LLM_REASONING_EFFORT decide el proveedor (low en Anthropic).
    expect(settings).not.toHaveProperty("reasoning");
    expect(assessWorker({ ...base }).capabilities["sin-rag"].missing).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("cada proveedor pide su propia clave", () => {
    const cases = [
      ["openai", "OPENAI_API_KEY"],
      ["openrouter", "OPENROUTER_API_KEY"],
      ["gemini", "GEMINI_API_KEY"],
      ["compatible", "COMPAT_BASE_URL"],
    ] as const;
    for (const [provider, credential] of cases) {
      const env = { ...base, LLM_PROVIDER: provider, ANTHROPIC_API_KEY: SECRET };
      expect(assessWorker(env).capabilities["sin-rag"].missing).toEqual([credential]);
      const settings = generationSettings({ ...env, [credential]: "https://api.example.com/v1" });
      expect(settings?.provider).toBe(provider);
    }
  });

  it("acepta mayúsculas y espacios en LLM_PROVIDER y rechaza un nombre desconocido", () => {
    expect(
      generationSettings({ ...base, LLM_PROVIDER: " OpenRouter ", OPENROUTER_API_KEY: SECRET })
        ?.provider,
    ).toBe("openrouter");
    const report = assessWorker({ ...base, LLM_PROVIDER: "otro", ANTHROPIC_API_KEY: SECRET });
    expect(report.capabilities["sin-rag"]).toEqual({
      status: "blocked",
      missing: ["LLM_PROVIDER"],
    });
    expect(report.generation).toBeNull();
  });

  it("valida LLM_REASONING_EFFORT y admite omitir", () => {
    const env = { ...base, LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: SECRET };
    expect(generationSettings({ ...env, LLM_REASONING_EFFORT: "omitir" })?.reasoning).toBeNull();
    expect(generationSettings({ ...env, LLM_REASONING_EFFORT: "HIGH" })?.reasoning).toBe("high");
    expect(assessWorker({ ...env, LLM_REASONING_EFFORT: "mucho" }).generation).toBeNull();
    // Sin valor no se fija nivel: compatible no lo enviará (ver la prueba de su petición).
    expect(
      generationSettings({ ...base, LLM_PROVIDER: "compatible", COMPAT_BASE_URL: "https://x.dev" }),
    ).not.toHaveProperty("reasoning");
  });

  it("compatible solo envía la clave cifrada o a este mismo equipo", () => {
    expect(compatibleUrlAllowed("https://api.groq.com/openai/v1")).toBe(true);
    expect(compatibleUrlAllowed("http://localhost:11434/v1")).toBe(true);
    expect(compatibleUrlAllowed("http://127.0.0.1:8000/v1")).toBe(true);
    expect(compatibleUrlAllowed("http://servidor.example/v1")).toBe(false);
    expect(compatibleUrlAllowed("no es una url")).toBe(false);
    const env = {
      ...base,
      LLM_PROVIDER: "compatible",
      COMPAT_BASE_URL: "http://servidor.example/v1",
      COMPAT_API_KEY: SECRET,
    };
    expect(assessWorker(env).capabilities["sin-rag"].missing).toEqual(["COMPAT_BASE_URL"]);
    const local = generationSettings({ ...env, COMPAT_BASE_URL: "http://localhost:11434/v1" });
    expect(local).toMatchObject({ baseURL: "http://localhost:11434/v1", apiKey: SECRET });
  });

  it("solo Anthropic envía el espacio de trabajo", () => {
    const settings = generationSettings({
      ...base,
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: SECRET,
      ANTHROPIC_WORKSPACE_ID: "ws",
    });
    expect(settings).not.toHaveProperty("workspaceId");
  });
});

describe("visión con cualquier proveedor", () => {
  const ready = {
    APP_MODE: "real",
    RESEARCH_MEDIA: {},
    AI: {},
    LLM_PROVIDER: "openrouter",
    OPENROUTER_API_KEY: SECRET,
    RESEARCH_MODEL_ID: "google/gemini-3.1-flash-lite",
  } satisfies WorkerEnv;

  it("acepta el modelo configurado y pide la clave de ese proveedor", () => {
    expect(mediaReadiness(ready).vision).toBe("configured");
    expect(mediaMissing(ready, { image: true, audio: false, voice: false })).toEqual([]);
    expect(
      mediaMissing(
        { ...ready, OPENROUTER_API_KEY: undefined },
        { image: true, audio: false, voice: false },
      ),
    ).toEqual(["OPENROUTER_API_KEY"]);
  });

  it("con anthropic mantiene la lista de Claude con imagen documentada", () => {
    const anthropic = {
      ...ready,
      LLM_PROVIDER: "anthropic",
      ANTHROPIC_API_KEY: SECRET,
      RESEARCH_MODEL_ID: "example/text-only",
    };
    expect(mediaMissing(anthropic, { image: true, audio: false, voice: false })).toEqual([
      "RESEARCH_VISION_MODEL_ID",
    ]);
  });
});

describe("coste mostrado según la tarifa del modelo elegido", () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000 };

  it("usa MODEL_*_USD_PER_MILLION y el nombre del proveedor", () => {
    const settings = generationSettings({
      APP_MODE: "real",
      LLM_PROVIDER: "openrouter",
      OPENROUTER_API_KEY: SECRET,
      MODEL_ID: "z-ai/glm-5.3",
      MODEL_INPUT_USD_PER_MILLION: "1",
      MODEL_OUTPUT_USD_PER_MILLION: "3",
    });
    const cost = providerCost(usage, settings ? generationPricing(settings) : null);
    expect(cost).toMatchObject({ amount: 4, currency: "USD", source: "OpenRouter" });
  });

  it("sin tarifa solo Claude Haiku 5.5 por Anthropic tiene precio; otro modelo queda null", () => {
    const haiku = generationPricing({ apiKey: SECRET, modelId: "claude-haiku-5-5" });
    expect(providerCost(usage, haiku)?.amount).toBeCloseTo(0.6);
    const other = generationPricing({ provider: "openrouter", apiKey: SECRET, modelId: "x/y" });
    expect(other).toBeNull();
    expect(providerCost(usage, other)).toBeNull();
  });
});
