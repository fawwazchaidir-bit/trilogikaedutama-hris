import { describe, expect, it } from "vitest";
import {
  base32Decode, base32Encode, generateRecoveryCode, generateTotpSecret, hotp, looksLikeRecoveryCode, normalizeRecoveryCode, otpauthUri, totpAt, totpStep, verifyTotp,
} from "@/lib/totp";

// Rahasia uji RFC 4226/6238: ASCII "12345678901234567890"
const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890"));

describe("HOTP — vektor RFC 4226", () => {
  const key = Buffer.from("12345678901234567890");
  it.each([[0, "755224"], [1, "287082"], [2, "359152"], [3, "969429"], [4, "338314"], [5, "254676"], [6, "287922"], [7, "162583"], [8, "399871"], [9, "520489"]])("counter %i → %s", (c, expected) => {
    expect(hotp(key, c)).toBe(expected);
  });
});

describe("TOTP — vektor RFC 6238 (SHA1, 8 digit → 6 digit terakhir)", () => {
  it.each([[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]])("t=%i", (t, eight) => {
    expect(totpAt(RFC_SECRET_B32, t * 1000, 8)).toBe(eight);
    expect(totpAt(RFC_SECRET_B32, t * 1000)).toBe(eight.slice(2));
  });
});

describe("base32", () => {
  it("bolak-balik; mengabaikan spasi/huruf kecil/padding; menolak karakter tidak valid", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 8, 9]);
    expect(base32Decode(base32Encode(buf)).equals(buf)).toBe(true);
    expect(base32Decode("jbsw y3dp ehpk 3pxp==").equals(base32Decode("JBSWY3DPEHPK3PXP"))).toBe(true);
    expect(() => base32Decode("ABC1")).toThrow();
  });
  it("rahasia acak: 32 karakter base32, unik", () => {
    const a = generateTotpSecret(), b = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe("verifyTotp", () => {
  const NOW = 1_700_000_000_000;
  const code = (offset: number) => totpAt(RFC_SECRET_B32, NOW + offset * 30_000);
  it("menerima langkah sekarang, ±1; menolak ±2", () => {
    expect(verifyTotp(RFC_SECRET_B32, code(0), { nowMs: NOW }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code(-1), { nowMs: NOW }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code(1), { nowMs: NOW }).ok).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code(-2), { nowMs: NOW }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, code(2), { nowMs: NOW }).ok).toBe(false);
  });
  it("replay: kode pada langkah yang sudah dipakai (≤ lastStep) ditolak; langkah lebih baru diterima", () => {
    const r = verifyTotp(RFC_SECRET_B32, code(0), { nowMs: NOW });
    expect(r.ok).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code(0), { nowMs: NOW, lastStep: r.step }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, code(-1), { nowMs: NOW, lastStep: r.step }).ok).toBe(false); // mundur juga ditolak
    expect(verifyTotp(RFC_SECRET_B32, code(1), { nowMs: NOW, lastStep: r.step }).ok).toBe(true);
  });
  it("format salah ditolak: pendek, huruf, 7 digit; spasi diabaikan", () => {
    expect(verifyTotp(RFC_SECRET_B32, "12345", { nowMs: NOW }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "abcdef", { nowMs: NOW }).ok).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, "1234567", { nowMs: NOW }).ok).toBe(false);
    const c = code(0);
    expect(verifyTotp(RFC_SECRET_B32, `${c.slice(0, 3)} ${c.slice(3)}`, { nowMs: NOW }).ok).toBe(true);
  });
  it("kode untuk rahasia lain ditolak", () => {
    expect(verifyTotp(generateTotpSecret(), code(0), { nowMs: NOW }).ok).toBe(false);
  });
  it("totpStep & otpauth URI memuat parameter yang benar dan ter-encode", () => {
    expect(totpStep(59_000)).toBe(1);
    const u = otpauthUri({ issuer: "Trilogika HRIS", account: "ayu@demo.test", secret: "JBSWY3DPEHPK3PXP" });
    expect(u).toContain("otpauth://totp/Trilogika%20HRIS:ayu%40demo.test");
    expect(u).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(u).toContain("digits=6");
    expect(u).toContain("period=30");
  });
});

describe("kode pemulihan", () => {
  it("format XXXXX-XXXXX tanpa karakter ambigu; unik; normalisasi menerima huruf kecil/spasi/tanpa strip", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRecoveryCode()));
    expect(codes.size).toBe(200);
    for (const c of codes) { expect(c).toMatch(/^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/); expect(looksLikeRecoveryCode(c)).toBe(true); }
    expect(normalizeRecoveryCode(" abcde-fghjk ")).toBe("ABCDEFGHJK");
    expect(looksLikeRecoveryCode("123456")).toBe(false);
  });
});
