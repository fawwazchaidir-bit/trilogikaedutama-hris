"use client";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bell, CalendarDays, CircleUserRound, ClipboardCheck, ClipboardList, FileText, KeyRound, LayoutDashboard, LogOut, Menu,
  ScrollText, Settings, ShieldCheck, TableProperties, Users, UserCog, Wallet, X, Clock, FilePlus2, Timer, BarChart3, ShieldEllipsis, MapPinned, FolderOpen, Plane, GraduationCap, FolderKanban, ListChecks, CalendarRange, UsersRound, Presentation, FileStack, FileBarChart2, ChevronDown, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api-client";
import { NAV_GROUP_LABEL, ROLE_LABELS, type NavItem, type Role } from "@/lib/permissions";
import { ToastProvider } from "@/components/ui/toast";
import { DEFAULT_NAV_PREF, NAV_GROUP_IDS, writeNavPrefCookie, type NavGroupId, type NavPref } from "@/lib/nav-pref";

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
  "/training": LayoutDashboard,
  "/training/program": GraduationCap,
  "/training/proyek": FolderKanban,
  "/training/tugas-saya": ListChecks,
  "/training/checklist": ClipboardCheck,
  "/training/kalender": CalendarRange,
  "/training/peserta": UsersRound,
  "/training/instruktur": Presentation,
  "/training/dokumen": FileStack,
  "/training/laporan": FileBarChart2,
  "/training/akses": ShieldCheck,
};

export interface ShellProps {
  user: { name: string; email: string; role: Role; isDemo: boolean };
  nav: Pick<NavItem, "href" | "label" | "group">[];
  company: { name: string; logoUrl: string };
  unread: number;
  pendingBadges: { href: string; count: number }[];
  /** Preferensi sidebar dari cookie (dibaca server → tanpa kedip). Bawaan: terbuka. */
  initialNav?: NavPref;
  children: React.ReactNode;
}

export function AppShell({ user, nav, company, unread, pendingBadges, initialNav = DEFAULT_NAV_PREF, children }: ShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Sidebar desktop disembunyikan? & grup menu mana yang dilipat? (bawaan: semuanya terbuka). Disimpan di cookie.
  const [collapsed, setCollapsed] = useState(initialNav.collapsed);
  const [closed, setClosed] = useState<NavGroupId[]>(initialNav.closedGroups);

  const persist = (c: boolean, g: NavGroupId[]) => writeNavPrefCookie({ collapsed: c, closedGroups: g });
  // Halaman tempat pengguna sengaja melipat sebuah grup (tidak disimpan): di halaman lain dalam grup itu, grup terbuka lagi agar butir aktif terlihat.
  const [pinnedAt, setPinnedAt] = useState<Partial<Record<NavGroupId, string>>>({});
  const toggleSidebar = () => { const c = !collapsed; setCollapsed(c); persist(c, closed); };

  async function logout() {
    setBusy(true);
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } finally { router.push("/login"); router.refresh(); }
  }

  const groups = NAV_GROUP_IDS
    .map((g) => ({ g, items: nav.filter((n) => n.group === g) }))
    .filter((x) => x.items.length > 0);
  const isActive = (href: string) => pathname === href || (href !== "/training" && pathname.startsWith(`${href}/`));

  const groupOpen = (g: NavGroupId, items: { href: string }[]) =>
    !NAV_GROUP_LABEL[g] || !closed.includes(g) || (items.some((i) => isActive(i.href)) && pinnedAt[g] !== pathname);
  function toggleGroup(g: NavGroupId, items: { href: string }[]) {
    if (groupOpen(g, items)) {
      const next = [...new Set([...closed, g])];
      setClosed(next); setPinnedAt({ ...pinnedAt, [g]: pathname }); persist(collapsed, next);
    } else {
      const next = closed.filter((x) => x !== g);
      setClosed(next); persist(collapsed, next);
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-ink text-stone-200">
      <div className="flex items-center gap-3 px-5 py-5">
        <Image src={company.logoUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded-full bg-white/5 object-contain" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight text-white">{company.name}</p>
          <p className="text-[11px] leading-snug text-stone-400">Trilogika Internal Portal</p>
        </div>
        <button type="button" onClick={toggleSidebar} aria-label="Sembunyikan menu samping" title="Sembunyikan menu samping" className="hidden size-8 shrink-0 place-items-center rounded-md text-stone-400 hover:bg-white/10 hover:text-white lg:grid">
          <PanelLeftClose className="size-[18px]" aria-hidden />
        </button>
      </div>
      <nav aria-label="Menu utama" className="nav-scroll flex-1 space-y-3 px-3 pb-6 pt-4">
        {groups.map(({ g, items }) => {
          const label = NAV_GROUP_LABEL[g];
          const open = groupOpen(g, items);
          return (
          <div key={g}>
            {label && (
              <button
                type="button" onClick={() => toggleGroup(g, items)} aria-expanded={open} aria-controls={`nav-group-${g}`}
                className="mb-1 flex w-full items-center justify-between rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-500 transition-colors hover:text-stone-300"
              >
                <span>{label}</span>
                <ChevronDown className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
              </button>
            )}
            <div id={`nav-group-${g}`} inert={!open} className={cn("grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
            <div className={cn("min-h-0 space-y-0.5 overflow-hidden transition-[visibility] duration-0 motion-reduce:transition-none", open ? "visible" : "invisible delay-200")}>
              {items.map((item) => {
                const Icon = ICONS[item.href] ?? FileText;
                // "/training" (Dashboard Training) hanya aktif pada halamannya sendiri, bukan pada seluruh anak rutenya.
                const active = isActive(item.href);
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
          </div>
          );
        })}
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
      <div className={cn("min-h-screen lg:grid lg:transition-[grid-template-columns] lg:duration-200 motion-reduce:lg:transition-none", collapsed ? "lg:grid-cols-[0rem_1fr]" : "lg:grid-cols-[16rem_1fr]")}>
        <aside aria-hidden={collapsed || undefined} inert={collapsed} className="no-print sticky top-0 hidden h-screen overflow-hidden lg:block">{sidebar}</aside>

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
          <div className="no-print mb-4 hidden items-center justify-between lg:flex">
            {collapsed ? (
              <button type="button" onClick={toggleSidebar} aria-label="Tampilkan menu samping" title="Tampilkan menu samping" className="grid size-9 place-items-center rounded-md border border-line bg-white text-ink-soft shadow-sm hover:bg-canvas">
                <PanelLeftOpen className="size-[18px]" aria-hidden />
              </button>
            ) : <span />}
            {bell}
          </div>
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}

