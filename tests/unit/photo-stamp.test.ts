import { describe, expect, it } from "vitest";
import sharp, { type Sharp } from "sharp";
import { stampLines, stampTime } from "@/lib/photo-stamp";
import { printable, stampPhoto } from "@/server/photo/stamp";

const ID = "3f2a91c0-aaaa-4bbb-8ccc-0123456789ab";
const at = new Date("2026-10-31T02:15:42Z"); // 09:15:42 WIB

describe("teks cap — zona waktu & isi", () => {
  it("waktu server dalam zona bisnis: WIB/WITA/WIT; zona lain 'GMT+x'", () => {
    expect(stampTime(at, "Asia/Jakarta")).toBe("31/10/2026 09:15:42 WIB");
    expect(stampTime(at, "Asia/Makassar")).toBe("31/10/2026 10:15:42 WITA");
    expect(stampTime(at, "Asia/Jayapura")).toBe("31/10/2026 11:15:42 WIT");
    expect(stampTime(at, "Asia/Singapore")).toMatch(/^31\/10\/2026 10:15:42 GMT\+8$/);
  });
  it("tengah malam: 00:00:00 (bukan 24:00:00) dan tanggal berganti sesuai zona", () => {
    expect(stampTime(new Date("2026-10-30T17:00:00Z"), "Asia/Jakarta")).toBe("31/10/2026 00:00:00 WIB");
    expect(stampTime(new Date("2026-12-31T16:59:59Z"), "Asia/Jakarta")).toBe("31/12/2026 23:59:59 WIB");
  });
  it("baris cap memuat waktu server, koordinat 6 desimal + akurasi, jenis absen, nama, no. induk, dan ID foto", () => {
    const l = stampLines({ at, timeZone: "Asia/Jakarta", kind: "CHECK_IN", employeeName: "Ayu Lestari", employeeNo: "TE-001", photoId: ID, location: { lat: -7.7956, lng: 110.3695, accuracy: 12.4 } });
    expect(l).toEqual([
      "31/10/2026 09:15:42 WIB",
      "-7.795600, 110.369500 (±12 m)",
      "MASUK · Ayu Lestari (TE-001)",
      "Waktu server · ID 3F2A91C0",
    ]);
    expect(stampLines({ at, timeZone: "Asia/Jakarta", kind: "CHECK_OUT", employeeName: "A", employeeNo: "1", photoId: ID, location: null })[2]).toContain("PULANG");
  });
  it("tanpa lokasi: tercetak 'Lokasi: tidak tersedia' (tidak diam-diam kosong); tanpa akurasi: tanpa ±", () => {
    const base = { at, timeZone: "Asia/Jakarta", kind: "CHECK_IN" as const, employeeName: "A", employeeNo: "1", photoId: ID };
    expect(stampLines({ ...base, location: null })[1]).toBe("Lokasi: tidak tersedia");
    expect(stampLines({ ...base, location: { lat: 1, lng: 2, accuracy: null } })[1]).toBe("1.000000, 2.000000");
  });
});

/** Foto uji: warna rata terang agar pita cap yang gelap mudah terdeteksi. */
const jpeg = (w: number, h: number, extra: (s: Sharp) => Sharp = (s) => s) =>
  extra(sharp({ create: { width: w, height: h, channels: 3, background: { r: 230, g: 230, b: 230 } } }).jpeg()).toBuffer();

const meanLuma = async (buf: Buffer, region: { left: number; top: number; width: number; height: number }) => {
  const { data } = await sharp(buf).extract(region).greyscale().raw().toBuffer({ resolveWithObject: true });
  return data.reduce((a, b) => a + b, 0) / data.length;
};

const LINES = ["31/10/2026 09:15:42 WIB", "-7.795600, 110.369500 (±12 m)", "MASUK · Ayu Lestari (TE-001)", "Waktu server · ID 3F2A91C0"];

describe("stampPhoto — pemrosesan gambar di server", () => {
  it("menghasilkan JPEG; cap tercetak di pita bawah (gelap), area atas tidak berubah", async () => {
    const out = await stampPhoto(await jpeg(800, 600), LINES);
    const m = await sharp(out.jpeg).metadata();
    expect(m.format).toBe("jpeg");
    expect([m.width, m.height]).toEqual([800, 600]);
    expect(await meanLuma(out.jpeg, { left: 0, top: 0, width: 800, height: 300 })).toBeGreaterThan(215); // atas tetap terang
    expect(await meanLuma(out.jpeg, { left: 0, top: 540, width: 800, height: 60 })).toBeLessThan(140); // pita cap gelap
  });

  it("teks BENAR-BENAR tercetak: pita memuat piksel putih (teks) di atas latar gelap — bukan pita kosong", async () => {
    const out = await stampPhoto(await jpeg(800, 600), LINES);
    const { data } = await sharp(out.jpeg).extract({ left: 0, top: 420, width: 800, height: 180 }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const bright = data.filter((v) => v > 200).length;
    expect(bright).toBeGreaterThan(400); // goresan huruf putih
    // Cap yang berbeda menghasilkan gambar berbeda (teks memang bergantung pada isi).
    const other = await stampPhoto(await jpeg(800, 600), ["01/01/2020 00:00:00 WIB", "x", "y", "z"]);
    expect(Buffer.compare(out.jpeg, other.jpeg)).not.toBe(0);
  });

  it("memperkecil ke sisi terpanjang 1280 px tanpa memperbesar foto kecil", async () => {
    const big = await stampPhoto(await jpeg(4000, 3000), LINES);
    expect([big.width, big.height]).toEqual([1280, 960]);
    const small = await stampPhoto(await jpeg(400, 300), LINES);
    expect([small.width, small.height]).toEqual([400, 300]);
  });

  it("orientasi EXIF diterapkan (foto ponsel miring) dan EXIF/GPS bawaan perangkat DIBUANG", async () => {
    const withExif = await jpeg(800, 400, (s) => s.withExif({ IFD0: { Copyright: "rahasia-perangkat" } }).withMetadata({ orientation: 6 }));
    const out = await stampPhoto(withExif, LINES);
    const m = await sharp(out.jpeg).metadata();
    expect([m.width, m.height]).toEqual([400, 800]); // diputar
    expect(m.exif).toBeUndefined();
    expect(out.jpeg.includes(Buffer.from("rahasia-perangkat"))).toBe(false);
  });

  it("PNG transparan diratakan di atas putih; WebP diterima; semuanya keluar sebagai JPEG", async () => {
    const png = await sharp({ create: { width: 500, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const o1 = await stampPhoto(png, LINES);
    expect((await sharp(o1.jpeg).metadata()).format).toBe("jpeg");
    expect(await meanLuma(o1.jpeg, { left: 0, top: 0, width: 500, height: 200 })).toBeGreaterThan(240);
    const webp = await sharp({ create: { width: 500, height: 400, channels: 3, background: "#456" } }).webp().toBuffer();
    expect((await sharp((await stampPhoto(webp, LINES)).jpeg).metadata()).format).toBe("jpeg");
  });

  it("menolak: berkas kosong, bukan gambar, GIF/SVG, terlalu kecil, dan gambar dengan jumlah piksel berlebihan", async () => {
    const bad = async (b: Uint8Array) => { try { await stampPhoto(b, LINES); return null; } catch (e) { return (e as { code?: string; fieldErrors?: Record<string, string> }); } };
    expect((await bad(new Uint8Array()))?.code).toBe("VALIDATION");
    expect((await bad(Buffer.from("ini bukan gambar sama sekali")))?.code).toBe("VALIDATION");
    expect((await bad(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"><script>alert(1)</script></svg>')))?.code).toBe("VALIDATION");
    const gif = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).gif().toBuffer();
    expect((await bad(gif))?.fieldErrors?.photo).toContain("Format");
    expect((await bad(await jpeg(100, 100)))?.fieldErrors?.photo).toContain("Resolusi");
    // Bom dekompresi: gambar datar 7000×7000 (49 jt piksel) kecil di disk tetapi besar di memori → ditolak, bukan menghabiskan memori.
    const bomb = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: "#808080" } }).png({ compressionLevel: 9 }).toBuffer();
    expect((await bad(bomb))?.code).toBe("VALIDATION");
  });

  it("nama sangat panjang / karakter di luar font tidak membuat error: dikecilkan & diganti '?'", async () => {
    const out = await stampPhoto(await jpeg(480, 360), ["31/10/2026 09:15:42 WIB", "-7.795600, 110.369500 (±12 m)", `MASUK · ${"Nama Sangat Panjang ".repeat(6)}(TE-001)`, "Waktu server · ID 3F2A91C0"]);
    expect(out.width).toBe(480);
  });

  it("printable: karakter di luar font (emoji, aksara non-Latin) menjadi '?'; huruf Indonesia & tanda baca tetap", async () => {
    const font = { charToGlyphIndex: (c: string) => (/[ -ɏ·±]/.test(c) ? 1 : 0) };
    expect(printable(font, "Ayu 😀 Lestari 日本")).toBe("Ayu ? Lestari ??");
    expect(printable(font, "MASUK · Ayu (TE-001) ±12 m")).toBe("MASUK · Ayu (TE-001) ±12 m");
  });
});
