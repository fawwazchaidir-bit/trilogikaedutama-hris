/**
 * Menu Training & Operations. Terpisah dari NAV_ITEMS HRIS agar menu HRIS tidak berubah. Tampil hanya bila modul aktif
 * (TRAINING_MODULE_ENABLED) dan pengguna punya akses modul (level, Super Admin, atau anggota proyek) — lihat layout.
 * Menyembunyikan menu hanya kosmetik: setiap halaman & service tetap memeriksa akses di server.
 */
import type { NavItem } from "@/lib/permissions";
import type { GlobalCaps } from "./access";

type TrainingNavItem = Pick<NavItem, "href" | "label" | "group"> & { needsEmployee?: boolean; needsManageAccess?: boolean };

export const TRAINING_NAV_ITEMS: readonly TrainingNavItem[] = [
  { href: "/training", label: "Dashboard Training", group: "training" },
  { href: "/training/program", label: "Program Pelatihan", group: "training" },
  { href: "/training/proyek", label: "Proyek Pelatihan", group: "training" },
  { href: "/training/tugas-saya", label: "Tugas Saya", group: "training", needsEmployee: true },
  { href: "/training/checklist", label: "Checklist", group: "training" },
  { href: "/training/kalender", label: "Kalender Kegiatan", group: "training" },
  { href: "/training/peserta", label: "Peserta", group: "training" },
  { href: "/training/instruktur", label: "Instruktur / Asesor", group: "training" },
  { href: "/training/dokumen", label: "Dokumen Proyek", group: "training" },
  { href: "/training/laporan", label: "Laporan Proyek", group: "training" },
  { href: "/training/akses", label: "Akses Training", group: "training", needsManageAccess: true },
];

export function trainingNav(caps: GlobalCaps, hasEmployee: boolean): Pick<NavItem, "href" | "label" | "group">[] {
  return TRAINING_NAV_ITEMS
    .filter((i) => (!i.needsEmployee || hasEmployee) && (!i.needsManageAccess || caps.manageAccess))
    .map(({ href, label, group }) => ({ href, label, group }));
}
