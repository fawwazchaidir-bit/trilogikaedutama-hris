"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Link2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { Menu } from "@/components/ui/menu";
import { TextAreaField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { canEditMessage } from "@/lib/chat/logic";
import { CHAT_LIMITS, type ChatDirectoryEntry, type ChatMessageDto, type ChatRefCardDto, type ChatRoomDto } from "@/lib/chat/types";
import { MessageText } from "./message-text";
import { useChat } from "./chat-provider";

const TZ = "Asia/Jakarta";
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
const initials = (n: string) => n.split(/\s+/).slice(0, 2).map((p) => p[0] ?? "").join("").toUpperCase();

interface Pending { clientMsgId: string; body: string; refs: ChatRefCardDto[]; replyToId: string | null; status: "sending" | "failed"; error?: string }
interface Me { userId: string; name: string; canModerate: boolean }
interface Page { items: ChatMessageDto[]; hasMore: boolean; lastSeq: number }

/** Gabungkan pesan server berdasarkan id (yang baru menimpa yang lama) dan urutkan menurut nomor urut. */
function merge(cur: ChatMessageDto[], incoming: ChatMessageDto[]): ChatMessageDto[] {
  const byId = new Map(cur.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function RefCard({ r, small }: { r: ChatRefCardDto; small?: boolean }) {
  if (!r.accessible) return <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1 text-xs text-muted"><Link2 className="size-3.5" aria-hidden />Penugasan (Anda tidak memiliki akses)</span>;
  const inner = <><Link2 className="size-3.5 shrink-0 text-brand-700" aria-hidden /><span className="min-w-0"><span className="block truncate font-medium text-ink">{r.title}</span>{r.subtitle && <span className="block truncate text-xs text-muted">{r.subtitle}</span>}</span></>;
  const cls = cn("inline-flex max-w-full items-center gap-2 rounded-md border border-line bg-white px-2 py-1 text-left", small ? "text-xs" : "text-sm");
  return r.href ? <Link href={r.href} className={cn(cls, "hover:bg-canvas")}>{inner}</Link> : <span className={cls}>{inner}</span>;
}

export function ChatThread({ room, me, onBack }: { room: ChatRoomDto; me: Me; onBack: () => void }) {
  const toast = useToast();
  const { refresh } = useChat();
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [outbox, setOutbox] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<ChatRefCardDto[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessageDto | null>(null);
  const [editing, setEditing] = useState<ChatMessageDto | null>(null);
  const [mentionMap, setMentionMap] = useState<Record<string, string>>({});
  const [suggest, setSuggest] = useState<ChatDirectoryEntry[]>([]);
  const [refOptions, setRefOptions] = useState<ChatRefCardDto[] | null>(null);
  const [refOpen, setRefOpen] = useState(false);
  const [dialog, setDialog] = useState<{ kind: "report" | "moderate" | "delete"; msg: ChatMessageDto } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const messagesRef = useRef<ChatMessageDto[]>([]);
  const seen = useRef({ lastSeq: 0, rev: -1 });
  const markedSeq = useRef(0);
  const dividerSeq = useRef<number | null>(null);
  messagesRef.current = messages;

  const maxSeq = (ms: ChatMessageDto[]) => ms.reduce((m, x) => Math.max(m, x.seq), 0);
  const base = `/api/chat/rooms/${room.id}/messages`;

  // Ganti ruang → muat pesan terbaru.
  useEffect(() => {
    let off = false;
    setMessages([]); setLoaded(false); setHasMore(false); setOutbox([]); setText(""); setRefs([]); setReplyTo(null); setEditing(null); setMentionMap({});
    markedSeq.current = 0; seen.current = { lastSeq: 0, rev: -1 }; stick.current = true;
    dividerSeq.current = room.unread > 0 ? room.lastSeq - room.unread + 1 : null;
    void api<Page>(base).then((p) => { if (off) return; setMessages(p.items); setHasMore(p.hasMore); setLoaded(true); seen.current = { lastSeq: p.lastSeq, rev: room.rev }; })
      .catch((e) => { if (!off) { toast.error(errorMessage(e)); setLoaded(true); } });
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Bel berbunyi (nomor urut/revisi berubah) → ambil delta; sunting/hapus → segarkan halaman terbaru.
  useEffect(() => {
    if (!loaded) return;
    let off = false;
    void (async () => {
      let known = maxSeq(messagesRef.current);
      let guard = 0;
      while (!off && room.lastSeq > known && guard++ < 10) {
        const p = await api<Page>(`${base}?afterSeq=${known}`);
        if (off) return;
        setMessages((cur) => merge(cur, p.items));
        known = Math.max(known, maxSeq(p.items));
        if (!p.hasMore || !p.items.length) break;
      }
      if (!off && room.rev !== seen.current.rev && room.lastSeq <= seen.current.lastSeq) {
        const p = await api<Page>(base);
        if (!off) setMessages((cur) => merge(cur, p.items));
      }
      seen.current = { lastSeq: room.lastSeq, rev: room.rev };
    })().catch(() => undefined);
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.lastSeq, room.rev, loaded]);

  // Tandai dibaca saat pesan terlihat (tab aktif), lalu segarkan lencana.
  useEffect(() => {
    if (!loaded || room.auditView) return;
    const top = maxSeq(messages);
    if (top === 0 || top <= markedSeq.current || document.visibilityState !== "visible") return;
    const t = setTimeout(() => {
      markedSeq.current = top;
      void api(`/api/chat/rooms/${room.id}/read`, { body: { seq: top } }).then(() => refresh()).catch(() => undefined);
    }, 400);
    return () => clearTimeout(t);
  }, [messages, loaded, room.id, room.auditView, refresh]);

  // Gulir ke bawah bila pembaca berada di dasar atau pesan baru milik sendiri.
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, outbox, loaded]);

  const onScroll = () => { const el = scroller.current; if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  async function loadOlder() {
    const first = messagesRef.current[0]; const el = scroller.current;
    if (!first || !el) return;
    const before = el.scrollHeight;
    try {
      const p = await api<Page>(`${base}?beforeSeq=${first.seq}`);
      setMessages((cur) => merge(cur, p.items)); setHasMore(p.hasMore);
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - before; });
    } catch (e) { toast.error(errorMessage(e)); }
  }

  // Sebutan: "@kata" sebelum kursor → saran dari direktori.
  useEffect(() => {
    const m = /(^|\s)@([^\s@[\]]{0,30})$/.exec(text.slice(0, textRef.current?.selectionStart ?? text.length));
    if (!m) { setSuggest([]); return; }
    let off = false;
    const t = setTimeout(() => { void api<ChatDirectoryEntry[]>(`/api/chat/directory?q=${encodeURIComponent(m[2] ?? "")}`).then((r) => { if (!off) setSuggest(r.slice(0, 6)); }).catch(() => undefined); }, 150);
    return () => { off = true; clearTimeout(t); };
  }, [text]);

  function pickMention(p: ChatDirectoryEntry) {
    const pos = textRef.current?.selectionStart ?? text.length;
    const head = text.slice(0, pos).replace(/@([^\s@[\]]{0,30})$/, `@${p.name} `);
    setText(head + text.slice(pos)); setMentionMap((m) => ({ ...m, [p.name]: p.userId })); setSuggest([]);
    requestAnimationFrame(() => textRef.current?.focus());
  }

  /** "@Nama" yang dipilih dari saran → token `@[Nama](uuid)` yang dipahami server. */
  const withTokens = useCallback((s: string) => Object.keys(mentionMap).sort((a, b) => b.length - a.length).reduce((acc, name) => acc.split(`@${name}`).join(`@[${name}](${mentionMap[name]})`), s), [mentionMap]);

  async function send() {
    const body = text.trim();
    if (!body || !room.canPost) return;
    if (editing) {
      setBusy(true);
      try { const u = await api<ChatMessageDto>(`/api/chat/messages/${editing.id}`, { method: "PATCH", body: { body: withTokens(body) } }); setMessages((cur) => merge(cur, [u])); setEditing(null); setText(""); void refresh(); }
      catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
      return;
    }
    const clientMsgId = crypto.randomUUID();
    const p: Pending = { clientMsgId, body, refs, replyToId: replyTo?.id ?? null, status: "sending" };
    stick.current = true;
    setOutbox((o) => [...o, p]); setText(""); setRefs([]); setReplyTo(null);
    await deliver(p, withTokens(body));
  }

  async function deliver(p: Pending, wire: string) {
    try {
      const dto = await api<ChatMessageDto>(base, { body: { body: wire, clientMsgId: p.clientMsgId, ...(p.replyToId ? { replyToId: p.replyToId } : {}), ...(p.refs.length ? { refs: p.refs.map((r) => ({ type: r.type, id: r.id })) } : {}) } });
      setMessages((cur) => merge(cur, [dto])); setOutbox((o) => o.filter((x) => x.clientMsgId !== p.clientMsgId)); void refresh();
    } catch (e) { setOutbox((o) => o.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, status: "failed", error: errorMessage(e) } : x))); }
  }
  const retry = (p: Pending) => { setOutbox((o) => o.map((x) => (x.clientMsgId === p.clientMsgId ? { ...x, status: "sending", error: undefined } : x))); void deliver(p, withTokens(p.body)); };

  function startEdit(m: ChatMessageDto) {
    const map: Record<string, string> = {};
    const plain = (m.body ?? "").replace(/@\[([^\]\n]{1,80})\]\(([0-9a-fA-F-]{36})\)/g, (_x, name: string, id: string) => { map[name] = id; return `@${name}`; });
    setEditing(m); setReplyTo(null); setText(plain); setMentionMap(map); requestAnimationFrame(() => textRef.current?.focus());
  }

  async function confirmDialog() {
    if (!dialog) return;
    setBusy(true);
    try {
      if (dialog.kind === "delete") await api(`/api/chat/messages/${dialog.msg.id}`, { method: "DELETE" });
      if (dialog.kind === "report") { await api(`/api/chat/messages/${dialog.msg.id}/report`, { body: { reason } }); toast.success("Laporan dikirim ke HR dan Direktur."); }
      if (dialog.kind === "moderate") { await api(`/api/chat/messages/${dialog.msg.id}/moderate`, { body: { reason } }); toast.success("Pesan disembunyikan."); }
      setDialog(null); setReason(""); const p = await api<Page>(base); setMessages((cur) => merge(cur, p.items)); void refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  async function setPrefs(body: { notifyMode?: "ALL" | "MENTIONS" | "NONE"; mutedUntil?: string | null }) {
    try { await api(`/api/chat/rooms/${room.id}/prefs`, { method: "PATCH", body }); await refresh(); toast.success("Preferensi notifikasi disimpan."); } catch (e) { toast.error(errorMessage(e)); }
  }
  const muteFor = (h: number) => setPrefs({ mutedUntil: new Date(Date.now() + h * 3_600_000).toISOString() });
  const muted = !!room.mutedUntil && new Date(room.mutedUntil).getTime() > Date.now();

  async function openRefs() {
    setRefOpen((o) => !o);
    if (refOptions === null) { try { setRefOptions(await api<ChatRefCardDto[]>("/api/chat/refs")); } catch (e) { toast.error(errorMessage(e)); setRefOptions([]); } }
  }

  const rows = useMemo(() => {
    const out: { key: string; node: "day" | "divider" | "msg"; m?: ChatMessageDto; label?: string; head?: boolean }[] = [];
    let lastDay = ""; let prev: ChatMessageDto | null = null;
    for (const m of messages) {
      const d = dayKey(m.createdAt);
      if (d !== lastDay) { out.push({ key: `d-${d}`, node: "day", label: dayOf(m.createdAt) }); lastDay = d; prev = null; }
      if (dividerSeq.current !== null && m.seq === dividerSeq.current && !m.mine) out.push({ key: "divider", node: "divider" });
      const head = !prev || prev.senderId !== m.senderId || new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() > 5 * 60_000;
      out.push({ key: m.id, node: "msg", m, head }); prev = m;
    }
    return out;
  }, [messages]);

  const note = room.auditView ? null : room.kind === "DIRECT"
    ? "Percakapan pribadi. Direktur dapat memeriksa percakapan bila diperlukan; setiap pembukaan tercatat di Audit Log."
    : room.kind === "CHANNEL" ? "Kanal ini dapat dibaca semua karyawan. Jangan menempel data pribadi peserta atau data gaji."
    : "Utas ini hanya dapat dibaca oleh yang terlibat dalam penugasan.";

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={`Percakapan ${room.title}`}>
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <button type="button" onClick={onBack} aria-label="Kembali ke daftar" className="rounded-md p-1.5 text-ink-soft hover:bg-canvas md:hidden"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-ink">{room.kind === "CHANNEL" ? `# ${room.title}` : room.title}</h2>
          <p className="truncate text-xs text-muted">{room.subtitle ?? (room.kind === "DIRECT" ? "Japri" : room.kind === "CHANNEL" ? "Kanal publik" : "Utas penugasan")}{muted && " · dibisukan"}</p>
        </div>
        {room.subject?.href && <Link href={room.subject.href} className="hidden rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-canvas sm:inline-block">Buka penugasan</Link>}
        {!room.auditView && (
          <Menu label="Pengaturan notifikasi" items={[
            { label: "Bisukan 1 jam", onSelect: () => void muteFor(1) }, { label: "Bisukan 8 jam", onSelect: () => void muteFor(8) }, { label: "Bisukan 24 jam", onSelect: () => void muteFor(24) },
            { label: "Aktifkan kembali", hidden: !muted, onSelect: () => void setPrefs({ mutedUntil: null }) }, "sep",
            { label: "Notifikasi: semua pesan", onSelect: () => void setPrefs({ notifyMode: "ALL" }) },
            { label: "Notifikasi: hanya bila disebut", onSelect: () => void setPrefs({ notifyMode: "MENTIONS" }) },
            { label: "Notifikasi: mati", onSelect: () => void setPrefs({ notifyMode: "NONE" }) },
          ]} />
        )}
      </header>
      {room.auditView && <div className="px-3 pt-2"><Notice tone="warn">Anda membuka japri karyawan sebagai Direktur untuk pemeriksaan. Tampilan ini baca-saja dan pembukaannya tercatat di Audit Log.</Notice></div>}
      {room.archived && <div className="px-3 pt-2"><Notice>Ruang ini diarsipkan: dapat dibaca tetapi tidak dapat ditulisi.</Notice></div>}

      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" role="log" aria-live="polite" aria-label="Pesan">
        {note && <p className="mb-3 rounded-md bg-canvas px-3 py-2 text-xs text-muted">{note}</p>}
        {hasMore && <div className="mb-2 text-center"><Button size="sm" onClick={() => void loadOlder()}>Muat pesan lebih lama</Button></div>}
        {!loaded ? <p className="py-8 text-center text-sm text-muted">Memuat percakapan…</p> : messages.length === 0 && outbox.length === 0 ? <p className="py-8 text-center text-sm text-muted">Belum ada pesan. Mulai percakapan di bawah.</p> : null}
        {rows.map((r, ri) => {
          if (r.node === "day") return <div key={r.key} className="my-3 flex items-center gap-3 text-xs text-muted"><hr className="flex-1 border-line" /><span>{r.label}</span><hr className="flex-1 border-line" /></div>;
          if (r.node === "divider") return <div key={r.key} className="my-2 flex items-center gap-3 text-xs font-medium text-brand-700"><hr className="flex-1 border-brand-200" /><span>Belum dibaca</span><hr className="flex-1 border-brand-200" /></div>;
          const m = r.m!;
          const canEdit = canEditMessage({ senderId: m.senderId, createdAt: new Date(m.createdAt), deletedAt: m.deleted ? new Date() : null, purgedAt: m.purged ? new Date() : null, kind: m.kind }, me.userId);
          return (
            <article key={r.key} id={`m-${m.seq}`} className={cn("group flex gap-2.5", r.head ? "mt-3" : "mt-0.5")}>
              <div className="w-8 shrink-0">{r.head && <span className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white" aria-hidden>{initials(m.senderName)}</span>}</div>
              <div className="min-w-0 flex-1">
                {r.head && <p className="text-sm"><span className="font-semibold text-ink">{m.mine ? "Anda" : m.senderName}</span> <span className="text-xs text-muted">{timeOf(m.createdAt)}</span></p>}
                {m.replyTo && <p className="mb-0.5 truncate rounded border-l-2 border-brand-200 bg-canvas px-2 py-0.5 text-xs text-muted">↪ {m.replyTo.senderName}: {m.replyTo.snippet}</p>}
                {m.deleted || m.purged ? (
                  <p className="text-sm italic text-muted">{m.purged ? "Isi pesan telah dibersihkan sesuai masa simpan." : m.hiddenByModerator ? "Pesan disembunyikan oleh moderator." : "Pesan dihapus."}</p>
                ) : (
                  <p className={cn("whitespace-pre-wrap break-words text-sm text-ink", m.mentionedMe && "rounded bg-amber-50 px-1 ring-1 ring-amber-200")}><MessageText body={m.body ?? ""} meId={me.userId} />{m.edited && <span className="ml-1 text-xs text-muted">(diedit)</span>}</p>
                )}
                {m.refs.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{m.refs.map((c) => <RefCard key={`${c.type}${c.id}`} r={c} small />)}</div>}
              </div>
              {!m.deleted && !m.purged && !room.auditView && (
                <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <Menu up={ri >= rows.length - 4} label={`Aksi pesan dari ${m.senderName}`} items={[
                    { label: "Balas", hidden: !room.canPost, onSelect: () => { setReplyTo(m); setEditing(null); textRef.current?.focus(); } },
                    { label: "Sunting", hidden: !canEdit || !room.canPost, onSelect: () => startEdit(m) },
                    { label: "Hapus", hidden: !m.mine, danger: true, onSelect: () => setDialog({ kind: "delete", msg: m }) },
                    { label: "Laporkan", hidden: m.mine || room.kind === "DIRECT", onSelect: () => { setReason(""); setDialog({ kind: "report", msg: m }); } },
                    { label: "Sembunyikan (moderator)", hidden: !(me.canModerate && room.kind === "CHANNEL"), danger: true, onSelect: () => { setReason(""); setDialog({ kind: "moderate", msg: m }); } },
                  ]} />
                </div>
              )}
            </article>
          );
        })}
        {outbox.map((p) => (
          <article key={p.clientMsgId} className="mt-3 flex gap-2.5 opacity-80">
            <div className="w-8 shrink-0"><span className="flex size-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white" aria-hidden>{initials(me.name)}</span></div>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{p.body}</p>
              {p.refs.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{p.refs.map((c) => <RefCard key={c.id} r={c} small />)}</div>}
              {p.status === "sending" ? <p className="text-xs text-muted">Mengirim…</p> : <p className="text-xs text-brand-700" role="alert">Gagal terkirim: {p.error} <button type="button" className="font-medium underline" onClick={() => retry(p)}>Coba lagi</button></p>}
            </div>
          </article>
        ))}
      </div>

      {room.canPost && !room.auditView ? (
        <footer className="border-t border-line p-3">
          {(replyTo || editing) && (
            <div className="mb-2 flex items-center gap-2 rounded-md bg-canvas px-3 py-1.5 text-xs text-ink-soft">
              <span className="min-w-0 flex-1 truncate">{editing ? "Menyunting pesan" : `Membalas ${replyTo!.senderName}: ${(replyTo!.body ?? "").slice(0, 80)}`}</span>
              <button type="button" aria-label="Batalkan" onClick={() => { setReplyTo(null); setEditing(null); if (editing) setText(""); }}><X className="size-4" /></button>
            </div>
          )}
          {refs.length > 0 && <div className="mb-2 flex flex-wrap gap-1.5">{refs.map((r) => <span key={r.id} className="inline-flex items-center gap-1"><RefCard r={r} small /><button type="button" aria-label="Lepas rujukan" onClick={() => setRefs((c) => c.filter((x) => x.id !== r.id))}><X className="size-3.5 text-muted" /></button></span>)}</div>}
          <div className="relative flex items-end gap-2">
            {suggest.length > 0 && (
              <ul role="listbox" aria-label="Sebut karyawan" className="absolute bottom-full left-0 z-20 mb-1 max-h-56 w-72 overflow-auto rounded-md border border-line bg-white py-1 shadow-lg">
                {suggest.map((s) => <li key={s.userId} role="option" aria-selected="false"><button type="button" className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas" onMouseDown={(e) => { e.preventDefault(); pickMention(s); }}>{s.name}<span className="block text-xs text-muted">{[s.position, s.division].filter(Boolean).join(" · ")}</span></button></li>)}
              </ul>
            )}
            {refOpen && (
              <div role="menu" aria-label="Sisipkan penugasan" className="absolute bottom-full left-0 z-20 mb-1 max-h-64 w-80 overflow-auto rounded-md border border-line bg-white py-1 shadow-lg">
                {refOptions === null ? <p className="px-3 py-2 text-sm text-muted">Memuat…</p> : refOptions.length === 0 ? <p className="px-3 py-2 text-sm text-muted">Tidak ada penugasan aktif milik Anda.</p> : refOptions.map((o) => (
                  <button key={`${o.type}${o.id}`} type="button" role="menuitem" disabled={refs.length >= CHAT_LIMITS.maxRefs || refs.some((r) => r.id === o.id)} className="block w-full px-3 py-1.5 text-left text-sm hover:bg-canvas disabled:opacity-50"
                    onClick={() => { setRefs((c) => [...c, o]); setRefOpen(false); }}>{o.title}<span className="block text-xs text-muted">{o.subtitle}</span></button>
                ))}
              </div>
            )}
            <Button size="sm" aria-label="Sisipkan penugasan" aria-expanded={refOpen} onClick={() => void openRefs()} disabled={!!editing}><Paperclip className="size-4" />Penugasan</Button>
            <textarea
              ref={textRef} value={text} rows={1} maxLength={CHAT_LIMITS.maxBody} placeholder={editing ? "Sunting pesan…" : "Tulis pesan… (Enter kirim, Shift+Enter baris baru, @ untuk menyebut)"} aria-label="Tulis pesan"
              onChange={(e) => { setText(e.target.value); e.target.style.height = "auto"; e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`; }}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setSuggest([]); setRefOpen(false); if (editing) { setEditing(null); setText(""); } }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }}
              className="max-h-40 min-h-10 flex-1 resize-none rounded-md border border-line bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-200"
            />
            <Button variant="primary" onClick={() => void send()} loading={busy} disabled={!text.trim()} aria-label={editing ? "Simpan sunting" : "Kirim pesan"}><Send className="size-4" />{editing ? "Simpan" : "Kirim"}</Button>
          </div>
        </footer>
      ) : (
        <footer className="border-t border-line px-3 py-3 text-center text-sm text-muted">{room.auditView ? "Baca-saja (pemeriksaan Direktur)." : room.archived ? "Ruang ini diarsipkan." : "Anda tidak dapat menulis di ruang ini."}</footer>
      )}

      <ConfirmDialog open={dialog?.kind === "delete"} onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()} title="Hapus pesan ini?" description="Pesan akan disembunyikan dari semua peserta." confirmLabel="Hapus" tone="danger" loading={busy} />
      <Dialog open={dialog?.kind === "report" || dialog?.kind === "moderate"} onClose={() => !busy && setDialog(null)} size="sm" title={dialog?.kind === "moderate" ? "Sembunyikan pesan" : "Laporkan pesan"}
        description={dialog?.kind === "moderate" ? "Pesan disembunyikan dari semua pembaca. Pelaku dan alasan tercatat di Audit Log." : "HR dan Direktur akan menerima laporan ini."}
        footer={<><Button onClick={() => setDialog(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={dialog?.kind === "moderate" && reason.trim().length < 3} onClick={() => void confirmDialog()}>{dialog?.kind === "moderate" ? "Sembunyikan" : "Kirim laporan"}</Button></>}>
        <TextAreaField label={dialog?.kind === "moderate" ? "Alasan (wajib)" : "Alasan (opsional)"} rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </section>
  );
}

