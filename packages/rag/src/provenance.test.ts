// GUÍA DE LECTURA · packages/rag/src/provenance.test.ts
// Pruebas de procedencia: cómo se clasifica una ejecución según sus adaptadores y por qué una
// caché de embeddings de otra procedencia no se reutiliza aunque coincidan dimensión y perfil.
// Utilidades de prueba.
import { describe, expect, it } from "vite-plus/test";
// Funciones de la caché de embeddings.
import { cacheFromVectors, semanticManifest, validateEmbeddingCache } from "./embedding-cache";
// Clasificación de la procedencia.
import { classifyRuntime, usableForRemoteIndex } from "./provenance";
// Tipo del corpus preparado.
import type { PreparedCorpus } from "./prepare";

// Corpus mínimo con un documento y un fragmento.
const corpus = {
  contentVersion: "cc037ef0bb1f7",
  preparationId: "c3a59a406888b",
  version: "test",
  verifiedDate: "2026-10-03",
  embeddingModel: "fixture-token-hash-v1",
  dimensions: 128,
  remoteRevision: null,
  coverage: {
    curriculum: "partial",
    calendarLx: "partial",
    calendarMj: "partial",
    exerciseDetail: "partial",
    remote: "not-verified",
    sessions: [],
  },
  indexProfile: {
    id: "p9e8e8e03627e",
    family: "fixture",
    model: "fixture-token-hash-v1",
    dimensions: 128,
    metric: "cosine",
    chunkMaxChars: 900,
    chunkOverlap: 80,
    providerRevision: null,
    preparationId: "c3a59a406888b",
  },
  documents: [
    {
      id: "s05-langgraph",
      title: "S5",
      audience: "program",
      session: "S5",
      verified: "2026-10-03",
      source: "temario",
      sourcePath: "program/s05-langgraph.md",
      sourceHash: "hash-s5",
      curriculum: "present",
      exerciseDetail: "summary",
      body: "LangGraph modela el estado.",
      chunks: [
        {
          chunkId: "c3a59a406888b:s05-langgraph:00",
          vectorId: "c3a59a406888b:s05-langgraph:00",
          section: "S5",
          text: "LangGraph modela el estado.",
          ordinal: 0,
        },
      ],
    },
  ],
} as PreparedCorpus;

// Grupo de pruebas de procedencia.
describe("procedencia", () => {
  // La procedencia sale de los adaptadores usados, no de lo que diga quien llama.
  it("clasifica el adaptador usado y no un booleano del llamador", () => {
    // Embebedor emulado: emulación local, no en vivo.
    expect(
      classifyRuntime([{ id: "local-emulated-embedder", remote: false, binding: null }]),
    ).toEqual({ provenance: "local-native-emulation", live: false });
    // Workers AI remoto: en vivo.
    expect(classifyRuntime([{ id: "workers-ai-binding", remote: true, binding: "AI" }])).toEqual({
      provenance: "remote-binding",
      live: true,
    });
    // Tablas en memoria: datos de prueba.
    expect(classifyRuntime([{ id: "memory-tables", remote: false, binding: null }])).toEqual({
      provenance: "fixture",
      live: false,
    });
    // Sin adaptadores: desconocido.
    expect(classifyRuntime([])).toEqual({ provenance: "unknown", live: null });
    // La emulación no valida el índice remoto.
    expect(usableForRemoteIndex("local-native-emulation")).toBe(false);
    // Solo los bindings remotos lo validan.
    expect(usableForRemoteIndex("remote-binding")).toBe(true);
  });

  // Una caché hecha con datos de prueba no vale para la emulación local.
  it("no reutiliza una caché fixture aunque coincidan dimensión y perfil", () => {
    // Manifiesto semántico de 32 dimensiones.
    const manifest = semanticManifest(corpus, 32);
    // Un vector de 32 valores.
    const row = Array.from({ length: 32 }, () => 0.1);
    // Caché marcada como datos de prueba.
    const fixture = cacheFromVectors(manifest, [row], null, "fixture");
    // Se valida como si fuera emulación local.
    const rejected = validateEmbeddingCache(fixture, manifest, "local-native-emulation");
    // Rechazada por procedencia distinta.
    expect(rejected.ok).toBe(false);
    // Caché de la misma procedencia.
    const accepted = validateEmbeddingCache(
      cacheFromVectors(
        manifest,
        [Array.from({ length: 32 }, () => 0.1)],
        null,
        "local-native-emulation",
      ),
      manifest,
      "local-native-emulation",
    );
    // Aceptada.
    expect(accepted.ok).toBe(true);
  });
});
