export const VERIFICATION_NOT_READY = "La verificación todavía no está lista.";
export const VERIFICATION_REQUIRED = "Completa la verificación antes de enviar.";
export const SESSION_RENEWED =
  "La sesión se renovó. Espera a la nueva verificación y vuelve a enviar.";

export interface VerificationConfig {
  enabled: boolean;
  siteKey: string | null;
  sessionId: string | null;
}

/**
 * Gasta un token de un solo uso y pide otro para la siguiente mutación.
 * No reutiliza el token que acaba de entregar.
 */
export async function consumeVerificationToken(input: {
  config: VerificationConfig | null;
  readToken: () => string | null;
  fetchSession: () => Promise<Response>;
  waitForToken: () => Promise<void>;
  resetWidget: () => void;
  clearToken: () => void;
  onRenewed: (next: VerificationConfig) => void;
}): Promise<string | null> {
  if (!input.config) throw new Error(VERIFICATION_NOT_READY);
  if (!input.config.enabled) return null;
  if (!input.readToken()) {
    input.resetWidget();
    await input.waitForToken();
  }
  const current = input.readToken();
  if (!current) throw new Error(VERIFICATION_REQUIRED);
  const response = await input.fetchSession();
  const next = (await response.json().catch(() => null)) as
    | (VerificationConfig & { message?: string })
    | null;
  if (!response.ok || next === null) {
    throw new Error(next?.message ?? "No se pudo verificar la sesión.");
  }
  if (next.sessionId !== input.config.sessionId) {
    input.onRenewed(next);
    throw new Error(SESSION_RENEWED);
  }
  const value = input.readToken();
  if (!value) throw new Error(VERIFICATION_REQUIRED);
  input.clearToken();
  input.resetWidget();
  return value;
}
