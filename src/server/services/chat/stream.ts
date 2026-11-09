import "server-only";
import { prisma } from "../../db";
import { Errors } from "../../errors";
import type { SessionUser } from "../../auth/session";
import { isSessionAlive } from "../../auth/session";
import { CHAT_LIMITS } from "@/lib/chat/types";
import { accessibleMemberships, joinPublicChannels } from "./rooms";
import { assertChatEnabled } from "./shared";

/**
 * ALIRAN SSE "BEL" — hanya memberi tahu ruang mana yang berubah (`{id, lastSeq, rev}`); ISI PESAN TIDAK PERNAH lewat sini. Klien mengambil data lewat
 * REST yang otorisasinya lengkap. Tanpa dependensi baru: cek basis data tiap 2 detik (satu kueri), aman di banyak instance dan tanpa lengket-sesi.
 * Peningkatan di masa depan (LISTEN/NOTIFY) tidak mengubah kontrak ini. Rancangan: docs/OBROLAN.md §5.
 */
const g = globalThis as unknown as { __chatStreams?: Map<string, Set<() => void>> };
const registry = (): Map<string, Set<() => void>> => (g.__chatStreams ??= new Map());

/** Daftarkan aliran; bila melebihi batas per pengguna, aliran tertua ditutup. Mengembalikan fungsi pelepas. */
export function registerStream(userId: string, close: () => void): () => void {
  const reg = registry();
  const set = reg.get(userId) ?? new Set<() => void>();
  set.add(close);
  reg.set(userId, set);
  while (set.size > CHAT_LIMITS.streamsPerUser) { const oldest = set.values().next().value as (() => void) | undefined; if (!oldest) break; set.delete(oldest); oldest(); }
  return () => { set.delete(close); if (!set.size) reg.delete(userId); };
}
export const openStreamCount = (userId?: string): number => (userId ? registry().get(userId)?.size ?? 0 : [...registry().values()].reduce((n, s) => n + s.size, 0));

type Versions = Map<string, { lastSeq: number; rev: number }>;

/**
 * Ruang milik pengguna beserta nomor urut & revisi terkini — SATU kueri ringan per tik. Ruang baru (japri yang baru dimulai orang lain, kanal baru)
 * langsung ikut terdeteksi. Utas penugasan hanya disertakan bila lolos gerbang (dihitung saat pertama muncul dan disegarkan berkala).
 */
async function memberVersions(userId: string): Promise<{ id: string; kind: string; lastSeq: number; rev: number }[]> {
  const rows = await prisma.$queryRaw<{ id: string; kind: string; lastSeq: bigint; rev: bigint }[]>`
    SELECT r.id, r.kind::text AS kind, r."lastSeq", r."rev" FROM chat_members m JOIN chat_rooms r ON r.id = m."roomId"
    WHERE m."userId" = ${userId}::uuid AND r."archivedAt" IS NULL`;
  return rows.map((r) => ({ id: r.id, kind: r.kind, lastSeq: Number(r.lastSeq), rev: Number(r.rev) }));
}

export function openChatStream(req: Request, user: SessionUser): Response {
  assertChatEnabled();
  if (!user.userId) throw Errors.unauthenticated();
  const enc = new TextEncoder();
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let release: (() => void) | null = null;
  let ctrlRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    release?.();
    try { ctrlRef?.close(); } catch { /* sudah tertutup */ }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      ctrlRef = ctrl;
      const send = (event: string, data: unknown) => { if (!closed) ctrl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); };
      release = registerStream(user.userId, close);
      req.signal.addEventListener("abort", close);

      await joinPublicChannels(prisma, user.userId);
      let subjectOk = new Set<string>();
      let lastSubjects = "";
      const snapshot = async (force: boolean): Promise<Versions> => {
        const rows = await memberVersions(user.userId);
        const subjects = rows.filter((r) => r.kind === "SUBJECT").map((r) => r.id).sort().join(",");
        if (force || subjects !== lastSubjects) {
          subjectOk = new Set((await accessibleMemberships(prisma, user)).filter((m) => m.room.kind === "SUBJECT").map((m) => m.room.id));
          lastSubjects = subjects;
        }
        return new Map(rows.filter((r) => r.kind !== "SUBJECT" || subjectOk.has(r.id)).map((r) => [r.id, { lastSeq: r.lastSeq, rev: r.rev }]));
      };
      let known: Versions = await snapshot(true);
      send("hello", { rooms: [...known].map(([id, v]) => ({ id, ...v })) });
      ctrl.enqueue(enc.encode("retry: 3000\n\n"));

      let tick = 0;
      let busy = false;
      const startedAt = Date.now();
      timer = setInterval(() => {
        if (busy || closed) return;
        busy = true;
        void (async () => {
          tick++;
          if (Date.now() - startedAt > CHAT_LIMITS.streamMaxSeconds * 1000) return close(); // klien menyambung ulang otomatis
          if (tick % CHAT_LIMITS.streamSessionCheckTicks === 0 && !(await isSessionAlive(user.sessionId))) return close();
          const now = await snapshot(tick % CHAT_LIMITS.streamAccessRefreshTicks === 0);
          const changed: { id: string; lastSeq: number; rev: number }[] = [];
          for (const [id, v] of now) { const k = known.get(id); if (!k || k.lastSeq !== v.lastSeq || k.rev !== v.rev) changed.push({ id, ...v }); }
          for (const id of known.keys()) if (!now.has(id)) changed.push({ id, lastSeq: -1, rev: -1 }); // ruang hilang dari jangkauan
          known = now;
          if (changed.length) send("sync", { rooms: changed });
          else if (tick % CHAT_LIMITS.streamHeartbeatTicks === 0 && !closed) ctrl.enqueue(enc.encode(": hb\n\n"));
        })().catch(() => close()).finally(() => { busy = false; });
      }, CHAT_LIMITS.streamTickMs);
    },
    cancel() { close(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: kompresi tidak boleh menahan data; X-Accel-Buffering: Nginx tidak boleh menimbun aliran.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
