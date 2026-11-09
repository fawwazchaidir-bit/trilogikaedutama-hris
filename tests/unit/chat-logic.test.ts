import { describe, expect, it } from "vitest";
import { canEditMessage, dedupeRefs, defaultNotifyMode, directKey, mentionsToPlain, normalizeBody, parseMentions, retentionCutoff, shouldPush, slugify, snippet, unreadOf } from "@/lib/chat/logic";
import { CHAT_LIMITS } from "@/lib/chat/types";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-11-09T05:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);

describe("kunci japri", () => {
  it("urutan pasangan tidak berpengaruh dan huruf besar/kecil disamakan", () => {
    expect(directKey(U1, U2)).toBe(directKey(U2, U1));
    expect(directKey(U1.toUpperCase(), U2)).toBe(directKey(U1, U2));
    expect(directKey(U1, U2)).toBe(`${U1}:${U2}`);
  });
});

describe("penormalan isi pesan", () => {
  it("menormalkan baris baru, membuang karakter kontrol & pengarah arah, memotong tepi", () => {
    expect(normalizeBody("  halo\r\nsemua \u0000‮  \n\n\n\n\n\nlagi  ")).toBe("halo\nsemua\n\n\nlagi");
    expect(normalizeBody("​x‏")).toBe("x");
  });
  it("tidak mengubah teks HTML (aman karena ditampilkan sebagai teks biasa)", () => {
    expect(normalizeBody("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("sebutan", () => {
  it("mengurai token @[Nama](uuid), mengabaikan token rusak, dan mendeteksi @semua", () => {
    const body = `Halo @[Budi](${U1}) dan @[Citra](${U2.toUpperCase()}), @[Rusak](bukan-uuid) @semua tolong cek`;
    const p = parseMentions(body);
    expect(p.userIds.sort()).toEqual([U1, U2].sort());
    expect(p.all).toBe(true);
    expect(parseMentions("tidak ada@semuaorang").all).toBe(false);
    expect(parseMentions(`@[A](${U1}) @[A](${U1})`).userIds).toEqual([U1]);
  });
  it("pratinjau teks biasa menampilkan @Nama", () => {
    expect(mentionsToPlain(`Cek @[Budi Santoso](${U1}) ya`)).toBe("Cek @Budi Santoso ya");
    expect(snippet(`Cek @[Budi](${U1})\nsekarang`, 12)).toBe("Cek @Budi s…");
  });
});

describe("belum dibaca", () => {
  it("selisih nomor urut, tidak pernah negatif", () => {
    expect(unreadOf(10, 7)).toBe(3);
    expect(unreadOf(BigInt(5), BigInt(9))).toBe(0);
  });
});

describe("sunting", () => {
  const m = { senderId: U1, createdAt: ago(60), deletedAt: null, purgedAt: null, kind: "TEXT" };
  it("hanya pengirim, dalam jendela, pesan teks yang belum dihapus", () => {
    expect(canEditMessage(m, U1, now)).toBe(true);
    expect(canEditMessage(m, U2, now)).toBe(false);
    expect(canEditMessage({ ...m, createdAt: ago(CHAT_LIMITS.editWindowMinutes * 60 + 1) }, U1, now)).toBe(false);
    expect(canEditMessage({ ...m, deletedAt: ago(5) }, U1, now)).toBe(false);
    expect(canEditMessage({ ...m, purgedAt: ago(5) }, U1, now)).toBe(false);
    expect(canEditMessage({ ...m, kind: "SYSTEM" }, U1, now)).toBe(false);
  });
});

describe("aturan push", () => {
  const base = { roomKind: "DIRECT" as const, notifyMode: "ALL" as const, mutedUntil: null, lastActiveAt: null, lastPushAt: null, mentioned: false };
  it("japri: kirim bila tidak sedang aktif dan di luar jeda", () => {
    expect(shouldPush(base, now)).toBe(true);
    expect(shouldPush({ ...base, lastActiveAt: ago(5) }, now)).toBe(false);       // sedang membuka ruang
    expect(shouldPush({ ...base, lastActiveAt: ago(120) }, now)).toBe(true);
    expect(shouldPush({ ...base, lastPushAt: ago(30) }, now)).toBe(false);        // jeda 60 dtk
    expect(shouldPush({ ...base, lastPushAt: ago(30), mentioned: true }, now)).toBe(true); // disebut menembus jeda
    expect(shouldPush({ ...base, lastPushAt: ago(61) }, now)).toBe(true);
  });
  it("kanal: hanya bila disebut (mode MENTIONS) atau mode ALL", () => {
    expect(shouldPush({ ...base, roomKind: "CHANNEL", notifyMode: "MENTIONS" }, now)).toBe(false);
    expect(shouldPush({ ...base, roomKind: "CHANNEL", notifyMode: "MENTIONS", mentioned: true }, now)).toBe(true);
    expect(shouldPush({ ...base, roomKind: "CHANNEL", notifyMode: "ALL" }, now)).toBe(true);
  });
  it("dibisukan: tidak, kecuali disebut; NONE: tidak pernah", () => {
    const muted = { ...base, mutedUntil: new Date(now.getTime() + 3_600_000) };
    expect(shouldPush(muted, now)).toBe(false);
    expect(shouldPush({ ...muted, mentioned: true }, now)).toBe(true);
    expect(shouldPush({ ...base, notifyMode: "NONE", mentioned: true }, now)).toBe(false);
    expect(shouldPush({ ...base, mutedUntil: new Date(now.getTime() - 1000) }, now)).toBe(true); // pembisuan sudah lewat
  });
  it("mode bawaan: kanal MENTIONS, selain itu ALL", () => {
    expect(defaultNotifyMode("CHANNEL")).toBe("MENTIONS");
    expect(defaultNotifyMode("DIRECT")).toBe("ALL");
    expect(defaultNotifyMode("SUBJECT")).toBe("ALL");
  });
});

describe("rujukan, slug, retensi", () => {
  it("rujukan ganda dibuang (tidak peka huruf besar/kecil)", () => {
    expect(dedupeRefs([{ type: "TRAINING_TASK", id: U1.toUpperCase() }, { type: "TRAINING_TASK", id: U1 }, { type: "ASSIGNMENT_LETTER", id: U1 }])).toHaveLength(2);
  });
  it("slug kanal", () => {
    expect(slugify("Koordinasi Tim Lapangan!")).toBe("koordinasi-tim-lapangan");
    expect(slugify("  Éksperimén  ")).toBe("eksperimen");
  });
  it("batas retensi mundur sejumlah bulan", () => {
    expect(retentionCutoff(new Date("2026-11-09T00:00:00Z"), 6).toISOString()).toBe("2026-05-09T00:00:00.000Z");
  });
});
