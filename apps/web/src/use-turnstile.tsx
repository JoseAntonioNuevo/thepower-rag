// GUÍA DE LECTURA · apps/web/src/use-turnstile.tsx
// Hook de React para Cloudflare Turnstile: carga el script, pide /api/security, pinta el widget y entrega un
// token de un solo uso antes de cada envío. En demo la protección está desactivada y no hace nada.
// Hooks de React.
import { useCallback, useEffect, useRef, useState } from "react";
// Ciclo del token y su configuración.
import {
  VERIFICATION_REQUIRED,
  consumeVerificationToken,
  type VerificationConfig,
} from "./verification-cycle";
// API mínima del widget de Turnstile.
interface Turnstile {
  // Pinta el widget y devuelve su id.
  render(container: HTMLElement, options: Record<string, unknown>): string;
  // Reinicia el widget.
  reset(id: string): void;
  // Lo quita.
  remove(id: string): void;
}
// Amplía el tipo global window.
declare global {
  // window.turnstile lo añade el script.
  interface Window {
    // Widget global.
    turnstile?: Turnstile;
  }
}
// Carga en curso del script, compartida.
let loading: Promise<void> | null = null;
// Carga el script de Turnstile una sola vez.
function loadScript(): Promise<void> {
  // Ya cargado.
  if (window.turnstile) return Promise.resolve();
  // Cargando.
  if (loading) return loading;
  // Promesa de carga.
  loading = new Promise((resolve, reject) => {
    // Etiqueta script.
    const script = document.createElement("script");
    // URL con render explícito.
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    // Asíncrono.
    script.async = true;
    // Diferido.
    script.defer = true;
    // Al cargar, resuelve.
    script.onload = () => resolve();
    // Si falla.
    script.onerror = () => {
      // Permite reintentar.
      loading = null;
      // Quita la etiqueta.
      script.remove();
      // Error.
      reject(new Error("No se pudo cargar la verificación. Comprueba la conexión y reintenta."));
    };
    // Añade el script.
    document.head.append(script);
  });
  // Promesa.
  return loading;
}
// Estado y acciones de la verificación.
export function useTurnstile() {
  // Contenedor del widget.
  const container = useRef<HTMLDivElement>(null);
  // Id del widget.
  const widget = useRef<string | null>(null);
  // Token actual.
  const token = useRef<string | null>(null);
  // Esperas pendientes de un token.
  const waiters = useRef<Array<() => void>>([]);
  // Configuración de /api/security.
  const [config, setConfig] = useState<VerificationConfig | null>(null);
  // ¿Listo para enviar?
  const [ready, setReady] = useState(false);
  // Error visible.
  const [error, setError] = useState<string | null>(null);
  // Contador de reintentos.
  const [retry, setRetry] = useState(0);
  // Pide la configuración al montar o al reintentar.
  useEffect(() => {
    // Controlador.
    const controller = new AbortController();
    // GET /api/security.
    void fetch("/api/security", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        // Cuerpo.
        const body = await response.json();
        // Error.
        if (!response.ok)
          // Interrumpe esta rama y propaga el motivo al manejador de errores del recorrido.
          throw new Error(body.message ?? "No se pudo verificar la sesión.");
        // Cancelado.
        if (controller.signal.aborted)
          // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
          return;
        // Guarda la configuración.
        setConfig(body as VerificationConfig);
        // Sin protección: listo.
        if (!body.enabled)
          // Actualiza la disponibilidad de la verificación antes de permitir el siguiente envío.
          setReady(true);
      })
      .catch((caught: unknown) => {
        // Error visible si no se canceló.
        if (!controller.signal.aborted)
          // Expone el fallo en el estado de la interfaz para que el usuario pueda recuperarse.
          setError(caught instanceof Error ? caught.message : "No se pudo verificar la sesión.");
      });
    // Al desmontar, cancela.
    return () => controller.abort();
  }, [retry]);
  // Pinta el widget cuando hay configuración.
  useEffect(() => {
    // Sin protección o sin datos: nada.
    if (!config?.enabled || !container.current || !config.siteKey || !config.sessionId)
      // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
      return;
    // ¿Sigue montado?
    let active = true;
    // Carga el script.
    void loadScript()
      .then(() => {
        // Desmontado o sin script.
        if (!active || !container.current || !window.turnstile)
          // Termina esta rama sin ejecutar los pasos siguientes del recorrido.
          return;
        // Pinta el widget.
        widget.current = window.turnstile.render(container.current, {
          sitekey: config.siteKey,
          action: "course-chat",
          cData: config.sessionId,
          size: "flexible",
          appearance: "interaction-only",
          // Recibe el token nuevo que Turnstile entrega al resolver el desafío.
          callback: (value: string) => {
            // Si sigue montado.
            if (active) {
              // Guarda el token.
              token.current = value;
              // Listo.
              setReady(true);
              // Sin error.
              setError(null);
              // Esperas pendientes.
              const pending = waiters.current.splice(0);
              // Las despierta.
              for (const resolve of pending) resolve();
            }
          },
          // Invalida la verificación cuando Turnstile informa de que el token ha caducado.
          "expired-callback": () => {
            // Si sigue montado.
            if (active) {
              // Token caducado.
              token.current = null;
              // No listo.
              setReady(false);
            }
          },
          // Refleja un fallo del widget para que el usuario pueda volver a verificarse.
          "error-callback": () => {
            // Si sigue montado.
            if (active) {
              // Sin token.
              token.current = null;
              // No listo.
              setReady(false);
              // Error visible.
              setError("No se pudo completar la verificación. Reintenta antes de enviar.");
            }
          },
        });
      })
      .catch((caught: unknown) => {
        // Error al cargar.
        if (active)
          // Expone el fallo en el estado de la interfaz para que el usuario pueda recuperarse.
          setError(caught instanceof Error ? caught.message : "No se pudo cargar la verificación.");
      });
    // Limpieza.
    return () => {
      // Desmontado.
      active = false;
      // Sin token.
      token.current = null;
      // Sin esperas.
      waiters.current.splice(0);
      // Si hay widget.
      if (widget.current !== null) {
        // Lo quita.
        window.turnstile?.remove(widget.current);
        // Sin id.
        widget.current = null;
      }
    };
  }, [config]);
  // Reinicia el widget y el token.
  function reset() {
    // Sin token.
    token.current = null;
    // Con protección.
    if (config?.enabled) {
      // No listo.
      setReady(false);
      // Reinicia el widget.
      if (widget.current !== null)
        // Solicita un desafío nuevo al widget de verificación de esta conversación.
        window.turnstile?.reset(widget.current);
    }
  }
  // Espera un token (máximo 20 s).
  function waitForToken(): Promise<void> {
    // Ya hay.
    if (token.current) return Promise.resolve();
    // Promesa.
    return new Promise((resolve, reject) => {
      // Temporizador.
      let timer = 0;
      // Al recibir el token.
      const waiter = () => {
        // Cancela el temporizador.
        window.clearTimeout(timer);
        // Resuelve.
        resolve();
      };
      // Plazo.
      timer = window.setTimeout(() => {
        // Quita la espera.
        waiters.current = waiters.current.filter((item) => item !== waiter);
        // Error.
        reject(new Error(VERIFICATION_REQUIRED));
      }, 20_000);
      // Registra la espera.
      waiters.current.push(waiter);
    });
  }
  // Antes de cada envío: gasta el token y pide otro.
  async function beforeSend(): Promise<string | null> {
    // Ciclo del token.
    return consumeVerificationToken({
      config,
      // Lee el token de verificación actual sin duplicar su almacenamiento.
      readToken: () => token.current,
      // Obtiene la sesión anónima que necesita el envío protegido del chat.
      fetchSession: () => fetch("/api/security", { credentials: "same-origin", cache: "no-store" }),
      waitForToken,
      // Reinicia el widget para solicitar un nuevo desafío de verificación.
      resetWidget: () => {
        // Reinicia el widget.
        if (config?.enabled && widget.current !== null)
          // Solicita un desafío nuevo al widget de verificación de esta conversación.
          window.turnstile?.reset(widget.current);
      },
      // Invalida el token anterior para impedir reutilizarlo en otro envío.
      clearToken: () => {
        // Borra el token.
        token.current = null;
        // No listo.
        setReady(false);
      },
      // Actualiza el estado del recorrido después de renovar la verificación.
      onRenewed: (next) => {
        // No listo.
        setReady(false);
        // Nueva configuración.
        setConfig(next);
      },
    });
  }
  // Ref con callback para el contenedor.
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    // Guarda el nodo.
    container.current = node;
  }, []);
  // Lo que usa la interfaz.
  return {
    container: attachContainer,
    ready,
    error,
    enabled: config?.enabled ?? false,
    beforeSend,
    reset,
    // Reinicia el recorrido de verificación tras un fallo o un desafío caducado.
    retry: () => {
      // Sin error.
      setError(null);
      // Sin configuración.
      setConfig(null);
      // No listo.
      setReady(false);
      // Fuerza un nuevo intento.
      setRetry((n) => n + 1);
    },
  };
}
