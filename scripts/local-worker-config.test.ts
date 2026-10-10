import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { assessWorker } from "../apps/api/src/env";
import {
  effectiveWorkerVars,
  formatPreflight,
  inspectBindings,
  ragDeclarationReady,
  wranglerStringVars,
  type LocalWorkerConfig,
} from "./local-worker-config";

function config(wrangler: string, devVars: string | null): LocalWorkerConfig {
  const directory = mkdtempSync(path.join(tmpdir(), "thepower-rag-"));
  const file = path.join(directory, "wrangler.jsonc");
  writeFileSync(file, wrangler);
  const vars = effectiveWorkerVars(wranglerStringVars(file), devVars);
  const inspected = inspectBindings(file, null);
  return {
    environmentName: null,
    environmentFound: true,
    source: "prueba",
    devVarsFile: devVars === null ? null : ".dev.vars",
    vars,
    bindings: inspected.bindings,
    assessment: assessWorker(vars),
  };
}

function report(
  wrangler: string,
  devVars: string | null,
  processEnv: NodeJS.ProcessEnv,
  capability?: "sin-rag" | "rag" | "crag",
) {
  return formatPreflight(config(wrangler, devVars), processEnv, { capability });
}

describe("preflight", () => {
  it("no trata APP_MODE=real aislado como demo ni une process.env", () => {
    const result = report('{"vars":{"APP_MODE":"demo"}}', "APP_MODE=real\n", {
      APP_MODE: "demo",
      MODEL_ID: "secreto-modelo",
      ANTHROPIC_API_KEY: "secreto-clave",
    });
    const text = result.lines.join("\n");
    expect(result.code).toBe(2);
    expect(text).toContain("APP_MODE efectivo: real");
    expect(text).toContain("perfil: real");
    expect(text).toContain("MODEL_ID: ausente");
    expect(text).toContain("ANTHROPIC_API_KEY: ausente");
    expect(text).not.toContain("secreto-modelo");
    expect(text).not.toContain("secreto-clave");
    expect(text).toContain("verificado remotamente: no");
  });

  it("ignora APP_MODE del proceso cuando el Worker está en demo", () => {
    const result = report('{"vars":{"APP_MODE":"demo"}}', null, { APP_MODE: "real" });
    expect(result.code).toBe(0);
    expect(result.lines.join("\n")).toContain("perfil: demo");
  });

  it("interpreta comillas y un modo desconocido", () => {
    const quoted = report(
      '{"vars":{"APP_MODE":"demo"}}',
      'APP_MODE="real"\nMODEL_ID="example/generator"\nANTHROPIC_API_KEY="quoted secret"\n',
      {},
    );
    expect(quoted.code).toBe(0);
    expect(quoted.lines.join("\n")).not.toContain("quoted secret");
    const unknown = report('{"vars":{"APP_MODE":"sideways"}}', null, {});
    expect(unknown.code).toBe(2);
  });

  it("no da por listo el RAG real si solo hay generación", () => {
    const wrangler = JSON.stringify({
      vars: {
        APP_MODE: "real",
        ANTHROPIC_API_KEY: "local-test-key",
        MODEL_ID: "example/generator",
      },
      vectorize: [{ binding: "VECTORIZE_INDEX", index_name: "otro" }],
    });
    const result = report(wrangler, null, {}, "rag");
    expect(result.code).toBe(2);
    expect(result.lines.join("\n")).toContain("VECTORIZE: absent");
    const generation = report(wrangler, null, {}, "sin-rag");
    expect(generation.code).toBe(0);
  });

  it("distingue un binding declarado de uno configurado sin llamarlo verificado", () => {
    const file = JSON.stringify({
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
      ai: { binding: "AI" },
      vectorize: [{ binding: "VECTORIZE", index_name: "REPLACE_WITH_REAL_INDEX" }],
      d1_databases: [
        { binding: "DB", database_name: "thepower-ai-course-rag-d1", database_id: "abc" },
      ],
      r2_buckets: [{ binding: "CORPUS", bucket_name: "thepower-ai-course-rag-corpus" }],
    });
    const current = config(file, null);
    expect(current.bindings.VECTORIZE.level).toBe("declared");
    expect(current.bindings.DB.level).toBe("configured");
    expect(ragDeclarationReady(current).ok).toBe(false);
    expect(formatPreflight(current, {}, { capability: "rag" }).code).toBe(2);
    expect(formatPreflight(current, {}).lines.join("\n")).toContain("verificado: no");
  });

  it("ejecuta el preflight de CRAG en demo y lo bloquea en real sin evaluador", () => {
    const demo = report('{"vars":{"APP_MODE":"demo"}}', null, {}, "crag");
    expect(demo.code).toBe(0);
    expect(demo.lines.join("\n")).toContain("CRAG: offline-fixture");
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
    expect(real.code).toBe(2);
    expect(real.lines.join("\n")).toContain("EVALUATOR_MODEL_ID");
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
    expect(generation.code).toBe(0);
  });
});

it("CRAG configurado no se declara conectado ni verificado sin una comprobación real", () => {
  const result = report(
    JSON.stringify({
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
    null,
    {},
    "crag",
  );
  expect(result.code).toBe(0);
  expect(result.lines.join("\n")).toContain("CRAG: configured");
  expect(result.lines.join("\n")).toContain("verificado remotamente: no");
});
