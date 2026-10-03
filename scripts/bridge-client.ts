import type { AdapterRecord, CorpusManifest } from "@thepower-rag/core";
import { loopbackFetch } from "./loopback-fetch";
import type { CourseDataPlane, ManagementReceipt } from "./course-runtime";

interface BridgeResponse {
  ok?: boolean;
  vectors?: number[][];
  providerRevision?: string | null;
  adapter?: AdapterRecord;
  phase?: string;
  upserts?: number;
  profileId?: string;
  activeId?: string | null;
  summary?: string;
  reason?: string;
  metric?: string | null;
  dimensions?: number | null;
  name?: string | null;
  metadataIndexes?: string[];
  adapters?: AdapterRecord[];
}

async function post(
  origin: string,
  token: string,
  body: unknown,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<BridgeResponse> {
  const response = await fetchImpl(`${origin}/bridge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-thepower-bridge": token,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload: BridgeResponse;
  try {
    payload = JSON.parse(text) as BridgeResponse;
  } catch {
    throw new Error(
      `El puente respondió ${String(response.status)} sin JSON: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(
      payload.reason ?? payload.summary ?? `El puente rechazó la operación: ${text.slice(0, 500)}`,
    );
  }
  return payload;
}

export async function createBridgePlane(input: {
  origin: string;
  token: string;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<CourseDataPlane> {
  const fetchImpl = input.fetchImpl ?? loopbackFetch;
  const ready = await fetchImpl(`${input.origin}/bridge/ready`, {
    headers: { "x-thepower-bridge": input.token },
  });
  const readyBody = (await ready.json()) as BridgeResponse;
  const adapters = readyBody.adapters ?? [];
  let management: ManagementReceipt = {
    metric: null,
    dimensions: null,
    name: null,
    metadataIndexes: [],
  };
  if (
    adapters.some(
      (item) => item.id === "local-emulated-vectorize" || item.id === "vectorize-binding",
    )
  ) {
    const described = await post(input.origin, input.token, { op: "describe" }, fetchImpl);
    management = {
      metric: described.metric ?? null,
      dimensions: described.dimensions ?? null,
      name: described.name ?? null,
      metadataIndexes: described.metadataIndexes ?? [],
    };
  }
  return {
    management,
    adapters: () => adapters,
    async embed(texts, reservationId) {
      const result = await post(
        input.origin,
        input.token,
        { op: "embed", texts, reservationId },
        fetchImpl,
      );
      if (result.adapter === undefined || result.vectors === undefined) {
        throw new Error("El puente no devolvió el adaptador o los vectores.");
      }
      return {
        vectors: result.vectors,
        providerRevision: result.providerRevision ?? null,
        adapter: result.adapter,
      };
    },
    async ingest(request: { manifest: CorpusManifest; vectors: number[][] }) {
      const result = await post(
        input.origin,
        input.token,
        {
          op: "ingest",
          vectors: request.vectors,
          documents: request.manifest.documents.map((document) => ({
            id: document.id,
            body: document.body,
          })),
        },
        fetchImpl,
      );
      if (
        result.adapter === undefined ||
        result.phase === undefined ||
        result.profileId === undefined
      ) {
        throw new Error("El puente no devolvió la ingesta.");
      }
      return {
        phase: result.phase,
        upserts: result.upserts ?? 0,
        profileId: result.profileId,
        adapter: result.adapter,
      };
    },
    async selectActive(profileId) {
      const result = await post(
        input.origin,
        input.token,
        { op: "select-active", profileId },
        fetchImpl,
      );
      return {
        ok: result.ok === true,
        summary: result.summary ?? "La selección no trajo un resumen.",
        activeId: result.activeId ?? null,
        adapter: result.adapter ?? { id: "native-d1", remote: false, binding: "DB" },
      };
    },
  };
}
