"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { FolderKanban, LayoutGrid, Search } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { NAV_GROUP_LABEL, type NavItem } from "@/lib/permissions";

interface ProjectHit { id: string; code: string; name: string; status: string }
interface Hit { key: string; href: string; title: string; hint: string; kind: "menu" | "project" }

/**
 * Pencarian cepat (Ctrl+K): menu yang boleh dibuka pengguna + proyek pelatihan dalam lingkup aksesnya. Pencarian proyek memanggil
 * API yang sama dengan daftar proyek, sehingga izin ditegakkan server (tidak ada proyek di luar lingkup yang muncul).
 */
export function CommandPalette({ open, onClose, nav, canSearchProjects }: { open: boolean; onClose: () => void; nav: Pick<NavItem, "href" | "label" | "group">[]; canSearchProjects: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [projects, setProjects] = useState<ProjectHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  const menu = useMemo(() => {
    const t = q.trim().toLowerCase();
    return nav.filter((n) => !t || n.label.toLowerCase().includes(t)).slice(0, t ? 8 : 6);
  }, [q, nav]);

  const hits: Hit[] = [
    ...menu.map((n): Hit => ({ key: `m:${n.href}`, href: n.href, title: n.label, hint: NAV_GROUP_LABEL[n.group] || "Menu", kind: "menu" })),
    ...projects.map((p): Hit => ({ key: `p:${p.id}`, href: `/training/proyek/${p.id}`, title: `${p.code} · ${p.name}`, hint: "Proyek pelatihan", kind: "project" })),
  ];

  function onChange(value: string) {
    setQ(value); setActive(0);
    if (timer.current) clearTimeout(timer.current);
    if (!canSearchProjects || value.trim().length < 2) { seq.current++; setProjects([]); setLoading(false); return; }
    const mine = ++seq.current;
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await api<{ items: ProjectHit[] }>(`/api/training/projects?q=${encodeURIComponent(value.trim())}&pageSize=5`);
        if (mine === seq.current) setProjects(res.items);
      } catch { if (mine === seq.current) setProjects([]); } finally { if (mine === seq.current) setLoading(false); }
    }, 250);
  }
  function go(h: Hit | undefined) { if (!h) return; onClose(); router.push(h.href); }
  function close() { onClose(); setQ(""); setProjects([]); setActive(0); seq.current++; }

  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Pencarian cepat">
      <button type="button" aria-label="Tutup pencarian" className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-5 shrink-0 text-muted" aria-hidden />
          <input
            ref={input} value={q} onChange={(e) => onChange(e.target.value)} placeholder="Cari program, proyek, atau menu…" aria-label="Cari" role="combobox" aria-expanded="true" aria-controls="palette-list"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0))); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); go(hits[active]); }
              else if (e.key === "Escape") { e.preventDefault(); close(); }
            }}
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" style={{ outline: "none" }}
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-muted sm:block">Esc</kbd>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Hasil pencarian" className="max-h-80 overflow-y-auto py-1">
          {hits.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === active}>
              <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm", i === active ? "bg-brand-50 text-brand-800" : "text-ink-soft")}>
                {h.kind === "project" ? <FolderKanban className="size-4 shrink-0 text-muted" aria-hidden /> : <LayoutGrid className="size-4 shrink-0 text-muted" aria-hidden />}
                <span className="min-w-0 flex-1 truncate font-medium">{h.title}</span>
                <span className="shrink-0 text-xs text-muted">{h.hint}</span>
              </button>
            </li>
          ))}
          {hits.length === 0 && !loading && <li className="px-4 py-6 text-center text-sm text-muted">Tidak ada hasil untuk “{q}”.</li>}
          {loading && <li className="px-4 py-2 text-xs text-muted">Mencari proyek…</li>}
        </ul>
        <p className="border-t border-line bg-canvas px-4 py-2 text-[11px] text-muted">↑ ↓ memilih · Enter membuka · Esc menutup</p>
      </div>
    </div>
  );
}
