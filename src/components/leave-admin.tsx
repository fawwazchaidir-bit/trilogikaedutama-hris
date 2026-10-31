"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField } from "@/components/ui/field";
import { RequestStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateRange, formatDateTime, formatDays } from "@/lib/format";
import { DAY_PART_LABEL } from "@/lib/attendance";
import { LEAVE_TYPE_LABEL } from "@/lib/labels";
import type { LeaveDto } from "@/server/services/leave";

type Action = { kind: "APPROVE" | "REJECT" | "CANCEL"; leave: LeaveDto };

export function LeaveReviewTable({ items, canReview, selfEmployeeId, isSuper }: { items: LeaveDto[]; canReview: boolean; selfEmployeeId: string | null; isSuper: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const close = () => { setAction(null); setNote(""); setError(null); setFe({}); };

  async function submit() {
    if (!action) return;
    setBusy(true); setError(null); setFe({});
    try {
      if (action.kind === "CANCEL") await api(`/api/leaves/${action.leave.id}/cancel`, { body: { reason: note } });
      else await api(`/api/leaves/${action.leave.id}/review`, { body: { decision: action.kind, note } });
      toast.success(action.kind === "APPROVE" ? "Pengajuan disetujui." : action.kind === "REJECT" ? "Pengajuan ditolak." : "Pengajuan dibatalkan.");
      close(); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  const title = action ? { APPROVE: "Setujui pengajuan", REJECT: "Tolak pengajuan", CANCEL: "Batalkan pengajuan yang disetujui" }[action.kind] : "";
  return (
    <>
      {items.length === 0 ? <EmptyState title="Tidak ada pengajuan" description="Ubah filter untuk melihat pengajuan lain." /> : (
        <TableWrap><Table>
          <thead><tr><Th>Karyawan</Th><Th>Jenis</Th><Th>Tanggal</Th><Th align="right">Hari kerja</Th><Th>Alasan</Th><Th>Status</Th>{canReview && <Th align="right">Aksi</Th>}</tr></thead>
          <tbody>{items.map((l) => {
            const own = selfEmployeeId === l.employeeId && !isSuper;
            return (
              <tr key={l.id}>
                <Td className="font-medium">{l.employeeName}<span className="block text-xs font-normal text-muted">{l.employeeNo}{l.division ? ` · ${l.division}` : ""}</span></Td>
                <Td>{LEAVE_TYPE_LABEL[l.type]}</Td><Td className="whitespace-nowrap">{formatDateRange(l.startDate, l.endDate)}</Td><Td align="right">{l.workingDays !== null ? formatDays(l.workingDays) : "—"}{l.dayPart !== "FULL" && <span className="block text-xs text-muted">{DAY_PART_LABEL[l.dayPart]}</span>}</Td>
                <Td className="min-w-56 max-w-sm">{l.reason}{l.attachmentUrl && <a href={l.attachmentUrl} className="mt-1 flex items-center gap-1 text-brand-700 hover:underline"><Paperclip className="size-3.5" />Lampiran</a>}
                  {l.reviewedBy && <span className="mt-1 block text-xs text-muted">{l.status === "APPROVED" ? "Disetujui" : l.status === "REJECTED" ? "Ditolak" : "Diputuskan"} oleh {l.reviewedBy}, {formatDateTime(l.reviewedAt)}{l.reviewNote ? ` · ${l.reviewNote}` : ""}</span>}
                  {l.status === "CANCELLED" && <span className="mt-1 block text-xs text-muted">Dibatalkan: {l.cancelReason}</span>}</Td>
                <Td><RequestStatusBadge status={l.status} /></Td>
                {canReview && <Td align="right"><div className="flex justify-end gap-2">
                  {l.status === "PENDING" && (own ? <span className="text-xs text-muted">Diproses Super Admin</span> : <>
                    <Button size="sm" variant="primary" onClick={() => setAction({ kind: "APPROVE", leave: l })} aria-label={`Setujui pengajuan ${l.employeeName}`}><Check className="size-3.5" />Setujui</Button>
                    <Button size="sm" variant="danger" onClick={() => setAction({ kind: "REJECT", leave: l })} aria-label={`Tolak pengajuan ${l.employeeName}`}><X className="size-3.5" />Tolak</Button></>)}
                  {l.status === "APPROVED" && <Button size="sm" onClick={() => setAction({ kind: "CANCEL", leave: l })}>Batalkan</Button>}
                </div></Td>}
              </tr>
            );
          })}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={!!action} onClose={() => !busy && close()} size="sm" title={title}
        description={action ? `${action.leave.employeeName} · ${LEAVE_TYPE_LABEL[action.leave.type]} ${formatDateRange(action.leave.startDate, action.leave.endDate)} (${action.leave.workingDays !== null ? formatDays(action.leave.workingDays) : "—"} hari kerja${action.leave.dayPart !== "FULL" ? `, ${DAY_PART_LABEL[action.leave.dayPart].toLowerCase()}` : ""})` : undefined}
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant={action?.kind === "APPROVE" ? "primary" : "danger"} loading={busy} onClick={submit}>{action?.kind === "APPROVE" ? "Setujui" : action?.kind === "REJECT" ? "Tolak" : "Batalkan pengajuan"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {action?.kind === "APPROVE" && action.leave.type === "CUTI" && <Notice tone="info">Persetujuan akan memotong saldo cuti karyawan sebesar jumlah hari kerja.</Notice>}
          {action?.kind === "CANCEL" && <Notice tone="warn">Rekap absensi kembali mengikuti jadwal{action.leave.type === "CUTI" ? " dan saldo cuti dikembalikan" : ""}.</Notice>}
          <TextAreaField label={action?.kind === "APPROVE" ? "Catatan (opsional)" : action?.kind === "REJECT" ? "Alasan penolakan (wajib)" : "Alasan pembatalan (wajib)"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={fe.note ?? fe.reason} />
        </div>
      </Dialog>
    </>
  );
}

export function GrantQuota({ year, quota }: { year: number; quota: number }) {
  const router = useRouter();
  const toast = useToast();
  const [y, setY] = useState(String(year));
  const [busy, setBusy] = useState(false);
  async function grant() {
    setBusy(true);
    try {
      const r = await api<{ granted: number; skipped: number; quota: number }>("/api/leave-balance/grant-quota", { body: { year: Number(y) } });
      toast.success(r.granted ? `Kuota ${r.quota} hari diterapkan ke ${r.granted} karyawan.` : "Tidak ada karyawan yang perlu diberi kuota (semua sudah punya saldo awal atau kuota 0).");
      router.refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card className="mb-4">
      <CardHeader title="Kuota cuti tahunan" description={`Kebijakan saat ini: ${quota} hari/tahun (ubah di Pengaturan). Diterapkan hanya ke karyawan aktif yang belum punya saldo awal; aman dijalankan ulang.`} />
      <div className="flex flex-wrap items-end gap-3 p-5">
        <SelectField label="Tahun" value={y} onChange={(e) => setY(e.target.value)} className="w-32">{[year - 1, year, year + 1].map((v) => <option key={v} value={v}>{v}</option>)}</SelectField>
        <Button variant="primary" loading={busy} onClick={grant}>Terapkan kuota {quota} hari</Button>
      </div>
    </Card>
  );
}
