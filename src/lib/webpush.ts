/**
 * Web Push tanpa pustaka tambahan: enkripsi muatan (RFC 8291 + RFC 8188, aes128gcm), tajuk VAPID (RFC 8292, ES256), dan penjaga alamat tujuan.
 * Murni (hanya `node:crypto`); pengiriman jaringan ada di `src/server/notify/transports.ts`. Diverifikasi dengan vektor uji RFC 8291 §5/Lampiran A.
 */
import { createCipheriv, createDecipheriv, createECDH, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign, verify } from "node:crypto";

export const b64u = { enc: (b: Uint8Array): string => Buffer.from(b).toString("base64url"), dec: (s: string): Buffer => Buffer.from(s, "base64url") };

/** Ukuran rekaman (RFC 8188). Muatan kami satu rekaman; push service menerima ≤ 4096 byte. */
const RECORD_SIZE = 4096;
export const MAX_PLAINTEXT_BYTES = 3000;

export interface VapidKeys { publicKey: string; privateKey: string }

/** Pasangan kunci VAPID baru (P-256): publik 65 byte (tak terkompresi) dan privat 32 byte, base64url. Dibuat sekali oleh admin, disimpan di .env. */
export function generateVapidKeys(): VapidKeys {
  const e = createECDH("prime256v1");
  e.generateKeys();
  // Kunci privat 32 byte; Node membuang byte nol di depan (sekitar 1 dari 256 kunci) sehingga harus diberi bantalan agar tetap 32 byte.
  const priv = e.getPrivateKey();
  return { publicKey: b64u.enc(e.getPublicKey()), privateKey: b64u.enc(priv.length === 32 ? priv : Buffer.concat([Buffer.alloc(32 - priv.length), priv])) };
}

/** Kunci publik harus 65 byte berawalan 0x04, privat 32 byte, dan keduanya SEPASANG. */
export function vapidKeysValid(k: VapidKeys): boolean {
  try {
    const pub = b64u.dec(k.publicKey), priv = b64u.dec(k.privateKey);
    if (pub.length !== 65 || pub[0] !== 0x04 || priv.length !== 32) return false;
    const e = createECDH("prime256v1");
    e.setPrivateKey(priv);
    return e.getPublicKey().equals(pub);
  } catch { return false; }
}

/** Enkripsi `plain` untuk satu langganan (`uaPublic` 65 byte, `authSecret` 16 byte). `fixed` hanya untuk uji vektor RFC. */
export function encryptPayload(plain: Uint8Array, uaPublic: Buffer, authSecret: Buffer, fixed: { asPrivate?: Buffer; salt?: Buffer } = {}): Buffer {
  if (plain.length > MAX_PLAINTEXT_BYTES) throw new Error("Muatan push terlalu besar.");
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("Kunci publik langganan tidak sah.");
  if (authSecret.length !== 16) throw new Error("Rahasia auth langganan tidak sah.");
  const as = createECDH("prime256v1");
  if (fixed.asPrivate) as.setPrivateKey(fixed.asPrivate); else as.generateKeys();
  const asPublic = as.getPublicKey();
  const secret = as.computeSecret(uaPublic);
  // RFC 8291 §3.4: IKM = HKDF(auth, ECDH, "WebPush: info" 0x00 ua_public as_public, 32)
  const ikm = Buffer.from(hkdfSync("sha256", secret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const salt = fixed.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plain), Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]); // 0x02 = pembatas rekaman terakhir
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(RECORD_SIZE, 16); head.writeUInt8(asPublic.length, 20);
  return Buffer.concat([head, asPublic, body]);
}

/** Kebalikan `encryptPayload` (sisi penerima) — dipakai tes untuk membuktikan keluaran dapat dibaca oleh peramban. */
export function decryptPayload(message: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): Buffer {
  const salt = message.subarray(0, 16), idLen = message.readUInt8(20);
  const asPublic = message.subarray(21, 21 + idLen), ct = message.subarray(21 + idLen);
  const ua = createECDH("prime256v1");
  ua.setPrivateKey(uaPrivate);
  const secret = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync("sha256", secret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const padded = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  const end = padded.lastIndexOf(0x02);
  return padded.subarray(0, end);
}

const jwk = (keys: VapidKeys, withPrivate: boolean) => {
  const pub = b64u.dec(keys.publicKey);
  return { kty: "EC" as const, crv: "P-256" as const, x: b64u.enc(pub.subarray(1, 33)), y: b64u.enc(pub.subarray(33, 65)), ...(withPrivate ? { d: keys.privateKey } : {}) };
};

/** Tajuk `Authorization: vapid t=<JWT ES256>, k=<kunci publik>` untuk satu push service (aud = asal alamat tujuan). Berlaku 12 jam (batas RFC: 24). */
export function vapidAuthorization(endpoint: string, subject: string, keys: VapidKeys, nowSec = Math.floor(Date.now() / 1000)): string {
  const head = b64u.enc(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.enc(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })));
  const data = `${head}.${claims}`;
  const sig = sign("sha256", Buffer.from(data), { key: createPrivateKey({ key: jwk(keys, true), format: "jwk" }), dsaEncoding: "ieee-p1363" });
  return `vapid t=${data}.${b64u.enc(sig)}, k=${keys.publicKey}`;
}

/** Verifikasi JWT VAPID (untuk uji) dan kembalikan klaimnya; null bila tanda tangan salah. */
export function verifyVapid(header: string, publicKey: string): { aud: string; exp: number; sub: string } | null {
  const m = /^vapid t=([\w-]+\.[\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  if (!m || m[3] !== publicKey) return null;
  const ok = verify("sha256", Buffer.from(m[1]!), { key: createPublicKey({ key: jwk({ publicKey, privateKey: "" }, false), format: "jwk" }), dsaEncoding: "ieee-p1363" }, b64u.dec(m[2]!));
  return ok ? (JSON.parse(b64u.dec(m[1]!.split(".")[1]!).toString()) as { aud: string; exp: number; sub: string }) : null;
}

/**
 * Alamat tujuan push berasal dari peramban pengguna, jadi TIDAK BOLEH dipercaya (server akan mengirim POST ke sana → risiko SSRF ke jaringan dalam).
 * Hanya push service resmi peramban: Google (Chrome/Edge/Opera), Mozilla (Firefox), Apple (Safari), Windows Notification Service. HTTPS, tanpa kredensial & port khusus.
 */
export function isAllowedPushEndpoint(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || raw.length > 600) return false;
  const h = u.hostname.toLowerCase();
  return h === "fcm.googleapis.com" || h === "updates.push.services.mozilla.com" || h.endsWith(".push.services.mozilla.com") || h.endsWith(".push.apple.com") || h.endsWith(".notify.windows.com");
}

export class PushGoneError extends Error { constructor(readonly status: number) { super(`Langganan push sudah tidak berlaku (HTTP ${status}).`); this.name = "PushGoneError"; } }

export interface PushTarget { endpoint: string; p256dh: string; auth: string }
export interface PushConfig extends VapidKeys { subject: string }

/** Kirim satu pesan push. 404/410 → `PushGoneError` (hapus langganan); galat lain → Error (coba lagi). Tidak mengikuti pengalihan. */
export async function sendWebPush(target: PushTarget, payload: Record<string, unknown>, cfg: PushConfig, opts: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; fetchFn?: typeof fetch } = {}): Promise<void> {
  if (!isAllowedPushEndpoint(target.endpoint)) throw new Error("Alamat layanan push tidak diizinkan.");
  const body = encryptPayload(Buffer.from(JSON.stringify(payload)), b64u.dec(target.p256dh), b64u.dec(target.auth));
  const res = await (opts.fetchFn ?? fetch)(target.endpoint, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000), body: new Uint8Array(body),
    headers: { "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "Content-Length": String(body.length), TTL: String(opts.ttlSeconds ?? 86_400), Urgency: opts.urgency ?? "normal", Authorization: vapidAuthorization(target.endpoint, cfg.subject, cfg) },
  });
  if (res.status === 404 || res.status === 410) throw new PushGoneError(res.status);
  if (res.status < 200 || res.status >= 300) throw new Error(`Layanan push menolak (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`);
}
