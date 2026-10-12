// GUÍA DE LECTURA · scripts/local-schema.test.ts
// Prueba que el esquema SQL local repite las migraciones de D1 y solo añade el almacén vectorial emulado.
// Lectura de archivos.
import { readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Esquema local que se prueba.
import { schemaStatements } from "../apps/api/src/local-schema";

// Raíz del repositorio.
const root = path.resolve(import.meta.dirname, "..");

// Sentencias SQL de un archivo, separadas por punto y coma.
function statements(file: string): string[] {
  // Lee el archivo, quita las líneas de comentario SQL (`--`), divide por `;`,
  // quita espacios y descarta vacías. Los comentarios documentan la migración,
  // pero no forman parte de la sentencia que se compara con el esquema local.
  return readFileSync(path.join(root, file), "utf8")
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((item: string) => item.trim())
    .filter((item: string) => item.length > 0);
}

// Grupo.
describe("esquema local", () => {
  // Mismas migraciones y una tabla extra.
  it("repite las migraciones del curso y añade solo el almacén emulado", () => {
    // Esquema local.
    const bundled = schemaStatements();
    // Migraciones de D1.
    const migrations = [
      ...statements("apps/api/migrations/0001_corpus.sql"),
      ...statements("apps/api/migrations/0002_index_profile.sql"),
      ...statements("apps/api/migrations/0003_ingest_journal.sql"),
    ];
    // Empiezan igual.
    expect(bundled.slice(0, migrations.length)).toEqual(migrations);
    // La última es el almacén emulado.
    expect(bundled.at(-1)).toContain("local_vector_store");
  });
});
