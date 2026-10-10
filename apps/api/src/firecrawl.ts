import { RESEARCH_LIMITS } from "@thepower-rag/contracts";
import type {
  CallContext,
  Consumption,
  PageReadPort,
  PortResult,
  SearchHit,
  SearchPort,
} from "@thepower-rag/research";
import { z } from "zod";
import { sha256Hex } from "./snapshot-hash";

/**
 * Adaptador HTTP de Firecrawl v2 para buscar y leer páginas concretas.
 * Firecrawl solo busca y extrae: el grafo decide qué buscar, qué leer y cuándo
 * parar. Origen fijo, cuerpo acotado, sin reintentos y sin registrar la clave.
 * Verificado contra https://docs.firecrawl.dev/api-reference (10 oct 2026).
 */
export const FIRECRAWL_ORIGIN = "https://api.firecrawl.dev";
export const FIRECRAWL_SEARCH_URL = `${FIRECRAWL_ORIGIN}/v2/search`;
export const FIRECRAWL_SCRAPE_URL = `${FIRECRAWL_ORIGIN}/v2/scrape`;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const searchSchema = z.object({
  success: z.literal(true),
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
  creditsUsed: z.number().finite().nonnegative().optional(),
});

const text = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .nullable();

const scrapeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    markdown: z.string(),
    metadata: z
      .object({
        title: text,
        url: z.string().max(4_000).optional().nullable(),
        sourceURL: z.string().max(4_000).optional().nullable(),
        statusCode: z.number().int().optional().nullable(),
        publishedTime: z.string().optional().nullable(),
      })
      .passthrough()
      .optional(),
  }),
  creditsUsed: z.number().finite().nonnegative().optional(),
});

function failure(
  error: "timeout" | "aborted" | "provider" | "invalid" | "blocked",
  detail: string,
  consumption: Consumption,
): { ok: false; error: typeof error; detail: string; consumption: Consumption } {
  return { ok: false, error, detail, consumption };
}

/** Lee el cuerpo con un tope de bytes. Si se supera, cancela y devuelve null. */
export async function readBounded(response: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(joined);
}

async function post(
  fetchImpl: FetchLike,
  url: string,
  apiKey: string,
  body: unknown,
  context: CallContext,
  maxBytes: number,
): Promise<{ ok: true; json: unknown } | ReturnType<typeof failure>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: context.signal,
      redirect: "error",
    });
  } catch {
    return context.signal.aborted
      ? failure("aborted", "La llamada a Firecrawl se canceló.", { kind: "unknown" })
      : failure("provider", "No se pudo contactar con Firecrawl.", { kind: "unknown" });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const free = response.status === 400 || response.status === 401 || response.status === 403;
    return failure("provider", `Firecrawl respondió HTTP ${String(response.status)}.`, {
      kind: free ? "none" : "unknown",
    });
  }
  let raw: string | null;
  try {
    raw = await readBounded(response, maxBytes);
  } catch {
    return failure("provider", "La respuesta de Firecrawl se cortó.", { kind: "unknown" });
  }
  if (raw === null) {
    return failure("invalid", "La respuesta de Firecrawl supera el tope de bytes.", {
      kind: "unknown",
    });
  }
  try {
    return { ok: true, json: JSON.parse(raw) as unknown };
  } catch {
    return failure("invalid", "La respuesta de Firecrawl no es JSON.", { kind: "unknown" });
  }
}

function credits(value: number | undefined, usdPerCredit: number | null): Consumption {
  return value === undefined
    ? { kind: "unknown" }
    : {
        kind: "reported",
        credits: value,
        usd: usdPerCredit === null ? null : value * usdPerCredit,
      };
}

function providerTimeout(context: CallContext): number {
  return Math.max(1_000, context.timeoutMs - 1_000);
}

export function createFirecrawlSearch(input: {
  apiKey: string;
  usdPerCredit: number | null;
  fetch?: FetchLike;
}): SearchPort {
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  return {
    async search({ query, allowedDomains, limit }, context): Promise<PortResult<SearchHit[]>> {
      if (input.apiKey.trim().length === 0) {
        return failure("blocked", "Falta la credencial del buscador.", { kind: "none" });
      }
      const bounded = Math.min(Math.max(1, limit), RESEARCH_LIMITS.maxResultsPerSearch);
      const result = await post(
        fetchImpl,
        FIRECRAWL_SEARCH_URL,
        input.apiKey,
        {
          query: query.slice(0, RESEARCH_LIMITS.maxQueryChars),
          limit: bounded,
          includeDomains: [...allowedDomains],
          timeout: providerTimeout(context),
          ignoreInvalidURLs: true,
        },
        context,
        RESEARCH_LIMITS.maxSearchResponseBytes,
      );
      if (!result.ok) {
        return result;
      }
      const parsed = searchSchema.safeParse(result.json);
      if (!parsed.success) {
        return failure("invalid", "La búsqueda de Firecrawl no tiene la forma esperada.", {
          kind: "unknown",
        });
      }
      const hits = (parsed.data.data.web ?? []).slice(0, bounded).map((row) => ({
        url: row.url.slice(0, RESEARCH_LIMITS.maxUrlChars),
        title: (row.title ?? row.url).slice(0, RESEARCH_LIMITS.maxTitleChars),
        snippet: (row.description ?? "").slice(0, RESEARCH_LIMITS.maxExcerptChars),
      }));
      return {
        ok: true,
        value: hits,
        consumption: credits(parsed.data.creditsUsed, input.usdPerCredit),
      };
    },
  };
}

function firstText(value: string | string[] | null | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function createFirecrawlReader(input: {
  apiKey: string;
  usdPerCredit: number | null;
  fetch?: FetchLike;
  now?: () => number;
}): PageReadPort {
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  const now = input.now ?? Date.now;
  return {
    async read({ url }, context) {
      if (input.apiKey.trim().length === 0) {
        return failure("blocked", "Falta la credencial del lector.", { kind: "none" });
      }
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
      if (!result.ok) {
        return result;
      }
      const parsed = scrapeSchema.safeParse(result.json);
      if (!parsed.success) {
        return failure("invalid", "La lectura de Firecrawl no tiene la forma esperada.", {
          kind: "unknown",
        });
      }
      const consumption = credits(parsed.data.creditsUsed, input.usdPerCredit);
      const metadata = parsed.data.data.metadata;
      const status = metadata?.statusCode;
      if (typeof status === "number" && (status < 200 || status >= 300)) {
        return failure("provider", `La página respondió HTTP ${String(status)}.`, consumption);
      }
      const extracted = parsed.data.data.markdown.slice(0, RESEARCH_LIMITS.maxPageChars);
      const finalUrl = (metadata?.url ?? metadata?.sourceURL ?? url).slice(0, 4_000);
      const published = metadata?.publishedTime?.trim() ?? "";
      return {
        ok: true,
        value: {
          requestedUrl: url,
          finalUrl,
          title: firstText(metadata?.title).slice(0, RESEARCH_LIMITS.maxTitleChars),
          text: extracted,
          retrievedAt: new Date(now()).toISOString(),
          publishedAt:
            published.length > 0 && published.length <= 64 && !Number.isNaN(Date.parse(published))
              ? published
              : null,
          contentHash: `sha256:${await sha256Hex(extracted)}`,
        },
        consumption,
      };
    },
  };
}
