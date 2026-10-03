import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
const root = path.resolve(import.meta.dirname, "..");
const resultDir = path.join(root, "material/comparacion/resultados");
if (!process.argv.includes("--execute")) {
  console.log("Comparación preparada; sin --execute no llama al servidor.");
  process.exit(0);
}
const frozen = JSON.parse(
  readFileSync(path.join(resultDir, "configuracion-congelada.json"), "utf8"),
) as { origin: string; sha256: Record<string, string> };
for (const [file, hash] of Object.entries(frozen.sha256))
  if (
    createHash("sha256")
      .update(readFileSync(path.join(root, file)))
      .digest("hex") !== hash
  )
    throw new Error("Configuración congelada cambiada: " + file);
const source = readFileSync(
  path.join(root, "material/comparacion/conjunto-reservado-20.md"),
  "utf8",
);
const cases = [...source.matchAll(/^(\d+)\. (.+?)(?=^\d+\. |^## |\s*$)/gms)];
const questions = source
  .split(/\n(?=\d+\. )/)
  .slice(1)
  .map((block) => {
    const [line] = block.split("\n");
    const match = line!.match(/^(\d+)\. (.*)$/)!;
    return {
      id: Number(match[1]),
      question: match[2]!,
      audience: block.match(/Audiencia de ejecución: `([^`]+)`/)?.[1] ?? "program",
      expectedSource: block.match(/Fuente: `([^`]+)`/)?.[1] ?? null,
      supported: Number(match[1]) <= 14,
    };
  })
  .filter((q) => q.id <= 20);
if (questions.length !== 20 || cases.length !== 20)
  throw new Error("El conjunto no tiene veinte preguntas.");
const results: Record<string, unknown>[] = [];
for (const mode of ["rag", "crag"])
  for (const q of questions) {
    const start = Date.now();
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
    const raw = await response.text();
    const events = raw
      .split("\n")
      .filter((l) => l.startsWith("data: {"))
      .map((l) => JSON.parse(l.slice(6)));
    const answer = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    const summary = events.find((e) => e.type === "data-crag")?.data;
    const finish = events.findLast((e) => e.type === "finish")?.messageMetadata;
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
    results.push(result);
    writeFileSync(
      path.join(resultDir, "resultados.json"),
      JSON.stringify({ frozen, results }, null, 2) + "\n",
    );
    console.log(
      `${mode} ${q.id}/20: HTTP ${response.status}, ${finish?.completion ?? "sin finish"}, ${result.latencyMs} ms`,
    );
  }
function csv(value: unknown): string {
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
  return '"' + text.replaceAll('"', '""') + '"';
}

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
console.log(`Guardados ${results.length} resultados reales. Valoración manual pendiente.`);
