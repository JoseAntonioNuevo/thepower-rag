// GUÍA DE LECTURA · apps/api/src/local-crag-ports.ts
// Puertos de CRAG para la verificación local: búsqueda real contra el índice emulado y un
// evaluador y generador emulados, sin llamar a ningún proveedor y solo con reserva de presupuesto.
// Tipos de CRAG y de adaptadores.
import type { AdapterRecord, CragChunk, CragPorts, CragScope } from "@thepower-rag/core";
// Embeddings por el binding AI (emulado en local).
import { embedWithWorkersAi, type EmbeddingRunner } from "./vectors";
// Búsqueda en Vectorize y lectura de fragmentos de D1.
import { queryVectorize, readChunk, type SqlDatabase, type VectorIndex } from "./stores";

// Crea los puertos locales.
export function localEmulatedCragPorts(input: {
  // Señal de cancelación.
  signal: AbortSignal;
  // Alcance de la ejecución.
  scope: CragScope;
  // Binding de embeddings.
  embedder: EmbeddingRunner;
  // Índice vectorial.
  index: VectorIndex;
  // Base de datos.
  database: SqlDatabase;
  // Dimensiones esperadas.
  dimensions: number;
  // ¿Hay reserva?
  reservationOk(): boolean;
  // Anota el adaptador usado.
  note(adapter: AdapterRecord): void;
}): CragPorts {
  // Respuesta común cuando no hay reserva.
  const refused = {
    ok: false as const,
    reason: "No hay reserva para la operación emulada. No se llama al proveedor.",
  };
  // Puertos con la forma que espera el grafo.
  return {
    measured: false,
    now: () => Date.now(),
    signal: input.signal,
    // Reserva: según el presupuesto local.
    reserve: () => (input.reservationOk() ? { ok: true } : refused),
    // Búsqueda: embedding de la consulta y consulta al índice.
    async retrieve({ query, scope, limit, remainingMs }) {
      // Sin reserva no se busca.
      if (!input.reservationOk()) {
        // Rechazo.
        return refused;
      }
      // No se puede cambiar de perfil o versión a mitad del turno.
      if (
        scope.profileId !== input.scope.profileId ||
        scope.corpusVersion !== input.scope.corpusVersion
      ) {
        // Rechazo.
        return { ok: false, reason: "La búsqueda cambió de ámbito." };
      }
      // Sin tiempo restante.
      if (remainingMs <= 0) {
        // Rechazo.
        return { ok: false, reason: "No queda tiempo." };
      }
      // Embedding de la consulta.
      const rows = await embedWithWorkersAi(
        input.embedder,
        "@cf/baai/bge-m3",
        [query],
        input.dimensions,
        input.signal,
        remainingMs,
      );
      // Vector de la consulta.
      const vector = rows[0];
      // Sin vector.
      if (vector === undefined) {
        // Rechazo.
        return { ok: false, reason: "El embedding emulado no devolvió un vector." };
      }
      // Busca en el índice con los filtros del alcance.
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
      // Fragmentos encontrados.
      const chunks: CragChunk[] = [];
      // Lee cada fragmento de D1.
      for (const hit of hits) {
        // Fragmento por id.
        const record = await readChunk(input.database, scope.corpusVersion, hit.chunkId);
        // No existe: se salta.
        if (record === null) {
          // Siguiente.
          continue;
        }
        // Añade el fragmento con su puntuación.
        chunks.push({ ...record, profileId: scope.profileId, score: hit.score });
      }
      // Resultado de la búsqueda.
      return { ok: true, chunks, providerCall: false };
    },
    // Evaluación emulada: todos los fragmentos son útiles si hay alguno.
    async rankAndAssess({ chunks }) {
      // Sin reserva no se evalúa.
      if (!input.reservationOk()) {
        // Rechazo.
        return { ...refused, providerCall: false };
      }
      // Anota el evaluador emulado.
      input.note({ id: "local-emulated-evaluator", remote: false, binding: null });
      // Ranking con la puntuación de la búsqueda.
      const ranking = chunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        score: chunk.score ?? 0,
        reason: "Relevancia del emulador local.",
      }));
      // ¿Hay fragmentos?
      const useful = chunks.length > 0;
      // Veredicto emulado.
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
    // Reformulación emulada: añade el número de intento.
    async reformulate({ query, attempt }) {
      // Nueva consulta.
      return {
        ok: true,
        providerCall: false,
        raw: { query: `${query} intento ${String(attempt + 1)}` },
      };
    },
    // Generación emulada con citas a la evidencia.
    async generate({ evidence }) {
      // Sin reserva no se genera.
      if (!input.reservationOk()) {
        // Rechazo.
        return { ...refused, providerCall: false };
      }
      // Anota el generador emulado.
      input.note({ id: "local-emulated-generator", remote: false, binding: null });
      // Marcas de cita de la evidencia.
      const cites = evidence.map((chunk) => `[cite:${chunk.chunkId}]`).join(" ");
      // Respuesta fija con sus citas.
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
