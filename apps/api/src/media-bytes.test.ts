// GUÍA DE LECTURA · apps/api/src/media-bytes.test.ts
// Pruebas del inspector de bytes de imágenes y audio: acepta los archivos del caso y rechaza PNG,
// JPEG o WAV falsificados, truncados, enormes o con datos imposibles.
// Límites de medios.
import { MEDIA_LIMITS } from "@thepower-rag/contracts";
// Funciones de prueba.
import { describe, expect, it } from "vite-plus/test";
// Lee archivos de ejemplo.
import { readFixtureBytes } from "./fixture-bytes";
// Generadores de PNG y JPEG de prueba.
import {
  invalidIdatPng,
  invalidScanJpeg,
  pngChunk,
  pngFile,
  rgbHeader,
} from "./media-byte-samples";
// Funciones que se prueban.
import { inspectMedia, sha256Bytes, toneWav } from "./media-bytes";

// Comprime con deflate (zlib) para fabricar IDAT de PNG.
async function zlib(data: Uint8Array): Promise<Uint8Array> {
  // Flujo comprimido.
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  // Bytes resultantes.
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Grupo de pruebas de bytes de medios.
describe("bytes de medios", () => {
  // Acepta los archivos del caso y detecta un PNG alterado.
  it("acepta la foto del pedido y la nota de voz", async () => {
    // Foto del pedido.
    const image = await inspectMedia(await readFixtureBytes("pedido-auriculares.png"));
    // Imagen cuadrada.
    const unknown = await inspectMedia(await readFixtureBytes("unknown-square.png"));
    // Nota de voz.
    const audio = await inspectMedia(await readFixtureBytes("nota-de-voz-devolucion.wav"));
    // PNG.
    expect(image.ok && image.facts.role === "image" && image.facts.mime).toBe("image/png");
    // Ancho 32.
    expect(unknown.ok && unknown.facts.role === "image" ? unknown.facts.width : 0).toBe(32);
    // Duración mayor de 1 segundo.
    expect(audio.ok && audio.facts.role === "audio" ? audio.facts.durationMs : 0).toBeGreaterThan(
      1_000,
    );
    // Y de hasta 30 segundos.
    expect(
      audio.ok && audio.facts.role === "audio" ? audio.facts.durationMs : 0,
    ).toBeLessThanOrEqual(30_000);
    // Hash fijo de la imagen.
    expect(await sha256Bytes(await readFixtureBytes("pedido-auriculares.png"))).toBe(
      "sha256:97c58ca3ac12706343d5fca0f50d91d0ff0bdf0a4e235af7b759b142656cf521",
    );
    // Copia para alterar.
    const tampered = new Uint8Array(await readFixtureBytes("pedido-auriculares.png"));
    // Byte 80.
    const changed = tampered[80] ?? 0;
    // Lo invierte.
    tampered[80] = changed ^ 0xff;
    // Archivo dañado: malformed.
    expect(await inspectMedia(tampered)).toMatchObject({ ok: false, reason: "malformed" });
  });

  // MIME falso, SVG y WAV largo se rechazan.
  it("rechaza un MIME mentiroso, SVG y un wav demasiado largo", async () => {
    // SVG como texto.
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    // Rechazado.
    expect((await inspectMedia(svg)).ok).toBe(false);
    // PNG con el primer byte cambiado.
    const forged = new Uint8Array(await readFixtureBytes("pedido-auriculares.png"));
    // Rompe la firma.
    forged[0] = 0x3c;
    // Rechazado.
    expect((await inspectMedia(forged)).ok).toBe(false);
    // Tono de 31 segundos.
    const tone = toneWav(31_000);
    // Demasiado largo.
    expect(await inspectMedia(tone)).toMatchObject({ ok: false, reason: "duration" });
  });

  // JPEG real y JPEG con bytes FF de relleno.
  it("acepta un JPEG real y uno cuyo escaneo contiene FF relleno", async () => {
    // JPEG de prueba.
    const photo = await inspectMedia(await readFixtureBytes("sample-square.jpg"));
    // MIME JPEG.
    expect(photo.ok && photo.facts.role === "image" && photo.facts.mime).toBe("image/jpeg");
    // Ancho 32.
    expect(photo.ok && photo.facts.role === "image" ? photo.facts.width : 0).toBe(32);
    // JPEG con relleno.
    const stuffed = await readFixtureBytes("scan-stuffed-ff.jpg");
    // Lo inspecciona.
    const parsed = await inspectMedia(stuffed);
    // Ancho 48.
    expect(parsed.ok && parsed.facts.role === "image" ? parsed.facts.width : 0).toBe(48);
    // Alto 40.
    expect(parsed.ok && parsed.facts.role === "image" ? parsed.facts.height : 0).toBe(40);
    // Posición del marcador SOS (inicio del escaneo).
    const sos = stuffed.findIndex((byte, index) => byte === 0xff && stuffed[index + 1] === 0xda);
    // Cuenta bytes FF 00 de relleno.
    let stuffedBytes = 0;
    // Recorre el escaneo.
    for (let index = sos; index < stuffed.length - 1; index += 1) {
      // Suma cada FF 00.
      if (stuffed[index] === 0xff && stuffed[index + 1] === 0x00) stuffedBytes += 1;
    }
    // Hay relleno.
    expect(stuffedBytes).toBeGreaterThan(0);
    // Hash fijo.
    expect(await sha256Bytes(stuffed)).toBe(
      "sha256:ac0ab3be3f89d46a33003b9b0e6d97f39810b5b22c395e3172bdceaeaf538be7",
    );
  });

  // WAV con tamaños imposibles o frecuencia no admitida.
  it("rechaza un wav cuyo tamaño de chunk no cabe en el archivo", async () => {
    // Cabecera WAV de 44 bytes.
    const bytes = new Uint8Array(44);
    // RIFF.
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    // WAVE.
    bytes.set([0x57, 0x41, 0x56, 0x45], 8);
    // fmt.
    bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
    // Tamaño de chunk enorme.
    bytes[19] = 0x80;
    // Malformed.
    expect(await inspectMedia(bytes)).toMatchObject({ ok: false, reason: "malformed" });
    // Tono válido.
    const otherRate = toneWav(400);
    // Cambia la frecuencia a 44.100 Hz.
    otherRate[24] = 0x44;
    // Segundo byte.
    otherRate[25] = 0xac;
    // Tercero.
    otherRate[26] = 0;
    // Cuarto.
    otherRate[27] = 0;
    // No admitido.
    expect(await inspectMedia(otherRate)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  // PNG con firma pero sin datos de imagen.
  it("rechaza un PNG con firma y un IEND suelto, sin datos de imagen", async () => {
    // 33 bytes.
    const invalid = new Uint8Array(33);
    // Firma PNG.
    invalid.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    // IHDR.
    invalid.set(new TextEncoder().encode("IHDR"), 12);
    // Ancho 8.
    invalid[19] = 8;
    // Alto 8.
    invalid[23] = 8;
    // 8 bits por canal.
    invalid[24] = 8;
    // Color RGB.
    invalid[25] = 2;
    // IEND.
    invalid.set(new TextEncoder().encode("IEND"), 29);
    // Tamaño.
    expect(invalid.byteLength).toBe(33);
    // Malformed.
    expect(await inspectMedia(invalid)).toMatchObject({ ok: false, reason: "malformed" });
    // Versión truncada.
    const truncated = new Uint8Array(invalid.buffer, 0, 24);
    // Rechazada.
    expect(await inspectMedia(truncated)).toMatchObject({ ok: false });
    // Archivo mayor del tope.
    const oversized = new Uint8Array(MEDIA_LIMITS.maxImageBytes + 1);
    // Empieza como PNG.
    oversized[0] = 137;
    // Demasiado grande.
    expect(await inspectMedia(oversized)).toMatchObject({ ok: false, reason: "oversized" });
  });

  // IDAT que no se infla, JPEG inválido, filtro inválido, bomba de descompresión y Adam7.
  it("rechaza un IDAT que no se infla y un escaneo JPEG inválido", async () => {
    // PNG con IDAT inválido.
    const png = invalidIdatPng();
    // Tamaño.
    expect(png.byteLength).toBe(58);
    // Malformed.
    expect(await inspectMedia(png)).toMatchObject({ ok: false, reason: "malformed" });
    // JPEG con escaneo inválido.
    const jpeg = invalidScanJpeg();
    // Tamaño.
    expect(jpeg.byteLength).toBe(31);
    // Malformed.
    expect(await inspectMedia(jpeg)).toMatchObject({ ok: false, reason: "malformed" });
    // Filas de 8 píxeles RGB más el byte de filtro.
    const raw = new Uint8Array(8 * (1 + 24));
    // Filtro 9: no existe.
    raw[0] = 9;
    // PNG con ese filtro.
    const badFilter = pngFile([
      pngChunk("IHDR", rgbHeader(8, 8)),
      pngChunk("IDAT", await zlib(raw)),
      pngChunk("IEND", new Uint8Array()),
    ]);
    // Malformed.
    expect(await inspectMedia(badFilter)).toMatchObject({ ok: false, reason: "malformed" });
    // IDAT que se infla a más datos de los posibles.
    const bomb = pngFile([
      pngChunk("IHDR", rgbHeader(8, 8)),
      pngChunk("IDAT", await zlib(new Uint8Array(5_000))),
      pngChunk("IEND", new Uint8Array()),
    ]);
    // Malformed.
    expect(await inspectMedia(bomb)).toMatchObject({ ok: false, reason: "malformed" });
    // Anchos de las 7 pasadas de Adam7 en 8×8.
    const widths = [1, 1, 2, 2, 4, 4, 8];
    // Altos de las 7 pasadas.
    const heights = [1, 1, 1, 2, 2, 4, 4];
    // Datos vacíos de cada pasada.
    const planes = widths.map(
      (width, index) => new Uint8Array((1 + width * 3) * (heights[index] ?? 0)),
    );
    // Une las pasadas.
    const interlaced = new Uint8Array(planes.reduce((total, plane) => total + plane.length, 0));
    // Posición.
    let offset = 0;
    // Cada pasada.
    for (const plane of planes) {
      // Se copia.
      interlaced.set(plane, offset);
      // Avanza.
      offset += plane.length;
    }
    // PNG entrelazado.
    const adam7 = pngFile([
      pngChunk("IHDR", rgbHeader(8, 8, 1)),
      pngChunk("IDAT", await zlib(interlaced)),
      pngChunk("IEND", new Uint8Array()),
    ]);
    // Lo inspecciona.
    const accepted = await inspectMedia(adam7);
    // Aceptado con ancho 8.
    expect(accepted.ok && accepted.facts.role === "image" ? accepted.facts.width : 0).toBe(8);
  });

  // JPEG sin datos de escaneo o con longitud imposible.
  it("rechaza un JPEG sin datos de escaneo y una longitud de segmento imposible", async () => {
    // Marcador SOF de 8×8.
    const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00];
    // JPEG con escaneo vacío.
    const emptyScan = new Uint8Array([
      // Inicio de imagen JPEG (SOI) y la cabecera SOF.
      0xff,
      0xd8,
      ...sof,
      // Marcador SOS (inicio de escaneo) con su cabecera…
      0xff,
      0xda,
      0x00,
      0x08,
      0x01,
      0x01,
      0x00,
      0x00,
      0x3f,
      0x00,
      // …y fin de imagen (EOI) sin datos de escaneo.
      0xff,
      0xd9,
    ]);
    // Malformed.
    expect(await inspectMedia(emptyScan)).toMatchObject({ ok: false, reason: "malformed" });
    // Longitud de segmento imposible.
    const badLength = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0xff, 0xff, 0xd9]);
    // Malformed.
    expect(await inspectMedia(badLength)).toMatchObject({ ok: false, reason: "malformed" });
    // JPEG progresivo sin escaneo.
    const progressive = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    // Malformed.
    expect(await inspectMedia(progressive)).toMatchObject({ ok: false, reason: "malformed" });
  });

  // El tono generado es un WAV válido.
  it("genera un wav reproducible que el navegador puede reproducir", async () => {
    // 400 ms.
    const tone = toneWav(400);
    // Inspección.
    const facts = await inspectMedia(tone);
    // Válido.
    expect(facts.ok).toBe(true);
    // Empieza por "R" de RIFF.
    expect(tone[0]).toBe(0x52);
  });
});
