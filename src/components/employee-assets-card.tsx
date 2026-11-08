"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReturnAssetDialog } from "@/components/asset-dialogs";
import { ASSET_CONDITION_LABEL } from "@/lib/assets";
import { formatDateLong } from "@/lib/format";
import type { EmployeeAssetDto } from "@/server/services/assets";

/** Aset yang sedang dipegang karyawan + riwayat; HR dapat mencatat pengembalian langsung dari sini (mis. saat proses berhenti). */
export function EmployeeAssetsCard({ holding, history, canManage }: { holding: EmployeeAssetDto[]; history: EmployeeAssetDto[]; canManage: boolean }) {
  const router = useRouter();
  const [ret, setRet] = useState<{ id: string; label: string } | null>(null);
  return (
    <Card>
      <CardHeader title={`Aset yang dipegang (${holding.length})`} description="Serah-terima dicatat di menu Aset." actions={<Link href="/aset" className="text-sm text-brand-700 hover:underline">Buka menu Aset</Link>} />
      {holding.length === 0 ? <EmptyState title="Tidak ada aset yang sedang dipegang" /> : (
        <ul className="divide-y divide-line border-t border-line">
          {holding.map((a) => (
            <li key={a.assignmentId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <p className="font-medium"><Link className="text-brand-700 hover:underline" href={`/aset/${a.assetId}`}>{a.name}</Link> <span className="text-xs text-muted">({a.code})</span></p>
                <p className="text-xs text-muted">{a.categoryLabel}{a.serialNo ? ` · No. seri ${a.serialNo}` : ""} · sejak {formatDateLong(a.assignedOn)}{a.note ? ` · ${a.note}` : ""}</p>
              </div>
              {canManage && <Button size="sm" onClick={() => setRet({ id: a.assetId, label: `${a.name} (${a.code})` })} aria-label={`Catat pengembalian: ${a.name}`}>Catat pengembalian</Button>}
            </li>
          ))}
        </ul>
      )}
      {history.length > 0 && (
        <details className="border-t border-line px-5 py-3 text-sm">
          <summary className="cursor-pointer font-medium">Riwayat aset ({history.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {history.map((a) => (
              <li key={a.assignmentId}>{a.name} ({a.code}) · {formatDateLong(a.assignedOn)} → {a.returnedOn ? formatDateLong(a.returnedOn) : "—"} {a.returnCondition && <Badge tone={a.returnCondition === "GOOD" ? "green" : a.returnCondition === "DAMAGED" ? "amber" : "red"}>{ASSET_CONDITION_LABEL[a.returnCondition]}</Badge>}{a.returnNote ? ` · ${a.returnNote}` : ""}</li>
            ))}
          </ul>
        </details>
      )}
      <ReturnAssetDialog asset={ret} onClose={() => setRet(null)} onDone={() => { setRet(null); router.refresh(); }} />
    </Card>
  );
}
