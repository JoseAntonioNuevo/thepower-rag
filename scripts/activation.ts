// GUÍA DE LECTURA · scripts/activation.ts
// Reglas de la activación del curso: qué comandos existen, cómo se lee la autorización de
// apps/web/.activation.json, qué permisos pide cada comando y cómo se despacha al ejecutor.
// ¿Valor real o marcador de plantilla?
import { isConfiguredValue } from "@thepower-rag/contracts";
// Nombres de recursos del curso, orden de la ingesta y nombre del índice.
import {
  COURSE_D1_NAME,
  COURSE_R2_NAME,
  COURSE_VECTORIZE_PREFIX,
  INGEST_ORDER,
  vectorizeIndexName,
} from "@thepower-rag/core";

// Comandos de la activación.
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

// Lista de comandos admitidos.
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

// Autorización leída del archivo local.
export interface ActivationAuth {
  // Cuenta de Cloudflare.
  accountId: string | null;
  // Nombre de la cuenta.
  accountName: string | null;
  // Correo de la sesión.
  loginEmail: string | null;
  // Permiso para crear D1.
  allowCreateD1: boolean;
  // Permiso para crear R2.
  allowCreateR2: boolean;
  // Permiso para crear Vectorize.
  allowCreateVectorize: boolean;
  // Permiso para usar Workers AI.
  allowWorkersAi: boolean;
  // Permiso para llamar al proveedor generativo (nombre histórico).
  allowOpenRouter: boolean;
  // Modelo generativo.
  modelId: string | null;
  // Tope de gasto en USD.
  maxSpendUsd: number | null;
  // Debe ser false: no se cambia el plan de la cuenta.
  allowPlanChange: false | null;
  // Dimensión medida por la sonda.
  observedDimensions: number | null;
}

// Resultado de un comando.
export interface CommandOutcome {
  // Correcto.
  ok: boolean;
  // Resumen.
  summary: string;
  // Líneas extra.
  lines?: readonly string[];
  // Recibo.
  receipt?: Record<string, unknown>;
}

// Operaciones que un ejecutor debe implementar.
export interface ActivationExecutor {
  // Identidad de la sesión.
  identify(auth: ActivationAuth): Promise<CommandOutcome>;
  // Inventario de recursos.
  inventory(auth: ActivationAuth): Promise<CommandOutcome>;
  // Crear recursos.
  provision(auth: ActivationAuth): Promise<CommandOutcome>;
  // Migraciones de D1.
  migrate(auth: ActivationAuth): Promise<CommandOutcome>;
  // Sonda de embeddings.
  probeEmbeddings(auth: ActivationAuth): Promise<CommandOutcome>;
  // Ingesta.
  ingest(auth: ActivationAuth): Promise<CommandOutcome>;
  // Reanudar una ingesta.
  resume(auth: ActivationAuth, profileId: string): Promise<CommandOutcome>;
  // Elegir el perfil activo.
  selectActive(auth: ActivationAuth, profileId: string): Promise<CommandOutcome>;
  // Verificación de extremo a extremo.
  verify(auth: ActivationAuth): Promise<CommandOutcome>;
}

// Valida la autorización y devuelve los campos que no son válidos.
export function parseActivation(
  value: unknown,
): { ok: true; auth: ActivationAuth } | { ok: false; missing: string[] } {
  // Objeto o null.
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  // No es objeto.
  if (record === null) {
    // Faltan los campos básicos.
    return {
      ok: false,
      missing: ["accountId", "accountName", "maxSpendUsd", "allowPlanChange"],
    };
  }
  // Campos inválidos.
  const missing: string[] = [];
  // Texto de un campo o null.
  const text = (name: string): string | null => {
    // Ausente.
    if (record[name] === undefined || record[name] === null) {
      // null.
      return null;
    }
    // Texto o null.
    return typeof record[name] === "string" ? record[name] : null;
  };
  // accountId debe ser texto.
  if (record.accountId !== undefined && record.accountId !== null && text("accountId") === null) {
    // Inválido.
    missing.push("accountId");
  }
  // accountName debe ser texto.
  if (
    record.accountName !== undefined &&
    record.accountName !== null &&
    text("accountName") === null
  ) {
    // Inválido.
    missing.push("accountName");
  }
  // loginEmail debe ser texto.
  if (
    record.loginEmail !== undefined &&
    record.loginEmail !== null &&
    text("loginEmail") === null
  ) {
    // Inválido.
    missing.push("loginEmail");
  }
  // Permisos booleanos.
  for (const name of [
    "allowCreateD1",
    "allowCreateR2",
    "allowCreateVectorize",
    "allowWorkersAi",
    "allowOpenRouter",
  ] as const) {
    // No booleano.
    if (record[name] !== undefined && typeof record[name] !== "boolean") {
      // Inválido.
      missing.push(name);
    }
  }
  // modelId debe ser texto.
  if (record.modelId !== undefined && record.modelId !== null && text("modelId") === null) {
    // Inválido.
    missing.push("modelId");
  }
  // Tope de gasto.
  let maxSpendUsd: number | null = null;
  // Si viene.
  if (record.maxSpendUsd !== undefined && record.maxSpendUsd !== null) {
    // Número finito no negativo.
    if (
      typeof record.maxSpendUsd !== "number" ||
      !Number.isFinite(record.maxSpendUsd) ||
      record.maxSpendUsd < 0
    ) {
      // Inválido.
      missing.push("maxSpendUsd");
    } else {
      // Tope.
      maxSpendUsd = record.maxSpendUsd;
    }
  }
  // Cambio de plan.
  let allowPlanChange: false | null = null;
  // Solo se admite false.
  if (record.allowPlanChange === false) {
    // false.
    allowPlanChange = false;
  } else if (record.allowPlanChange !== undefined) {
    // Otro valor: inválido.
    missing.push("allowPlanChange");
  }
  // Dimensión medida.
  let observedDimensions: number | null = null;
  // Si viene.
  if (record.observedDimensions !== undefined && record.observedDimensions !== null) {
    // Entero entre 1 y 1536.
    if (
      typeof record.observedDimensions === "number" &&
      Number.isInteger(record.observedDimensions) &&
      record.observedDimensions > 0 &&
      record.observedDimensions <= 1536
    ) {
      // Dimensión.
      observedDimensions = record.observedDimensions;
    } else {
      // Inválida.
      missing.push("observedDimensions");
    }
  }
  // Algo inválido.
  if (missing.length > 0) {
    // Lista de errores.
    return { ok: false, missing };
  }
  // Cuenta.
  const accountId = text("accountId");
  // Nombre.
  const accountName = text("accountName");
  // Correo.
  const loginEmail = text("loginEmail");
  // Modelo.
  const modelId = text("modelId");
  // Autorización normalizada (los marcadores cuentan como ausentes).
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

// Permisos que faltan para un comando concreto.
export function missingFor(
  command: ActivationCommand,
  auth: ActivationAuth,
  profileId: string | null,
): string[] {
  // Lo que falta.
  const missing: string[] = [];
  // Comprueba la cuenta.
  const account = () => {
    // Sin id.
    if (auth.accountId === null) {
      // Falta.
      missing.push("accountId");
    }
    // Sin nombre.
    if (auth.accountName === null) {
      // Falta.
      missing.push("accountName");
    }
  };
  // Comprueba el tope y el plan.
  const cap = () => {
    // Sin tope.
    if (auth.maxSpendUsd === null) {
      // Falta.
      missing.push("maxSpendUsd");
    }
    // Plan no fijado.
    if (auth.allowPlanChange !== false) {
      // Falta.
      missing.push("allowPlanChange");
    }
  };
  // plan no pide nada.
  if (command === "plan") {
    // Nada.
    return [];
  }
  // status solo pide la cuenta.
  if (command === "status") {
    // Cuenta.
    account();
    // Lo que falta.
    return missing;
  }
  // El resto pide cuenta.
  account();
  // Y tope.
  cap();
  // Sonda: Workers AI.
  if (command === "probe-embeddings" && !auth.allowWorkersAi) {
    // Falta.
    missing.push("allowWorkersAi");
  }
  // Migrar o seleccionar: permiso de D1.
  if ((command === "migrate" || command === "select-active") && !auth.allowCreateD1) {
    // Falta.
    missing.push("allowCreateD1");
  }
  // Ingesta: Workers AI.
  if (command === "ingest" && !auth.allowWorkersAi) {
    // Falta.
    missing.push("allowWorkersAi");
  }
  // Ingesta o reanudación: dimensión medida.
  if ((command === "ingest" || command === "resume") && auth.observedDimensions === null) {
    // Falta.
    missing.push("observedDimensions");
  }
  // Reanudar o seleccionar: perfil.
  if ((command === "resume" || command === "select-active") && profileId === null) {
    // Falta.
    missing.push("profileId");
  }
  // Verificar.
  if (command === "verify") {
    // Permiso del proveedor.
    if (!auth.allowOpenRouter) {
      // Falta.
      missing.push("allowOpenRouter");
    }
    // Modelo.
    if (auth.modelId === null) {
      // Falta.
      missing.push("modelId");
    }
  }
  // Lo que falta.
  return missing;
}

// Texto del plan de activación.
export function planLines(profileId: string | null): string[] {
  // Índice: el del perfil o un marcador.
  const index =
    profileId === null
      ? `${COURSE_VECTORIZE_PREFIX}<perfil-observado>`
      : vectorizeIndexName(profileId);
  // Líneas.
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

// Ejecuta un comando de la activación.
export async function runActivation(input: {
  // Comando.
  command: ActivationCommand;
  // --execute.
  execute: boolean;
  // --read.
  read: boolean;
  // Autorización.
  authorization: unknown;
  // Perfil.
  profileId?: string | null;
  // Ejecutor.
  executor?: ActivationExecutor;
}): Promise<{ code: number; lines: string[] }> {
  // Empieza con el plan.
  const lines = planLines(input.profileId ?? null);
  // ¿Toca la red?
  const remote = input.execute || (input.command === "status" && input.read);
  // Simulación.
  if (!remote) {
    // Lo indica.
    lines.push(`comando ${input.command}: simulación, sin red`);
    // Código 0.
    return { code: 0, lines };
  }
  // --execute y --read juntos.
  if (input.execute && input.read) {
    // Error.
    lines.push("status --read no se combina con --execute");
    // Código 2.
    return { code: 2, lines };
  }
  // Autorización.
  const parsed = parseActivation(input.authorization);
  // Inválida.
  if (!parsed.ok) {
    // Error.
    lines.push(`la autorización no es válida: ${parsed.missing.join(", ")}`);
    // Código 2.
    return { code: 2, lines };
  }
  // Permisos de este comando.
  const missing = missingFor(input.command, parsed.auth, input.profileId ?? null);
  // Falta alguno.
  if (missing.length > 0) {
    // Error.
    lines.push(`faltan autorizaciones de esta operación: ${missing.join(", ")}`);
    // Código 2.
    return { code: 2, lines };
  }
  // Sin ejecutor.
  if (input.executor === undefined) {
    // Error.
    lines.push("no hay un ejecutor conectado para esta operación");
    // Código 2.
    return { code: 2, lines };
  }
  // Despacha.
  const outcome = await dispatch(
    input.executor,
    input.command,
    parsed.auth,
    input.profileId ?? null,
  );
  // Resumen.
  lines.push(outcome.summary);
  // Líneas extra.
  if (outcome.lines !== undefined) {
    // Las añade.
    lines.push(...outcome.lines);
  }
  // Código 0 o 2.
  return { code: outcome.ok ? 0 : 2, lines };
}

// Llama al método del ejecutor que corresponde al comando.
async function dispatch(
  executor: ActivationExecutor,
  command: ActivationCommand,
  auth: ActivationAuth,
  profileId: string | null,
): Promise<CommandOutcome> {
  // status.
  if (command === "status") {
    // Identidad.
    const identity = await executor.identify(auth);
    // Fallo.
    if (!identity.ok) {
      // Se devuelve.
      return identity;
    }
    // Inventario.
    const inventory = await executor.inventory(auth);
    // Ambos resultados.
    return {
      ok: inventory.ok,
      summary: `${identity.summary} ${inventory.summary}`,
      lines: [...(identity.lines ?? []), ...(inventory.lines ?? [])],
      receipt: { ...(identity.receipt ?? {}), ...(inventory.receipt ?? {}) },
    };
  }
  // provision.
  if (command === "provision") {
    // Crear recursos.
    return executor.provision(auth);
  }
  // migrate.
  if (command === "migrate") {
    // Migraciones.
    return executor.migrate(auth);
  }
  // probe-embeddings.
  if (command === "probe-embeddings") {
    // Sonda.
    return executor.probeEmbeddings(auth);
  }
  // ingest.
  if (command === "ingest") {
    // Ingesta.
    return executor.ingest(auth);
  }
  // resume.
  if (command === "resume") {
    // Reanudación.
    return executor.resume(auth, profileId ?? "");
  }
  // select-active.
  if (command === "select-active") {
    // Selección.
    return executor.selectActive(auth, profileId ?? "");
  }
  // verify.
  if (command === "verify") {
    // Verificación.
    return executor.verify(auth);
  }
  // plan.
  return { ok: true, summary: "plan sin red" };
}
