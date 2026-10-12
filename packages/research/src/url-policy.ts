// GUÍA DE LECTURA · packages/research/src/url-policy.ts
// Política de URLs de la investigación: dominios permitidos, solo https sin credenciales ni
// puertos, forma canónica para deduplicar y detección de texto que intenta dar órdenes al modelo.
// Dominios por defecto y límites de la investigación.
import { DEFAULT_RESEARCH_DOMAINS, RESEARCH_LIMITS } from "@thepower-rag/contracts";
// Huella FNV-1a para los ids de las páginas.
import { fnv1a64 } from "@thepower-rag/core";

// Nombre de host válido: etiquetas separadas por puntos y un dominio de primer nivel.
const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Lee la lista de dominios permitidos. Sin valor usa la lista oficial por
 * defecto. Un valor con una entrada inválida no se acepta a medias.
 */
export function parseAllowedDomains(
  value: string | undefined,
): { ok: true; domains: string[] } | { ok: false; reason: string } {
  // Sin valor: la lista oficial por defecto.
  if (value === undefined || value.trim().length === 0) {
    // Copia de la lista por defecto.
    return { ok: true, domains: [...DEFAULT_RESEARCH_DOMAINS] };
  }
  // Dominios validados.
  const domains: string[] = [];
  // Recorre la lista separada por comas.
  for (const raw of value.split(",")) {
    // Sin espacios y en minúsculas.
    const domain = raw.trim().toLowerCase();
    // Un dominio inválido invalida toda la lista.
    if (!HOSTNAME.test(domain)) {
      // Rechazo.
      return { ok: false, reason: "RESEARCH_ALLOWED_DOMAINS contiene un dominio inválido." };
    }
    // Sin repetidos.
    if (!domains.includes(domain)) {
      // Añade el dominio.
      domains.push(domain);
    }
  }
  // Entre 1 y 10 dominios.
  if (domains.length === 0 || domains.length > 10) {
    // Rechazo.
    return { ok: false, reason: "RESEARCH_ALLOWED_DOMAINS necesita de 1 a 10 dominios." };
  }
  // Lista válida.
  return { ok: true, domains };
}

// Veredicto sobre una URL: aceptada con su forma canónica o rechazada con el motivo.
export type UrlVerdict =
  | { ok: true; url: string; domain: string }
  | { ok: false; reason: string; domain: string };

/**
 * Política de URL: https, sin credenciales, puerto por defecto y dominio
 * exacto de la lista. Se aplica a los resultados de búsqueda y también a la URL
 * final que devuelve el lector tras redirecciones.
 */
export function checkUrl(raw: string, allowed: readonly string[]): UrlVerdict {
  // Vacía o demasiado larga.
  if (raw.length === 0 || raw.length > RESEARCH_LIMITS.maxUrlChars) {
    // Rechazo.
    return { ok: false, reason: "URL vacía o demasiado larga.", domain: "" };
  }
  // URL analizada.
  let parsed: URL;
  // new URL lanza un error si el texto no es una URL.
  try {
    // Analiza el texto.
    parsed = new URL(raw);
  } catch {
    // URL inválida.
    return { ok: false, reason: "URL inválida.", domain: "" };
  }
  // Dominio en minúsculas.
  const domain = parsed.hostname.toLowerCase();
  // Solo https.
  if (parsed.protocol !== "https:") {
    // Rechazo.
    return { ok: false, reason: "Solo se leen URL https.", domain };
  }
  // Sin usuario ni contraseña en la URL.
  if (parsed.username !== "" || parsed.password !== "") {
    // Rechazo.
    return { ok: false, reason: "La URL lleva credenciales.", domain };
  }
  // Sin puerto explícito.
  if (parsed.port !== "") {
    // Rechazo.
    return { ok: false, reason: "La URL usa un puerto no estándar.", domain };
  }
  // El dominio tiene que estar exactamente en la lista.
  if (!allowed.includes(domain)) {
    // Rechazo.
    return { ok: false, reason: "Dominio fuera de la lista permitida.", domain };
  }
  // Aceptada en forma canónica.
  return { ok: true, url: normalizeUrl(parsed), domain };
}

/** Forma canónica para deduplicar: sin fragmento y sin barra final redundante. */
export function normalizeUrl(input: URL | string): string {
  // Copia la URL para no modificar la original.
  const url = typeof input === "string" ? new URL(input) : new URL(input.href);
  // Quita el fragmento (#…).
  url.hash = "";
  // Dominio en minúsculas.
  url.hostname = url.hostname.toLowerCase();
  // Quita las barras finales salvo la raíz.
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    // Sin barras al final.
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  // URL canónica.
  return url.href;
}

/** Id estable de una página leída, derivado de su URL final canónica. */
export function webSourceId(finalUrl: string): string {
  // «web-» y 12 caracteres de la huella de la URL canónica.
  return `web-${fnv1a64(normalizeUrl(finalUrl)).slice(0, 12)}`;
}

// Frases típicas de inyección de instrucciones, en inglés y en español.
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
  // true si alguna frase aparece en el texto.
  return INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text));
}
