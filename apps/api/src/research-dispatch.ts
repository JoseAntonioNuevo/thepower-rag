// GUÍA DE LECTURA · apps/api/src/research-dispatch.ts
// Lanzamiento y control del Workflow de cada investigación: crear (sin duplicar), parar, consultar
// si sigue vivo y reiniciar. El id de la instancia es el del trabajo.
// Tipo de la base de datos.
import type { ResearchDatabase } from "./research-db";
// Texto de un error de SQL.
import { sqlError } from "./research-db";
// Lectura del trabajo y marca del lanzamiento.
import { getJob, markDispatch } from "./research-store";

// Forma del binding del Workflow.
export interface ResearchWorkflowBinding {
  // Crea una instancia con su id y parámetros.
  create(options: {
    // Id de la instancia.
    id: string;
    // Parámetros.
    params: { jobId: string; ownerId: string };
  }): Promise<{ id: string }>;
  // Obtiene una instancia por id.
  get(id: string): Promise<{
    // Estado de la instancia.
    status(): Promise<{ status: string }>;
    // La termina.
    terminate(): Promise<void>;
    // La reinicia.
    restart(): Promise<void>;
  }>;
}

// Mensaje del error en minúsculas.
function messageOf(error: unknown): string {
  // Texto del error.
  return sqlError(error).toLowerCase();
}

// ¿El error dice que la instancia ya existía?
function alreadyExists(error: unknown): boolean {
  // Mensaje.
  const message = messageOf(error);
  // Ya existe o conflicto 409.
  return (
    message.includes("already exists") ||
    message.includes("already_exists") ||
    message.includes("409")
  );
}

/**
 * El id de la instancia es el del trabajo. Repetir create con ese id no abre
 * otra investigación: si ya existe, se adopta la instancia.
 */
export async function ensureWorkflow(
  database: ResearchDatabase,
  workflow: ResearchWorkflowBinding,
  ownerId: string,
  jobId: string,
): Promise<"created" | "unconfirmed"> {
  // Trabajo.
  const job = await getJob(database, ownerId, jobId);
  // No existe.
  if (job === null) {
    // Sin confirmar.
    return "unconfirmed";
  }
  // Ya lanzado.
  if (job.dispatch_state === "created") {
    // Creado.
    return "created";
  }
  // Marca el intento antes de llamar (por si se corta).
  await markDispatch(database, jobId, "create_unknown");
  // Crea la instancia.
  try {
    // Con el id del trabajo.
    await workflow.create({ id: jobId, params: { jobId, ownerId } });
  } catch (error) {
    // Si no es «ya existe», no se confirma.
    if (!alreadyExists(error)) {
      // Sin confirmar.
      return "unconfirmed";
    }
  }
  // Marca como creado.
  await markDispatch(database, jobId, "created");
  // Creado.
  return "created";
}

// Intenta terminar la instancia; un fallo se ignora.
export async function stopWorkflow(
  workflow: ResearchWorkflowBinding,
  jobId: string,
): Promise<void> {
  // Puede fallar si no existe.
  try {
    // Termina la instancia.
    await workflow.get(jobId).then((instance) => instance.terminate());
  } catch {
    // La cancelación que manda está en D1.
  }
}

// Estados de una instancia viva.
const ACTIVE_WORKFLOW = new Set(["queued", "running", "paused", "waiting", "waitingForPause"]);
// Estados de una instancia terminada.
const INACTIVE_WORKFLOW = new Set(["complete", "errored", "terminated"]);

/** No promueve una operación en curso si el flujo sigue vivo o no se puede leer. */
export async function workflowActivity(
  workflow: ResearchWorkflowBinding,
  jobId: string,
): Promise<"active" | "inactive" | "unknown"> {
  // Puede fallar al leer.
  try {
    // Instancia.
    const instance = await workflow.get(jobId);
    // Estado.
    const status = await instance.status();
    // Viva.
    if (ACTIVE_WORKFLOW.has(status.status)) {
      // Activa.
      return "active";
    }
    // Terminada.
    if (INACTIVE_WORKFLOW.has(status.status)) {
      // Inactiva.
      return "inactive";
    }
    // Estado desconocido.
    return "unknown";
  } catch {
    // No se pudo leer.
    return "unknown";
  }
}

// Reinicia la instancia.
export async function restartWorkflow(
  workflow: ResearchWorkflowBinding,
  jobId: string,
): Promise<boolean> {
  // Puede fallar.
  try {
    // Instancia.
    const instance = await workflow.get(jobId);
    // Reinicio.
    await instance.restart();
    // Reiniciada.
    return true;
  } catch {
    // No se pudo.
    return false;
  }
}
