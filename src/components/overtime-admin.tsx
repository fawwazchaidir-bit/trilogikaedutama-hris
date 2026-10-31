"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { RequestStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { dotTime, formatDateShort, formatDateTime, formatDuration } from "@/lib/format";
import type { OvertimeDto, OvertimeReviewResult } from "@/server/services/overtime";

type Action = { kind: "APPROVE" | "REJECT" | "CANCEL"; item: OvertimeDto };

export function OvertimeReviewTable({ items, canReview, selfEmployeeId, isSuper }: { items: OvertimeDto[]; canReview: boolean; selfEmployeeId: string | null; isSuper: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const close = () => { setAction(null); setNote(""); setMinutes(""); setError(null); setFe({}); };
  const open = (a: Action) => { setMinutes(String(a.item.minutes)); setAction(a); };

  async function submit() {
    if (!action) return;
    setBusy(true); setError(null); setFe({});
    try {
      let res: OvertimeReviewResult;
      if (action.kind === "CANCEL") res = await api<OvertimeReviewResult>(`/api/overtime/${action.item.id}/cancel`, { body: { reason: note } });
      else res = await api<OvertimeReviewResult>(`/api/overtime/${action.item.id}/review`, { body: { decision: action.kind, note, ...(action.kind === "APPROVE" ? { approvedMinutes: Number(minutes) } : {}) } });
      toast.success(action.kind === "APPROVE" ? "Lembur disetujui." : action.kind === "REJECT" ? "Lembur ditolak." : "Pengajuan lembur dibatalkan.");
      res.payrollNotices.forEach((n) => toast.error(n));
      close(); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  const title = action ? { APPROVE: "Setujui lembur", REJECT: "Tolak pengajuan lembur", CANCEL: "Batalkan lembur yang disetujui" }[action.kind] : "";
  return (
    <>
      {items.length === 0 ? <EmptyState title="Tidak ada pengajuan lembur" description="Ubah filter untuk melihat pengajuan lain." /> : (
        <TableWrap><Table>
          <thead><tr><Th>Karyawan</Th><Th>Tanggal & jam</Th><Th align="right">Diajukan</Th><Th align="right">Disetujui</Th><Th>Pekerjaan</Th><Th>Status</Th>{canReview && <Th align="right">Aksi</Th>}</tr></thead>
          <tbody>{items.map((o) => {
            const own = selfEmployeeId === o.employeeId && !isSuper;
            return (
              <tr key={o.id}>
                <Td className="font-medium">{o.employeeName}<span className="block text-xs font-normal text-muted">{o.employeeNo}{o.division ? ` · ${o.division}` : ""}</span></Td>
                <Td className="whitespace-nowrap">{formatDateShort(o.date)}<span className="block text-xs text-muted">{dotTime(o.startTime)}–{dotTime(o.endTime)}{o.endsNextDay ? " (+1)" : ""}</span></Td>
                <Td align="right">{formatDuration(o.minutes)}</Td>
                <Td align="right">{o.approvedMinutes !== null ? formatDuration(o.approvedMinutes) : "—"}</Td>
                <Td className="min-w-56 max-w-sm">{o.reason}
                  {o.reviewedBy && <span className="mt-1 block text-xs text-muted">{o.status === "APPROVED" ? "Disetujui" : o.status === "REJECTED" ? "Ditolak" : "Diputuskan"} oleh {o.reviewedBy}, {formatDateTime(o.reviewedAt)}{o.reviewNote ? ` · ${o.reviewNote}` : ""}</span>}
                  {o.status === "CANCELLED" && <span className="mt-1 block text-xs text-muted">Dibatalkan: {o.cancelReason}</span>}</Td>
                <Td><RequestStatusBadge status={o.status} /></Td>
                {canReview && <Td align="right"><div className="flex justify-end gap-2">
                  {o.status === "PENDING" && (own ? <span className="text-xs text-muted">Diproses Super Admin</span> : <>
                    <Button size="sm" variant="primary" onClick={() => open({ kind: "APPROVE", item: o })} aria-label={`Setujui lembur ${o.employeeName}`}><Check className="size-3.5" />Setujui</Button>
                    <Button size="sm" variant="danger" onClick={() => open({ kind: "REJECT", item: o })} aria-label={`Tolak lembur ${o.employeeName}`}><X className="size-3.5" />Tolak</Button></>)}
                  {o.status === "APPROVED" && <Button size="sm" onClick={() => open({ kind: "CANCEL", item: o })}>Batalkan</Button>}
                </div></Td>}
              </tr>
            );
          })}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={!!action} onClose={() => !busy && close()} size="sm" title={title}
        description={action ? `${action.item.employeeName} · ${formatDateShort(action.item.date)} ${dotTime(action.item.startTime)} (${formatDuration(action.item.minutes)})` : undefined}
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant={action?.kind === "APPROVE" ? "primary" : "danger"} loading={busy} onClick={submit}>{action?.kind === "APPROVE" ? "Setujui" : action?.kind === "REJECT" ? "Tolak" : "Batalkan pengajuan"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {action?.kind === "APPROVE" && <>
            <TextField label="Menit yang disetujui" type="number" min={1} max={action.item.minutes} value={minutes} onChange={(e) => setMinutes(e.target.value)} error={fe.approvedMinutes} hint={`Maksimal ${action.item.minutes} menit (sesuai pengajuan). Dibayar sesuai bukti absensi bila verifikasi aktif.`} />
          </>}
          {action?.kind === "CANCEL" && <Notice tone="warn">Lembur ini tidak lagi dibayar. Periode gaji yang memakai tanggal ini ditandai &quot;data berubah&quot;.</Notice>}
          <TextAreaField label={action?.kind === "APPROVE" ? "Catatan (opsional)" : action?.kind === "REJECT" ? "Alasan penolakan (wajib)" : "Alasan pembatalan (wajib)"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={fe.note ?? fe.reason} />
        </div>
      </Dialog>
    </>
  );
}
