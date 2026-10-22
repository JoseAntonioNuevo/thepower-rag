// GUÍA DE LECTURA · scripts/evaluate-crag-gemini.ts
// Prueba dirigida del evaluador CRAG real con Claude Haiku 5.5: casos suficiente, parcial, combinado,
// irrelevante y desconocido, más una reformulación y una generación. Solo con --execute y con tope.
// Lectura y escritura de archivos.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Sesión de gasto, validación y tipo de fragmento.
import {
  createAllowanceLedger,
  validateRankingAndAssessment,
  type CragChunk,
} from "@thepower-rag/core";
// Puertos CRAG reales.
import { createRealCragPorts } from "../apps/api/src/crag-real";
// Fábricas de modelos.
import { createEvaluatorModel, createGenerationModel, HAIKU_MODEL_ID } from "../apps/api/src/model";
// Clave de Anthropic.
import { readRepoAnthropicKey } from "./anthropic-key";
// Tipo de embeddings.
import type { EmbeddingRunner } from "../apps/api/src/vectors";
// Tipos de D1 y Vectorize.
import type { SqlDatabase, VectorIndex } from "../apps/api/src/stores";
// Corpus preparado.
import corpus from "../corpus/prepared/corpus.json";
// Cuenta del curso.
import { COURSE_DESTINATION } from "./course-destination";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");
// Sin --execute no hay red ni gasto.
if (!process.argv.includes("--execute")) {
  // Mensaje.
  console.log("Siete llamadas dirigidas preparadas; sin --execute no hay red ni gasto.");
  // Sale.
  process.exit(0);
}
// Autorización.
const auth = JSON.parse(readFileSync(path.join(root, "apps/web/.activation.json"), "utf8"));
// Otra cuenta o tope: error.
if (
  auth.accountId !== COURSE_DESTINATION.accountId ||
  !auth.allowOpenRouter ||
  auth.maxSpendUsd !== 5
)
  // Detiene el recorrido con el diagnóstico: Falta autorización del curso.
  throw new Error("Falta autorización del curso.");
// Carpeta de evidencias.
const out = path.join(root, "docs/evidence/crag-gemini");
// La crea.
mkdirSync(out, { recursive: true });
// ¿Continuación?
const continuing = process.argv.includes("--continue");
// Archivo de resultados.
const file = path.join(out, continuing ? "continuation-results.json" : "directed-results.json");
// La continuación necesita la primera prueba.
if (continuing && !existsSync(path.join(out, "directed-results.json")))
  // Detiene el recorrido con el diagnóstico: No existe la primera prueba.
  throw new Error("No existe la primera prueba.");
// No se repite.
if (existsSync(file))
  // Detiene el recorrido con el diagnóstico: Ya hay evidencia; no se repite automáticamente.
  throw new Error("Ya hay evidencia; no se repite automáticamente.");
// Clave.
const key = readRepoAnthropicKey(root);
// Sin clave: error.
if (!key)
  // Detiene el recorrido con el diagnóstico: Falta ANTHROPIC_API_KEY en .env.
  throw new Error("Falta ANTHROPIC_API_KEY en .env.");
// Tope de gasto.
const maxSpend = continuing ? 0.12 : 0.25;
// Sesión de gasto con tarifas de Haiku.
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
// Ámbito.
const scope = {
  runId: crypto.randomUUID(),
  audience: "program" as const,
  corpusVersion: corpus.preparationId,
  profileId: "p76509a5f9743",
  embeddingLabel: "not-used-directed-evaluator-test",
};
// Fragmentos del programa.
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
// Fragmentos de un documento.
const find = (id: string) => chunks.filter((c) => c.documentId === id);
// S5.
const s5 = find("s05-langgraph");
// S6.
const s6 = find("s06-observabilidad");
// S16.
const s16 = find("s16-cloud-aws");
// Faltan fragmentos.
if (!s5.length || !s6.length || !s16.length)
  // Detiene el recorrido con el diagnóstico: Faltan fragmentos.
  throw new Error("Faltan fragmentos.");
// Puertos reales sin búsqueda (no se usa).
const ports = createRealCragPorts({
  // Señal y alcance de la prueba.
  signal: new AbortController().signal,
  scope,
  // Embeddings, índice y D1 vacíos: este script no busca.
  embedder: {} as EmbeddingRunner,
  index: {} as VectorIndex,
  database: {} as SqlDatabase,
  // Evaluador y generador con Claude Haiku 5.5.
  evaluator: createEvaluatorModel({
    apiKey: key,
    modelId: HAIKU_MODEL_ID,
    evaluatorModelId: HAIKU_MODEL_ID,
  }),
  generator: createGenerationModel({ apiKey: key, modelId: HAIKU_MODEL_ID }),
  // Historial y datos de embeddings que no se usan.
  messages: [{ role: "user", content: "¿Cómo modela LangGraph un agente con estado y nodos?" }],
  embeddingModel: "not-used",
  dimensions: 1024,
  // Sesión de gasto con tope.
  allowance: ledger,
});
// Casos con la decisión esperada.
const cases = [
  // S5 sola basta para una pregunta sobre estado y nodos.
  {
    id: "sufficient",
    question: "¿Cómo modela LangGraph un agente con estado y nodos?",
    chunks: s5,
    expected: "sufficient",
  },
  // S5 sola no cubre la parte de observabilidad: parcial.
  {
    id: "partial",
    question: "Explica LangGraph y cómo instrumentar el agente con Langfuse y LangSmith.",
    chunks: s5,
    expected: "partial",
  },
  // S5 y S6 juntas sí la cubren.
  {
    id: "combined",
    question: "Explica LangGraph y cómo instrumentar el agente con Langfuse y LangSmith.",
    chunks: [...s5, ...s6],
    expected: "sufficient",
  },
  // S16 no tiene relación: insuficiente.
  {
    id: "irrelevant",
    question: "¿Cómo modela LangGraph un agente con estado y nodos?",
    chunks: s16,
    expected: "insufficient",
  },
  // Dato que no consta: insuficiente aunque haya fragmentos.
  {
    id: "unknown",
    question: "¿Qué beca interna de 1991 cubre el programa?",
    chunks: [...s5, ...s16],
    expected: "insufficient",
  },
];
// Resultados.
const results: unknown[] = [];
// Evidencia.
const evidence = {
  at: new Date().toISOString(),
  evaluator: HAIKU_MODEL_ID,
  generator: HAIKU_MODEL_ID,
  provenance: "real Claude API SDK, versioned local course chunks; no retrieval or public endpoint",
  maxSpendUsd: maxSpend,
  endpointPricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 },
  results,
};
// Guarda la evidencia.
const save = () =>
  writeFileSync(
    file,
    JSON.stringify({ ...evidence, allowance: ledger.snapshot() }, null, 2) + "\n",
  );
// Casos de esta pasada.
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
// Cada caso.
for (const c of pendingCases) {
  // Reserva.
  if (!ports.reserve("evaluation").ok)
    // Detiene el recorrido con el diagnóstico: Reserva denegada.
    throw new Error("Reserva denegada.");
  // Inicio.
  const start = Date.now();
  // Guarda aunque falle.
  try {
    // Evaluación.
    const result = await ports.rankAndAssess({
      question: c.question,
      query: c.question,
      chunks: c.chunks,
      attempt: 1,
      remainingMs: 20000,
    });
    // Validación.
    const validated = result.ok ? validateRankingAndAssessment(c.chunks, result.raw) : result;
    // ¿Decisión esperada?
    const passed =
      validated.ok && "assessment" in validated && validated.assessment.status === c.expected;
    // Registra.
    results.push({
      id: c.id,
      expected: c.expected,
      durationMs: Date.now() - start,
      passed,
      result,
      validated,
    });
    // Guarda.
    save();
    // Progreso.
    console.log({ id: c.id, passed, durationMs: Date.now() - start });
    // Fallo: error.
    if (!passed)
      // Detiene el recorrido con el diagnóstico: La evaluación no cumplió el contrato; ver evidencia privada.
      throw new Error("La evaluación no cumplió el contrato; ver evidencia privada.");
  } catch (e) {
    // Guarda.
    save();
    // Propaga.
    throw e;
  }
}
// Reserva la reformulación.
if (!ports.reserve("reformulation").ok)
  // Detiene el recorrido con el diagnóstico: Reserva denegada.
  throw new Error("Reserva denegada.");
// Reformula.
const rewrite = await ports.reformulate({
  question: cases[1]!.question,
  query: "LangGraph estado nodos",
  gaps: ["instrumentación Langfuse y LangSmith"],
  attempt: 1,
  remainingMs: 20000,
});
// Registra.
results.push({ id: "rewrite", result: rewrite });
// Guarda.
save();
// Fallo.
if (!rewrite.ok)
  // Detiene el recorrido con el diagnóstico: Reformulación fallida.
  throw new Error("Reformulación fallida.");
// Reserva la generación.
if (!ports.reserve("generation").ok)
  // Detiene el recorrido con el diagnóstico: Reserva denegada.
  throw new Error("Reserva denegada.");
// Genera.
const generated = await ports.generate({
  question: cases[0]!.question,
  evidence: s5,
  remainingMs: 20000,
});
// Registra.
results.push({ id: "generation-luna", result: generated });
// Guarda.
save();
// Debe citar.
if (!generated.ok || !generated.text.includes("[cite:"))
  // Detiene el recorrido con el diagnóstico: Generación sin respuesta o cita.
  throw new Error("Generación sin respuesta o cita.");
// Fin.
console.log("Prueba dirigida completada; decisiones y respuesta guardadas.");
