import { LOCAL_EMULATED_MIN_SCORE, cosine } from "@thepower-rag/core";

export interface StoredVector {
  values: number[];
  metadata: Record<string, string>;
}

export interface LocalVectorize {
  upsert(vectors: { id: string; values: number[]; metadata: Record<string, string> }[]): Promise<{
    mutationId: string;
  }>;
  getByIds(ids: string[]): Promise<{ id: string; metadata?: Record<string, string> }[]>;
  describe(): Promise<{
    dimensions: number;
    vectorCount: number;
    name: string;
    config: { metric: "cosine" };
  }>;
  query(
    vector: number[],
    options: {
      topK: number;
      returnMetadata: "all";
      filter: {
        corpusVersion: string;
        profileId: string;
        audience: { $in: string[] };
      };
    },
  ): Promise<{ matches: { id: string; score: number; metadata?: Record<string, string> }[] }>;
  listMetadataIndexes(): Promise<readonly string[]>;
  upserts(): number;
}

export function createLocalVectorize(input: {
  name: string;
  dimensions: number;
  rows: Map<string, StoredVector>;
  persist(id: string, values: readonly number[], metadata: Record<string, string>): Promise<void>;
}): LocalVectorize {
  let mutations = 0;
  let writes = 0;
  return {
    upserts: () => writes,
    async upsert(vectors) {
      for (const vector of vectors) {
        if (
          vector.values.length !== input.dimensions ||
          vector.values.some((value) => !Number.isFinite(value))
        ) {
          throw new Error("El vector emulado no tiene la dimensión local.");
        }
        const metadata = { ...vector.metadata };
        input.rows.set(vector.id, { values: [...vector.values], metadata });
        await input.persist(vector.id, vector.values, metadata);
      }
      mutations += 1;
      writes += 1;
      return { mutationId: `local-${String(mutations)}` };
    },
    async getByIds(ids) {
      return ids.flatMap((id) => {
        const found = input.rows.get(id);
        return found === undefined ? [] : [{ id, metadata: found.metadata }];
      });
    },
    async describe() {
      return {
        dimensions: input.dimensions,
        vectorCount: input.rows.size,
        name: input.name,
        config: { metric: "cosine" as const },
      };
    },
    async query(vector, options) {
      const matches: { id: string; score: number; metadata: Record<string, string> }[] = [];
      for (const [id, row] of input.rows) {
        const audience = row.metadata.audience ?? "";
        if (
          row.metadata.corpusVersion !== options.filter.corpusVersion ||
          row.metadata.profileId !== options.filter.profileId ||
          !options.filter.audience.$in.includes(audience)
        ) {
          continue;
        }
        const score = cosine(vector, row.values);
        if (score < LOCAL_EMULATED_MIN_SCORE) {
          continue;
        }
        matches.push({ id, score, metadata: row.metadata });
      }
      matches.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
      return { matches: matches.slice(0, options.topK) };
    },
    async listMetadataIndexes() {
      return ["corpusVersion", "audience", "profileId"];
    },
  };
}
