import type { WorkerEnv } from "./env";

const COOKIE = "__Host-thepower-session";
const encoder = new TextEncoder();
const SESSION_SECONDS = 1800;
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export function protectionRequired(env: WorkerEnv): boolean {
  return env.APP_MODE === "real" && env.PUBLIC_BUDGET_USD !== undefined;
}
function failure(status: number, message: string): Response {
  return Response.json(
    { error: "configuration", message, missing: [] },
    {
      status,
      headers: { "cache-control": "no-store", ...(status === 429 ? { "retry-after": "60" } : {}) },
    },
  );
}
function configured(env: WorkerEnv): boolean {
  return (
    !!env.TURNSTILE_SITE_KEY &&
    !!env.TURNSTILE_SECRET_KEY &&
    env.TURNSTILE_SECRET_KEY.length >= 20 &&
    !!env.PUBLIC_ORIGIN &&
    !!env.CHAT_IP_LIMITER &&
    !!env.CHAT_SESSION_LIMITER
  );
}
async function signingKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode("thepower-session-v1:" + secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
function hex(value: ArrayBuffer) {
  return Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function digest(secret: string, text: string) {
  return hex(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(text)));
}
export async function readProtectionSession(
  request: Request,
  secret: string,
  now = Date.now(),
): Promise<{ id: string; expires: number } | null> {
  return session(request, secret, now);
}

async function session(
  request: Request,
  secret: string,
  now: number,
): Promise<{ id: string; expires: number } | null> {
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  if (!value) return null;
  const [id, expiry, signature, ...rest] = value.split(".");
  if (
    rest.length ||
    !id ||
    !/^[a-f0-9-]{36}$/.test(id) ||
    !expiry ||
    !/^\d{10}$/.test(expiry) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    return null;
  const expires = Number(expiry);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + SESSION_SECONDS + 60)
    return null;
  const bytes = Uint8Array.from(signature.match(/../g)!, (x) => Number.parseInt(x, 16));
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    bytes,
    encoder.encode(id + "." + expiry),
  );
  return valid ? { id, expires } : null;
}
async function ipLimit(request: Request, env: WorkerEnv): Promise<Response | null> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return failure(403, "No se puede verificar el origen de la petición.");
  // Store no raw IP or question in limiter keys/logs. The edge supplies this header.
  const key = "thepower-rag:v1:ip:" + (await digest(env.TURNSTILE_SECRET_KEY!, ip));
  const result = await env.CHAT_IP_LIMITER!.limit({ key });
  return result.success
    ? null
    : failure(429, "Esta red ha enviado demasiadas peticiones. Espera un minuto.");
}
export async function securityConfig(
  request: Request,
  env: WorkerEnv,
  now = Date.now(),
): Promise<Response> {
  if (!protectionRequired(env))
    return Response.json(
      { enabled: false, siteKey: null, sessionId: null },
      { headers: { "cache-control": "no-store" } },
    );
  if (!configured(env))
    return failure(503, "La protección del chat no está disponible. Inténtalo más tarde.");
  try {
    if (new URL(request.url).origin !== env.PUBLIC_ORIGIN)
      return failure(403, "Origen no permitido.");
    const blocked = await ipLimit(request, env);
    if (blocked) return blocked;
    const existing = await session(request, env.TURNSTILE_SECRET_KEY!, now);
    const id = existing?.id ?? crypto.randomUUID();
    const expiry = String(Math.floor(now / 1000) + SESSION_SECONDS);
    const cookie =
      id + "." + expiry + "." + (await digest(env.TURNSTILE_SECRET_KEY!, id + "." + expiry));
    return Response.json(
      { enabled: true, siteKey: env.TURNSTILE_SITE_KEY, sessionId: id },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": `${COOKIE}=${cookie}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`,
        },
      },
    );
  } catch {
    return failure(503, "La protección del chat no está disponible. Inténtalo más tarde.");
  }
}
export async function protectChat(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Response | null> {
  if (!protectionRequired(env)) return null;
  if (!configured(env))
    return failure(503, "La protección del chat no está disponible. Inténtalo más tarde.");
  try {
    if (
      new URL(request.url).origin !== env.PUBLIC_ORIGIN ||
      request.headers.get("origin") !== env.PUBLIC_ORIGIN
    )
      return failure(403, "Origen no permitido.");
    const blocked = await ipLimit(request, env);
    if (blocked) return blocked;
    const visitor = await session(request, env.TURNSTILE_SECRET_KEY!, now);
    if (!visitor) return failure(403, "La sesión ha caducado. Recarga la página antes de enviar.");
    const limited = await env.CHAT_SESSION_LIMITER!.limit({
      key: "thepower-rag:v1:session:" + visitor.id,
    });
    if (!limited.success)
      return failure(429, "Has enviado demasiadas preguntas. Espera un minuto antes de continuar.");
    const token = request.headers.get("x-turnstile-token");
    if (!token || token.length > 2048)
      return failure(403, "Completa la verificación antes de enviar la pregunta.");
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: request.headers.get("cf-connecting-ip"),
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      return failure(503, "No se pudo validar la verificación. Inténtalo de nuevo.");
    const result = (await response.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
      cdata?: string;
    };
    if (
      result.success !== true ||
      result.hostname !== new URL(env.PUBLIC_ORIGIN!).hostname ||
      result.action !== "course-chat" ||
      result.cdata !== visitor.id
    )
      return failure(403, "La verificación ha caducado o no es válida. Verifica de nuevo.");
    return null;
  } catch {
    return failure(503, "No se pudo validar la verificación. Inténtalo de nuevo.");
  }
}
