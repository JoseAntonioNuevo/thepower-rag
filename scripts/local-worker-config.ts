import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { readRepoProviderEnv } from "./anthropic-key";
import {
  assessWorker,
  generationMissing,
  type Assessment,
  type WorkerEnv,
} from "../apps/api/src/env";
import {
  PROVIDER_ENV_VARIABLES,
  generationVariables,
  llmProvider,
  isConfiguredValue,
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  type RagBindingName,
} from "@thepower-rag/contracts";

export type BindingLevel = "absent" | "declared" | "configured";
export type CapabilityName = "sin-rag" | "rag" | "crag" | "research";

export interface BindingView {
  level: BindingLevel;
  reachable: "not-checked";
  verified: false;
}

export interface LocalWorkerConfig {
  environmentName: string | null;
  environmentFound: boolean;
  source: string;
  devVarsFile: string | null;
  vars: Record<string, string>;
  bindings: Record<RagBindingName, BindingView>;
  assessment: Assessment;
}

export interface PreflightSelection {
  capability?: CapabilityName;
  environment?: string | null;
  configPath?: string;
}

function readJson(file: string): unknown {
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(text) as unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringVars(value: unknown): Record<string, string> {
  const vars = record(value);
  const result: Record<string, string> = {};
  if (vars === null) {
    return result;
  }
  for (const [key, item] of Object.entries(vars)) {
    if (typeof item === "string") {
      result[key] = item;
    }
  }
  return result;
}

export function wranglerStringVars(file: string): Record<string, string> {
  return stringVars(record(readJson(file))?.vars);
}

export function effectiveWorkerVars(
  wranglerVars: Record<string, string>,
  devVarsText: string | null,
): Record<string, string> {
  const result = { ...wranglerVars };
  if (devVarsText === null) {
    return result;
  }
  const parsed = parse(devVarsText);
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = value;
  }
  return result;
}

function bindingLevel(
  item: Record<string, unknown> | null,
  resourceKeys: readonly string[],
): BindingLevel {
  if (item === null) {
    return "absent";
  }
  return resourceKeys.every((key) =>
    isConfiguredValue(typeof item[key] === "string" ? item[key] : undefined),
  )
    ? "configured"
    : "declared";
}

export function inspectBindings(
  file: string,
  environment: string | null,
): {
  found: boolean;
  vars: Record<string, string>;
  bindings: Record<RagBindingName, BindingView>;
} {
  const parsed = record(readJson(file));
  const section = environment === null ? parsed : record(record(parsed?.env)?.[environment]);
  const view = (level: BindingLevel): BindingView => ({
    level,
    reachable: "not-checked",
    verified: false,
  });
  if (environment !== null && section === null) {
    return {
      found: false,
      vars: {},
      bindings: {
        AI: view("absent"),
        VECTORIZE: view("absent"),
        DB: view("absent"),
        CORPUS: view("absent"),
      },
    };
  }
  const ai = record(section?.ai);
  const vector = Array.isArray(section?.vectorize)
    ? (section.vectorize.map(record).find((item) => item?.binding === "VECTORIZE") ?? null)
    : null;
  const database = Array.isArray(section?.d1_databases)
    ? (section.d1_databases.map(record).find((item) => item?.binding === "DB") ?? null)
    : null;
  const bucket = Array.isArray(section?.r2_buckets)
    ? (section.r2_buckets.map(record).find((item) => item?.binding === "CORPUS") ?? null)
    : null;
  return {
    found: true,
    vars: stringVars(section?.vars),
    bindings: {
      AI: view(ai?.binding === "AI" ? "configured" : "absent"),
      VECTORIZE: view(bindingLevel(vector, ["index_name"])),
      DB: view(bindingLevel(database, ["database_name", "database_id"])),
      CORPUS: view(bindingLevel(bucket, ["bucket_name"])),
    },
  };
}

export function devVarsFileName(
  environment: string | null,
  exists: (name: string) => boolean,
): string {
  if (environment !== null) {
    const specific = `.dev.vars.${environment}`;
    if (exists(specific)) {
      return specific;
    }
  }
  return ".dev.vars";
}

export function loadLocalWorkerConfig(
  root: string,
  selection: PreflightSelection = {},
): LocalWorkerConfig {
  const configPath = selection.configPath ?? path.join(root, "apps/web/wrangler.jsonc");
  const environment = selection.environment ?? null;
  const inspected = inspectBindings(configPath, environment);
  const devName = devVarsFileName(environment, (name) =>
    existsSync(path.join(path.dirname(configPath), name)),
  );
  const devVarsPath = path.join(path.dirname(configPath), devName);
  const devVarsText = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : null;
  const vars = effectiveWorkerVars(inspected.vars, devVarsText);
  // Como en Vite: proveedor y claves del .env de la raíz si el Worker no los trae.
  const repoProvider = environment === "research" ? {} : readRepoProviderEnv(root);
  for (const [name, value] of Object.entries(repoProvider)) {
    if (!isConfiguredValue(vars[name])) {
      vars[name] = value;
    }
  }
  const relativeConfig = path.relative(root, configPath);
  return {
    environmentName: environment,
    environmentFound: inspected.found,
    source: `${relativeConfig}${environment === null ? "" : ` env.${environment}`}${devVarsText === null ? "" : ` + ${devName}`}`,
    devVarsFile: devVarsText === null ? null : devName,
    vars,
    bindings: inspected.bindings,
    assessment: inspected.found
      ? assessWorker(vars as WorkerEnv)
      : {
          execution: "misconfigured",
          message: "El entorno pedido no está en el archivo de Wrangler.",
          generation: null,
          retrieval: null,
          capabilities: {
            "sin-rag": { status: "blocked", missing: ["APP_MODE"] },
            rag: { status: "blocked", missing: ["APP_MODE"] },
            crag: { status: "blocked", missing: ["APP_MODE"] },
            research: { status: "blocked", missing: ["APP_MODE"] },
          },
        },
  };
}

function present(vars: Record<string, string>, name: string): boolean {
  return isConfiguredValue(vars[name]);
}

export function ragDeclarationReady(config: LocalWorkerConfig): { ok: boolean; missing: string[] } {
  if (config.assessment.execution === "demo") {
    return { ok: true, missing: [] };
  }
  const missing: string[] = [];
  // Generación del proveedor elegido (LLM_PROVIDER) y ajustes del índice.
  missing.push(...generationMissing(config.vars as WorkerEnv));
  for (const name of RAG_SETTING_VARIABLES) {
    if (!present(config.vars, name)) {
      missing.push(name);
    }
  }
  if (present(config.vars, "EMBEDDING_DIMENSIONS")) {
    const parsed = Number(config.vars.EMBEDDING_DIMENSIONS);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      missing.push("EMBEDDING_DIMENSIONS");
    }
  }
  if (present(config.vars, "VECTOR_METRIC") && config.vars.VECTOR_METRIC?.trim() !== "cosine") {
    missing.push("VECTOR_METRIC");
  }
  if (
    present(config.vars, "MIN_RETRIEVAL_SCORE") &&
    !Number.isFinite(Number(config.vars.MIN_RETRIEVAL_SCORE))
  ) {
    missing.push("MIN_RETRIEVAL_SCORE");
  }
  for (const name of RAG_BINDING_NAMES) {
    if (config.bindings[name].level !== "configured") {
      missing.push(name);
    }
  }
  return { ok: config.assessment.execution === "real" && missing.length === 0, missing };
}

export function formatPreflight(
  config: LocalWorkerConfig,
  processEnv: NodeJS.ProcessEnv,
  selection: PreflightSelection = {},
): { code: number; lines: string[] } {
  const lines = [
    "thepower-rag preflight",
    `entorno seleccionado: ${config.environmentName ?? "ninguno"}`,
    "bun run dev no selecciona --env salvo que se exporte el entorno en el comando de Vite",
    `fuente efectiva del Worker: ${config.source}`,
    `archivo .dev.vars usado: ${config.devVarsFile ?? "ninguno"}`,
    "process.env no se mezcla con los bindings del Worker",
    `CLOUDFLARE_ENV en process.env: ${presentProcess(processEnv, "CLOUDFLARE_ENV")}`,
    `APP_MODE efectivo: ${config.vars.APP_MODE ?? "ausente"}`,
    `perfil: ${config.assessment.execution}`,
  ];
  const provider = llmProvider(config.vars.LLM_PROVIDER);
  // Proveedor y nivel de razonamiento no son secretos: se muestran tal cual.
  lines.push(
    `proveedor (LLM_PROVIDER): ${provider ?? `desconocido (${config.vars.LLM_PROVIDER ?? ""})`}`,
    `razonamiento (LLM_REASONING_EFFORT): ${
      present(config.vars, "LLM_REASONING_EFFORT")
        ? (config.vars.LLM_REASONING_EFFORT ?? "").trim()
        : "por defecto del proveedor"
    }`,
  );
  const groups: [string, readonly string[]][] = [
    [
      "generación",
      provider === null ? ["LLM_PROVIDER", "MODEL_ID"] : generationVariables(provider),
    ],
    [
      "rag",
      [
        "EMBEDDING_MODEL",
        "EMBEDDING_DIMENSIONS",
        "CORPUS_VERSION",
        "INDEX_PROFILE",
        "VECTOR_METRIC",
        "MIN_RETRIEVAL_SCORE",
      ],
    ],
    ["crag", ["EVALUATOR_MODEL_ID"]],
  ];
  for (const [title, names] of groups) {
    lines.push(`nombres de ${title} en la configuración efectiva:`);
    for (const name of names) {
      lines.push(`  ${name}: ${present(config.vars, name) ? "presente" : "ausente"}`);
    }
  }
  lines.push("bindings esperados:");
  for (const name of RAG_BINDING_NAMES) {
    const binding = config.bindings[name];
    lines.push(`  ${name}: ${binding.level}; alcanzable: no comprobado; verificado: no`);
  }
  lines.push("nombres solo en process.env, ignorados por el Worker:");
  for (const name of ["APP_MODE", ...PROVIDER_ENV_VARIABLES, "MODEL_ID", "EVALUATOR_MODEL_ID"]) {
    lines.push(`  ${name}: ${presentProcess(processEnv, name)}`);
  }
  lines.push(`sin RAG: ${config.assessment.capabilities["sin-rag"].status}`);
  const rag = ragDeclarationReady(config);
  lines.push(
    `RAG básico: ${config.assessment.execution === "demo" ? "offline-fixture" : rag.ok ? "configured" : "blocked"}`,
  );
  const cragMissing = [
    ...new Set([
      ...rag.missing,
      ...config.assessment.capabilities["sin-rag"].missing,
      ...(present(config.vars, "EVALUATOR_MODEL_ID") ? [] : ["EVALUATOR_MODEL_ID"]),
    ]),
  ];
  const cragStatus =
    config.assessment.execution === "demo"
      ? "offline-fixture"
      : cragMissing.length === 0
        ? "configured"
        : "blocked";
  lines.push(`CRAG: ${cragStatus}`);
  const research = config.assessment.capabilities.research;
  lines.push(
    `Investigación: ${research.status}${research.status === "blocked" ? ` (falta: ${research.missing.join(", ")})` : ""}`,
  );
  lines.push(
    "Medios: imagen PNG/JPEG, audio PCM WAV 16 kHz mono de hasta 30 s y voz opcional. La inspección no llama al proveedor.",
  );
  lines.push(
    config.assessment.execution === "demo"
      ? "Medios en demo: guion ligado al hash del archivo y tono local. Un archivo desconocido no se presenta como comprendido."
      : "Medios en real: hace falta RESEARCH_MEDIA, un modelo de visión admitido y Workers AI. Si falta, no hay caída al guion.",
  );
  lines.push("pruebas de conexión: no ejecutadas");
  lines.push("verificado remotamente: no");
  const capability = selection.capability;
  if (capability !== undefined) {
    lines.push(`capacidad pedida: ${capability}`);
  }
  let code = 0;
  if (!config.environmentFound || config.assessment.execution === "misconfigured") {
    code = 2;
  } else if (capability === "crag") {
    code = cragStatus === "offline-fixture" || cragStatus === "configured" ? 0 : 2;
  } else if (capability === "research") {
    code = research.status === "offline-fixture" || research.status === "ready" ? 0 : 2;
  } else if (capability === "sin-rag") {
    const status = config.assessment.capabilities["sin-rag"].status;
    code = status === "offline-demo" || status === "ready" ? 0 : 2;
  } else if (capability === "rag") {
    code = rag.ok ? 0 : 2;
  } else if (
    config.assessment.execution === "real" &&
    config.assessment.capabilities["sin-rag"].status === "blocked"
  ) {
    code = 2;
  }
  if (code !== 0) {
    const missing =
      capability === "rag"
        ? rag.missing
        : capability === "crag"
          ? cragMissing
          : capability === "research"
            ? research.missing
            : config.assessment.capabilities["sin-rag"].missing;
    lines.push(
      `preflight incompleto: ${missing.join(", ") || config.assessment.message || "configuración"}`,
    );
  }
  return { code, lines };
}

function presentProcess(env: NodeJS.ProcessEnv, name: string): "presente" | "ausente" {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0 ? "presente" : "ausente";
}
