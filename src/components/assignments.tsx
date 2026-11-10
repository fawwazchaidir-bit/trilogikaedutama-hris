"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Download, FilePlus2, FileText, ReceiptText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong, formatDateRange } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { needsMaterai } from "@/lib/assignment";
import type { AssignmentDto, AssigneeDto, MyAssignmentDto, ReceiptDto } from "@/server/services/assignments";
import { DiscussButton } from "@/components/chat/discuss-button";

const METHOD = { CASH: "Tunai", TRANSFER: "Transfer bank" } as const;
const btn = "inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-canvas";

type Dlg = { kind: "ISSUE"; letter: AssignmentDto; a: AssigneeDto } | { kind: "CANCEL"; letter: AssignmentDto } | { kind: "VOID"; letter: AssignmentDto; r: ReceiptDto };

export function AssignmentList({ items, today, canManage, canRevoke, selfEmployeeId, isSuper }: { items: AssignmentDto[]; today: string; canManage: boolean; canRevoke: boolean; selfEmployeeId: string | null; isSuper: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [paidDate, setPaidDate] = useState(today);
  const [method, setMethod] = useState<"CASH" | "TRANSFER">("CASH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const close = () => { setDlg(null); setNote(""); setError(null); setFe({}); };

  async function run() {
    if (!dlg) return;
    setBusy(true); setError(null); setFe({});
    try {
      if (dlg.kind === "ISSUE") {
        const r = await api<ReceiptDto>("/api/allowance-receipts", { body: { assigneeId: dlg.a.id, paidDate, method, note } });
        toast.success(`Bukti Penerimaan ${r.number} diterbitkan.`);
      } else if (dlg.kind === "CANCEL") {
        await api(`/api/assignments/${dlg.letter.id}/cancel`, { body: { reason: note } });
        toast.success("Surat tugas dibatalkan.");
      } else {
        await api(`/api/allowance-receipts/${dlg.r.id}/void`, { body: { reason: note } });
        toast.success("Bukti penerimaan dibatalkan.");
      }
      close(); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  if (items.length === 0) return <Card><EmptyState title="Belum ada surat tugas" description="Terbitkan surat tugas untuk karyawan yang ditunjuk; uang harian dan bukti penerimaannya dikelola dari sini." /></Card>;
  return (
    <>
      <div className="space-y-4">
        {items.map((l) => (
          <Card key={l.id} className={l.status === "CANCELLED" ? "opacity-70" : undefined}>
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="flex flex-wrap items-center gap-2 font-semibold"><span className="font-mono text-[13px]">{l.number}</span>{l.status === "ISSUED" ? <Badge tone="green">Terbit</Badge> : <Badge tone="red">Dibatalkan</Badge>}</p>
                <p className="mt-1 text-base font-medium">{l.purpose}</p>
                <p className="text-sm text-muted">{l.destination} · {formatDateRange(l.startDate, l.endDate)} ({l.tripDays} hari) · diterbitkan {formatDateLong(l.issueDate)} oleh {l.issuedBy}</p>
                {l.details && <p className="mt-1 text-sm text-muted">{l.details}</p>}
                {l.status === "CANCELLED" && <p className="mt-1 text-sm text-brand-700">Dibatalkan: {l.cancelReason}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <DiscussButton type="ASSIGNMENT_LETTER" id={l.id} />
                <a href={`/api/assignments/${l.id}/pdf`} className={btn}><Download className="size-4" />Surat Tugas (PDF)</a>
                {l.letterDocumentId ? <Link href={`/persuratan/${l.letterDocumentId}`} className={btn}><FileText className="size-4" />Dokumen surat</Link> : canManage && l.status === "ISSUED" && <Button size="sm" variant="danger" onClick={() => setDlg({ kind: "CANCEL", letter: l })}><Ban className="size-3.5" />Batalkan</Button>}
              </div>
            </header>
            <TableWrap><Table>
              <thead><tr><Th>Penerima tugas</Th><Th align="right">Hari</Th><Th align="right">Tarif / hari</Th><Th align="right">Uang harian</Th><Th>Bukti penerimaan</Th></tr></thead>
              <tbody>{l.assignees.map((a) => {
                const own = !isSuper && selfEmployeeId === a.employeeId;
                return (
                  <tr key={a.id}>
                    <Td className="font-medium">{a.employeeName}<span className="block text-xs font-normal text-muted">{a.employeeNo} · {a.position}</span></Td>
                    <Td align="right">{a.days}</Td><Td align="right">{formatRupiah(a.dailyRate)}</Td><Td align="right" className="font-medium">{formatRupiah(a.total)}</Td>
                    <Td>
                      {a.receipt ? (
                        <div className="flex flex-col items-start gap-1.5">
                          <div className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-mono text-[13px]">{a.receipt.number}</span>
                            <span className="text-xs text-muted">{formatDateLong(a.receipt.paidDate)} · {METHOD[a.receipt.method]}</span>
                          </div>
                          <div className="flex gap-2">
                            <a href={`/api/allowance-receipts/${a.receipt.id}/pdf`} className={btn}><Download className="size-4" />PDF</a>
                            {canRevoke && <Button size="sm" variant="danger" onClick={() => setDlg({ kind: "VOID", letter: l, r: a.receipt! })}>Batalkan</Button>}
                          </div>
                        </div>
                      ) : l.status === "ISSUED" && canManage ? (
                        own ? <span className="text-xs text-muted">Diterbitkan Super Admin</span>
                          : <Button size="sm" variant="primary" onClick={() => { setPaidDate(today); setMethod("CASH"); setDlg({ kind: "ISSUE", letter: l, a }); }}><ReceiptText className="size-3.5" />Terbitkan bukti penerimaan</Button>
                      ) : <span className="text-xs text-muted">Belum diterbitkan</span>}
                    </Td>
                  </tr>
                );
              })}</tbody>
            </Table></TableWrap>
          </Card>
        ))}
      </div>

      <Dialog open={!!dlg} onClose={() => !busy && close()} size="sm"
        title={dlg?.kind === "ISSUE" ? "Terbitkan Bukti Penerimaan Uang Harian" : dlg?.kind === "CANCEL" ? "Batalkan surat tugas" : "Batalkan bukti penerimaan"}
        description={dlg?.kind === "ISSUE" ? `${dlg.a.employeeName} · ${dlg.a.days} hari × ${formatRupiah(dlg.a.dailyRate)} = ${formatRupiah(dlg.a.total)} · Surat Tugas ${dlg.letter.number}` : dlg?.kind === "VOID" ? `${dlg.r.number} · ${dlg.r.employeeName}` : dlg ? `${dlg.letter.number} · ${dlg.letter.purpose}` : undefined}
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant={dlg?.kind === "ISSUE" ? "primary" : "danger"} loading={busy} onClick={run}>{dlg?.kind === "ISSUE" ? "Terbitkan" : "Batalkan"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {dlg?.kind === "ISSUE" && (
            <>
              <Notice tone="info">Dokumen ini berdiri sendiri — <strong>tidak masuk slip gaji</strong>. Gunakan blok tanda tangan resmi yang sama dengan slip gaji; penerima menandatangani basah pada PDF yang dicetak.{needsMaterai(dlg.a.total) && " Nilainya di atas Rp 5.000.000, PDF memuat kotak meterai — verifikasi ketentuan bea meterai."}</Notice>
              <TextField label="Tanggal uang diserahkan" type="date" required value={paidDate} min={dlg.letter.issueDate} max={today} onChange={(e) => setPaidDate(e.target.value)} error={fe.paidDate} />
              <SelectField label="Cara pembayaran" required value={method} onChange={(e) => setMethod(e.target.value as "CASH" | "TRANSFER")} error={fe.method}><option value="CASH">Tunai</option><option value="TRANSFER">Transfer bank</option></SelectField>
              <TextAreaField label="Catatan (opsional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} error={fe.note} />
            </>
          )}
          {dlg && dlg.kind !== "ISSUE" && <TextAreaField label="Alasan pembatalan (wajib)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={fe.reason} />}
          {dlg?.kind === "VOID" && <Notice tone="warn">Bukti yang dibatalkan tetap tersimpan (berwatermark “DIBATALKAN”) dan dapat diterbitkan ulang.</Notice>}
        </div>
      </Dialog>
    </>
  );
}

/** Tampilan karyawan: surat tugas yang menugaskannya + uang harian & bukti penerimaan miliknya. */
export function MyAssignments({ items }: { items: MyAssignmentDto[] }) {
  if (items.length === 0) return <Card><EmptyState title="Belum ada surat tugas" description="Surat tugas yang menugaskan Anda akan muncul di sini beserta uang harian dan bukti penerimaannya." /></Card>;
  return (
    <div className="space-y-4">
      {items.map((a) => (
        <Card key={a.id} className={a.status === "CANCELLED" ? "opacity-70" : undefined}>
          <div className="flex flex-wrap items-start justify-between gap-3 p-5">
            <div>
              <p className="flex flex-wrap items-center gap-2"><span className="font-mono text-[13px] font-semibold">{a.number}</span>{a.status === "CANCELLED" && <Badge tone="red">Dibatalkan</Badge>}</p>
              <p className="mt-1 font-medium">{a.purpose}</p>
              <p className="text-sm text-muted">{a.destination} · {formatDateRange(a.startDate, a.endDate)} ({a.tripDays} hari){a.colleagues.length ? ` · bersama ${a.colleagues.join(", ")}` : ""}</p>
              {a.details && <p className="mt-1 text-sm text-muted">{a.details}</p>}
            </div>
            <div className="flex flex-wrap gap-2"><DiscussButton type="ASSIGNMENT_LETTER" id={a.id} /><a href={`/api/assignments/${a.id}/pdf`} className={btn}><FilePlus2 className="size-4" />Surat Tugas (PDF)</a></div>
          </div>
          {a.status === "ISSUED" && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-canvas/50 px-5 py-3 text-sm">
              <p>Uang harian Anda: <strong>{a.mine.days} hari × {formatRupiah(a.mine.dailyRate)} = {formatRupiah(a.mine.total)}</strong></p>
              {a.receipt
                ? <div className="flex flex-wrap items-center gap-2"><Badge tone="green">Diterima {formatDateLong(a.receipt.paidDate)} · {METHOD[a.receipt.method]}</Badge><span className="font-mono text-[13px]">{a.receipt.number}</span><a href={`/api/allowance-receipts/${a.receipt.id}/pdf`} className={btn}><Download className="size-4" />Bukti Penerimaan (PDF)</a></div>
                : <Badge tone="amber">Bukti penerimaan belum diterbitkan</Badge>}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
