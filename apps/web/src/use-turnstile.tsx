import { useCallback, useEffect, useRef, useState } from "react";
interface Config {
  enabled: boolean;
  siteKey: string | null;
  sessionId: string | null;
}
interface Turnstile {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error("No se pudo cargar la verificación. Comprueba la conexión y reintenta."));
    };
    document.head.append(script);
  });
  return loading;
}
export function useTurnstile() {
  const container = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/security", {
      signal: controller.signal,
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message ?? "No se pudo verificar la sesión.");
        if (controller.signal.aborted) return;
        setConfig(body as Config);
        if (!body.enabled) setReady(true);
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : "No se pudo verificar la sesión.");
      });
    return () => controller.abort();
  }, [retry]);
  useEffect(() => {
    if (!config?.enabled || !container.current || !config.siteKey || !config.sessionId) return;
    let active = true;
    void loadScript()
      .then(() => {
        if (!active || !container.current || !window.turnstile) return;
        widget.current = window.turnstile.render(container.current, {
          sitekey: config.siteKey,
          action: "course-chat",
          cData: config.sessionId,
          size: "flexible",
          appearance: "interaction-only",
          callback: (value: string) => {
            if (active) {
              token.current = value;
              setReady(true);
              setError(null);
            }
          },
          "expired-callback": () => {
            if (active) {
              token.current = null;
              setReady(false);
            }
          },
          "error-callback": () => {
            if (active) {
              token.current = null;
              setReady(false);
              setError("No se pudo completar la verificación. Reintenta antes de enviar.");
            }
          },
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setError(caught instanceof Error ? caught.message : "No se pudo cargar la verificación.");
      });
    return () => {
      active = false;
      token.current = null;
      if (widget.current !== null) {
        window.turnstile?.remove(widget.current);
        widget.current = null;
      }
    };
  }, [config]);
  function reset() {
    token.current = null;
    if (config?.enabled) {
      setReady(false);
      if (widget.current !== null) window.turnstile?.reset(widget.current);
    }
  }
  async function beforeSend(): Promise<string | null> {
    if (!config) throw new Error("La verificación todavía no está lista.");
    if (!config.enabled) return null;
    if (!token.current) throw new Error("Completa la verificación antes de enviar.");
    // Renew the signed session for a long class; a new session requires a new widget token.
    const response = await fetch("/api/security", {
      credentials: "same-origin",
      cache: "no-store",
    });
    const next = (await response.json()) as Config & { message?: string };
    if (!response.ok) throw new Error(next.message ?? "No se pudo verificar la sesión.");
    if (next.sessionId !== config.sessionId) {
      setReady(false);
      setConfig(next);
      throw new Error("La sesión se renovó. Espera a la nueva verificación y vuelve a enviar.");
    }
    const value = token.current;
    token.current = null;
    setReady(false);
    return value;
  }
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    container.current = node;
  }, []);
  return {
    container: attachContainer,
    ready,
    error,
    enabled: config?.enabled ?? false,
    beforeSend,
    reset,
    retry: () => {
      setError(null);
      setConfig(null);
      setReady(false);
      setRetry((n) => n + 1);
    },
  };
}
