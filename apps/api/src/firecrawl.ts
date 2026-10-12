// GUÍA DE LECTURA · apps/api/src/firecrawl.ts
// Cliente HTTP de Firecrawl para la investigación: buscar en dominios permitidos y leer una página.
// Valida la respuesta con Zod, limita los bytes leídos y traduce los créditos a consumo.
// Límites de la investigación.
import { RESEARCH_LIMITS } from "@thepower-rag/contracts";
// Tipos de los puertos de búsqueda y lectura.
import type {
  CallContext,
  Consumption,
  PageReadPort,
  PortResult,
  SearchHit,
  SearchPort,
} from "@thepower-rag/research";
// Zod valida la forma de las respuestas.
import { z } from "zod";
// Hash SHA-256 en hexadecimal.
import { sha256Hex } from "./snapshot-hash";

/**
 * Adaptador HTTP de Firecrawl v2 para buscar y leer páginas concretas.
 * Firecrawl solo busca y extrae: el grafo decide qué buscar, qué leer y cuándo
 * parar. Origen fijo, cuerpo acotado, sin reintentos y sin registrar la clave.
 * Verificado contra https://docs.firecrawl.dev/api-reference (10 oct 2026).
 */
export const FIRECRAWL_ORIGIN = "https://api.firecrawl.dev";
// Endpoint de búsqueda.
export const FIRECRAWL_SEARCH_URL = `${FIRECRAWL_ORIGIN}/v2/search`;
// Endpoint de lectura (scrape).
export const FIRECRAWL_SCRAPE_URL = `${FIRECRAWL_ORIGIN}/v2/scrape`;

// Firma mínima de fetch; los tests pasan una simulada.
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Forma esperada de la respuesta de búsqueda: resultados web y créditos usados.
const searchSchema = z.object({
  // success debe ser true.
  success: z.literal(true),
  // Resultados web: URL, título y descripción opcionales, como mucho 100.
  data: z.object({
    web: z
      .array(
        z.object({
          url: z.string().min(1).max(4_000),
          title: z.string().max(2_000).optional().nullable(),
          description: z.string().max(4_000).optional().nullable(),
        }),
      )
      .max(100)
      .optional(),
  }),
  // Créditos usados, si el proveedor los informa.
  creditsUsed: z.number().finite().nonnegative().optional(),
});

// Texto o lista de textos (Firecrawl devuelve ambos en el título).
const text = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .nullable();

// Forma esperada de la lectura: markdown, metadatos y créditos.
const scrapeSchema = z.object({
  // success debe ser true.
  success: z.literal(true),
  // Texto en Markdown y metadatos de la página.
  data: z.object({
    markdown: z.string(),
    metadata: z
      .object({
        // Título, URL final, URL de origen, código HTTP y fecha de publicación.
        title: text,
        url: z.string().max(4_000).optional().nullable(),
        sourceURL: z.string().max(4_000).optional().nullable(),
        statusCode: z.number().int().optional().nullable(),
        publishedTime: z.string().optional().nullable(),
      })
      // passthrough deja pasar otros metadatos sin fallar.
      .passthrough()
      .optional(),
  }),
  // Créditos usados.
  creditsUsed: z.number().finite().nonnegative().optional(),
});

// Construye un resultado de error tipado.
function failure(
  error: "timeout" | "aborted" | "provider" | "invalid" | "blocked",
  detail: string,
  consumption: Consumption,
): { ok: false; error: typeof error; detail: string; consumption: Consumption } {
  // Objeto de fallo.
  return { ok: false, error, detail, consumption };
}

/** Lee el cuerpo con un tope de bytes. Si se supera, cancela y devuelve null. */
export async function readBounded(response: Response, maxBytes: number): Promise<string | null> {
  // Tamaño declarado en la cabecera content-length.
  const declared = Number(response.headers.get("content-length"));
  // Si declara más del tope, ni se lee.
  if (Number.isFinite(declared) && declared > maxBytes) {
    // Cancela el cuerpo.
    await response.body?.cancel().catch(() => undefined);
    // null.
    return null;
  }
  // Sin cuerpo: texto vacío.
  if (response.body === null) {
    // Vacío.
    return "";
  }
  // Lector del cuerpo en streaming.
  const reader = response.body.getReader();
  // Trozos leídos.
  const chunks: Uint8Array[] = [];
  // Bytes acumulados.
  let total = 0;
  // Lee hasta el final.
  for (;;) {
    // Siguiente trozo.
    const { done, value } = await reader.read();
    // Fin del cuerpo.
    if (done) {
      // Sale del bucle.
      break;
    }
    // Suma bytes.
    total += value.byteLength;
    // Si supera el tope.
    if (total > maxBytes) {
      // Cancela la lectura.
      await reader.cancel().catch(() => undefined);
      // null.
      return null;
    }
    // Guarda el trozo.
    chunks.push(value);
  }
  // Une todos los trozos en un solo array.
  const joined = new Uint8Array(total);
  // Posición de escritura.
  let offset = 0;
  // Para cada trozo.
  for (const chunk of chunks) {
    // Lo copia en su posición.
    joined.set(chunk, offset);
    // Avanza.
    offset += chunk.byteLength;
  }
  // Decodifica UTF-8.
  return new TextDecoder().decode(joined);
}

// POST JSON a Firecrawl con clave, sin redirecciones y con tope de bytes.
async function post(
  fetchImpl: FetchLike,
  url: string,
  apiKey: string,
  body: unknown,
  context: CallContext,
  maxBytes: number,
): Promise<{ ok: true; json: unknown } | ReturnType<typeof failure>> {
  // Respuesta HTTP.
  let response: Response;
  // try/catch: un fallo de red se convierte en error tipado.
  try {
    // Llamada HTTP.
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: context.signal,
      // workerd rechaza redirect: "error" antes de enviar. "manual" mantiene la regla de no seguir
      // redirecciones: una respuesta 3xx falla en la comprobación de estado de abajo.
      redirect: "manual",
    });
  } catch {
    // Cancelada o sin conexión; el cargo queda desconocido.
    return context.signal.aborted
      ? failure("aborted", "La llamada a Firecrawl se canceló.", { kind: "unknown" })
      : failure("provider", "No se pudo contactar con Firecrawl.", { kind: "unknown" });
  }
  // HTTP de error.
  if (!response.ok) {
    // Descarta el cuerpo.
    await response.body?.cancel().catch(() => undefined);
    // 400, 401 y 403 no cobran; el resto se trata como desconocido.
    const free = response.status === 400 || response.status === 401 || response.status === 403;
    // Error con el estado HTTP.
    return failure("provider", `Firecrawl respondió HTTP ${String(response.status)}.`, {
      kind: free ? "none" : "unknown",
    });
  }
  // Cuerpo leído o null.
  let raw: string | null;
  // Lectura protegida.
  try {
    // Lee con tope.
    raw = await readBounded(response, maxBytes);
  } catch {
    // Cuerpo cortado.
    return failure("provider", "La respuesta de Firecrawl se cortó.", { kind: "unknown" });
  }
  // Supera el tope.
  if (raw === null) {
    // Error de tamaño.
    return failure("invalid", "La respuesta de Firecrawl supera el tope de bytes.", {
      kind: "unknown",
    });
  }
  // Parseo protegido.
  try {
    // JSON parseado.
    return { ok: true, json: JSON.parse(raw) as unknown };
  } catch {
    // No es JSON.
    return failure("invalid", "La respuesta de Firecrawl no es JSON.", { kind: "unknown" });
  }
}

// Consumo a partir de los créditos: sin dato, desconocido; con tarifa, también en USD.
function credits(value: number | undefined, usdPerCredit: number | null): Consumption {
  // Desconocido o informado.
  return value === undefined
    ? { kind: "unknown" }
    : {
        kind: "reported",
        credits: value,
        usd: usdPerCredit === null ? null : value * usdPerCredit,
      };
}

// Plazo que se pide al proveedor: 1 segundo menos que el nuestro, mínimo 1 segundo.
function providerTimeout(context: CallContext): number {
  // Milisegundos.
  return Math.max(1_000, context.timeoutMs - 1_000);
}

// Crea el puerto de búsqueda de Firecrawl.
export function createFirecrawlSearch(input: {
  // Clave de Firecrawl.
  apiKey: string;
  // USD por crédito; null si no se conoce.
  usdPerCredit: number | null;
  // fetch alternativo para tests.
  fetch?: FetchLike;
}): SearchPort {
  // fetch indicado o el global.
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  // Puerto con el método search.
  return {
    async search({ query, allowedDomains, limit }, context): Promise<PortResult<SearchHit[]>> {
      // Sin clave no se llama.
      if (input.apiKey.trim().length === 0) {
        // Bloqueado, sin consumo.
        return failure("blocked", "Falta la credencial del buscador.", { kind: "none" });
      }
      // Número de resultados entre 1 y el máximo.
      const bounded = Math.min(Math.max(1, limit), RESEARCH_LIMITS.maxResultsPerSearch);
      // Busca solo en los dominios permitidos.
      const result = await post(
        fetchImpl,
        FIRECRAWL_SEARCH_URL,
        input.apiKey,
        {
          // Consulta recortada, número de resultados y dominios permitidos.
          query: query.slice(0, RESEARCH_LIMITS.maxQueryChars),
          limit: bounded,
          includeDomains: [...allowedDomains],
          // Plazo del proveedor e ignorar URL inválidas.
          timeout: providerTimeout(context),
          ignoreInvalidURLs: true,
        },
        // Señal y tope de bytes.
        context,
        RESEARCH_LIMITS.maxSearchResponseBytes,
      );
      // Error de red o HTTP.
      if (!result.ok) {
        // Se devuelve tal cual.
        return result;
      }
      // Valida la forma.
      const parsed = searchSchema.safeParse(result.json);
      // Forma inesperada.
      if (!parsed.success) {
        // Error invalid.
        return failure("invalid", "La búsqueda de Firecrawl no tiene la forma esperada.", {
          kind: "unknown",
        });
      }
      // Resultados recortados: URL, título y extracto.
      const hits = (parsed.data.data.web ?? []).slice(0, bounded).map((row) => ({
        url: row.url.slice(0, RESEARCH_LIMITS.maxUrlChars),
        title: (row.title ?? row.url).slice(0, RESEARCH_LIMITS.maxTitleChars),
        snippet: (row.description ?? "").slice(0, RESEARCH_LIMITS.maxExcerptChars),
      }));
      // Resultados con su consumo.
      return {
        ok: true,
        value: hits,
        consumption: credits(parsed.data.creditsUsed, input.usdPerCredit),
      };
    },
  };
}

// Primer texto de un valor que puede ser lista.
function firstText(value: string | string[] | null | undefined): string {
  // Primer elemento o el propio texto, sin espacios.
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

// Crea el puerto de lectura de Firecrawl.
export function createFirecrawlReader(input: {
  // Clave de Firecrawl.
  apiKey: string;
  // USD por crédito.
  usdPerCredit: number | null;
  // fetch alternativo.
  fetch?: FetchLike;
  // Reloj alternativo para tests.
  now?: () => number;
}): PageReadPort {
  // fetch indicado o el global.
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  // Reloj indicado o Date.now.
  const now = input.now ?? Date.now;
  // Puerto con el método read.
  return {
    async read({ url }, context) {
      // Sin clave no se llama.
      if (input.apiKey.trim().length === 0) {
        // Bloqueado.
        return failure("blocked", "Falta la credencial del lector.", { kind: "none" });
      }
      // Pide el markdown del contenido principal.
      const result = await post(
        fetchImpl,
        FIRECRAWL_SCRAPE_URL,
        input.apiKey,
        {
          url,
          formats: [{ type: "markdown" }],
          onlyMainContent: true,
          timeout: providerTimeout(context),
          // `auto` reintenta con proxies mejorados: sería un reintento oculto.
          proxy: "basic",
          blockAds: true,
          removeBase64Images: true,
        },
        context,
        RESEARCH_LIMITS.maxReadResponseBytes,
      );
      // Error de red o HTTP.
      if (!result.ok) {
        // Tal cual.
        return result;
      }
      // Valida la forma.
      const parsed = scrapeSchema.safeParse(result.json);
      // Forma inesperada.
      if (!parsed.success) {
        // Error invalid.
        return failure("invalid", "La lectura de Firecrawl no tiene la forma esperada.", {
          kind: "unknown",
        });
      }
      // Consumo de la lectura.
      const consumption = credits(parsed.data.creditsUsed, input.usdPerCredit);
      // Metadatos de la página.
      const metadata = parsed.data.data.metadata;
      // Estado HTTP de la página leída.
      const status = metadata?.statusCode;
      // Página con error HTTP.
      if (typeof status === "number" && (status < 200 || status >= 300)) {
        // Error de proveedor con su consumo.
        return failure("provider", `La página respondió HTTP ${String(status)}.`, consumption);
      }
      // Texto recortado al máximo.
      const extracted = parsed.data.data.markdown.slice(0, RESEARCH_LIMITS.maxPageChars);
      // URL final tras redirecciones; el grafo comprobará si está permitida.
      const finalUrl = (metadata?.url ?? metadata?.sourceURL ?? url).slice(0, 4_000);
      // Fecha de publicación, si la hay.
      const published = metadata?.publishedTime?.trim() ?? "";
      // Página leída con título, texto, fechas y hash del contenido.
      return {
        // Página leída: URL pedida y final, título y texto.
        ok: true,
        value: {
          requestedUrl: url,
          finalUrl,
          title: firstText(metadata?.title).slice(0, RESEARCH_LIMITS.maxTitleChars),
          text: extracted,
          // Fecha de lectura y de publicación solo si es una fecha válida y corta.
          retrievedAt: new Date(now()).toISOString(),
          publishedAt:
            published.length > 0 && published.length <= 64 && !Number.isNaN(Date.parse(published))
              ? published
              : null,
          // Hash del texto y créditos consumidos.
          contentHash: `sha256:${await sha256Hex(extracted)}`,
        },
        consumption,
      };
    },
  };
}
