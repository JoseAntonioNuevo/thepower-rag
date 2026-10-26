// GUÍA DE LECTURA · scripts/local-worker-config.test.ts
// Pruebas del informe de configuración local: valores efectivos, claves nunca mostradas, proveedor desde
// el .env de la raíz y bindings declarados frente a configurados.
// Archivos y carpetas temporales.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
// Carpeta temporal del sistema.
import { tmpdir } from "node:os";
// Rutas.
import path from "node:path";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Capacidades del Worker.
import { assessWorker } from "../apps/api/src/env";
// Funciones que se prueban.
import {
  effectiveWorkerVars,
  formatPreflight,
  inspectBindings,
  loadLocalWorkerConfig,
  ragDeclarationReady,
  wranglerStringVars,
  type LocalWorkerConfig,
} from "./local-worker-config";

// Configuración a partir de un wrangler.jsonc y un .dev.vars de prueba.
function config(wrangler: string, devVars: string | null): LocalWorkerConfig {
  // Carpeta temporal.
  const directory = mkdtempSync(path.join(tmpdir(), "thepower-rag-"));
  // Archivo wrangler.
  const file = path.join(directory, "wrangler.jsonc");
  // Lo escribe.
  writeFileSync(file, wrangler);
  // Variables efectivas.
  const vars = effectiveWorkerVars(wranglerStringVars(file), devVars);
  // Bindings.
  const inspected = inspectBindings(file, null);
  // Configuración.
  return {
    environmentName: null,
    environmentFound: true,
    source: "prueba",
    devVarsFile: devVars === null ? null : ".dev.vars",
    vars,
    bindings: inspected.bindings,
    storeBinding: inspected.storeBinding,
    assessment: assessWorker(vars),
  };
}

// Informe del preflight.
function report(
  wrangler: string,
  devVars: string | null,
  processEnv: NodeJS.ProcessEnv,
  capability?: "sin-rag" | "rag" | "crag",
) {
  // Formatea.
  return formatPreflight(config(wrangler, devVars), processEnv, { capability });
}

// Grupo.
describe("preflight", () => {
  // .dev.vars manda sobre wrangler y process.env no se mezcla.
  it("no trata APP_MODE=real aislado como demo ni une process.env", () => {
    // Informe.
    const result = report('{"vars":{"APP_MODE":"demo"}}', "APP_MODE=real\n", {
      APP_MODE: "demo",
      MODEL_ID: "secreto-modelo",
      ANTHROPIC_API_KEY: "secreto-clave",
    });
    // Texto.
    const text = result.lines.join("\n");
    // Bloqueado.
    expect(result.code).toBe(2);
    // Modo efectivo real.
    expect(text).toContain("APP_MODE efectivo: real");
    // Perfil real.
    expect(text).toContain("perfil: real");
    // MODEL_ID ausente.
    expect(text).toContain("MODEL_ID: ausente");
    // Clave ausente.
    expect(text).toContain("ANTHROPIC_API_KEY: ausente");
    // Sin el modelo del proceso.
    expect(text).not.toContain("secreto-modelo");
    // Sin la clave del proceso.
    expect(text).not.toContain("secreto-clave");
    // No verificado.
    expect(text).toContain("verificado remotamente: no");
  });

  // APP_MODE del proceso no cambia el modo del Worker.
  it("ignora APP_MODE del proceso cuando el Worker está en demo", () => {
    // Informe.
    const result = report('{"vars":{"APP_MODE":"demo"}}', null, { APP_MODE: "real" });
    // Correcto.
    expect(result.code).toBe(0);
    // Perfil demo.
    expect(result.lines.join("\n")).toContain("perfil: demo");
  });

  // Proveedor y clave de OpenRouter desde el .env de la raíz.
  it("toma proveedor y clave de OpenRouter del .env de la raíz sin mostrarla", () => {
    // Raíz temporal.
    const root = mkdtempSync(path.join(tmpdir(), "thepower-rag-root-"));
    // Carpeta de la web.
    mkdirSync(path.join(root, "apps/web"), { recursive: true });
    // wrangler en real con un modelo de OpenRouter.
    writeFileSync(
      path.join(root, "apps/web/wrangler.jsonc"),
      JSON.stringify({ vars: { APP_MODE: "real", MODEL_ID: "z-ai/glm-5.3" } }),
    );
    // .env con proveedor y clave.
    writeFileSync(
      path.join(root, ".env"),
      "LLM_PROVIDER=openrouter\nOPENROUTER_API_KEY=clave-openrouter-secreta\nAPP_MODE=demo\n",
    );
    // Configuración.
    const loaded = loadLocalWorkerConfig(root);
    // Proveedor copiado.
    expect(loaded.vars.LLM_PROVIDER).toBe("openrouter");
    // APP_MODE no se copia.
    expect(loaded.vars.APP_MODE).toBe("real");
    // Ajustes con OpenRouter.
    expect(loaded.assessment.generation?.provider).toBe("openrouter");
    // Informe.
    const text = formatPreflight(loaded, {}).lines.join("\n");
    // Muestra el proveedor.
    expect(text).toContain("proveedor (LLM_PROVIDER): openrouter");
    // Clave presente.
    expect(text).toContain("OPENROUTER_API_KEY: presente");
    // Sin RAG listo.
    expect(text).toContain("sin RAG: ready");
    // Sin la clave.
    expect(text).not.toContain("clave-openrouter-secreta");
  });

  // Comillas y modo desconocido.
  it("interpreta comillas y un modo desconocido", () => {
    // Valores entre comillas.
    const quoted = report(
      '{"vars":{"APP_MODE":"demo"}}',
      'APP_MODE="real"\nMODEL_ID="example/generator"\nANTHROPIC_API_KEY="quoted secret"\n',
      {},
    );
    // Correcto.
    expect(quoted.code).toBe(0);
    // Sin la clave.
    expect(quoted.lines.join("\n")).not.toContain("quoted secret");
    // Modo desconocido.
    const unknown = report('{"vars":{"APP_MODE":"sideways"}}', null, {});
    // Bloqueado.
    expect(unknown.code).toBe(2);
  });

  // RAG real no está listo solo con generación.
  it("no da por listo el RAG real si solo hay generación", () => {
    // Configuración con generación.
    const wrangler = JSON.stringify({
      vars: {
        APP_MODE: "real",
        ANTHROPIC_API_KEY: "local-test-key",
        MODEL_ID: "example/generator",
      },
      vectorize: [{ binding: "VECTORIZE_INDEX", index_name: "otro" }],
    });
    // RAG.
    const result = report(wrangler, null, {}, "rag");
    // Bloqueado.
    expect(result.code).toBe(2);
    // Falta VECTORIZE.
    expect(result.lines.join("\n")).toContain("VECTORIZE: absent");
    // Sin RAG.
    const generation = report(wrangler, null, {}, "sin-rag");
    // Correcto.
    expect(generation.code).toBe(0);
  });

  // Declarado no es configurado ni verificado.
  it("distingue un binding declarado de uno configurado sin llamarlo verificado", () => {
    // Configuración con un índice de marcador.
    const file = JSON.stringify({
      // Variables del RAG real completas.
      vars: {
        APP_MODE: "real",
        ANTHROPIC_API_KEY: "local-test-key",
        MODEL_ID: "example/generator",
        EMBEDDING_MODEL: "@cf/baai/bge-m3",
        EMBEDDING_DIMENSIONS: "1024",
        CORPUS_VERSION: "c0123456789ab",
        INDEX_PROFILE: "p0123456789ab",
        VECTOR_METRIC: "cosine",
        MIN_RETRIEVAL_SCORE: "0.2",
      },
      // Bindings declarados; Vectorize con un nombre de marcador (replace).
      ai: { binding: "AI" },
      vectorize: [{ binding: "VECTORIZE", index_name: "REPLACE_WITH_REAL_INDEX" }],
      // D1 y R2 con nombres reales.
      d1_databases: [
        { binding: "DB", database_name: "thepower-ai-course-rag-d1", database_id: "abc" },
      ],
      r2_buckets: [{ binding: "CORPUS", bucket_name: "thepower-ai-course-rag-corpus" }],
    });
    // Configuración.
    const current = config(file, null);
    // VECTORIZE solo declarado.
    expect(current.bindings.VECTORIZE.level).toBe("declared");
    // DB configurada.
    expect(current.bindings.DB.level).toBe("configured");
    // RAG no listo.
    expect(ragDeclarationReady(current).ok).toBe(false);
    // Bloqueado.
    expect(formatPreflight(current, {}, { capability: "rag" }).code).toBe(2);
    // No verificado.
    expect(formatPreflight(current, {}).lines.join("\n")).toContain("verificado: no");
  });

  // CRAG en demo listo; en real exige evaluador.
  it("ejecuta el preflight de CRAG en demo y lo bloquea en real sin evaluador", () => {
    // Demo.
    const demo = report('{"vars":{"APP_MODE":"demo"}}', null, {}, "crag");
    // Correcto.
    expect(demo.code).toBe(0);
    // De prueba.
    expect(demo.lines.join("\n")).toContain("CRAG: offline-fixture");
    // Real sin evaluador.
    const real = report(
      JSON.stringify({
        vars: {
          APP_MODE: "real",
          ANTHROPIC_API_KEY: "local-test-key",
          MODEL_ID: "example/generator",
        },
      }),
      null,
      {},
      "crag",
    );
    // Bloqueado.
    expect(real.code).toBe(2);
    // Falta el evaluador.
    expect(real.lines.join("\n")).toContain("EVALUATOR_MODEL_ID");
    // Sin RAG.
    const generation = report(
      JSON.stringify({
        vars: {
          APP_MODE: "real",
          ANTHROPIC_API_KEY: "local-test-key",
          MODEL_ID: "example/generator",
        },
      }),
      null,
      {},
      "sin-rag",
    );
    // Correcto.
    expect(generation.code).toBe(0);
  });
});

// CRAG configurado no es verificado.
it("CRAG configurado no se declara conectado ni verificado sin una comprobación real", () => {
  // Configuración completa.
  const result = report(
    JSON.stringify({
      // Variables de CRAG real completas.
      vars: {
        APP_MODE: "real",
        ANTHROPIC_API_KEY: "local-test-key",
        MODEL_ID: "example/generator",
        EVALUATOR_MODEL_ID: "example/evaluator",
        EMBEDDING_MODEL: "@cf/baai/bge-m3",
        EMBEDDING_DIMENSIONS: "1024",
        CORPUS_VERSION: "c0123456789ab",
        INDEX_PROFILE: "p0123456789ab",
        VECTOR_METRIC: "cosine",
        MIN_RETRIEVAL_SCORE: "0.5",
      },
      // Los cuatro bindings con nombres reales.
      ai: { binding: "AI" },
      vectorize: [{ binding: "VECTORIZE", index_name: "thepower-ai-course-rag-0123456789ab" }],
      d1_databases: [
        {
          binding: "DB",
          database_name: "thepower-ai-course-rag-d1",
          database_id: "synthetic-database-id",
        },
      ],
      r2_buckets: [{ binding: "CORPUS", bucket_name: "thepower-ai-course-rag-corpus" }],
    }),
    // Sin .dev.vars, sin entorno del proceso y capacidad «crag».
    null,
    {},
    "crag",
  );
  // Correcto.
  expect(result.code).toBe(0);
  // Configurado.
  expect(result.lines.join("\n")).toContain("CRAG: configured");
  // No verificado.
  expect(result.lines.join("\n")).toContain("verificado remotamente: no");
});
