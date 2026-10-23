// GUÍA DE LECTURA · apps/web/src/verification-cycle.test.ts
// Comprueba el límite anterior al desafío: sesión vigente, respuestas válidas y demo explícita.
import { expect, it, vi } from "vite-plus/test";
import {
  consumeVerificationToken,
  parseVerificationConfig,
  readVerificationResponse,
  SESSION_RENEWED,
  VERIFICATION_NOT_READY,
  VERIFICATION_REQUIRED,
  type VerificationConfig,
} from "./verification-cycle";

// Configuración de prueba sin claves reales.
const config: VerificationConfig = { enabled: true, siteKey: "site", sessionId: "session-1" };

// Un límite de red conserva la indicación de espera que devuelve el servidor.
it("conserva el mensaje de cuota en vez de ocultarlo como fallo genérico", async () => {
  await expect(
    readVerificationResponse(Response.json({ message: "Espera un minuto." }, { status: 429 })),
  ).rejects.toThrow("Espera un minuto.");
});

// Un cambio de sesión o clave se detecta antes de gastar un desafío.
it.each([
  { ...config, sessionId: "session-2" },
  { ...config, siteKey: "new-site" },
  { enabled: false, siteKey: null, sessionId: null },
])("renueva la configuración antes de verificar con %j", async (next) => {
  const requestToken = vi.fn<() => Promise<string>>(async () => "token");
  const onRenewed = vi.fn<(next: VerificationConfig) => void>();
  await expect(
    consumeVerificationToken({
      config,
      fetchSession: async () => Response.json(next),
      requestToken,
      onRenewed,
    }),
  ).rejects.toThrow(SESSION_RENEWED);
  expect(requestToken).not.toHaveBeenCalled();
  expect(onRenewed).toHaveBeenCalledWith(next);
});

// La red y una configuración parcial nunca abren el paso por accidente.
it.each([
  { body: {}, status: 200 },
  { body: { enabled: true }, status: 200 },
  { body: { enabled: false }, status: 200 },
  { body: { ...config, sessionId: null }, status: 200 },
  { body: config, status: 503 },
])("rechaza la sesión inválida %j sin pedir un token", async ({ body, status }) => {
  const requestToken = vi.fn<() => Promise<string>>(async () => "token");
  await expect(
    consumeVerificationToken({
      config,
      fetchSession: async () => Response.json(body, { status }),
      requestToken,
      onRenewed() {},
    }),
  ).rejects.toThrow("No se pudo verificar la sesión");
  expect(requestToken).not.toHaveBeenCalled();
});

// La demo no contacta Cloudflare y una carga incompleta bloquea el envío.
it("solo desactiva la protección con la configuración explícita de demo", async () => {
  const fetchSession = vi.fn<() => Promise<Response>>(async () => Response.json(config));
  const requestToken = vi.fn<() => Promise<string>>(async () => "token");
  const input = { fetchSession, requestToken, onRenewed() {} };
  await expect(consumeVerificationToken({ ...input, config: null })).rejects.toThrow(
    VERIFICATION_NOT_READY,
  );
  await expect(
    consumeVerificationToken({
      ...input,
      config: { enabled: false, siteKey: null, sessionId: null },
    }),
  ).resolves.toBeNull();
  expect(fetchSession).not.toHaveBeenCalled();
  expect(requestToken).not.toHaveBeenCalled();
  expect(() => parseVerificationConfig(null)).toThrow("No se pudo verificar la sesión");
});

// Siteverify solo admite tokens no vacíos y hasta 2048 caracteres.
it.each(["", "x".repeat(2049)])("rechaza tokens inválidos antes de enviar", async (token) => {
  await expect(
    consumeVerificationToken({
      config,
      fetchSession: async () => Response.json(config),
      requestToken: async () => token,
      onRenewed() {},
    }),
  ).rejects.toThrow(VERIFICATION_REQUIRED);
});
