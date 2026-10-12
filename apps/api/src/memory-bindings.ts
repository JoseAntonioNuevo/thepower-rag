// GUÍA DE LECTURA · apps/api/src/memory-bindings.ts
// Dobles en memoria de D1, R2 y Vectorize para probar la ingesta sin Cloudflare: interpretan las
// consultas SQL que usa ingest-run y simulan la visibilidad tardía de los vectores.
// Índices de metadatos y selección de perfil activo.
import {
  VECTORIZE_METADATA_INDEXES,
  applyActiveSelection,
  type CorpusManifest,
} from "@thepower-rag/core";
// Ingesta con bindings y su diario.
import { loadBoundJournal, runBoundIngestion, type IngestBindings } from "./ingest-run";

// Fila genérica.
type Row = Record<string, unknown>;

// Tablas simuladas.
interface MemoryTables {
  // Versiones del corpus.
  corpus_versions: Row[];
  // Documentos.
  documents: Row[];
  // Fragmentos.
  chunks: Row[];
  // Mapa vector-fragmento.
  vector_map: Row[];
  // Perfiles de índice.
  index_profiles: Row[];
  // Elementos ingeridos.
  ingest_items: Row[];
}

// Inserta o actualiza una fila según sus claves.
function replace(rows: Row[], keys: string[], next: Row): void {
  // Posición de la fila con las mismas claves.
  const index = rows.findIndex((row) => keys.every((key) => row[key] === next[key]));
  // No existe.
  if (index === -1) {
    // Se añade.
    rows.push(next);
    // Fin.
    return;
  }
  // Existe: se mezcla.
  rows[index] = { ...rows[index], ...next };
}

// Bindings simulados con tablas y contadores.
export interface MemoryBindings extends IngestBindings {
  // Tablas.
  tables: MemoryTables;
  // Escrituras en Vectorize.
  upserts: number;
  // Lecturas de Vectorize.
  reads: number;
}

// Crea los bindings simulados.
export function createMemoryBindings(input?: {
  // Dimensiones que informa describe.
  dimensions?: number;
  // Índices de metadatos.
  metadataIndexes?: readonly string[];
  // Lecturas necesarias antes de ver los vectores.
  visibleAfterReads?: number;
}): MemoryBindings {
  // Tablas vacías.
  const tables: MemoryTables = {
    corpus_versions: [],
    documents: [],
    chunks: [],
    vector_map: [],
    index_profiles: [],
    ingest_items: [],
  };
  // Vectores guardados.
  const vectors = new Map<string, { values: number[]; metadata?: Record<string, unknown> }>();
  // Índices de metadatos.
  const metadataIndexes = [...(input?.metadataIndexes ?? VECTORIZE_METADATA_INDEXES)];
  // Lecturas hasta la visibilidad.
  const visibleAfterReads = input?.visibleAfterReads ?? 1;
  // Contador de escrituras.
  let upserts = 0;
  // Contador de lecturas.
  let reads = 0;
  // Número de mutación.
  let mutation = 0;
  // Objetos de R2.
  const objects = new Map<string, string>();

  // Aplica una escritura SQL según su texto.
  const apply = (sql: string, values: readonly unknown[]) => {
    // Versión del corpus.
    if (sql.includes("INSERT INTO corpus_versions")) {
      // Inserta o actualiza.
      replace(tables.corpus_versions, ["id"], {
        id: values[0],
        embedding_model: values[1],
        dimensions: values[2],
        remote_revision: values[3],
        status: "catalog",
      });
      // Fin.
      return;
    }
    // Perfil de índice.
    if (sql.includes("INSERT INTO index_profiles")) {
      // Perfil existente.
      const existing = tables.index_profiles.find((row) => row.id === values[0]);
      // Inserta o actualiza conservando el estado del activo.
      replace(tables.index_profiles, ["id"], {
        id: values[0],
        corpus_version: values[1],
        embedding_model: values[2],
        dimensions: values[3],
        metric: values[4],
        chunk_max_chars: values[5],
        chunk_overlap: values[6],
        provider_revision: values[7],
        family: values[8],
        status: existing?.active === 1 ? existing.status : "partial",
        expected_vectors: values[9],
        visible_vectors: existing?.visible_vectors ?? null,
        mutation_id: existing?.mutation_id ?? null,
        last_error: existing?.last_error ?? null,
        active: existing?.active ?? 0,
      });
      // Fin.
      return;
    }
    // Documento.
    if (sql.includes("INSERT INTO documents")) {
      // Inserta o actualiza.
      replace(tables.documents, ["version_id", "document_id"], {
        version_id: values[0],
        document_id: values[1],
        title: values[2],
        audience: values[3],
        source_hash: values[4],
      });
      // Fin.
      return;
    }
    // Fragmento.
    if (sql.includes("INSERT INTO chunks")) {
      // Inserta o actualiza.
      replace(tables.chunks, ["version_id", "chunk_id"], {
        version_id: values[0],
        chunk_id: values[1],
        document_id: values[2],
        section: values[3],
        text: values[4],
        ordinal: values[5],
      });
      // Fin.
      return;
    }
    // Vector.
    if (sql.includes("INSERT INTO vector_map")) {
      // Inserta o actualiza.
      replace(tables.vector_map, ["profile_id", "vector_id"], {
        profile_id: values[0],
        vector_id: values[1],
        chunk_id: values[2],
      });
      // Fin.
      return;
    }
    // Elemento ingerido.
    if (sql.includes("INSERT INTO ingest_items")) {
      // Inserta o actualiza.
      replace(tables.ingest_items, ["corpus_version", "profile_id", "store", "item_key"], {
        corpus_version: values[0],
        profile_id: values[1],
        store: values[2],
        item_key: values[3],
        ok: values[4],
        error: values[5],
        outcome: values[6],
        mutation_id: values[7],
      });
      // Fin.
      return;
    }
    // Cambio de fase del perfil.
    if (sql.includes("UPDATE index_profiles")) {
      // Fase.
      const phase = values[0];
      // Id del perfil.
      const id = values[6];
      // Perfil no activo.
      const row = tables.index_profiles.find((item) => item.id === id && item.active !== 1);
      // No existe o está activo.
      if (row === undefined) {
        // Fin.
        return;
      }
      // Nueva fase.
      row.status = phase;
      // Mutación.
      row.mutation_id = values[1];
      // Error.
      row.last_error = values[2];
      // Si se comprobó la métrica.
      if (values[3] !== null) {
        // La guarda.
        row.metric = values[4];
      }
      // Vectores visibles solo si está listo.
      row.visible_vectors = phase === "ready" ? row.expected_vectors : null;
    }
  };

  // Responde una consulta SQL según su texto.
  const query = (sql: string, values: readonly unknown[]): Row[] => {
    // Documentos de una versión.
    if (sql.includes("FROM documents")) {
      // Filas mapeadas.
      return tables.documents
        .filter((row) => row.version_id === values[0])
        .map((row) => ({
          id: row.document_id,
          title: row.title,
          audience: row.audience,
          sourceHash: row.source_hash,
        }));
    }
    // Fragmentos de una versión.
    if (sql.includes("FROM chunks")) {
      // Filas mapeadas.
      return tables.chunks
        .filter((row) => row.version_id === values[0])
        .map((row) => ({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          text: row.text,
          ordinal: row.ordinal,
        }));
    }
    // Mapa de un perfil.
    if (sql.includes("FROM vector_map")) {
      // Filas mapeadas.
      return tables.vector_map
        .filter((row) => row.profile_id === values[0])
        .map((row) => ({ vectorId: row.vector_id, chunkId: row.chunk_id }));
    }
    // Elementos ingeridos.
    if (sql.includes("FROM ingest_items")) {
      // Filas mapeadas.
      return tables.ingest_items
        .filter((row) => row.corpus_version === values[0] && row.profile_id === values[1])
        .map((row) => ({
          store: row.store,
          itemKey: row.item_key,
          ok: row.ok,
          error: row.error,
          outcome: row.outcome,
          mutationId: row.mutation_id,
        }));
    }
    // Perfiles.
    if (sql.includes("FROM index_profiles")) {
      // Filas mapeadas.
      return tables.index_profiles.map((row) => ({
        id: row.id,
        status: row.status,
        active: row.active,
      }));
    }
    // Otra consulta: vacío.
    return [];
  };

  // prepare simulado con bind, run, all y first.
  const prepare = (sql: string) => ({
    bind(...values: unknown[]) {
      // Métodos de la consulta.
      return {
        run: async () => {
          // Aplica la escritura.
          apply(sql, values);
          // Resultado vacío.
          return {};
        },
        all: async <T>() => ({ results: query(sql, values) as T[] }),
        first: async <T>() => (query(sql, values)[0] as T | undefined) ?? null,
      };
    },
  });

  // Bindings con contadores, R2, D1 y Vectorize simulados.
  const bindings: MemoryBindings = {
    tables,
    get upserts() {
      // Escrituras.
      return upserts;
    },
    get reads() {
      // Lecturas.
      return reads;
    },
    CORPUS: {
      async put(key, body) {
        // Guarda como texto.
        objects.set(key, typeof body === "string" ? body : new TextDecoder().decode(body));
      },
      async get(key) {
        // Objeto.
        const body = objects.get(key);
        // null o un objeto con text.
        return body === undefined ? null : { text: async () => body };
      },
    },
    DB: {
      prepare,
      batch: async (statements) => {
        // Ejecuta cada sentencia.
        for (const statement of statements) {
          // En orden.
          await (statement as { run(): Promise<unknown> }).run();
        }
      },
    },
    VECTORIZE: {
      async upsert(batch) {
        // Cuenta la escritura.
        upserts += 1;
        // Cada vector.
        for (const vector of batch) {
          // Copia valores y metadatos.
          vectors.set(vector.id, { values: [...vector.values], metadata: { ...vector.metadata } });
        }
        // Nueva mutación.
        mutation += 1;
        // Id de mutación.
        return { mutationId: `mut-${String(mutation)}` };
      },
      async getByIds(ids) {
        // Cuenta la lectura.
        reads += 1;
        // Aún no visibles.
        if (reads < visibleAfterReads) {
          // Vacío.
          return [];
        }
        // Vectores que existan.
        return ids.flatMap((id) => {
          // Vector.
          const found = vectors.get(id);
          // Id y metadatos.
          return found === undefined ? [] : [{ id, metadata: found.metadata }];
        });
      },
      async describe() {
        // Dimensiones y número de vectores.
        return {
          dimensions: input?.dimensions,
          vectorCount: vectors.size,
        };
      },
    },
    listMetadataIndexes: async () => metadataIndexes,
  };
  // Bindings.
  return bindings;
}

// Lee los perfiles con su estado y si están activos.
export async function readProfileRows(
  bindings: MemoryBindings,
): Promise<{ id: string; status: string; active: boolean }[]> {
  // Consulta los perfiles.
  const rows = await bindings.DB.prepare("SELECT id, status, active FROM index_profiles")
    .bind()
    .all<{ id: string; status: string; active: number }>();
  // activo como booleano.
  return rows.results.map((row) => ({
    id: row.id,
    status: row.status,
    active: row.active === 1,
  }));
}

// Escribe estado y activo en los perfiles.
export async function writeProfileRows(
  bindings: MemoryBindings,
  profiles: readonly { id: string; status: string; active: boolean }[],
): Promise<void> {
  // Cada perfil.
  for (const profile of profiles) {
    // Fila.
    const row = bindings.tables.index_profiles.find((item) => item.id === profile.id);
    // Si existe.
    if (row !== undefined) {
      // Activo como 0/1.
      row.active = profile.active ? 1 : 0;
      // Estado.
      row.status = profile.status;
    }
  }
}

// Plano de datos en memoria para el panel de ingesta.
export function createMemoryDataPlane(input: {
  // Bindings.
  bindings: MemoryBindings;
  // Datos del índice como los daría la API de gestión.
  management: {
    // Métrica.
    metric: string | null;
    // Dimensiones.
    dimensions: number | null;
    // Nombre.
    name: string | null;
    // Índices de metadatos.
    metadataIndexes: readonly string[];
  };
  // Embeddings de prueba.
  embed(texts: readonly string[]): Promise<{
    // Vectores.
    vectors: number[][];
    // Revisión del proveedor.
    providerRevision: string | null;
  }>;
}) {
  // Adaptador de tablas en memoria.
  const adapter = {
    id: "memory-tables" as const,
    remote: false,
    binding: null,
  };
  // Métodos del plano de datos.
  return {
    management: input.management,
    adapters: () => [adapter, { id: "fixture-embedder" as const, remote: false, binding: null }],
    async embed(texts: readonly string[], reservationId: string) {
      // Exige una reserva rN.
      if (!/^r[0-9]+$/.test(reservationId)) {
        // Error.
        throw new Error("Falta la reserva.");
      }
      // Embeddings.
      const embedded = await input.embed(texts);
      // Con su adaptador.
      return {
        ...embedded,
        adapter: { id: "fixture-embedder" as const, remote: false, binding: null },
      };
    },
    async ingest(request: { manifest: CorpusManifest; vectors: number[][] }) {
      // Perfiles.
      const profiles = await readProfileRows(input.bindings);
      // Un perfil activo no se reingiere.
      if (profiles.some((profile) => profile.id === request.manifest.profileId && profile.active)) {
        // Fallo.
        return { phase: "failed", upserts: 0, profileId: request.manifest.profileId, adapter };
      }
      // Diario de la ingesta.
      const journal = await loadBoundJournal(
        input.bindings.DB as Parameters<typeof loadBoundJournal>[0],
        request.manifest.preparationId,
        request.manifest.profileId,
      );
      // Escrituras previas.
      const before = input.bindings.upserts;
      // Primera pasada.
      let result = await runBoundIngestion(
        input.bindings,
        request.manifest,
        request.vectors,
        journal,
        {
          metric: input.management.metric,
          reportedName: input.management.name,
          expectedIndexName: input.management.name,
        },
      );
      // Lecturas de visibilidad.
      let polls = 0;
      // Hasta dos reintentos de visibilidad.
      while (result.phase === "pending-visibility" && polls < 2) {
        // Cuenta.
        polls += 1;
        // Otra pasada.
        result = await runBoundIngestion(
          input.bindings,
          request.manifest,
          request.vectors,
          result.journal,
          {
            metric: input.management.metric,
            reportedName: input.management.name,
            expectedIndexName: input.management.name,
          },
        );
      }
      // Fase y escrituras nuevas.
      return {
        phase: result.phase,
        upserts: input.bindings.upserts - before,
        profileId: request.manifest.profileId,
        adapter,
      };
    },
    async selectActive(profileId: string) {
      // Perfiles antes.
      const before = await readProfileRows(input.bindings);
      // Nueva selección del activo.
      const next = applyActiveSelection(
        before.map((profile) => ({
          ...profile,
          status: profile.status as
            | "ready"
            | "partial"
            | "pending-visibility"
            | "failed"
            | "planned",
        })),
        profileId,
      );
      // Escribe.
      await writeProfileRows(input.bindings, next);
      // Relee.
      const after = await readProfileRows(input.bindings);
      // Activo.
      const active = after.find((profile) => profile.active);
      // Pedido.
      const requested = before.find((profile) => profile.id === profileId);
      // No listo: no cambia.
      if (requested === undefined || requested.status !== "ready") {
        // Fallo.
        return {
          ok: false,
          summary: "La versión pedida no está lista. La versión activa no cambia.",
          activeId: active?.id ?? null,
          adapter,
        };
      }
      // La relectura no lo confirma.
      if (active?.id !== profileId) {
        // Fallo.
        return {
          ok: false,
          summary: "La lectura final no prueba el perfil activo.",
          activeId: active?.id ?? null,
          adapter,
        };
      }
      // Activo comprobado.
      return {
        ok: true,
        summary: "perfil activo comprobado por lectura final",
        activeId: active.id,
        adapter,
      };
    },
  };
}
