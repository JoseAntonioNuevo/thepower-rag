import type { ResearchDatabase } from "./research-db";
import { sqlError } from "./research-db";
import { getJob, markDispatch } from "./research-store";

export interface ResearchWorkflowBinding {
  create(options: {
    id: string;
    params: { jobId: string; ownerId: string };
  }): Promise<{ id: string }>;
  get(id: string): Promise<{
    status(): Promise<{ status: string }>;
    terminate(): Promise<void>;
    restart(): Promise<void>;
  }>;
}

function messageOf(error: unknown): string {
  return sqlError(error).toLowerCase();
}

function alreadyExists(error: unknown): boolean {
  const message = messageOf(error);
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
  const job = await getJob(database, ownerId, jobId);
  if (job === null) {
    return "unconfirmed";
  }
  if (job.dispatch_state === "created") {
    return "created";
  }
  await markDispatch(database, jobId, "create_unknown");
  try {
    await workflow.create({ id: jobId, params: { jobId, ownerId } });
  } catch (error) {
    if (!alreadyExists(error)) {
      return "unconfirmed";
    }
  }
  await markDispatch(database, jobId, "created");
  return "created";
}

export async function stopWorkflow(
  workflow: ResearchWorkflowBinding,
  jobId: string,
): Promise<void> {
  try {
    await workflow.get(jobId).then((instance) => instance.terminate());
  } catch {
    // La cancelación que manda está en D1.
  }
}

const ACTIVE_WORKFLOW = new Set(["queued", "running", "paused", "waiting", "waitingForPause"]);
const INACTIVE_WORKFLOW = new Set(["complete", "errored", "terminated"]);

/** No promueve una operación en curso si el flujo sigue vivo o no se puede leer. */
export async function workflowActivity(
  workflow: ResearchWorkflowBinding,
  jobId: string,
): Promise<"active" | "inactive" | "unknown"> {
  try {
    const instance = await workflow.get(jobId);
    const status = await instance.status();
    if (ACTIVE_WORKFLOW.has(status.status)) {
      return "active";
    }
    if (INACTIVE_WORKFLOW.has(status.status)) {
      return "inactive";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

export async function restartWorkflow(
  workflow: ResearchWorkflowBinding,
  jobId: string,
): Promise<boolean> {
  try {
    const instance = await workflow.get(jobId);
    await instance.restart();
    return true;
  } catch {
    return false;
  }
}
