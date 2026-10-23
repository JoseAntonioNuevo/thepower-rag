// GUÍA DE LECTURA · apps/web/src/turnstile-widget.ts
// Cada envío posee su propio widget y su propia promesa. Al terminar se retira el widget,
// así ningún refresco o callback tardío puede iniciar otro desafío o resolver otro envío.
import {
  VERIFICATION_CANCELLED,
  VERIFICATION_IN_PROGRESS,
  VERIFICATION_NOT_READY,
  VERIFICATION_REQUIRED,
  type VerificationConfig,
} from "./verification-cycle";

// API pública mínima del script de Cloudflare.
export interface Turnstile {
  // Renderizar no ejecuta el desafío cuando execution es execute.
  render(container: HTMLElement, options: Record<string, unknown>): string;
  execute(id: string): void;
  remove(id: string): void;
}

// Permite completar un desafío interactivo sin la anterior espera máxima de 20 segundos.
export const VERIFICATION_TIMEOUT_MS = 120_000;

// Una instancia pendiente pertenece a un único intento.
interface Attempt {
  // El id llega después de render; sus callbacks pueden ser síncronos en las pruebas.
  widgetId: string | null;
  timer: ReturnType<typeof setTimeout>;
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  // Los reintentos pertenecen al mismo envío y no amplían su plazo.
  failures: number;
}

// Prepara el controlador sin pintar ni ejecutar ningún desafío hasta requestToken.
export function createTurnstileWidget(
  api: Turnstile,
  container: HTMLElement,
  config: VerificationConfig,
) {
  // Identidad del intento vigente y estado de desmontaje.
  let pending: Attempt | null = null;
  let disposed = false;

  // Retira el widget antes de entregar el token o devolver el control tras un fallo.
  function finish(attempt: Attempt, result: string | Error) {
    // Ignora callbacks de widgets retirados, incluso si ya hay otro intento.
    if (pending !== attempt) return;
    pending = null;
    clearTimeout(attempt.timer);
    try {
      if (attempt.widgetId !== null) api.remove(attempt.widgetId);
    } catch {
      // No envía si el widget no se ha podido retirar ni deja una promesa colgada.
      attempt.reject(new Error("No se pudo cerrar la verificación. Reintenta."));
      return;
    }
    if (result instanceof Error) attempt.reject(result);
    else attempt.resolve(result);
  }

  // Rechaza la espera pendiente al cancelar, reintentar o desmontar la conversación.
  function cancel() {
    if (pending) finish(pending, new Error(VERIFICATION_CANCELLED));
  }

  return {
    // Solo una acción puede obtener el token de este controlador a la vez.
    requestToken(): Promise<string> {
      if (disposed) return Promise.reject(new Error(VERIFICATION_NOT_READY));
      if (pending) return Promise.reject(new Error(VERIFICATION_IN_PROGRESS));
      return new Promise((resolve, reject) => {
        // La espera se registra antes de ejecutar para no perder callbacks rápidos.
        const attempt: Attempt = {
          widgetId: null,
          resolve,
          reject,
          failures: 0,
          timer: setTimeout(() => {
            finish(attempt, new Error("La verificación tardó demasiado. Vuelve a enviar."));
          }, VERIFICATION_TIMEOUT_MS),
        };
        pending = attempt;
        try {
          // Cloudflare decide si necesita interacción; el cliente decide cuándo verificar.
          const id = api.render(container, {
            sitekey: config.siteKey,
            action: "course-chat",
            cData: config.sessionId,
            size: "flexible",
            execution: "execute",
            appearance: "interaction-only",
            // Cloudflare puede recuperar un fallo transitorio mientras este envío sigue esperando.
            retry: "auto",
            "refresh-expired": "never",
            "refresh-timeout": "never",
            "response-field": false,
            // El token se entrega una sola vez y se usa inmediatamente en la petición.
            callback: (token: string) => {
              finish(
                attempt,
                token && token.length <= 2048 ? token : new Error(VERIFICATION_REQUIRED),
              );
            },
            // La caducidad termina el intento; no precarga un desafío para la siguiente pregunta.
            "expired-callback": () => finish(attempt, new Error(VERIFICATION_REQUIRED)),
            "timeout-callback": () =>
              finish(attempt, new Error("La verificación caducó. Vuelve a enviar.")),
            "error-callback": (code: string) => {
              // Un callback tardío no puede reiniciar un widget retirado ni afectar a otro envío.
              if (pending !== attempt) return true;
              // Solo se registra el código público, nunca el token, la sesión o la pregunta.
              const safeCode = /^\d{6}$/.test(code) ? code : "unknown";
              const retryable =
                /^(300|600)\d{3}$/.test(safeCode) ||
                ["110600", "110620", "200500"].includes(safeCode);
              attempt.failures += 1;
              // Dos recuperaciones nativas como máximo, dentro del plazo original de dos minutos.
              if (retryable && attempt.failures <= 2) {
                console.warn(`Turnstile ${safeCode}: reintento ${String(attempt.failures)}/2.`);
                return false;
              }
              console.warn(`Turnstile ${safeCode}: verificación detenida.`);
              finish(attempt, new Error("No se pudo completar la verificación. Reintenta."));
              return true;
            },
            "unsupported-callback": () =>
              finish(attempt, new Error("Este navegador no admite la verificación.")),
          });
          attempt.widgetId = id;
          // Un callback síncrono puede haber terminado durante render.
          if (pending !== attempt) api.remove(id);
          else api.execute(id);
        } catch {
          finish(attempt, new Error("No se pudo iniciar la verificación. Reintenta."));
        }
      });
    },
    cancel,
    // Los callbacks conservan la identidad de su intento y quedan invalidados al retirarlo.
    dispose() {
      disposed = true;
      cancel();
    },
  };
}
