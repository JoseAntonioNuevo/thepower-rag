import type { ResearchDatabase } from "./research-db";
import { deleteMediaRow, listOrphanMedia } from "./research-store";

export interface AssetRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  role: "image" | "audio" | "speech";
  object_key: string;
  content_hash: string;
  mime: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  sample_rate: number | null;
  channels: number | null;
  bit_depth: number | null;
  status: string;
  extracted_text: string | null;
  detail: string | null;
  job_id: string | null;
  idempotency_key: string;
  created_at: number;
}

const ASSET_COLUMNS = `id, owner_id, conversation_id, role, object_key, content_hash, mime, byte_size,
  width, height, duration_ms, sample_rate, channels, bit_depth, status, extracted_text, detail,
  job_id, idempotency_key, created_at`;

export async function assetByIdempotency(
  database: ResearchDatabase,
  ownerId: string,
  conversationId: string,
  key: string,
): Promise<AssetRow | null> {
  return database
    .prepare(
      `SELECT ${ASSET_COLUMNS} FROM research_media_assets
       WHERE owner_id = ? AND conversation_id = ? AND idempotency_key = ?`,
    )
    .bind(ownerId, conversationId, key)
    .first<AssetRow>();
}

export async function assetById(
  database: ResearchDatabase,
  ownerId: string,
  id: string,
): Promise<AssetRow | null> {
  return database
    .prepare(`SELECT ${ASSET_COLUMNS} FROM research_media_assets WHERE owner_id = ? AND id = ?`)
    .bind(ownerId, id)
    .first<AssetRow>();
}

export async function insertAsset(database: ResearchDatabase, row: AssetRow): Promise<void> {
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

export async function markAssetText(
  database: ResearchDatabase,
  id: string,
  status: string,
  text: string,
  detail: string,
): Promise<void> {
  await database
    .prepare(
      `UPDATE research_media_assets SET status = ?, extracted_text = ?, detail = ? WHERE id = ?`,
    )
    .bind(status, text, detail, id)
    .run();
}

export interface MediaObject {
  body: Uint8Array;
  size: number;
  mime: string;
  range?: { offset: number; length: number };
}

export interface ResearchMediaBucket {
  put(
    key: string,
    value: Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(
    key: string,
    options?: { range?: { offset: number; length: number } },
  ): Promise<{
    size?: number;
    httpMetadata?: { contentType?: string };
    arrayBuffer?: () => Promise<ArrayBuffer>;
    body?: ReadableStream<Uint8Array> | null;
    range?: { offset?: number; length?: number };
  } | null>;
  head(key: string): Promise<{ size: number; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<unknown>;
}

export function asMediaBucket(value: unknown): ResearchMediaBucket | null {
  if (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    "get" in value &&
    "head" in value &&
    "delete" in value
  ) {
    return value as ResearchMediaBucket;
  }
  return null;
}

export function memoryMediaBucket(): ResearchMediaBucket {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  return {
    async put(key, value, options) {
      const copy = new Uint8Array(value.byteLength);
      copy.set(value);
      objects.set(key, {
        bytes: copy,
        mime: options?.httpMetadata?.contentType ?? "application/octet-stream",
      });
    },
    async get(key, options) {
      const found = objects.get(key);
      if (!found) return null;
      const offset = options?.range?.offset ?? 0;
      const length = options?.range?.length ?? found.bytes.length - offset;
      const slice = found.bytes.subarray(offset, offset + length);
      const copy = new Uint8Array(slice.byteLength);
      copy.set(slice);
      return {
        size: found.bytes.length,
        httpMetadata: { contentType: found.mime },
        arrayBuffer: () => Promise.resolve(copy.buffer),
        range: options?.range ? { offset, length: copy.byteLength } : undefined,
      };
    },
    async head(key) {
      const found = objects.get(key);
      return found ? { size: found.bytes.length, httpMetadata: { contentType: found.mime } } : null;
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

async function readBody(
  object: NonNullable<Awaited<ReturnType<ResearchMediaBucket["get"]>>>,
): Promise<Uint8Array> {
  if (object.arrayBuffer) {
    return new Uint8Array(await object.arrayBuffer());
  }
  if (object.body) {
    const reader = object.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(next.value);
      total += next.value.byteLength;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }
  return new Uint8Array();
}

export async function readMediaObject(
  bucket: ResearchMediaBucket,
  key: string,
  range?: { offset: number; length: number },
): Promise<MediaObject | null> {
  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) return null;
  const body = await readBody(object);
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

export async function purgeOrphanMedia(
  database: ResearchDatabase,
  bucket: ResearchMediaBucket,
  now: number,
  maxAgeMs: number,
): Promise<number> {
  const rows = await listOrphanMedia(database, now - maxAgeMs);
  let removed = 0;
  for (const row of rows) {
    if (!(await deleteMediaRow(database, row.id))) continue;
    await bucket.delete(row.object_key);
    removed += 1;
  }
  return removed;
}

export function mediaDownloadName(role: string, mime: string): string {
  const base = role === "speech" ? "respuesta" : role === "audio" ? "audio" : "imagen";
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
  return `${base}.${extension}`.replace(/[^A-Za-z0-9._-]/g, "");
}

export function mediaResponse(input: {
  bytes: Uint8Array;
  mime: string;
  total: number;
  filename: string;
  range: { start: number; end: number } | null;
}): Response {
  const headers = new Headers({
    "content-type": input.mime,
    "x-content-type-options": "nosniff",
    "content-disposition": `inline; filename="${input.filename}"`,
    "cache-control": "private, no-store",
    "accept-ranges": "bytes",
  });
  if (input.range) {
    headers.set("content-length", String(input.bytes.byteLength));
    headers.set(
      "content-range",
      `bytes ${String(input.range.start)}-${String(input.range.end)}/${String(input.total)}`,
    );
    return new Response(input.bytes, { status: 206, headers });
  }
  headers.set("content-length", String(input.total));
  return new Response(input.bytes, { status: 200, headers });
}

export function parseRange(
  header: string | null,
  total: number,
): { start: number; end: number } | "invalid" | null {
  if (header === null || header.length === 0) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!match?.[1]) return "invalid";
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start > end ||
    start >= total ||
    end >= total
  ) {
    return "invalid";
  }
  return { start, end };
}
