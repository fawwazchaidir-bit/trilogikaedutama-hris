import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";
import { listTeamLeaves } from "@/server/services/leave";
import { listTeamOvertime } from "@/server/services/overtime";
import { listDelegateCandidates, listDelegations } from "@/server/services/org";
import { env } from "@/server/env";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { LeaveReviewTable } from "@/components/leave-admin";
import { OvertimeReviewTable } from "@/components/overtime-admin";
import { DelegationPanel } from "@/components/delegation-panel";
import { AppError } from "@/server/errors";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Persetujuan Tim" };
export const dynamic = "force-dynamic";

/** Pengajuan cuti & lembur milik tim yang boleh ditinjau pelaku: atasan langsung, pengganti yang ditunjuk, atau eskalasi saat atasan tidak ada. Bukan atasan → 404. */
export default async function TeamApprovalPage() {
  const user = await requirePageUser();
  let leaves, overtime;
  try { [leaves, overtime] = await Promise.all([listTeamLeaves(user), listTeamOvertime(user)]); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const today = todayIso(env().APP_TIMEZONE);
  const [delegations, candidates] = await Promise.all([listDelegations(user), listDelegateCandidates(user)]);
  const caps = Object.values(leaves.capacity);
  const count = (c: string) => caps.filter((x) => x === c).length;
  return (
    <div className="space-y-4">
      <PageHeader title="Persetujuan Tim" description="Tinjau cuti, izin, sakit, dan lembur anggota tim Anda. HR tetap memantau dan dapat memprosesnya bila diperlukan. Anda tidak dapat memproses pengajuan sendiri." />
      <Notice tone="info">
        Anda meninjau sebagai atasan langsung bagi <b>{count("SUPERVISOR")}</b> orang
        {count("DELEGATE") > 0 && <>, pengganti bagi <b>{count("DELEGATE")}</b> orang</>}
        {count("ESCALATION") > 0 && <>, dan menerima eskalasi (atasan mereka sedang tidak ada) untuk <b>{count("ESCALATION")}</b> orang</>}.
      </Notice>
      <Card>
        <CardHeader title="Cuti, izin & sakit menunggu" />
        {leaves.items.length === 0 ? <EmptyState title="Tidak ada pengajuan menunggu" description="Pengajuan baru dari tim Anda muncul di sini dan di notifikasi." />
          : <LeaveReviewTable items={leaves.items} canReview selfEmployeeId={user.employeeId} isSuper={false} />}
      </Card>
      <Card>
        <CardHeader title="Lembur menunggu" />
        {overtime.items.length === 0 ? <EmptyState title="Tidak ada lembur menunggu" />
          : <OvertimeReviewTable items={overtime.items} canReview selfEmployeeId={user.employeeId} isSuper={false} />}
      </Card>
      <DelegationPanel items={delegations} candidates={candidates} today={today} selfEmployeeId={user.employeeId} />
    </div>
  );
}
