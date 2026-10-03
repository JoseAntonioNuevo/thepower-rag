import { readFileSync } from "node:fs";
import { expect, it } from "vite-plus/test";
import { semanticManifest, vectorizeIndexName, type PreparedCorpus } from "@thepower-rag/core";
import { attachSourceBodies } from "./source-bodies";
import { createMemoryBindings } from "../apps/api/src/memory-bindings";
import { runBoundIngestion } from "../apps/api/src/ingest-run";

it("reanuda una lectura fallida en lotes de 20 sin repetir el upsert aceptado", async () => {
  const raw = JSON.parse(
    readFileSync(new URL("../corpus/prepared/corpus.json", import.meta.url), "utf8"),
  ) as PreparedCorpus;
  const corpus = await attachSourceBodies(
    raw,
    new URL("../corpus/sources", import.meta.url).pathname,
  );
  const manifest = semanticManifest(corpus, 32);
  const bindings = createMemoryBindings({ dimensions: 32 });
  const original = bindings.VECTORIZE.getByIds.bind(bindings.VECTORIZE);
  let failOnce = true;
  const sizes: number[] = [];
  bindings.VECTORIZE.getByIds = async (ids) => {
    sizes.push(ids.length);
    if (ids.length > 20) throw new Error("max id count is 20");
    if (failOnce) {
      failOnce = false;
      throw new Error("transient read failure after accepted upsert");
    }
    return original(ids);
  };
  const vectors = manifest.chunks.map(() => Array.from({ length: 32 }, () => 0.1));
  const observed = {
    metric: "cosine",
    reportedName: vectorizeIndexName(manifest.profileId),
    expectedIndexName: vectorizeIndexName(manifest.profileId),
  };
  const first = await runBoundIngestion(bindings, manifest, vectors, [], observed);
  expect(first.phase).toBe("failed");
  expect(bindings.upserts).toBe(1);
  const resumed = await runBoundIngestion(bindings, manifest, vectors, first.journal, observed);
  expect(resumed.phase).toBe("ready");
  expect(bindings.upserts).toBe(1);
  expect(Math.max(...sizes)).toBeLessThanOrEqual(20);
  expect(resumed.journal.find((item) => item.key === "vectors")?.outcome).toBe("succeeded");
});
