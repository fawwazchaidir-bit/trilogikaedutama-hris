import { CHAT_LIMITS, type ChatNotifyModeValue, type ChatRef, type ChatRoomKindValue } from "./types";

/** Logika murni Obrolan (tanpa basis data) agar mudah diuji: kunci japri, penormalan isi, sebutan, belum-dibaca, aturan push, jendela sunting. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Kunci unik japri: dua ID akun diurutkan → satu japri per pasangan. */
export function directKey(a: string, b: string): string {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()].sort();
  return `${x}:${y}`;
}

/** Rapikan isi pesan: normalkan baris baru, buang karakter kontrol (kecuali baris baru/tab), potong spasi tepi, ringkas baris kosong berlebih. */
export function normalizeBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/** Token sebutan di isi pesan: `@[Nama Lengkap](uuid-akun)`. */
const MENTION_RE = /@\[([^\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)/g;
const MENTION_ALL = "@semua";

export interface ParsedMentions { userIds: string[]; all: boolean }
export function parseMentions(body: string): ParsedMentions {
  const ids = new Set<string>();
  for (const m of body.matchAll(MENTION_RE)) { const id = m[2]!.toLowerCase(); if (isUuid(id)) ids.add(id); }
  return { userIds: [...ids], all: /(^|\s)@semua(\s|$|[.,!?])/i.test(body) };
}
export { MENTION_ALL };

/** Tampilkan sebutan sebagai "@Nama" (untuk pratinjau teks biasa). */
export function mentionsToPlain(body: string): string {
  return body.replace(MENTION_RE, (_m, name: string) => `@${name}`);
}

/** Potong ke `max` karakter dengan elipsis, satu baris. */
export function snippet(body: string, max = 80): string {
  const one = mentionsToPlain(body).replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** Belum dibaca = selisih nomor urut (tanpa memindai pesan). Tidak pernah negatif. */
export const unreadOf = (lastSeq: number | bigint, lastReadSeq: number | bigint): number => Math.max(0, Number(lastSeq) - Number(lastReadSeq));

/** Pengirim boleh menyunting dalam jendela waktu tertentu, dan hanya bila pesan belum dihapus/dibersihkan. */
export function canEditMessage(m: { senderId: string; createdAt: Date; deletedAt: Date | null; purgedAt: Date | null; kind: string }, userId: string, now: Date = new Date()): boolean {
  if (m.kind !== "TEXT" || m.senderId !== userId || m.deletedAt || m.purgedAt) return false;
  return now.getTime() - m.createdAt.getTime() <= CHAT_LIMITS.editWindowMinutes * 60_000;
}

export interface PushCandidate {
  roomKind: ChatRoomKindValue;
  notifyMode: ChatNotifyModeValue;
  mutedUntil: Date | null;
  lastActiveAt: Date | null;
  lastPushAt: Date | null;
  mentioned: boolean;
}
/**
 * Apakah penerima ini layak diberi push? (Mencegah kelelahan notifikasi.)
 *  - Japri/utas: semua pesan; kanal: hanya bila disebut atau mode ALL.
 *  - Dibisukan/NONE: tidak, kecuali disebut (NONE tetap tidak).
 *  - Sedang melihat ruang (aktif ≤ 20 dtk) → tidak. Jeda 60 dtk per ruang kecuali disebut.
 */
export function shouldPush(c: PushCandidate, now: Date = new Date()): boolean {
  if (c.notifyMode === "NONE") return false;
  const muted = !!c.mutedUntil && c.mutedUntil.getTime() > now.getTime();
  if (muted && !c.mentioned) return false;
  const wants = c.roomKind === "CHANNEL" ? c.mentioned || c.notifyMode === "ALL" : c.notifyMode === "ALL" || c.mentioned;
  if (!wants) return false;
  if (c.lastActiveAt && now.getTime() - c.lastActiveAt.getTime() <= CHAT_LIMITS.presenceSeconds * 1000) return false;
  if (!c.mentioned && c.lastPushAt && now.getTime() - c.lastPushAt.getTime() < CHAT_LIMITS.pushGapSeconds * 1000) return false;
  return true;
}

/** Mode notifikasi bawaan saat menjadi anggota: kanal hanya bila disebut; japri/utas semua. */
export const defaultNotifyMode = (kind: ChatRoomKindValue): ChatNotifyModeValue => (kind === "CHANNEL" ? "MENTIONS" : "ALL");

/** Hilangkan rujukan ganda dan batasi jumlahnya (urutan dipertahankan). */
export function dedupeRefs(refs: ChatRef[]): ChatRef[] {
  const seen = new Set<string>();
  const out: ChatRef[] = [];
  for (const r of refs) { const k = `${r.type}:${r.id.toLowerCase()}`; if (!seen.has(k)) { seen.add(k); out.push({ type: r.type, id: r.id.toLowerCase() }); } }
  return out;
}

/** Slug kanal dari nama: huruf kecil, angka, tanda hubung. */
export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Batas tanggal retensi: pesan lebih tua dari ini dibersihkan isinya. */
export function retentionCutoff(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}
