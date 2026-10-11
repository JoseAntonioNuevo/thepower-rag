import { useCallback, useEffect, useRef, useState } from "react";
import {
  VERIFICATION_REQUIRED,
  consumeVerificationToken,
  type VerificationConfig,
} from "./verification-cycle";
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
  const waiters = useRef<Array<() => void>>([]);
  const [config, setConfig] = useState<VerificationConfig | null>(null);
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
        setConfig(body as VerificationConfig);
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
              const pending = waiters.current.splice(0);
              for (const resolve of pending) resolve();
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
      waiters.current.splice(0);
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
  function waitForToken(): Promise<void> {
    if (token.current) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer = 0;
      const waiter = () => {
        window.clearTimeout(timer);
        resolve();
      };
      timer = window.setTimeout(() => {
        waiters.current = waiters.current.filter((item) => item !== waiter);
        reject(new Error(VERIFICATION_REQUIRED));
      }, 20_000);
      waiters.current.push(waiter);
    });
  }
  async function beforeSend(): Promise<string | null> {
    return consumeVerificationToken({
      config,
      readToken: () => token.current,
      fetchSession: () => fetch("/api/security", { credentials: "same-origin", cache: "no-store" }),
      waitForToken,
      resetWidget: () => {
        if (config?.enabled && widget.current !== null) window.turnstile?.reset(widget.current);
      },
      clearToken: () => {
        token.current = null;
        setReady(false);
      },
      onRenewed: (next) => {
        setReady(false);
        setConfig(next);
      },
    });
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
