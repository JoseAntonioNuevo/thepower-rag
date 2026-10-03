import type { AdapterRecord, CragChunk, CragPorts, CragScope } from "@thepower-rag/core";
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";

export function localEmulatedCragPorts(input: {
  signal: AbortSignal;
  scope: CragScope;
  embedder: EmbeddingRunner;
  index: VectorIndex;
  database: SqlDatabase;
  dimensions: number;
  reservationOk(): boolean;
  note(adapter: AdapterRecord): void;
}): CragPorts {
  const refused = {
    ok: false as const,
    reason: "No hay reserva para la operación emulada. No se llama al proveedor.",
  };
  return {
    measured: false,
    now: () => Date.now(),
    signal: input.signal,
    reserve: () => (input.reservationOk() ? { ok: true } : refused),
    async retrieve({ query, scope, limit, remainingMs }) {
      if (!input.reservationOk()) {
        return refused;
      }
      if (
        scope.profileId !== input.scope.profileId ||
        scope.corpusVersion !== input.scope.corpusVersion
      ) {
        return { ok: false, reason: "La búsqueda cambió de ámbito." };
      }
      if (remainingMs <= 0) {
        return { ok: false, reason: "No queda tiempo." };
      }
      const rows = await embedWithWorkersAi(
        input.embedder,
        "@cf/baai/bge-m3",
        [query],
        input.dimensions,
        input.signal,
        remainingMs,
      );
      const vector = rows[0];
      if (vector === undefined) {
        return { ok: false, reason: "El embedding emulado no devolvió un vector." };
      }
      const hits = await queryVectorize(
        input.index,
        {
          vector,
          audience: scope.audience,
          corpusVersion: scope.corpusVersion,
          profileId: scope.profileId,
          limit,
        },
        input.signal,
        remainingMs,
      );
      const chunks: CragChunk[] = [];
      for (const hit of hits) {
        const record = await readChunk(input.database, scope.corpusVersion, hit.chunkId);
        if (record === null) {
          continue;
        }
        chunks.push({ ...record, profileId: scope.profileId, score: hit.score });
      }
      return { ok: true, chunks, providerCall: false };
    },
    async rankAndAssess({ chunks }) {
      if (!input.reservationOk()) {
        return { ...refused, providerCall: false };
      }
      input.note({ id: "local-emulated-evaluator", remote: false, binding: null });
      const ranking = chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        score: chunk.score ?? 0,
        reason: "Relevancia del emulador local.",
      }));
      const useful = chunks.length > 0;
      return {
        ok: true,
        providerCall: false,
        raw: {
          ranking,
          status: useful ? "sufficient" : "insufficient",
          reason: useful ? "Hay texto utilizable en el corpus local." : "No hay fragmentos.",
          gaps: [],
          usefulIds: useful ? chunks.slice(0, 6).map((chunk) => chunk.chunkId) : [],
        },
      };
    },
    async reformulate({ query, attempt }) {
      return {
        ok: true,
        providerCall: false,
        raw: { query: `${query} intento ${String(attempt + 1)}` },
      };
    },
    async generate({ evidence }) {
      if (!input.reservationOk()) {
        return { ...refused, providerCall: false };
      }
      input.note({ id: "local-emulated-generator", remote: false, binding: null });
      const cites = evidence.map((chunk) => `[cite:${chunk.chunkId}]`).join(" ");
      return {
        ok: true,
        text: `Respuesta de verificación local. ${cites}`.trim(),
        providerCall: false,
        usage: null,
        cost: null,
      };
    },
  };
}
