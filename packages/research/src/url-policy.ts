import { DEFAULT_RESEARCH_DOMAINS, RESEARCH_LIMITS } from "@thepower-rag/contracts";
import { fnv1a64 } from "@thepower-rag/core";

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Lee la lista de dominios permitidos. Sin valor usa la lista oficial por
 * defecto. Un valor con una entrada inválida no se acepta a medias.
 */
export function parseAllowedDomains(
  value: string | undefined,
): { ok: true; domains: string[] } | { ok: false; reason: string } {
  if (value === undefined || value.trim().length === 0) {
    return { ok: true, domains: [...DEFAULT_RESEARCH_DOMAINS] };
  }
  const domains: string[] = [];
  for (const raw of value.split(",")) {
    const domain = raw.trim().toLowerCase();
    if (!HOSTNAME.test(domain)) {
      return { ok: false, reason: "RESEARCH_ALLOWED_DOMAINS contiene un dominio inválido." };
    }
    if (!domains.includes(domain)) {
      domains.push(domain);
    }
  }
  if (domains.length === 0 || domains.length > 10) {
    return { ok: false, reason: "RESEARCH_ALLOWED_DOMAINS necesita de 1 a 10 dominios." };
  }
  return { ok: true, domains };
}

export type UrlVerdict =
  | { ok: true; url: string; domain: string }
  | { ok: false; reason: string; domain: string };

/**
 * Política de URL: https, sin credenciales, puerto por defecto y dominio
 * exacto de la lista. Se aplica a los resultados de búsqueda y también a la URL
 * final que devuelve el lector tras redirecciones.
 */
export function checkUrl(raw: string, allowed: readonly string[]): UrlVerdict {
  if (raw.length === 0 || raw.length > RESEARCH_LIMITS.maxUrlChars) {
    return { ok: false, reason: "URL vacía o demasiado larga.", domain: "" };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: "URL inválida.", domain: "" };
  }
  const domain = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Solo se leen URL https.", domain };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "La URL lleva credenciales.", domain };
  }
  if (parsed.port !== "") {
    return { ok: false, reason: "La URL usa un puerto no estándar.", domain };
  }
  if (!allowed.includes(domain)) {
    return { ok: false, reason: "Dominio fuera de la lista permitida.", domain };
  }
  return { ok: true, url: normalizeUrl(parsed), domain };
}

/** Forma canónica para deduplicar: sin fragmento y sin barra final redundante. */
export function normalizeUrl(input: URL | string): string {
  const url = typeof input === "string" ? new URL(input) : new URL(input.href);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.href;
}

/** Id estable de una página leída, derivado de su URL final canónica. */
export function webSourceId(finalUrl: string): string {
  return `web-${fnv1a64(normalizeUrl(finalUrl)).slice(0, 12)}`;
}

const INSTRUCTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions/i,
  /ignora\s+(?:todas\s+)?(?:las\s+)?instrucciones/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /ahora\s+eres/i,
  /(?:cambia|change)\s+(?:de\s+)?(?:proveedor|provider|modelo|model)/i,
  /(?:aumenta|increase)\s+(?:el\s+)?(?:l[ií]mite|limit|presupuesto|budget)/i,
];

/**
 * Marca texto que parece contener órdenes. Es solo una señal para la traza: el
 * contenido sigue siendo dato y nunca cambia prompts, herramientas ni límites.
 */
export function flagEmbeddedInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}
