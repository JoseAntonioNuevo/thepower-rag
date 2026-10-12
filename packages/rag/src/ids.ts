// GUÍA DE LECTURA · packages/rag/src/ids.ts
// Nombres, límites de Cloudflare e identificadores derivados del corpus: versiones, perfiles de
// índice, nombres de Vectorize y claves de R2. Todo se calcula a partir del contenido.
// Huella FNV-1a de 64 bits.
import { fnv1a64 } from "./hash";

// Bytes máximos del id de un vector en Vectorize.
export const VECTOR_ID_MAX_BYTES = 64;
// Bytes máximos de un valor de metadatos indexado.
export const METADATA_VALUE_MAX_BYTES = 64;
// Bytes máximos del nombre de un índice.
export const INDEX_NAME_MAX_BYTES = 64;
// Vectores por lote al escribir en Vectorize.
export const VECTORIZE_UPSERT_BATCH = 1000;
// La página de límites no publica un tope menor para get_by_ids.
// 1000 es el lote de upsert del binding y el tamaño de página de list-vectors.
export const VECTORIZE_GET_BATCH = 1000;
// Metadatos por los que Vectorize puede filtrar.
export const VECTORIZE_METADATA_INDEXES = ["corpusVersion", "audience", "profileId"] as const;
// Marca de métrica sin comprobar.
export const UNVERIFIED_METRIC = "unverified";
// Nombre de la base de datos D1 del curso.
export const COURSE_D1_NAME = "thepower-ai-course-rag-d1";
// Nombre del bucket R2 del corpus.
export const COURSE_R2_NAME = "thepower-ai-course-rag-corpus";
// Prefijo de los índices Vectorize del curso.
export const COURSE_VECTORIZE_PREFIX = "thepower-ai-course-rag-";

// Troceado usado al preparar el corpus.
export const PREP_CHUNKING = { maxChars: 900, overlap: 80 } as const;

// Cuenta los bytes UTF-8 de un texto (los límites de Cloudflare van en bytes, no en caracteres).
export function utf8Bytes(value: string): number {
  // Contador de bytes.
  let bytes = 0;
  // Recorre el texto por caracteres Unicode.
  for (const char of value) {
    // Código del carácter.
    const code = char.codePointAt(0) ?? 0;
    // ASCII: 1 byte.
    if (code <= 0x7f) {
      // Suma 1.
      bytes += 1;
    } else if (code <= 0x7ff) {
      // Hasta U+07FF: 2 bytes.
      bytes += 2;
    } else if (code <= 0xffff) {
      // Hasta U+FFFF: 3 bytes.
      bytes += 3;
    } else {
      // El resto (emojis, etc.): 4 bytes.
      bytes += 4;
    }
  }
  // Total de bytes.
  return bytes;
}

// Versión del contenido: «c» y 12 caracteres de la huella del material fuente.
export function contentVersionId(sourceMaterial: string): string {
  // slice(0, 12) toma los 12 primeros caracteres.
  return `c${fnv1a64(sourceMaterial).slice(0, 12)}`;
}

// Versión de preparación: depende del contenido y también del troceado.
export function preparationId(
  sourceMaterial: string,
  chunking: { maxChars: number; overlap: number },
): string {
  // Huella del material más el tamaño y el solapamiento de los fragmentos.
  return `c${fnv1a64(`${sourceMaterial}\nchunk:${String(chunking.maxChars)}:${String(chunking.overlap)}`).slice(0, 12)}`;
}

// Lo que define un perfil de índice: si cambia algo, cambia el perfil.
export interface ProfileIdentity {
  // Familia: demostración o Workers AI.
  family: "fixture" | "workers-ai";
  // Modelo de embeddings.
  model: string;
  // Dimensiones del vector.
  dimensions: number;
  // Métrica de similitud.
  metric: "cosine";
  // Tamaño máximo de fragmento.
  chunkMaxChars: number;
  // Solapamiento.
  chunkOverlap: number;
  // Revisión del proveedor, o null.
  providerRevision: string | null;
  // Versión de preparación del corpus.
  preparationId: string;
}

// Identificador del perfil: «p» y 12 caracteres de la huella de todos sus datos.
export function indexProfileId(profile: ProfileIdentity): string {
  // Une los datos del perfil en un texto, uno por línea.
  const material = [
    profile.family,
    profile.model,
    String(profile.dimensions),
    profile.metric,
    String(profile.chunkMaxChars),
    String(profile.chunkOverlap),
    profile.providerRevision ?? "null",
    profile.preparationId,
  ].join("\n");
  // Huella del texto con prefijo p.
  return `p${fnv1a64(material).slice(0, 12)}`;
}

// Nombre del índice Vectorize del perfil.
export function vectorizeIndexName(profileId: string): string {
  // Quita la p inicial del perfil.
  const suffix = profileId.startsWith("p") ? profileId.slice(1) : profileId;
  // Prefijo del curso más el sufijo.
  const name = `${COURSE_VECTORIZE_PREFIX}${suffix}`;
  // Vectorize limita la longitud del nombre.
  if (utf8Bytes(name) > INDEX_NAME_MAX_BYTES) {
    // Error: no se recorta en silencio.
    throw new Error("El nombre del índice supera el límite de Vectorize.");
  }
  // Nombre válido.
  return name;
}

// Id del vector: el mismo id del fragmento, si cabe en 64 bytes.
export function vectorIdFor(chunkId: string): string {
  // Demasiado largo para Vectorize.
  if (utf8Bytes(chunkId) > VECTOR_ID_MAX_BYTES) {
    // Error: no se acorta para no mezclar fragmentos.
    throw new Error("El identificador del fragmento supera 64 bytes y no se compacta en silencio.");
  }
  // Id válido.
  return chunkId;
}

// Clave en R2 del documento Markdown de una preparación.
export function documentObjectKey(preparationId: string, documentId: string): string {
  // Ruta dentro del bucket.
  return `corpus/${preparationId}/documents/${documentId}.md`;
}

// Clave en R2 del manifiesto de contenido.
export function contentManifestKey(preparationId: string): string {
  // Ruta dentro del bucket.
  return `corpus/${preparationId}/content-manifest.json`;
}

// Clave en R2 del manifiesto de un perfil.
export function profileManifestKey(preparationId: string, profileId: string): string {
  // Ruta dentro del bucket.
  return `corpus/${preparationId}/profiles/${profileId}/manifest.json`;
}

// Clave en R2 del recibo de configuración del índice.
export function indexConfigReceiptKey(preparationId: string, profileId: string): string {
  // Ruta dentro del bucket.
  return `corpus/${preparationId}/profiles/${profileId}/index-config.json`;
}
