import "server-only";
import type { Actor } from "./actor";
import { chatEnabled, lettersEnabled, trainingEnabled } from "./env";
import { visibleNav, type NavItem, type Role } from "@/lib/permissions";
import { trainingNav } from "@/lib/training/nav";
import { getModuleContext } from "./services/training/access";
import { reviewableMap } from "./services/org";
import { myChecklistCount } from "./services/employee-checklists";

/** Menu yang boleh dilihat pengguna (HRIS + Training & Operations bila modul menyala dan pengguna punya akses). Satu sumber untuk rangka halaman & beranda. */
export async function loadNav(user: Actor & { role: Role }): Promise<{ nav: Pick<NavItem, "href" | "label" | "group">[]; trainingVisible: boolean; teamIds: string[]; myChecklist: number }> {
  let nav = visibleNav(user.role, !!user.employeeId).map(({ href, label, group }) => ({ href, label, group }));
  let trainingVisible = false;
  // "Persetujuan Tim": hanya bagi yang saat ini menjadi atasan langsung / pengganti / eskalasi bagi seseorang.
  const teamIds = user.employeeId ? [...(await reviewableMap(user)).keys()] : [];
  const myChecklist = await myChecklistCount(user.userId);
  if (myChecklist > 0) nav = [...nav, { href: "/checklist-saya", label: "Checklist Saya", group: "saya" as const }];
  if (teamIds.length) {
    const at = nav.findIndex((i) => i.href === "/lembur-saya");
    nav = [...nav.slice(0, at + 1), { href: "/persetujuan-tim", label: "Persetujuan Tim", group: "saya" as const }, ...nav.slice(at + 1)];
  }
  if (lettersEnabled()) nav = [...nav, { href: "/persuratan", label: "Persuratan", group: "saya" as const }];
  if (chatEnabled()) nav = [...nav, { href: "/obrolan", label: "Obrolan", group: "saya" as const }];
  if (trainingEnabled()) {
    const tmod = await getModuleContext(user);
    if (tmod.canSee) {
      trainingVisible = true;
      nav = [...nav, ...trainingNav(tmod.caps, !!user.employeeId)];
      // Pemegang level modul (Manajer/Admin Program/Pemantau) melihat ketersediaan tim agar tahu siapa sudah punya penugasan; HR sudah punya menunya.
      if (tmod.caps.hasModule && !nav.some((i) => i.href === "/ketersediaan")) nav.push({ href: "/ketersediaan", label: "Ketersediaan Tim", group: "training" as const });
    }
  }
  return { nav, trainingVisible, teamIds, myChecklist };
}
