import { MEDIA_LIMITS } from "@thepower-rag/contracts";
import { describe, expect, it } from "vite-plus/test";
import { readFixtureBytes } from "./fixture-bytes";
import {
  invalidIdatPng,
  invalidScanJpeg,
  pngChunk,
  pngFile,
  rgbHeader,
} from "./media-byte-samples";
import { inspectMedia, sha256Bytes, toneWav } from "./media-bytes";

async function zlib(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

describe("bytes de medios", () => {
  it("acepta la imagen y el wav del aula", async () => {
    const image = await inspectMedia(await readFixtureBytes("dimension-mismatch.png"));
    const unknown = await inspectMedia(await readFixtureBytes("unknown-square.png"));
    const audio = await inspectMedia(await readFixtureBytes("embedding-request.wav"));
    expect(image.ok && image.facts.role === "image" && image.facts.mime).toBe("image/png");
    expect(unknown.ok && unknown.facts.role === "image" ? unknown.facts.width : 0).toBe(32);
    expect(audio.ok && audio.facts.role === "audio" ? audio.facts.durationMs : 0).toBeGreaterThan(
      1_000,
    );
    expect(
      audio.ok && audio.facts.role === "audio" ? audio.facts.durationMs : 0,
    ).toBeLessThanOrEqual(30_000);
    expect(await sha256Bytes(await readFixtureBytes("dimension-mismatch.png"))).toBe(
      "sha256:933c9557ac8d0ef3ca3687ba8a1c5d3d7cc538eec0cd0666df2ebfa0d957f596",
    );
    const tampered = new Uint8Array(await readFixtureBytes("dimension-mismatch.png"));
    const changed = tampered[80] ?? 0;
    tampered[80] = changed ^ 0xff;
    expect(await inspectMedia(tampered)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("rechaza un MIME mentiroso, SVG y un wav demasiado largo", async () => {
    const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect((await inspectMedia(svg)).ok).toBe(false);
    const forged = new Uint8Array(await readFixtureBytes("dimension-mismatch.png"));
    forged[0] = 0x3c;
    expect((await inspectMedia(forged)).ok).toBe(false);
    const tone = toneWav(31_000);
    expect(await inspectMedia(tone)).toMatchObject({ ok: false, reason: "duration" });
  });

  it("acepta un JPEG real y uno cuyo escaneo contiene FF relleno", async () => {
    const photo = await inspectMedia(await readFixtureBytes("sample-square.jpg"));
    expect(photo.ok && photo.facts.role === "image" && photo.facts.mime).toBe("image/jpeg");
    expect(photo.ok && photo.facts.role === "image" ? photo.facts.width : 0).toBe(32);
    const stuffed = await readFixtureBytes("scan-stuffed-ff.jpg");
    const parsed = await inspectMedia(stuffed);
    expect(parsed.ok && parsed.facts.role === "image" ? parsed.facts.width : 0).toBe(48);
    expect(parsed.ok && parsed.facts.role === "image" ? parsed.facts.height : 0).toBe(40);
    const sos = stuffed.findIndex((byte, index) => byte === 0xff && stuffed[index + 1] === 0xda);
    let stuffedBytes = 0;
    for (let index = sos; index < stuffed.length - 1; index += 1) {
      if (stuffed[index] === 0xff && stuffed[index + 1] === 0x00) stuffedBytes += 1;
    }
    expect(stuffedBytes).toBeGreaterThan(0);
    expect(await sha256Bytes(stuffed)).toBe(
      "sha256:ac0ab3be3f89d46a33003b9b0e6d97f39810b5b22c395e3172bdceaeaf538be7",
    );
  });

  it("rechaza un wav cuyo tamaño de chunk no cabe en el archivo", async () => {
    const bytes = new Uint8Array(44);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8);
    bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
    bytes[19] = 0x80;
    expect(await inspectMedia(bytes)).toMatchObject({ ok: false, reason: "malformed" });
    const otherRate = toneWav(400);
    otherRate[24] = 0x44;
    otherRate[25] = 0xac;
    otherRate[26] = 0;
    otherRate[27] = 0;
    expect(await inspectMedia(otherRate)).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("rechaza un PNG con firma y un IEND suelto, sin datos de imagen", async () => {
    const invalid = new Uint8Array(33);
    invalid.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    invalid.set(new TextEncoder().encode("IHDR"), 12);
    invalid[19] = 8;
    invalid[23] = 8;
    invalid[24] = 8;
    invalid[25] = 2;
    invalid.set(new TextEncoder().encode("IEND"), 29);
    expect(invalid.byteLength).toBe(33);
    expect(await inspectMedia(invalid)).toMatchObject({ ok: false, reason: "malformed" });
    const truncated = new Uint8Array(invalid.buffer, 0, 24);
    expect(await inspectMedia(truncated)).toMatchObject({ ok: false });
    const oversized = new Uint8Array(MEDIA_LIMITS.maxImageBytes + 1);
    oversized[0] = 137;
    expect(await inspectMedia(oversized)).toMatchObject({ ok: false, reason: "oversized" });
  });

  it("rechaza un IDAT que no se infla y un escaneo JPEG inválido", async () => {
    const png = invalidIdatPng();
    expect(png.byteLength).toBe(58);
    expect(await inspectMedia(png)).toMatchObject({ ok: false, reason: "malformed" });
    const jpeg = invalidScanJpeg();
    expect(jpeg.byteLength).toBe(31);
    expect(await inspectMedia(jpeg)).toMatchObject({ ok: false, reason: "malformed" });
    const raw = new Uint8Array(8 * (1 + 24));
    raw[0] = 9;
    const badFilter = pngFile([
      pngChunk("IHDR", rgbHeader(8, 8)),
      pngChunk("IDAT", await zlib(raw)),
      pngChunk("IEND", new Uint8Array()),
    ]);
    expect(await inspectMedia(badFilter)).toMatchObject({ ok: false, reason: "malformed" });
    const bomb = pngFile([
      pngChunk("IHDR", rgbHeader(8, 8)),
      pngChunk("IDAT", await zlib(new Uint8Array(5_000))),
      pngChunk("IEND", new Uint8Array()),
    ]);
    expect(await inspectMedia(bomb)).toMatchObject({ ok: false, reason: "malformed" });
    const widths = [1, 1, 2, 2, 4, 4, 8];
    const heights = [1, 1, 1, 2, 2, 4, 4];
    const planes = widths.map(
      (width, index) => new Uint8Array((1 + width * 3) * (heights[index] ?? 0)),
    );
    const interlaced = new Uint8Array(planes.reduce((total, plane) => total + plane.length, 0));
    let offset = 0;
    for (const plane of planes) {
      interlaced.set(plane, offset);
      offset += plane.length;
    }
    const adam7 = pngFile([
      pngChunk("IHDR", rgbHeader(8, 8, 1)),
      pngChunk("IDAT", await zlib(interlaced)),
      pngChunk("IEND", new Uint8Array()),
    ]);
    const accepted = await inspectMedia(adam7);
    expect(accepted.ok && accepted.facts.role === "image" ? accepted.facts.width : 0).toBe(8);
  });

  it("rechaza un JPEG sin datos de escaneo y una longitud de segmento imposible", async () => {
    const sof = [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00];
    const emptyScan = new Uint8Array([
      0xff,
      0xd8,
      ...sof,
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
      0xff,
      0xd9,
    ]);
    expect(await inspectMedia(emptyScan)).toMatchObject({ ok: false, reason: "malformed" });
    const badLength = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0xff, 0xff, 0xd9]);
    expect(await inspectMedia(badLength)).toMatchObject({ ok: false, reason: "malformed" });
    const progressive = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc2, 0x00, 0x0b, 0x08, 0x00, 0x08, 0x00, 0x08, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xd9,
    ]);
    expect(await inspectMedia(progressive)).toMatchObject({ ok: false, reason: "malformed" });
  });

  it("genera un wav reproducible que el navegador puede reproducir", async () => {
    const tone = toneWav(400);
    const facts = await inspectMedia(tone);
    expect(facts.ok).toBe(true);
    expect(tone[0]).toBe(0x52);
  });
});
