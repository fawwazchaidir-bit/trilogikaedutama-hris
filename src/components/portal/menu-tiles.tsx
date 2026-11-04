import Link from "next/link";
import {
  BarChart3, CalendarRange, ClipboardCheck, ClipboardList, Clock, FileStack, FileText, FilePlus2, FolderKanban, FolderOpen, Gauge, ListChecks, Plane, TableProperties, Timer, Users, UsersRound, Wallet, FileBarChart2, type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/permissions";

const META: Record<string, { icon: LucideIcon; desc: string }> = {
  "/absensi-saya": { icon: Clock, desc: "Check-in & rekap" }, "/pengajuan-saya": { icon: FilePlus2, desc: "Izin, sakit, cuti" }, "/slip-saya": { icon: FileText, desc: "Slip gaji" },
  "/lembur-saya": { icon: Timer, desc: "Pengajuan lembur" }, "/surat-tugas-saya": { icon: Plane, desc: "Penugasan" }, "/dokumen-saya": { icon: FolderOpen, desc: "Dokumen kerja" },
  "/karyawan": { icon: Users, desc: "Data karyawan" }, "/absensi": { icon: ClipboardCheck, desc: "Kehadiran" }, "/pengajuan": { icon: ClipboardList, desc: "Persetujuan" },
  "/rekap": { icon: TableProperties, desc: "Rekap bulanan" }, "/penggajian": { icon: Wallet, desc: "Gaji & slip" }, "/surat-tugas": { icon: Plane, desc: "Surat tugas" }, "/laporan": { icon: BarChart3, desc: "Laporan" },
  "/training/proyek": { icon: FolderKanban, desc: "Proyek pelatihan" }, "/training/tugas-saya": { icon: ListChecks, desc: "Tugas saya" }, "/training/kalender": { icon: CalendarRange, desc: "Jadwal pelatihan" },
  "/training/peserta": { icon: UsersRound, desc: "Peserta" }, "/training/dokumen": { icon: FileStack, desc: "Dokumen proyek" }, "/training/laporan": { icon: FileBarChart2, desc: "Laporan proyek" },
  "/training/pemantauan": { icon: Gauge, desc: "Status program" },
};

/** Tile menu utama: hanya butir yang BOLEH dibuka pengguna (diambil dari daftar menu yang sudah disaring izin), urut menurut `order`. */
export function MenuTiles({ nav, order, max = 6, wide = false }: { nav: Pick<NavItem, "href" | "label">[]; order: string[]; max?: number; wide?: boolean }) {
  const items = order.flatMap((h) => { const n = nav.find((x) => x.href === h); return n && META[h] ? [{ ...n, ...META[h]! }] : []; }).slice(0, max);
  if (items.length === 0) return null;
  return (
    <div className={wide ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" : "grid grid-cols-2 gap-3"}>
      {items.map(({ href, label, icon: Icon, desc }) => (
        <Link key={href} href={href} className="group flex flex-col items-center gap-2 rounded-xl border border-line bg-brand-50/40 px-2 py-4 text-center transition-colors hover:border-brand-200 hover:bg-brand-50">
          <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-white text-brand-600 shadow-sm"><Icon className="size-6" /></span>
          <span className="text-[13px] font-semibold leading-tight text-ink">{label}</span>
          <span className="text-[11px] leading-tight text-muted">{desc}</span>
        </Link>
      ))}
    </div>
  );
}
