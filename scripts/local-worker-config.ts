// GUÍA DE LECTURA · scripts/local-worker-config.ts
// Lee la configuración que vería el Worker local (wrangler.jsonc + .dev.vars + proveedor del .env de la raíz),
// clasifica cada binding en ausente, declarado o configurado y redacta el informe del preflight sin claves.
// Lectura de archivos.
import { existsSync, readFileSync } from "node:fs";
// Corpus del chat: lectura de CHAT_CORPUS y variables de la tienda.
import { STORE_SETTING_VARIABLES, chatCorpusId } from "../apps/api/src/chat-corpus";
// Rutas.
import path from "node:path";
// Parser de .env.
import { parse } from "dotenv";
// Variables de proveedor del .env de la raíz.
import { readRepoProviderEnv } from "./anthropic-key";
// Capacidades del Worker.
import {
  assessWorker,
  generationMissing,
  type Assessment,
  type WorkerEnv,
} from "../apps/api/src/env";
// Nombres de variables y utilidades de configuración.
import {
  PROVIDER_ENV_VARIABLES,
  generationVariables,
  llmProvider,
  isConfiguredValue,
  RAG_BINDING_NAMES,
  RAG_SETTING_VARIABLES,
  type RagBindingName,
} from "@thepower-rag/contracts";

// Nivel de un binding.
export type BindingLevel = "absent" | "declared" | "configured";
// Capacidad que se puede comprobar.
export type CapabilityName = "sin-rag" | "rag" | "crag" | "research";

// Estado de un binding.
export interface BindingView {
  // Nivel.
  level: BindingLevel;
  // Conexión: nunca comprobada aquí.
  reachable: "not-checked";
  // Verificado: nunca.
  verified: false;
}

// Configuración local del Worker.
export interface LocalWorkerConfig {
  // Entorno de wrangler.
  environmentName: string | null;
  // Si existe en el archivo.
  environmentFound: boolean;
  // Fuente legible.
  source: string;
  // Archivo .dev.vars usado.
  devVarsFile: string | null;
  // Variables efectivas.
  vars: Record<string, string>;
  // Bindings.
  bindings: Record<RagBindingName, BindingView>;
  // Índice de Vectorize de la tienda ThePower Shop (solo lo usa el chat con CHAT_CORPUS=thepower-shop).
  storeBinding: BindingView;
  // Capacidades.
  assessment: Assessment;
}

// Opciones del preflight.
export interface PreflightSelection {
  // Capacidad.
  capability?: CapabilityName;
  // Entorno.
  environment?: string | null;
  // Archivo de configuración.
  configPath?: string;
}

// Lee un JSONC (con comentarios y comas finales).
function readJson(file: string): unknown {
  // Quita comentarios y comas finales.
  const text = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1");
  // JSON.
  return JSON.parse(text) as unknown;
}

// Objeto o null.
function record(value: unknown): Record<string, unknown> | null {
  // Comprobación.
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

// Solo las variables de texto.
function stringVars(value: unknown): Record<string, string> {
  // Objeto.
  const vars = record(value);
  // Resultado.
  const result: Record<string, string> = {};
  // Sin objeto.
  if (vars === null) {
    // Vacío.
    return result;
  }
  // Cada variable.
  for (const [key, item] of Object.entries(vars)) {
    // Si es texto.
    if (typeof item === "string") {
      // Se guarda.
      result[key] = item;
    }
  }
  // Variables.
  return result;
}

// Variables de texto de un wrangler.jsonc.
export function wranglerStringVars(file: string): Record<string, string> {
  // vars del archivo.
  return stringVars(record(readJson(file))?.vars);
}

// Variables efectivas: wrangler y encima .dev.vars.
export function effectiveWorkerVars(
  wranglerVars: Record<string, string>,
  devVarsText: string | null,
): Record<string, string> {
  // Copia.
  const result = { ...wranglerVars };
  // Sin .dev.vars.
  if (devVarsText === null) {
    // Tal cual.
    return result;
  }
  // Parsea .dev.vars.
  const parsed = parse(devVarsText);
  // Cada variable.
  for (const [key, value] of Object.entries(parsed)) {
    // Sobrescribe.
    result[key] = value;
  }
  // Resultado.
  return result;
}

// Nivel de un binding según sus campos.
function bindingLevel(
  item: Record<string, unknown> | null,
  resourceKeys: readonly string[],
): BindingLevel {
  // Sin entrada.
  if (item === null) {
    // Ausente.
    return "absent";
  }
  // Configurado si todos los campos tienen valor real; si no, declarado.
  return resourceKeys.every((key) =>
    isConfiguredValue(typeof item[key] === "string" ? item[key] : undefined),
  )
    ? "configured"
    : "declared";
}

// Bindings y variables de un entorno de wrangler.
export function inspectBindings(
  file: string,
  environment: string | null,
): {
  // Si existe el entorno.
  found: boolean;
  // Variables.
  vars: Record<string, string>;
  // Bindings.
  bindings: Record<RagBindingName, BindingView>;
  // Índice de la tienda.
  storeBinding: BindingView;
} {
  // Archivo.
  const parsed = record(readJson(file));
  // Sección del entorno o la raíz.
  const section = environment === null ? parsed : record(record(parsed?.env)?.[environment]);
  // Estado con nivel.
  const view = (level: BindingLevel): BindingView => ({
    level,
    reachable: "not-checked",
    verified: false,
  });
  // Entorno pedido inexistente.
  if (environment !== null && section === null) {
    // Todo ausente.
    return {
      found: false,
      vars: {},
      bindings: {
        AI: view("absent"),
        VECTORIZE: view("absent"),
        DB: view("absent"),
        CORPUS: view("absent"),
      },
      storeBinding: view("absent"),
    };
  }
  // Workers AI.
  const ai = record(section?.ai);
  // Vectorize con binding VECTORIZE.
  const vector = Array.isArray(section?.vectorize)
    ? (section.vectorize.map(record).find((item) => item?.binding === "VECTORIZE") ?? null)
    : null;
  // Vectorize con binding VECTORIZE_STORE (tienda ThePower Shop).
  const storeVector = Array.isArray(section?.vectorize)
    ? (section.vectorize.map(record).find((item) => item?.binding === "VECTORIZE_STORE") ?? null)
    : null;
  // D1 con binding DB.
  const database = Array.isArray(section?.d1_databases)
    ? (section.d1_databases.map(record).find((item) => item?.binding === "DB") ?? null)
    : null;
  // R2 con binding CORPUS.
  const bucket = Array.isArray(section?.r2_buckets)
    ? (section.r2_buckets.map(record).find((item) => item?.binding === "CORPUS") ?? null)
    : null;
  // Variables y niveles.
  return {
    found: true,
    vars: stringVars(section?.vars),
    bindings: {
      AI: view(ai?.binding === "AI" ? "configured" : "absent"),
      VECTORIZE: view(bindingLevel(vector, ["index_name"])),
      DB: view(bindingLevel(database, ["database_name", "database_id"])),
      CORPUS: view(bindingLevel(bucket, ["bucket_name"])),
    },
    storeBinding: view(bindingLevel(storeVector, ["index_name"])),
  };
}

// Nombre del .dev.vars: el del entorno si existe.
export function devVarsFileName(
  environment: string | null,
  exists: (name: string) => boolean,
): string {
  // Con entorno.
  if (environment !== null) {
    // .dev.vars.<entorno>.
    const specific = `.dev.vars.${environment}`;
    // Si existe.
    if (exists(specific)) {
      // Ese.
      return specific;
    }
  }
  // El general.
  return ".dev.vars";
}

// Carga la configuración local efectiva.
export function loadLocalWorkerConfig(
  root: string,
  selection: PreflightSelection = {},
): LocalWorkerConfig {
  // Archivo de wrangler.
  const configPath = selection.configPath ?? path.join(root, "apps/web/wrangler.jsonc");
  // Entorno.
  const environment = selection.environment ?? null;
  // Bindings y variables.
  const inspected = inspectBindings(configPath, environment);
  // .dev.vars.
  const devName = devVarsFileName(environment, (name) =>
    existsSync(path.join(path.dirname(configPath), name)),
  );
  // Ruta.
  const devVarsPath = path.join(path.dirname(configPath), devName);
  // Texto o null.
  const devVarsText = existsSync(devVarsPath) ? readFileSync(devVarsPath, "utf8") : null;
  // Variables efectivas.
  const vars = effectiveWorkerVars(inspected.vars, devVarsText);
  // Como en Vite: proveedor y claves del .env de la raíz si el Worker no los trae.
  const repoProvider = environment === "research" ? {} : readRepoProviderEnv(root);
  // Cada variable del .env.
  for (const [name, value] of Object.entries(repoProvider)) {
    // Si el Worker no la trae.
    if (!isConfiguredValue(vars[name])) {
      // La copia.
      vars[name] = value;
    }
  }
  // Ruta relativa.
  const relativeConfig = path.relative(root, configPath);
  // Configuración con capacidades (o error si el entorno no existe).
  return {
    // Entorno pedido y si existe en el archivo.
    environmentName: environment,
    environmentFound: inspected.found,
    // De dónde sale la configuración (archivo, entorno y .dev.vars).
    source: `${relativeConfig}${environment === null ? "" : ` env.${environment}`}${devVarsText === null ? "" : ` + ${devName}`}`,
    devVarsFile: devVarsText === null ? null : devName,
    // Variables efectivas y bindings clasificados.
    vars,
    bindings: inspected.bindings,
    storeBinding: inspected.storeBinding,
    // Diagnóstico con las mismas reglas que el Worker, o todo bloqueado si el entorno no existe.
    assessment: inspected.found
      ? assessWorker(vars as WorkerEnv)
      : {
          execution: "misconfigured",
          message: "El entorno pedido no está en el archivo de Wrangler.",
          generation: null,
          retrieval: null,
          chatCorpus: null,
          chatRetrieval: null,
          capabilities: {
            "sin-rag": { status: "blocked", missing: ["APP_MODE"] },
            rag: { status: "blocked", missing: ["APP_MODE"] },
            crag: { status: "blocked", missing: ["APP_MODE"] },
            research: { status: "blocked", missing: ["APP_MODE"] },
          },
        },
  };
}

// ¿Variable con valor real?
function present(vars: Record<string, string>, name: string): boolean {
  // Comprobación.
  return isConfiguredValue(vars[name]);
}

// ¿Está declarado todo lo que necesita el RAG real?
export function ragDeclarationReady(config: LocalWorkerConfig): { ok: boolean; missing: string[] } {
  // Demo: sí.
  if (config.assessment.execution === "demo") {
    // Listo.
    return { ok: true, missing: [] };
  }
  // Lo que falta.
  const missing: string[] = [];
  // Generación del proveedor elegido (LLM_PROVIDER) y ajustes del índice.
  missing.push(...generationMissing(config.vars as WorkerEnv));
  // Ajustes del RAG.
  for (const name of RAG_SETTING_VARIABLES) {
    // Ausente.
    if (!present(config.vars, name)) {
      // Falta.
      missing.push(name);
    }
  }
  // Dimensiones.
  if (present(config.vars, "EMBEDDING_DIMENSIONS")) {
    // Número.
    const parsed = Number(config.vars.EMBEDDING_DIMENSIONS);
    // No es entero positivo.
    if (!Number.isInteger(parsed) || parsed <= 0) {
      // Falta.
      missing.push("EMBEDDING_DIMENSIONS");
    }
  }
  // Métrica distinta de cosine.
  if (present(config.vars, "VECTOR_METRIC") && config.vars.VECTOR_METRIC?.trim() !== "cosine") {
    // Falta.
    missing.push("VECTOR_METRIC");
  }
  // Umbral no numérico.
  if (
    present(config.vars, "MIN_RETRIEVAL_SCORE") &&
    !Number.isFinite(Number(config.vars.MIN_RETRIEVAL_SCORE))
  ) {
    // Falta.
    missing.push("MIN_RETRIEVAL_SCORE");
  }
  // Bindings.
  for (const name of RAG_BINDING_NAMES) {
    // No configurado.
    if (config.bindings[name].level !== "configured") {
      // Falta.
      missing.push(name);
    }
  }
  // Corpus del chat: con la tienda también hacen falta sus variables y su índice.
  const chatCorpus = chatCorpusId(config.vars.CHAT_CORPUS);
  // Valor desconocido.
  if (chatCorpus === null) missing.push("CHAT_CORPUS");
  // Tienda ThePower Shop.
  if (chatCorpus === "thepower-shop") {
    // Cada variable de la tienda.
    for (const name of STORE_SETTING_VARIABLES) {
      // Ausente o marcador.
      if (!present(config.vars, name)) missing.push(name);
    }
    // Umbral no numérico.
    if (
      present(config.vars, "STORE_MIN_RETRIEVAL_SCORE") &&
      !Number.isFinite(Number(config.vars.STORE_MIN_RETRIEVAL_SCORE))
    )
      // Falta.
      missing.push("STORE_MIN_RETRIEVAL_SCORE");
    // Índice de la tienda.
    if (config.storeBinding.level !== "configured") missing.push("VECTORIZE_STORE");
    // El contexto completo es solo del curso.
    if (config.vars.RAG_CONTEXT_MODE === "complete") missing.push("RAG_CONTEXT_MODE");
  }
  // Listo si es real y no falta nada.
  return { ok: config.assessment.execution === "real" && missing.length === 0, missing };
}

// Informe del preflight con código 0 (listo) o 2 (incompleto).
export function formatPreflight(
  config: LocalWorkerConfig,
  processEnv: NodeJS.ProcessEnv,
  selection: PreflightSelection = {},
): { code: number; lines: string[] } {
  // Cabecera con la fuente de la configuración.
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
  // Proveedor.
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
  // Variables por grupo.
  const groups: [string, readonly string[]][] = [
    // Generación: las variables que exige el proveedor elegido.
    [
      "generación",
      provider === null ? ["LLM_PROVIDER", "MODEL_ID"] : generationVariables(provider),
    ],
    // RAG: modelo de embeddings, dimensión, versión, perfil, métrica y umbral.
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
    // CRAG: además, el evaluador.
    ["crag", ["EVALUATOR_MODEL_ID"]],
  ];
  // Cada grupo.
  for (const [title, names] of groups) {
    // Título.
    lines.push(`nombres de ${title} en la configuración efectiva:`);
    // Cada variable.
    for (const name of names) {
      // Presente o ausente.
      lines.push(`  ${name}: ${present(config.vars, name) ? "presente" : "ausente"}`);
    }
  }
  // Bindings.
  lines.push("bindings esperados:");
  // Cada binding.
  for (const name of RAG_BINDING_NAMES) {
    // Estado.
    const binding = config.bindings[name];
    // Nivel, sin comprobar conexión.
    lines.push(`  ${name}: ${binding.level}; alcanzable: no comprobado; verificado: no`);
  }
  // Corpus del chat y, con la tienda, sus variables e índice. La investigación sigue con el curso.
  const chatCorpus = chatCorpusId(config.vars.CHAT_CORPUS);
  // Línea del corpus.
  lines.push(
    `corpus del chat (CHAT_CORPUS): ${chatCorpus ?? `desconocido (${config.vars.CHAT_CORPUS ?? ""})`}; la investigación usa el curso`,
  );
  // Con la tienda, sus nombres y su binding.
  if (chatCorpus === "thepower-shop") {
    // Cada variable.
    for (const name of STORE_SETTING_VARIABLES)
      // Presente o ausente.
      lines.push(`  ${name}: ${present(config.vars, name) ? "presente" : "ausente"}`);
    // Índice de la tienda.
    lines.push(
      `  VECTORIZE_STORE: ${config.storeBinding.level}; alcanzable: no comprobado; verificado: no`,
    );
  }
  // Variables solo en process.env.
  lines.push("nombres solo en process.env, ignorados por el Worker:");
  // Cada nombre.
  for (const name of ["APP_MODE", ...PROVIDER_ENV_VARIABLES, "MODEL_ID", "EVALUATOR_MODEL_ID"]) {
    // Presente o ausente.
    lines.push(`  ${name}: ${presentProcess(processEnv, name)}`);
  }
  // Sin RAG.
  lines.push(`sin RAG: ${config.assessment.capabilities["sin-rag"].status}`);
  // RAG.
  const rag = ragDeclarationReady(config);
  // Estado.
  lines.push(
    `RAG básico: ${config.assessment.execution === "demo" ? "offline-fixture" : rag.ok ? "configured" : "blocked"}`,
  );
  // Lo que falta a CRAG.
  const cragMissing = [
    ...new Set([
      ...rag.missing,
      ...config.assessment.capabilities["sin-rag"].missing,
      ...(present(config.vars, "EVALUATOR_MODEL_ID") ? [] : ["EVALUATOR_MODEL_ID"]),
    ]),
  ];
  // Estado de CRAG.
  const cragStatus =
    config.assessment.execution === "demo"
      ? "offline-fixture"
      : cragMissing.length === 0
        ? "configured"
        : "blocked";
  // Línea.
  lines.push(`CRAG: ${cragStatus}`);
  // Investigación.
  const research = config.assessment.capabilities.research;
  // Línea.
  lines.push(
    `Investigación: ${research.status}${research.status === "blocked" ? ` (falta: ${research.missing.join(", ")})` : ""}`,
  );
  // Medios.
  lines.push(
    "Medios: imagen PNG/JPEG, audio PCM WAV 16 kHz mono de hasta 30 s y voz opcional. La inspección no llama al proveedor.",
  );
  // Medios según el modo.
  lines.push(
    config.assessment.execution === "demo"
      ? "Medios en demo: guion ligado al hash del archivo y tono local. Un archivo desconocido no se presenta como comprendido."
      : "Medios en real: hace falta RESEARCH_MEDIA, un modelo de visión admitido y Workers AI. Si falta, no hay caída al guion.",
  );
  // Sin pruebas de conexión.
  lines.push("pruebas de conexión: no ejecutadas");
  // Sin verificación remota.
  lines.push("verificado remotamente: no");
  // Capacidad pedida.
  const capability = selection.capability;
  // Si hay.
  if (capability !== undefined) {
    // Línea.
    lines.push(`capacidad pedida: ${capability}`);
  }
  // Código.
  let code = 0;
  // Configuración inválida.
  if (!config.environmentFound || config.assessment.execution === "misconfigured") {
    // 2.
    code = 2;
  } else if (capability === "crag") {
    // CRAG.
    code = cragStatus === "offline-fixture" || cragStatus === "configured" ? 0 : 2;
  } else if (capability === "research") {
    // Investigación.
    code = research.status === "offline-fixture" || research.status === "ready" ? 0 : 2;
  } else if (capability === "sin-rag") {
    // Sin RAG.
    const status = config.assessment.capabilities["sin-rag"].status;
    // Código.
    code = status === "offline-demo" || status === "ready" ? 0 : 2;
  } else if (capability === "rag") {
    // RAG.
    code = rag.ok ? 0 : 2;
  } else if (
    config.assessment.execution === "real" &&
    config.assessment.capabilities["sin-rag"].status === "blocked"
  ) {
    // Real sin generación.
    code = 2;
  }
  // Incompleto.
  if (code !== 0) {
    // Lo que falta según la capacidad.
    const missing =
      capability === "rag"
        ? rag.missing
        : capability === "crag"
          ? cragMissing
          : capability === "research"
            ? research.missing
            : config.assessment.capabilities["sin-rag"].missing;
    // Línea.
    lines.push(
      `preflight incompleto: ${missing.join(", ") || config.assessment.message || "configuración"}`,
    );
  }
  // Informe.
  return { code, lines };
}

// ¿Variable presente en process.env?
function presentProcess(env: NodeJS.ProcessEnv, name: string): "presente" | "ausente" {
  // Valor.
  const value = env[name];
  // Presente o ausente.
  return typeof value === "string" && value.trim().length > 0 ? "presente" : "ausente";
}
