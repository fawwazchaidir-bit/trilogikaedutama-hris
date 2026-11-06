import "server-only";
import type { Actor } from "./actor";
import { trainingEnabled } from "./env";
import { visibleNav, type NavItem, type Role } from "@/lib/permissions";
import { trainingNav } from "@/lib/training/nav";
import { getModuleContext } from "./services/training/access";
import { reviewableMap } from "./services/org";

/** Menu yang boleh dilihat pengguna (HRIS + Training & Operations bila modul menyala dan pengguna punya akses). Satu sumber untuk rangka halaman & beranda. */
export async function loadNav(user: Actor & { role: Role }): Promise<{ nav: Pick<NavItem, "href" | "label" | "group">[]; trainingVisible: boolean; teamIds: string[] }> {
  let nav = visibleNav(user.role, !!user.employeeId).map(({ href, label, group }) => ({ href, label, group }));
  let trainingVisible = false;
  // "Persetujuan Tim": hanya bagi yang saat ini menjadi atasan langsung / pengganti / eskalasi bagi seseorang.
  const teamIds = user.employeeId ? [...(await reviewableMap(user)).keys()] : [];
  if (teamIds.length) {
    const at = nav.findIndex((i) => i.href === "/lembur-saya");
    nav = [...nav.slice(0, at + 1), { href: "/persetujuan-tim", label: "Persetujuan Tim", group: "saya" as const }, ...nav.slice(at + 1)];
  }
  if (trainingEnabled()) {
    const tmod = await getModuleContext(user);
    if (tmod.canSee) { trainingVisible = true; nav = [...nav, ...trainingNav(tmod.caps, !!user.employeeId)]; }
  }
  return { nav, trainingVisible, teamIds };
}
