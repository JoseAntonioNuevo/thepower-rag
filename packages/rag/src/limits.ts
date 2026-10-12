// GUÍA DE LECTURA · packages/rag/src/limits.ts
// Topes de CRAG y la función que decide si se puede hacer otra búsqueda o reformulación.
// Como máximo tres búsquedas y dos reformulaciones por turno.
export const CRAG_LIMITS = {
  // Búsquedas en el índice por turno.
  maxRetrievals: 3,
  // Reformulaciones de la consulta por turno.
  maxReformulations: 2,
} as const;

// Resultado de planificar un paso: permitido con el nuevo contador, o denegado con el motivo.
export type Plan = { allowed: true; nextCount: number } | { allowed: false; reason: string };

// Comprueba un contador contra su máximo.
function planStep(count: number, maximum: number, label: string): Plan {
  // Un contador negativo o con decimales indica un error del grafo.
  if (!Number.isInteger(count) || count < 0) {
    // Se deniega con el motivo.
    return { allowed: false, reason: `El contador de ${label} no es válido.` };
  }
  // Ya se hicieron todas las permitidas.
  if (count >= maximum) {
    // Se deniega indicando el máximo.
    return {
      allowed: false,
      reason: `CRAG admite como máximo ${String(maximum)} ${label}.`,
    };
  }
  // Permitido: el contador avanza en uno.
  return { allowed: true, nextCount: count + 1 };
}

// ¿Se puede hacer otra búsqueda?
export function planRetrieval(retrievalCount: number): Plan {
  // Aplica el tope de búsquedas.
  return planStep(retrievalCount, CRAG_LIMITS.maxRetrievals, "recuperaciones");
}

// ¿Se puede hacer otra reformulación?
export function planReformulation(reformulationCount: number): Plan {
  // Aplica el tope de reformulaciones.
  return planStep(reformulationCount, CRAG_LIMITS.maxReformulations, "reformulaciones");
}
