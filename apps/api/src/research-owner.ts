import type { WorkerEnv } from "./env";
import { readProtectionSession } from "./chat-protection";

const COOKIE = "thepower-research-owner";
const encoder = new TextEncoder();
const MAX_AGE = 60 * 60 * 24 * 30;

export function loopback(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`thepower-research-owner-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function ownerCookie(value: string): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(MAX_AGE)}`;
}

export async function issueOwner(
  secret: string,
  now = Date.now(),
): Promise<{ id: string; header: string }> {
  const id = crypto.randomUUID();
  const expires = String(Math.floor(now / 1000) + MAX_AGE);
  const payload = `${id}.${expires}`;
  const header = ownerCookie(`${payload}.${await sign(secret, payload)}`);
  return { id, header };
}

async function readOwnerCookie(
  request: Request,
  secret: string,
  now: number,
): Promise<string | null> {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) {
    return null;
  }
  const [id, expires, signature, ...rest] = raw.split(".");
  if (!id || !expires || !signature || rest.length > 0 || !/^[0-9a-f-]{36}$/i.test(id)) {
    return null;
  }
  const expiry = Number(expires);
  if (!Number.isFinite(expiry) || expiry <= Math.floor(now / 1000)) {
    return null;
  }
  const expected = await sign(secret, `${id}.${expires}`);
  if (expected.length !== signature.length) {
    return null;
  }
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return mismatch === 0 ? id : null;
}

export async function resolveOwner(
  request: Request,
  env: WorkerEnv,
  now = Date.now(),
): Promise<{ id: string; setCookie?: string } | Response> {
  if (env.APP_MODE === "real" && env.PUBLIC_BUDGET_USD !== undefined) {
    if (!env.TURNSTILE_SECRET_KEY) {
      return Response.json(
        { error: "configuration", message: "La sesión anónima no está disponible.", missing: [] },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    const visitor = await readProtectionSession(request, env.TURNSTILE_SECRET_KEY, now);
    if (!visitor) {
      return Response.json(
        {
          error: "configuration",
          message: "La sesión ha caducado. Un identificador antiguo no recupera el acceso.",
          missing: [],
        },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    return { id: visitor.id };
  }
  if (!loopback(request.url)) {
    return Response.json(
      {
        error: "configuration",
        message: "La demostración durable solo acepta loopback.",
        missing: [],
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const secret = env.RESEARCH_OWNER_SECRET;
  if (!secret || secret.trim().length < 16) {
    return Response.json(
      {
        error: "configuration",
        message: "Falta el secreto local del propietario.",
        missing: ["RESEARCH_OWNER_SECRET"],
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  const existing = await readOwnerCookie(request, secret, now);
  if (existing) {
    return { id: existing };
  }
  if (new URL(request.url).pathname === "/api/research/session") {
    const issued = await issueOwner(secret, now);
    return { id: issued.id, setCookie: issued.header };
  }
  return Response.json(
    {
      error: "configuration",
      message: "Falta la cookie de propietario de esta demostración.",
      missing: [],
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
