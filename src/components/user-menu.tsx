"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleUserRound, KeyRound, LogOut, ShieldEllipsis } from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
};

/** Menu pengguna di pojok kanan atas: nama + peran, profil, keamanan, ganti password, keluar. */
export function UserMenu({ user, hasEmployee, tone = "light" }: { user: { name: string; email: string; role: Role }; hasEmployee: boolean; tone?: "light" | "dark" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);

  async function logout() {
    setBusy(true);
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } finally { router.push("/login"); router.refresh(); }
  }
  const item = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-ink-soft hover:bg-canvas";

  return (
    <div ref={box} className="relative">
      <button
        type="button" aria-label="Menu pengguna" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={cn("flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 transition-colors", tone === "dark" ? "text-white hover:bg-white/10" : "hover:bg-black/5")}
      >
        <span aria-hidden className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white ring-2 ring-white/70">{initialsOf(user.name)}</span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-semibold leading-tight">{user.name}</span>
          <span className={cn("block max-w-40 truncate text-[11px] leading-tight", tone === "dark" ? "text-white/70" : "text-muted")}>{ROLE_LABELS[user.role]}</span>
        </span>
        <ChevronDown className={cn("hidden size-4 transition-transform sm:block", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Menu pengguna" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-white py-1 text-ink shadow-xl">
          <div className="border-b border-line px-3 py-2.5">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-1 inline-block rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{ROLE_LABELS[user.role]}</p>
          </div>
          {hasEmployee && <Link role="menuitem" href="/profil" onClick={() => setOpen(false)} className={item}><CircleUserRound className="size-4 text-muted" />Profil & Jadwal</Link>}
          <Link role="menuitem" href="/akun" onClick={() => setOpen(false)} className={item}><ShieldEllipsis className="size-4 text-muted" />Keamanan & Notifikasi</Link>
          <Link role="menuitem" href="/change-password" onClick={() => setOpen(false)} className={item}><KeyRound className="size-4 text-muted" />Ganti password</Link>
          <button type="button" role="menuitem" onClick={logout} disabled={busy} className={cn(item, "border-t border-line text-brand-700 disabled:opacity-50")}><LogOut className="size-4" />Keluar</button>
        </div>
      )}
    </div>
  );
}
