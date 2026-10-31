/**
 * TOTP (RFC 6238) + HOTP (RFC 4226) dengan HMAC-SHA1, 6 digit, langkah 30 detik — kompatibel dengan Google Authenticator,
 * Microsoft Authenticator, Authy, 1Password, dll. Hanya memakai `node:crypto`.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("Karakter base32 tidak valid");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** Rahasia 160-bit acak, base32 (32 karakter). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0xf;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const totpStep = (nowMs: number, stepSeconds = TOTP_STEP_SECONDS): number => Math.floor(nowMs / 1000 / stepSeconds);

export function totpAt(secretB32: string, nowMs: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secretB32), totpStep(nowMs), digits);
}

export interface TotpVerdict { ok: boolean; step?: number }

/**
 * Verifikasi kode. Toleransi ±`window` langkah (selisih jam perangkat). `lastStep` mencegah kode yang sama dipakai dua kali:
 * hanya langkah LEBIH BESAR dari yang terakhir diterima yang sah. Perbandingan waktu-konstan.
 */
export function verifyTotp(secretB32: string, code: string, opts: { nowMs?: number; window?: number; lastStep?: number | null } = {}): TotpVerdict {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false };
  const secret = base32Decode(secretB32);
  const now = totpStep(opts.nowMs ?? Date.now());
  const window = opts.window ?? 1;
  let matched: number | undefined;
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    const expected = Buffer.from(hotp(secret, step));
    // Tetap memeriksa semua langkah agar waktu respons tidak membocorkan langkah mana yang cocok.
    if (timingSafeEqual(expected, Buffer.from(clean)) && matched === undefined && (opts.lastStep == null || step > opts.lastStep)) matched = step;
  }
  return matched === undefined ? { ok: false } : { ok: true, step: matched };
}

export function otpauthUri(args: { issuer: string; account: string; secret: string }): string {
  const label = `${encodeURIComponent(args.issuer)}:${encodeURIComponent(args.account)}`;
  const q = new URLSearchParams({ secret: args.secret, issuer: args.issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}

// ─────────────────────────── Kode pemulihan ───────────────────────────

/** Tanpa karakter yang mudah tertukar (0/O, 1/I/L). */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 10 karakter acak (~49 bit) diformat "XXXXX-XXXXX". */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let s = "";
  for (const b of bytes) s += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** Huruf besar, tanpa spasi/strip — bentuk yang di-hash dan dibandingkan. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export const looksLikeRecoveryCode = (input: string): boolean => /^[A-Z2-9]{10}$/.test(normalizeRecoveryCode(input));
