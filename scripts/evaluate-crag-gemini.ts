import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  createAllowanceLedger,
  validateRankingAndAssessment,
  type CragChunk,
} from "@thepower-rag/core";
import { createRealCragPorts } from "../apps/api/src/crag-real";
import { createEvaluatorModel, createGenerationModel, HAIKU_MODEL_ID } from "../apps/api/src/model";
import { readRepoAnthropicKey } from "./anthropic-key";
import type { EmbeddingRunner } from "../apps/api/src/vectors";
import type { SqlDatabase, VectorIndex } from "../apps/api/src/stores";
import corpus from "../corpus/prepared/corpus.json";
import { COURSE_DESTINATION } from "./course-destination";

const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--execute")) {
  console.log("Siete llamadas dirigidas preparadas; sin --execute no hay red ni gasto.");
  process.exit(0);
}
const auth = JSON.parse(readFileSync(path.join(root, "apps/web/.activation.json"), "utf8"));
if (
  auth.accountId !== COURSE_DESTINATION.accountId ||
  !auth.allowOpenRouter ||
  auth.maxSpendUsd !== 5
)
  throw new Error("Falta autorización del curso.");
const out = path.join(root, "docs/evidence/crag-gemini");
mkdirSync(out, { recursive: true });
const continuing = process.argv.includes("--continue");
const file = path.join(out, continuing ? "continuation-results.json" : "directed-results.json");
if (continuing && !existsSync(path.join(out, "directed-results.json")))
  throw new Error("No existe la primera prueba.");
if (existsSync(file)) throw new Error("Ya hay evidencia; no se repite automáticamente.");
const key = readRepoAnthropicKey(root);
if (!key) throw new Error("Falta ANTHROPIC_API_KEY en .env.");
const maxSpend = continuing ? 0.12 : 0.25;
const ledger = createAllowanceLedger({
  maxSpendUsd: maxSpend,
  maxGenerativeCalls: continuing ? 5 : 7,
  maxEmbeddingCalls: 0,
  prices: {
    embeddingUsdPerMillionInput: null,
    generativeUsdPerMillionInput: 0.1,
    generativeUsdPerMillionOutput: 0.5,
  },
});
const scope = {
  runId: crypto.randomUUID(),
  audience: "program" as const,
  corpusVersion: corpus.preparationId,
  profileId: "p76509a5f9743",
  embeddingLabel: "not-used-directed-evaluator-test",
};
const chunks: CragChunk[] = corpus.documents
  .filter((d) => d.audience === "program")
  .flatMap((d) =>
    d.chunks.map((c) => ({
      ...c,
      documentId: d.id,
      title: d.title,
      audience: "program" as const,
      corpusVersion: corpus.preparationId,
      profileId: scope.profileId,
      score: null,
    })),
  );
const find = (id: string) => chunks.filter((c) => c.documentId === id);
const s5 = find("s05-langgraph");
const s6 = find("s06-observabilidad");
const s16 = find("s16-cloud-aws");
if (!s5.length || !s6.length || !s16.length) throw new Error("Faltan fragmentos.");
const ports = createRealCragPorts({
  signal: new AbortController().signal,
  scope,
  embedder: {} as EmbeddingRunner,
  index: {} as VectorIndex,
  database: {} as SqlDatabase,
  evaluator: createEvaluatorModel({
    apiKey: key,
    modelId: HAIKU_MODEL_ID,
    evaluatorModelId: HAIKU_MODEL_ID,
  }),
  generator: createGenerationModel({ apiKey: key, modelId: HAIKU_MODEL_ID }),
  messages: [{ role: "user", content: "¿Cómo modela LangGraph un agente con estado y nodos?" }],
  embeddingModel: "not-used",
  dimensions: 1024,
  allowance: ledger,
});
const cases = [
  {
    id: "sufficient",
    question: "¿Cómo modela LangGraph un agente con estado y nodos?",
    chunks: s5,
    expected: "sufficient",
  },
  {
    id: "partial",
    question: "Explica LangGraph y cómo instrumentar el agente con Langfuse y LangSmith.",
    chunks: s5,
    expected: "partial",
  },
  {
    id: "combined",
    question: "Explica LangGraph y cómo instrumentar el agente con Langfuse y LangSmith.",
    chunks: [...s5, ...s6],
    expected: "sufficient",
  },
  {
    id: "irrelevant",
    question: "¿Cómo modela LangGraph un agente con estado y nodos?",
    chunks: s16,
    expected: "insufficient",
  },
  {
    id: "unknown",
    question: "¿Qué beca interna de 1991 cubre el programa?",
    chunks: [...s5, ...s16],
    expected: "insufficient",
  },
];
const results: unknown[] = [];
const evidence = {
  at: new Date().toISOString(),
  evaluator: HAIKU_MODEL_ID,
  generator: HAIKU_MODEL_ID,
  provenance: "real Claude API SDK, versioned local course chunks; no retrieval or public endpoint",
  maxSpendUsd: maxSpend,
  endpointPricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
  results,
};
const save = () =>
  writeFileSync(
    file,
    JSON.stringify({ ...evidence, allowance: ledger.snapshot() }, null, 2) + "\n",
  );
const pendingCases = continuing
  ? [
      {
        id: "combined-course-summary",
        question:
          "¿Qué contenidos se enseñan en S5 LangGraph y S6 Langfuse y LangSmith? Resume el temario, sin pedir código.",
        chunks: [...s5, ...s6],
        expected: "sufficient",
      },
      ...cases.filter((c) => c.id === "irrelevant" || c.id === "unknown"),
    ]
  : cases;
for (const c of pendingCases) {
  if (!ports.reserve("evaluation").ok) throw new Error("Reserva denegada.");
  const start = Date.now();
  try {
    const result = await ports.rankAndAssess({
      question: c.question,
      query: c.question,
      chunks: c.chunks,
      attempt: 1,
      remainingMs: 20000,
    });
    const validated = result.ok ? validateRankingAndAssessment(c.chunks, result.raw) : result;
    const passed =
      validated.ok && "assessment" in validated && validated.assessment.status === c.expected;
    results.push({
      id: c.id,
      expected: c.expected,
      durationMs: Date.now() - start,
      passed,
      result,
      validated,
    });
    save();
    console.log({ id: c.id, passed, durationMs: Date.now() - start });
    if (!passed) throw new Error("La evaluación no cumplió el contrato; ver evidencia privada.");
  } catch (e) {
    save();
    throw e;
  }
}
if (!ports.reserve("reformulation").ok) throw new Error("Reserva denegada.");
const rewrite = await ports.reformulate({
  question: cases[1]!.question,
  query: "LangGraph estado nodos",
  gaps: ["instrumentación Langfuse y LangSmith"],
  attempt: 1,
  remainingMs: 20000,
});
results.push({ id: "rewrite", result: rewrite });
save();
if (!rewrite.ok) throw new Error("Reformulación fallida.");
if (!ports.reserve("generation").ok) throw new Error("Reserva denegada.");
const generated = await ports.generate({
  question: cases[0]!.question,
  evidence: s5,
  remainingMs: 20000,
});
results.push({ id: "generation-luna", result: generated });
save();
if (!generated.ok || !generated.text.includes("[cite:"))
  throw new Error("Generación sin respuesta o cita.");
console.log("Prueba dirigida completada; decisiones y respuesta guardadas.");
