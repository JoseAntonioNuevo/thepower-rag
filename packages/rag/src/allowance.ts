// GUÍA DE LECTURA · packages/rag/src/allowance.ts
// Presupuesto de un turno: antes de cada llamada se reserva el peor caso en USD y en número de
// llamadas; si no cabe, no se llama al proveedor. Un precio desconocido nunca cuenta como cero.
// Margen de seguridad: el peor caso se multiplica por 1,25.
export const ALLOWANCE_MARGIN = 1.25;
// Llamadas generativas del plan de verificación del despliegue.
export const VERIFY_GENERATIVE_CALLS = 4;

// Topes de tokens y llamadas de cada tipo de operación para calcular el peor caso.
export const OPERATION_BOUNDS = {
  // Búsqueda: solo cuesta el embedding de la consulta.
  retrieval: { maxInputTokens: 500, maxOutputTokens: 0, calls: 1 },
  // Evaluación de CRAG: fragmentos de entrada y veredicto de salida.
  evaluation: { maxInputTokens: 4_000, maxOutputTokens: 1600, calls: 1 },
  // Reformulación de la consulta.
  reformulation: { maxInputTokens: 1_000, maxOutputTokens: 800, calls: 1 },
  // Generación de la respuesta final.
  generation: { maxInputTokens: 4_000, maxOutputTokens: 1_600, calls: 1 },
  // Embedding de un texto.
  embedding: { maxInputTokens: 900, maxOutputTokens: 0, calls: 1 },
} as const;

// Tipo con los nombres de operación: retrieval, evaluation, reformulation, generation o embedding.
export type AllowanceKind = keyof typeof OPERATION_BOUNDS;

// Tarifas en USD por millón de tokens; null significa desconocida.
export interface AllowancePrices {
  // Tarifa del modelo de embeddings.
  embeddingUsdPerMillionInput: number | null;
  // Tarifa de entrada del modelo generativo.
  generativeUsdPerMillionInput: number | null;
  // Tarifa de salida del modelo generativo.
  generativeUsdPerMillionOutput: number | null;
}

// Reserva hecha para una operación.
export interface AllowanceReservation {
  // Identificador (r1, r2…).
  id: string;
  // Tipo de operación.
  kind: AllowanceKind;
  // Llamadas reservadas.
  calls: number;
  // Importe peor caso reservado.
  worstCaseUsd: number;
  // Importe real, si se conoce.
  actualUsd: number | null;
  // true cuando la operación terminó y se liquidó.
  settled: boolean;
}

// Estado completo del presupuesto, para guardarlo o restaurarlo.
export interface AllowanceSnapshot {
  // Tope de gasto del turno.
  maxSpendUsd: number;
  // Tope de llamadas generativas.
  maxGenerativeCalls: number;
  // Tope de llamadas de embeddings.
  maxEmbeddingCalls: number;
  // Margen aplicado.
  margin: number;
  // Tarifas.
  prices: AllowancePrices;
  // Siguiente número de reserva.
  nextId: number;
  // Reservas hechas.
  reservations: AllowanceReservation[];
}

// Operaciones que llaman a un modelo generativo.
const GENERATIVE: ReadonlySet<AllowanceKind> = new Set([
  "evaluation",
  "reformulation",
  "generation",
]);

// Devuelve la tarifa si es un número válido y no negativo; si no, null.
function finitePrice(value: number | null): number | null {
  // null, infinito o negativo no son tarifas válidas.
  if (value === null || !Number.isFinite(value) || value < 0) {
    // Tarifa desconocida.
    return null;
  }
  // Tarifa válida.
  return value;
}

// Importe peor caso de una operación con sus topes y el margen; null si falta alguna tarifa.
export function worstCaseUsd(input: {
  // Tipo de operación.
  kind: AllowanceKind;
  // Número de llamadas.
  calls: number;
  // Tokens de entrada máximos por llamada.
  maxInputTokens: number;
  // Tokens de salida máximos por llamada.
  maxOutputTokens: number;
  // Tarifas.
  prices: AllowancePrices;
  // Margen.
  margin: number;
}): number | null {
  // Datos imposibles: llamadas no enteras, margen menor que 1 o tokens negativos.
  if (
    !Number.isInteger(input.calls) ||
    input.calls < 1 ||
    input.margin < 1 ||
    !Number.isFinite(input.margin) ||
    input.maxInputTokens < 0 ||
    input.maxOutputTokens < 0
  ) {
    // No se puede calcular.
    return null;
  }
  // Tarifa de embeddings validada.
  const embedding = finitePrice(input.prices.embeddingUsdPerMillionInput);
  // Tarifa de entrada validada.
  const inputPrice = finitePrice(input.prices.generativeUsdPerMillionInput);
  // Tarifa de salida validada.
  const outputPrice = finitePrice(input.prices.generativeUsdPerMillionOutput);
  // Millones de tokens de entrada en el peor caso, con margen.
  const tokensIn = (input.maxInputTokens / 1_000_000) * input.calls * input.margin;
  // Millones de tokens de salida en el peor caso, con margen.
  const tokensOut = (input.maxOutputTokens / 1_000_000) * input.calls * input.margin;
  // Embeddings y búsquedas solo pagan la entrada del embedding.
  if (input.kind === "embedding" || input.kind === "retrieval") {
    // Sin tarifa, null; con tarifa, tokens por precio.
    return embedding === null ? null : tokensIn * embedding;
  }
  // Sin tarifas del modelo generativo no se puede presupuestar.
  if (inputPrice === null || outputPrice === null) {
    // Desconocido: la operación no se hará.
    return null;
  }
  // Entrada más salida.
  return tokensIn * inputPrice + tokensOut * outputPrice;
}

// Gasto comprometido: el real de lo liquidado y el peor caso de lo pendiente.
function committedUsd(reservations: readonly AllowanceReservation[]): number {
  // Suma reserva a reserva.
  return reservations.reduce((sum, item) => {
    // Liquidada con importe conocido: cuenta el importe real.
    if (item.settled && item.actualUsd !== null) {
      // Suma el real.
      return sum + item.actualUsd;
    }
    // Pendiente o desconocida: cuenta el peor caso.
    return sum + item.worstCaseUsd;
  }, 0);
}

// Llamadas reservadas de unos tipos concretos.
function countCalls(
  reservations: readonly AllowanceReservation[],
  kinds: ReadonlySet<AllowanceKind>,
) {
  // Filtra por tipo y suma las llamadas.
  return reservations
    .filter((item) => kinds.has(item.kind))
    .reduce((sum, item) => sum + item.calls, 0);
}

// Libro de cuentas de un turno.
export interface AllowanceLedger {
  // Reserva una operación; devuelve su id o el motivo del rechazo.
  reserve(input: {
    // Tipo de operación.
    kind: AllowanceKind;
    // Llamadas (por defecto, las del tope de ese tipo).
    calls?: number;
    // Tokens de entrada (por defecto, el tope).
    maxInputTokens?: number;
    // Tokens de salida (por defecto, el tope).
    maxOutputTokens?: number;
  }): { ok: true; id: string } | { ok: false; reason: string };
  // Liquida una reserva con su importe real, o null si se desconoce.
  settle(id: string, actualUsd: number | null): void;
  // Copia del estado actual.
  snapshot(): AllowanceSnapshot;
}

// Crea un libro de cuentas nuevo o restaura uno guardado.
export function createAllowanceLedger(input: {
  // Tope de gasto.
  maxSpendUsd: number;
  // Tope de llamadas generativas.
  maxGenerativeCalls: number;
  // Tope de llamadas de embeddings.
  maxEmbeddingCalls: number;
  // Tarifas.
  prices: AllowancePrices;
  // Margen (por defecto 1,25).
  margin?: number;
  // Estado anterior que se quiere continuar.
  state?: AllowanceSnapshot;
}): AllowanceLedger {
  // Copia el estado guardado o empieza uno nuevo; las copias evitan modificar el objeto original.
  const state: AllowanceSnapshot = input.state
    ? // Estado guardado: se copian precios y reservas para no tocar el original.
      {
        ...input.state,
        prices: { ...input.state.prices },
        reservations: input.state.reservations.map((item) => ({ ...item })),
      }
    : // Estado nuevo: topes, margen de seguridad, precios y contador de reservas.
      {
        maxSpendUsd: input.maxSpendUsd,
        maxGenerativeCalls: input.maxGenerativeCalls,
        maxEmbeddingCalls: input.maxEmbeddingCalls,
        margin: input.margin ?? ALLOWANCE_MARGIN,
        prices: { ...input.prices },
        nextId: 1,
        reservations: [],
      };
  // Objeto con los tres métodos del libro de cuentas.
  return {
    // Intenta reservar una operación.
    reserve(request) {
      // Topes por defecto del tipo de operación.
      const bounds = OPERATION_BOUNDS[request.kind];
      // Llamadas pedidas o las del tope.
      const calls = request.calls ?? bounds.calls;
      // Importe peor caso de esta reserva.
      const quote = worstCaseUsd({
        kind: request.kind,
        calls,
        maxInputTokens: request.maxInputTokens ?? bounds.maxInputTokens,
        maxOutputTokens: request.maxOutputTokens ?? bounds.maxOutputTokens,
        prices: state.prices,
        margin: state.margin,
      });
      // Sin precio no se reserva ni se llama.
      if (quote === null) {
        // Rechazo con el motivo.
        return {
          ok: false,
          reason: "El precio de la operación es desconocido. No se trata como cero y no se llama.",
        };
      }
      // Llamadas generativas ya reservadas.
      const generative = countCalls(state.reservations, GENERATIVE);
      // Llamadas de embeddings ya reservadas.
      const embedding = countCalls(
        state.reservations,
        new Set<AllowanceKind>(["embedding", "retrieval"]),
      );
      // No caben más llamadas generativas.
      if (GENERATIVE.has(request.kind) && generative + calls > state.maxGenerativeCalls) {
        // Rechazo.
        return {
          ok: false,
          reason: "El tope de llamadas generativas de la sesión no da para esta operación.",
        };
      }
      // No caben más embeddings.
      if (
        (request.kind === "embedding" || request.kind === "retrieval") &&
        embedding + calls > state.maxEmbeddingCalls
      ) {
        // Rechazo.
        return {
          ok: false,
          reason: "El tope de embeddings de la sesión no da para esta operación.",
        };
      }
      // El peor caso no cabe en el tope de gasto.
      if (committedUsd(state.reservations) + quote > state.maxSpendUsd) {
        // Rechazo: no se llama al proveedor.
        return {
          ok: false,
          reason: "La reserva peor caso no cabe en el tope de la sesión. No se llama al proveedor.",
        };
      }
      // Id de la nueva reserva.
      const id = `r${String(state.nextId)}`;
      // Avanza el contador.
      state.nextId += 1;
      // Guarda la reserva pendiente.
      state.reservations.push({
        id,
        kind: request.kind,
        calls,
        worstCaseUsd: quote,
        actualUsd: null,
        settled: false,
      });
      // Reserva aceptada.
      return { ok: true, id };
    },
    // Liquida una reserva cuando la operación termina.
    settle(id, actualUsd) {
      // Busca la reserva por su id.
      const found = state.reservations.find((item) => item.id === id);
      // Id desconocido: no hace nada.
      if (found === undefined) {
        // Sale sin cambios.
        return;
      }
      // Marca la reserva como liquidada.
      found.settled = true;
      // Importe desconocido o inválido: se guarda como null y sigue contando el peor caso.
      if (actualUsd === null || !Number.isFinite(actualUsd) || actualUsd < 0) {
        // Importe desconocido.
        found.actualUsd = null;
        // Termina.
        return;
      }
      // Guarda el importe real.
      found.actualUsd = actualUsd;
    },
    // Devuelve una copia del estado.
    snapshot() {
      // Copias para que quien la lea no pueda modificar el libro.
      return {
        ...state,
        prices: { ...state.prices },
        reservations: state.reservations.map((item) => ({ ...item })),
      };
    },
  };
}

// Paso del plan de verificación del despliegue.
export interface VerificationStep {
  // Nombre del paso.
  id: string;
  // Llamadas generativas que necesita.
  generativeCalls: number;
  // Embeddings que necesita.
  embeddingCalls: number;
}

// Pasos de la verificación: sin RAG, RAG, CRAG, aclaración, rechazo y error local.
export function verificationPlan(): VerificationStep[] {
  // Lista fija de pasos con sus llamadas.
  return [
    { id: "sin-rag", generativeCalls: 1, embeddingCalls: 0 },
    { id: "rag", generativeCalls: 1, embeddingCalls: 1 },
    { id: "crag", generativeCalls: 2, embeddingCalls: 1 },
    { id: "clarify", generativeCalls: 0, embeddingCalls: 0 },
    { id: "refuse", generativeCalls: 0, embeddingCalls: 1 },
    { id: "local-error", generativeCalls: 0, embeddingCalls: 0 },
  ];
}

// ¿Cabe el plan de verificación completo en el presupuesto?
export function planFits(input: {
  // Tope de gasto.
  maxSpendUsd: number;
  // Tope de llamadas generativas.
  maxGenerativeCalls: number;
  // Tope de embeddings.
  maxEmbeddingCalls: number;
  // Tarifas.
  prices: AllowancePrices;
  // Estado previo, si existe.
  state?: AllowanceSnapshot;
  // Pasos (por defecto, el plan completo).
  steps?: readonly VerificationStep[];
}): boolean {
  // Libro de cuentas de prueba con esos topes.
  const ledger = createAllowanceLedger({
    maxSpendUsd: input.maxSpendUsd,
    maxGenerativeCalls: input.maxGenerativeCalls,
    maxEmbeddingCalls: input.maxEmbeddingCalls,
    prices: input.prices,
    state: input.state,
  });
  // Recorre los pasos.
  for (const step of input.steps ?? verificationPlan()) {
    // Reserva cada embedding del paso.
    for (let index = 0; index < step.embeddingCalls; index += 1) {
      // Si alguno no cabe, el plan no cabe.
      if (!ledger.reserve({ kind: "embedding" }).ok) {
        // No cabe.
        return false;
      }
    }
    // Reserva cada llamada generativa.
    for (let index = 0; index < step.generativeCalls; index += 1) {
      // Si alguna no cabe, el plan no cabe.
      if (!ledger.reserve({ kind: "generation" }).ok) {
        // No cabe.
        return false;
      }
    }
  }
  // Todas las reservas caben.
  return true;
}
