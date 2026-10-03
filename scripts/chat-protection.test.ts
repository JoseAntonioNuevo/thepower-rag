import { expect, it, vi } from "vite-plus/test";
import { securityConfig, protectChat } from "../apps/api/src/chat-protection";
import worker from "../apps/api/src/worker";
import type { WorkerEnv } from "../apps/api/src/env";
const origin = "https://rag-thepower.josenuevo.dev";
const now = 1791050000000;
function environment(): WorkerEnv {
  return {
    APP_MODE: "real",
    PUBLIC_BUDGET_USD: "4.3",
    PUBLIC_ORIGIN: origin,
    TURNSTILE_SITE_KEY: "synthetic-site-key",
    TURNSTILE_SECRET_KEY: "synthetic-secret-for-unit-tests-only",
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
async function bootstrap(env: WorkerEnv) {
  const response = await securityConfig(
    new Request(origin + "/api/security", { headers: { "cf-connecting-ip": "198.51.100.20" } }),
    env,
    now,
  );
  const config = (await response.json()) as { sessionId: string };
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    id: config.sessionId,
    response,
  };
}
function request(cookie?: string, token?: string, requestOrigin = origin) {
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
function verifier(id: string, override: Record<string, unknown> = {}) {
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
it("demo no exige claves ni verifica tokens", async () => {
  expect(await protectChat(request(), { APP_MODE: "demo" })).toBeNull();
  expect(
    await (
      await securityConfig(new Request(origin + "/api/security"), { APP_MODE: "demo" })
    ).json(),
  ).toMatchObject({ enabled: false });
});
it("configuración incompleta y otro origen se rechazan", async () => {
  expect(
    (await protectChat(request(), { APP_MODE: "real", PUBLIC_BUDGET_USD: "4.3" }))?.status,
  ).toBe(503);
  const env = environment();
  expect(
    (await protectChat(request(undefined, undefined, "https://other.example"), env))?.status,
  ).toBe(403);
});
it("cookie segura, firmada y renovada preserva identidad", async () => {
  const env = environment();
  const first = await bootstrap(env);
  expect(first.response.headers.get("set-cookie")).toContain("Secure; HttpOnly; SameSite=Strict");
  const second = await securityConfig(
    new Request(origin + "/api/security", {
      headers: { cookie: first.cookie, "cf-connecting-ip": "198.51.100.20" },
    }),
    env,
    now + 60000,
  );
  expect(((await second.json()) as { sessionId: string }).sessionId).toBe(first.id);
});
it("cookie alterada o caducada se rechaza antes de Siteverify", async () => {
  const env = environment();
  const { cookie, id } = await bootstrap(env);
  const fetcher = verifier(id);
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
  expect((await protectChat(request(cookie, "token"), env, fetcher, now + 1801000))?.status).toBe(
    403,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("token ausente o demasiado largo no llama a Siteverify", async () => {
  const env = environment();
  const { cookie, id } = await bootstrap(env);
  const fetcher = verifier(id);
  for (const token of [undefined, "x".repeat(2049)])
    expect((await protectChat(request(cookie, token), env, fetcher, now))?.status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("token válido exige dominio, acción y sesión exactos", async () => {
  const env = environment();
  const { cookie, id } = await bootstrap(env);
  expect(await protectChat(request(cookie, "synthetic-token"), env, verifier(id), now)).toBeNull();
  for (const override of [
    { success: false, "error-codes": ["timeout-or-duplicate"] },
    { hostname: "other.example" },
    { action: "login" },
    { cdata: "another-session" },
  ])
    expect(
      (await protectChat(request(cookie, "synthetic-token"), env, verifier(id, override), now))
        ?.status,
    ).toBe(403);
});
it("fallo de Siteverify cierra el paso", async () => {
  const env = environment();
  const { cookie } = await bootstrap(env);
  const fetcher = vi.fn<() => Promise<Response>>(async () => {
    throw new Error("simulated network timeout");
  }) as unknown as typeof fetch;
  expect((await protectChat(request(cookie, "token"), env, fetcher, now))?.status).toBe(503);
});
it("429 de sesión e IP ocurre antes de verificar o gastar", async () => {
  const env = environment();
  const { cookie, id } = await bootstrap(env);
  const fetcher = verifier(id);
  env.CHAT_SESSION_LIMITER = { limit: async () => ({ success: false }) };
  const rejected = await protectChat(request(cookie, "token"), env, fetcher, now);
  expect(rejected?.status).toBe(429);
  expect(rejected?.headers.get("retry-after")).toBe("60");
  env.CHAT_IP_LIMITER = { limit: async () => ({ success: false }) };
  expect((await protectChat(request(cookie, "token"), env, fetcher, now))?.status).toBe(429);
  expect(fetcher).not.toHaveBeenCalled();
});
it("dos alumnos en una IP mantienen cuotas de sesión distintas y claves sin IP en claro", async () => {
  const env = environment();
  const sessionLimiter = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(
    async () => ({ success: true }),
  );
  const ipLimiter = vi.fn<(input: { key: string }) => Promise<{ success: boolean }>>(async () => ({
    success: true,
  }));
  env.CHAT_SESSION_LIMITER = { limit: sessionLimiter };
  env.CHAT_IP_LIMITER = { limit: ipLimiter };
  const a = await bootstrap(env);
  const b = await bootstrap(env);
  expect(a.id).not.toBe(b.id);
  await protectChat(request(a.cookie, "token"), env, verifier(a.id), now);
  await protectChat(request(b.cookie, "token"), env, verifier(b.id), now);
  const calls = sessionLimiter.mock.calls;
  expect(calls[0]![0].key).not.toBe(calls[1]![0].key);
  for (const call of ipLimiter.mock.calls) expect(call[0].key).not.toContain("198.51.100.20");
});
it("Worker rechaza antes del presupuesto D1 y del proveedor", async () => {
  const env = environment();
  const { cookie } = await bootstrap(env);
  const prepare = vi.fn<() => never>(() => {
    throw new Error("must not touch budget");
  });
  env.DB = { prepare };
  const result = await worker.fetch(request(cookie), env, {} as Parameters<typeof worker.fetch>[2]);
  expect(result.status).toBe(403);
  expect(prepare).not.toHaveBeenCalled();
});
