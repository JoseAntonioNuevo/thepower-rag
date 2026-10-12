// GUÍA DE LECTURA · apps/api/src/tavily.ts
// Adaptador de Tavily para la investigación: búsqueda en los dominios permitidos y lectura de páginas,
// con respuestas acotadas en bytes, sin redirecciones automáticas y sin reintentos.
// Límites de la investigación.
import { RESEARCH_LIMITS } from "@thepower-rag/contracts";
// Política de URLs y tipos de los puertos.
import {
  checkUrl,
  type CallContext,
  type PageReadPort,
  type PortResult,
  type SearchPort,
} from "@thepower-rag/research";
// Zod para validar las respuestas.
import { z } from "zod";
// Lectura acotada del cuerpo de una respuesta.
import { readBounded } from "./firecrawl";
// Huella SHA-256 del texto leído.
import { sha256Hex } from "./snapshot-hash";

// Origen de la API de Tavily.
const ORIGIN = "https://api.tavily.com";
// Créditos consumidos que informa Tavily (opcional).
const usage = z.object({ credits: z.number().finite().nonnegative() }).optional();
// Forma de una respuesta de búsqueda.
const searchResponse = z.object({
  results: z
    .array(
      z.object({ url: z.string(), title: z.string().optional(), content: z.string().optional() }),
    )
    .max(20),
  usage,
});
// Forma de una respuesta de extracción.
const extractResponse = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string() })).max(20),
  failed_results: z.array(z.unknown()).optional(),
  usage,
});
// Firma de fetch inyectable para las pruebas.
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

// Convierte los créditos informados en consumo (nunca en USD).
function consumption(value: { credits: number } | undefined) {
  // Los créditos son uso observado, nunca un importe en USD informado por el proveedor.
  return value
    ? { kind: "reported" as const, credits: value.credits, usd: null }
    : { kind: "unknown" as const };
}

// Llamada POST común a la API de Tavily.
async function post(
  fetchImpl: FetchLike,
  endpoint: string,
  apiKey: string,
  body: unknown,
  context: CallContext,
  maxBytes: number,
): Promise<PortResult<unknown>> {
  // Sin clave no se llama.
  if (!apiKey.trim())
    return {
      ok: false,
      error: "blocked",
      detail: "Falta TAVILY_API_KEY.",
      consumption: { kind: "none" },
    };
  // Errores de red se devuelven como fallo.
  try {
    // Petición con la clave en cabecera y sin seguir redirecciones.
    const response = await fetchImpl(`${ORIGIN}/${endpoint}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: context.signal,
      // workerd solo admite follow o manual. Con manual, una redirección llega a la comprobación
      // de estado de abajo y la cabecera Authorization nunca viaja a otro origen.
      redirect: "manual",
    });
    // Respuesta con error HTTP.
    if (!response.ok) {
      // Descarta el cuerpo.
      await response.body?.cancel().catch(() => undefined);
      // Fallo con el estado; 400/401/403 no consumen.
      return {
        ok: false,
        error: "provider",
        detail: `Tavily respondió HTTP ${String(response.status)}.`,
        consumption: {
          kind:
            response.status === 400 || response.status === 401 || response.status === 403
              ? "none"
              : "unknown",
        },
      };
    }
    // Cuerpo con tope de bytes.
    const raw = await readBounded(response, maxBytes);
    // Demasiado grande.
    if (raw === null)
      return {
        ok: false,
        error: "invalid",
        detail: "La respuesta de Tavily supera el tope de bytes.",
        consumption: { kind: "unknown" },
      };
    // JSON leído.
    return { ok: true, value: JSON.parse(raw) as unknown, consumption: { kind: "unknown" } };
  } catch {
    // Fallo de red o cancelación.
    return {
      ok: false,
      error: context.signal.aborted ? "aborted" : "provider",
      detail: "Tavily no completó la llamada. No se reintenta.",
      consumption: { kind: "unknown" },
    };
  }
}

// Buscador de Tavily.
export function createTavilySearch(input: { apiKey: string; fetch?: FetchLike }): SearchPort {
  // fetch real o el inyectado.
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  // Puerto de búsqueda.
  return {
    async search({ query, allowedDomains, limit }, context) {
      // Resultados pedidos entre 1 y el máximo.
      const bounded = Math.min(Math.max(1, limit), RESEARCH_LIMITS.maxResultsPerSearch);
      // Búsqueda básica limitada a los dominios permitidos.
      const result = await post(
        fetchImpl,
        "search",
        input.apiKey,
        {
          query: query.slice(0, RESEARCH_LIMITS.maxQueryChars),
          search_depth: "basic",
          auto_parameters: false,
          topic: "general",
          max_results: bounded,
          include_domains: [...allowedDomains],
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          include_usage: true,
        },
        context,
        RESEARCH_LIMITS.maxSearchResponseBytes,
      );
      // Fallo: se devuelve tal cual.
      if (!result.ok) return result;
      // Valida la respuesta.
      const parsed = searchResponse.safeParse(result.value);
      // Forma incorrecta.
      if (!parsed.success)
        return {
          ok: false,
          error: "invalid",
          detail: "La búsqueda de Tavily no tiene la forma esperada.",
          consumption: { kind: "unknown" },
        };
      // Resultados recortados a los límites.
      return {
        ok: true,
        value: parsed.data.results.slice(0, bounded).map((row) => ({
          url: row.url.slice(0, RESEARCH_LIMITS.maxUrlChars),
          title: (row.title ?? row.url).slice(0, RESEARCH_LIMITS.maxTitleChars),
          snippet: (row.content ?? "").slice(0, RESEARCH_LIMITS.maxExcerptChars),
        })),
        consumption: consumption(parsed.data.usage),
      };
    },
  };
}

// Lector de páginas de Tavily.
export function createTavilyReader(input: {
  // Clave.
  apiKey: string;
  // Dominios permitidos.
  allowedDomains: readonly string[];
  // fetch inyectable.
  fetch?: FetchLike;
  // Reloj inyectable.
  now?: () => number;
}): PageReadPort {
  // fetch real o el inyectado.
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  // Reloj real o el inyectado.
  const now = input.now ?? Date.now;
  // Puerto de lectura.
  return {
    async read({ url }, context) {
      // URL fuera de la política: no se lee.
      if (!checkUrl(url, input.allowedDomains).ok)
        return {
          ok: false,
          error: "blocked",
          detail: "La URL está fuera de la política de investigación.",
          consumption: { kind: "none" },
        };
      // Extracción en Markdown con plazo según el tiempo restante.
      const result = await post(
        fetchImpl,
        "extract",
        input.apiKey,
        {
          urls: [url],
          extract_depth: "basic",
          format: "markdown",
          include_images: false,
          include_usage: true,
          timeout: Math.max(1, Math.min(60, (context.timeoutMs - 1000) / 1000)),
        },
        context,
        RESEARCH_LIMITS.maxReadResponseBytes,
      );
      // Fallo: se devuelve.
      if (!result.ok) return result;
      // Valida la respuesta.
      const parsed = extractResponse.safeParse(result.value);
      // Forma incorrecta.
      if (!parsed.success)
        return {
          ok: false,
          error: "invalid",
          detail: "La lectura de Tavily no tiene la forma esperada.",
          consumption: { kind: "unknown" },
        };
      // Consumo informado.
      const cost = consumption(parsed.data.usage);
      // Primera página leída.
      const row = parsed.data.results[0];
      // Sin contenido.
      if (!row || !row.raw_content.trim())
        return {
          ok: false,
          error: "provider",
          detail: "Tavily no pudo leer la página solicitada.",
          consumption: cost,
        };
      // La URL final también tiene que cumplir la política.
      const final = checkUrl(row.url, input.allowedDomains);
      // Fuera de la política.
      if (!final.ok)
        return {
          ok: false,
          error: "blocked",
          detail: "La URL devuelta por Tavily está fuera de la política.",
          consumption: cost,
        };
      // Texto recortado.
      const text = row.raw_content.slice(0, RESEARCH_LIMITS.maxPageChars);
      // Página leída con su hash.
      return {
        ok: true,
        value: {
          requestedUrl: url,
          finalUrl: final.url,
          title: "",
          text,
          retrievedAt: new Date(now()).toISOString(),
          publishedAt: null,
          contentHash: `sha256:${await sha256Hex(text)}`,
        },
        consumption: cost,
      };
    },
  };
}
