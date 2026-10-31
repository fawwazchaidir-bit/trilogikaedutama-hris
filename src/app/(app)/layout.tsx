import { requirePageUser } from "@/server/auth/current";
import { getBrand } from "@/server/services/settings";
import { unreadCount } from "@/server/services/notifications";
import { pendingLeaveCount } from "@/server/services/leave";
import { pendingOvertimeCount } from "@/server/services/overtime";
import { can, visibleNav } from "@/lib/permissions";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser({ allowSetup: true });
  const [brand, unread] = await Promise.all([getBrand(), unreadCount(user)]);
  const nav = visibleNav(user.role, !!user.employeeId).map(({ href, label, group }) => ({ href, label, group }));
  const [pending, pendingOt] = await Promise.all([
    can(user.role, "leave:review") ? pendingLeaveCount() : Promise.resolve(0),
    can(user.role, "overtime:review") ? pendingOvertimeCount() : Promise.resolve(0),
  ]);
  return (
    <AppShell
      user={{ name: user.name, email: user.email, role: user.role, isDemo: user.isDemo }}
      nav={nav} company={brand} unread={unread} pendingBadges={[{ href: "/pengajuan", count: pending }, { href: "/lembur", count: pendingOt }]}
    >
      {children}
    </AppShell>
  );
}
