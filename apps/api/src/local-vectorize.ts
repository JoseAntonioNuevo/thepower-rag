// GUÍA DE LECTURA · apps/api/src/local-vectorize.ts
// Vectorize emulado en memoria para la verificación local: guarda vectores con metadatos, filtra
// por versión, perfil y audiencia, y ordena por coseno con el umbral del emulador.
// Umbral y coseno del emulador.
import { LOCAL_EMULATED_MIN_SCORE, cosine } from "@thepower-rag/core";

// Vector guardado.
export interface StoredVector {
  // Valores.
  values: number[];
  // Metadatos.
  metadata: Record<string, string>;
}

// Interfaz que imita el binding de Vectorize.
export interface LocalVectorize {
  // Inserta o sustituye vectores.
  upsert(vectors: { id: string; values: number[]; metadata: Record<string, string> }[]): Promise<{
    // Id de la mutación.
    mutationId: string;
  }>;
  // Lee vectores por id.
  getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, string> }[]>;
  // Describe el índice.
  describe(): Promise<{
    // Dimensiones.
    dimensions: number;
    // Número de vectores.
    vectorCount: number;
    // Nombre.
    name: string;
    // Métrica.
    config: { metric: "cosine" };
  }>;
  // Busca los vectores más parecidos.
  query(
    vector: number[],
    options: {
      // Resultados pedidos.
      topK: number;
      // Devolver metadatos.
      returnMetadata: "all";
      // Filtros.
      filter: {
        // Versión del corpus.
        corpusVersion: string;
        // Perfil.
        profileId: string;
        // Audiencias admitidas.
        audience: { $in: string[] };
      };
    },
  ): Promise<{ matches: { id: string; score: number; metadata?: Record<string, string> }[] }>;
  // Índices de metadatos.
  listMetadataIndexes(): Promise<readonly string[]>;
  // Número de escrituras (para las pruebas).
  upserts(): number;
}

// Crea el índice emulado.
export function createLocalVectorize(input: {
  // Nombre.
  name: string;
  // Dimensiones.
  dimensions: number;
  // Almacén de filas.
  rows: Map<string, StoredVector>;
  // Persiste cada vector.
  persist(id: string, values: readonly number[], metadata: Record<string, string>): Promise<void>;
}): LocalVectorize {
  // Contador de mutaciones.
  let mutations = 0;
  // Contador de escrituras.
  let writes = 0;
  // Implementación de la interfaz.
  return {
    // Expone el contador de escrituras para comprobar cuántas operaciones se enviaron.
    upserts: () => writes,
    // Inserta o actualiza el lote de vectores por sus identificadores.
    async upsert(vectors) {
      // Valida y guarda cada vector.
      for (const vector of vectors) {
        // Dimensión y valores finitos.
        if (
          vector.values.length !== input.dimensions ||
          vector.values.some((value) => !Number.isFinite(value))
        ) {
          // Error.
          throw new Error("El vector emulado no tiene la dimensión local.");
        }
        // Copia de los metadatos.
        const metadata = { ...vector.metadata };
        // Guarda en memoria.
        input.rows.set(vector.id, { values: [...vector.values], metadata });
        // Persiste.
        await input.persist(vector.id, vector.values, metadata);
      }
      // Una mutación más.
      mutations += 1;
      // Una escritura más.
      writes += 1;
      // Id de la mutación.
      return { mutationId: `local-${String(mutations)}` };
    },
    // Lee vectores por identificador para comprobar presencia, valores y metadatos.
    async getByIds(ids) {
      // Vectores existentes con sus metadatos.
      return ids.flatMap((id) => {
        // Fila por id.
        const found = input.rows.get(id);
        // Solo si existe.
        return found === undefined ? [] : [{ id, metadata: found.metadata }];
      });
    },
    // Entrega las propiedades del índice que el recorrido utiliza para verificar compatibilidad.
    async describe() {
      // Descripción del índice.
      return {
        dimensions: input.dimensions,
        vectorCount: input.rows.size,
        name: input.name,
        config: { metric: "cosine" as const },
      };
    },
    // Ejecuta una consulta con sus parámetros y entrega las filas mediante el contrato del almacén.
    async query(vector, options) {
      // Resultados.
      const matches: { id: string; score: number; metadata: Record<string, string> }[] = [];
      // Recorre las filas.
      for (const [id, row] of input.rows) {
        // Audiencia de la fila.
        const audience = row.metadata.audience ?? "";
        // Filtra por versión, perfil y audiencia.
        if (
          row.metadata.corpusVersion !== options.filter.corpusVersion ||
          row.metadata.profileId !== options.filter.profileId ||
          !options.filter.audience.$in.includes(audience)
        ) {
          // No cumple el filtro.
          continue;
        }
        // Similitud.
        const score = cosine(vector, row.values);
        // Por debajo del umbral.
        if (score < LOCAL_EMULATED_MIN_SCORE) {
          // Se descarta.
          continue;
        }
        // Coincidencia.
        matches.push({ id, score, metadata: row.metadata });
      }
      // Mayor similitud primero; empate por id.
      matches.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      // Los primeros topK.
      return { matches: matches.slice(0, options.topK) };
    },
    // Entrega los índices de metadatos para comprobar los filtros disponibles.
    async listMetadataIndexes() {
      // Índices de metadatos emulados.
      return ["corpusVersion", "audience", "profileId"];
    },
  };
}
