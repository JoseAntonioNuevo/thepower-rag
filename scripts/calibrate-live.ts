import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { semanticIdentity, vectorizeIndexName, type PreparedCorpus } from "@thepower-rag/core";
import { parseActivation, missingFor } from "./activation";
import { startOwnedBridge } from "./runtime-plane";
import { createWranglerRunner } from "./process-runner";
import { createBridgePlane } from "./bridge-client";
import { openExecutionSession, saveExecutionSession } from "./execution-session";
import { loopbackFetch } from "./loopback-fetch";
import { writeAtomic } from "./course-runtime";

const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--execute")) {
  console.log("Calibración preparada; sin --execute no hay red.");
  process.exit(0);
}
const parsed = parseActivation(
  JSON.parse(readFileSync(path.join(root, "apps/web/.activation.json"), "utf8")),
);
if (!parsed.ok || missingFor("ingest", parsed.auth, null).length || !parsed.auth.observedDimensions)
  throw new Error("Falta autorización de Workers AI e índice medido.");
const auth = parsed.auth;
const corpus = JSON.parse(
  readFileSync(path.join(root, "corpus/prepared/corpus.json"), "utf8"),
) as PreparedCorpus;
const profile = semanticIdentity(corpus, auth.observedDimensions!);
// Development examples only. The reserved comparison set is never used to tune this threshold.
const cases = [
  {
    text: "¿Cómo modela LangGraph un agente con estado y nodos?",
    audience: "program",
    supported: true,
  },
  { text: "¿Cuándo es la clase de RAG S10?", audience: "M/J", supported: true },
  {
    text: "¿Qué diferencias hay entre modelos abiertos y cerrados?",
    audience: "program",
    supported: true,
  },
  {
    text: "¿Qué enseña la sesión de observabilidad Langfuse y LangSmith?",
    audience: "program",
    supported: true,
  },
  {
    text: "¿Qué hace CRAG cuando la evidencia no es suficiente?",
    audience: "program",
    supported: true,
  },
  {
    text: "¿Qué beca interna del año 1991 cubre este programa?",
    audience: "program",
    supported: false,
  },
  { text: "¿Cuál es la contraseña del wifi del aula?", audience: "program", supported: false },
  { text: "¿Qué menú de comedor hay mañana en el curso?", audience: "program", supported: false },
];
const owned = await startOwnedBridge({
  accountId: auth.accountId!,
  port: 8791,
  inspectorPort: 8792,
  token: randomBytes(24).toString("hex"),
  projectRoot: root,
  role: "storage",
  remote: true,
  offline: false,
  persistDir: path.join(root, "activation-receipts/wrangler-state"),
  indexName: vectorizeIndexName(profile.id),
  dimensions: auth.observedDimensions!,
  runner: createWranglerRunner(
    path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
    root,
  ),
});
const file = path.join(root, "activation-receipts/allowance-session.json");
const ledger = await openExecutionSession({
  file,
  accountId: auth.accountId!,
  profileId: profile.id,
  provenance: "remote-binding",
  pricesSynthetic: false,
  maxSpendUsd: auth.maxSpendUsd!,
  maxGenerativeCalls: 4,
  maxEmbeddingCalls: 128,
  prices: {
    embeddingUsdPerMillionInput: 0.0118,
    generativeUsdPerMillionInput: null,
    generativeUsdPerMillionOutput: null,
  },
});
try {
  const plane = await createBridgePlane({ origin: owned.origin, token: owned.token });
  const reservation = ledger.reserve({
    kind: "embedding",
    calls: cases.length,
    maxInputTokens: 2000,
  });
  if (!reservation.ok) throw new Error(reservation.reason);
  const embedded = await plane.embed(
    cases.map((c) => c.text),
    reservation.id,
  );
  ledger.settle(reservation.id, null);
  const observations = [];
  for (let i = 0; i < cases.length; i++) {
    const response = await loopbackFetch(owned.origin + "/bridge", {
      method: "POST",
      headers: { "content-type": "application/json", "x-thepower-bridge": owned.token },
      body: JSON.stringify({
        op: "query",
        vector: embedded.vectors[i],
        audience: cases[i]!.audience,
        profileId: profile.id,
      }),
    });
    const result = (await response.json()) as {
      ok: boolean;
      hits: { matches: { id: string; score: number }[] };
    };
    if (!response.ok || !result.ok) throw new Error("No se pudo medir la recuperación.");
    observations.push({
      ...cases[i]!,
      matches: result.hits.matches.map((h) => ({ id: h.id, score: h.score })),
    });
  }
  await writeAtomic(
    path.join(root, "activation-receipts/calibration-observations.json"),
    JSON.stringify({ profileId: profile.id, observations }, null, 2) + "\n",
  );
  const positives = observations.filter((o) => o.supported).map((o) => o.matches[0]?.score ?? -1);
  const negatives = observations.filter((o) => !o.supported).map((o) => o.matches[0]?.score ?? -1);
  const minPositive = Math.min(...positives),
    maxNegative = Math.max(...negatives);
  const separated = minPositive > maxNegative;

  const minScore = separated
    ? Number(((minPositive + maxNegative) / 2).toFixed(6))
    : Math.ceil((maxNegative + 0.001) * 100) / 100;
  const receipt = {
    at: new Date().toISOString(),
    profileId: profile.id,
    embeddingModel: "@cf/baai/bge-m3",
    dimensions: auth.observedDimensions,
    minScore,
    method: separated
      ? "midpoint with separation on 8 development queries"
      : "conservative cutoff above all development negatives; overlapping positive may be refused",
    developmentRecall: positives.filter((s) => s >= minScore).length / positives.length,
    minPositive,
    maxNegative,
    observations,
    reservedSetUsed: false,
  };
  await writeAtomic(
    path.join(root, "activation-receipts/calibration.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      profileId: profile.id,
      minScore,
      minPositive,
      maxNegative,
      developmentQueries: cases.length,
    }),
  );
} finally {
  await saveExecutionSession({
    file,
    accountId: auth.accountId!,
    profileId: profile.id,
    provenance: "remote-binding",
    pricesSynthetic: false,
    ledger,
  });
  await owned.shutdown();
}
