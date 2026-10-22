// GUÍA DE LECTURA · apps/web/src/research-submit.ts
// Envío de un trabajo de investigación desde el navegador: sube imagen y audio (cada uno con su token),
// crea el trabajo y descarta el envío si la conversación cambió mientras tanto.
// Mensajes de error de la verificación.
import {
  SESSION_RENEWED,
  VERIFICATION_NOT_READY,
  VERIFICATION_REQUIRED,
} from "./verification-cycle";

// Mensajes que indican un fallo de verificación (no de subida).
const VERIFICATION_MESSAGES = new Set([
  VERIFICATION_NOT_READY,
  VERIFICATION_REQUIRED,
  SESSION_RENEWED,
  "No se pudo verificar la sesión.",
]);

// ¿Es un error de verificación?
function verificationError(error: unknown): boolean {
  // Error con uno de esos mensajes.
  return error instanceof Error && VERIFICATION_MESSAGES.has(error.message);
}

// Cerrojo que impide dos envíos a la vez.
export interface SubmitGate {
  // Intenta entrar; false si ya hay uno.
  enter: () => boolean;
  // Sale.
  leave: () => void;
}

// Crea el cerrojo.
export function createSubmitGate(): SubmitGate {
  // ¿Ocupado?
  let held = false;
  // Métodos.
  return {
    // Adquiere la exclusión de envío para impedir dos peticiones simultáneas de la misma conversación.
    enter() {
      // Ocupado: no entra.
      if (held)
        // Rechaza esta condición y comunica el resultado negativo al llamador.
        return false;
      // Marca ocupado.
      held = true;
      // Entró.
      return true;
    },
    // Libera la exclusión de envío cuando finaliza el recorrido de la conversación.
    leave() {
      // Libera.
      held = false;
    },
  };
}

// Datos de un envío.
export interface ResearchSubmission {
  // Conversación.
  conversationId: string;
  // Pregunta.
  question: string;
  // Escenario de prueba.
  scenarioId: string | null;
  // Voz pedida.
  voice: boolean;
  // Imagen con su clave de idempotencia.
  image: { file: Blob; key: string } | null;
  // Audio con su clave.
  audio: { file: Blob; key: string } | null;
  // Clave del trabajo.
  idempotencyKey: string;
  // Generación de la conversación al empezar.
  generation: number;
  // Generación actual.
  currentGeneration: () => number;
  // Pide un token de Turnstile antes de cada mutación.
  beforeSend: () => Promise<string | null>;
  // fetch alternativo.
  fetchImpl?: typeof fetch;
}

// Resultado del envío.
export type SubmissionOutcome =
  | { ok: true; jobId: string; execution: string }
  | {
      // Fallo.
      ok: false;
      // Fase del fallo.
      reason: "upload" | "job" | "stale" | "verification";
      // Mensaje.
      message: string;
    };

// ¿Cambió la conversación desde que empezó el envío?
function stale(generation: number, current: () => number): boolean {
  // Comparación.
  return current() !== generation;
}

// JSON de una respuesta o null.
async function readJson(
  response: Response,
): Promise<{ id?: string; jobId?: string; message?: string; execution?: string } | null> {
  // Sin JSON: null.
  return response.json().catch(() => null);
}

/**
 * Sube cada archivo con su propia verificación y solo después pide el token
 * del trabajo. Las claves de idempotencia las conserva quien llama.
 */
export async function submitResearch(input: ResearchSubmission): Promise<SubmissionOutcome> {
  // fetch indicado o el global.
  const fetchImpl = input.fetchImpl ?? fetch;
  // Cabeceras con token (y JSON si se pide).
  const headersFor = async (jsonBody: boolean): Promise<Record<string, string>> => {
    // Token.
    const token = await input.beforeSend();
    // Cabeceras.
    return {
      ...(jsonBody ? { "content-type": "application/json" } : {}),
      ...(token ? { "x-turnstile-token": token } : {}),
    };
  };
  // Sube un archivo y devuelve su id.
  const upload = async (file: Blob, key: string): Promise<string> => {
    // Cabeceras con token.
    const tokenHeaders = await headersFor(false);
    // Conversación cambiada.
    if (stale(input.generation, input.currentGeneration)) {
      // Error interno stale.
      throw new Error("stale");
    }
    // POST de los bytes.
    const response = await fetchImpl(`/api/research/conversations/${input.conversationId}/media`, {
      method: "POST",
      headers: {
        ...tokenHeaders,
        "content-type": "application/octet-stream",
        "x-idempotency-key": key,
      },
      body: file,
    });
    // Cuerpo.
    const body = await readJson(response);
    // Fallo.
    if (!response.ok || !body?.id) {
      // Error con el mensaje.
      throw new Error(body?.message ?? "No se pudo guardar el archivo.");
    }
    // Id del archivo.
    return body.id;
  };
  // try/catch: un fallo de verificación termina el envío.
  try {
    // Conversación cambiada.
    if (stale(input.generation, input.currentGeneration)) {
      // Descartado.
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    // Id de la imagen.
    let imageAssetId: string | null = null;
    // Id del audio.
    let audioAssetId: string | null = null;
    // Con imagen.
    if (input.image) {
      // Sube.
      try {
        // Id.
        imageAssetId = await upload(input.image.file, input.image.key);
      } catch (error) {
        // Conversación cambiada.
        if (error instanceof Error && error.message === "stale") {
          // Descartado.
          return {
            ok: false,
            reason: "stale",
            message: "La conversación cambió. El envío no se ha mezclado.",
          };
        }
        // Error de verificación: se propaga.
        if (verificationError(error))
          // Propaga el error original para que el llamador no confunda el fallo con un resultado válido.
          throw error;
        // Fallo de subida.
        return {
          ok: false,
          reason: "upload",
          message: error instanceof Error ? error.message : "No se pudo guardar el archivo.",
        };
      }
    }
    // Conversación cambiada.
    if (stale(input.generation, input.currentGeneration)) {
      // Descartado.
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    // Con audio.
    if (input.audio) {
      // Sube.
      try {
        // Id.
        audioAssetId = await upload(input.audio.file, input.audio.key);
      } catch (error) {
        // Conversación cambiada.
        if (error instanceof Error && error.message === "stale") {
          // Descartado.
          return {
            ok: false,
            reason: "stale",
            message: "La conversación cambió. El envío no se ha mezclado.",
          };
        }
        // Error de verificación.
        if (verificationError(error))
          // Propaga el error original para que el llamador no confunda el fallo con un resultado válido.
          throw error;
        // Fallo de subida.
        return {
          ok: false,
          reason: "upload",
          message: error instanceof Error ? error.message : "No se pudo guardar el archivo.",
        };
      }
    }
    // Conversación cambiada.
    if (stale(input.generation, input.currentGeneration)) {
      // Descartado.
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    // Cabeceras del trabajo.
    const headers = await headersFor(true);
    // Conversación cambiada.
    if (stale(input.generation, input.currentGeneration)) {
      // Descartado.
      return {
        ok: false,
        reason: "stale",
        message: "La conversación cambió. El envío no se ha mezclado.",
      };
    }
    // Crea el trabajo.
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
    // Cuerpo.
    const body = await readJson(response);
    // Fallo.
    if (!response.ok || !body?.jobId) {
      // Error del trabajo.
      return {
        ok: false,
        reason: "job",
        message: body?.message ?? "No se pudo crear el trabajo.",
      };
    }
    // Trabajo creado.
    return { ok: true, jobId: body.jobId, execution: body.execution ?? "queued" };
  } catch (error) {
    // Fallo de verificación.
    return {
      ok: false,
      reason: "verification",
      message: error instanceof Error ? error.message : "No se pudo verificar el envío.",
    };
  }
}
