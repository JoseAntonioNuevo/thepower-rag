export const CRAG_LIMITS = {
  maxRetrievals: 3,
  maxReformulations: 2,
} as const;

export type Plan = { allowed: true; nextCount: number } | { allowed: false; reason: string };

function planStep(count: number, maximum: number, label: string): Plan {
  if (!Number.isInteger(count) || count < 0) {
    return { allowed: false, reason: `El contador de ${label} no es válido.` };
  }
  if (count >= maximum) {
    return {
      allowed: false,
      reason: `CRAG admite como máximo ${String(maximum)} ${label}.`,
    };
  }
  return { allowed: true, nextCount: count + 1 };
}

export function planRetrieval(retrievalCount: number): Plan {
  return planStep(retrievalCount, CRAG_LIMITS.maxRetrievals, "recuperaciones");
}

export function planReformulation(reformulationCount: number): Plan {
  return planStep(reformulationCount, CRAG_LIMITS.maxReformulations, "reformulaciones");
}
