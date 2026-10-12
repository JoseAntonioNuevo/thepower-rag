// GUÍA DE LECTURA · packages/rag/src/prepare.test.ts
// Prueba de la preparación: el mismo contenido da la misma versión de preparación y los mismos
// ids de fragmento con dos perfiles de embeddings distintos, pero cada perfil tiene su propio id.
// describe agrupa pruebas, it define una y expect comprueba un resultado.
import { describe, expect, it } from "vite-plus/test";
// Función que se pone a prueba.
import { prepareCorpus } from "./prepare";

// Un documento mínimo con cabecera válida.
const files = [
  {
    path: "a.md",
    text: "---\nid: a\ntitle: A\naudience: program\nsession: S1\ncurriculum: present\nexerciseDetail: title-only\n---\n# A\n\nTexto único de prueba.",
  },
];

// Grupo de pruebas de la preparación.
describe("preparación", () => {
  // Cambiar de embedding no cambia la versión del contenido, pero sí el perfil.
  it("separa la versión de contenido del perfil de embeddings", () => {
    // Preparación con el perfil léxico de la demo.
    const fixture = prepareCorpus(files, {
      family: "fixture",
      model: "fixture-token-hash-v1",
      dimensions: 128,
    });
    // Preparación con BGE-M3.
    const semantic = prepareCorpus(files, {
      family: "workers-ai",
      model: "@cf/baai/bge-m3",
      dimensions: 1024,
    });
    // Misma versión de preparación.
    expect(fixture.preparationId).toBe(semantic.preparationId);
    // La versión de contenido y la de preparación son distintas.
    expect(fixture.contentVersion).not.toBe(fixture.preparationId);
    // Perfiles distintos.
    expect(fixture.indexProfile.id).not.toBe(semantic.indexProfile.id);
    // Mismos ids de fragmento en los dos perfiles.
    expect(fixture.documents[0]?.chunks[0]?.chunkId).toBe(
      semantic.documents[0]?.chunks[0]?.chunkId,
    );
    // Familia de la demo.
    expect(fixture.indexProfile.family).toBe("fixture");
    // Familia de Workers AI.
    expect(semantic.indexProfile.family).toBe("workers-ai");
  });
});
