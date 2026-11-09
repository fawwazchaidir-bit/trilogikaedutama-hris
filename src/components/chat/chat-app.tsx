"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Hash, MessageSquarePlus, Plus, Search, UserRound, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/field";
import { EmptyState, Notice } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import type { ChatDirectoryEntry, ChatRoomDto } from "@/lib/chat/types";
import { ChatThread } from "./chat-thread";
import { useChat } from "./chat-provider";

interface Me { userId: string; name: string; canModerate: boolean; canAudit: boolean }

const SECTIONS: { kind: ChatRoomDto["kind"]; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { kind: "CHANNEL", label: "Kanal", icon: Hash }, { kind: "SUBJECT", label: "Penugasan", icon: Link2 }, { kind: "DIRECT", label: "Japri", icon: UserRound },
];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }) : "");

export function ChatApp({ me, initialRoomId }: { me: Me; initialRoomId: string | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const toast = useToast();
  const { rooms, ready, connected, refresh } = useChat();
  const [q, setQ] = useState("");
  const [newDirect, setNewDirect] = useState(false);
  const [newChannel, setNewChannel] = useState(false);
  const [extra, setExtra] = useState<ChatRoomDto | null>(null); // ruang yang dibuka lewat tautan tetapi belum ada di daftar (mis. pemeriksaan Direktur)
  const selectedId = sp.get("room") ?? initialRoomId;
  const selected = rooms.find((r) => r.id === selectedId) ?? (extra?.id === selectedId ? extra : null);

  useEffect(() => {
    if (!selectedId || !ready || rooms.some((r) => r.id === selectedId) || extra?.id === selectedId) return;
    let off = false;
    void api<ChatRoomDto>(`/api/chat/rooms/${selectedId}`).then((r) => { if (!off) setExtra(r); }).catch(() => { if (!off) toast.error("Ruang obrolan tidak ditemukan."); });
    return () => { off = true; };
  }, [selectedId, ready, rooms, extra, toast]);

  const open = (id: string | null) => router.replace(id ? `/obrolan?room=${id}` : "/obrolan", { scroll: false });
  const filtered = useMemo(() => rooms.filter((r) => !q.trim() || `${r.title} ${r.subtitle ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())), [rooms, q]);

  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-[28rem] overflow-hidden rounded-xl border border-line bg-white shadow-sm">
      <aside className={cn("w-full shrink-0 flex-col border-r border-line md:flex md:w-80", selected ? "hidden" : "flex")} aria-label="Daftar ruang obrolan">
        <div className="space-y-2 border-b border-line p-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari ruang" aria-label="Cari ruang" className="h-9 w-full rounded-md border border-line bg-white pl-8 pr-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200" />
            </div>
            <Button size="sm" variant="primary" onClick={() => setNewDirect(true)} aria-label="Japri baru"><MessageSquarePlus className="size-4" />Japri</Button>
          </div>
          {(me.canModerate || me.canAudit) && (
            <div className="flex flex-wrap gap-2">
              {me.canModerate && <Button size="sm" onClick={() => setNewChannel(true)}><Plus className="size-4" />Kanal baru</Button>}
              {me.canAudit && <a href="/obrolan/pemeriksaan" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-brand-200 bg-white px-3 text-sm font-medium text-brand-700 hover:bg-brand-50">Pemeriksaan japri</a>}
            </div>
          )}
          <p className="text-xs text-muted" aria-live="polite">{connected ? "Terhubung langsung" : ready ? "Memuat ulang berkala (8 dtk)" : "Memuat…"}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!ready ? <p className="p-4 text-sm text-muted">Memuat ruang…</p> : SECTIONS.map(({ kind, label, icon: Icon }) => {
            const items = filtered.filter((r) => r.kind === kind);
            if (!items.length && kind !== "DIRECT") return null;
            return (
              <div key={kind} className="py-1">
                <h3 className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h3>
                {items.length === 0 && <p className="px-4 pb-2 text-sm text-muted">Belum ada japri. Mulai dengan tombol “Japri”.</p>}
                <ul>{items.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => open(r.id)} aria-current={r.id === selectedId ? "true" : undefined}
                      className={cn("flex w-full items-start gap-2.5 px-4 py-2.5 text-left hover:bg-canvas", r.id === selectedId && "bg-brand-50")}>
                      <Icon className="mt-0.5 size-4 shrink-0 text-ink-soft" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2"><span className={cn("truncate text-sm", r.unread ? "font-semibold text-ink" : "font-medium text-ink-soft")}>{r.title}</span><span className="shrink-0 text-[11px] text-muted">{when(r.lastMessageAt)}</span></span>
                        <span className="block truncate text-xs text-muted">{r.preview ? `${r.preview.senderName}: ${r.preview.text}` : r.subtitle ?? "Belum ada pesan"}</span>
                      </span>
                      {r.unread > 0 && <span className={cn("mt-0.5 shrink-0 rounded-full px-1.5 text-[11px] font-semibold text-white", r.mentionUnread ? "bg-amber-600" : "bg-brand-600")} aria-label={`${r.unread} belum dibaca${r.mentionUnread ? `, ${r.mentionUnread} sebutan` : ""}`}>{r.unread}</span>}
                    </button>
                  </li>
                ))}</ul>
              </div>
            );
          })}
        </div>
      </aside>
      <div className={cn("min-w-0 flex-1", selected ? "block" : "hidden md:block")}>
        {selected ? <ChatThread key={selected.id} room={selected} me={me} onBack={() => open(null)} /> : (
          <div className="flex h-full items-center justify-center p-6"><EmptyState title="Pilih percakapan" description="Pilih ruang di sebelah kiri, atau mulai japri baru. Untuk koordinasi penugasan, buka tombol “Diskusi” pada Surat Tugas atau tugas Training." /></div>
        )}
      </div>

      <NewDirectDialog open={newDirect} onClose={() => setNewDirect(false)} onPicked={async (id) => { setNewDirect(false); await refresh(); open(id); }} />
      <NewChannelDialog open={newChannel} onClose={() => setNewChannel(false)} onCreated={async (id) => { setNewChannel(false); await refresh(); open(id); }} />
    </div>
  );
}

function NewDirectDialog({ open, onClose, onPicked }: { open: boolean; onClose: () => void; onPicked: (roomId: string) => void }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [list, setList] = useState<ChatDirectoryEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let off = false;
    const t = setTimeout(() => { void api<ChatDirectoryEntry[]>(`/api/chat/directory?q=${encodeURIComponent(q)}`).then((r) => { if (!off) setList(r); }).catch((e) => toast.error(errorMessage(e))); }, 150);
    return () => { off = true; clearTimeout(t); };
  }, [open, q, toast]);
  async function pick(p: ChatDirectoryEntry) {
    setBusy(p.userId);
    try { const r = await api<{ id: string }>("/api/chat/direct", { body: { userId: p.userId } }); onPicked(r.id); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Japri baru" description="Pilih rekan kerja. Nama, jabatan, dan divisi saja yang ditampilkan.">
      <div className="space-y-3">
        <TextField label="Cari nama" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <ul className="max-h-72 divide-y divide-line overflow-auto rounded-md border border-line" aria-label="Hasil pencarian">
          {list.length === 0 ? <li className="px-3 py-3 text-sm text-muted">Tidak ada hasil.</li> : list.map((p) => (
            <li key={p.userId}><button type="button" disabled={busy !== null} onClick={() => void pick(p)} className="block w-full px-3 py-2 text-left hover:bg-canvas disabled:opacity-60"><span className="text-sm font-medium text-ink">{p.name}</span><span className="block text-xs text-muted">{[p.position, p.division].filter(Boolean).join(" · ") || "—"}</span></button></li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

function NewChannelDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (roomId: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setErr(null);
    try { const r = await api<{ id: string }>("/api/chat/channels", { body: { name } }); setName(""); onCreated(r.id); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} size="sm" title="Kanal publik baru" description="Semua karyawan aktif otomatis menjadi anggota dan dapat membaca serta menulis."
      footer={<><Button onClick={onClose} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 3} onClick={() => void create()}>Buat kanal</Button></>}>
      <div className="space-y-3">{err && <Notice tone="danger">{err}</Notice>}<TextField label="Nama kanal" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} hint="Mis. Operasional Lapangan" autoFocus /></div>
    </Dialog>
  );
}
