// GUÍA DE LECTURA · apps/api/src/chat-corpus.test.ts
// Pruebas sin red del corpus del chat: CHAT_CORPUS elige el curso o la tienda Zocomar para Sin RAG,
// RAG básico y CRAG; la investigación de S12 sigue leyendo el curso; la tienda no pide grupo ni
// calendario; los prompts cambian de papel pero conservan las reglas de DATOS y citas.
// Esquema de salud.
import { healthResponseSchema } from "@thepower-rag/contracts";
// Embedding léxico de prueba y tipo de fragmento.
import { fixtureEmbed, type IndexedChunk } from "@thepower-rag/core";
// Stream simulado y tipo de modelo del AI SDK.
import { simulateReadableStream, type LanguageModel } from "ai";
// Modelo simulado.
import { MockLanguageModelV4 } from "ai/test";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// App que se prueba.
import { createApp, type AppDeps } from "./app";
// Diagnóstico del Worker.
import { assessWorker, type WorkerEnv } from "./env";
// Prompts del chat.
import { CRAG_PROMPT, RAG_PROMPT, chatPrompts, ragSystem } from "./prompts";

// Entorno real con los dos corpus: el curso (investigación) y la tienda (chat).
const storeEnv: WorkerEnv = {
  // Generación.
  APP_MODE: "real",
  ANTHROPIC_API_KEY: "local-test-key",
  MODEL_ID: "example/generator",
  EVALUATOR_MODEL_ID: "example/evaluator",
  // Embeddings compartidos.
  EMBEDDING_MODEL: "@cf/baai/bge-m3",
  EMBEDDING_DIMENSIONS: "32",
  VECTOR_METRIC: "cosine",
  // Curso: lo que lee la investigación.
  CORPUS_VERSION: "curso-v",
  INDEX_PROFILE: "p-curso",
  MIN_RETRIEVAL_SCORE: "0.5",
  // Tienda: lo que lee el chat.
  CHAT_CORPUS: "zocomar",
  STORE_CORPUS_VERSION: "tienda-v",
  STORE_INDEX_PROFILE: "p-tienda",
  STORE_MIN_RETRIEVAL_SCORE: "0.2",
  // Bindings vacíos: los datos los inyecta cada prueba.
  AI: {},
  VECTORIZE: {},
  VECTORIZE_STORE: {},
  DB: {},
  CORPUS: {},
};

// Mensaje de usuario con una parte de texto.
function userMessage(text: string) {
  // Id, papel y partes.
  return { id: "user-1", role: "user" as const, parts: [{ type: "text" as const, text }] };
}

// POST /api/chat en memoria.
function postChat(body: unknown, env: WorkerEnv, deps: AppDeps = {}): Promise<Response> {
  // request() de Hono no abre un puerto.
  return Promise.resolve(
    createApp(deps).request(
      "/api/chat",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      env,
    ),
  );
}

// Modelo simulado que devuelve un texto y guarda lo que recibió.
function mockModel(text: string, calls: { count: number; prompt: string }): LanguageModel {
  // Stream mínimo con texto y consumo.
  return new MockLanguageModelV4({
    // Cuenta la llamada y guarda sus opciones.
    doStream: async (options) => {
      // Cuenta.
      calls.count += 1;
      // Opciones enviadas (incluye el sistema).
      calls.prompt = JSON.stringify(options);
      // Inicio, texto, fin y consumo.
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: "text-start", id: "t" },
            { type: "text-delta", id: "t", delta: text },
            { type: "text-end", id: "t" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: undefined },
              logprobs: undefined,
              usage: {
                inputTokens: { total: 4, noCache: 4, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 2, text: 2, reasoning: undefined },
              },
            },
          ],
        }),
      };
    },
  });
}

// Fragmento de la tienda con su vector léxico.
function storeChunk(text: string): IndexedChunk {
  // Política de atención al cliente de Zocomar.
  return {
    documentId: "11-atencion-al-cliente",
    chunkId: "tienda-v:11-atencion-al-cliente:00",
    title: "Atención al cliente",
    section: "Canales y horarios",
    text,
    audience: "program",
    corpusVersion: "tienda-v",
    vector: fixtureEmbed(text),
  };
}

// Perfil listo del índice de la tienda.
const storeProfile = {
  id: "p-tienda",
  corpusVersion: "tienda-v",
  embeddingModel: "@cf/baai/bge-m3",
  dimensions: 32,
  metric: "cosine" as const,
  family: "workers-ai" as const,
  status: "ready" as const,
  providerRevision: null,
};

// Diagnóstico de la configuración.
describe("corpus del chat · diagnóstico", () => {
  // Con la tienda, el chat usa sus ajustes y la investigación los del curso.
  it("separa el corpus del chat del de la investigación", () => {
    // Diagnóstico.
    const assessment = assessWorker(storeEnv);
    // Chat con la tienda.
    expect(assessment.chatCorpus).toBe("zocomar");
    expect(assessment.chatRetrieval).toMatchObject({
      corpusVersion: "tienda-v",
      indexProfile: "p-tienda",
      minScore: 0.2,
    });
    // La investigación sigue con el curso.
    expect(assessment.retrieval).toMatchObject({
      corpusVersion: "curso-v",
      indexProfile: "p-curso",
      minScore: 0.5,
    });
    // RAG y CRAG listos con la tienda.
    expect(assessment.capabilities.rag.status).toBe("ready");
    expect(assessment.capabilities.crag.status).toBe("ready");
  });

  // Sin CHAT_CORPUS todo sigue como antes.
  it("sin CHAT_CORPUS el chat usa el curso", () => {
    // Entorno sin la variable.
    const { CHAT_CORPUS: _ignored, ...courseEnv } = storeEnv;
    // Diagnóstico.
    const assessment = assessWorker(courseEnv);
    // Curso.
    expect(assessment.chatCorpus).toBe("course");
    // Mismos ajustes que la investigación.
    expect(assessment.chatRetrieval).toEqual(assessment.retrieval);
  });

  // La demo siempre trae el curso.
  it("la demo informa del curso aunque CHAT_CORPUS diga tienda", () => {
    // Demo.
    const assessment = assessWorker({ CHAT_CORPUS: "zocomar" });
    // Curso.
    expect(assessment.chatCorpus).toBe("course");
  });

  // Lo que falta de la tienda bloquea el chat, nunca la investigación.
  it("bloquea RAG y CRAG de la tienda sin su índice o con el umbral sin calibrar", () => {
    // Sin el índice de la tienda.
    const { VECTORIZE_STORE: _index, ...withoutIndex } = storeEnv;
    // Diagnóstico.
    const missingIndex = assessWorker(withoutIndex);
    // RAG bloqueado por el binding.
    expect(missingIndex.capabilities.rag.status).toBe("blocked");
    expect(missingIndex.capabilities.rag.missing).toContain("VECTORIZE_STORE");
    // La investigación no depende del índice de la tienda.
    expect(missingIndex.capabilities.research.missing).not.toContain("VECTORIZE_STORE");
    // El curso sigue disponible para la investigación.
    expect(missingIndex.retrieval?.corpusVersion).toBe("curso-v");

    // Umbral con el marcador de producción.
    const placeholder = assessWorker({
      ...storeEnv,
      STORE_MIN_RETRIEVAL_SCORE: "replace-with-calibrated-store-score",
    });
    // Bloqueado: no se usa otro umbral en su lugar.
    expect(placeholder.capabilities.crag.status).toBe("blocked");
    expect(placeholder.capabilities.crag.missing).toContain("STORE_MIN_RETRIEVAL_SCORE");
    expect(placeholder.chatRetrieval).toBeNull();
  });

  // El contexto completo es solo del curso.
  it("rechaza el contexto completo con la tienda y lo mantiene con el curso", () => {
    // Tienda con complete.
    const store = assessWorker({ ...storeEnv, RAG_CONTEXT_MODE: "complete" });
    // Bloqueado con el motivo.
    expect(store.capabilities.rag.missing).toContain("RAG_CONTEXT_MODE");
    // Curso con complete.
    const course = assessWorker({
      ...storeEnv,
      CHAT_CORPUS: "course",
      RAG_CONTEXT_MODE: "complete",
    });
    // Listo como antes.
    expect(course.capabilities.rag.status).toBe("ready");
  });

  // Un valor desconocido no se adivina.
  it("bloquea el chat con un CHAT_CORPUS desconocido", () => {
    // Diagnóstico.
    const assessment = assessWorker({ ...storeEnv, CHAT_CORPUS: "otra-tienda" });
    // Sin corpus.
    expect(assessment.chatCorpus).toBeNull();
    // Las tres etapas del chat bloqueadas.
    for (const stage of ["sin-rag", "rag", "crag"] as const) {
      // Con el motivo.
      expect(assessment.capabilities[stage].missing).toContain("CHAT_CORPUS");
    }
    // La investigación no lo menciona.
    expect(assessment.capabilities.research.missing).not.toContain("CHAT_CORPUS");
  });
});

// Instrucciones.
describe("corpus del chat · prompts", () => {
  // La tienda cambia el papel y conserva las reglas.
  it("cambia el papel y conserva DATOS, PERMITIDOS y citas", () => {
    // Prompts de la tienda.
    const store = chatPrompts("zocomar");
    // Ids propios.
    expect([store.sinRag.id, store.rag.id, store.crag.id]).toEqual([
      "sin-rag-zocomar-v1",
      "rag-zocomar-v1",
      "crag-zocomar-v1",
    ]);
    // Papel de la tienda.
    expect(store.rag.text).toContain("Zocomar");
    // Mismas reglas que el curso salvo la primera línea.
    expect(store.rag.text.split("\n").slice(1)).toEqual(RAG_PROMPT.text.split("\n").slice(1));
    expect(store.crag.text).toContain("La pregunta del cliente es la original");
    // El curso conserva sus ids.
    expect(chatPrompts("course").crag.id).toBe(CRAG_PROMPT.id);
    // El sistema con evidencia lleva el papel de la tienda.
    expect(ragSystem([storeChunk("Atiende de 8:00 a 22:00.")], "zocomar")).toContain("Zocomar");
  });
});

// Rutas HTTP.
describe("corpus del chat · /api/chat y /api/health", () => {
  // «Horario» no es calendario en la tienda.
  it("no pide grupo con la tienda y responde con su prompt", async () => {
    // Pregunta con «horario».
    const question = "¿En qué horario atiende el chat de la aplicación?";
    // Política con la respuesta.
    const chunk = storeChunk("El chat de la aplicación atiende todos los días de 8:00 a 22:00.");
    // Llamadas al modelo.
    const calls = { count: 0, prompt: "" };
    // Turno RAG con la tienda.
    const response = await postChat(
      { mode: "rag", audience: "program", messages: [userMessage(question)] },
      storeEnv,
      {
        chunks: [chunk],
        embed: fixtureEmbed,
        profile: storeProfile,
        languageModel: mockModel(`De 8:00 a 22:00 [cite:${chunk.chunkId}]`, calls),
      },
    );
    // Cuerpo.
    const raw = await response.text();
    // Respuesta, no aclaración.
    expect(response.status).toBe(200);
    expect(raw).not.toContain("Elige el grupo");
    // Una llamada con el papel y la evidencia de la tienda.
    expect(calls.count).toBe(1);
    expect(calls.prompt).toContain("Zocomar");
    expect(calls.prompt).toContain("8:00 a 22:00");
    // Id del prompt de la tienda en los metadatos.
    expect(raw).toContain("rag-zocomar-v1");

    // Con el curso, la misma pregunta pide grupo y no llama al modelo.
    const courseCalls = { count: 0, prompt: "" };
    const course = await postChat(
      { mode: "rag", audience: "program", messages: [userMessage(question)] },
      { ...storeEnv, CHAT_CORPUS: "course" },
      { chunks: [chunk], embed: fixtureEmbed, languageModel: mockModel("no", courseCalls) },
    );
    expect(await course.text()).toContain("Elige el grupo");
    expect(courseCalls.count).toBe(0);
  });

  // Sin RAG usa el papel de la tienda.
  it("sin RAG responde como asistente de la tienda", async () => {
    // Llamadas.
    const calls = { count: 0, prompt: "" };
    // Turno sin RAG.
    const response = await postChat(
      { mode: "sin-rag", messages: [userMessage("¿Cuántos días tengo para devolver?")] },
      storeEnv,
      { languageModel: mockModel("No consta.", calls) },
    );
    // Correcto.
    expect(response.status).toBe(200);
    await response.text();
    // Papel de la tienda.
    expect(calls.prompt).toContain("Zocomar");
    expect(calls.prompt).toContain("no inventes plazos");
  });

  // La salud separa el corpus del chat del de la investigación.
  it("informa del corpus del chat y conserva el del curso para la investigación", async () => {
    // Salud.
    const response = await createApp().request("/api/health", { method: "GET" }, storeEnv);
    // Validada.
    const body = healthResponseSchema.parse(await response.json());
    // Corpus del curso (investigación).
    expect(body.corpus.version).toBe("curso-v");
    expect(body.corpus.profileId).toBe("p-curso");
    // Corpus del chat.
    expect(body.chatCorpus).toMatchObject({
      id: "zocomar",
      version: "tienda-v",
      profileId: "p-tienda",
      minScore: 0.2,
      groups: false,
      remote: "not-verified",
    });
    // Umbral del chat en la configuración publicada.
    expect(body.modelConfiguration?.retrievalMinScore).toBe(0.2);
  });
});
