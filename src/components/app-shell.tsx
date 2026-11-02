"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bell, CalendarDays, CircleUserRound, ClipboardCheck, ClipboardList, FileText, KeyRound, LayoutDashboard, LogOut, Menu,
  ScrollText, Settings, ShieldCheck, TableProperties, Users, UserCog, Wallet, X, Clock, FilePlus2, Timer, BarChart3, ShieldEllipsis, MapPinned, FolderOpen, Plane,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api-client";
import { NAV_GROUP_LABEL, ROLE_LABELS, type NavItem, type Role } from "@/lib/permissions";
import { ToastProvider } from "@/components/ui/toast";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "/dashboard": LayoutDashboard,
  "/absensi-saya": Clock,
  "/pengajuan-saya": FilePlus2,
  "/slip-saya": FileText,
  "/lembur-saya": Timer,
  "/lembur": Timer,
  "/dokumen": FolderOpen,
  "/dokumen-saya": FolderOpen,
  "/surat-tugas": Plane,
  "/surat-tugas-saya": Plane,
  "/lokasi": MapPinned,
  "/laporan": BarChart3,
  "/akun": ShieldEllipsis,
  "/profil": CircleUserRound,
  "/karyawan": Users,
  "/jadwal": CalendarDays,
  "/absensi": ClipboardCheck,
  "/pengajuan": ClipboardList,
  "/rekap": TableProperties,
  "/penggajian": Wallet,
  "/audit-log": ScrollText,
  "/pengaturan": Settings,
  "/pengguna": UserCog,
};

export interface ShellProps {
  user: { name: string; email: string; role: Role; isDemo: boolean };
  nav: Pick<NavItem, "href" | "label" | "group">[];
  company: { name: string; logoUrl: string };
  unread: number;
  pendingBadges: { href: string; count: number }[];
  children: React.ReactNode;
}

export function AppShell({ user, nav, company, unread, pendingBadges, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } finally { router.push("/login"); router.refresh(); }
  }

  const groups = (["umum", "saya", "sdm", "gaji", "sistem"] as const)
    .map((g) => ({ g, items: nav.filter((n) => n.group === g) }))
    .filter((x) => x.items.length > 0);

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-stone-200">
      <div className="flex items-center gap-3 px-5 py-5">
        <Image src={company.logoUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded-full bg-white/5 object-contain" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight text-white">{company.name}</p>
          <p className="text-[11px] leading-snug text-stone-400">Internal Human Resources Information System</p>
        </div>
      </div>
      <nav aria-label="Menu utama" className="flex-1 space-y-4 overflow-y-auto px-3 py-2">
        {groups.map(({ g, items }) => (
          <div key={g}>
            {NAV_GROUP_LABEL[g] && <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-stone-500">{NAV_GROUP_LABEL[g]}</p>}
            <div className="space-y-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.href] ?? FileText;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const badge = pendingBadges.find((b) => b.href === item.href && b.count > 0)?.count ?? 0;
                return (
                  <Link
                    key={item.href} href={item.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                    className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors", active ? "bg-brand-600 text-white" : "text-stone-300 hover:bg-white/10 hover:text-white")}
                  >
                    <Icon className="size-[18px] shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {badge > 0 && <span className="rounded-full bg-white px-1.5 text-[11px] font-semibold text-brand-700" aria-label={`${badge} menunggu`}>{badge}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <p className="truncate text-sm font-medium text-white">{user.name}</p>
        <p className="truncate text-xs text-stone-400">{user.email}</p>
        <p className="mt-1 inline-block rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-medium text-stone-300">{ROLE_LABELS[user.role]}</p>
        <div className="mt-3 flex gap-2">
          <Link href="/change-password" className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-white/10 px-2 py-1.5 text-xs text-stone-200 hover:bg-white/20">
            <KeyRound className="size-3.5" /> Password
          </Link>
          <button type="button" onClick={logout} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-white/10 px-2 py-1.5 text-xs text-stone-200 hover:bg-white/20 disabled:opacity-50">
            <LogOut className="size-3.5" /> Keluar
          </button>
        </div>
      </div>
    </div>
  );

  const bell = (
    <Link href="/notifikasi" aria-label={unread ? `Notifikasi, ${unread} belum dibaca` : "Notifikasi"} className="relative rounded-md p-1.5 hover:bg-white/10 lg:hover:bg-black/5">
      <Bell className="size-5" />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );

  return (
    <ToastProvider>
      <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="no-print sticky top-0 hidden h-screen lg:block">{sidebar}</aside>

        <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-ink px-4 py-3 text-white lg:hidden">
          <button type="button" aria-label="Buka menu" onClick={() => setOpen(true)} className="rounded-md p-1.5 hover:bg-white/10"><Menu className="size-5" /></button>
          <span className="text-sm font-semibold">{company.name}</span>
          {bell}
        </div>
        {open && (
          <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button type="button" aria-label="Tutup menu" className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
            <div className="relative h-full w-72 max-w-[85%] shadow-2xl">
              <button type="button" aria-label="Tutup" onClick={() => setOpen(false)} className="absolute right-2 top-2 z-10 rounded-md p-1.5 text-white hover:bg-white/10"><X className="size-5" /></button>
              {sidebar}
            </div>
          </div>
        )}

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {user.isDemo && (
            <div role="note" className="no-print mb-5 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" />
              <p><strong>Akun demonstrasi — hanya untuk pengujian.</strong> Data di sini fiktif dan tidak boleh dipakai untuk operasional.</p>
            </div>
          )}
          <div className="no-print mb-4 hidden justify-end lg:flex">{bell}</div>
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}

