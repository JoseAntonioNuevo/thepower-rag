import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { generateText } from "../apps/api/src/context-evaluation-model";
import {
  createGenerationModel,
  HAIKU_INPUT_USD_PER_MILLION,
  HAIKU_MODEL_ID,
  HAIKU_OUTPUT_USD_PER_MILLION,
} from "../apps/api/src/model";
import { readRepoAnthropicKey } from "./anthropic-key";
import { completeRagSystem } from "../apps/api/src/prompts";
import { providerCost } from "../apps/api/src/provider-cost";
import { readCourseContext } from "../apps/api/src/course-context";
import type { SqlDatabase } from "../apps/api/src/stores";
import { createWranglerRunner, scopedWranglerEnv } from "./process-runner";
import { parseJsonText } from "./wrangler-parse";
import { COURSE_DESTINATION } from "./course-destination";
import { createAllowanceLedger } from "@thepower-rag/core";
import type { Audience } from "@thepower-rag/contracts";
const root = path.resolve(import.meta.dirname, "..");
if (!process.argv.includes("--execute")) {
  console.log("Pruebas dirigidas preparadas; sin --execute no hay red ni gasto.");
  process.exit(0);
}
const auth = JSON.parse(readFileSync(path.join(root, "apps/web/.activation.json"), "utf8"));
if (
  auth.accountId !== COURSE_DESTINATION.accountId ||
  !auth.allowOpenRouter ||
  auth.maxSpendUsd !== 5
)
  throw new Error("Falta autorización del curso.");
const out = path.join(root, "docs/evidence/course-context");
mkdirSync(out, { recursive: true });
const file = path.join(out, "directed-results.json");
if (existsSync(file)) throw new Error("La prueba ya está guardada; no se repite automáticamente.");
const secret = readRepoAnthropicKey(root);
if (!secret) throw new Error("Falta ANTHROPIC_API_KEY en .env.");
const maxSpend = 0.25;
const ledger = createAllowanceLedger({
  maxSpendUsd: maxSpend,
  maxGenerativeCalls: 12,
  maxEmbeddingCalls: 0,
  prices: {
    embeddingUsdPerMillionInput: null,
    generativeUsdPerMillionInput: HAIKU_INPUT_USD_PER_MILLION,
    generativeUsdPerMillionOutput: HAIKU_OUTPUT_USD_PER_MILLION,
  },
});
const runner = createWranglerRunner(
  path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
  root,
);
const sql = `SELECT chunks.chunk_id AS chunkId,chunks.document_id AS documentId,documents.title AS title,chunks.section AS section,chunks.text AS text,documents.audience AS audience,chunks.version_id AS corpusVersion FROM chunks JOIN documents ON documents.version_id=chunks.version_id AND documents.document_id=chunks.document_id WHERE chunks.version_id='c3a59a406888b' ORDER BY documents.document_id,chunks.ordinal`;
const read = await runner.run(
  [
    "d1",
    "execute",
    "thepower-ai-course-rag-d1",
    "--remote",
    "--config",
    path.join(root, "apps/web/dist/thepower_rag/wrangler.json"),
    "--json",
    "--command",
    sql,
  ],
  scopedWranglerEnv(process.env, COURSE_DESTINATION.accountId),
);
if (read.code !== 0) throw new Error("No se leyó el catálogo real.");
const all = (parseJsonText(read.stdout) as { results: unknown[] }[])[0]!.results;
const contexts = new Map<Audience, Awaited<ReturnType<typeof readCourseContext>>>();
for (const group of ["program", "L/X", "M/J"] as const) {
  const db = {
    prepare: () => ({
      bind: () => ({
        all: async () => ({
          results: all.filter((row) => {
            const a = (row as { audience: string }).audience;
            return a === "program" || a === group;
          }),
        }),
      }),
    }),
  } as unknown as SqlDatabase;
  contexts.set(
    group,
    await readCourseContext(db, "c3a59a406888b", group, new AbortController().signal),
  );
}
// Development regression cases, not the reserved comparison set.
const cases: [string, Audience, string, string][] = [
  [
    "days-lx",
    "L/X",
    "que dias hay clase?",
    "lunes y miércoles, 18:30–20:00, fuente del calendario L/X",
  ],
  [
    "days-mj",
    "M/J",
    "¿Qué días de la semana tenemos clases y cuál es el horario?",
    "martes y jueves, 18:30–20:00, calendario M/J",
  ],
  [
    "count",
    "program",
    "¿Cuántas sesiones tiene el programa AI Engineer y hasta qué sesión llega?",
    "20 sesiones, S1–S20",
  ],
  [
    "outline",
    "program",
    "Dame la lista completa de sesiones del curso, con número y tema, sin saltarte ninguna.",
    "lista S1–S20 con sus títulos",
  ],
  [
    "langchain",
    "program",
    "¿Qué vamos a hacer en la sesión de LangChain y cuál viene inmediatamente después?",
    "S4 LangChain, siguiente S5 LangGraph",
  ],
  [
    "follow-up",
    "program",
    "¿Y qué práctica se hace en esa siguiente sesión?",
    "asistente de soporte por etapas, memoria, herramientas y límites de S5",
  ],
  [
    "teachers",
    "M/J",
    "¿Qué profesores aparecen en mi calendario y quién enseña RAG básico?",
    "Martín, Ignacio, José Antonio; S10 José Antonio",
  ],
  [
    "october",
    "L/X",
    "¿Qué clases hay durante octubre? Incluye las fechas y el día festivo sin clase.",
    "5,7,14,19,21,26,28 octubre; 12 octubre festivo",
  ],
  [
    "next",
    "L/X",
    "Según la fecha actual, ¿cuál es la próxima sesión y quién la imparte?",
    "2026-10-05 S5 José Antonio",
  ],
  [
    "missing-fee",
    "program",
    "¿Cuánto vale la inscripción y en qué aula del campus tengo que sentarme?",
    "precios y aula no constan",
  ],
  [
    "missing-exercise",
    "program",
    "¿Dónde está detallada la rúbrica del primer ejercicio y cuál es su fecha de entrega?",
    "rúbrica y fecha no constan; ficha S1 solo título",
  ],
  [
    "conceptual",
    "program",
    "¿En qué situaciones conviene un modelo abierto frente a una API de modelo cerrado?",
    "respuesta de S7; no pide grupo de calendario",
  ],
];
const model = createGenerationModel({ apiKey: secret, modelId: HAIKU_MODEL_ID });
const results: Record<string, unknown>[] = [];
for (const [id, group, question, expected] of cases) {
  const reserve = ledger.reserve({
    kind: "generation",
    maxInputTokens: 50000,
    maxOutputTokens: 1200,
  });
  if (!reserve.ok) throw new Error(reserve.reason);
  const previous = id === "follow-up" ? results.find((r) => r.id === "langchain") : null;
  const messages = previous
    ? [
        { role: "user" as const, content: String(previous.question) },
        { role: "assistant" as const, content: String(previous.answer) },
        { role: "user" as const, content: question },
      ]
    : [{ role: "user" as const, content: question }];
  const start = Date.now();
  try {
    const result = await generateText({
      model,
      system: completeRagSystem(contexts.get(group)!, group),
      messages,
      maxOutputTokens: 1600,
      maxRetries: 0,
      timeout: { totalMs: 20000 },
    });
    const cost = providerCost(result.totalUsage);
    ledger.settle(reserve.id, cost?.amount ?? null);
    results.push({
      id,
      group,
      question,
      expected,
      answer: result.text,
      finishReason: result.finishReason,
      usage: result.totalUsage,
      cost,
      latencyMs: Date.now() - start,
    });
    console.log(id, result.finishReason, Date.now() - start, "ms");
  } catch (error) {
    ledger.settle(reserve.id, null);
    results.push({
      id,
      group,
      question,
      expected,
      error: error instanceof Error ? error.name : "unknown",
    });
    console.log(id, "error");
  }
  writeFileSync(
    file,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        kind: "directed development regression; local SDK generation using verified production D1 context, not public endpoint and not independent benchmark",
        model: auth.modelId,
        mode: "priority",
        provenance: "remote D1 and Claude API",
        results,
        allowance: ledger.snapshot(),
      },
      null,
      2,
    ) + "\n",
  );
}
