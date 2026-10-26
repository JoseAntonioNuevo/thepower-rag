// GUÍA DE LECTURA · scripts/chat-corpus-isolation.test.ts
// Aislamiento de la investigación de S12: ningún módulo research-*.ts de la API lee la configuración
// del chat (CHAT_CORPUS, variables STORE_*, VECTORIZE_STORE ni chatRetrieval). Así, cambiar el chat a
// la tienda ThePower Shop no puede cambiar qué corpus consulta la investigación.
// Lectura de archivos.
import { readdirSync, readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";

// Carpeta del código de la API.
const apiDir = path.join(import.meta.dirname, "../apps/api/src");

// Grupo de pruebas.
describe("aislamiento de la investigación de S12", () => {
  // La investigación solo conoce CORPUS_VERSION, INDEX_PROFILE y VECTORIZE.
  it("ningún módulo de la investigación lee el corpus del chat", () => {
    // Módulos de la investigación, sin pruebas.
    const files = readdirSync(apiDir).filter(
      (name) => name.startsWith("research-") && name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    // Hay módulos que revisar.
    expect(files.length).toBeGreaterThan(10);
    // Los que mencionan la configuración del chat.
    const offenders = files.filter((name) =>
      /chatRetrieval|chatCorpus|CHAT_CORPUS|STORE_|VECTORIZE_STORE/.test(
        readFileSync(path.join(apiDir, name), "utf8"),
      ),
    );
    // Ninguno.
    expect(offenders).toEqual([]);
  });
});
