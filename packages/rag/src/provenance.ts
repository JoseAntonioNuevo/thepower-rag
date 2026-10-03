export const RUNTIME_PROVENANCE = ["fixture", "local-native-emulation", "remote-binding"] as const;

export type RuntimeProvenance = (typeof RUNTIME_PROVENANCE)[number];

export interface AdapterRecord {
  id:
    | "fixture-embedder"
    | "local-emulated-embedder"
    | "workers-ai-binding"
    | "local-emulated-vectorize"
    | "vectorize-binding"
    | "native-d1"
    | "memory-tables"
    | "local-emulated-generator"
    | "local-emulated-evaluator"
    | "openrouter";
  remote: boolean;
  binding: "AI" | "VECTORIZE" | "DB" | "CORPUS" | null;
}

const FIXTURE_ADAPTERS = new Set<AdapterRecord["id"]>(["fixture-embedder", "memory-tables"]);
const REMOTE_ADAPTERS = new Set<AdapterRecord["id"]>([
  "workers-ai-binding",
  "vectorize-binding",
  "openrouter",
]);

export function classifyRuntime(adapters: readonly AdapterRecord[]): {
  provenance: RuntimeProvenance | "unknown";
  live: boolean | null;
} {
  if (adapters.length === 0) {
    return { provenance: "unknown", live: null };
  }
  const remote = adapters.some((item) => item.remote && REMOTE_ADAPTERS.has(item.id));
  const fixture = adapters.some((item) => FIXTURE_ADAPTERS.has(item.id));
  if (remote && fixture) {
    return { provenance: "unknown", live: null };
  }
  if (remote) {
    return { provenance: "remote-binding", live: true };
  }
  if (fixture) {
    return { provenance: "fixture", live: false };
  }
  return { provenance: "local-native-emulation", live: false };
}

export function usableForRemoteIndex(provenance: RuntimeProvenance | "unknown"): boolean {
  return provenance === "remote-binding";
}
