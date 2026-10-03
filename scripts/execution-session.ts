import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  createAllowanceLedger,
  type AllowanceLedger,
  type AllowancePrices,
  type AllowanceSnapshot,
  type RuntimeProvenance,
} from "@thepower-rag/core";

interface SessionFile {
  accountId: string;
  profileId: string | null;
  provenance: RuntimeProvenance;
  pricesSynthetic: boolean;
  allowance: AllowanceSnapshot;
}

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export async function openExecutionSession(input: {
  file: string;
  accountId: string;
  profileId: string | null;
  provenance: RuntimeProvenance;
  pricesSynthetic: boolean;
  maxSpendUsd: number;
  maxGenerativeCalls: number;
  maxEmbeddingCalls: number;
  prices: AllowancePrices;
}): Promise<AllowanceLedger> {
  await mkdir(path.dirname(input.file), { recursive: true });
  let existing: SessionFile | null = null;
  try {
    const parsed = record(JSON.parse(await readFile(input.file, "utf8")));
    if (parsed !== null && record(parsed.allowance) !== null) {
      existing = parsed as unknown as SessionFile;
    }
  } catch {
    existing = null;
  }
  if (existing !== null) {
    if (existing.accountId !== input.accountId || existing.provenance !== input.provenance) {
      throw new Error("La sesión guardada no coincide. No se reinicia el presupuesto.");
    }
    if (
      existing.profileId !== null &&
      input.profileId !== null &&
      existing.profileId !== input.profileId
    ) {
      throw new Error("La sesión guardada es de otro perfil. No se reinicia el presupuesto.");
    }
  }
  return createAllowanceLedger({
    maxSpendUsd: input.maxSpendUsd,
    maxGenerativeCalls: input.maxGenerativeCalls,
    maxEmbeddingCalls: input.maxEmbeddingCalls,
    prices: input.prices,
    state: existing ? { ...existing.allowance, prices: input.prices } : undefined,
  });
}

export async function saveExecutionSession(input: {
  file: string;
  accountId: string;
  profileId: string | null;
  provenance: RuntimeProvenance;
  pricesSynthetic: boolean;
  ledger: AllowanceLedger;
}): Promise<void> {
  const body: SessionFile = {
    accountId: input.accountId,
    profileId: input.profileId,
    provenance: input.provenance,
    pricesSynthetic: input.pricesSynthetic,
    allowance: input.ledger.snapshot(),
  };
  const temporary = `${input.file}.${String(process.pid)}.tmp`;
  await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`);
  await rename(temporary, input.file);
}
