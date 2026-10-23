// GUÍA DE LECTURA · apps/web/src/turnstile-widget.test.ts
// Regresiones de orden y ciclo de vida: no hay desafíos en reposo ni después del envío,
// y los fallos, la cancelación y los callbacks tardíos nunca autorizan otra petición.
import { afterEach, expect, it, vi } from "vite-plus/test";
import { createTurnstileWidget, VERIFICATION_TIMEOUT_MS } from "./turnstile-widget";
import {
  consumeVerificationToken,
  VERIFICATION_CANCELLED,
  VERIFICATION_IN_PROGRESS,
  VERIFICATION_NOT_READY,
  type VerificationConfig,
} from "./verification-cycle";

// Sesión sintética compartida con el doble de /api/security.
const config: VerificationConfig = { enabled: true, siteKey: "site", sessionId: "session-1" };

// API controlada de Turnstile: sus callbacks se disparan explícitamente desde cada prueba.
function harness() {
  const options: Record<string, unknown>[] = [];
  const api = {
    render: vi.fn<(container: HTMLElement, settings: Record<string, unknown>) => string>(
      (_container, settings) => {
        options.push(settings);
        return `widget-${String(options.length)}`;
      },
    ),
    execute: vi.fn<(id: string) => void>(),
    remove: vi.fn<(id: string) => void>(),
  };
  const widget = createTurnstileWidget(api, {} as HTMLElement, config);
  return {
    api,
    widget,
    options,
    // Permite reproducir incluso callbacks de un widget ya retirado.
    emit: (name: string, index = options.length - 1, token = "token") => {
      (options[index]![name] as (value: string) => void)(token);
    },
  };
}

// Los temporizadores no salen de cada caso.
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// El mensaje solo sale tras el callback de éxito, sin preparar otro desafío.
it("verifica antes de enviar y permanece inactivo durante y después de la respuesta", async () => {
  vi.useFakeTimers();
  const { api, widget, options, emit } = harness();
  const posted: string[] = [];
  expect(api.render).not.toHaveBeenCalled();
  const send = async () => {
    const token = await consumeVerificationToken({
      config,
      fetchSession: async () => Response.json(config),
      requestToken: () => widget.requestToken(),
      onRenewed() {},
    });
    posted.push(token!);
  };
  const first = send();
  await vi.waitFor(() => expect(api.execute).toHaveBeenCalledTimes(1));
  expect(posted).toEqual([]);
  expect(options[0]).toMatchObject({
    execution: "execute",
    appearance: "interaction-only",
    retry: "auto",
    "refresh-expired": "never",
    "refresh-timeout": "never",
    action: "course-chat",
    cData: config.sessionId,
  });
  // Un desafío humano que tarda más de los anteriores 20 s todavía puede terminar.
  await vi.advanceTimersByTimeAsync(25_000);
  expect(posted).toEqual([]);
  emit("callback", 0, "first-token");
  await first;
  expect(posted).toEqual(["first-token"]);
  expect(api.remove).toHaveBeenCalledWith("widget-1");
  // Ni la caducidad de cinco minutos ni callbacks tardíos ejecutan otro desafío.
  emit("expired-callback", 0);
  await vi.advanceTimersByTimeAsync(300_000);
  expect(api.execute).toHaveBeenCalledTimes(1);
  const second = send();
  await vi.waitFor(() => expect(api.execute).toHaveBeenCalledTimes(2));
  emit("callback", 0, "stale-token");
  expect(posted).toEqual(["first-token"]);
  emit("callback", 1, "second-token");
  await second;
  expect(posted).toEqual(["first-token", "second-token"]);
  expect(api.render).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

// No se comparte un token entre dos consumidores simultáneos.
it("rechaza el envío concurrente sin duplicar ni reiniciar el desafío pendiente", async () => {
  const { api, widget, emit } = harness();
  const first = widget.requestToken();
  await expect(widget.requestToken()).rejects.toThrow(VERIFICATION_IN_PROGRESS);
  expect(api.execute).toHaveBeenCalledTimes(1);
  emit("callback");
  await expect(first).resolves.toBe("token");
});

// Un fallo tiene respuesta inmediata y el siguiente intento exige un token propio.
it.each(["error-callback", "expired-callback", "timeout-callback", "unsupported-callback"])(
  "%s rechaza la espera y permite un reintento explícito",
  async (callback) => {
    const { api, widget, emit } = harness();
    const failed = widget.requestToken();
    emit(callback);
    await expect(failed).rejects.toThrow(/verificación/);
    expect(api.remove).toHaveBeenCalledTimes(1);
    const next = widget.requestToken();
    emit("callback", 0, "old-token");
    emit("callback", 1, "new-token");
    await expect(next).resolves.toBe("new-token");
  },
);

// Cancelar y desmontar retiran el widget y resuelven la espera como error.
it.each(["cancel", "dispose"] as const)("%s no deja una promesa pendiente", async (action) => {
  vi.useFakeTimers();
  const { api, widget, emit } = harness();
  const result = widget.requestToken();
  widget[action]();
  await expect(result).rejects.toThrow(VERIFICATION_CANCELLED);
  emit("callback");
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  widget.dispose();
  await expect(widget.requestToken()).rejects.toThrow(VERIFICATION_NOT_READY);
});

// Un script cargado pero sin respuesta tampoco puede bloquear la interfaz indefinidamente.
it("agota el plazo, retira el widget y no se reinicia automáticamente", async () => {
  vi.useFakeTimers();
  const { api, widget } = harness();
  const result = widget.requestToken().catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(VERIFICATION_TIMEOUT_MS);
  expect(await result).toEqual(new Error("La verificación tardó demasiado. Vuelve a enviar."));
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(api.execute).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

// También se liberan las esperas si el script falla al ejecutar el desafío.
it("convierte un fallo de execute en error recuperable", async () => {
  const { api, widget } = harness();
  api.execute.mockImplementation(() => {
    throw new Error("synthetic widget error");
  });
  await expect(widget.requestToken()).rejects.toThrow("No se pudo iniciar");
  expect(api.remove).toHaveBeenCalledTimes(1);
});

// Una recuperación nativa no envía, no cambia de widget y no prepara otro token tras el éxito.
it("espera al token durante dos fallos transitorios sin reiniciar la petición", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { api, widget, options, emit } = harness();
  const posted = vi.fn<(token: string) => void>();
  const sending = widget.requestToken().then(posted);
  const onError = options[0]!["error-callback"] as (code: string) => boolean;
  expect(onError("600010")).toBe(false);
  expect(onError("200500")).toBe(false);
  expect(posted).not.toHaveBeenCalled();
  expect(api.remove).not.toHaveBeenCalled();
  emit("callback", 0, "recovered-token");
  await sending;
  expect(posted).toHaveBeenCalledExactlyOnceWith("recovered-token");
  expect(api.execute).toHaveBeenCalledTimes(1);
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(onError("600010")).toBe(true);
});

// Los fallos persistentes y los de configuración no se reintentan indefinidamente.
it.each([
  { code: "600010", failures: 3 },
  { code: "110200", failures: 1 },
])("detiene $code tras $failures fallos", async ({ code, failures }) => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { api, widget, options } = harness();
  const token = widget.requestToken();
  const onError = options[0]!["error-callback"] as (code: string) => boolean;
  for (let i = 0; i < failures - 1; i += 1) onError(code);
  expect(onError(code)).toBe(true);
  await expect(token).rejects.toThrow("No se pudo completar la verificación");
  expect(api.remove).toHaveBeenCalledTimes(1);
});
