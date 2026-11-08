import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SettlementCreate } from "@/components/settlement-create";
import { formatRupiah } from "@/lib/money";
import { SETTLEMENT_STATUS_LABEL, type SettlementStatusValue } from "@/lib/final-settlement";

/** Tautan ke penyelesaian akhir karyawan (atau tombol membuatnya) pada detail karyawan. */
export function EmployeeSettlementCard({ employeeId, existing, canPrepare, endDate }: { employeeId: string; existing: { id: string; status: SettlementStatusValue; netPayable: number } | null; canPrepare: boolean; endDate: string | null }) {
  return (
    <Card>
      <CardHeader title="Penyelesaian akhir" description="Hak dan kewajiban finansial saat berhenti (gaji prorata, uang cuti, pesangon, dll.)." />
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4 text-sm">
        {existing ? (
          <>
            <Badge tone={existing.status === "PAID" ? "green" : existing.status === "APPROVED" ? "blue" : existing.status === "PENDING_APPROVAL" ? "amber" : "gray"}>{SETTLEMENT_STATUS_LABEL[existing.status]}</Badge>
            <span className="tabular">Bersih {formatRupiah(existing.netPayable, "PLAIN")}</span>
            <Link className="font-medium text-brand-700 hover:underline" href={`/penyelesaian-akhir/${existing.id}`}>Buka</Link>
          </>
        ) : (
          <>
            <span className="text-muted">Belum dibuat.</span>
            {canPrepare && <SettlementCreate employeeId={employeeId} defaultLastWorkDate={endDate ?? undefined} />}
          </>
        )}
      </div>
    </Card>
  );
}
