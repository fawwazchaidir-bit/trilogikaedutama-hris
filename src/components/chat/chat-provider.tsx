"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { ChatRoomDto } from "@/lib/chat/types";

/**
 * Sinkronisasi Obrolan di sisi klien (satu aliran per tab, dipakai bersama oleh lencana menu dan halaman /obrolan).
 *  - EventSource("/api/chat/stream") hanya "bel": ada perubahan → ambil ulang daftar ruang lewat REST (otorisasi penuh).
 *  - Putus/diblokir proxy → polling cadangan tiap 8 detik; EventSource menyambung ulang sendiri.
 *  - Tab tersembunyi > 5 menit → aliran ditutup (push desktop yang menjaga pengguna tetap terhubung); tampil lagi → buka + sinkron.
 */
interface ChatCtx {
  enabled: boolean;
  rooms: ChatRoomDto[];
  totalUnread: number;
  connected: boolean;
  ready: boolean;
  refresh: () => Promise<void>;
}
const Ctx = createContext<ChatCtx>({ enabled: false, rooms: [], totalUnread: 0, connected: false, ready: false, refresh: async () => undefined });
export const useChat = (): ChatCtx => useContext(Ctx);

const POLL_MS = 8000;
const HIDDEN_CLOSE_MS = 5 * 60_000;

export function ChatProvider({ enabled, initialUnread = 0, children }: { enabled: boolean; initialUnread?: number; children: React.ReactNode }) {
  const [rooms, setRooms] = useState<ChatRoomDto[]>([]);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [serverUnread, setServerUnread] = useState(initialUnread);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (inflight.current) return inflight.current;
    inflight.current = (async () => {
      try {
        const list = await api<ChatRoomDto[]>("/api/chat/rooms");
        setRooms(list); setServerUnread(list.reduce((s, r) => s + r.unread, 0)); setReady(true);
      } catch { /* galat jaringan: coba lagi pada tik berikutnya */ } finally { inflight.current = null; }
    })();
    return inflight.current;
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const ring = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void refresh(); }, 150); };
    const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    const startPoll = () => { if (!poll) poll = setInterval(() => { void refresh(); }, POLL_MS); };
    const close = () => { es?.close(); es = null; setConnected(false); };
    const open = () => {
      if (disposed || es || typeof EventSource === "undefined") { if (typeof EventSource === "undefined") startPoll(); return; }
      es = new EventSource("/api/chat/stream");
      es.onopen = () => { setConnected(true); stopPoll(); };
      es.addEventListener("hello", ring);
      es.addEventListener("sync", ring);
      es.onerror = () => { setConnected(false); startPoll(); }; // EventSource menyambung ulang sendiri; sementara itu polling menjaga data tetap segar
    };

    void refresh();
    open();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenTimer = setTimeout(() => { close(); startPoll(); }, HIDDEN_CLOSE_MS); }
      else { if (hiddenTimer) clearTimeout(hiddenTimer); hiddenTimer = null; stopPoll(); if (!es) open(); void refresh(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      if (timer.current) clearTimeout(timer.current);
      stopPoll(); close();
    };
  }, [enabled, refresh]);

  const totalUnread = ready ? rooms.reduce((s, r) => s + r.unread, 0) : serverUnread;
  const value = useMemo<ChatCtx>(() => ({ enabled, rooms, totalUnread, connected, ready, refresh }), [enabled, rooms, totalUnread, connected, ready, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
