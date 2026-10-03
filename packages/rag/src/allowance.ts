export const ALLOWANCE_MARGIN = 1.25;
export const VERIFY_GENERATIVE_CALLS = 4;

export const OPERATION_BOUNDS = {
  retrieval: { maxInputTokens: 500, maxOutputTokens: 0, calls: 1 },
  evaluation: { maxInputTokens: 4_000, maxOutputTokens: 1600, calls: 1 },
  reformulation: { maxInputTokens: 1_000, maxOutputTokens: 200, calls: 1 },
  generation: { maxInputTokens: 4_000, maxOutputTokens: 600, calls: 1 },
  embedding: { maxInputTokens: 900, maxOutputTokens: 0, calls: 1 },
} as const;

export type AllowanceKind = keyof typeof OPERATION_BOUNDS;

export interface AllowancePrices {
  embeddingUsdPerMillionInput: number | null;
  generativeUsdPerMillionInput: number | null;
  generativeUsdPerMillionOutput: number | null;
}

export interface AllowanceReservation {
  id: string;
  kind: AllowanceKind;
  calls: number;
  worstCaseUsd: number;
  actualUsd: number | null;
  settled: boolean;
}

export interface AllowanceSnapshot {
  maxSpendUsd: number;
  maxGenerativeCalls: number;
  maxEmbeddingCalls: number;
  margin: number;
  prices: AllowancePrices;
  nextId: number;
  reservations: AllowanceReservation[];
}

const GENERATIVE: ReadonlySet<AllowanceKind> = new Set([
  "evaluation",
  "reformulation",
  "generation",
]);

function finitePrice(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function worstCaseUsd(input: {
  kind: AllowanceKind;
  calls: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  prices: AllowancePrices;
  margin: number;
}): number | null {
  if (
    !Number.isInteger(input.calls) ||
    input.calls < 1 ||
    input.margin < 1 ||
    !Number.isFinite(input.margin) ||
    input.maxInputTokens < 0 ||
    input.maxOutputTokens < 0
  ) {
    return null;
  }
  const embedding = finitePrice(input.prices.embeddingUsdPerMillionInput);
  const inputPrice = finitePrice(input.prices.generativeUsdPerMillionInput);
  const outputPrice = finitePrice(input.prices.generativeUsdPerMillionOutput);
  const tokensIn = (input.maxInputTokens / 1_000_000) * input.calls * input.margin;
  const tokensOut = (input.maxOutputTokens / 1_000_000) * input.calls * input.margin;
  if (input.kind === "embedding" || input.kind === "retrieval") {
    return embedding === null ? null : tokensIn * embedding;
  }
  if (inputPrice === null || outputPrice === null) {
    return null;
  }
  return tokensIn * inputPrice + tokensOut * outputPrice;
}

function committedUsd(reservations: readonly AllowanceReservation[]): number {
  return reservations.reduce((sum, item) => {
    if (item.settled && item.actualUsd !== null) {
      return sum + item.actualUsd;
    }
    return sum + item.worstCaseUsd;
  }, 0);
}

function countCalls(
  reservations: readonly AllowanceReservation[],
  kinds: ReadonlySet<AllowanceKind>,
) {
  return reservations
    .filter((item) => kinds.has(item.kind))
    .reduce((sum, item) => sum + item.calls, 0);
}

export interface AllowanceLedger {
  reserve(input: {
    kind: AllowanceKind;
    calls?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
  }): { ok: true; id: string } | { ok: false; reason: string };
  settle(id: string, actualUsd: number | null): void;
  snapshot(): AllowanceSnapshot;
}

export function createAllowanceLedger(input: {
  maxSpendUsd: number;
  maxGenerativeCalls: number;
  maxEmbeddingCalls: number;
  prices: AllowancePrices;
  margin?: number;
  state?: AllowanceSnapshot;
}): AllowanceLedger {
  const state: AllowanceSnapshot = input.state
    ? {
        ...input.state,
        prices: { ...input.state.prices },
        reservations: input.state.reservations.map((item) => ({ ...item })),
      }
    : {
        maxSpendUsd: input.maxSpendUsd,
        maxGenerativeCalls: input.maxGenerativeCalls,
        maxEmbeddingCalls: input.maxEmbeddingCalls,
        margin: input.margin ?? ALLOWANCE_MARGIN,
        prices: { ...input.prices },
        nextId: 1,
        reservations: [],
      };
  return {
    reserve(request) {
      const bounds = OPERATION_BOUNDS[request.kind];
      const calls = request.calls ?? bounds.calls;
      const quote = worstCaseUsd({
        kind: request.kind,
        calls,
        maxInputTokens: request.maxInputTokens ?? bounds.maxInputTokens,
        maxOutputTokens: request.maxOutputTokens ?? bounds.maxOutputTokens,
        prices: state.prices,
        margin: state.margin,
      });
      if (quote === null) {
        return {
          ok: false,
          reason: "El precio de la operación es desconocido. No se trata como cero y no se llama.",
        };
      }
      const generative = countCalls(state.reservations, GENERATIVE);
      const embedding = countCalls(
        state.reservations,
        new Set<AllowanceKind>(["embedding", "retrieval"]),
      );
      if (GENERATIVE.has(request.kind) && generative + calls > state.maxGenerativeCalls) {
        return {
          ok: false,
          reason: "El tope de llamadas generativas de la sesión no da para esta operación.",
        };
      }
      if (
        (request.kind === "embedding" || request.kind === "retrieval") &&
        embedding + calls > state.maxEmbeddingCalls
      ) {
        return {
          ok: false,
          reason: "El tope de embeddings de la sesión no da para esta operación.",
        };
      }
      if (committedUsd(state.reservations) + quote > state.maxSpendUsd) {
        return {
          ok: false,
          reason: "La reserva peor caso no cabe en el tope de la sesión. No se llama al proveedor.",
        };
      }
      const id = `r${String(state.nextId)}`;
      state.nextId += 1;
      state.reservations.push({
        id,
        kind: request.kind,
        calls,
        worstCaseUsd: quote,
        actualUsd: null,
        settled: false,
      });
      return { ok: true, id };
    },
    settle(id, actualUsd) {
      const found = state.reservations.find((item) => item.id === id);
      if (found === undefined) {
        return;
      }
      found.settled = true;
      if (actualUsd === null || !Number.isFinite(actualUsd) || actualUsd < 0) {
        found.actualUsd = null;
        return;
      }
      found.actualUsd = actualUsd;
    },
    snapshot() {
      return {
        ...state,
        prices: { ...state.prices },
        reservations: state.reservations.map((item) => ({ ...item })),
      };
    },
  };
}

export interface VerificationStep {
  id: string;
  generativeCalls: number;
  embeddingCalls: number;
}

export function verificationPlan(): VerificationStep[] {
  return [
    { id: "sin-rag", generativeCalls: 1, embeddingCalls: 0 },
    { id: "rag", generativeCalls: 1, embeddingCalls: 1 },
    { id: "crag", generativeCalls: 2, embeddingCalls: 1 },
    { id: "clarify", generativeCalls: 0, embeddingCalls: 0 },
    { id: "refuse", generativeCalls: 0, embeddingCalls: 1 },
    { id: "local-error", generativeCalls: 0, embeddingCalls: 0 },
  ];
}

export function planFits(input: {
  maxSpendUsd: number;
  maxGenerativeCalls: number;
  maxEmbeddingCalls: number;
  prices: AllowancePrices;
  state?: AllowanceSnapshot;
  steps?: readonly VerificationStep[];
}): boolean {
  const ledger = createAllowanceLedger({
    maxSpendUsd: input.maxSpendUsd,
    maxGenerativeCalls: input.maxGenerativeCalls,
    maxEmbeddingCalls: input.maxEmbeddingCalls,
    prices: input.prices,
    state: input.state,
  });
  for (const step of input.steps ?? verificationPlan()) {
    for (let index = 0; index < step.embeddingCalls; index += 1) {
      if (!ledger.reserve({ kind: "embedding" }).ok) {
        return false;
      }
    }
    for (let index = 0; index < step.generativeCalls; index += 1) {
      if (!ledger.reserve({ kind: "generation" }).ok) {
        return false;
      }
    }
  }
  return true;
}
