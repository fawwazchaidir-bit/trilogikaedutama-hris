import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, UserRound } from "lucide-react";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { AppError } from "@/server/errors";
import { getEmployee, listDivisions, listEmployeeOptions } from "@/server/services/employees";
import { getOrgProfile, listOrgHistory } from "@/server/services/org";
import { listEmployeeChecklists } from "@/server/services/employee-checklists";
import { listAssignableUsers } from "@/server/services/employee-checklist-templates";
import { listEmployeeAssets } from "@/server/services/assets";
import { settlementOfEmployee } from "@/server/services/final-settlements";
import { getEmployeeHandover } from "@/server/services/training/handover";
import { listComponents } from "@/server/services/components";
import { getBalance, getLedger, getLeavePolicy } from "@/server/services/leave";
import { listCorrections } from "@/server/services/attendance";
import { env } from "@/server/env";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmployeeActions } from "@/components/employee-forms";
import { ComponentsManager } from "@/components/components-manager";
import { BalanceCard } from "@/components/balance-card";
import { OrgCard } from "@/components/org-card";
import { EmployeeChecklistCard } from "@/components/employee-checklist-card";
import { EmployeeAssetsCard } from "@/components/employee-assets-card";
import { EmployeeHandoverCard } from "@/components/employee-handover-card";
import { EmployeeSettlementCard } from "@/components/employee-settlement-card";
import { LeavePolicyCard } from "@/components/leave-policy-card";
import { formatClock, formatDateLong, formatDateTime } from "@/lib/format";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import { todayIso } from "@/lib/time";
import { z } from "zod";

export const metadata: Metadata = { title: "Detail Karyawan" };
export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("employee:view");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let e;
  try { e = await getEmployee(user, id); } catch (err) { if (err instanceof AppError) notFound(); throw err; }
  const today = todayIso(env().APP_TIMEZONE);
  const year = Number(today.slice(0, 4));
  const [divisions, comps, balance, ledger, leavePolicy, corrections, org, orgHistory, people, checklists, assignable, assets, settlement, handover] = await Promise.all([
    listDivisions(user),
    actorCan(user, "payroll:components") ? listComponents(user, id) : Promise.resolve(null),
    actorCan(user, "leave:view_all") ? getBalance(user, id, year) : Promise.resolve(null),
    actorCan(user, "leave:view_all") ? getLedger(user, id, year) : Promise.resolve([]),
    actorCan(user, "leave:view_all") ? getLeavePolicy(user, id) : Promise.resolve(null),
    actorCan(user, "attendance:view_all") ? listCorrections(user, { employeeId: id, limit: 10 }) : Promise.resolve([]),
    getOrgProfile(user, id),
    listOrgHistory(user, id),
    listEmployeeOptions(user),
    listEmployeeChecklists(user, id),
    listAssignableUsers(user),
    listEmployeeAssets(user, id),
    actorCan(user, "payroll:view") ? settlementOfEmployee(user, id) : Promise.resolve(null),
    !e.isActive && actorCan(user, "employee:manage") ? getEmployeeHandover(user, id) : Promise.resolve(null),
  ]);
  const row = (k: string, v: React.ReactNode) => (<div className="grid grid-cols-[9rem_1fr] gap-2 py-2 text-sm"><dt className="text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>);
  return (
    <div className="space-y-4">
      <Link href="/karyawan" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Daftar karyawan</Link>
      <PageHeader title={e.fullName} description={`${e.employeeNo} · ${e.position}${e.divisionName ? ` · ${e.divisionName}` : ""}`}
        actions={<EmployeeActions employee={e} divisions={divisions} today={today} canManage={actorCan(user, "employee:manage")} canCreateAccount={actorCan(user, "user:manage") || actorCan(user, "user:manage_employee")} />} />
      <Card>
        <div className="flex items-center gap-4 border-b border-line p-5">
          {e.photoUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={e.photoUrl} alt={`Foto ${e.fullName}`} className="size-16 rounded-full border border-line object-cover" />
            : <span className="grid size-16 place-items-center rounded-full bg-brand-50 text-brand-700"><UserRound className="size-8" /></span>}
          <div className="flex flex-wrap gap-1.5"><Badge>{EMPLOYMENT_LABEL[e.employmentStatus]}</Badge>{e.isActive ? <Badge tone="green">Aktif</Badge> : <Badge tone="red">Nonaktif · berhenti {formatDateLong(e.endDate)}</Badge>}{e.userEmail ? <Badge tone="blue">Akun: {e.userEmail}</Badge> : <Badge>Belum punya akun login</Badge>}</div>
        </div>
        <dl className="grid divide-y divide-line px-5 md:grid-cols-2 md:gap-x-10 md:divide-y-0">
          <div className="divide-y divide-line">{row("Mulai bekerja", formatDateLong(e.joinDate))}{row("Telepon", e.phone)}{row("Email", e.email)}{row("Alamat", e.address)}</div>
          <div className="divide-y divide-line">{row("Bank", e.bankName)}{row("No. rekening", e.bankAccountMasked)}{row("Atas nama", e.bankAccountHolder)}{row("Kontak darurat", e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactRelation ? ` (${e.emergencyContactRelation})` : ""}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ""}` : null)}{row("Catatan", e.notes)}</div>
        </dl>
      </Card>
      <OrgCard profile={org} history={orgHistory} divisions={divisions} people={people} canManage={actorCan(user, "employee:manage") && e.isActive} today={today} />
      <EmployeeChecklistCard employeeId={id} checklists={checklists} canManage={actorCan(user, "employee:manage")} isActive={e.isActive} users={assignable.map((u) => ({ id: u.id, name: u.name }))} />
      {handover && handover.total > 0 && <EmployeeHandoverCard handover={handover} />}
      <EmployeeAssetsCard holding={assets.holding} history={assets.history} canManage={actorCan(user, "employee:manage")} />
      {actorCan(user, "payroll:view") && (!e.isActive || settlement || checklists.some((c) => c.kind === "OFFBOARDING" && c.status === "OPEN")) && <EmployeeSettlementCard employeeId={id} existing={settlement} canPrepare={actorCan(user, "payroll:prepare")} endDate={e.endDate} />}
      {comps && <ComponentsManager employeeId={id} items={comps} today={today} />}
      {leavePolicy && <LeavePolicyCard policy={leavePolicy} canManage={actorCan(user, "leave_policy:manage") && !(user.employeeId === id && user.role !== "SUPER_ADMIN")} canGrant={actorCan(user, "leave_balance:manage")} />}
      {balance && <BalanceCard employeeId={id} balance={balance} ledger={ledger} canManage={actorCan(user, "leave_balance:manage")} />}
      {actorCan(user, "attendance:view_all") && (
        <Card>
          <CardHeader title="Koreksi absensi terbaru" actions={<Link className="text-sm text-brand-700 hover:underline" href={`/rekap?employeeId=${id}`}>Rekap karyawan ini</Link>} />
          {corrections.length === 0 ? <EmptyState title="Belum ada koreksi" /> : (
            <ul className="divide-y divide-line text-sm">{corrections.map((c) => (
              <li key={c.id} className="px-5 py-3"><p className="font-medium">{formatDateLong(c.date)} <span className="font-normal text-muted">· {c.correctedBy} · {formatDateTime(c.createdAt)}</span></p>
                <p className="text-muted">{c.before ? `Sebelum: ${formatClock(c.before.checkInAt)}–${c.before.checkOutAt ? formatClock(c.before.checkOutAt) : "—"}` : "Sebelum: tidak ada catatan"} → {c.after ? `Sesudah: ${formatClock(c.after.checkInAt)}–${c.after.checkOutAt ? formatClock(c.after.checkOutAt) : "—"}` : "Catatan dihapus"} · Alasan: {c.reason}</p></li>
            ))}</ul>
          )}
        </Card>
      )}
    </div>
  );
}
