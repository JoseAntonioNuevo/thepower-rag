// GUÍA DE LECTURA · apps/api/src/chat-protection.ts
// Protección del chat público: sesión anónima firmada (cookie __Host-), límites por IP y por sesión,
// y verificación de Turnstile antes de cada pregunta. En local y en demo no se aplica.
// Tipo del entorno.
import type { WorkerEnv } from "./env";

// Cookie de sesión (__Host- exige https y ruta raíz).
const COOKIE = "__Host-thepower-session";
// Codificador de texto.
const encoder = new TextEncoder();
// Vida de la sesión: 30 minutos.
const SESSION_SECONDS = 1800;
// Endpoint de verificación de Turnstile.
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
// ¿Hace falta protección? Solo en real con presupuesto público.
export function protectionRequired(env: WorkerEnv): boolean {
  // Modo real con presupuesto público.
  return env.APP_MODE === "real" && env.PUBLIC_BUDGET_USD !== undefined;
}
// Respuesta de error sin caché; con 429 indica cuándo reintentar.
function failure(status: number, message: string): Response {
  // JSON de error.
  return Response.json(
    { error: "configuration", message, missing: [] },
    {
      status,
      headers: { "cache-control": "no-store", ...(status === 429 ? { "retry-after": "60" } : {}) },
    },
  );
}
// ¿Está todo configurado? Claves, origen y limitadores.
function configured(env: WorkerEnv): boolean {
  // Todo presente y secreto suficientemente largo.
  return (
    !!env.TURNSTILE_SITE_KEY &&
    !!env.TURNSTILE_SECRET_KEY &&
    env.TURNSTILE_SECRET_KEY.length >= 20 &&
    !!env.PUBLIC_ORIGIN &&
    !!env.CHAT_IP_LIMITER &&
    !!env.CHAT_SESSION_LIMITER
  );
}
// Clave HMAC derivada del secreto de Turnstile.
async function signingKey(secret: string) {
  // Importa la clave.
  return crypto.subtle.importKey(
    "raw",
    encoder.encode("thepower-session-v1:" + secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
// Bytes a hexadecimal.
function hex(value: ArrayBuffer) {
  // Dos dígitos por byte.
  return Array.from(new Uint8Array(value), (b) => b.toString(16).padStart(2, "0")).join("");
}
// HMAC de un texto en hexadecimal.
async function digest(secret: string, text: string) {
  // Firma.
  return hex(await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(text)));
}
// Lee la sesión protegida (la usa también la investigación).
export async function readProtectionSession(
  request: Request,
  secret: string,
  now = Date.now(),
): Promise<{ id: string; expires: number } | null> {
  // Misma lógica interna.
  return session(request, secret, now);
}

// Lee la cookie de sesión y comprueba su forma, caducidad y firma.
async function session(
  request: Request,
  secret: string,
  now: number,
): Promise<{ id: string; expires: number } | null> {
  // Valor de la cookie.
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  // Sin cookie.
  if (!value) return null;
  // Partes: id, caducidad y firma.
  const [id, expiry, signature, ...rest] = value.split(".");
  // Formato estricto de cada parte.
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
  // Caducidad.
  const expires = Number(expiry);
  // Caducada o demasiado lejana.
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + SESSION_SECONDS + 60)
    return null;
  // Firma en bytes.
  const bytes = Uint8Array.from(signature.match(/../g)!, (x) => Number.parseInt(x, 16));
  // Verifica la firma.
  const valid = await crypto.subtle.verify(
    "HMAC",
    await signingKey(secret),
    bytes,
    encoder.encode(id + "." + expiry),
  );
  // Sesión válida o null.
  return valid ? { id, expires } : null;
}
// Límite por red (IP), sin guardar la IP en claro.
async function ipLimit(request: Request, env: WorkerEnv): Promise<Response | null> {
  // IP que aporta Cloudflare.
  const ip = request.headers.get("cf-connecting-ip");
  // Sin IP no se puede verificar.
  if (!ip) return failure(403, "No se puede verificar el origen de la petición.");
  // Store no raw IP or question in limiter keys/logs. The edge supplies this header.
  const key = "thepower-rag:v1:ip:" + (await digest(env.TURNSTILE_SECRET_KEY!, ip));
  // Aplica el límite.
  const result = await env.CHAT_IP_LIMITER!.limit({ key });
  // Pasa o 429.
  return result.success
    ? null
    : failure(429, "Esta red ha enviado demasiadas peticiones. Espera un minuto.");
}
// Configuración de seguridad para el navegador; emite o renueva la sesión.
export async function securityConfig(
  request: Request,
  env: WorkerEnv,
  now = Date.now(),
): Promise<Response> {
  // Sin protección: desactivada.
  if (!protectionRequired(env))
    return Response.json(
      { enabled: false, siteKey: null, sessionId: null },
      { headers: { "cache-control": "no-store" } },
    );
  // Mal configurada: 503.
  if (!configured(env))
    return failure(503, "La protección del chat no está disponible. Inténtalo más tarde.");
  // Errores inesperados: 503.
  try {
    // Solo el origen público.
    if (new URL(request.url).origin !== env.PUBLIC_ORIGIN)
      return failure(403, "Origen no permitido.");
    // Límite por red.
    const blocked = await ipLimit(request, env);
    // Bloqueado.
    if (blocked) return blocked;
    // Sesión existente.
    const existing = await session(request, env.TURNSTILE_SECRET_KEY!, now);
    // Id existente o nuevo.
    const id = existing?.id ?? crypto.randomUUID();
    // Nueva caducidad.
    const expiry = String(Math.floor(now / 1000) + SESSION_SECONDS);
    // Cookie firmada.
    const cookie =
      id + "." + expiry + "." + (await digest(env.TURNSTILE_SECRET_KEY!, id + "." + expiry));
    // Configuración con la cookie.
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
    // Error: 503.
    return failure(503, "La protección del chat no está disponible. Inténtalo más tarde.");
  }
}
// Comprueba una petición de chat; devuelve una respuesta de error o null si pasa.
export async function protectChat(
  request: Request,
  env: WorkerEnv,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<Response | null> {
  // Sin protección: pasa.
  if (!protectionRequired(env)) return null;
  // Mal configurada: 503.
  if (!configured(env))
    return failure(503, "La protección del chat no está disponible. Inténtalo más tarde.");
  // Errores inesperados: 503.
  try {
    // Origen y cabecera Origin deben ser los públicos.
    if (
      new URL(request.url).origin !== env.PUBLIC_ORIGIN ||
      request.headers.get("origin") !== env.PUBLIC_ORIGIN
    )
      return failure(403, "Origen no permitido.");
    // Límite por red.
    const blocked = await ipLimit(request, env);
    // Bloqueado.
    if (blocked) return blocked;
    // Sesión válida.
    const visitor = await session(request, env.TURNSTILE_SECRET_KEY!, now);
    // Caducada.
    if (!visitor) return failure(403, "La sesión ha caducado. Recarga la página antes de enviar.");
    // Límite por sesión.
    const limited = await env.CHAT_SESSION_LIMITER!.limit({
      key: "thepower-rag:v1:session:" + visitor.id,
    });
    // Bloqueado.
    if (!limited.success)
      return failure(429, "Has enviado demasiadas preguntas. Espera un minuto antes de continuar.");
    // Token de Turnstile.
    const token = request.headers.get("x-turnstile-token");
    // Ausente o demasiado largo.
    if (!token || token.length > 2048)
      return failure(403, "Completa la verificación antes de enviar la pregunta.");
    // Verifica el token con Cloudflare.
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
    // Error de verificación.
    if (!response.ok)
      return failure(503, "No se pudo validar la verificación. Inténtalo de nuevo.");
    // Resultado.
    const result = (await response.json()) as {
      // Éxito.
      success?: boolean;
      // Host verificado.
      hostname?: string;
      // Acción.
      action?: string;
      // Datos asociados (id de sesión).
      cdata?: string;
    };
    // Debe coincidir host, acción y sesión.
    if (
      result.success !== true ||
      result.hostname !== new URL(env.PUBLIC_ORIGIN!).hostname ||
      result.action !== "course-chat" ||
      result.cdata !== visitor.id
    )
      return failure(403, "La verificación ha caducado o no es válida. Verifica de nuevo.");
    // Pasa.
    return null;
  } catch {
    // Error: 503.
    return failure(503, "No se pudo validar la verificación. Inténtalo de nuevo.");
  }
}
