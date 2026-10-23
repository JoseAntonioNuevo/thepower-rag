// GUÍA DE LECTURA · apps/web/src/use-turnstile.tsx
// Prepara la sesión y el script sin ejecutar desafíos. beforeSend verifica bajo demanda antes
// de enviar; cancelar, desmontar o fallar conserva el borrador y no deja peticiones pendientes.
import { useCallback, useEffect, useRef, useState } from "react";
// El controlador aísla cada desafío y evita los refrescos posteriores al envío.
import { createTurnstileWidget, type Turnstile } from "./turnstile-widget";
import {
  VERIFICATION_CANCELLED,
  VERIFICATION_IN_PROGRESS,
  VERIFICATION_NOT_READY,
  consumeVerificationToken,
  readVerificationResponse,
  type VerificationConfig,
} from "./verification-cycle";

// El script público añade su API al navegador.
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

// Comparte la carga entre montajes, incluidas las comprobaciones de StrictMode.
let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    // Un bloqueo de red también tiene plazo y permite reintentar sin recargar la página.
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      loading = null;
      reject(new Error("No se pudo cargar la verificación. Comprueba la conexión y reintenta."));
    };
    const timer = setTimeout(fail, 15_000);
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (!window.turnstile) return fail();
      clearTimeout(timer);
      resolve();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return loading;
}

// Estado y acciones compartidos por chat e investigación.
export function useTurnstile() {
  // Referencias para el DOM, el controlador y la exclusión síncrona entre envíos.
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<ReturnType<typeof createTurnstileWidget> | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  // ready significa que se puede iniciar una verificación, no que exista un token precargado.
  const [config, setConfig] = useState<VerificationConfig | null>(null);
  const [preparedConfig, setPreparedConfig] = useState<VerificationConfig | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // Una configuración nueva invalida la anterior sin encadenar actualizaciones desde un efecto.
  const initialized = config !== null && (!config.enabled || preparedConfig === config);

  // Cancela tanto la lectura de sesión como un posible desafío interactivo.
  const cancel = useCallback(() => {
    request.current?.abort(new Error(VERIFICATION_CANCELLED));
    widget.current?.cancel();
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);

  // Obtiene configuración validada; un fallo nunca equivale a protección desactivada.
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/security", {
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const next = await readVerificationResponse(response);
        if (!controller.signal.aborted) setConfig(next);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) {
          setError(caught instanceof Error ? caught.message : "No se pudo verificar la sesión.");
        }
      });
    return () => controller.abort();
  }, [retry]);

  // Prepara únicamente el controlador. El widget no se renderiza hasta beforeSend.
  useEffect(() => {
    let active = true;
    if (!config?.enabled) return;
    void loadScript()
      .then(() => {
        if (!active) return;
        if (!container.current || !window.turnstile) throw new Error(VERIFICATION_NOT_READY);
        widget.current = createTurnstileWidget(window.turnstile, container.current, config);
        setPreparedConfig(config);
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "No se pudo cargar la verificación.");
        }
      });
    return () => {
      active = false;
      widget.current?.dispose();
      widget.current = null;
    };
  }, [config]);

  // El cerrojo cubre también la lectura de /api/security, antes de crear el widget.
  async function beforeSend(): Promise<string | null> {
    if (request.current) throw new Error(VERIFICATION_IN_PROGRESS);
    if (!initialized) throw new Error(VERIFICATION_NOT_READY);
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const token = await consumeVerificationToken({
        config,
        fetchSession: () =>
          fetch("/api/security", {
            credentials: "same-origin",
            cache: "no-store",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          }),
        requestToken: () => {
          controller.signal.throwIfAborted();
          if (!widget.current) throw new Error(VERIFICATION_NOT_READY);
          return widget.current.requestToken();
        },
        onRenewed: (next) => {
          setConfig(next);
        },
      });
      // Ni una cancelación tardía ni un cambio de conversación pueden acabar enviando.
      controller.signal.throwIfAborted();
      return token;
    } catch (caught: unknown) {
      const failure = controller.signal.aborted
        ? new Error(VERIFICATION_CANCELLED)
        : caught instanceof Error
          ? caught
          : new Error("No se pudo verificar el envío.");
      if (mounted.current && !controller.signal.aborted) setError(failure.message);
      throw failure;
    } finally {
      if (request.current === controller) request.current = null;
      if (mounted.current) setPending(false);
    }
  }

  // React conecta el contenedor estable antes de ejecutar los efectos.
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    container.current = node;
  }, []);

  return {
    container: attachContainer,
    ready: initialized && !pending,
    pending,
    error,
    beforeSend,
    cancel,
    // Reintentar carga configuración y script; sigue sin ejecutar desafíos en reposo.
    retry: () => {
      cancel();
      setError(null);
      setConfig(null);
      setPreparedConfig(null);
      setRetry((n) => n + 1);
    },
  };
}
