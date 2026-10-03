import { describe, expect, it } from "vite-plus/test";
import { cacheFromVectors, semanticManifest, validateEmbeddingCache } from "./embedding-cache";
import { classifyRuntime, usableForRemoteIndex } from "./provenance";
import type { PreparedCorpus } from "./prepare";

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

describe("procedencia", () => {
  it("clasifica el adaptador usado y no un booleano del llamador", () => {
    expect(
      classifyRuntime([{ id: "local-emulated-embedder", remote: false, binding: null }]),
    ).toEqual({ provenance: "local-native-emulation", live: false });
    expect(classifyRuntime([{ id: "workers-ai-binding", remote: true, binding: "AI" }])).toEqual({
      provenance: "remote-binding",
      live: true,
    });
    expect(classifyRuntime([{ id: "memory-tables", remote: false, binding: null }])).toEqual({
      provenance: "fixture",
      live: false,
    });
    expect(classifyRuntime([])).toEqual({ provenance: "unknown", live: null });
    expect(usableForRemoteIndex("local-native-emulation")).toBe(false);
    expect(usableForRemoteIndex("remote-binding")).toBe(true);
  });

  it("no reutiliza una caché fixture aunque coincidan dimensión y perfil", () => {
    const manifest = semanticManifest(corpus, 32);
    const row = Array.from({ length: 32 }, () => 0.1);
    const fixture = cacheFromVectors(manifest, [row], null, "fixture");
    const rejected = validateEmbeddingCache(fixture, manifest, "local-native-emulation");
    expect(rejected.ok).toBe(false);
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
    expect(accepted.ok).toBe(true);
  });
});
