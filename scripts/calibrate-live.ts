// GUÍA DE LECTURA · scripts/calibrate-live.ts
// Calibra el umbral de similitud del RAG real con 8 preguntas de desarrollo (5 con respuesta y 3 sin ella)
// contra Vectorize remoto. Solo con --execute; nunca usa el conjunto reservado de comparación.
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Bytes aleatorios para la ficha del puente.
import { randomBytes } from "node:crypto";
// Rutas.
import path from "node:path";
// Identidad del corpus, nombre del índice y tipo.
import { semanticIdentity, vectorizeIndexName, type PreparedCorpus } from "@thepower-rag/core";
// Autorización de activación.
import { parseActivation, missingFor } from "./activation";
// Arranca el puente propio.
import { startOwnedBridge } from "./runtime-plane";
// Ejecutor de wrangler.
import { createWranglerRunner } from "./process-runner";
// Cliente del puente.
import { createBridgePlane } from "./bridge-client";
// Sesión de gasto.
import { openExecutionSession, saveExecutionSession } from "./execution-session";
// fetch a 127.0.0.1.
import { loopbackFetch } from "./loopback-fetch";
// Escritura atómica.
import { writeAtomic } from "./course-runtime";

// Raíz.
const root = path.resolve(import.meta.dirname, "..");
// Sin --execute no hay red.
if (!process.argv.includes("--execute")) {
  // Mensaje.
  console.log("Calibración preparada; sin --execute no hay red.");
  // Sale.
  process.exit(0);
}
// Autorización guardada.
const parsed = parseActivation(
  JSON.parse(readFileSync(path.join(root, "apps/web/.activation.json"), "utf8")),
);
// Sin autorización o sin dimensiones medidas: error.
if (!parsed.ok || missingFor("ingest", parsed.auth, null).length || !parsed.auth.observedDimensions)
  throw new Error("Falta autorización de Workers AI e índice medido.");
// Autorización.
const auth = parsed.auth;
// Corpus preparado.
const corpus = JSON.parse(
  readFileSync(path.join(root, "corpus/prepared/corpus.json"), "utf8"),
) as PreparedCorpus;
// Perfil semántico.
const profile = semanticIdentity(corpus, auth.observedDimensions!);
// Solo ejemplos de desarrollo: el conjunto reservado de comparación nunca se usa para ajustar el umbral.
const cases = [
  // Cinco preguntas que el corpus sí responde (supported: true).
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
  // Tres preguntas que no constan: su puntuación debe quedar por debajo del umbral.
  {
    text: "¿Qué beca interna del año 1991 cubre este programa?",
    audience: "program",
    supported: false,
  },
  { text: "¿Cuál es la contraseña del wifi del aula?", audience: "program", supported: false },
  { text: "¿Qué menú de comedor hay mañana en el curso?", audience: "program", supported: false },
];
// Arranca el puente remoto en modo storage.
const owned = await startOwnedBridge({
  // Cuenta, puertos y ficha aleatoria del puente.
  accountId: auth.accountId!,
  port: 8791,
  inspectorPort: 8792,
  token: randomBytes(24).toString("hex"),
  // Raíz, papel «storage», bindings remotos y estado persistido.
  projectRoot: root,
  role: "storage",
  remote: true,
  offline: false,
  persistDir: path.join(root, "activation-receipts/wrangler-state"),
  // Índice del perfil y su dimensión.
  indexName: vectorizeIndexName(profile.id),
  dimensions: auth.observedDimensions!,
  // Wrangler fijado del proyecto.
  runner: createWranglerRunner(
    path.join(root, "apps/web/node_modules/wrangler/bin/wrangler.js"),
    root,
  ),
});
// Archivo de sesión.
const file = path.join(root, "activation-receipts/allowance-session.json");
// Sesión de gasto: solo embeddings.
const ledger = await openExecutionSession({
  // Archivo de la sesión, cuenta, perfil y procedencia real.
  file,
  accountId: auth.accountId!,
  profileId: profile.id,
  provenance: "remote-binding",
  pricesSynthetic: false,
  // Tope de gasto y número máximo de llamadas.
  maxSpendUsd: auth.maxSpendUsd!,
  maxGenerativeCalls: 4,
  maxEmbeddingCalls: 128,
  // Precio publicado de BGE-M3; esta calibración no genera texto.
  prices: {
    embeddingUsdPerMillionInput: 0.0118,
    generativeUsdPerMillionInput: null,
    generativeUsdPerMillionOutput: null,
  },
});
// try/finally: guarda la sesión y para el puente.
try {
  // Cliente del puente.
  const plane = await createBridgePlane({ origin: owned.origin, token: owned.token });
  // Reserva los embeddings.
  const reservation = ledger.reserve({
    kind: "embedding",
    calls: cases.length,
    maxInputTokens: 2000,
  });
  // Sin reserva: error.
  if (!reservation.ok) throw new Error(reservation.reason);
  // Embeddings de las 8 preguntas.
  const embedded = await plane.embed(
    cases.map((c) => c.text),
    reservation.id,
  );
  // Cierra la reserva.
  ledger.settle(reservation.id, null);
  // Observaciones.
  const observations = [];
  // Cada pregunta.
  for (let i = 0; i < cases.length; i++) {
    // Consulta Vectorize con su vector.
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
    // Resultado.
    const result = (await response.json()) as {
      // Correcto.
      ok: boolean;
      // Coincidencias.
      hits: { matches: { id: string; score: number }[] };
    };
    // Fallo.
    if (!response.ok || !result.ok) throw new Error("No se pudo medir la recuperación.");
    // Guarda las coincidencias.
    observations.push({
      ...cases[i]!,
      matches: result.hits.matches.map((h) => ({ id: h.id, score: h.score })),
    });
  }
  // Guarda las observaciones.
  await writeAtomic(
    path.join(root, "activation-receipts/calibration-observations.json"),
    JSON.stringify({ profileId: profile.id, observations }, null, 2) + "\n",
  );
  // Mejor puntuación de las que tienen respuesta.
  const positives = observations.filter((o) => o.supported).map((o) => o.matches[0]?.score ?? -1);
  // Mejor puntuación de las que no.
  const negatives = observations.filter((o) => !o.supported).map((o) => o.matches[0]?.score ?? -1);
  // Mínimo de las positivas y máximo de las negativas.
  const minPositive = Math.min(...positives),
    maxNegative = Math.max(...negatives);
  // ¿Se separan?
  const separated = minPositive > maxNegative;

  // Umbral: punto medio si se separan; si no, justo por encima de las negativas.
  const minScore = separated
    ? Number(((minPositive + maxNegative) / 2).toFixed(6))
    : Math.ceil((maxNegative + 0.001) * 100) / 100;
  // Recibo de calibración.
  const receipt = {
    // Fecha, perfil, modelo, dimensión y umbral elegido.
    at: new Date().toISOString(),
    profileId: profile.id,
    embeddingModel: "@cf/baai/bge-m3",
    dimensions: auth.observedDimensions,
    minScore,
    // Método usado (texto del recibo en inglés, como se guardó).
    method: separated
      ? "midpoint with separation on 8 development queries"
      : "conservative cutoff above all development negatives; overlapping positive may be refused",
    // Recall en desarrollo y la separación entre positivos y negativos.
    developmentRecall: positives.filter((s) => s >= minScore).length / positives.length,
    minPositive,
    maxNegative,
    // Puntuaciones observadas y constancia de que no se usó el conjunto reservado.
    observations,
    reservedSetUsed: false,
  };
  // Guarda la calibración.
  await writeAtomic(
    path.join(root, "activation-receipts/calibration.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  // Resumen.
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
  // Guarda la sesión de gasto.
  await saveExecutionSession({
    file,
    accountId: auth.accountId!,
    profileId: profile.id,
    provenance: "remote-binding",
    pricesSynthetic: false,
    ledger,
  });
  // Para el puente.
  await owned.shutdown();
}
