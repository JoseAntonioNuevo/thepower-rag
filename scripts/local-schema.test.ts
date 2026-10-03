import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { schemaStatements } from "../apps/api/src/local-schema";

const root = path.resolve(import.meta.dirname, "..");

function statements(file: string): string[] {
  return readFileSync(path.join(root, file), "utf8")
    .split(";")
    .map((item: string) => item.trim())
    .filter((item: string) => item.length > 0);
}

describe("esquema local", () => {
  it("repite las migraciones del curso y añade solo el almacén emulado", () => {
    const bundled = schemaStatements();
    const migrations = [
      ...statements("apps/api/migrations/0001_corpus.sql"),
      ...statements("apps/api/migrations/0002_index_profile.sql"),
      ...statements("apps/api/migrations/0003_ingest_journal.sql"),
    ];
    expect(bundled.slice(0, migrations.length)).toEqual(migrations);
    expect(bundled.at(-1)).toContain("local_vector_store");
  });
});
