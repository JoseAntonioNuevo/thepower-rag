import {
  SESSION_RENEWED,
  VERIFICATION_NOT_READY,
  VERIFICATION_REQUIRED,
} from "./verification-cycle";

const VERIFICATION_MESSAGES = new Set([
  VERIFICATION_NOT_READY,
  VERIFICATION_REQUIRED,
  SESSION_RENEWED,
  "No se pudo verificar la sesión.",
]);

function verificationError(error: unknown): boolean {
  return error instanceof Error && VERIFICATION_MESSAGES.has(error.message);
}

export interface SubmitGate {
  enter: () => boolean;
  leave: () => void;
}

export function createSubmitGate(): SubmitGate {
  let held = false;
  return {
    enter() {
      if (held) return false;
      held = true;
      return true;
    },
    leave() {
      held = false;
    },
  };
}

export interface ResearchSubmission {
  conversationId: string;
  question: string;
  scenarioId: string | null;
  voice: boolean;
  image: { file: Blob; key: string } | null;
  audio: { file: Blob; key: string } | null;
  idempotencyKey: string;
  generation: number;
  currentGeneration: () => number;
  beforeSend: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export type SubmissionOutcome =
  | { ok: true; jobId: string; execution: string }
  | {
      ok: false;
      reason: "upload" | "job" | "stale" | "verification";
      message: string;
    };

function stale(generation: number, current: () => number): boolean {
  return current() !== generation;
}

async function readJson(
  response: Response,
): Promise<{ id?: string; jobId?: string; message?: string; execution?: string } | null> {
  return response.json().catch(() => null);
}

/**
 * Sube cada archivo con su propia verificación y solo después pide el token
 * del trabajo. Las claves de idempotencia las conserva quien llama.
 */
export async function submitResearch(input: ResearchSubmission): Promise<SubmissionOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const headersFor = async (jsonBody: boolean): Promise<Record<string, string>> => {
    const token = await input.beforeSend();
    return {
      ...(jsonBody ? { "content-type": "application/json" } : {}),
      ...(token ? { "x-turnstile-token": token } : {}),
    };
  };
  const upload = async (file: Blob, key: string): Promise<string> => {
    const tokenHeaders = await headersFor(false);
    if (stale(input.generation, input.currentGeneration)) {
      throw new Error("stale");
    }
    const response = await fetchImpl(`/api/research/conversations/${input.conversationId}/media`, {
      method: "POST",
      headers: {
        ...tokenHeaders,
        "content-type": "application/octet-stream",
        "x-idempotency-key": key,
      },
      body: file,
    });
    const body = await readJson(response);
    if (!response.ok || !body?.id) {
      throw new Error(body?.message ?? "No se pudo guardar el archivo.");
    }
    return body.id;
  };
  try {
    if (stale(input.generation, input.currentGeneration)) {
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    let imageAssetId: string | null = null;
    let audioAssetId: string | null = null;
    if (input.image) {
      try {
        imageAssetId = await upload(input.image.file, input.image.key);
      } catch (error) {
        if (error instanceof Error && error.message === "stale") {
          return {
            ok: false,
            reason: "stale",
            message: "La conversación cambió. El envío no se ha mezclado.",
          };
        }
        if (verificationError(error)) throw error;
        return {
          ok: false,
          reason: "upload",
          message: error instanceof Error ? error.message : "No se pudo guardar el archivo.",
        };
      }
    }
    if (stale(input.generation, input.currentGeneration)) {
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    if (input.audio) {
      try {
        audioAssetId = await upload(input.audio.file, input.audio.key);
      } catch (error) {
        if (error instanceof Error && error.message === "stale") {
          return {
            ok: false,
            reason: "stale",
            message: "La conversación cambió. El envío no se ha mezclado.",
          };
        }
        if (verificationError(error)) throw error;
        return {
          ok: false,
          reason: "upload",
          message: error instanceof Error ? error.message : "No se pudo guardar el archivo.",
        };
      }
    }
    if (stale(input.generation, input.currentGeneration)) {
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    const headers = await headersFor(true);
    if (stale(input.generation, input.currentGeneration)) {
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    const response = await fetchImpl(`/api/research/conversations/${input.conversationId}/jobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        idempotencyKey: input.idempotencyKey,
        question: input.question,
        scenarioId: input.scenarioId,
        voice: input.voice,
        imageAssetId,
        audioAssetId,
      }),
    });
    const body = await readJson(response);
    if (!response.ok || !body?.jobId) {
      return {
        ok: false,
        reason: "job",
        message: body?.message ?? "No se pudo crear el trabajo.",
      };
    }
    return { ok: true, jobId: body.jobId, execution: body.execution ?? "queued" };
  } catch (error) {
    return {
      ok: false,
      reason: "verification",
      message: error instanceof Error ? error.message : "No se pudo verificar el envío.",
    };
  }
}
