// GUÍA DE LECTURA · scripts/bridge-client.ts
// Cliente del Worker puente: convierte las operaciones del plano de datos (describe, embed, ingest y
// select-active) en peticiones POST a /bridge con la ficha compartida.
// Tipos de adaptador y manifiesto.
import type { AdapterRecord, CorpusManifest } from "@thepower-rag/core";
// fetch a 127.0.0.1.
import { loopbackFetch } from "./loopback-fetch";
// Tipos del plano de datos y de la API de gestión.
import type { CourseDataPlane, ManagementReceipt } from "./course-runtime";

// Respuesta posible del puente.
interface BridgeResponse {
  // Correcta.
  ok?: boolean;
  // Vectores.
  vectors?: number[][];
  // Revisión del proveedor.
  providerRevision?: string | null;
  // Adaptador usado.
  adapter?: AdapterRecord;
  // Fase de la ingesta.
  phase?: string;
  // Escrituras.
  upserts?: number;
  // Perfil.
  profileId?: string;
  // Perfil activo.
  activeId?: string | null;
  // Resumen.
  summary?: string;
  // Motivo de un error.
  reason?: string;
  // Métrica.
  metric?: string | null;
  // Dimensiones.
  dimensions?: number | null;
  // Nombre del índice.
  name?: string | null;
  // Índices de metadatos.
  metadataIndexes?: string[];
  // Adaptadores configurados.
  adapters?: AdapterRecord[];
}

// Envía una operación al puente y devuelve su respuesta o lanza su error.
async function post(
  origin: string,
  token: string,
  body: unknown,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<BridgeResponse> {
  // POST /bridge con la ficha.
  const response = await fetchImpl(`${origin}/bridge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-thepower-bridge": token,
    },
    body: JSON.stringify(body),
  });
  // Texto.
  const text = await response.text();
  // JSON.
  let payload: BridgeResponse;
  // Parseo protegido.
  try {
    // JSON.
    payload = JSON.parse(text) as BridgeResponse;
  } catch {
    // No es JSON.
    throw new Error(
      `El puente respondió ${String(response.status)} sin JSON: ${text.slice(0, 400)}`,
    );
  }
  // Error HTTP o ok=false.
  if (!response.ok || payload.ok === false) {
    // Error con el motivo.
    throw new Error(
      payload.reason ?? payload.summary ?? `El puente rechazó la operación: ${text.slice(0, 500)}`,
    );
  }
  // Respuesta.
  return payload;
}

// Crea el plano de datos que usa el puente.
export async function createBridgePlane(input: {
  // Origen del puente.
  origin: string;
  // Ficha.
  token: string;
  // fetch alternativo.
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}): Promise<CourseDataPlane> {
  // fetch indicado o el de loopback.
  const fetchImpl = input.fetchImpl ?? loopbackFetch;
  // Comprueba que el puente está listo.
  const ready = await fetchImpl(`${input.origin}/bridge/ready`, {
    headers: { "x-thepower-bridge": input.token },
  });
  // Respuesta.
  const readyBody = (await ready.json()) as BridgeResponse;
  // Adaptadores configurados.
  const adapters = readyBody.adapters ?? [];
  // Datos del índice, vacíos hasta describirlo.
  let management: ManagementReceipt = {
    metric: null,
    dimensions: null,
    name: null,
    metadataIndexes: [],
  };
  // Si hay un Vectorize (real o emulado).
  if (
    adapters.some(
      (item) => item.id === "local-emulated-vectorize" || item.id === "vectorize-binding",
    )
  ) {
    // Lo describe.
    const described = await post(input.origin, input.token, { op: "describe" }, fetchImpl);
    // Datos del índice.
    management = {
      metric: described.metric ?? null,
      dimensions: described.dimensions ?? null,
      name: described.name ?? null,
      metadataIndexes: described.metadataIndexes ?? [],
    };
  }
  // Plano de datos.
  return {
    management,
    adapters: () => adapters,
    async embed(texts, reservationId) {
      // Embeddings.
      const result = await post(
        input.origin,
        input.token,
        { op: "embed", texts, reservationId },
        fetchImpl,
      );
      // Falta algo.
      if (result.adapter === undefined || result.vectors === undefined) {
        // Error.
        throw new Error("El puente no devolvió el adaptador o los vectores.");
      }
      // Vectores con su adaptador.
      return {
        vectors: result.vectors,
        providerRevision: result.providerRevision ?? null,
        adapter: result.adapter,
      };
    },
    async ingest(request: { manifest: CorpusManifest; vectors: number[][] }) {
      // Ingesta con los textos de los documentos.
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
      // Falta algo.
      if (
        result.adapter === undefined ||
        result.phase === undefined ||
        result.profileId === undefined
      ) {
        // Error.
        throw new Error("El puente no devolvió la ingesta.");
      }
      // Resultado.
      return {
        phase: result.phase,
        upserts: result.upserts ?? 0,
        profileId: result.profileId,
        adapter: result.adapter,
      };
    },
    async selectActive(profileId) {
      // Selección del perfil activo.
      const result = await post(
        input.origin,
        input.token,
        { op: "select-active", profileId },
        fetchImpl,
      );
      // Resultado.
      return {
        ok: result.ok === true,
        summary: result.summary ?? "La selección no trajo un resumen.",
        activeId: result.activeId ?? null,
        adapter: result.adapter ?? { id: "native-d1", remote: false, binding: "DB" },
      };
    },
  };
}
