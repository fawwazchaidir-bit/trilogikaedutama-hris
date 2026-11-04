import "server-only";
import type { Actor } from "./actor";
import { trainingEnabled } from "./env";
import { visibleNav, type NavItem, type Role } from "@/lib/permissions";
import { trainingNav } from "@/lib/training/nav";
import { getModuleContext } from "./services/training/access";

/** Menu yang boleh dilihat pengguna (HRIS + Training & Operations bila modul menyala dan pengguna punya akses). Satu sumber untuk rangka halaman & beranda. */
export async function loadNav(user: Actor & { role: Role }): Promise<{ nav: Pick<NavItem, "href" | "label" | "group">[]; trainingVisible: boolean }> {
  let nav = visibleNav(user.role, !!user.employeeId).map(({ href, label, group }) => ({ href, label, group }));
  let trainingVisible = false;
  if (trainingEnabled()) {
    const tmod = await getModuleContext(user);
    if (tmod.canSee) { trainingVisible = true; nav = [...nav, ...trainingNav(tmod.caps, !!user.employeeId)]; }
  }
  return { nav, trainingVisible };
}
