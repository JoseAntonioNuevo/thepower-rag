// GUÍA DE LECTURA · packages/rag/src/provenance.ts
// Clasifica de dónde salen los datos de una ejecución: guiones de prueba, emulación local o
// bindings remotos de Cloudflare. Así una prueba local nunca se presenta como el índice real.
// Las tres procedencias posibles.
export const RUNTIME_PROVENANCE = ["fixture", "local-native-emulation", "remote-binding"] as const;

// Tipo con esas tres procedencias.
export type RuntimeProvenance = (typeof RUNTIME_PROVENANCE)[number];

// Registro de un adaptador usado durante una ejecución.
export interface AdapterRecord {
  // Qué adaptador fue: embebedor de prueba, emulado o Workers AI; índice emulado o Vectorize; D1; generador.
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
    | "anthropic";
  // true si el adaptador habló con un servicio remoto.
  remote: boolean;
  // Binding de Cloudflare que usó, o null.
  binding: "AI" | "VECTORIZE" | "DB" | "CORPUS" | null;
}

// Adaptadores que solo existen en la demostración con datos de prueba.
const FIXTURE_ADAPTERS = new Set<AdapterRecord["id"]>(["fixture-embedder", "memory-tables"]);
// Adaptadores que llaman a servicios reales.
const REMOTE_ADAPTERS = new Set<AdapterRecord["id"]>([
  "workers-ai-binding",
  "vectorize-binding",
  "anthropic",
]);

// Decide la procedencia de una ejecución a partir de sus adaptadores.
export function classifyRuntime(adapters: readonly AdapterRecord[]): {
  // Procedencia deducida o unknown si no se puede saber.
  provenance: RuntimeProvenance | "unknown";
  // true si fue en vivo, false si no, null si es desconocido.
  live: boolean | null;
} {
  // Sin adaptadores no hay forma de saberlo.
  if (adapters.length === 0) {
    // Desconocido.
    return { provenance: "unknown", live: null };
  }
  // ¿Algún adaptador remoto real?
  const remote = adapters.some((item) => item.remote && REMOTE_ADAPTERS.has(item.id));
  // ¿Algún adaptador de prueba?
  const fixture = adapters.some((item) => FIXTURE_ADAPTERS.has(item.id));
  // Mezclar remoto y prueba es incoherente: no se afirma nada.
  if (remote && fixture) {
    // Desconocido.
    return { provenance: "unknown", live: null };
  }
  // Solo adaptadores remotos.
  if (remote) {
    // Ejecución en vivo con bindings remotos.
    return { provenance: "remote-binding", live: true };
  }
  // Solo adaptadores de prueba.
  if (fixture) {
    // Demostración con datos fijos.
    return { provenance: "fixture", live: false };
  }
  // Lo demás es emulación local nativa.
  return { provenance: "local-native-emulation", live: false };
}

// Solo una ejecución con bindings remotos sirve para validar el índice real.
export function usableForRemoteIndex(provenance: RuntimeProvenance | "unknown"): boolean {
  // Comparación directa con la procedencia remota.
  return provenance === "remote-binding";
}
