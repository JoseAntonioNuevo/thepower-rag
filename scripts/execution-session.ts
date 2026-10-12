// GUÍA DE LECTURA · scripts/execution-session.ts
// Sesión de gasto persistente de los scripts: guarda en disco la reserva y lo gastado para que repetir un
// comando no reinicie el presupuesto. Se escribe de forma atómica (archivo temporal y rename).
// Lectura y escritura de archivos.
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
// Rutas.
import path from "node:path";
// Sesión de gasto del núcleo y sus tipos.
import {
  createAllowanceLedger,
  type AllowanceLedger,
  type AllowancePrices,
  type AllowanceSnapshot,
  type RuntimeProvenance,
} from "@thepower-rag/core";

// Contenido del archivo de sesión.
interface SessionFile {
  // Cuenta.
  accountId: string;
  // Perfil del índice.
  profileId: string | null;
  // Procedencia (local o remota).
  provenance: RuntimeProvenance;
  // Si las tarifas son sintéticas.
  pricesSynthetic: boolean;
  // Estado de la sesión de gasto.
  allowance: AllowanceSnapshot;
}

// Objeto plano o null.
function record(value: unknown): Record<string, unknown> | null {
  // No es un objeto.
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    // null.
    return null;
  }
  // Objeto.
  return value as Record<string, unknown>;
}

// Abre la sesión: continúa la guardada o crea una nueva.
export async function openExecutionSession(input: {
  // Archivo.
  file: string;
  // Cuenta.
  accountId: string;
  // Perfil.
  profileId: string | null;
  // Procedencia.
  provenance: RuntimeProvenance;
  // Tarifas sintéticas.
  pricesSynthetic: boolean;
  // Tope de gasto.
  maxSpendUsd: number;
  // Llamadas generativas máximas.
  maxGenerativeCalls: number;
  // Llamadas de embeddings máximas.
  maxEmbeddingCalls: number;
  // Tarifas.
  prices: AllowancePrices;
}): Promise<AllowanceLedger> {
  // Crea la carpeta.
  await mkdir(path.dirname(input.file), { recursive: true });
  // Sesión guardada.
  let existing: SessionFile | null = null;
  // Archivo ausente o roto: sesión nueva.
  try {
    // Lee el JSON.
    const parsed = record(JSON.parse(await readFile(input.file, "utf8")));
    // Si tiene estado de gasto.
    if (parsed !== null && record(parsed.allowance) !== null) {
      // Se usa.
      existing = parsed as unknown as SessionFile;
    }
  } catch {
    // Sin sesión.
    existing = null;
  }
  // Con sesión guardada.
  if (existing !== null) {
    // Otra cuenta o procedencia: error.
    if (existing.accountId !== input.accountId || existing.provenance !== input.provenance) {
      // No se reinicia el presupuesto.
      throw new Error("La sesión guardada no coincide. No se reinicia el presupuesto.");
    }
    // Otro perfil.
    if (
      existing.profileId !== null &&
      input.profileId !== null &&
      existing.profileId !== input.profileId
    ) {
      // Error.
      throw new Error("La sesión guardada es de otro perfil. No se reinicia el presupuesto.");
    }
  }
  // Sesión de gasto con el estado previo o nueva.
  return createAllowanceLedger({
    maxSpendUsd: input.maxSpendUsd,
    maxGenerativeCalls: input.maxGenerativeCalls,
    maxEmbeddingCalls: input.maxEmbeddingCalls,
    prices: input.prices,
    state: existing ? { ...existing.allowance, prices: input.prices } : undefined,
  });
}

// Guarda la sesión de gasto.
export async function saveExecutionSession(input: {
  // Archivo.
  file: string;
  // Cuenta.
  accountId: string;
  // Perfil.
  profileId: string | null;
  // Procedencia.
  provenance: RuntimeProvenance;
  // Tarifas sintéticas.
  pricesSynthetic: boolean;
  // Sesión.
  ledger: AllowanceLedger;
}): Promise<void> {
  // Contenido.
  const body: SessionFile = {
    accountId: input.accountId,
    profileId: input.profileId,
    provenance: input.provenance,
    pricesSynthetic: input.pricesSynthetic,
    allowance: input.ledger.snapshot(),
  };
  // Archivo temporal.
  const temporary = `${input.file}.${String(process.pid)}.tmp`;
  // Escribe.
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`);
  // Renombra: la escritura es atómica.
  await rename(temporary, input.file);
}
