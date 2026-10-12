// GUÍA DE LECTURA · scripts/compare-live.ts
// Comparación real de RAG y CRAG con 20 preguntas reservadas contra la web publicada. Solo con --execute;
// comprueba antes que la configuración congelada no cambió y guarda JSON y CSV para valorarlos a mano.
// Lectura y escritura de archivos.
import { readFileSync, writeFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Hash SHA-256.
import { createHash } from "node:crypto";
// Raíz del repositorio.
const root = path.resolve(import.meta.dirname, "..");
// Carpeta de resultados.
const resultDir = path.join(root, "material/comparacion/resultados");
// Sin --execute no llama a nada.
if (!process.argv.includes("--execute")) {
  // Mensaje.
  console.log("Comparación preparada; sin --execute no llama al servidor.");
  // Sale.
  process.exit(0);
}
// Configuración congelada: origen y hashes.
const frozen = JSON.parse(
  readFileSync(path.join(resultDir, "configuracion-congelada.json"), "utf8"),
) as { origin: string; sha256: Record<string, string> };
// Cada archivo congelado debe tener su hash; si no, error.
for (const [file, hash] of Object.entries(frozen.sha256))
  if (
    createHash("sha256")
      .update(readFileSync(path.join(root, file)))
      .digest("hex") !== hash
  )
    throw new Error("Configuración congelada cambiada: " + file);
// Preguntas reservadas.
const source = readFileSync(
  path.join(root, "material/comparacion/conjunto-reservado-20.md"),
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
  throw new Error("El conjunto no tiene veinte preguntas.");
// Resultados.
const results: Record<string, unknown>[] = [];
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
      signal: AbortSignal.timeout(45000),
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
      ...q,
      mode,
      at: new Date().toISOString(),
      status: response.status,
      latencyMs: Date.now() - start,
      answer,
      metadata: finish ?? null,
      crag: summary ?? null,
      sources: events.filter((e) => e.type === "data-source").map((e) => e.data),
      trace: events.find((e) => e.type === "data-trace")?.data ?? null,
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
  path.join(resultDir, "resultados.csv"),
  "mode,id,audience,status,latencyMs,answer,completion,generationCostUsd\n" +
    results
      .map((r) =>
        [
          r.mode,
          r.id,
          r.audience,
          r.status,
          r.latencyMs,
          r.answer,
          (r.metadata as { completion?: string } | null)?.completion,
          (r.metadata as { cost?: { amount: number } } | null)?.cost?.amount,
        ]
          .map(csv)
          .join(","),
      )
      .join("\n") +
    "\n",
);
// Resumen.
console.log(`Guardados ${results.length} resultados reales. Valoración manual pendiente.`);
