// GUÍA DE LECTURA · scripts/chat-corpus-isolation.test.ts
// Aislamiento de la investigación de S12: los módulos research-*.ts de la API leen siempre las
// políticas de ThePower Shop (variables STORE_*, VECTORIZE_STORE y storeRetrieval) y nunca el material
// del curso ni la elección de corpus del chat. Así, cambiar el chat de corpus no cambia qué consulta
// la investigación, y la investigación no vuelve al curso por accidente.
// Lectura de archivos.
import { readdirSync, readFileSync } from "node:fs";
// Rutas.
import path from "node:path";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";

// Carpeta del código de la API.
const apiDir = path.join(import.meta.dirname, "../apps/api/src");

// Módulos de la investigación, sin pruebas.
function researchModules(): string[] {
  // research-*.ts que no son pruebas.
  return readdirSync(apiDir).filter(
    (name) => name.startsWith("research-") && name.endsWith(".ts") && !name.endsWith(".test.ts"),
  );
}

// Grupo de pruebas.
describe("aislamiento de la investigación de S12", () => {
  // Ni el curso ni la elección del chat.
  it("ningún módulo de la investigación lee el curso ni el corpus del chat", () => {
    // Módulos.
    const files = researchModules();
    // Hay módulos que revisar.
    expect(files.length).toBeGreaterThan(10);
    // Los que mencionan el corpus del curso o la configuración del chat.
    const offenders = files.filter((name) =>
      /\bCORPUS_VERSION\b|\bINDEX_PROFILE\b|env\.VECTORIZE\b|prepared\/corpus\.json|get_course_session|fixtureChunks\(|fixtureCorpusVersion|chatRetrieval|chatCorpus|CHAT_CORPUS/.test(
        readFileSync(path.join(apiDir, name), "utf8"),
      ),
    );
    // Ninguno.
    expect(offenders).toEqual([]);
  });

  // La investigación real usa el índice y los ajustes de la tienda.
  it("la investigación real lee el índice y los ajustes de la tienda", () => {
    // Construcción de los puertos reales.
    const live = readFileSync(path.join(apiDir, "research-live.ts"), "utf8");
    // Índice de la tienda.
    expect(live).toContain("env.VECTORIZE_STORE");
    // Ajustes de la tienda.
    expect(live).toContain("assessment.storeRetrieval");
  });
});
