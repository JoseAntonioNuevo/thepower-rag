// GUÍA DE LECTURA · apps/api/src/research-owner.ts
// Identidad del propietario de las investigaciones: en producción, la sesión anónima de Turnstile;
// en local, una cookie firmada con HMAC que solo se emite en loopback con un secreto propio.
// Tipo del entorno.
import type { WorkerEnv } from "./env";
// Lectura de la sesión protegida por Turnstile.
import { readProtectionSession } from "./chat-protection";

// Nombre de la cookie del propietario.
const COOKIE = "thepower-research-owner";
// Codificador de texto a bytes.
const encoder = new TextEncoder();
// Vida de la cookie: 30 días en segundos.
const MAX_AGE = 60 * 60 * 24 * 30;

// ¿Es una URL de este mismo equipo?
export function loopback(url: string): boolean {
  // Host de la URL.
  const host = new URL(url).hostname;
  // localhost, 127.0.0.1 o ::1.
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}

// Firma HMAC-SHA256 de un texto con el secreto.
async function sign(secret: string, payload: string): Promise<string> {
  // Importa la clave derivada del secreto.
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`thepower-research-owner-v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // Firma el texto.
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  // Firma en hexadecimal.
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Cabecera Set-Cookie: solo HTTP, mismo sitio estricto y con caducidad.
export function ownerCookie(value: string): string {
  // Texto de la cookie.
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(MAX_AGE)}`;
}

// Emite un propietario nuevo con su cookie firmada.
export async function issueOwner(
  secret: string,
  now = Date.now(),
): Promise<{ id: string; header: string }> {
  // Id aleatorio.
  const id = crypto.randomUUID();
  // Caducidad en segundos.
  const expires = String(Math.floor(now / 1000) + MAX_AGE);
  // Datos firmados: id y caducidad.
  const payload = `${id}.${expires}`;
  // Cookie con los datos y la firma.
  const header = ownerCookie(`${payload}.${await sign(secret, payload)}`);
  // Id y cabecera.
  return { id, header };
}

// Lee y verifica la cookie del propietario.
async function readOwnerCookie(
  request: Request,
  secret: string,
  now: number,
): Promise<string | null> {
  // Valor de la cookie.
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  // Sin cookie.
  if (!raw) {
    // Sin propietario.
    return null;
  }
  // Partes: id, caducidad y firma.
  const [id, expires, signature, ...rest] = raw.split(".");
  // Forma incorrecta.
  if (!id || !expires || !signature || rest.length > 0 || !/^[0-9a-f-]{36}$/i.test(id)) {
    // Sin propietario.
    return null;
  }
  // Caducidad.
  const expiry = Number(expires);
  // Caducada o inválida.
  if (!Number.isFinite(expiry) || expiry <= Math.floor(now / 1000)) {
    // Sin propietario.
    return null;
  }
  // Firma esperada.
  const expected = await sign(secret, `${id}.${expires}`);
  // Longitudes distintas.
  if (expected.length !== signature.length) {
    // Sin propietario.
    return null;
  }
  // Comparación en tiempo constante (evita ataques de temporización).
  let mismatch = 0;
  // Recorre la firma.
  for (let index = 0; index < expected.length; index += 1) {
    // Acumula diferencias.
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  // Sin diferencias: el id.
  return mismatch === 0 ? id : null;
}

// Resuelve el propietario de la petición o devuelve una respuesta 403.
export async function resolveOwner(
  request: Request,
  env: WorkerEnv,
  now = Date.now(),
): Promise<{ id: string; setCookie?: string } | Response> {
  // Producción: el propietario es la sesión de Turnstile.
  if (env.APP_MODE === "real" && env.PUBLIC_BUDGET_USD !== undefined) {
    // Sin secreto de Turnstile.
    if (!env.TURNSTILE_SECRET_KEY) {
      // Error.
      return Response.json(
        { error: "configuration", message: "La sesión anónima no está disponible.", missing: [] },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    // Sesión protegida.
    const visitor = await readProtectionSession(request, env.TURNSTILE_SECRET_KEY, now);
    // Caducada.
    if (!visitor) {
      // Error.
      return Response.json(
        {
          error: "configuration",
          message: "La sesión ha caducado. Un identificador antiguo no recupera el acceso.",
          missing: [],
        },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    // Propietario de la sesión.
    return { id: visitor.id };
  }
  // Fuera de producción solo se acepta loopback.
  if (!loopback(request.url)) {
    // Error.
    return Response.json(
      {
        error: "configuration",
        message: "La demostración durable solo acepta loopback.",
        missing: [],
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  // Secreto local.
  const secret = env.RESEARCH_OWNER_SECRET;
  // Al menos 16 caracteres.
  if (!secret || secret.trim().length < 16) {
    // Error.
    return Response.json(
      {
        error: "configuration",
        message: "Falta el secreto local del propietario.",
        missing: ["RESEARCH_OWNER_SECRET"],
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  // Cookie existente.
  const existing = await readOwnerCookie(request, secret, now);
  // Válida.
  if (existing) {
    // Propietario.
    return { id: existing };
  }
  // Solo la ruta de sesión emite una cookie nueva.
  if (new URL(request.url).pathname === "/api/research/session") {
    // Nuevo propietario.
    const issued = await issueOwner(secret, now);
    // Con su cookie.
    return { id: issued.id, setCookie: issued.header };
  }
  // Sin cookie en otra ruta.
  return Response.json(
    {
      error: "configuration",
      message: "Falta la cookie de propietario de esta demostración.",
      missing: [],
    },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
