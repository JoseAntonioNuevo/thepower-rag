// GUÍA DE LECTURA · apps/web/src/verification-cycle.ts
// Verifica primero la sesión y después pide un token nuevo para una única mutación.
// Nunca prepara el desafío del siguiente envío mientras la petición actual sigue en curso.

// Mensajes compartidos por el chat y la investigación.
export const VERIFICATION_NOT_READY = "La verificación todavía no está lista.";
export const VERIFICATION_REQUIRED = "Completa la verificación antes de enviar.";
export const VERIFICATION_CANCELLED = "Envío cancelado. Tu pregunta no se ha enviado.";
export const VERIFICATION_IN_PROGRESS = "Ya hay una verificación en curso.";
export const SESSION_RENEWED =
  "La sesión se renovó. Vuelve a enviar para verificar la nueva sesión.";

// Configuración pública que devuelve /api/security.
export interface VerificationConfig {
  // La demo desactiva la protección de forma explícita.
  enabled: boolean;
  // Clave pública e identidad de la sesión firmada.
  siteKey: string | null;
  sessionId: string | null;
}

// Rechaza respuestas incompletas: la ausencia de enabled nunca desactiva la protección.
export function parseVerificationConfig(value: unknown): VerificationConfig {
  // Una respuesta de error o un HTML no son configuración.
  if (typeof value !== "object" || value === null) {
    throw new Error("No se pudo verificar la sesión.");
  }
  // Los campos se validan antes de usarlos para renderizar el widget.
  const body = value as Record<string, unknown>;
  if (body.enabled === false && body.siteKey === null && body.sessionId === null) {
    return { enabled: false, siteKey: null, sessionId: null };
  }
  if (
    body.enabled === true &&
    typeof body.siteKey === "string" &&
    body.siteKey.trim().length > 0 &&
    typeof body.sessionId === "string" &&
    body.sessionId.trim().length > 0
  ) {
    return { enabled: true, siteKey: body.siteKey, sessionId: body.sessionId };
  }
  throw new Error("No se pudo verificar la sesión.");
}

// Conserva los mensajes públicos del servidor, incluidos los límites de sesión o red.
export async function readVerificationResponse(response: Response): Promise<VerificationConfig> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body ? body.message : null;
    throw new Error(
      typeof message === "string" && message.length > 0
        ? message
        : "No se pudo verificar la sesión.",
    );
  }
  return parseVerificationConfig(body);
}

// Obtiene un token solo para la petición que el usuario acaba de iniciar.
export async function consumeVerificationToken(input: {
  // Configuración con la que se preparó el widget.
  config: VerificationConfig | null;
  // Renueva la cookie antes del desafío, para no gastar un token de otra sesión.
  fetchSession: () => Promise<Response>;
  // Resuelve únicamente cuando termina la verificación de este envío.
  requestToken: () => Promise<string>;
  // Reconstruye el widget si el servidor ha renovado su identidad o clave.
  onRenewed: (next: VerificationConfig) => void;
}): Promise<string | null> {
  // Sin configuración válida no se permite iniciar una petición protegida.
  if (!input.config) throw new Error(VERIFICATION_NOT_READY);
  const config = parseVerificationConfig(input.config);
  if (!config.enabled) return null;

  // Primero comprueba la sesión; un error HTTP no llega a ejecutar Turnstile.
  const next = await readVerificationResponse(await input.fetchSession());
  if (
    next.enabled !== config.enabled ||
    next.sessionId !== config.sessionId ||
    next.siteKey !== config.siteKey
  ) {
    input.onRenewed(next);
    throw new Error(SESSION_RENEWED);
  }

  // El token va directamente al llamador: no se almacena ni se precarga otro.
  const token = await input.requestToken();
  if (!token || token.length > 2048) throw new Error(VERIFICATION_REQUIRED);
  return token;
}
