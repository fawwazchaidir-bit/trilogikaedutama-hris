import { requirePageUser } from "@/server/auth/current";
import { getBrand } from "@/server/services/settings";
import { unreadCount } from "@/server/services/notifications";
import { pendingLeaveCount } from "@/server/services/leave";
import { pendingOvertimeCount } from "@/server/services/overtime";
import { openLocationReviewCount } from "@/server/services/location";
import { documentAttentionCount } from "@/server/services/documents";
import { pendingAllowanceCount } from "@/server/services/assignments";
import { can } from "@/lib/permissions";
import { loadNav } from "@/server/nav";
import { AppShell } from "@/components/app-shell";
import { cookies } from "next/headers";
import { NAV_PREF_COOKIE, parseNavPref } from "@/lib/nav-pref";
import { teamPendingCount } from "@/server/services/org";
import { openChecklistCount } from "@/server/services/employee-checklists";
import { chatEnabled } from "@/server/env";
import { chatUnreadTotal } from "@/server/services/chat/rooms";
import { ChatProvider } from "@/components/chat/chat-provider";
import { countMyOverdueTasks } from "@/server/services/training/work";
import pkg from "../../../package.json";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser({ allowSetup: true });
  const [brand, unread] = await Promise.all([getBrand(), unreadCount(user)]);
  // Preferensi sidebar (disembunyikan / grup dilipat) dari cookie; nilai divalidasi ulang oleh parseNavPref.
  const navPref = parseNavPref((await cookies()).get(NAV_PREF_COOKIE)?.value);
  const { nav, trainingVisible, teamIds, myChecklist } = await loadNav(user);
  // Training & Operations: hanya bila modul diaktifkan DAN pengguna punya akses (level / Super Admin / anggota proyek).
  const overdueTasks = trainingVisible ? await countMyOverdueTasks(user) : 0;
  const [pending, pendingOt, openLoc, docAttention, pendingAllowance] = await Promise.all([
    can(user.role, "leave:review") ? pendingLeaveCount() : Promise.resolve(0),
    can(user.role, "overtime:review") ? pendingOvertimeCount() : Promise.resolve(0),
    can(user.role, "location:review") ? openLocationReviewCount() : Promise.resolve(0),
    can(user.role, "document:view_all") ? documentAttentionCount(user) : Promise.resolve(0),
    can(user.role, "assignment:manage") ? pendingAllowanceCount() : Promise.resolve(0),
  ]);
  const teamPending = teamIds.length ? await teamPendingCount(user, teamIds) : 0;
  const openLifecycle = can(user.role, "employee:view") ? await openChecklistCount() : 0;
  const chatOn = chatEnabled();
  const chatUnread = chatOn ? await chatUnreadTotal(user) : 0;
  return (
    <ChatProvider enabled={chatOn} initialUnread={chatUnread}>
    <AppShell
      initialNav={navPref} hasEmployee={!!user.employeeId} canSearchProjects={trainingVisible} version={pkg.version}
      user={{ name: user.name, email: user.email, role: user.role, isDemo: user.isDemo }}
      nav={nav} company={brand} unread={unread} pendingBadges={[{ href: "/pengajuan", count: pending }, { href: "/lembur", count: pendingOt }, { href: "/lokasi", count: openLoc }, { href: "/dokumen", count: docAttention }, { href: "/surat-tugas", count: pendingAllowance }, { href: "/training/tugas-saya", count: overdueTasks }, { href: "/persetujuan-tim", count: teamPending }, { href: "/masuk-berhenti", count: openLifecycle }, { href: "/checklist-saya", count: myChecklist }]}
    >
      {children}
    </AppShell>
    </ChatProvider>
  );
}
