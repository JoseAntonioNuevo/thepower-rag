// GUÍA DE LECTURA · scripts/verify-aula-persistence.ts
// Comprueba JSONB con el controlador y PostgreSQL reales dentro de una transacción que se revierte.
// No consulta modelos, no modifica el corpus y no deja un ensayo sintético en el historial del Aula.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parse } from "dotenv";
import { realLabSettings } from "../lab/src/real-session";
import { AulaController } from "../lab/aula/controller";
import { PgAulaJournal } from "../lab/aula/journal";
import type { PostgresSqlExecutor } from "../lab/src/pgvector-store";
const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, "lab/.env");
const settings = realLabSettings({
  ...process.env,
  ...(existsSync(envFile) ? parse(readFileSync(envFile, "utf8")) : {}),
});
const moduleName = "bun";
const runtime = (await import(moduleName)) as {
  SQL: new (
    url: string,
    options: { max: number },
  ) => {
    unsafe(text: string, params: unknown[]): Promise<Record<string, unknown>[]>;
    close(): Promise<void>;
  };
};
const client = new runtime.SQL(settings.databaseUrl, { max: 1 });
const sql: PostgresSqlExecutor = {
  async query<T extends Record<string, unknown>>(text: string, params: readonly unknown[] = []) {
    return Array.from(await client.unsafe(text, [...params])) as T[];
  },
};
try {
  await sql.query("BEGIN");
  const journal = new PgAulaJournal(sql);
  const controller = new AulaController(
    "baseline",
    "auto",
    "Prueba transaccional de JSONB, sin modelos",
    journal,
  );
  await journal.create(controller.run);
  await controller.before("generation", {
    system: "instrucción de prueba",
    prompt: "texto de prueba",
  });
  await controller.after("generation", { answer: "dato de prueba" });
  await controller.finish({
    nested: ["dato", 2, true],
    result: { answer: "respuesta", citations: [] },
  });
  const restored = await journal.get(controller.run.id);
  assert.ok(restored);
  assert.ok(Array.isArray(restored.stages));
  assert.deepEqual(restored.result, {
    nested: ["dato", 2, true],
    result: { answer: "respuesta", citations: [] },
  });
  assert.deepEqual(restored.events[0]!.data, {
    input: { system: "instrucción de prueba", prompt: "texto de prueba" },
  });
  const [types] = await sql.query(
    "SELECT jsonb_typeof(stages) AS stages_type,jsonb_typeof(result) AS result_type FROM lab_aula_runs WHERE id=$1",
    [controller.run.id],
  );
  assert.equal(types!.stages_type, "array");
  assert.equal(types!.result_type, "object");
  console.log(
    JSON.stringify(
      {
        ok: true,
        stages: types!.stages_type,
        result: types!.result_type,
        events: restored.events.length,
        providerCalls: 0,
        persistence: "PostgreSQL real; transacción revertida",
      },
      null,
      2,
    ),
  );
} finally {
  await sql.query("ROLLBACK");
  await client.close();
}
