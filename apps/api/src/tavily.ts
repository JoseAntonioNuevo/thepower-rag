import { RESEARCH_LIMITS } from "@thepower-rag/contracts";
import {
  checkUrl,
  type CallContext,
  type PageReadPort,
  type PortResult,
  type SearchPort,
} from "@thepower-rag/research";
import { z } from "zod";
import { readBounded } from "./firecrawl";
import { sha256Hex } from "./snapshot-hash";

const ORIGIN = "https://api.tavily.com";
const usage = z.object({ credits: z.number().finite().nonnegative() }).optional();
const searchResponse = z.object({
  results: z
    .array(
      z.object({ url: z.string(), title: z.string().optional(), content: z.string().optional() }),
    )
    .max(20),
  usage,
});
const extractResponse = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string() })).max(20),
  failed_results: z.array(z.unknown()).optional(),
  usage,
});
type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

function consumption(value: { credits: number } | undefined) {
  // Credits are observed usage, never a provider-reported USD amount.
  return value
    ? { kind: "reported" as const, credits: value.credits, usd: null }
    : { kind: "unknown" as const };
}

async function post(
  fetchImpl: FetchLike,
  endpoint: string,
  apiKey: string,
  body: unknown,
  context: CallContext,
  maxBytes: number,
): Promise<PortResult<unknown>> {
  if (!apiKey.trim())
    return {
      ok: false,
      error: "blocked",
      detail: "Falta TAVILY_API_KEY.",
      consumption: { kind: "none" },
    };
  try {
    const response = await fetchImpl(`${ORIGIN}/${endpoint}`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: context.signal,
      // workerd only supports follow/manual. Return redirects to the status
      // check below so an Authorization header never follows another origin.
      redirect: "manual",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
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
    const raw = await readBounded(response, maxBytes);
    if (raw === null)
      return {
        ok: false,
        error: "invalid",
        detail: "La respuesta de Tavily supera el tope de bytes.",
        consumption: { kind: "unknown" },
      };
    return { ok: true, value: JSON.parse(raw) as unknown, consumption: { kind: "unknown" } };
  } catch {
    return {
      ok: false,
      error: context.signal.aborted ? "aborted" : "provider",
      detail: "Tavily no completó la llamada. No se reintenta.",
      consumption: { kind: "unknown" },
    };
  }
}

export function createTavilySearch(input: { apiKey: string; fetch?: FetchLike }): SearchPort {
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  return {
    async search({ query, allowedDomains, limit }, context) {
      const bounded = Math.min(Math.max(1, limit), RESEARCH_LIMITS.maxResultsPerSearch);
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
      if (!result.ok) return result;
      const parsed = searchResponse.safeParse(result.value);
      if (!parsed.success)
        return {
          ok: false,
          error: "invalid",
          detail: "La búsqueda de Tavily no tiene la forma esperada.",
          consumption: { kind: "unknown" },
        };
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

export function createTavilyReader(input: {
  apiKey: string;
  allowedDomains: readonly string[];
  fetch?: FetchLike;
  now?: () => number;
}): PageReadPort {
  const fetchImpl = input.fetch ?? ((url, init) => fetch(url, init));
  const now = input.now ?? Date.now;
  return {
    async read({ url }, context) {
      if (!checkUrl(url, input.allowedDomains).ok)
        return {
          ok: false,
          error: "blocked",
          detail: "La URL está fuera de la política de investigación.",
          consumption: { kind: "none" },
        };
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
      if (!result.ok) return result;
      const parsed = extractResponse.safeParse(result.value);
      if (!parsed.success)
        return {
          ok: false,
          error: "invalid",
          detail: "La lectura de Tavily no tiene la forma esperada.",
          consumption: { kind: "unknown" },
        };
      const cost = consumption(parsed.data.usage);
      const row = parsed.data.results[0];
      if (!row || !row.raw_content.trim())
        return {
          ok: false,
          error: "provider",
          detail: "Tavily no pudo leer la página solicitada.",
          consumption: cost,
        };
      const final = checkUrl(row.url, input.allowedDomains);
      if (!final.ok)
        return {
          ok: false,
          error: "blocked",
          detail: "La URL devuelta por Tavily está fuera de la política.",
          consumption: cost,
        };
      const text = row.raw_content.slice(0, RESEARCH_LIMITS.maxPageChars);
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
