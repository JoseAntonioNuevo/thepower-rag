// GUÍA DE LECTURA · scripts/compare-live.ts
// Comparación real de RAG y CRAG con 20 preguntas reservadas contra la web publicada. Solo con --execute;
// comprueba antes que la configuración congelada no cambió y guarda JSON y CSV para valorarlos a mano.
// Lectura y escritura de archivos.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Hash SHA-256.
import { createHash } from "node:crypto";
// Verificación de identidad remota antes de gastar o atribuir métricas al perfil nuevo.
import { assertModelComparisonTarget, type FrozenModelTarget } from "./model-comparison-target";
// Raíz del repositorio.
const root = path.resolve(import.meta.dirname, "..");
// Carpeta de resultados.
const resultDir = path.join(
  root,
  "material/comparacion/resultados",
  `lote-${Date.now()}-${crypto.randomUUID()}`,
);
// Sin --execute no llama a nada.
if (!process.argv.includes("--execute")) {
  // Mensaje.
  console.log("Comparación preparada; sin --execute no llama al servidor.");
  // Sale.
  process.exit(0);
}
// Índice de argumento --config opcional.
const configFlagIndex = process.argv.indexOf("--config");
// Ruta al archivo de configuración congelada (por defecto la referencia actual).
const configPath =
  configFlagIndex >= 0 && process.argv[configFlagIndex + 1]
    ? path.resolve(root, process.argv[configFlagIndex + 1]!)
    : path.join(root, "material/comparacion/configuracion-referencia-actual.json");
// Configuración congelada: origen, archivo de preguntas y hashes.
const frozen = JSON.parse(readFileSync(configPath, "utf8")) as FrozenModelTarget & {
  origin: string;
  questionsFile?: string;
  sha256: Record<string, string>;
};
// Cada archivo congelado debe tener su hash; si no, error.
for (const [file, hash] of Object.entries(frozen.sha256))
  if (
    createHash("sha256")
      .update(readFileSync(path.join(root, file)))
      .digest("hex") !== hash
  )
    // Detiene el recorrido con el diagnóstico: Configuración congelada cambiada: .
    throw new Error("Configuración congelada cambiada: " + file);
// Preguntas reservadas de la configuración elegida.
const source = readFileSync(
  path.join(
    root,
    frozen.questionsFile ?? "material/comparacion/conjunto-reservado-referencia-actual-20.md",
  ),
  "utf8",
);
// Casos numerados.
const cases = [...source.matchAll(/^(\d+)\. (.+?)(?=^\d+\. |^## |\s*$)/gms)];
// Preguntas con audiencia, fuente esperada y si deben tener respuesta.
const questions = source
  .split(/\n(?=\d+\. )/)
  .slice(1)
  .map((block) => {
    // Primera línea.
    const [line] = block.split("\n");
    // Número y texto.
    const match = line!.match(/^(\d+)\. (.*)$/)!;
    // Pregunta.
    return {
      id: Number(match[1]),
      question: match[2]!,
      audience: block.match(/Audiencia de ejecución: `([^`]+)`/)?.[1] ?? "program",
      expectedSource: block.match(/Fuente: `([^`]+)`/)?.[1] ?? null,
      supported: Number(match[1]) <= 14,
    };
  })
  .filter((q) => q.id <= 20);
// Debe haber 20.
if (questions.length !== 20 || cases.length !== 20)
  // Detiene el recorrido con el diagnóstico: El conjunto no tiene veinte preguntas.
  throw new Error("El conjunto no tiene veinte preguntas.");
// Resultados.
const results: Record<string, unknown>[] = [];
// Leer health no llama a los modelos. Una web anterior a Sonnet no puede producir esta evidencia.
const healthResponse = await fetch(frozen.origin + "/api/health", {
  signal: AbortSignal.timeout(10_000),
});
if (!healthResponse.ok)
  // Detiene el recorrido con el diagnóstico: No se pudo leer la identidad de la web.
  throw new Error("No se pudo leer la identidad de la web.");
const health = await healthResponse.json();
// Comprueba la identidad pública del objetivo antes de permitir una comparación con la referencia congelada.
assertModelComparisonTarget(frozen, health);
// Crea el directorio de salida antes de persistir los resultados del recorrido.
mkdirSync(resultDir, { recursive: true });
// Persiste el resultado en la ruta del recorrido para poder revisarlo después.
writeFileSync(path.join(resultDir, "target-health.json"), JSON.stringify(health, null, 2) + "\n");
// Cada modo y cada pregunta.
for (const mode of ["rag", "crag"])
  for (const q of questions) {
    // Inicio.
    const start = Date.now();
    // Petición al chat con 45 s de plazo.
    const response = await fetch(frozen.origin + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        audience: q.audience,
        messages: [
          { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: q.question }] },
        ],
      }),
      signal: AbortSignal.timeout(frozen.turnDeadlineMs + 5_000),
    });
    // Flujo SSE.
    const raw = await response.text();
    // Eventos JSON.
    const events = raw
      .split("\n")
      .filter((l) => l.startsWith("data: {"))
      .map((l) => JSON.parse(l.slice(6)));
    // Texto de la respuesta.
    const answer = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    // Resumen CRAG.
    const summary = events.find((e) => e.type === "data-crag")?.data;
    // Metadatos finales.
    const finish = events.findLast((e) => e.type === "finish")?.messageMetadata;
    // Resultado con latencia, fuentes y traza; la nota manual queda pendiente.
    const result = {
      // Pregunta, modo y fecha.
      ...q,
      mode,
      at: new Date().toISOString(),
      // Código HTTP y latencia.
      status: response.status,
      latencyMs: Date.now() - start,
      // Texto, metadatos y resumen de CRAG.
      answer,
      metadata: finish ?? null,
      crag: summary ?? null,
      // Fuentes citadas y traza.
      sources: events.filter((e) => e.type === "data-source").map((e) => e.data),
      trace: events.find((e) => e.type === "data-trace")?.data ?? null,
      // La nota la pone una persona después; null hasta entonces.
      manualGrade: null,
      error: response.ok ? null : raw,
    };
    // Lo añade.
    results.push(result);
    // Guarda el JSON tras cada pregunta.
    writeFileSync(
      path.join(resultDir, "resultados.json"),
      JSON.stringify({ frozen, results }, null, 2) + "\n",
    );
    // La protección y el presupuesto se respetan: el lote no insiste ni busca un bypass.
    if (response.status === 403 || response.status === 429) {
      // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
      throw new Error(`Lote detenido por protección o presupuesto: HTTP ${response.status}.`);
    }
    // Progreso.
    console.log(
      `${mode} ${q.id}/20: HTTP ${response.status}, ${finish?.completion ?? "sin finish"}, ${result.latencyMs} ms`,
    );
  }
// Valor CSV entre comillas.
function csv(value: unknown): string {
  // Texto según el tipo.
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? value.toString()
        : typeof value === "boolean"
          ? value
            ? "true"
            : "false"
          : value == null
            ? ""
            : JSON.stringify(value);
  // Comillas escapadas.
  return '"' + text.replaceAll('"', '""') + '"';
}

// Escribe el CSV.
writeFileSync(
  // Cabecera del CSV.
  path.join(resultDir, "resultados.csv"),
  "mode,id,audience,status,latencyMs,answer,completion,generationCostUsd\n" +
    results
      .map((r) =>
        // Una fila por respuesta con modo, id, grupo, estado y latencia.
        [
          r.mode,
          r.id,
          r.audience,
          r.status,
          // Respuesta, cómo terminó y coste de la generación final.
          r.latencyMs,
          r.answer,
          (r.metadata as { completion?: string } | null)?.completion,
          (r.metadata as { cost?: { amount: number } } | null)?.cost?.amount,
        ]
          // Cada celda se escapa para el CSV.
          .map(csv)
          .join(","),
      )
      .join("\n") +
    "\n",
);
// Resumen.
console.log(`Guardados ${results.length} resultados reales. Valoración manual pendiente.`);
