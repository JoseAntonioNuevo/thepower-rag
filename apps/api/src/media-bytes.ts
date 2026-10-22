// GUÍA DE LECTURA · apps/api/src/media-bytes.ts
// Inspección de bytes subidos: decide el tipo real por el contenido (no por el MIME declarado) y valida
// PNG, JPEG baseline y WAV PCM de punta a punta, con topes de tamaño y de descompresión. También calcula
// hashes y genera el tono WAV de prueba. Ningún archivo llega a un proveedor sin pasar por aquí.
// Límites de medios.
import { MEDIA_LIMITS } from "@thepower-rag/contracts";

// Papel del archivo: imagen o audio.
export type MediaRole = "image" | "audio";

// Datos de una imagen válida.
export interface ImageFacts {
  // Papel.
  role: "image";
  // Tipo real.
  mime: "image/png" | "image/jpeg";
  // Ancho en píxeles.
  width: number;
  // Alto en píxeles.
  height: number;
}

// Datos de un audio válido.
export interface AudioFacts {
  // Papel.
  role: "audio";
  // Tipo real.
  mime: "audio/wav";
  // Duración.
  durationMs: number;
  // Frecuencia de muestreo.
  sampleRate: number;
  // Canales.
  channels: number;
  // Bits por muestra.
  bitDepth: number;
}

// Datos de una imagen o de un audio.
export type MediaFacts = ImageFacts | AudioFacts;

// Motivos de rechazo.
export type MediaRejection =
  | "empty"
  | "oversized"
  | "malformed"
  | "unsupported"
  | "dimensions"
  | "duration";

// Resultado de rechazo con su motivo.
export function rejectMedia(reason: MediaRejection): { ok: false; reason: MediaRejection } {
  // Objeto de error.
  return { ok: false, reason };
}

// Lee 4 bytes como entero sin signo big-endian (PNG).
function u32(bytes: Uint8Array, offset: number): number {
  // Desplaza cada byte y >>> 0 lo deja sin signo.
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

// Lee 2 bytes little-endian (WAV).
function u16(bytes: Uint8Array, offset: number): number {
  // Byte bajo más byte alto desplazado.
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

// Lee 4 bytes little-endian sin signo (WAV).
function u32le(bytes: Uint8Array, offset: number): number {
  // Combina los cuatro bytes.
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

// ¿Empieza como SVG o HTML? Se rechaza aunque diga ser imagen.
function looksLikeMarkup(bytes: Uint8Array): boolean {
  // Primeros 64 bytes como texto en minúsculas.
  const head = new TextDecoder()
    .decode(bytes.subarray(0, Math.min(bytes.length, 64)))
    .toLowerCase();
  // Marcas de SVG o HTML.
  return head.includes("<svg") || head.includes("<html") || head.includes("<!doctype");
}

// ¿Lados dentro del mínimo y del máximo?
function imageEdges(width: number, height: number): boolean {
  // Comprueba ancho y alto.
  return (
    width >= MEDIA_LIMITS.minImageEdge &&
    height >= MEDIA_LIMITS.minImageEdge &&
    width <= MEDIA_LIMITS.maxImageEdge &&
    height <= MEDIA_LIMITS.maxImageEdge
  );
}

// Tabla del CRC-32 de PNG, calculada una vez.
let pngCrcTable: Uint32Array | null = null;

// CRC-32 de un trozo, como lo exige cada chunk PNG.
function pngCrc(bytes: Uint8Array, start: number, length: number): number {
  // Primera vez: construye la tabla.
  if (pngCrcTable === null) {
    // 256 entradas.
    pngCrcTable = new Uint32Array(256);
    // Cada byte posible.
    for (let index = 0; index < 256; index += 1) {
      // Valor inicial.
      let value = index;
      // 8 pasos por bit.
      for (let bit = 0; bit < 8; bit += 1) {
        // Polinomio del CRC-32.
        value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      // Guarda sin signo.
      pngCrcTable[index] = value >>> 0;
    }
  }
  // CRC inicial.
  let crc = 0xffffffff;
  // Cada byte del trozo.
  for (let index = 0; index < length; index += 1) {
    // Byte.
    const byte = bytes[start + index] ?? 0;
    // Actualiza con la tabla.
    crc = (pngCrcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  // CRC final.
  return (crc ^ 0xffffffff) >>> 0;
}

// ¿Combinación válida de profundidad y tipo de color PNG?
function pngColorLegal(bitDepth: number, color: number): boolean {
  // Escala de grises.
  if (color === 0) return [1, 2, 4, 8, 16].includes(bitDepth);
  // RGB.
  if (color === 2) return bitDepth === 8 || bitDepth === 16;
  // Paleta.
  if (color === 3) return [1, 2, 4, 8].includes(bitDepth);
  // Gris con alfa o RGBA.
  if (color === 4 || color === 6) return bitDepth === 8 || bitDepth === 16;
  // Otro tipo: inválido.
  return false;
}

/** Tope del PNG ya inflado. Cubre 1.600 px, RGBA de 16 bit y el filtro de cada fila. */
const PNG_DECODE_MAX = 20_500_000;

// Bits por píxel según el tipo de color.
function pngBitsPerPixel(bitDepth: number, color: number): number {
  // Muestras por píxel.
  const samples = color === 2 ? 3 : color === 4 ? 2 : color === 6 ? 4 : 1;
  // Muestras por profundidad.
  return samples * bitDepth;
}

// Tamaño de cada pasada: una sin entrelazado, siete con Adam7.
function pngPlanes(
  width: number,
  height: number,
  interlace: number,
): Array<{ width: number; height: number }> {
  // Sin entrelazado: una sola.
  if (interlace === 0) return [{ width, height }];
  // Origen x de cada pasada Adam7.
  const originX = [0, 4, 0, 2, 0, 1, 0];
  // Origen y.
  const originY = [0, 0, 4, 0, 2, 0, 1];
  // Paso x.
  const stepX = [8, 8, 4, 4, 2, 2, 1];
  // Paso y.
  const stepY = [8, 8, 8, 4, 4, 2, 2];
  // Tamaño de cada pasada.
  return originX.map((x0, pass) => {
    // Origen y.
    const y0 = originY[pass] ?? 0;
    // Paso x.
    const dx = stepX[pass] ?? 1;
    // Paso y.
    const dy = stepY[pass] ?? 1;
    // Ancho y alto de la pasada.
    return {
      width: width > x0 ? Math.ceil((width - x0) / dx) : 0,
      height: height > y0 ? Math.ceil((height - y0) / dy) : 0,
    };
  });
}

// Bytes por fila: 1 de filtro más los píxeles.
function pngStride(width: number, bitsPerPixel: number): number {
  // Sin ancho, nada.
  if (width <= 0)
    // Usa cero como resultado de esta rama sin añadir coincidencias ni consumo adicional.
    return 0;
  // Filtro y datos redondeados a bytes.
  return 1 + Math.ceil((width * bitsPerPixel) / 8);
}

// Bytes esperados de la imagen ya inflada.
function pngImageBytes(
  width: number,
  height: number,
  bitDepth: number,
  color: number,
  interlace: number,
): number {
  // Bits por píxel.
  const bits = pngBitsPerPixel(bitDepth, color);
  // Total.
  let total = 0;
  // Cada pasada.
  for (const plane of pngPlanes(width, height, interlace)) {
    // Vacía: se salta.
    if (plane.width === 0 || plane.height === 0)
      // Omite el resto de esta iteración y pasa al siguiente elemento.
      continue;
    // Suma filas por bytes de fila.
    total += pngStride(plane.width, bits) * plane.height;
  }
  // Total.
  return total;
}

// ¿Cada fila empieza con un filtro válido (0-4) y el tamaño cuadra?
function pngFiltersLegal(
  inflated: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  color: number,
  interlace: number,
): boolean {
  // Bits por píxel.
  const bits = pngBitsPerPixel(bitDepth, color);
  // Posición.
  let offset = 0;
  // Cada pasada.
  for (const plane of pngPlanes(width, height, interlace)) {
    // Vacía: se salta.
    if (plane.width === 0 || plane.height === 0)
      // Omite el resto de esta iteración y pasa al siguiente elemento.
      continue;
    // Bytes por fila.
    const stride = pngStride(plane.width, bits);
    // Cada fila.
    for (let row = 0; row < plane.height; row += 1) {
      // Filtro inválido.
      if ((inflated[offset] ?? 99) > 4)
        // Rechaza esta condición y comunica el resultado negativo al llamador.
        return false;
      // Siguiente fila.
      offset += stride;
    }
  }
  // Debe acabar justo al final.
  return offset === inflated.length;
}

// Descomprime zlib con tope: si sale más o menos de lo esperado, null.
async function inflateZlib(data: Uint8Array, expected: number): Promise<Uint8Array | null> {
  // Tamaño esperado fuera de rango.
  if (expected < 1 || expected > PNG_DECODE_MAX)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Datos demasiado cortos o grandes.
  if (data.byteLength < 6 || data.byteLength > MEDIA_LIMITS.maxImageBytes)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Byte CMF.
  const cmf = data[0] ?? 0;
  // Byte FLG.
  const flg = data[1] ?? 0;
  // Método deflate, ventana válida y sin diccionario.
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7 || (flg & 0x20) !== 0)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Comprobación de la cabecera.
  if (((cmf << 8) | flg) % 31 !== 0)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Trozos descomprimidos.
  const parts: Uint8Array[] = [];
  // Total.
  let total = 0;
  // Un error de descompresión da null.
  try {
    // Stream de descompresión.
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
    // Lector.
    const reader = stream.getReader();
    // Mientras no pase del esperado.
    while (total <= expected) {
      // Siguiente trozo.
      const step = await reader.read();
      // Fin.
      if (step.done)
        // Detiene el bucle al alcanzar la condición de parada de esta rama.
        break;
      // Suma.
      total += step.value.byteLength;
      // Se pasa: posible bomba de descompresión.
      if (total > expected) {
        // Cancela.
        await reader.cancel().catch(() => undefined);
        // null.
        return null;
      }
      // Guarda.
      parts.push(step.value);
    }
  } catch {
    // null.
    return null;
  }
  // Debe ser exacto.
  if (total !== expected)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Une los trozos.
  const inflated = new Uint8Array(total);
  // Posición.
  let offset = 0;
  // Cada trozo.
  for (const part of parts) {
    // Copia.
    inflated.set(part, offset);
    // Avanza.
    offset += part.byteLength;
  }
  // Bytes inflados.
  return inflated;
}

// Valida un PNG completo: firma, chunks con CRC, cabecera, paleta, datos e IEND final.
async function parsePng(bytes: Uint8Array): Promise<ImageFacts | null> {
  // Firma PNG.
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  // Demasiado corto.
  if (bytes.length < signature.length + 8 + 13 + 4 + 12)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Firma distinta.
  if (signature.some((byte, index) => bytes[index] !== byte))
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Tras la firma.
  let offset = 8;
  // Ancho.
  let width = 0;
  // Alto.
  let height = 0;
  // Profundidad.
  let bitDepth = 0;
  // Entrelazado.
  let interlace = 0;
  // ¿Vista la cabecera?
  let sawHeader = false;
  // ¿Vistos datos?
  let sawData = false;
  // Bytes de datos.
  let dataBytes = 0;
  // ¿Bloque de datos abierto?
  let dataOpen = false;
  // ¿Vista paleta?
  let sawPalette = false;
  // Tipo de color.
  let color = 0;
  // Trozos IDAT.
  const idatParts: Uint8Array[] = [];
  // Recorre los chunks.
  while (offset + 12 <= bytes.length) {
    // Longitud del chunk.
    const length = u32(bytes, offset);
    // No cabe.
    if (length > bytes.length - offset - 12)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Tipo de 4 letras.
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    // Inválido.
    if (!/^[A-Za-z]{4}$/.test(type))
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // CRC guardado.
    const actual = u32(bytes, offset + 8 + length);
    // CRC incorrecto.
    if (pngCrc(bytes, offset + 4, 4 + length) !== actual)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Inicio de los datos.
    const data = offset + 8;
    // El primero debe ser IHDR.
    if (!sawHeader) {
      // No lo es.
      if (type !== "IHDR" || length !== 13)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Ancho.
      width = u32(bytes, data);
      // Alto.
      height = u32(bytes, data + 4);
      // Profundidad.
      bitDepth = bytes[data + 8] ?? 0;
      // Color.
      color = bytes[data + 9] ?? 99;
      // Compresión.
      const compression = bytes[data + 10] ?? 99;
      // Filtro.
      const filter = bytes[data + 11] ?? 99;
      // Entrelazado.
      interlace = bytes[data + 12] ?? 99;
      // Valores no admitidos o lados fuera de rango.
      if (
        !pngColorLegal(bitDepth, color) ||
        compression !== 0 ||
        filter !== 0 ||
        (interlace !== 0 && interlace !== 1) ||
        !imageEdges(width, height)
      ) {
        // null.
        return null;
      }
      // Cabecera vista.
      sawHeader = true;
    } else if (type === "IHDR" || type === "IEND") {
      // IEND vacío y con datos previos.
      if (type !== "IEND" || length !== 0 || !sawData || dataBytes === 0)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Paleta obligatoria.
      if (color === 3 && !sawPalette)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // IEND debe ser el último.
      if (offset + 12 !== bytes.length)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Une los IDAT.
      const idat = new Uint8Array(dataBytes);
      // Posición.
      let written = 0;
      // Cada trozo.
      for (const part of idatParts) {
        // Copia.
        idat.set(part, written);
        // Avanza.
        written += part.byteLength;
      }
      // Bytes esperados.
      const expected = pngImageBytes(width, height, bitDepth, color, interlace);
      // Descomprime.
      const inflated = await inflateZlib(idat, expected);
      // Inválido o filtros incorrectos.
      if (
        inflated === null ||
        !pngFiltersLegal(inflated, width, height, bitDepth, color, interlace)
      ) {
        // null.
        return null;
      }
      // PNG válido.
      return { role: "image", mime: "image/png", width, height };
    } else if (type === "PLTE") {
      // Paleta en sitio y tamaño correctos.
      if (sawData || dataOpen || length < 3 || length > 768 || length % 3 !== 0)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Gris no lleva paleta.
      if (color === 0 || color === 4)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Paleta vista.
      sawPalette = true;
    } else if (type === "IDAT") {
      // IDAT vacío o separado.
      if (length === 0 || (sawData && !dataOpen))
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Falta la paleta.
      if (color === 3 && !sawPalette)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Guarda el trozo.
      idatParts.push(bytes.subarray(data, data + length));
      // Suma.
      dataBytes += length;
      // Demasiado grande.
      if (dataBytes > MEDIA_LIMITS.maxImageBytes)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Datos vistos.
      sawData = true;
      // Bloque abierto.
      dataOpen = true;
    } else if (type[0] !== undefined && type[0] >= "A" && type[0] <= "Z") {
      // Chunk crítico desconocido.
      return null;
    } else if (dataOpen) {
      // Cierra el bloque de datos.
      dataOpen = false;
    }
    // Siguiente chunk.
    offset += 12 + length;
  }
  // Sin IEND.
  return null;
}

// Tabla Huffman de JPEG.
interface HuffmanTable {
  // Código máximo por longitud.
  maxCode: Int32Array;
  // Código mínimo.
  minCode: Int32Array;
  // Índice del primer símbolo.
  valPtr: Int32Array;
  // Símbolos.
  symbols: Uint8Array;
}

// Componente de color JPEG.
interface JpegComponent {
  // Id.
  id: number;
  // Muestreo horizontal.
  h: number;
  // Muestreo vertical.
  v: number;
  // Posición.
  index: number;
}

// Cursor de lectura bit a bit.
interface BitCursor {
  // Bytes.
  bytes: Uint8Array;
  // Posición.
  offset: number;
  // Byte actual.
  bitBuffer: number;
  // Bits que quedan.
  bits: number;
  // Marcador encontrado.
  marker: number | null;
}

// Construye la tabla Huffman a partir del número de códigos por longitud.
function buildHuffman(counts: readonly number[], symbols: Uint8Array): HuffmanTable | null {
  // Máximos (-1 = ninguno).
  const maxCode = new Int32Array(17).fill(-1);
  // Mínimos.
  const minCode = new Int32Array(17);
  // Índices.
  const valPtr = new Int32Array(17);
  // Código actual.
  let code = 0;
  // Símbolo actual.
  let index = 0;
  // Longitudes 1-16.
  for (let length = 1; length <= 16; length += 1) {
    // Códigos de esa longitud.
    const count = counts[length] ?? 0;
    // Si hay.
    if (count > 0) {
      // Primer símbolo.
      valPtr[length] = index;
      // Primer código.
      minCode[length] = code;
      // Avanza.
      index += count;
      // Último código.
      maxCode[length] = code + count - 1;
    }
    // Siguiente código.
    code += count;
    // Tabla imposible.
    if (code > 0x10000)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Siguiente longitud.
    code <<= 1;
  }
  // Debe usar todos los símbolos.
  if (index !== symbols.length)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Tabla.
  return { maxCode, minCode, valPtr, symbols };
}

// Siguiente byte del escaneo; FF 00 vale FF y otro FF xx es un marcador.
function pullByte(cursor: BitCursor): number | null {
  // Marcador pendiente.
  if (cursor.marker !== null)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Fin de datos.
  if (cursor.offset >= cursor.bytes.length)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Byte.
  const value = cursor.bytes[cursor.offset] ?? 0;
  // Avanza.
  cursor.offset += 1;
  // Byte normal.
  if (value !== 0xff) return value;
  // Fin tras FF.
  if (cursor.offset >= cursor.bytes.length)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Siguiente.
  const next = cursor.bytes[cursor.offset] ?? 0;
  // Avanza.
  cursor.offset += 1;
  // Relleno: FF.
  if (next === 0x00) return 0xff;
  // Retrocede al marcador.
  cursor.offset -= 2;
  // Guarda el marcador.
  cursor.marker = next;
  // null.
  return null;
}

// Lee un bit.
function readBit(cursor: BitCursor): number | null {
  // Sin bits.
  if (cursor.bits === 0) {
    // Siguiente byte.
    const value = pullByte(cursor);
    // Fin.
    if (value === null)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Byte.
    cursor.bitBuffer = value;
    // 8 bits.
    cursor.bits = 8;
  }
  // Uno menos.
  cursor.bits -= 1;
  // Bit actual.
  return (cursor.bitBuffer >> cursor.bits) & 1;
}

// Lee varios bits como entero.
function readBits(cursor: BitCursor, count: number): number | null {
  // Valor.
  let value = 0;
  // Cada bit.
  for (let index = 0; index < count; index += 1) {
    // Bit.
    const bit = readBit(cursor);
    // Fin.
    if (bit === null)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Lo añade.
    value = (value << 1) | bit;
  }
  // Valor.
  return value;
}

// Lee un símbolo Huffman.
function huffmanSymbol(cursor: BitCursor, table: HuffmanTable): number | null {
  // Código.
  let code = 0;
  // Longitudes 1-16.
  for (let length = 1; length <= 16; length += 1) {
    // Bit.
    const bit = readBit(cursor);
    // Fin.
    if (bit === null)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Lo añade.
    code = (code << 1) | bit;
    // Máximo.
    const max = table.maxCode[length] ?? -1;
    // Mínimo.
    const min = table.minCode[length] ?? 0;
    // Código válido de esta longitud.
    if (max !== -1 && code <= max && code >= min) {
      // Índice del símbolo.
      const at = (table.valPtr[length] ?? 0) + (code - min);
      // Símbolo.
      return table.symbols[at] ?? null;
    }
  }
  // Código inexistente.
  return null;
}

// Convierte un valor y su tamaño en el entero con signo de JPEG.
function extendMagnitude(value: number, count: number): number {
  // Tamaño 0.
  if (count === 0)
    // Usa cero como resultado de esta rama sin añadir coincidencias ni consumo adicional.
    return 0;
  // Umbral.
  const threshold = 1 << (count - 1);
  // Negativo o positivo.
  return value < threshold ? value - ((1 << count) - 1) : value;
}

// Decodifica un bloque 8×8 para comprobar que el escaneo es coherente.
function decodeBlock(
  cursor: BitCursor,
  dcTable: HuffmanTable,
  acTable: HuffmanTable,
  prediction: { dc: number },
): boolean {
  // Categoría DC.
  const category = huffmanSymbol(cursor, dcTable);
  // Inválida.
  if (category === null || category > 11)
    // Rechaza esta condición y comunica el resultado negativo al llamador.
    return false;
  // Bits extra.
  const extra = category === 0 ? 0 : readBits(cursor, category);
  // Fin.
  if (extra === null)
    // Rechaza esta condición y comunica el resultado negativo al llamador.
    return false;
  // Actualiza la predicción DC.
  prediction.dc += extendMagnitude(extra, category);
  // Coeficiente actual.
  let index = 1;
  // Los 63 coeficientes AC.
  while (index < 64) {
    // Símbolo.
    const symbol = huffmanSymbol(cursor, acTable);
    // Fin.
    if (symbol === null)
      // Rechaza esta condición y comunica el resultado negativo al llamador.
      return false;
    // Fin de bloque.
    if (symbol === 0)
      // Confirma la condición de esta rama y comunica el resultado positivo al llamador.
      return true;
    // 16 ceros.
    if (symbol === 0xf0) {
      // Avanza.
      index += 16;
      // Sigue.
      continue;
    }
    // Ceros previos.
    const run = symbol >> 4;
    // Tamaño.
    const size = symbol & 0x0f;
    // Inválido.
    if (size === 0 || size > 10)
      // Rechaza esta condición y comunica el resultado negativo al llamador.
      return false;
    // Salta ceros.
    index += run;
    // Se pasa.
    if (index >= 64)
      // Rechaza esta condición y comunica el resultado negativo al llamador.
      return false;
    // Bits.
    const bits = readBits(cursor, size);
    // Fin.
    if (bits === null)
      // Rechaza esta condición y comunica el resultado negativo al llamador.
      return false;
    // Valor (solo se comprueba).
    extendMagnitude(bits, size);
    // Siguiente.
    index += 1;
  }
  // Exacto.
  return index === 64;
}

// Lee el siguiente marcador tras un escaneo.
function takeMarker(cursor: BitCursor): number | null {
  // Vacía bits.
  cursor.bits = 0;
  // Vacía byte.
  cursor.bitBuffer = 0;
  // Marcador pendiente.
  if (cursor.marker !== null) {
    // Lo toma.
    const marker = cursor.marker;
    // Lo limpia.
    cursor.marker = null;
    // Avanza.
    cursor.offset += 2;
    // Marcador.
    return marker;
  }
  // Sin FF: null.
  if (cursor.offset >= cursor.bytes.length || cursor.bytes[cursor.offset] !== 0xff)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Salta FF de relleno.
  while (cursor.offset < cursor.bytes.length && cursor.bytes[cursor.offset] === 0xff) {
    // Avanza.
    cursor.offset += 1;
  }
  // Fin.
  if (cursor.offset >= cursor.bytes.length)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Marcador.
  const marker = cursor.bytes[cursor.offset] ?? 0;
  // Avanza.
  cursor.offset += 1;
  // Marcador.
  return marker;
}

// Valida un JPEG baseline: segmentos, tablas, marco y escaneo completo hasta EOI.
function parseJpeg(bytes: Uint8Array): ImageFacts | null {
  // Empieza por SOI.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Termina por EOI.
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)
    // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
    return null;
  // Tablas DC.
  const dcTables: Array<HuffmanTable | null> = [null, null, null, null];
  // Tablas AC.
  const acTables: Array<HuffmanTable | null> = [null, null, null, null];
  // Tablas de cuantización vistas.
  const quant = [false, false, false, false];
  // Ancho.
  let width = 0;
  // Alto.
  let height = 0;
  // Componentes del marco.
  let frame: JpegComponent[] | null = null;
  // Intervalo de reinicio.
  let restartInterval = 0;
  // Tras SOI.
  let offset = 2;
  // Recorre los segmentos.
  while (offset + 1 < bytes.length) {
    // Debe empezar por FF.
    if (bytes[offset] !== 0xff)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Salta FF.
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    // Marcador.
    const marker = bytes[offset] ?? 0;
    // Avanza.
    offset += 1;
    // EOI antes del escaneo.
    if (marker === 0xd9)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Marcadores sin segmento.
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7))
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Fin.
    if (offset + 1 >= bytes.length)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Longitud.
    const length = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    // Inválida.
    if (length < 2 || offset + length > bytes.length)
      // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
      return null;
    // Inicio de datos.
    const data = offset + 2;
    // Fin del segmento.
    const end = offset + length;
    // SOS: inicio del escaneo.
    if (marker === 0xda) {
      // Sin marco.
      if (frame === null)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Componentes del escaneo.
      const count = bytes[data] ?? 0;
      // Número inválido.
      if (count !== frame.length || length < 6 + count * 2)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Componentes con sus tablas.
      const scanComponents: Array<JpegComponent & { dcId: number; acId: number }> = [];
      // Cada componente.
      for (let index = 0; index < count; index += 1) {
        // Id.
        const id = bytes[data + 1 + index * 2] ?? 0;
        // Tablas.
        const tables = bytes[data + 2 + index * 2] ?? 0;
        // Componente del marco.
        const component = frame.find((item) => item.id === id);
        // Tabla DC.
        const dcId = tables >> 4;
        // Tabla AC.
        const acId = tables & 0x0f;
        // DC.
        const dcTable = dcTables[dcId];
        // AC.
        const acTable = acTables[acId];
        // Falta algo.
        if (component === undefined || dcTable === undefined || acTable === undefined)
          // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
          return null;
        // Tabla vacía.
        if (dcTable === null || acTable === null)
          // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
          return null;
        // Lo añade.
        scanComponents.push({ ...component, dcId, acId });
      }
      // Parámetros baseline y lados válidos.
      if (
        bytes[end - 3] !== 0 ||
        bytes[end - 2] !== 63 ||
        bytes[end - 1] !== 0 ||
        !imageEdges(width, height)
      ) {
        // null.
        return null;
      }
      // Muestreo horizontal máximo.
      const maxH = Math.max(...frame.map((item) => item.h));
      // Muestreo vertical máximo.
      const maxV = Math.max(...frame.map((item) => item.v));
      // Número de MCU.
      const mcus = Math.ceil(width / (maxH * 8)) * Math.ceil(height / (maxV * 8));
      // Fuera de rango.
      if (!Number.isSafeInteger(mcus) || mcus < 1 || mcus > 40_000)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Cursor tras la cabecera del escaneo.
      const cursor: BitCursor = {
        bytes,
        offset: end,
        bitBuffer: 0,
        bits: 0,
        marker: null,
      };
      // Predicciones DC por componente.
      const predictions = frame.map(() => ({ dc: 0 }));
      // Reinicio esperado.
      let restart = 0;
      // Cada MCU.
      for (let mcu = 0; mcu < mcus; mcu += 1) {
        // Toca reinicio.
        if (restartInterval > 0 && mcu > 0 && mcu % restartInterval === 0) {
          // Marcador RSTn correcto.
          if (takeMarker(cursor) !== 0xd0 + restart)
            // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
            return null;
          // Siguiente.
          restart = (restart + 1) & 7;
          // Reinicia predicciones.
          for (const prediction of predictions) prediction.dc = 0;
        }
        // Cada componente.
        for (const component of scanComponents) {
          // DC.
          const dcTable = dcTables[component.dcId];
          // AC.
          const acTable = acTables[component.acId];
          // Predicción.
          const prediction = predictions[component.index];
          // Falta algo.
          if (
            dcTable === null ||
            dcTable === undefined ||
            acTable === null ||
            acTable === undefined ||
            prediction === undefined
          ) {
            // null.
            return null;
          }
          // Bloques del componente.
          for (let block = 0; block < component.h * component.v; block += 1) {
            // Bloque inválido.
            if (!decodeBlock(cursor, dcTable, acTable, prediction))
              // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
              return null;
          }
        }
      }
      // Debe acabar en EOI.
      if (takeMarker(cursor) !== 0xd9 || cursor.offset !== bytes.length)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // JPEG válido.
      return { role: "image", mime: "image/jpeg", width, height };
    }
    // SOF0: marco baseline.
    if (marker === 0xc0) {
      // Precisión.
      const precision = bytes[data] ?? 0;
      // Alto.
      height = ((bytes[data + 1] ?? 0) << 8) | (bytes[data + 2] ?? 0);
      // Ancho.
      width = ((bytes[data + 3] ?? 0) << 8) | (bytes[data + 4] ?? 0);
      // Componentes.
      const count = bytes[data + 5] ?? 0;
      // Valores no admitidos.
      if (precision !== 8 || count < 1 || count > 4 || length !== 8 + count * 3)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Lados fuera de rango.
      if (!imageEdges(width, height))
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Ids vistos.
      const seen = new Set<number>();
      // Componentes.
      frame = [];
      // Muestras.
      let samples = 0;
      // Cada componente.
      for (let index = 0; index < count; index += 1) {
        // Id.
        const id = bytes[data + 6 + index * 3] ?? 0;
        // Muestreo.
        const sampling = bytes[data + 7 + index * 3] ?? 0;
        // Tabla de cuantización.
        const table = bytes[data + 8 + index * 3] ?? 9;
        // Horizontal.
        const horizontal = sampling >> 4;
        // Vertical.
        const vertical = sampling & 0x0f;
        // Repetido, muestreo inválido o tabla ausente.
        if (
          seen.has(id) ||
          horizontal < 1 ||
          horizontal > 4 ||
          vertical < 1 ||
          vertical > 4 ||
          table > 3 ||
          !quant[table]
        ) {
          // null.
          return null;
        }
        // Visto.
        seen.add(id);
        // Suma.
        samples += horizontal * vertical;
        // Añade.
        frame.push({ id, h: horizontal, v: vertical, index });
      }
      // Demasiadas muestras.
      if (samples < 1 || samples > 10)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
    } else if (marker === 0xdb) {
      // DQT: tablas de cuantización.
      let cursor = data;
      // Cada tabla.
      while (cursor < end) {
        // Información.
        const info = bytes[cursor] ?? 0;
        // Precisión.
        const precision = info >> 4;
        // Id.
        const id = info & 0x0f;
        // Tamaño.
        const size = precision === 0 ? 64 : 128;
        // Inválida.
        if (id > 3 || precision > 1 || cursor + 1 + size > end)
          // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
          return null;
        // Vista.
        quant[id] = true;
        // Siguiente.
        cursor += 1 + size;
      }
      // Debe cuadrar.
      if (cursor !== end)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
    } else if (marker === 0xc4) {
      // DHT: tablas Huffman.
      let cursor = data;
      // Cada tabla.
      while (cursor < end) {
        // Información.
        const info = bytes[cursor] ?? 0;
        // DC o AC.
        const kind = info >> 4;
        // Id.
        const id = info & 0x0f;
        // Inválida.
        if ((kind !== 0 && kind !== 1) || id > 3 || cursor + 17 > end)
          // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
          return null;
        // Códigos por longitud.
        const counts = [0];
        // Lee las 16 cuentas.
        for (let length = 0; length < 16; length += 1) counts.push(bytes[cursor + 1 + length] ?? 0);
        // Total de símbolos.
        const total = counts.reduce((sum, count) => sum + count, 0);
        // Demasiados.
        if (total > 256 || cursor + 17 + total > end)
          // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
          return null;
        // Construye la tabla.
        const table = buildHuffman(counts, bytes.subarray(cursor + 17, cursor + 17 + total));
        // Inválida.
        if (table === null)
          // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
          return null;
        // La guarda.
        (kind === 0 ? dcTables : acTables)[id] = table;
        // Siguiente.
        cursor += 17 + total;
      }
      // Debe cuadrar.
      if (cursor !== end)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
    } else if (marker === 0xdd) {
      // DRI: longitud fija.
      if (length !== 4)
        // Representa la ausencia de resultado con null para que el llamador decida la siguiente ruta.
        return null;
      // Intervalo de reinicio.
      restartInterval = ((bytes[data] ?? 0) << 8) | (bytes[data + 1] ?? 0);
    } else if (marker >= 0xc1 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc) {
      // Otros SOF (progresivo, aritmético…): no admitidos.
      return null;
    } else if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
      // Solo APPn y comentarios.
      return null;
    }
    // Siguiente segmento.
    offset = end;
  }
  // Sin escaneo.
  return null;
}

// Valida un WAV PCM: cabeceras RIFF, fmt y data, formato admitido y duración.
function parseWav(
  bytes: Uint8Array,
):
  | { ok: true; facts: AudioFacts }
  | { ok: false; reason: "malformed" | "unsupported" | "duration" } {
  // Demasiado corto.
  if (bytes.length < 44) {
    // Malformado.
    return { ok: false, reason: "malformed" };
  }
  // Id de 4 caracteres.
  const id = (offset: number) => new TextDecoder().decode(bytes.subarray(offset, offset + 4));
  // RIFF y WAVE.
  if (id(0) !== "RIFF" || id(8) !== "WAVE") {
    // Malformado.
    return { ok: false, reason: "malformed" };
  }
  // Formato.
  let format = 0;
  // Canales.
  let channels = 0;
  // Frecuencia.
  let sampleRate = 0;
  // Bits.
  let bits = 0;
  // Bytes de audio.
  let dataBytes = 0;
  // ¿Visto fmt?
  let sawFormat = false;
  // Tras la cabecera.
  let offset = 12;
  // Recorre los chunks.
  while (offset + 8 <= bytes.length) {
    // Tamaño.
    const size = u32le(bytes, offset + 4);
    // Inicio.
    const start = offset + 8;
    // No cabe.
    if (size > bytes.length - start) {
      // Malformado.
      return { ok: false, reason: "malformed" };
    }
    // Tipo.
    const kind = id(offset);
    // fmt.
    if (kind === "fmt ") {
      // Demasiado corto.
      if (size < 16) return { ok: false, reason: "malformed" };
      // Visto.
      sawFormat = true;
      // Formato.
      format = u16(bytes, start);
      // Canales.
      channels = u16(bytes, start + 2);
      // Frecuencia.
      sampleRate = u32le(bytes, start + 4);
      // Bits.
      bits = u16(bytes, start + 14);
    } else if (kind === "data") {
      // Bytes de audio.
      dataBytes = size;
    }
    // Siguiente chunk (alineado a 2).
    offset = start + size + (size % 2);
  }
  // Sin fmt o datos impares.
  if (!sawFormat || dataBytes < 2 || dataBytes % 2 !== 0) {
    // Malformado.
    return { ok: false, reason: "malformed" };
  }
  // Solo PCM con los canales, frecuencia y bits del curso.
  if (
    format !== 1 ||
    channels !== MEDIA_LIMITS.audioChannels ||
    sampleRate !== MEDIA_LIMITS.audioSampleRate ||
    bits !== MEDIA_LIMITS.audioBitDepth
  ) {
    // No admitido.
    return { ok: false, reason: "unsupported" };
  }
  // Muestras.
  const frames = dataBytes / 2;
  // Duración.
  const durationMs = Math.round((frames * 1000) / sampleRate);
  // Fuera de rango.
  if (durationMs < MEDIA_LIMITS.minAudioMs || durationMs > MEDIA_LIMITS.maxAudioMs) {
    // Duración.
    return { ok: false, reason: "duration" };
  }
  // WAV válido.
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
  // Vacío o SVG/HTML.
  if (bytes.length === 0 || looksLikeMarkup(bytes)) {
    // Rechazo.
    return rejectMedia(bytes.length === 0 ? "empty" : "unsupported");
  }
  // ¿Empieza como PNG?
  const png = bytes[0] === 137;
  // ¿Como JPEG?
  const jpeg = bytes[0] === 0xff;
  // ¿Como WAV (R de RIFF)?
  const wav = bytes[0] === 0x52;
  // PNG.
  if (png) {
    // Demasiado grande.
    if (bytes.length > MEDIA_LIMITS.maxImageBytes) return rejectMedia("oversized");
    // Valida.
    const facts = await parsePng(bytes);
    // Inválido.
    if (facts === null) {
      // Lados fuera de rango o malformado.
      return imageEdges(u32(bytes, 16), u32(bytes, 20))
        ? rejectMedia("malformed")
        : rejectMedia("dimensions");
    }
    // Válido.
    return { ok: true, facts };
  }
  // JPEG.
  if (jpeg) {
    // Demasiado grande.
    if (bytes.length > MEDIA_LIMITS.maxImageBytes) return rejectMedia("oversized");
    // Valida.
    const facts = parseJpeg(bytes);
    // Resultado.
    return facts === null ? rejectMedia("malformed") : { ok: true, facts };
  }
  // WAV.
  if (wav) {
    // Demasiado grande.
    if (bytes.length > MEDIA_LIMITS.maxAudioBytes) return rejectMedia("oversized");
    // Valida.
    const facts = parseWav(bytes);
    // Resultado.
    return facts.ok ? { ok: true, facts: facts.facts } : rejectMedia(facts.reason);
  }
  // Otro tipo.
  return rejectMedia("unsupported");
}

// Hash SHA-256 de unos bytes con prefijo sha256:.
export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  // Copia (digest necesita su propio buffer).
  const copy = new Uint8Array(bytes.byteLength);
  // Copia.
  copy.set(bytes);
  // Resumen.
  const digest = await crypto.subtle.digest("SHA-256", copy);
  // Hexadecimal.
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  // Con prefijo.
  return `sha256:${hex}`;
}

/** Tono PCM local. No es la voz de un modelo. */
export function toneWav(durationMs = 400, frequency = 440): Uint8Array {
  // Frecuencia.
  const rate = MEDIA_LIMITS.audioSampleRate;
  // Muestras.
  const frames = Math.max(1, Math.round((rate * durationMs) / 1000));
  // Datos de 16 bits.
  const data = new Uint8Array(frames * 2);
  // Cada muestra.
  for (let frame = 0; frame < frames; frame += 1) {
    // Seno de la frecuencia.
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * frame) / rate) * 8000);
    // Byte bajo.
    data[frame * 2] = sample & 0xff;
    // Byte alto.
    data[frame * 2 + 1] = (sample >> 8) & 0xff;
  }
  // Cabecera de 44 bytes.
  const header = new ArrayBuffer(44);
  // Vista para escribir enteros.
  const view = new DataView(header);
  // Escribe texto ASCII.
  const write = (offset: number, text: string) => {
    // Cada carácter.
    for (let index = 0; index < text.length; index += 1) {
      // Byte.
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  // RIFF.
  write(0, "RIFF");
  // Tamaño.
  view.setUint32(4, 36 + data.length, true);
  // WAVE.
  write(8, "WAVE");
  // fmt.
  write(12, "fmt ");
  // Tamaño de fmt.
  view.setUint32(16, 16, true);
  // PCM.
  view.setUint16(20, 1, true);
  // 1 canal.
  view.setUint16(22, 1, true);
  // Frecuencia.
  view.setUint32(24, rate, true);
  // Bytes por segundo.
  view.setUint32(28, rate * 2, true);
  // Bytes por muestra.
  view.setUint16(32, 2, true);
  // 16 bits.
  view.setUint16(34, 16, true);
  // data.
  write(36, "data");
  // Tamaño de datos.
  view.setUint32(40, data.length, true);
  // Archivo completo.
  const wav = new Uint8Array(44 + data.length);
  // Cabecera.
  wav.set(new Uint8Array(header), 0);
  // Datos.
  wav.set(data, 44);
  // WAV.
  return wav;
}
