// GUÍA DE LECTURA · scripts/ingest-readback.test.ts
// Prueba que la ingesta reanuda una lectura fallida en lotes de 20 sin repetir la escritura ya aceptada.
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Funciones de prueba.
import { expect, it } from "vite-plus/test";
// Manifiesto, nombre del índice y tipo del corpus.
import { semanticManifest, vectorizeIndexName, type PreparedCorpus } from "@thepower-rag/core";
// Añade los textos de las fuentes.
import { attachSourceBodies } from "./source-bodies";
// Bindings simulados en memoria.
import { createMemoryBindings } from "../apps/api/src/memory-bindings";
// Ingesta que se prueba.
import { runBoundIngestion } from "../apps/api/src/ingest-run";

// Una lectura falla tras escribir: al reanudar no se escribe otra vez.
it("reanuda una lectura fallida en lotes de 20 sin repetir el upsert aceptado", async () => {
  // Corpus preparado.
  const raw = JSON.parse(
    readFileSync(new URL("../corpus/prepared/corpus.json", import.meta.url), "utf8"),
  ) as PreparedCorpus;
  // Con textos.
  const corpus = await attachSourceBodies(
    raw,
    new URL("../corpus/sources", import.meta.url).pathname,
  );
  // Manifiesto de 32 dimensiones.
  const manifest = semanticManifest(corpus, 32);
  // Bindings simulados.
  const bindings = createMemoryBindings({ dimensions: 32 });
  // Lectura original.
  const original = bindings.VECTORIZE.getByIds.bind(bindings.VECTORIZE);
  // Fallará una vez.
  let failOnce = true;
  // Tamaños de lote pedidos.
  const sizes: number[] = [];
  // Lectura que falla la primera vez y no admite más de 20 ids.
  bindings.VECTORIZE.getByIds = async (ids) => {
    // Guarda el tamaño.
    sizes.push(ids.length);
    // Vectorize no admite más de 20 ids.
    if (ids.length > 20) throw new Error("max id count is 20");
    // Primera vez.
    if (failOnce) {
      // Ya no fallará.
      failOnce = false;
      // Fallo transitorio.
      throw new Error("transient read failure after accepted upsert");
    }
    // Lectura normal.
    return original(ids);
  };
  // Vectores de prueba.
  const vectors = manifest.chunks.map(() => Array.from({ length: 32 }, () => 0.1));
  // Datos del índice que se comprueban.
  const observed = {
    metric: "cosine",
    reportedName: vectorizeIndexName(manifest.profileId),
    expectedIndexName: vectorizeIndexName(manifest.profileId),
  };
  // Primera pasada: falla en la lectura.
  const first = await runBoundIngestion(bindings, manifest, vectors, [], observed);
  // Fallida.
  expect(first.phase).toBe("failed");
  // Una escritura.
  expect(bindings.upserts).toBe(1);
  // Reanuda con el diario.
  const resumed = await runBoundIngestion(bindings, manifest, vectors, first.journal, observed);
  // Lista.
  expect(resumed.phase).toBe("ready");
  // Sin otra escritura.
  expect(bindings.upserts).toBe(1);
  // Lotes de 20 como máximo.
  expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
  // El paso de vectores consta como hecho.
  expect(resumed.journal.find((item) => item.key === "vectors")?.outcome).toBe("succeeded");
});
