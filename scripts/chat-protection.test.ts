// GUÍA DE LECTURA · scripts/chat-protection.test.ts
// Pruebas de la protección del chat público: origen, cookie firmada, Turnstile (Siteverify), límites por
// sesión e IP y orden de las comprobaciones (todo antes de gastar presupuesto o llamar al proveedor).
// Funciones de prueba y mocks.
import { expect, it, vi } from "vite-plus/test";
// Funciones que se prueban.
import { securityConfig, protectChat } from "../apps/api/src/chat-protection";
// Worker completo.
import worker from "../apps/api/src/worker";
// Tipo de las variables.
import type { WorkerEnv } from "../apps/api/src/env";
// Origen publicado.
const origin = "https://rag-thepower.josenuevo.dev";
// Momento fijo.
const now = 1791050000000;
// Entorno real con protección y limitadores que aceptan.
function environment(): WorkerEnv {
  // Variables y limitadores simulados.
  return {
    // Modo real con presupuesto, origen y Turnstile de prueba.
    APP_MODE: "real",
    PUBLIC_BUDGET_USD: "4.3",
    PUBLIC_ORIGIN: origin,
    TURNSTILE_SITE_KEY: "synthetic-site-key",
    TURNSTILE_SECRET_KEY: "synthetic-secret-for-unit-tests-only",
    // Limitadores simulados que siempre aceptan; vi.fn permite contar las llamadas.
    CHAT_IP_LIMITER: {
      limit: vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
        success: true,
      })),
    },
    CHAT_SESSION_LIMITER: {
      limit: vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
        success: true,
      })),
    },
  };
}
// Pide /api/security y devuelve cookie, id y respuesta.
async function bootstrap(env: WorkerEnv) {
  // Respuesta de seguridad.
  const response = await securityConfig(
    new Request(origin + "/api/security", { headers: { "cf-connecting-ip": "198.51.100.20" } }),
    env,
    now,
  );
  // Configuración.
  const config = (await response.json()) as { sessionId: string };
  // Cookie, id y respuesta.
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    id: config.sessionId,
    response,
  };
}
// Petición al chat con cookie, token y origen opcionales.
function request(cookie?: string, token?: string, requestOrigin = origin) {
  // POST con cabeceras.
  return new Request(origin + "/api/chat", {
    method: "POST",
    headers: {
      origin: requestOrigin,
      "cf-connecting-ip": "198.51.100.20",
      ...(cookie ? { cookie } : {}),
      ...(token ? { "x-turnstile-token": token } : {}),
      "content-type": "application/json",
    },
    body: '{"mode":"sin-rag","messages":[{"id":"q","role":"user","parts":[{"type":"text","text":"Hola"}]}]}',
  });
}
// Siteverify simulado que acepta la sesión indicada.
function verifier(id: string, override: Record<string, unknown> = {}) {
  // fetch falso que responde como Cloudflare.
  return vi.fn<() => Promise<Response>>(async () =>
    Response.json({
      success: true,
      hostname: "rag-thepower.josenuevo.dev",
      action: "course-chat",
      cdata: id,
      ...override,
    }),
  ) as unknown as typeof fetch;
}
// Demo: sin claves ni verificación.
it("demo no exige claves ni verifica tokens", async () => {
  // No bloquea.
  expect(await protectChat(request(), { APP_MODE: "demo" })).toBeNull();
  // Sin protección.
  expect(
    await (
      await securityConfig(new Request(origin + "/api/security"), { APP_MODE: "demo" })
    ).json(),
  ).toMatchObject({ enabled: false });
});
// Configuración incompleta: 503; otro origen: 403.
it("configuración incompleta y otro origen se rechazan", async () => {
  // Sin Turnstile.
  expect(
    (await protectChat(request(), { APP_MODE: "real", PUBLIC_BUDGET_USD: "4.3" }))?.status,
  ).toBe(503);
  // Entorno.
  const env = environment();
  // Otro origen.
  expect(
    (await protectChat(request(undefined, undefined, "https://other.example"), env))?.status,
  ).toBe(403);
});
// Cookie segura, firmada y renovada con la misma identidad.
it("cookie segura, firmada y renovada preserva identidad", async () => {
  // Entorno.
  const env = environment();
  // Primera sesión.
  const first = await bootstrap(env);
  // Atributos seguros.
  expect(first.response.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Strict");
  // Renovación un minuto después.
  const second = await securityConfig(
    new Request(origin + "/api/security", {
      headers: { cookie: first.cookie, "cf-connecting-ip": "198.51.100.20" },
    }),
    env,
    now + 60000,
  );
  // Misma sesión.
  expect(((await second.json()) as { sessionId: string }).sessionId).toBe(first.id);
});
// Cookie alterada o caducada: 403 sin llamar a Siteverify.
it("cookie alterada o caducada se rechaza antes de Siteverify", async () => {
  // Entorno.
  const env = environment();
  // Sesión.
  const { cookie, id } = await bootstrap(env);
  // Verificador.
  const fetcher = verifier(id);
  // Cookie alterada.
  expect(
    (
      await protectChat(
        request(cookie.slice(0, -1) + (cookie.endsWith("a") ? "b" : "a"), "token"),
        env,
        fetcher,
        now,
      )
    )?.status,
  ).toBe(403);
  // Cookie caducada.
  expect((await protectChat(request(cookie, "token"), env, fetcher, now + 1801000))?.status).toBe(
    403,
  );
  // Sin llamadas.
  expect(fetcher).not.toHaveBeenCalled();
});
// Token ausente o demasiado largo: 403 sin Siteverify.
it("token ausente o demasiado largo no llama a Siteverify", async () => {
  // Entorno.
  const env = environment();
  // Sesión.
  const { cookie, id } = await bootstrap(env);
  // Verificador.
  const fetcher = verifier(id);
  // Cada caso.
  for (const token of [undefined, "x".repeat(2049)])
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect((await protectChat(request(cookie, token), env, fetcher, now))?.status).toBe(403);
  // Sin llamadas.
  expect(fetcher).not.toHaveBeenCalled();
});
// Token válido con dominio, acción y sesión exactos.
it("token válido exige dominio, acción y sesión exactos", async () => {
  // Entorno.
  const env = environment();
  // Sesión.
  const { cookie, id } = await bootstrap(env);
  // Correcto: no bloquea.
  expect(await protectChat(request(cookie, "synthetic-token"), env, verifier(id), now)).toBeNull();
  // Cada discrepancia da 403.
  for (const override of [
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { hostname: "other.example" },
    { action: "login" },
    { cdata: "another-session" },
  ])
    // Contrasta el valor observado con el resultado exacto que define este caso.
    expect(
      (await protectChat(request(cookie, "synthetic-token"), env, verifier(id, override), now))
        ?.status,
    ).toBe(403);
});
// Siteverify falla: 503.
it("fallo de Siteverify cierra el paso", async () => {
  // Entorno.
  const env = environment();
  // Sesión.
  const { cookie } = await bootstrap(env);
  // Verificador que lanza.
  const fetcher = vi.fn<() => Promise<Response>>(async () => {
    // Error de red.
    throw new Error("simulated network timeout");
  }) as unknown as typeof fetch;
  // 503.
  expect((await protectChat(request(cookie, "token"), env, fetcher, now))?.status).toBe(503);
});
// Los límites rechazan antes de verificar.
it("429 de sesión e IP ocurre antes de verificar o gastar", async () => {
  // Entorno.
  const env = environment();
  // Sesión.
  const { cookie, id } = await bootstrap(env);
  // Verificador.
  const fetcher = verifier(id);
  // Límite de sesión agotado.
  env.CHAT_SESSION_LIMITER = {
    // Doble de prueba: resuelve el control de cupo inyectado antes de permitir que avance la petición.
    limit: async () => ({ success: false }),
  };
  // Petición.
  const rejected = await protectChat(request(cookie, "token"), env, fetcher, now);
  // 429.
  expect(rejected?.status).toBe(429);
  // Reintentar en 60 s.
  expect(rejected?.headers.get("retry-after")).toBe("60");
  // Límite de IP agotado.
  env.CHAT_IP_LIMITER = {
    // Doble de prueba: resuelve el control de cupo inyectado antes de permitir que avance la petición.
    limit: async () => ({ success: false }),
  };
  // 429.
  expect((await protectChat(request(cookie, "token"), env, fetcher, now))?.status).toBe(429);
  // Sin verificar.
  expect(fetcher).not.toHaveBeenCalled();
});
// Dos alumnos en una IP: cuotas distintas y sin IP en claro.
it("dos alumnos en una IP mantienen cuotas de sesión distintas y claves sin IP en claro", async () => {
  // Entorno.
  const env = environment();
  // Limitador de sesión.
  const sessionLimiter = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(
    async () => ({ success: true }),
  );
  // Limitador de IP.
  const ipLimiter = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
    success: true,
  }));
  // Lo usa.
  env.CHAT_SESSION_LIMITER = { limit: sessionLimiter };
  // Lo usa.
  env.CHAT_IP_LIMITER = { limit: ipLimiter };
  // Alumno A.
  const a = await bootstrap(env);
  // Alumno B.
  const b = await bootstrap(env);
  // Sesiones distintas.
  expect(a.id).not.toBe(b.id);
  // Petición de A.
  await protectChat(request(a.cookie, "token"), env, verifier(a.id), now);
  // Petición de B.
  await protectChat(request(b.cookie, "token"), env, verifier(b.id), now);
  // Llamadas.
  const calls = sessionLimiter.mock.calls;
  // Claves distintas.
  expect(calls[0]![0].key).not.toBe(calls[1]![0].key);
  // La IP no aparece en claro.
  for (const call of ipLimiter.mock.calls)
    // Comprueba que la salida no incluya el dato que este caso debe excluir.
    expect(call[0].key).not.toContain("198.51.100.20");
});
// El Worker rechaza antes de tocar D1.
it("Worker rechaza antes del presupuesto D1 y del proveedor", async () => {
  // Entorno.
  const env = environment();
  // Sesión.
  const { cookie } = await bootstrap(env);
  // D1 que falla si se usa.
  const prepare = vi.fn<() => never>(() => {
    // Error.
    throw new Error("must not touch budget");
  });
  // La usa.
  env.DB = { prepare };
  // Petición sin token.
  const result = await worker.fetch(request(cookie), env, {} as Parameters<typeof worker.fetch>[2]);
  // 403.
  expect(result.status).toBe(403);
  // D1 sin tocar.
  expect(prepare).not.toHaveBeenCalled();
});
