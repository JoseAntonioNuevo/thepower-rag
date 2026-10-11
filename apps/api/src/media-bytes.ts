import { MEDIA_LIMITS } from "@thepower-rag/contracts";

export type MediaRole = "image" | "audio";

export interface ImageFacts {
  role: "image";
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
}

export interface AudioFacts {
  role: "audio";
  mime: "audio/wav";
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

export type MediaFacts = ImageFacts | AudioFacts;

export type MediaRejection =
  | "empty"
  | "oversized"
  | "malformed"
  | "unsupported"
  | "dimensions"
  | "duration";

export function rejectMedia(reason: MediaRejection): { ok: false; reason: MediaRejection } {
  return { ok: false, reason };
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function u16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function looksLikeMarkup(bytes: Uint8Array): boolean {
  const head = new TextDecoder()
    .decode(bytes.subarray(0, Math.min(bytes.length, 64)))
    .toLowerCase();
  return head.includes("<svg") || head.includes("<html") || head.includes("<!doctype");
}

function imageEdges(width: number, height: number): boolean {
  return (
    width >= MEDIA_LIMITS.minImageEdge &&
    height >= MEDIA_LIMITS.minImageEdge &&
    width <= MEDIA_LIMITS.maxImageEdge &&
    height <= MEDIA_LIMITS.maxImageEdge
  );
}

let pngCrcTable: Uint32Array | null = null;

function pngCrc(bytes: Uint8Array, start: number, length: number): number {
  if (pngCrcTable === null) {
    pngCrcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      pngCrcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[start + index] ?? 0;
    crc = (pngCrcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngColorLegal(bitDepth: number, color: number): boolean {
  if (color === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  if (color === 2) return bitDepth === 8 || bitDepth === 16;
  if (color === 3) return [1, 2, 4, 8].includes(bitDepth);
  if (color === 4 || color === 6) return bitDepth === 8 || bitDepth === 16;
  return false;
}

/** Tope del PNG ya inflado. Cubre 1.600 px, RGBA de 16 bit y el filtro de cada fila. */
const PNG_DECODE_MAX = 20_500_000;

function pngBitsPerPixel(bitDepth: number, color: number): number {
  const samples = color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 1;
  return samples * bitDepth;
}

function pngPlanes(
  width: number,
  height: number,
  interlace: number,
): Array<{ width: number; height: number }> {
  if (interlace === 0) return [{ width, height }];
  const originX = [0, 4, 0, 2, 0, 1, 0];
  const originY = [0, 0, 4, 0, 2, 0, 1];
  const stepX = [8, 8, 4, 4, 2, 2, 1];
  const stepY = [8, 8, 8, 4, 4, 2, 2];
  return originX.map((x0, pass) => {
    const y0 = originY[pass] ?? 0;
    const dx = stepX[pass] ?? 1;
    const dy = stepY[pass] ?? 1;
    return {
      width: width > x0 ? Math.ceil((width - x0) / dx) : 0,
      height: height > y0 ? Math.ceil((height - y0) / dy) : 0,
    };
  });
}

function pngStride(width: number, bitsPerPixel: number): number {
  if (width <= 0) return 0;
  return 1 + Math.ceil((width * bitsPerPixel) / 8);
}

function pngImageBytes(
  width: number,
  height: number,
  bitDepth: number,
  color: number,
  interlace: number,
): number {
  const bits = pngBitsPerPixel(bitDepth, color);
  let total = 0;
  for (const plane of pngPlanes(width, height, interlace)) {
    if (plane.width === 0 || plane.height === 0) continue;
    total += pngStride(plane.width, bits) * plane.height;
  }
  return total;
}

function pngFiltersLegal(
  inflated: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  color: number,
  interlace: number,
): boolean {
  const bits = pngBitsPerPixel(bitDepth, color);
  let offset = 0;
  for (const plane of pngPlanes(width, height, interlace)) {
    if (plane.width === 0 || plane.height === 0) continue;
    const stride = pngStride(plane.width, bits);
    for (let row = 0; row < plane.height; row += 1) {
      if ((inflated[offset] ?? 99) > 4) return false;
      offset += stride;
    }
  }
  return offset === inflated.length;
}

async function inflateZlib(data: Uint8Array, expected: number): Promise<Uint8Array | null> {
  if (expected < 1 || expected > PNG_DECODE_MAX) return null;
  if (data.byteLength < 6 || data.byteLength > MEDIA_LIMITS.maxImageBytes) return null;
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || (flg & 0x20) !== 0) return null;
  if (((cmf << 8) | flg) % 31 !== 0) return null;
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
    const reader = stream.getReader();
    while (total <= expected) {
      const step = await reader.read();
      if (step.done) break;
      total += step.value.byteLength;
      if (total > expected) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      parts.push(step.value);
    }
  } catch {
    return null;
  }
  if (total !== expected) return null;
  const inflated = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    inflated.set(part, offset);
    offset += part.byteLength;
  }
  return inflated;
}

async function parsePng(bytes: Uint8Array): Promise<ImageFacts | null> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < signature.length + 8 + 13 + 4 + 12) return null;
  if (signature.some((byte, index) => bytes[index] !== byte)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let interlace = 0;
  let sawHeader = false;
  let sawData = false;
  let dataBytes = 0;
  let dataOpen = false;
  let sawPalette = false;
  let color = 0;
  const idatParts: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = u32(bytes, offset);
    if (length > bytes.length - offset - 12) return null;
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) return null;
    const actual = u32(bytes, offset + 8 + length);
    if (pngCrc(bytes, offset + 4, 4 + length) !== actual) return null;
    const data = offset + 8;
    if (!sawHeader) {
      if (type !== "IHDR" || length !== 13) return null;
      width = u32(bytes, data);
      height = u32(bytes, data + 4);
      bitDepth = bytes[data + 8] ?? 0;
      color = bytes[data + 9] ?? 99;
      const compression = bytes[data + 10] ?? 99;
      const filter = bytes[data + 11] ?? 99;
      interlace = bytes[data + 12] ?? 99;
      if (
        !pngColorLegal(bitDepth, color) ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1) ||
        !imageEdges(width, height)
      ) {
        return null;
      }
      sawHeader = true;
    } else if (type === "IHDR" || type === "IEND") {
      if (type !== "IEND" || length !== 0 || !sawData || dataBytes === 0) return null;
      if (color === 3 && !sawPalette) return null;
      if (offset + 12 !== bytes.length) return null;
      const idat = new Uint8Array(dataBytes);
      let written = 0;
      for (const part of idatParts) {
        idat.set(part, written);
        written += part.byteLength;
      }
      const expected = pngImageBytes(width, height, bitDepth, color, interlace);
      const inflated = await inflateZlib(idat, expected);
      if (
        inflated === null ||
        !pngFiltersLegal(inflated, width, height, bitDepth, color, interlace)
      ) {
        return null;
      }
      return { role: "image", mime: "image/png", width, height };
    } else if (type === "PLTE") {
      if (sawData || dataOpen || length < 3 || length > 768 || length % 3 !== 0) return null;
      if (color === 0 || color === 4) return null;
      sawPalette = true;
    } else if (type === "IDAT") {
      if (length === 0 || (sawData && !dataOpen)) return null;
      if (color === 3 && !sawPalette) return null;
      idatParts.push(bytes.subarray(data, data + length));
      dataBytes += length;
      if (dataBytes > MEDIA_LIMITS.maxImageBytes) return null;
      sawData = true;
      dataOpen = true;
    } else if (type[0] !== undefined && type[0] >= "A" && type[0] <= "Z") {
      return null;
    } else if (dataOpen) {
      dataOpen = false;
    }
    offset += 12 + length;
  }
  return null;
}

interface HuffmanTable {
  maxCode: Int32Array;
  minCode: Int32Array;
  valPtr: Int32Array;
  symbols: Uint8Array;
}

interface JpegComponent {
  id: number;
  h: number;
  v: number;
  index: number;
}

interface BitCursor {
  bytes: Uint8Array;
  offset: number;
  bitBuffer: number;
  bits: number;
  marker: number | null;
}

function buildHuffman(counts: readonly number[], symbols: Uint8Array): HuffmanTable | null {
  const maxCode = new Int32Array(17).fill(-1);
  const minCode = new Int32Array(17);
  const valPtr = new Int32Array(17);
  let code = 0;
  let index = 0;
  for (let length = 1; length <= 16; length += 1) {
    const count = counts[length] ?? 0;
    if (count > 0) {
      valPtr[length] = index;
      minCode[length] = code;
      index += count;
      maxCode[length] = code + count - 1;
    }
    code += count;
    if (code > 0x10000) return null;
    code <<= 1;
  }
  if (index !== symbols.length) return null;
  return { maxCode, minCode, valPtr, symbols };
}

function pullByte(cursor: BitCursor): number | null {
  if (cursor.marker !== null) return null;
  if (cursor.offset >= cursor.bytes.length) return null;
  const value = cursor.bytes[cursor.offset] ?? 0;
  cursor.offset += 1;
  if (value !== 0xff) return value;
  if (cursor.offset >= cursor.bytes.length) return null;
  const next = cursor.bytes[cursor.offset] ?? 0;
  cursor.offset += 1;
  if (next === 0x00) return 0xff;
  cursor.offset -= 2;
  cursor.marker = next;
  return null;
}

function readBit(cursor: BitCursor): number | null {
  if (cursor.bits === 0) {
    const value = pullByte(cursor);
    if (value === null) return null;
    cursor.bitBuffer = value;
    cursor.bits = 8;
  }
  cursor.bits -= 1;
  return (cursor.bitBuffer >> cursor.bits) & 1;
}

function readBits(cursor: BitCursor, count: number): number | null {
  let value = 0;
  for (let index = 0; index < count; index += 1) {
    const bit = readBit(cursor);
    if (bit === null) return null;
    value = (value << 1) | bit;
  }
  return value;
}

function huffmanSymbol(cursor: BitCursor, table: HuffmanTable): number | null {
  let code = 0;
  for (let length = 1; length <= 16; length += 1) {
    const bit = readBit(cursor);
    if (bit === null) return null;
    code = (code << 1) | bit;
    const max = table.maxCode[length] ?? -1;
    const min = table.minCode[length] ?? 0;
    if (max !== -1 && code <= max && code >= min) {
      const at = (table.valPtr[length] ?? 0) + (code - min);
      return table.symbols[at] ?? null;
    }
  }
  return null;
}

function extendMagnitude(value: number, count: number): number {
  if (count === 0) return 0;
  const threshold = 1 << (count - 1);
  return value < threshold ? value - ((1 << count) - 1) : value;
}

function decodeBlock(
  cursor: BitCursor,
  dcTable: HuffmanTable,
  acTable: HuffmanTable,
  prediction: { dc: number },
): boolean {
  const category = huffmanSymbol(cursor, dcTable);
  if (category === null || category > 11) return false;
  const extra = category === 0 ? 0 : readBits(cursor, category);
  if (extra === null) return false;
  prediction.dc += extendMagnitude(extra, category);
  let index = 1;
  while (index < 64) {
    const symbol = huffmanSymbol(cursor, acTable);
    if (symbol === null) return false;
    if (symbol === 0) return true;
    if (symbol === 0xf0) {
      index += 16;
      continue;
    }
    const run = symbol >> 4;
    const size = symbol & 0x0f;
    if (size === 0 || size > 10) return false;
    index += run;
    if (index >= 64) return false;
    const bits = readBits(cursor, size);
    if (bits === null) return false;
    extendMagnitude(bits, size);
    index += 1;
  }
  return index === 64;
}

function takeMarker(cursor: BitCursor): number | null {
  cursor.bits = 0;
  cursor.bitBuffer = 0;
  if (cursor.marker !== null) {
    const marker = cursor.marker;
    cursor.marker = null;
    cursor.offset += 2;
    return marker;
  }
  if (cursor.offset >= cursor.bytes.length || cursor.bytes[cursor.offset] !== 0xff) return null;
  while (cursor.offset < cursor.bytes.length && cursor.bytes[cursor.offset] === 0xff) {
    cursor.offset += 1;
  }
  if (cursor.offset >= cursor.bytes.length) return null;
  const marker = cursor.bytes[cursor.offset] ?? 0;
  cursor.offset += 1;
  return marker;
}

function parseJpeg(bytes: Uint8Array): ImageFacts | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  const dcTables: Array<HuffmanTable | null> = [null, null, null, null];
  const acTables: Array<HuffmanTable | null> = [null, null, null, null];
  const quant = [false, false, false, false];
  let width = 0;
  let height = 0;
  let frame: JpegComponent[] | null = null;
  let restartInterval = 0;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9) return null;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (offset + 1 >= bytes.length) return null;
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (length < 2 || offset + length > bytes.length) return null;
    const data = offset + 2;
    const end = offset + length;
    if (marker === 0xda) {
      if (frame === null) return null;
      const count = bytes[data] ?? 0;
      if (count !== frame.length || length < 6 + count * 2) return null;
      const scanComponents: Array<JpegComponent & { dcId: number; acId: number }> = [];
      for (let index = 0; index < count; index += 1) {
        const id = bytes[data + 1 + index * 2] ?? 0;
        const tables = bytes[data + 2 + index * 2] ?? 0;
        const component = frame.find((item) => item.id === id);
        const dcId = tables >> 4;
        const acId = tables & 0x0f;
        const dcTable = dcTables[dcId];
        const acTable = acTables[acId];
        if (component === undefined || dcTable === undefined || acTable === undefined) return null;
        if (dcTable === null || acTable === null) return null;
        scanComponents.push({ ...component, dcId, acId });
      }
      if (
        bytes[end - 3] !== 0 ||
        bytes[end - 2] !== 63 ||
        bytes[end - 1] !== 0 ||
        !imageEdges(width, height)
      ) {
        return null;
      }
      const maxH = Math.max(...frame.map((item) => item.h));
      const maxV = Math.max(...frame.map((item) => item.v));
      const mcus = Math.ceil(width / (maxH * 8)) * Math.ceil(height / (maxV * 8));
      if (!Number.isSafeInteger(mcus) || mcus < 1 || mcus > 40_000) return null;
      const cursor: BitCursor = {
        bytes,
        offset: end,
        bitBuffer: 0,
        bits: 0,
        marker: null,
      };
      const predictions = frame.map(() => ({ dc: 0 }));
      let restart = 0;
      for (let mcu = 0; mcu < mcus; mcu += 1) {
        if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
          if (takeMarker(cursor) !== 0xd0 + restart) return null;
          restart = (restart + 1) & 7;
          for (const prediction of predictions) prediction.dc = 0;
        }
        for (const component of scanComponents) {
          const dcTable = dcTables[component.dcId];
          const acTable = acTables[component.acId];
          const prediction = predictions[component.index];
          if (
            dcTable === null ||
            dcTable === undefined ||
            acTable === null ||
            acTable === undefined ||
            prediction === undefined
          ) {
            return null;
          }
          for (let block = 0; block < component.h * component.v; block += 1) {
            if (!decodeBlock(cursor, dcTable, acTable, prediction)) return null;
          }
        }
      }
      if (takeMarker(cursor) !== 0xd9 || cursor.offset !== bytes.length) return null;
      return { role: "image", mime: "image/jpeg", width, height };
    }
    if (marker === 0xc0) {
      const precision = bytes[data] ?? 0;
      height = ((bytes[data + 1] ?? 0) << 8) | (bytes[data + 2] ?? 0);
      width = ((bytes[data + 3] ?? 0) << 8) | (bytes[data + 4] ?? 0);
      const count = bytes[data + 5] ?? 0;
      if (precision !== 8 || count < 1 || count > 4 || length !== 8 + count * 3) return null;
      if (!imageEdges(width, height)) return null;
      const seen = new Set<number>();
      frame = [];
      let samples = 0;
      for (let index = 0; index < count; index += 1) {
        const id = bytes[data + 6 + index * 3] ?? 0;
        const sampling = bytes[data + 7 + index * 3] ?? 0;
        const table = bytes[data + 8 + index * 3] ?? 9;
        const horizontal = sampling >> 4;
        const vertical = sampling & 0x0f;
        if (
          seen.has(id) ||
          horizontal < 1 ||
          horizontal > 4 ||
          vertical < 1 ||
          vertical > 4 ||
          table > 3 ||
          !quant[table]
        ) {
          return null;
        }
        seen.add(id);
        samples += horizontal * vertical;
        frame.push({ id, h: horizontal, v: vertical, index });
      }
      if (samples < 1 || samples > 10) return null;
    } else if (marker === 0xdb) {
      let cursor = data;
      while (cursor < end) {
        const info = bytes[cursor] ?? 0;
        const precision = info >> 4;
        const id = info & 0x0f;
        const size = precision === 0 ? 64 : 128;
        if (id > 3 || precision > 1 || cursor + 1 + size > end) return null;
        quant[id] = true;
        cursor += 1 + size;
      }
      if (cursor !== end) return null;
    } else if (marker === 0xc4) {
      let cursor = data;
      while (cursor < end) {
        const info = bytes[cursor] ?? 0;
        const kind = info >> 4;
        const id = info & 0x0f;
        if ((kind !== 0 && kind !== 1) || id > 3 || cursor + 17 > end) return null;
        const counts = [0];
        for (let length = 0; length < 16; length += 1) counts.push(bytes[cursor + 1 + length] ?? 0);
        const total = counts.reduce((sum, count) => sum + count, 0);
        if (total > 256 || cursor + 17 + total > end) return null;
        const table = buildHuffman(counts, bytes.subarray(cursor + 17, cursor + 17 + total));
        if (table === null) return null;
        (kind === 0 ? dcTables : acTables)[id] = table;
        cursor += 17 + total;
      }
      if (cursor !== end) return null;
    } else if (marker === 0xdd) {
      if (length !== 4) return null;
      restartInterval = ((bytes[data] ?? 0) << 8) | (bytes[data + 1] ?? 0);
    } else if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
      return null;
    } else if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      return null;
    }
    offset = end;
  }
  return null;
}

function parseWav(
  bytes: Uint8Array,
):
  | { ok: true; facts: AudioFacts }
  | { ok: false; reason: "malformed" | "unsupported" | "duration" } {
  if (bytes.length < 44) {
    return { ok: false, reason: "malformed" };
  }
  const id = (offset: number) => new TextDecoder().decode(bytes.subarray(offset, offset + 4));
  if (id(0) !== "RIFF" || id(8) !== "WAVE") {
    return { ok: false, reason: "malformed" };
  }
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataBytes = 0;
  let sawFormat = false;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const size = u32le(bytes, offset + 4);
    const start = offset + 8;
    if (size > bytes.length - start) {
      return { ok: false, reason: "malformed" };
    }
    const kind = id(offset);
    if (kind === "fmt ") {
      if (size < 16) return { ok: false, reason: "malformed" };
      sawFormat = true;
      format = u16(bytes, start);
      channels = u16(bytes, start + 2);
      sampleRate = u32le(bytes, start + 4);
      bits = u16(bytes, start + 14);
    } else if (kind === "data") {
      dataBytes = size;
    }
    offset = start + size + (size % 2);
  }
  if (!sawFormat || dataBytes < 2 || dataBytes % 2 !== 0) {
    return { ok: false, reason: "malformed" };
  }
  if (
    format !== 1 ||
    channels !== MEDIA_LIMITS.audioChannels ||
    sampleRate !== MEDIA_LIMITS.audioSampleRate ||
    bits !== MEDIA_LIMITS.audioBitDepth
  ) {
    return { ok: false, reason: "unsupported" };
  }
  const frames = dataBytes / 2;
  const durationMs = Math.round((frames * 1000) / sampleRate);
  if (durationMs < MEDIA_LIMITS.minAudioMs || durationMs > MEDIA_LIMITS.maxAudioMs) {
    return { ok: false, reason: "duration" };
  }
  return {
    ok: true,
    facts: {
      role: "audio",
      mime: "audio/wav",
      durationMs,
      sampleRate,
      channels,
      bitDepth: bits,
    },
  };
}

/**
 * Valida los bytes. La cabecera MIME declarada no se consulta.
 * PNG y JPEG baseline se decodifican aquí, con tope de salida. No se llama a un proveedor.
 */
export async function inspectMedia(
  bytes: Uint8Array,
): Promise<{ ok: true; facts: MediaFacts } | { ok: false; reason: MediaRejection }> {
  if (bytes.length === 0 || looksLikeMarkup(bytes)) {
    return rejectMedia(bytes.length === 0 ? "empty" : "unsupported");
  }
  const png = bytes[0] === 137;
  const jpeg = bytes[0] === 0xff;
  const wav = bytes[0] === 0x52;
  if (png) {
    if (bytes.length > MEDIA_LIMITS.maxImageBytes) return rejectMedia("oversized");
    const facts = await parsePng(bytes);
    if (facts === null) {
      return imageEdges(u32(bytes, 16), u32(bytes, 20))
        ? rejectMedia("malformed")
        : rejectMedia("dimensions");
    }
    return { ok: true, facts };
  }
  if (jpeg) {
    if (bytes.length > MEDIA_LIMITS.maxImageBytes) return rejectMedia("oversized");
    const facts = parseJpeg(bytes);
    return facts === null ? rejectMedia("malformed") : { ok: true, facts };
  }
  if (wav) {
    if (bytes.length > MEDIA_LIMITS.maxAudioBytes) return rejectMedia("oversized");
    const facts = parseWav(bytes);
    return facts.ok ? { ok: true, facts: facts.facts } : rejectMedia(facts.reason);
  }
  return rejectMedia("unsupported");
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

/** Tono PCM local. No es la voz de un modelo. */
export function toneWav(durationMs = 400, frequency = 440): Uint8Array {
  const rate = MEDIA_LIMITS.audioSampleRate;
  const frames = Math.max(1, Math.round((rate * durationMs) / 1000));
  const data = new Uint8Array(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * frame) / rate) * 8000);
    data[frame * 2] = sample & 0xff;
    data[frame * 2 + 1] = (sample >> 8) & 0xff;
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + data.length, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, data.length, true);
  const wav = new Uint8Array(44 + data.length);
  wav.set(new Uint8Array(header), 0);
  wav.set(data, 44);
  return wav;
}
