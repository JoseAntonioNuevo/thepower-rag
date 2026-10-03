import { isConfiguredValue } from "@thepower-rag/contracts";
import {
  COURSE_D1_NAME,
  COURSE_R2_NAME,
  COURSE_VECTORIZE_PREFIX,
  INGEST_ORDER,
  vectorizeIndexName,
} from "@thepower-rag/core";

export type ActivationCommand =
  | "plan"
  | "status"
  | "provision"
  | "migrate"
  | "ingest"
  | "probe-embeddings"
  | "resume"
  | "select-active"
  | "verify";

export const ACTIVATION_COMMANDS: readonly ActivationCommand[] = [
  "plan",
  "status",
  "provision",
  "migrate",
  "ingest",
  "probe-embeddings",
  "resume",
  "select-active",
  "verify",
];

export interface ActivationAuth {
  accountId: string | null;
  accountName: string | null;
  loginEmail: string | null;
  allowCreateD1: boolean;
  allowCreateR2: boolean;
  allowCreateVectorize: boolean;
  allowWorkersAi: boolean;
  allowOpenRouter: boolean;
  modelId: string | null;
  maxSpendUsd: number | null;
  allowPlanChange: false | null;
  observedDimensions: number | null;
}

export interface CommandOutcome {
  ok: boolean;
  summary: string;
  lines?: readonly string[];
  receipt?: Record<string, unknown>;
}

export interface ActivationExecutor {
  identify(auth: ActivationAuth): Promise<CommandOutcome>;
  inventory(auth: ActivationAuth): Promise<CommandOutcome>;
  provision(auth: ActivationAuth): Promise<CommandOutcome>;
  migrate(auth: ActivationAuth): Promise<CommandOutcome>;
  probeEmbeddings(auth: ActivationAuth): Promise<CommandOutcome>;
  ingest(auth: ActivationAuth): Promise<CommandOutcome>;
  resume(auth: ActivationAuth, profileId: string): Promise<CommandOutcome>;
  selectActive(auth: ActivationAuth, profileId: string): Promise<CommandOutcome>;
  verify(auth: ActivationAuth): Promise<CommandOutcome>;
}

export function parseActivation(
  value: unknown,
): { ok: true; auth: ActivationAuth } | { ok: false; missing: string[] } {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  if (record === null) {
    return {
      ok: false,
      missing: ["accountId", "accountName", "maxSpendUsd", "allowPlanChange"],
    };
  }
  const missing: string[] = [];
  const text = (name: string): string | null => {
    if (record[name] === undefined || record[name] === null) {
      return null;
    }
    return typeof record[name] === "string" ? record[name] : null;
  };
  if (record.accountId !== undefined && record.accountId !== null && text("accountId") === null) {
    missing.push("accountId");
  }
  if (
    record.accountName !== undefined &&
    record.accountName !== null &&
    text("accountName") === null
  ) {
    missing.push("accountName");
  }
  if (
    record.loginEmail !== undefined &&
    record.loginEmail !== null &&
    text("loginEmail") === null
  ) {
    missing.push("loginEmail");
  }
  for (const name of [
    "allowCreateD1",
    "allowCreateR2",
    "allowCreateVectorize",
    "allowWorkersAi",
    "allowOpenRouter",
  ] as const) {
    if (record[name] !== undefined && typeof record[name] !== "boolean") {
      missing.push(name);
    }
  }
  if (record.modelId !== undefined && record.modelId !== null && text("modelId") === null) {
    missing.push("modelId");
  }
  let maxSpendUsd: number | null = null;
  if (record.maxSpendUsd !== undefined && record.maxSpendUsd !== null) {
    if (
      typeof record.maxSpendUsd !== "number" ||
      !Number.isFinite(record.maxSpendUsd) ||
      record.maxSpendUsd < 0
    ) {
      missing.push("maxSpendUsd");
    } else {
      maxSpendUsd = record.maxSpendUsd;
    }
  }
  let allowPlanChange: false | null = null;
  if (record.allowPlanChange === false) {
    allowPlanChange = false;
  } else if (record.allowPlanChange !== undefined) {
    missing.push("allowPlanChange");
  }
  let observedDimensions: number | null = null;
  if (record.observedDimensions !== undefined && record.observedDimensions !== null) {
    if (
      typeof record.observedDimensions === "number" &&
      Number.isInteger(record.observedDimensions) &&
      record.observedDimensions > 0 &&
      record.observedDimensions <= 1536
    ) {
      observedDimensions = record.observedDimensions;
    } else {
      missing.push("observedDimensions");
    }
  }
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  const accountId = text("accountId");
  const accountName = text("accountName");
  const loginEmail = text("loginEmail");
  const modelId = text("modelId");
  return {
    ok: true,
    auth: {
      accountId: accountId !== null && isConfiguredValue(accountId) ? accountId.trim() : null,
      accountName:
        accountName !== null && isConfiguredValue(accountName) ? accountName.trim() : null,
      loginEmail: loginEmail !== null && isConfiguredValue(loginEmail) ? loginEmail.trim() : null,
      allowCreateD1: record.allowCreateD1 === true,
      allowCreateR2: record.allowCreateR2 === true,
      allowCreateVectorize: record.allowCreateVectorize === true,
      allowWorkersAi: record.allowWorkersAi === true,
      allowOpenRouter: record.allowOpenRouter === true,
      modelId: modelId !== null && isConfiguredValue(modelId) ? modelId.trim() : null,
      maxSpendUsd,
      allowPlanChange,
      observedDimensions,
    },
  };
}

export function missingFor(
  command: ActivationCommand,
  auth: ActivationAuth,
  profileId: string | null,
): string[] {
  const missing: string[] = [];
  const account = () => {
    if (auth.accountId === null) {
      missing.push("accountId");
    }
    if (auth.accountName === null) {
      missing.push("accountName");
    }
  };
  const cap = () => {
    if (auth.maxSpendUsd === null) {
      missing.push("maxSpendUsd");
    }
    if (auth.allowPlanChange !== false) {
      missing.push("allowPlanChange");
    }
  };
  if (command === "plan") {
    return [];
  }
  if (command === "status") {
    account();
    return missing;
  }
  account();
  cap();
  if (command === "probe-embeddings" && !auth.allowWorkersAi) {
    missing.push("allowWorkersAi");
  }
  if ((command === "migrate" || command === "select-active") && !auth.allowCreateD1) {
    missing.push("allowCreateD1");
  }
  if (command === "ingest" && !auth.allowWorkersAi) {
    missing.push("allowWorkersAi");
  }
  if ((command === "ingest" || command === "resume") && auth.observedDimensions === null) {
    missing.push("observedDimensions");
  }
  if ((command === "resume" || command === "select-active") && profileId === null) {
    missing.push("profileId");
  }
  if (command === "verify") {
    if (!auth.allowOpenRouter) {
      missing.push("allowOpenRouter");
    }
    if (auth.modelId === null) {
      missing.push("modelId");
    }
  }
  return missing;
}

export function planLines(profileId: string | null): string[] {
  const index =
    profileId === null
      ? `${COURSE_VECTORIZE_PREFIX}<perfil-observado>`
      : vectorizeIndexName(profileId);
  return [
    "plan de activación",
    "destino documentado: Joseantonionuevo@gmail.com's Account",
    "id de cuenta documentado: 9c1493e94ba21f2c6872a9dd17ba19f7",
    `D1: ${COURSE_D1_NAME}`,
    `R2 privado: ${COURSE_R2_NAME}`,
    `Vectorize: ${index}`,
    "bindings previstos: AI, VECTORIZE, DB, CORPUS",
    "métrica pedida: cosine. La dimensión sale de una sonda de @cf/baai/bge-m3, no de 768 ni de 128.",
    "índices de metadatos previos a la inserción: corpusVersion, audience, profileId.",
    ...INGEST_ORDER.map((step) => `- ${step}`),
    "status --read solo consulta la cuenta y los nombres del curso.",
    "provision, migrate, ingest, probe-embeddings, resume, select-active y verify exigen --execute y su permiso.",
    "un tope guardado en JSON no demuestra que el gasto esté controlado.",
  ];
}

export async function runActivation(input: {
  command: ActivationCommand;
  execute: boolean;
  read: boolean;
  authorization: unknown;
  profileId?: string | null;
  executor?: ActivationExecutor;
}): Promise<{ code: number; lines: string[] }> {
  const lines = planLines(input.profileId ?? null);
  const remote = input.execute || (input.command === "status" && input.read);
  if (!remote) {
    lines.push(`comando ${input.command}: simulación, sin red`);
    return { code: 0, lines };
  }
  if (input.execute && input.read) {
    lines.push("status --read no se combina con --execute");
    return { code: 2, lines };
  }
  const parsed = parseActivation(input.authorization);
  if (!parsed.ok) {
    lines.push(`la autorización no es válida: ${parsed.missing.join(", ")}`);
    return { code: 2, lines };
  }
  const missing = missingFor(input.command, parsed.auth, input.profileId ?? null);
  if (missing.length > 0) {
    lines.push(`faltan autorizaciones de esta operación: ${missing.join(", ")}`);
    return { code: 2, lines };
  }
  if (input.executor === undefined) {
    lines.push("no hay un ejecutor conectado para esta operación");
    return { code: 2, lines };
  }
  const outcome = await dispatch(
    input.executor,
    input.command,
    parsed.auth,
    input.profileId ?? null,
  );
  lines.push(outcome.summary);
  if (outcome.lines !== undefined) {
    lines.push(...outcome.lines);
  }
  return { code: outcome.ok ? 0 : 2, lines };
}

async function dispatch(
  executor: ActivationExecutor,
  command: ActivationCommand,
  auth: ActivationAuth,
  profileId: string | null,
): Promise<CommandOutcome> {
  if (command === "status") {
    const identity = await executor.identify(auth);
    if (!identity.ok) {
      return identity;
    }
    const inventory = await executor.inventory(auth);
    return {
      ok: inventory.ok,
      summary: `${identity.summary} ${inventory.summary}`,
      lines: [...(identity.lines ?? []), ...(inventory.lines ?? [])],
      receipt: { ...(identity.receipt ?? {}), ...(inventory.receipt ?? {}) },
    };
  }
  if (command === "provision") {
    return executor.provision(auth);
  }
  if (command === "migrate") {
    return executor.migrate(auth);
  }
  if (command === "probe-embeddings") {
    return executor.probeEmbeddings(auth);
  }
  if (command === "ingest") {
    return executor.ingest(auth);
  }
  if (command === "resume") {
    return executor.resume(auth, profileId ?? "");
  }
  if (command === "select-active") {
    return executor.selectActive(auth, profileId ?? "");
  }
  if (command === "verify") {
    return executor.verify(auth);
  }
  return { ok: true, summary: "plan sin red" };
}
