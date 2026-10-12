// GUÍA DE LECTURA · apps/api/src/research-journal.ts
// Diario de operaciones de la investigación duradera. Antes de cada llamada de pago se reserva su coste
// y se marca como enviada; al volver se guarda el resultado. Si el paso se repite, se reutiliza lo guardado
// y nunca se reenvía una llamada cuyo resultado se desconoce.
// Tipo del escenario de prueba.
import type { ResearchScenarioId } from "@thepower-rag/contracts";
// Tipos de consumo, resultado de puerto y puertos de la investigación.
import type { Consumption, PortResult, ResearchPorts } from "@thepower-rag/research";
// Tipo de la base de datos de la investigación.
import type { ResearchDatabase } from "./research-db";
// Funciones del almacén que cambian el estado de cada operación.
import {
  beginOperation,
  completeOperation,
  holdDispatched,
  markDispatched,
  releaseReservedOperations,
  type JobRow,
} from "./research-store";
// Reserva de dinero por tipo de llamada y tarifas congeladas del trabajo.
import { reservationFor, type PriceSnapshot } from "./research-money";
// Errores que detienen el paso: requiere atención o simula una caída.
import { ResearchAttention, ResearchStepCrash } from "./research-state";

// Huella SHA-256 de una llamada: tipo más datos de entrada en JSON.
async function fingerprint(kind: string, payload: unknown): Promise<string> {
  // Calcula el resumen SHA-256 de "tipo:JSON".
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${kind}:${JSON.stringify(payload)}`),
  );
  // Convierte los bytes a hexadecimal.
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Envuelve los puertos del grafo con el diario. Una operación completada se
 * reutiliza. Una operación enviada sin resultado no se reenvía.
 */
export function journalPorts(
  database: ResearchDatabase,
  job: JobRow,
  prices: PriceSnapshot,
  inner: ResearchPorts,
  scenario: ResearchScenarioId | null,
): ResearchPorts {
  // Envuelve una llamada: reservar, marcar enviada, invocar y guardar el resultado.
  const call = async <T>(
    kind: string,
    payload: unknown,
    invoke: () => Promise<PortResult<T>>,
    detail?: { durationMs?: number; speechChars?: number },
  ): Promise<PortResult<T>> => {
    // Huella que identifica esta llamada concreta.
    const digest = await fingerprint(kind, payload);
    // Dinero que se reserva antes de llamar.
    const reservation = reservationFor(kind, prices, detail);
    // Sin tarifa para este tipo, no se llama.
    if (reservation === null) {
      // El trabajo pide atención.
      throw new ResearchAttention(`${kind}:sin-tarifa`);
    }
    // Registra o recupera la operación con su reserva y la ficha del arrendamiento.
    const operation = await beginOperation(database, {
      jobId: job.id,
      kind,
      fingerprint: digest,
      reservation,
      fence: job.lease_token,
    });
    // Ya completada: devuelve el resultado guardado sin volver a llamar.
    if (operation.state === "completed" && operation.result_json) {
      // Resultado del diario.
      return JSON.parse(operation.result_json) as PortResult<T>;
    }
    // Liberada: no se reintenta.
    if (operation.state === "released") {
      // Atención.
      throw new ResearchAttention(operation.id);
    }
    // Cancelada por el usuario o por la señal: no se llama.
    if (job.cancel_requested === 1 || inner.signal.aborted) {
      // Atención.
      throw new ResearchAttention(operation.id);
    }
    // Fuera de plazo: no se llama.
    if (Date.now() > job.deadline_at) {
      // Atención.
      throw new ResearchAttention(operation.id);
    }
    // Marca la operación como enviada; falla si otro proceso tiene el arrendamiento.
    const dispatched = await markDispatched(database, operation.id, operation.fence);
    // Si no se pudo marcar, no se llama.
    if (!dispatched) {
      // Atención.
      throw new ResearchAttention(operation.id);
    }
    // Escenario de prueba: llama y simula una caída antes de guardar el resultado.
    if (scenario === "ambiguous-operation" && kind === "plan") {
      // Llamada real al puerto interno.
      await invoke();
      // Caída simulada del paso.
      throw new ResearchStepCrash();
    }
    // Llamada real al puerto interno.
    const result = await invoke();
    // Cancelada durante la llamada: el cargo queda retenido como desconocido.
    if (inner.signal.aborted || (!result.ok && result.error === "aborted")) {
      // Retiene la operación enviada.
      await holdDispatched(database, operation.id, operation.fence);
      // Atención.
      throw new ResearchAttention(operation.id);
    }
    // Guarda el resultado y el consumo; libera la parte no usada de la reserva.
    const stored = await completeOperation(database, {
      operationId: operation.id,
      fence: operation.fence,
      resultJson: JSON.stringify(result),
      consumption: result.consumption,
      reservation,
    });
    // Si no se pudo guardar, atención.
    if (!stored) {
      // Atención.
      throw new ResearchAttention(operation.id);
    }
    // Resultado de la llamada.
    return result;
  };
  // Mismos puertos, pero cada llamada pasa por el diario.
  return {
    ...inner,
    estimatedMaxUsd: prices.holdMicros / 1_000_000,
    model: {
      plan: (input, context) => call("plan", input, () => inner.model.plan(input, context)),
      assess: (input, context) => call("assess", input, () => inner.model.assess(input, context)),
      followUp: (input, context) =>
        call("follow-up", input, () => inner.model.followUp(input, context)),
      synthesize: (input, context) =>
        call("synthesize", input, () => inner.model.synthesize(input, context)),
    },
    course: {
      retrieve: (input, context) =>
        call("course", input, () => inner.course.retrieve(input, context)),
    },
    tool: {
      getCourseSession: (args, context) =>
        call("tool", args, () => inner.tool.getCourseSession(args, context)),
    },
    search: {
      search: (input, context) => call("search", input, () => inner.search.search(input, context)),
    },
    reader: {
      read: (input, context) => call("read", input, () => inner.reader.read(input, context)),
    },
  };
}

/**
 * Misma regla del diario para visión, transcripción y voz.
 * La espera local termina por cancelación o por el plazo que queda, aunque el
 * adaptador ignore la señal. Parar esa espera no demuestra que el proveedor
 * haya cancelado el cargo: lo ya enviado queda desconocido y no se publica
 * como éxito. Un resultado tardío no completa la operación.
 */
export async function journalMediaCall<T>(
  database: ResearchDatabase,
  job: JobRow,
  prices: PriceSnapshot,
  input: {
    // Tipo de llamada de medios.
    kind: "vision" | "transcribe" | "speech";
    // Datos que identifican la llamada.
    payload: unknown;
    // Duración del audio en milisegundos.
    durationMs?: number;
    // Caracteres que se convierten en voz.
    speechChars?: number;
    // Señal de cancelación.
    signal: AbortSignal;
    // Función que hace la llamada con su propia señal.
    invoke: (signal: AbortSignal) => Promise<PortResult<T>>;
  },
): Promise<PortResult<T>> {
  // Huella de la llamada.
  const digest = await fingerprint(input.kind, input.payload);
  // Reserva según duración o caracteres.
  const reservation = reservationFor(input.kind, prices, {
    durationMs: input.durationMs,
    speechChars: input.speechChars,
  });
  // Sin tarifa, no se llama.
  if (reservation === null) {
    // Atención.
    throw new ResearchAttention(`${input.kind}:sin-tarifa`);
  }
  // Registra o recupera la operación.
  const operation = await beginOperation(database, {
    jobId: job.id,
    kind: input.kind,
    fingerprint: digest,
    reservation,
    fence: job.lease_token,
  });
  // Ya completada: reutiliza el resultado.
  if (operation.state === "completed" && operation.result_json) {
    // Resultado guardado.
    return JSON.parse(operation.result_json) as PortResult<T>;
  }
  // Liberada, desconocida o enviada sin resultado: nunca se reenvía.
  if (
    operation.state === "released" ||
    operation.state === "unknown" ||
    operation.state === "dispatched"
  ) {
    // Atención.
    throw new ResearchAttention(operation.id);
  }
  // Cancelada o fuera de plazo antes de enviar.
  if (job.cancel_requested === 1 || input.signal.aborted || Date.now() >= job.deadline_at) {
    // Libera las reservas no enviadas.
    await releaseReservedOperations(database, job.id, operation.fence);
    // Atención.
    throw new ResearchAttention(operation.id);
  }
  // Marca como enviada.
  const dispatched = await markDispatched(database, operation.id, operation.fence);
  // Si no se pudo.
  if (!dispatched) {
    // Atención.
    throw new ResearchAttention(operation.id);
  }
  // Controlador propio para cortar la llamada.
  const child = new AbortController();
  // Llamada en curso; un error se convierte en fallo de proveedor con consumo desconocido.
  const pending = input.invoke(child.signal).then(
    (value) => value,
    (): PortResult<T> => ({
      ok: false,
      error: "provider",
      detail:
        "La llamada de medios falló después de enviarse. La espera local no libera ese cargo.",
      consumption: { kind: "unknown" },
    }),
  );
  // Temporizador del plazo.
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Oyente de cancelación.
  let onAbort: (() => void) | undefined;
  // Espera lo primero: resultado, cancelación o plazo.
  const outcome = await new Promise<"stop" | PortResult<T>>((resolve) => {
    // Evita resolver dos veces.
    let settled = false;
    // Detiene la espera.
    const halt = () => {
      // Si ya se resolvió, nada.
      if (settled) return;
      // Marca como resuelto.
      settled = true;
      // Corta la llamada.
      child.abort();
      // Resuelve con "stop".
      resolve("stop");
    };
    // Tiempo que queda hasta el plazo del trabajo.
    const remaining = Math.max(0, job.deadline_at - Date.now());
    // Al vencer, detiene la espera.
    timer = setTimeout(halt, remaining);
    // Guarda el oyente para retirarlo.
    onAbort = halt;
    // Si ya estaba cancelada.
    if (input.signal.aborted) {
      // Detiene.
      halt();
      // Sale.
      return;
    }
    // Escucha la cancelación una vez.
    input.signal.addEventListener("abort", halt, { once: true });
    // Cuando llega el resultado, resuelve con él si nadie lo hizo antes.
    void pending.then((value) => {
      // Ya resuelto.
      if (settled) return;
      // Marca.
      settled = true;
      // Resuelve con el resultado.
      resolve(value);
    });
  }).finally(() => {
    // Limpia el temporizador.
    if (timer !== undefined) clearTimeout(timer);
    // Retira el oyente.
    if (onAbort !== undefined) input.signal.removeEventListener("abort", onAbort);
  });
  // ¿Tarde? Parada, cancelación o plazo vencido.
  const late = outcome === "stop" || input.signal.aborted || Date.now() > job.deadline_at;
  // Si es tarde.
  if (late) {
    // Corta la llamada.
    child.abort();
    // Retiene la operación: su cargo es desconocido.
    await holdDispatched(database, operation.id, operation.fence);
    // Atención.
    throw new ResearchAttention(operation.id);
  }
  // Cancelación o plazo dentro del adaptador: mismo trato.
  if (!outcome.ok && (outcome.error === "aborted" || outcome.error === "timeout")) {
    // Retiene.
    await holdDispatched(database, operation.id, operation.fence);
    // Atención.
    throw new ResearchAttention(operation.id);
  }
  // Guarda el resultado.
  const stored = await completeOperation(database, {
    operationId: operation.id,
    fence: operation.fence,
    resultJson: JSON.stringify(outcome),
    consumption: outcome.consumption,
    reservation,
  });
  // Si no se pudo guardar.
  if (!stored) {
    // Retiene.
    await holdDispatched(database, operation.id, operation.fence);
    // Atención.
    throw new ResearchAttention(operation.id);
  }
  // Resultado de la llamada.
  return outcome;
}

// ¿El consumo no es un importe exacto? Desconocido o estimado cuentan como no exactos.
export function consumptionUnknown(consumption: Consumption): boolean {
  // Desconocido o estimado.
  if (consumption.kind === "unknown" || consumption.kind === "estimated") {
    // Sí.
    return true;
  }
  // Informado pero sin USD también cuenta como desconocido.
  return consumption.kind === "reported" && consumption.usd === null;
}
