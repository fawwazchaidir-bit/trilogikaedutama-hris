"use client";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api-client";
import type { ChatRoomDto } from "@/lib/chat/types";

/**
 * Sinkronisasi Obrolan di sisi klien (satu aliran per tab, dipakai bersama oleh lencana menu, halaman /obrolan, dan tombol Diskusi).
 *  - EventSource("/api/chat/stream") hanya "bel": ada perubahan → ambil ulang daftar ruang lewat REST (otorisasi penuh).
 *  - Putus/diblokir proxy → polling cadangan tiap 8 detik; EventSource menyambung ulang sendiri.
 *  - Tab tersembunyi > 5 menit → aliran ditutup (push desktop yang menjaga pengguna tetap terhubung); tampil lagi → buka + sinkron.
 *
 * PENTING (arsitektur): status disimpan di STORE EKSTERNAL (useSyncExternalStore), bukan di React Context. Nilai context yang berubah menjalar ke
 * seluruh pohon di bawahnya dan memaksa batas Suspense yang masih mengalir (streaming) dihidrasi lebih awal — akibatnya konten halaman
 * terduplikasi di DOM. Context di sini hanya membawa referensi store yang tidak pernah berubah; yang berubah hanya komponen yang berlangganan.
 */
export interface ChatState {
  enabled: boolean;
  rooms: ChatRoomDto[];
  totalUnread: number;
  connected: boolean;
  ready: boolean;
}
export interface ChatApi extends ChatState { refresh: () => Promise<void> }

const POLL_MS = 8000;
const HIDDEN_CLOSE_MS = 5 * 60_000;

function createStore(enabled: boolean, initialUnread: number) {
  const initial: ChatState = { enabled, rooms: [], totalUnread: initialUnread, connected: false, ready: false };
  let state: ChatState = initial;
  const listeners = new Set<() => void>();
  const set = (patch: Partial<ChatState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
  let inflight: Promise<void> | null = null;

  const refresh = async (): Promise<void> => {
    if (!enabled) return;
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const list = await api<ChatRoomDto[]>("/api/chat/rooms");
        set({ rooms: list, totalUnread: list.reduce((s, r) => s + r.unread, 0), ready: true });
      } catch { /* galat jaringan: coba lagi pada tik berikutnya */ } finally { inflight = null; }
    })();
    return inflight;
  };

  /** Mulai sinkronisasi (aliran + polling cadangan + visibilitas). Mengembalikan fungsi pembersih. */
  const start = (): (() => void) => {
    if (!enabled) return () => undefined;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let ringTimer: ReturnType<typeof setTimeout> | null = null;
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const ring = () => { if (ringTimer) clearTimeout(ringTimer); ringTimer = setTimeout(() => { void refresh(); }, 150); };
    const stopPoll = () => { if (poll) { clearInterval(poll); poll = null; } };
    const startPoll = () => { if (!poll) poll = setInterval(() => { void refresh(); }, POLL_MS); };
    const close = () => { es?.close(); es = null; set({ connected: false }); };
    const open = () => {
      if (disposed || es) return;
      if (typeof EventSource === "undefined") { startPoll(); return; }
      es = new EventSource("/api/chat/stream");
      es.onopen = () => { set({ connected: true }); stopPoll(); };
      es.addEventListener("hello", ring);
      es.addEventListener("sync", ring);
      es.onerror = () => { set({ connected: false }); startPoll(); }; // EventSource menyambung ulang sendiri; sementara itu polling menjaga data tetap segar
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") { hiddenTimer = setTimeout(() => { close(); startPoll(); }, HIDDEN_CLOSE_MS); }
      else { if (hiddenTimer) clearTimeout(hiddenTimer); hiddenTimer = null; stopPoll(); if (!es) open(); void refresh(); }
    };
    void refresh();
    open();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      if (ringTimer) clearTimeout(ringTimer);
      stopPoll(); close();
    };
  };

  return { subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; }, getSnapshot: () => state, getServerSnapshot: () => initial, refresh, start };
}
type Store = ReturnType<typeof createStore>;

const StoreCtx = createContext<Store | null>(null);
const OFF: ChatApi = { enabled: false, rooms: [], totalUnread: 0, connected: false, ready: false, refresh: async () => undefined };
const noopSubscribe = () => () => undefined;

export function useChat(): ChatApi {
  const store = useContext(StoreCtx);
  const snap = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? (() => OFF), store?.getServerSnapshot ?? (() => OFF));
  if (!store) return OFF;
  return { ...snap, refresh: store.refresh };
}

export function ChatProvider({ enabled, initialUnread = 0, children }: { enabled: boolean; initialUnread?: number; children: React.ReactNode }) {
  // Satu store per pemasangan; nilai awal diambil sekali (perubahan prop saat navigasi tidak boleh mengubah nilai context).
  const [store] = useState(() => createStore(enabled, initialUnread));
  useEffect(() => store.start(), [store]);
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}
