// GUÍA DE LECTURA · apps/web/src/verification-cycle.ts
// Ciclo de Turnstile en el navegador: cada mutación gasta un token de un solo uso y pide otro después.
// Error: el widget aún no cargó.
export const VERIFICATION_NOT_READY = "La verificación todavía no está lista.";
// Error: falta resolver el desafío.
export const VERIFICATION_REQUIRED = "Completa la verificación antes de enviar.";
// Error: la sesión cambió y hay que repetir.
export const SESSION_RENEWED =
  "La sesión se renovó. Espera a la nueva verificación y vuelve a enviar.";

// Configuración de verificación que da /api/security.
export interface VerificationConfig {
  // Si la protección está activa.
  enabled: boolean;
  // Clave pública del widget.
  siteKey: string | null;
  // Sesión firmada.
  sessionId: string | null;
}

/**
 * Gasta un token de un solo uso y pide otro para la siguiente mutación.
 * No reutiliza el token que acaba de entregar.
 */
export async function consumeVerificationToken(input: {
  // Configuración actual.
  config: VerificationConfig | null;
  // Lee el token del widget.
  readToken: () => string | null;
  // Pide /api/security.
  fetchSession: () => Promise<Response>;
  // Espera a un token nuevo.
  waitForToken: () => Promise<void>;
  // Reinicia el widget.
  resetWidget: () => void;
  // Borra el token guardado.
  clearToken: () => void;
  // Avisa de una sesión nueva.
  onRenewed: (next: VerificationConfig) => void;
}): Promise<string | null> {
  // Sin configuración: error.
  if (!input.config)
    // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
    throw new Error(VERIFICATION_NOT_READY);
  // Sin protección: sin token.
  if (!input.config.enabled)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Sin token.
  if (!input.readToken()) {
    // Reinicia el widget.
    input.resetWidget();
    // Espera a que llegue.
    await input.waitForToken();
  }
  // Token actual.
  const current = input.readToken();
  // Sigue sin token: error.
  if (!current)
    // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
    throw new Error(VERIFICATION_REQUIRED);
  // Comprueba la sesión.
  const response = await input.fetchSession();
  // Respuesta.
  const next = (await response.json().catch(() => null)) as
    | (VerificationConfig & { message?: string })
    | null;
  // Error del servidor.
  if (!response.ok || next === null) {
    // Mensaje.
    throw new Error(next?.message ?? "No se pudo verificar la sesión.");
  }
  // La sesión cambió.
  if (next.sessionId !== input.config.sessionId) {
    // Avisa.
    input.onRenewed(next);
    // Error para repetir.
    throw new Error(SESSION_RENEWED);
  }
  // Token a gastar.
  const value = input.readToken();
  // Sin token: error.
  if (!value)
    // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
    throw new Error(VERIFICATION_REQUIRED);
  // Lo borra para no reutilizarlo.
  input.clearToken();
  // Pide uno nuevo.
  input.resetWidget();
  // Token.
  return value;
}
