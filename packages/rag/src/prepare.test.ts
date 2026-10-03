import { describe, expect, it } from "vite-plus/test";
import { prepareCorpus } from "./prepare";

const files = [
  {
    path: "a.md",
    text: "---\nid: a\ntitle: A\naudience: program\nsession: S1\ncurriculum: present\nexerciseDetail: title-only\n---\n# A\n\nTexto único de prueba.",
  },
];

describe("preparación", () => {
  it("separa la versión de contenido del perfil de embeddings", () => {
    const fixture = prepareCorpus(files, {
      family: "fixture",
      model: "fixture-token-hash-v1",
      dimensions: 128,
    });
    const semantic = prepareCorpus(files, {
      family: "workers-ai",
      model: "@cf/baai/bge-m3",
      dimensions: 1024,
    });
    expect(fixture.preparationId).toBe(semantic.preparationId);
    expect(fixture.contentVersion).not.toBe(fixture.preparationId);
    expect(fixture.indexProfile.id).not.toBe(semantic.indexProfile.id);
    expect(fixture.documents[0]?.chunks[0]?.chunkId).toBe(
      semantic.documents[0]?.chunks[0]?.chunkId,
    );
    expect(fixture.indexProfile.family).toBe("fixture");
    expect(semantic.indexProfile.family).toBe("workers-ai");
  });
});
