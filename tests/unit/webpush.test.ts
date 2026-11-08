import { describe, expect, it } from "vitest";
import { b64u, decryptPayload, encryptPayload, generateVapidKeys, isAllowedPushEndpoint, MAX_PLAINTEXT_BYTES, PushGoneError, sendWebPush, vapidAuthorization, vapidKeysValid, verifyVapid } from "@/lib/webpush";

/** Vektor uji RFC 8291 Lampiran A ("When I grow up, I want to be a watermelon"). */
const RFC = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("enkripsi muatan Web Push (RFC 8291)", () => {
  it("MENDEKRIPSI pesan contoh RFC dengan benar (kunci/auth/salt cocok; tag GCM lolos)", () => {
    const out = decryptPayload(b64u.dec(RFC.body), b64u.dec(RFC.uaPrivate), b64u.dec(RFC.uaPublic), b64u.dec(RFC.auth));
    expect(out.toString()).toBe(RFC.plaintext);
  });
  it("MENGENKRIPSI persis sama dengan pesan contoh RFC (kunci efemeral & salt ditetapkan)", () => {
    const enc = encryptPayload(Buffer.from(RFC.plaintext), b64u.dec(RFC.uaPublic), b64u.dec(RFC.auth), { asPrivate: b64u.dec(RFC.asPrivate), salt: b64u.dec(RFC.salt) });
    expect(b64u.enc(enc)).toBe(RFC.body);
  });
  it("bolak-balik dengan kunci efemeral acak; dua enkripsi dari muatan sama berbeda (salt & kunci acak)", () => {
    const ua = generateVapidKeys(); // pasangan P-256 apa pun berperan sebagai kunci penerima
    const auth = Buffer.from("0123456789abcdef");
    const a = encryptPayload(Buffer.from('{"title":"Tes"}'), b64u.dec(ua.publicKey), auth);
    const b = encryptPayload(Buffer.from('{"title":"Tes"}'), b64u.dec(ua.publicKey), auth);
    expect(a.equals(b)).toBe(false);
    expect(decryptPayload(a, b64u.dec(ua.privateKey), b64u.dec(ua.publicKey), auth).toString()).toBe('{"title":"Tes"}');
  });
  it("tag diubah satu bit → dekripsi gagal; muatan terlalu besar & kunci/auth tak sah ditolak", () => {
    const ua = generateVapidKeys(); const auth = Buffer.alloc(16, 7);
    const m = encryptPayload(Buffer.from("rahasia"), b64u.dec(ua.publicKey), auth);
    m[m.length - 1]! ^= 1;
    expect(() => decryptPayload(m, b64u.dec(ua.privateKey), b64u.dec(ua.publicKey), auth)).toThrow();
    expect(() => encryptPayload(Buffer.alloc(MAX_PLAINTEXT_BYTES + 1), b64u.dec(ua.publicKey), auth)).toThrow(/terlalu besar/);
    expect(() => encryptPayload(Buffer.from("x"), Buffer.alloc(10), auth)).toThrow();
    expect(() => encryptPayload(Buffer.from("x"), b64u.dec(ua.publicKey), Buffer.alloc(8))).toThrow();
  });
});

describe("VAPID (RFC 8292)", () => {
  const keys = generateVapidKeys();
  it("kunci hasil bangkitan sah & sepasang; pasangan acak/rusak ditolak", () => {
    expect(vapidKeysValid(keys)).toBe(true);
    expect(vapidKeysValid({ publicKey: generateVapidKeys().publicKey, privateKey: keys.privateKey })).toBe(false);
    expect(vapidKeysValid({ publicKey: "abc", privateKey: "def" })).toBe(false);
    expect(b64u.dec(keys.publicKey)).toHaveLength(65);
    expect(b64u.dec(keys.privateKey)).toHaveLength(32);
  });
  it("kunci privat selalu 32 byte walau byte pertamanya nol (sekitar 1 dari 256 kunci acak)", () => {
    for (let i = 0; i < 4000; i++) {
      const k = generateVapidKeys();
      expect(b64u.dec(k.privateKey), `kunci ke-${i}`).toHaveLength(32);
      expect(vapidKeysValid(k)).toBe(true);
    }
  });
  it("tajuk Authorization: tanda tangan ES256 sah, aud = asal push service, exp ≤ 24 jam, sub dicantumkan", () => {
    const now = 1_800_000_000;
    const h = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", "mailto:admin@trilogika.test", keys, now);
    const c = verifyVapid(h, keys.publicKey);
    expect(c).toEqual({ aud: "https://fcm.googleapis.com", exp: now + 12 * 3600, sub: "mailto:admin@trilogika.test" });
    expect(c!.exp - now).toBeLessThanOrEqual(24 * 3600);
  });
  it("tanda tangan dari kunci lain / tajuk diubah → tidak lolos verifikasi", () => {
    const other = generateVapidKeys();
    const h = vapidAuthorization("https://fcm.googleapis.com/x", "mailto:a@b.test", keys);
    expect(verifyVapid(h, other.publicKey)).toBeNull();
    expect(verifyVapid(h.replace(/t=./, "t=A"), keys.publicKey)).toBeNull();
  });
});

describe("alamat tujuan push (anti-SSRF)", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/Qabc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc", "https://fcm.googleapis.com:443/fcm/send/x",
  ])("diizinkan: %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(true));
  it.each([
    "http://fcm.googleapis.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x", "https://[::1]/x",
    "https://fcm.googleapis.com.evil.example/x", "https://evilfcm.googleapis.com.evil.example/x", "https://evil.example/fcm.googleapis.com", "https://fcm.googleapis.com@evil.example/x",
    "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://notpush.apple.com.evil.example/x", "ftp://fcm.googleapis.com/x", "bukan url", "",
    "https://evil.example/" + "a".repeat(600),
  ])("ditolak: %s", (u) => expect(isAllowedPushEndpoint(u)).toBe(false));
});

describe("sendWebPush", () => {
  const ua = generateVapidKeys(); const vapid = { ...generateVapidKeys(), subject: "mailto:admin@trilogika.test" };
  const target = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: ua.publicKey, auth: b64u.enc(Buffer.alloc(16, 9)) };
  const respond = (status: number, text = "") => (async () => new Response(text, { status })) as unknown as typeof fetch;

  it("mengirim POST terenkripsi dengan tajuk yang benar; hanya penerima yang dapat membacanya", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    await sendWebPush(target, { title: "Tugas jatuh tempo besok", href: "/training/tugas-saya" }, vapid, { fetchFn: (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(null, { status: 201 }); }) as unknown as typeof fetch });
    expect(seen!.url).toBe(target.endpoint);
    const h = seen!.init.headers as Record<string, string>;
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.TTL).toBe("86400");
    expect(verifyVapid(h.Authorization!, vapid.publicKey)?.aud).toBe("https://fcm.googleapis.com");
    expect(seen!.init.redirect).toBe("manual");
    const plain = decryptPayload(Buffer.from(seen!.init.body as Uint8Array), b64u.dec(ua.privateKey), b64u.dec(ua.publicKey), b64u.dec(target.auth));
    expect(JSON.parse(plain.toString())).toEqual({ title: "Tugas jatuh tempo besok", href: "/training/tugas-saya" });
  });
  it("404/410 → PushGoneError (langganan dihapus); 5xx/429 → galat biasa; alamat tak diizinkan tidak pernah dipanggil", async () => {
    await expect(sendWebPush(target, { a: 1 }, vapid, { fetchFn: respond(410) })).rejects.toBeInstanceOf(PushGoneError);
    await expect(sendWebPush(target, { a: 1 }, vapid, { fetchFn: respond(404) })).rejects.toBeInstanceOf(PushGoneError);
    await expect(sendWebPush(target, { a: 1 }, vapid, { fetchFn: respond(503, "gangguan") })).rejects.toThrow(/HTTP 503/);
    await expect(sendWebPush(target, { a: 1 }, vapid, { fetchFn: respond(429) })).rejects.not.toBeInstanceOf(PushGoneError);
    let called = false;
    await expect(sendWebPush({ ...target, endpoint: "https://169.254.169.254/x" }, { a: 1 }, vapid, { fetchFn: (async () => { called = true; return new Response(null, { status: 201 }); }) as unknown as typeof fetch })).rejects.toThrow(/tidak diizinkan/);
    expect(called).toBe(false);
  });
});
