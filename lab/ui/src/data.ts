// GUÍA DE LECTURA · lab/ui/src/data.ts
// Lectura tipada de los eventos JSON y formato para proyectar los datos reales del laboratorio.
import type { AulaEvent, AulaJson, AulaRun, AulaStageId } from "@thepower-rag/contracts";

// La interfaz no ejecuta HTML ni instrucciones recibidas de una fuente o del modelo.
export function record(value: AulaJson | undefined): Record<string, AulaJson> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}
export function list(value: AulaJson | undefined): AulaJson[] {
  return Array.isArray(value) ? value : [];
}
export function words(value: AulaJson | undefined): string {
  return typeof value === "string"
    ? value
    : value === undefined || value === null
      ? ""
      : JSON.stringify(value, null, 2);
}
export function formatMs(value: number): string {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(2)} s`;
}
// Reutiliza el formateador durante los eventos del stream en lugar de crearlo en cada dibujo.
const classroomTime = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Europe/Madrid",
});
export function time(value: string): string {
  return classroomTime.format(new Date(value));
}

// Separa el último valor de entrada del valor de salida que confirmó esa etapa.
export function stageData(run: AulaRun, stage: AulaStageId) {
  const events = run.events.filter((event) => event.stage === stage);
  const before = [...events]
    .reverse()
    .find((event) => event.type === "stage" && ["waiting", "running"].includes(event.phase));
  const after = [...events]
    .reverse()
    .find((event) => event.type === "stage" && event.phase === "complete");
  return {
    input: record(record(before?.data).input),
    output: record(record(after?.data).output),
    before,
    after,
    events,
  };
}

// Solo una respuesta HTTP correcta se interpreta como dato del Aula.
export async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(value.message ?? "No se pudo completar la operación.");
  return value;
}

// Un evento repetido durante una reconexión no duplica la respuesta ni sus deltas.
export function appendEvent(
  current: AulaRun,
  event: AulaEvent,
  summary: Omit<AulaRun, "events">,
): AulaRun {
  return {
    ...summary,
    events: current.events.some((item) => item.seq === event.seq)
      ? current.events
      : [...current.events, event],
  };
}
