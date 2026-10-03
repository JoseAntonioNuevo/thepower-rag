export interface ProcessRun {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface AccountIdentity {
  email: string | null;
  accountId: string;
  accountName: string;
  accountCount: number;
}

export function sanitizeCommandText(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [omitido]")
    .replace(/(api[_-]?token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[omitido]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[omitido]");
}

export function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const objectAt = trimmed.indexOf("{");
    const arrayAt = trimmed.indexOf("[");
    const start =
      objectAt === -1 ? arrayAt : arrayAt === -1 ? objectAt : Math.min(objectAt, arrayAt);
    if (start < 0) {
      return null;
    }
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (end <= start) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

export function parseWhoami(
  body: unknown,
  expected: { accountId: string; accountName: string; loginEmail: string | null },
): { ok: true; identity: AccountIdentity } | { ok: false; reason: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, reason: "whoami no devolvió un objeto JSON" };
  }
  const record = body as Record<string, unknown>;
  if (record.loggedIn !== true) {
    return { ok: false, reason: "Wrangler no tiene una sesión iniciada" };
  }
  if (!Array.isArray(record.accounts)) {
    return { ok: false, reason: "whoami no trajo la lista de cuentas" };
  }
  const accounts = record.accounts.flatMap((account) => {
    if (typeof account !== "object" || account === null) {
      return [];
    }
    const item = account as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.name !== "string") {
      return [];
    }
    return [{ id: item.id, name: item.name }];
  });
  const selected = accounts.find((account) => account.id === expected.accountId);
  if (selected === undefined) {
    return {
      ok: false,
      reason: `la sesión tiene ${String(accounts.length)} cuentas y no incluye el id autorizado`,
    };
  }
  if (selected.name !== expected.accountName) {
    return { ok: false, reason: "el id autorizado no tiene el nombre de cuenta esperado" };
  }
  const email = typeof record.email === "string" ? record.email : null;
  if (expected.loginEmail !== null && email !== expected.loginEmail) {
    return { ok: false, reason: "el correo de la sesión no es el de la cuenta del curso" };
  }
  return {
    ok: true,
    identity: {
      email,
      accountId: selected.id,
      accountName: selected.name,
      accountCount: accounts.length,
    },
  };
}

export interface VectorizeIndexConfig {
  name: string;
  dimensions: number;
  metric: string;
}

export function parseVectorizeIndex(
  body: unknown,
  expectedName: string,
): { ok: true; index: VectorizeIndexConfig } | { ok: false; reason: string } {
  const record = unwrapResult(body);
  if (record === null) {
    return { ok: false, reason: "vectorize get no devolvió un objeto" };
  }
  const name = typeof record.name === "string" ? record.name : null;
  const config =
    typeof record.config === "object" && record.config !== null
      ? (record.config as Record<string, unknown>)
      : null;
  const dimensions = config === null ? null : config.dimensions;
  const metric = config === null ? null : config.metric;
  if (name === null) {
    return { ok: false, reason: "la respuesta no trae el nombre del índice" };
  }
  if (name !== expectedName) {
    return { ok: false, reason: "el nombre del índice no es el pedido" };
  }
  if (typeof dimensions !== "number" || !Number.isInteger(dimensions)) {
    return { ok: false, reason: "la respuesta no trae la dimensión" };
  }
  if (typeof metric !== "string" || metric.length === 0) {
    return { ok: false, reason: "la respuesta no trae la métrica" };
  }
  return { ok: true, index: { name, dimensions, metric } };
}

export function parseVectorizeInfo(body: unknown): {
  dimensions: number | null;
  vectorCount: number | null;
  processedUpToMutation: string | null;
} {
  const record = unwrapResult(body);
  if (record === null) {
    return { dimensions: null, vectorCount: null, processedUpToMutation: null };
  }
  return {
    dimensions: typeof record.dimensions === "number" ? record.dimensions : null,
    vectorCount: typeof record.vectorCount === "number" ? record.vectorCount : null,
    processedUpToMutation:
      typeof record.processedUpToMutation === "string" ? record.processedUpToMutation : null,
  };
}

export type ParsedNameList = { ok: true; names: string[] } | { ok: false; reason: string };

export function parseVectorizeIndexList(body: unknown): ParsedNameList {
  if (!Array.isArray(body)) {
    return { ok: false, reason: "vectorize list no devolvió un array de índices" };
  }
  const names: string[] = [];
  for (const item of body) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, reason: "vectorize list mezcla elementos que no son índices" };
    }
    const name = (item as { name?: unknown }).name;
    if (typeof name !== "string" || name.length === 0) {
      return { ok: false, reason: "vectorize list trae un índice sin nombre" };
    }
    names.push(name);
  }
  return { ok: true, names };
}

export function parseMetadataIndexNames(body: unknown): ParsedNameList {
  const value = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && "metadataIndexes" in body
      ? (body as { metadataIndexes?: unknown }).metadataIndexes
      : undefined;
  if (!Array.isArray(value)) {
    return { ok: false, reason: "el listado de metadatos no tiene el sobre esperado" };
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return { ok: false, reason: "el listado de metadatos mezcla elementos ilegibles" };
    }
    const propertyName = (item as { propertyName?: unknown }).propertyName;
    if (typeof propertyName !== "string" || propertyName.length === 0) {
      return { ok: false, reason: "un metadato no trae propertyName" };
    }
    names.push(propertyName);
  }
  return { ok: true, names };
}

export function parseUpsertMutationIds(stdout: string): string[] {
  const ids: string[] = [];
  for (const match of stdout.matchAll(/Mutation changeset identifier:\s*([^\s.]+)/g)) {
    const id = match[1];
    if (id !== undefined && id.length > 0) {
      ids.push(id);
    }
  }
  return ids;
}

export function parseEmbeddingMatrix(
  body: unknown,
): { ok: true; dimensions: number; rows: number } | { ok: false; reason: string } {
  if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray(body.data)) {
    return { ok: false, reason: "la respuesta de embeddings no trae una matriz data" };
  }
  if (body.data.length === 0) {
    return { ok: false, reason: "la respuesta de embeddings está vacía" };
  }
  const width = Array.isArray(body.data[0]) ? body.data[0].length : 0;
  if (!Number.isInteger(width) || width < 1 || width > 1536) {
    return { ok: false, reason: "la anchura observada no es utilizable" };
  }
  for (const row of body.data) {
    if (!Array.isArray(row) || row.length !== width) {
      return { ok: false, reason: "las filas de embeddings no tienen la misma anchura" };
    }
    if (row.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      return { ok: false, reason: "el embedding contiene un valor no finito" };
    }
  }
  return { ok: true, dimensions: width, rows: body.data.length };
}

export function absenceReason(result: ProcessRun): "absent" | "unknown" {
  const text = `${result.stdout}\n${result.stderr}`;
  if (
    text.includes("Couldn't find a D1 DB") ||
    text.includes("The specified bucket does not exist.")
  ) {
    return "absent";
  }
  return "unknown";
}

function unwrapResult(body: unknown): Record<string, unknown> | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.result === "object" &&
    record.result !== null &&
    !Array.isArray(record.result)
  ) {
    return record.result as Record<string, unknown>;
  }
  return record;
}
