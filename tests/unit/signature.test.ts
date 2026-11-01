import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { normalizeSignature } from "@/server/photo/signature";

const bad = async (b: Uint8Array) => { try { await normalizeSignature(b); return null; } catch (e) { return e as { code?: string; fieldErrors?: Record<string, string> }; } };
const img = (w: number, h: number, bg: { r: number; g: number; b: number; alpha?: number } = { r: 255, g: 255, b: 255, alpha: 1 }) => sharp({ create: { width: w, height: h, channels: 4, background: bg } });

describe("normalizeSignature — gambar tanda tangan slip", () => {
  it("JPG/PNG/WebP → PNG; diperkecil ke maks. 600×240 tanpa memperbesar; EXIF dibuang; transparansi PNG dipertahankan", async () => {
    const big = await normalizeSignature(await img(2400, 800).jpeg().toBuffer());
    const m = await sharp(big).metadata();
    expect(m.format).toBe("png");
    expect(m.width! <= 600 && m.height! <= 240).toBe(true);
    expect(m.width! / m.height!).toBeCloseTo(3, 1); // rasio dipertahankan

    const small = await sharp(await normalizeSignature(await img(200, 80).png().toBuffer())).metadata();
    expect([small.width, small.height]).toEqual([200, 80]);

    const transparent = await sharp(await normalizeSignature(await img(300, 120, { r: 0, g: 0, b: 0, alpha: 0 }).png().toBuffer())).metadata();
    expect(transparent.hasAlpha).toBe(true);

    const webp = await sharp(await normalizeSignature(await img(300, 120).webp().toBuffer())).metadata();
    expect(webp.format).toBe("png");

    const withExif = await normalizeSignature(await img(300, 120).jpeg().withExif({ IFD0: { Copyright: "rahasia-perangkat" } }).toBuffer());
    expect(withExif.includes(Buffer.from("rahasia-perangkat"))).toBe(false);
    expect((await sharp(withExif).metadata()).exif).toBeUndefined();
  });

  it("orientasi EXIF diterapkan (foto tanda tangan dari ponsel yang miring)", async () => {
    const m = await sharp(await normalizeSignature(await img(300, 120).jpeg().withMetadata({ orientation: 6 }).toBuffer())).metadata();
    expect(m.height! > m.width!).toBe(true);
  });

  it("menolak: bukan gambar, SVG (berskrip), GIF, terlalu kecil, dan gambar berpiksel berlebihan (bom dekompresi)", async () => {
    expect((await bad(Buffer.from("bukan gambar")))?.code).toBe("VALIDATION");
    expect((await bad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><script>alert(1)</script></svg>')))?.code).toBe("VALIDATION");
    expect((await bad(await img(300, 120).gif().toBuffer()))?.fieldErrors?.file).toContain("Format");
    expect((await bad(await img(20, 20).png().toBuffer()))?.fieldErrors?.file).toContain("Resolusi");
    expect((await bad(await sharp({ create: { width: 6000, height: 6000, channels: 3, background: "#888" } }).png({ compressionLevel: 9 }).toBuffer()))?.code).toBe("VALIDATION");
    expect((await bad(new Uint8Array()))?.code).toBe("VALIDATION");
  });
});
