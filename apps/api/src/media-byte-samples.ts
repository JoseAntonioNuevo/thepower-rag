// GUÍA DE LECTURA · apps/api/src/media-byte-samples.ts
// Construye en memoria archivos PNG y JPEG mínimos (válidos o deliberadamente rotos) para probar la
// validación de imágenes sin depender de archivos del disco.
// CRC-32 de PNG: suma de comprobación de cada bloque.
function crc32(bytes: Uint8Array): number {
  // Valor inicial: todos los bits a 1.
  let crc = 0xffffffff;
  // Recorre los bytes.
  for (const byte of bytes) {
    // Mezcla el byte en el registro.
    crc ^= byte;
    // Ocho pasos, uno por bit.
    for (let bit = 0; bit < 8; bit += 1) {
      // Desplaza y aplica el polinomio estándar si el bit bajo es 1.
      crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  // Invierte los bits y lo deja sin signo (>>> 0).
  return (crc ^ 0xffffffff) >>> 0;
}

// Bloque PNG: longitud, tipo, datos y CRC.
export function pngChunk(type: string, data: Uint8Array): Uint8Array {
  // 4 bytes de longitud + 4 de tipo + datos + 4 de CRC.
  const out = new Uint8Array(12 + data.length);
  // Vista para escribir enteros de 32 bits.
  const view = new DataView(out.buffer);
  // Longitud de los datos (big-endian).
  view.setUint32(0, data.length);
  // Tipo del bloque (por ejemplo, IHDR).
  out.set(new TextEncoder().encode(type), 4);
  // Datos.
  out.set(data, 8);
  // CRC del tipo y los datos.
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  // Bloque completo.
  return out;
}

// Archivo PNG: firma más los bloques.
export function pngFile(chunks: Uint8Array[]): Uint8Array {
  // Firma fija de 8 bytes de todo PNG.
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  // Firma seguida de los bloques.
  const pieces = [signature, ...chunks];
  // Buffer con el tamaño total.
  const out = new Uint8Array(pieces.reduce((total, piece) => total + piece.length, 0));
  // Posición de escritura.
  let offset = 0;
  // Copia cada pieza.
  for (const piece of pieces) {
    // En su posición.
    out.set(piece, offset);
    // Avanza.
    offset += piece.length;
  }
  // Archivo completo.
  return out;
}

// Cabecera IHDR de una imagen RGB de 8 bits.
export function rgbHeader(width: number, height: number, interlace = 0): Uint8Array {
  // 13 bytes.
  const header = new Uint8Array(13);
  // Vista para enteros.
  const view = new DataView(header.buffer);
  // Ancho.
  view.setUint32(0, width);
  // Alto.
  view.setUint32(4, height);
  // 8 bits por canal.
  header[8] = 8;
  // Tipo de color 2: RGB.
  header[9] = 2;
  // Entrelazado (0 = no).
  header[12] = interlace;
  // Cabecera.
  return header;
}

/** PNG de 58 bytes: firma, IHDR 8×8, IDAT de un byte e IEND. El CRC es legal y el flujo no. */
export function invalidIdatPng(): Uint8Array {
  // PNG con cabecera válida y datos IDAT inválidos.
  return pngFile([
    pngChunk("IHDR", rgbHeader(8, 8)),
    pngChunk("IDAT", new Uint8Array([0])),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

/** JPEG de 31 bytes: SOI, SOF y SOS superficiales, escaneo inválido y EOI. */
export function invalidScanJpeg(): Uint8Array {
  // Marcador SOF de un JPEG de 8×8.
  const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00];
  // Marcador SOS (inicio del escaneo).
  const sos = [0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00];
  // SOI + SOF + SOS + un escaneo inválido + EOI.
  return new Uint8Array([0xff, 0xd8, ...sof, ...sos, 0xff, 0x11, 0x00, 0x02, 0xff, 0xd9]);
}
