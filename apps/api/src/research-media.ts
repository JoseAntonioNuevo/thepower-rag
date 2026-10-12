// GUÍA DE LECTURA · apps/api/src/research-media.ts
// Imágenes y audios de la investigación: filas en D1, objetos en R2 (o en memoria en local), lectura
// por rangos, limpieza de huérfanos y respuesta HTTP segura para reproducirlos o descargarlos.
// Tipo de la base de datos de la investigación.
import type { ResearchDatabase } from "./research-db";
// Funciones del almacén para borrar filas y listar medios huérfanos.
import { deleteMediaRow, listOrphanMedia } from "./research-store";

// Fila de research_media_assets: un archivo subido o generado.
export interface AssetRow {
  // Identificador del archivo.
  id: string;
  // Propietario (sesión del navegador).
  owner_id: string;
  // Conversación a la que pertenece.
  conversation_id: string;
  // Imagen, audio subido o voz generada.
  role: "image" | "audio" | "speech";
  // Clave del objeto en R2.
  object_key: string;
  // Hash SHA-256 del contenido.
  content_hash: string;
  // Tipo MIME.
  mime: string;
  // Tamaño en bytes.
  byte_size: number;
  // Ancho de la imagen.
  width: number | null;
  // Alto de la imagen.
  height: number | null;
  // Duración del audio en milisegundos.
  duration_ms: number | null;
  // Frecuencia de muestreo.
  sample_rate: number | null;
  // Canales de audio.
  channels: number | null;
  // Bits por muestra.
  bit_depth: number | null;
  // Estado del procesado.
  status: string;
  // Texto extraído (lectura o transcripción).
  extracted_text: string | null;
  // Detalle visible del procesado.
  detail: string | null;
  // Trabajo de investigación que lo usa.
  job_id: string | null;
  // Clave de idempotencia de la subida.
  idempotency_key: string;
  // Fecha de creación en milisegundos.
  created_at: number;
}

// Columnas que se leen en cada consulta.
const ASSET_COLUMNS = `id, owner_id, conversation_id, role, object_key, content_hash, mime, byte_size,
  width, height, duration_ms, sample_rate, channels, bit_depth, status, extracted_text, detail,
  job_id, idempotency_key, created_at`;

// Busca un archivo por su clave de idempotencia: una subida repetida no crea otro.
export async function assetByIdempotency(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
  key: string,
): Promise<AssetRow | null> {
  // Primera fila que coincida o null.
  return database
    .prepare(
      `SELECT ${ASSET_COLUMNS} FROM research_media_assets
       WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
    )
    .bind(ownerId, conversationId, key)
    .first<AssetRow>();
}

// Busca un archivo por id, solo si es del propietario.
export async function assetById(
  database: ResearchDatabase,
  ownerId: string,
  id: string,
): Promise<AssetRow | null> {
  // Primera fila o null.
  return database
    .prepare(`SELECT ${ASSET_COLUMNS} FROM research_media_assets WHERE owner_id = ? AND id = ?`)
    .bind(ownerId, id)
    .first<AssetRow>();
}

// Guarda un archivo nuevo.
export async function insertAsset(database: ResearchDatabase, row: AssetRow): Promise<void> {
  // INSERT con todos los campos en orden.
  await database
    .prepare(
      `INSERT INTO research_media_assets (
         id, owner_id, conversation_id, role, object_key, content_hash, mime, byte_size,
         width, height, duration_ms, sample_rate, channels, bit_depth, status, extracted_text,
         detail, job_id, idempotency_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.owner_id,
      row.conversation_id,
      row.role,
      row.object_key,
      row.content_hash,
      row.mime,
      row.byte_size,
      row.width,
      row.height,
      row.duration_ms,
      row.sample_rate,
      row.channels,
      row.bit_depth,
      row.status,
      row.extracted_text,
      row.detail,
      row.job_id,
      row.idempotency_key,
      row.created_at,
    )
    .run();
}

// Actualiza estado, texto extraído y detalle de un archivo.
export async function markAssetText(
  database: ResearchDatabase,
  id: string,
  status: string,
  text: string,
  detail: string,
): Promise<void> {
  // UPDATE por id.
  await database
    .prepare(
      `UPDATE research_media_assets SET status = ?, extracted_text = ?, detail = ? WHERE id = ?`,
    )
    .bind(status, text, detail, id)
    .run();
}

// Objeto leído de R2.
export interface MediaObject {
  // Bytes.
  body: Uint8Array;
  // Tamaño total.
  size: number;
  // Tipo MIME.
  mime: string;
  // Rango leído, si se pidió uno.
  range?: { offset: number; length: number };
}

// Parte de R2 que se usa para medios.
export interface ResearchMediaBucket {
  // Guarda un objeto con su tipo.
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  // Lee un objeto entero o un rango.
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{
    // Tamaño total.
    size?: number;
    // Metadatos HTTP.
    httpMetadata?: { contentType?: string };
    // Lectura como ArrayBuffer.
    arrayBuffer?: () => Promise<ArrayBuffer>;
    // Cuerpo como stream.
    body?: ReadableStream<Uint8Array> | null;
    // Rango devuelto.
    range?: { offset?: number; length?: number };
  } | null>;
  // Solo metadatos.
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
  // Borra un objeto.
  delete(key: string): Promise<unknown>;
}

// Comprueba que un binding tiene los métodos de un bucket de medios.
export function asMediaBucket(value: unknown): ResearchMediaBucket | null {
  // Si tiene put, get, head y delete.
  if (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    "get" in value &&
    "head" in value &&
    "delete" in value
  ) {
    // Lo devuelve con ese tipo.
    return value as ResearchMediaBucket;
  }
  // Si no, null.
  return null;
}

// Bucket en memoria para desarrollo local y tests.
export function memoryMediaBucket(): ResearchMediaBucket {
  // Objetos por clave.
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  // Implementación de los cuatro métodos.
  return {
    async put(key, value, options) {
      // Copia los bytes para no compartir memoria.
      const copy = new Uint8Array(value.byteLength);
      // Copia.
      copy.set(value);
      // Guarda con su tipo.
      objects.set(key, {
        bytes: copy,
        mime: options?.httpMetadata?.contentType ?? "application/octet-stream",
      });
    },
    async get(key, options) {
      // Objeto.
      const found = objects.get(key);
      // No existe.
      if (!found) return null;
      // Inicio del rango.
      const offset = options?.range?.offset ?? 0;
      // Longitud del rango.
      const length = options?.range?.length ?? found.bytes.length - offset;
      // Trozo pedido.
      const slice = found.bytes.subarray(offset, offset + length);
      // Copia.
      const copy = new Uint8Array(slice.byteLength);
      // Copia.
      copy.set(slice);
      // Objeto con metadatos y rango.
      return {
        size: found.bytes.length,
        httpMetadata: { contentType: found.mime },
        arrayBuffer: () => Promise.resolve(copy.buffer),
        range: options?.range ? { offset, length: copy.byteLength } : undefined,
      };
    },
    async head(key) {
      // Objeto.
      const found = objects.get(key);
      // Tamaño y tipo o null.
      return found ? { size: found.bytes.length, httpMetadata: { contentType: found.mime } } : null;
    },
    async delete(key) {
      // Borra.
      objects.delete(key);
    },
  };
}

// Lee el cuerpo de un objeto, venga como ArrayBuffer o como stream.
async function readBody(
  object: NonNullable<Awaited<ReturnType<ResearchMediaBucket["get"]>>>,
): Promise<Uint8Array> {
  // Con arrayBuffer.
  if (object.arrayBuffer) {
    // Bytes.
    return new Uint8Array(await object.arrayBuffer());
  }
  // Con stream.
  if (object.body) {
    // Lector.
    const reader = object.body.getReader();
    // Trozos.
    const chunks: Uint8Array[] = [];
    // Total.
    let total = 0;
    // Hasta el final.
    for (;;) {
      // Siguiente trozo.
      const next = await reader.read();
      // Fin.
      if (next.done) break;
      // Guarda.
      chunks.push(next.value);
      // Suma.
      total += next.value.byteLength;
    }
    // Une los trozos.
    const merged = new Uint8Array(total);
    // Posición.
    let offset = 0;
    // Cada trozo.
    for (const chunk of chunks) {
      // Copia.
      merged.set(chunk, offset);
      // Avanza.
      offset += chunk.byteLength;
    }
    // Bytes.
    return merged;
  }
  // Sin cuerpo: vacío.
  return new Uint8Array();
}

// Lee un objeto de medios con su tamaño, tipo y rango.
export async function readMediaObject(
  bucket: ResearchMediaBucket,
  key: string,
  range?: { offset: number; length: number },
): Promise<MediaObject | null> {
  // Pide el objeto o el rango.
  const object = await bucket.get(key, range ? { range } : undefined);
  // No existe.
  if (!object) return null;
  // Cuerpo.
  const body = await readBody(object);
  // Objeto normalizado.
  return {
    body,
    size: object.size ?? body.byteLength,
    mime: object.httpMetadata?.contentType ?? "application/octet-stream",
    range:
      object.range?.offset === undefined
        ? undefined
        : { offset: object.range.offset, length: body.byteLength },
  };
}

// Borra medios que nadie usa pasado un tiempo; devuelve cuántos.
export async function purgeOrphanMedia(
  database: ResearchDatabase,
  bucket: ResearchMediaBucket,
  now: number,
  maxAgeMs: number,
): Promise<number> {
  // Huérfanos más antiguos que el límite.
  const rows = await listOrphanMedia(database, now - maxAgeMs);
  // Contador.
  let removed = 0;
  // Cada uno.
  for (const row of rows) {
    // Borra la fila; si otro proceso ya la borró, se salta.
    if (!(await deleteMediaRow(database, row.id))) continue;
    // Borra el objeto de R2.
    await bucket.delete(row.object_key);
    // Cuenta.
    removed += 1;
  }
  // Borrados.
  return removed;
}

// Nombre de descarga seguro según papel y MIME.
export function mediaDownloadName(role: string, mime: string): string {
  // Nombre base.
  const base = role === "speech" ? "respuesta" : role === "audio" ? "audio" : "imagen";
  // Extensión por tipo MIME.
  const extension =
    mime === "image/png"
      ? "png"
      : mime === "image/jpeg"
        ? "jpg"
        : mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav"
          ? "wav"
          : mime === "audio/mpeg"
            ? "mp3"
            : "bin";
  // Nombre limpio de caracteres raros.
  return `${base}.${extension}`.replace(/[^A-Za-z0-9._-]/g, "");
}

// Respuesta HTTP de un medio, completa (200) o parcial (206).
export function mediaResponse(input: {
  // Bytes.
  bytes: Uint8Array;
  // Tipo MIME.
  mime: string;
  // Tamaño total.
  total: number;
  // Nombre de archivo.
  filename: string;
  // Rango servido o null.
  range: { start: number; end: number } | null;
}): Response {
  // Cabeceras: tipo, sin adivinar tipo, en línea, sin caché y con rangos.
  const headers = new Headers({
    "content-type": input.mime,
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${input.filename}"`,
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
  });
  // Con rango.
  if (input.range) {
    // Longitud del trozo.
    headers.set("content-length", String(input.bytes.byteLength));
    // Rango servido.
    headers.set(
      "content-range",
      `bytes ${String(input.range.start)}-${String(input.range.end)}/${String(input.total)}`,
    );
    // 206 Partial Content.
    return new Response(input.bytes, { status: 206, headers });
  }
  // Longitud total.
  headers.set("content-length", String(input.total));
  // 200 OK.
  return new Response(input.bytes, { status: 200, headers });
}

// Interpreta la cabecera Range: null sin cabecera, "invalid" si no es válida.
export function parseRange(
  header: string | null,
  total: number,
): { start: number; end: number } | "invalid" | null {
  // Sin cabecera.
  if (header === null || header.length === 0) return null;
  // Formato bytes=inicio-fin.
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  // No coincide: inválida.
  if (!match?.[1]) return "invalid";
  // Inicio.
  const start = Number(match[1]);
  // Fin o el último byte.
  const end = match[2] ? Number(match[2]) : total - 1;
  // Fuera de rango.
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start > end ||
    start >= total ||
    end >= total
  ) {
    // Inválida.
    return "invalid";
  }
  // Rango válido.
  return { start, end };
}
