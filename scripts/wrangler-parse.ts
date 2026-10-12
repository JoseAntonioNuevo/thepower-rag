// GUÍA DE LECTURA · scripts/wrangler-parse.ts
// Lectores defensivos de las salidas de wrangler: JSON con texto alrededor, cuenta de whoami, índices de
// Vectorize, metadatos, mutaciones y embeddings. Si algo no tiene la forma esperada, se devuelve un error.
// Resultado de ejecutar un comando.
export interface ProcessRun {
  // Código de salida (null si lo mató una señal).
  code: number | null;
  // Salida estándar.
  stdout: string;
  // Errores.
  stderr: string;
}

// Cuenta comprobada.
export interface AccountIdentity {
  // Correo de la sesión.
  email: string | null;
  // Id de la cuenta.
  accountId: string;
  // Nombre.
  accountName: string;
  // Cuentas visibles en la sesión.
  accountCount: number;
}

// Oculta tokens y claves en un texto antes de mostrarlo.
export function sanitizeCommandText(text: string): string {
  // Bearer, api_token/api_key/authorization y claves sk-.
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [omitido]")
    .replace(/(api[_-]?token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, "$1=[omitido]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[omitido]");
}

// JSON de una salida que puede traer texto antes o después.
export function parseJsonText(text: string): unknown {
  // Sin espacios.
  const trimmed = text.trim();
  // Vacía.
  if (trimmed.length === 0) {
    // null.
    return null;
  }
  // Intento directo.
  try {
    // JSON completo.
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Primer {.
    const objectAt = trimmed.indexOf("{");
    // Primer [.
    const arrayAt = trimmed.indexOf("[");
    // Inicio del JSON.
    const start =
      objectAt === -1 ? arrayAt : arrayAt === -1 ? objectAt : Math.min(objectAt, arrayAt);
    // Sin JSON.
    if (start < 0) {
      // null.
      return null;
    }
    // Último } o ].
    const end = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    // Sin cierre.
    if (end <= start) {
      // null.
      return null;
    }
    // Intento con el trozo.
    try {
      // JSON.
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      // null.
      return null;
    }
  }
}

// Comprueba que la sesión de wrangler es la cuenta autorizada del curso.
export function parseWhoami(
  body: unknown,
  expected: { accountId: string; accountName: string; loginEmail: string | null },
): { ok: true; identity: AccountIdentity } | { ok: false; reason: string } {
  // No es objeto.
  if (typeof body !== "object" || body === null) {
    // Error.
    return { ok: false, reason: "whoami no devolvió un objeto JSON" };
  }
  // Registro.
  const record = body as Record<string, unknown>;
  // Sin sesión.
  if (record.loggedIn !== true) {
    // Error.
    return { ok: false, reason: "Wrangler no tiene una sesión iniciada" };
  }
  // Sin cuentas.
  if (!Array.isArray(record.accounts)) {
    // Error.
    return { ok: false, reason: "whoami no trajo la lista de cuentas" };
  }
  // Cuentas con id y nombre.
  const accounts = record.accounts.flatMap((account) => {
    // No es objeto.
    if (typeof account !== "object" || account === null) {
      // Se descarta.
      return [];
    }
    // Cuenta.
    const item = account as Record<string, unknown>;
    // Sin id o nombre.
    if (typeof item.id !== "string" || typeof item.name !== "string") {
      // Se descarta.
      return [];
    }
    // Id y nombre.
    return [{ id: item.id, name: item.name }];
  });
  // Cuenta autorizada.
  const selected = accounts.find((account) => account.id === expected.accountId);
  // No está.
  if (selected === undefined) {
    // Error.
    return {
      ok: false,
      reason: `la sesión tiene ${String(accounts.length)} cuentas y no incluye el id autorizado`,
    };
  }
  // Otro nombre.
  if (selected.name !== expected.accountName) {
    // Error.
    return { ok: false, reason: "el id autorizado no tiene el nombre de cuenta esperado" };
  }
  // Correo.
  const email = typeof record.email === "string" ? record.email : null;
  // Otro correo.
  if (expected.loginEmail !== null && email !== expected.loginEmail) {
    // Error.
    return { ok: false, reason: "el correo de la sesión no es el de la cuenta del curso" };
  }
  // Identidad.
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

// Configuración de un índice Vectorize.
export interface VectorizeIndexConfig {
  // Nombre.
  name: string;
  // Dimensiones.
  dimensions: number;
  // Métrica.
  metric: string;
}

// Lee vectorize get sin suponer valores ausentes.
export function parseVectorizeIndex(
  body: unknown,
  expectedName: string,
): { ok: true; index: VectorizeIndexConfig } | { ok: false; reason: string } {
  // Objeto (con o sin sobre result).
  const record = unwrapResult(body);
  // No es objeto.
  if (record === null) {
    // Error.
    return { ok: false, reason: "vectorize get no devolvió un objeto" };
  }
  // Nombre.
  const name = typeof record.name === "string" ? record.name : null;
  // Configuración.
  const config =
    typeof record.config === "object" && record.config !== null
      ? (record.config as Record<string, unknown>)
      : null;
  // Dimensiones.
  const dimensions = config === null ? null : config.dimensions;
  // Métrica.
  const metric = config === null ? null : config.metric;
  // Sin nombre.
  if (name === null) {
    // Error.
    return { ok: false, reason: "la respuesta no trae el nombre del índice" };
  }
  // Otro índice.
  if (name !== expectedName) {
    // Error.
    return { ok: false, reason: "el nombre del índice no es el pedido" };
  }
  // Sin dimensiones.
  if (typeof dimensions !== "number" || !Number.isInteger(dimensions)) {
    // Error.
    return { ok: false, reason: "la respuesta no trae la dimensión" };
  }
  // Sin métrica: no se supone cosine.
  if (typeof metric !== "string" || metric.length === 0) {
    // Error.
    return { ok: false, reason: "la respuesta no trae la métrica" };
  }
  // Índice.
  return { ok: true, index: { name, dimensions, metric } };
}

// Lee vectorize info.
export function parseVectorizeInfo(body: unknown): {
  // Dimensiones.
  dimensions: number | null;
  // Vectores.
  vectorCount: number | null;
  // Última mutación procesada.
  processedUpToMutation: string | null;
} {
  // Objeto.
  const record = unwrapResult(body);
  // No es objeto.
  if (record === null) {
    // Todo null.
    return { dimensions: null, vectorCount: null, processedUpToMutation: null };
  }
  // Valores numéricos o null.
  return {
    dimensions: typeof record.dimensions === "number" ? record.dimensions : null,
    vectorCount: typeof record.vectorCount === "number" ? record.vectorCount : null,
    processedUpToMutation:
      typeof record.processedUpToMutation === "string" ? record.processedUpToMutation : null,
  };
}

// Lista de nombres o error.
export type ParsedNameList = { ok: true; names: string[] } | { ok: false; reason: string };

// Lee vectorize list.
export function parseVectorizeIndexList(body: unknown): ParsedNameList {
  // No es lista.
  if (!Array.isArray(body)) {
    // Error.
    return { ok: false, reason: "vectorize list no devolvió un array de índices" };
  }
  // Nombres.
  const names: string[] = [];
  // Cada índice.
  for (const item of body) {
    // No es objeto.
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      // Error.
      return { ok: false, reason: "vectorize list mezcla elementos que no son índices" };
    }
    // Nombre.
    const name = (item as { name?: unknown }).name;
    // Sin nombre.
    if (typeof name !== "string" || name.length === 0) {
      // Error.
      return { ok: false, reason: "vectorize list trae un índice sin nombre" };
    }
    // Lo añade.
    names.push(name);
  }
  // Nombres.
  return { ok: true, names };
}

// Lee vectorize list-metadata-index (lista o sobre metadataIndexes).
export function parseMetadataIndexNames(body: unknown): ParsedNameList {
  // Lista.
  const value = Array.isArray(body)
    ? body
    : typeof body === "object" && body !== null && "metadataIndexes" in body
      ? (body as { metadataIndexes?: unknown }).metadataIndexes
      : undefined;
  // No es lista.
  if (!Array.isArray(value)) {
    // Error.
    return { ok: false, reason: "el listado de metadatos no tiene el sobre esperado" };
  }
  // Nombres.
  const names: string[] = [];
  // Cada metadato.
  for (const item of value) {
    // No es objeto.
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      // Error.
      return { ok: false, reason: "el listado de metadatos mezcla elementos ilegibles" };
    }
    // Propiedad.
    const propertyName = (item as { propertyName?: unknown }).propertyName;
    // Sin propiedad.
    if (typeof propertyName !== "string" || propertyName.length === 0) {
      // Error.
      return { ok: false, reason: "un metadato no trae propertyName" };
    }
    // Lo añade.
    names.push(propertyName);
  }
  // Nombres.
  return { ok: true, names };
}

// Ids de mutación del texto de vectorize upsert.
export function parseUpsertMutationIds(stdout: string): string[] {
  // Ids.
  const ids: string[] = [];
  // Cada coincidencia.
  for (const match of stdout.matchAll(/Mutation changeset identifier:\s*([^\s.]+)/g)) {
    // Id.
    const id = match[1];
    // Si existe.
    if (id !== undefined && id.length > 0) {
      // Lo añade.
      ids.push(id);
    }
  }
  // Ids en orden.
  return ids;
}

// Comprueba una matriz de embeddings y mide su anchura.
export function parseEmbeddingMatrix(
  body: unknown,
): { ok: true; dimensions: number; rows: number } | { ok: false; reason: string } {
  // Sin data.
  if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray(body.data)) {
    // Error.
    return { ok: false, reason: "la respuesta de embeddings no trae una matriz data" };
  }
  // Vacía.
  if (body.data.length === 0) {
    // Error.
    return { ok: false, reason: "la respuesta de embeddings está vacía" };
  }
  // Anchura de la primera fila.
  const width = Array.isArray(body.data[0]) ? body.data[0].length : 0;
  // Anchura inválida.
  if (!Number.isInteger(width) || width < 1 || width > 1536) {
    // Error.
    return { ok: false, reason: "la anchura observada no es utilizable" };
  }
  // Cada fila.
  for (const row of body.data) {
    // Otra anchura.
    if (!Array.isArray(row) || row.length !== width) {
      // Error.
      return { ok: false, reason: "las filas de embeddings no tienen la misma anchura" };
    }
    // Valor no finito.
    if (row.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      // Error.
      return { ok: false, reason: "el embedding contiene un valor no finito" };
    }
  }
  // Dimensiones y filas.
  return { ok: true, dimensions: width, rows: body.data.length };
}

// ¿El recurso no existe o el fallo es otro?
export function absenceReason(result: ProcessRun): "absent" | "unknown" {
  // Salida completa.
  const text = `${result.stdout}\n${result.stderr}`;
  // Mensajes de recurso ausente.
  if (
    text.includes("Couldn't find a D1 DB") ||
    text.includes("The specified bucket does not exist.")
  ) {
    // Ausente.
    return "absent";
  }
  // Desconocido.
  return "unknown";
}

// Objeto dentro de result o el propio cuerpo.
function unwrapResult(body: unknown): Record<string, unknown> | null {
  // No es objeto.
  if (typeof body !== "object" || body === null) {
    // null.
    return null;
  }
  // Registro.
  const record = body as Record<string, unknown>;
  // Sobre result.
  if (
    typeof record.result === "object" &&
    record.result !== null &&
    !Array.isArray(record.result)
  ) {
    // Contenido.
    return record.result as Record<string, unknown>;
  }
  // Cuerpo.
  return record;
}
