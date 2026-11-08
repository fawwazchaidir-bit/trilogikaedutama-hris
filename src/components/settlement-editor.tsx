"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import {
  BASIS_LABEL, DEDUCTION_LINE_CATEGORIES, EARNING_LINE_CATEGORIES, LINE_CATEGORY_LABEL, NOT_COMPUTED_BY_SYSTEM, SETTLEMENT_STATUS_LABEL,
  type SettlementBasisValue, type SettlementLineCategoryValue, type SettlementStatusValue,
} from "@/lib/final-settlement";
import type { SettlementDto, SettlementLineDto } from "@/server/services/final-settlements";

const rp = (n: number) => formatRupiah(n, "PLAIN");
const STATUS_TONE: Record<SettlementStatusValue, "gray" | "amber" | "blue" | "green" | "red"> = { DRAFT: "gray", PENDING_APPROVAL: "amber", APPROVED: "blue", PAID: "green", CANCELLED: "red" };

type Dlg =
  | null | { kind: "line"; line: SettlementLineDto | null } | { kind: "header" } | { kind: "return" } | { kind: "approve" } | { kind: "paid" } | { kind: "cancel" };
const blankLine = { category: "SEVERANCE" as SettlementLineCategoryValue, name: "", amount: "", formula: "", note: "" };

/** Editor penyelesaian akhir: usulan sistem + baris manual, total, peringatan, dan alur Draf → diajukan → disetujui → dibayar. */
export function SettlementEditor({ s, canPrepare, canApprove, canRevoke, isSelf }: { s: SettlementDto; canPrepare: boolean; canApprove: boolean; canRevoke: boolean; isSelf: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [line, setLine] = useState(blankLine);
  const [head, setHead] = useState({ lastWorkDate: s.lastWorkDate, basis: s.basis as SettlementBasisValue, leaveDivisor: s.leaveDivisor === null ? "" : String(s.leaveDivisor), note: s.note ?? "" });
  const [text, setText] = useState({ note: "", reason: "", paidOn: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const draft = s.status === "DRAFT";
  const editable = draft && canPrepare;
  const earnings = s.lines.filter((l) => l.kind === "EARNING");
  const deductions = s.lines.filter((l) => l.kind === "DEDUCTION");

  function open(d: Dlg) {
    setError(null); setFe({});
    if (d?.kind === "line") setLine(d.line ? { category: d.line.category, name: d.line.name, amount: String(d.line.amount), formula: d.line.formula ?? "", note: d.line.note ?? "" } : blankLine);
    if (d?.kind === "header") setHead({ lastWorkDate: s.lastWorkDate, basis: s.basis, leaveDivisor: s.leaveDivisor === null ? "" : String(s.leaveDivisor), note: s.note ?? "" });
    setText({ note: "", reason: "", paidOn: "", reference: "" });
    setDlg(d);
  }
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); setDlg(null); router.refresh(); } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  const post = (path: string, body: unknown = {}) => api(`/api/final-settlements/${s.id}/${path}`, { body });
  function submitDialog() {
    if (!dlg) return;
    const lineBody = { category: line.category, name: line.name, amount: Number(line.amount), formula: line.formula, note: line.note };
    if (dlg.kind === "line") return dlg.line
      ? run(() => api(`/api/final-settlements/line/${dlg.line!.id}`, { method: "PATCH", body: lineBody }), "Baris disimpan.")
      : run(() => post("lines", lineBody), "Baris ditambahkan.");
    if (dlg.kind === "header") return run(() => api(`/api/final-settlements/${s.id}`, { method: "PATCH", body: { lastWorkDate: head.lastWorkDate, basis: head.basis, leaveDivisor: head.leaveDivisor.trim() === "" ? null : Number(head.leaveDivisor), note: head.note } }), "Disimpan; usulan sistem dihitung ulang.");
    if (dlg.kind === "return") return run(() => post("return", { note: text.note }), "Dikembalikan ke Draf.");
    if (dlg.kind === "approve") return run(() => post("approve", { note: text.note }), "Penyelesaian akhir disetujui.");
    if (dlg.kind === "paid") return run(() => post("paid", { paidOn: text.paidOn || undefined, reference: text.reference }), "Pembayaran dicatat.");
    return run(() => post("cancel", { reason: text.reason }), "Penyelesaian akhir dibatalkan.");
  }
  const dlgTitle = !dlg ? "" : dlg.kind === "line" ? (dlg.line ? "Ubah baris" : "Tambah baris manual") : dlg.kind === "header" ? "Ubah tanggal & dasar perhitungan" : dlg.kind === "return" ? "Kembalikan ke Draf" : dlg.kind === "approve" ? "Setujui penyelesaian akhir" : dlg.kind === "paid" ? "Catat sudah dibayar" : "Batalkan penyelesaian akhir";
  const dlgCta = !dlg ? "" : dlg.kind === "approve" ? "Setujui" : dlg.kind === "return" ? "Kembalikan" : dlg.kind === "paid" ? "Catat dibayar" : dlg.kind === "cancel" ? "Batalkan penyelesaian" : "Simpan";

  const table = (rows: SettlementLineDto[], empty: string) => rows.length === 0 ? <EmptyState title={empty} /> : (
    <TableWrap><Table>
      <thead><tr><Th>Rincian</Th><Th>Dasar perhitungan</Th><Th align="right">Nominal</Th>{editable && <Th>Aksi</Th>}</tr></thead>
      <tbody>{rows.map((l) => (
        <tr key={l.id}>
          <Td><p className="font-medium">{l.name}</p><p className="text-xs text-muted">{l.categoryLabel} · <Badge tone={l.source === "SYSTEM" ? "blue" : "gray"}>{l.source === "SYSTEM" ? "Usulan sistem" : "Manual"}</Badge></p>{l.note && <p className="text-xs text-muted">{l.note}</p>}</Td>
          <Td className="text-xs text-muted">{l.formula ?? "—"}</Td>
          <Td align="right" className="tabular whitespace-nowrap font-medium">{rp(l.amount)}</Td>
          {editable && <Td><div className="flex gap-2"><Button size="sm" onClick={() => open({ kind: "line", line: l })} aria-label={`Ubah baris: ${l.name}`}>Ubah</Button><Button size="sm" disabled={busy} onClick={() => run(() => api(`/api/final-settlements/line/${l.id}`, { method: "DELETE" }), "Baris dihapus.")} aria-label={`Hapus baris: ${l.name}`}>Hapus</Button></div></Td>}
        </tr>
      ))}</tbody>
    </Table></TableWrap>
  );

  return (
    <div className="space-y-4">
      <Notice tone="warn">
        Sistem hanya mengusulkan yang dapat dihitung dari data: <strong>gaji prorata bulan terakhir</strong>, <strong>uang cuti</strong> (bila pembagi diisi), dan <strong>uang harian yang belum dibayar</strong>.
        {" "}{NOT_COMPUTED_BY_SYSTEM.join(", ")} <strong>tidak dihitung sistem</strong> — tidak ada tarif yang ditanam. Isi sebagai baris manual sesuai perjanjian/ketentuan yang berlaku dan hasil hitung yang sah (mis. konsultan pajak).
      </Notice>
      {s.warnings.length > 0 && (
        <Card><div className="space-y-1 px-5 py-4 text-sm">
          <p className="flex items-center gap-2 font-medium text-amber-800"><AlertTriangle className="size-4" aria-hidden />Periksa sebelum mengajukan</p>
          <ul className="list-disc space-y-1 pl-5 text-amber-900">{s.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div></Card>
      )}
      {s.returnedNote && draft && <Notice tone="danger">Dikembalikan pimpinan: {s.returnedNote}</Notice>}

      <Card>
        <CardHeader title="Ringkasan" actions={editable ? <div className="flex gap-2"><Button size="sm" onClick={() => open({ kind: "header" })}>Ubah tanggal/dasar</Button><Button size="sm" disabled={busy} onClick={() => run(() => post("recompute"), "Usulan sistem dihitung ulang.")}>Hitung ulang usulan</Button></div> : undefined} />
        <dl className="grid gap-x-10 divide-y divide-line px-5 pb-4 text-sm md:grid-cols-2 md:divide-y-0">
          <div className="divide-y divide-line">
            <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Karyawan</dt><dd className="font-medium"><Link className="text-brand-700 hover:underline" href={`/karyawan/${s.employeeId}`}>{s.employeeName}</Link> <span className="text-xs text-muted">{s.employeeNo} · {s.position}</span></dd></div>
            <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Terakhir bekerja</dt><dd className="font-medium">{formatDateLong(s.lastWorkDate)}</dd></div>
            <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Dasar prorata</dt><dd className="font-medium">{BASIS_LABEL[s.basis]}</dd></div>
            <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Pembagi uang cuti</dt><dd className="font-medium">{s.leaveDivisor ?? "— (tidak dihitung)"}</dd></div>
          </div>
          <div className="divide-y divide-line">
            <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Status</dt><dd><Badge tone={STATUS_TONE[s.status]}>{SETTLEMENT_STATUS_LABEL[s.status]}</Badge></dd></div>
            <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Disiapkan oleh</dt><dd className="font-medium">{s.preparedBy}</dd></div>
            {s.approvedBy && <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Disetujui</dt><dd className="font-medium">{s.approvedBy}{s.approvedAt ? ` · ${formatDateLong(s.approvedAt.slice(0, 10))}` : ""}{s.approvalNote ? ` — ${s.approvalNote}` : ""}</dd></div>}
            {s.paidOn && <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Dibayar</dt><dd className="font-medium">{formatDateLong(s.paidOn)}{s.payReference ? ` · ${s.payReference}` : ""}</dd></div>}
            {s.cancelledAt && <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Dibatalkan</dt><dd className="font-medium">{s.cancelledBy} — {s.cancelReason}</dd></div>}
            {s.note && <div className="grid grid-cols-[10rem_1fr] gap-2 py-2"><dt className="text-muted">Catatan</dt><dd>{s.note}</dd></div>}
          </div>
        </dl>
      </Card>

      <Card>
        <CardHeader title="Pendapatan" actions={editable ? <Button size="sm" variant="primary" onClick={() => open({ kind: "line", line: null })}>Tambah baris manual</Button> : undefined} />
        {table(earnings, "Belum ada pendapatan")}
      </Card>
      <Card>
        <CardHeader title="Potongan" />
        {table(deductions, "Belum ada potongan")}
      </Card>
      <Card>
        <div className="grid gap-2 px-5 py-4 text-sm sm:grid-cols-3">
          <div><p className="text-muted">Total pendapatan</p><p className="tabular text-lg font-semibold">{rp(s.totalEarnings)}</p></div>
          <div><p className="text-muted">Total potongan</p><p className="tabular text-lg font-semibold">{rp(s.totalDeductions)}</p></div>
          <div><p className="text-muted">Bersih dibayarkan</p><p className={`tabular text-lg font-semibold ${s.netPayable < 0 ? "text-red-700" : ""}`}>{rp(s.netPayable)}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          {s.status === "DRAFT" && canPrepare && <Button variant="primary" disabled={busy} onClick={() => run(() => post("submit"), "Diajukan untuk persetujuan.")}>Ajukan untuk persetujuan</Button>}
          {s.status === "PENDING_APPROVAL" && canApprove && !isSelf && <><Button variant="primary" onClick={() => open({ kind: "approve" })}>Setujui</Button><Button onClick={() => open({ kind: "return" })}>Kembalikan ke Draf</Button></>}
          {s.status === "PENDING_APPROVAL" && canApprove && isSelf && <p className="text-sm text-muted">Anda tidak dapat menyetujui penyelesaian akhir milik Anda sendiri.</p>}
          {s.status === "APPROVED" && canPrepare && <Button variant="primary" onClick={() => open({ kind: "paid" })}>Catat sudah dibayar</Button>}
          {((s.status === "DRAFT" || s.status === "PENDING_APPROVAL") && canPrepare || s.status === "APPROVED" && canRevoke) && <Button onClick={() => open({ kind: "cancel" })}>Batalkan</Button>}
          {s.status === "PENDING_APPROVAL" && !canApprove && <p className="self-center text-sm text-muted">Menunggu persetujuan pimpinan.</p>}
          {s.status === "APPROVED" && <p className="self-center text-sm text-muted">Pembayaran dilakukan di luar aplikasi; catat di sini setelah dibayar.</p>}
        </div>
      </Card>

      <Dialog open={!!dlg} onClose={() => !busy && setDlg(null)} size="md" title={dlgTitle}
        footer={<><Button onClick={() => setDlg(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={submitDialog}>{dlgCta}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {dlg?.kind === "line" && (
            <>
              <SelectField label="Kategori" value={line.category} onChange={(e) => setLine({ ...line, category: e.target.value as SettlementLineCategoryValue })} error={fe.category}>
                <optgroup label="Pendapatan">{EARNING_LINE_CATEGORIES.map((c) => <option key={c} value={c}>{LINE_CATEGORY_LABEL[c]}</option>)}</optgroup>
                <optgroup label="Potongan">{DEDUCTION_LINE_CATEGORIES.map((c) => <option key={c} value={c}>{LINE_CATEGORY_LABEL[c]}</option>)}</optgroup>
              </SelectField>
              <TextField label="Nama baris" required value={line.name} onChange={(e) => setLine({ ...line, name: e.target.value })} error={fe.name} />
              <TextField label="Nominal (Rp)" required type="number" min={1} value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value })} error={fe.amount} hint="Bilangan bulat Rupiah, lebih dari 0. Jenis (pendapatan/potongan) mengikuti kategori." />
              <TextAreaField label="Dasar perhitungan" rows={2} value={line.formula} onChange={(e) => setLine({ ...line, formula: e.target.value })} error={fe.formula} hint="Tulis rumus/dasar hukum atau perjanjian agar penyetuju dapat memeriksa." />
              <TextAreaField label="Catatan (opsional)" rows={2} value={line.note} onChange={(e) => setLine({ ...line, note: e.target.value })} error={fe.note} />
              {dlg.line?.source === "SYSTEM" && <Notice tone="info">Baris usulan sistem yang diubah menjadi baris manual dan tidak ditimpa saat usulan dihitung ulang.</Notice>}
            </>
          )}
          {dlg?.kind === "header" && (
            <>
              <TextField label="Tanggal terakhir bekerja" type="date" value={head.lastWorkDate} onChange={(e) => setHead({ ...head, lastWorkDate: e.target.value })} error={fe.lastWorkDate} />
              <SelectField label="Dasar prorata" value={head.basis} onChange={(e) => setHead({ ...head, basis: e.target.value as SettlementBasisValue })} error={fe.basis}>
                {(Object.keys(BASIS_LABEL) as SettlementBasisValue[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
              </SelectField>
              <TextField label="Pembagi uang cuti (opsional)" type="number" min={1} max={31} value={head.leaveDivisor} onChange={(e) => setHead({ ...head, leaveDivisor: e.target.value })} error={fe.leaveDivisor} />
              <TextAreaField label="Catatan" rows={2} value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} error={fe.note} />
              <Notice tone="warn">Menyimpan menghitung ulang baris usulan sistem. Baris manual tidak berubah.</Notice>
            </>
          )}
          {dlg?.kind === "return" && <TextAreaField label="Catatan untuk penyusun" required rows={3} value={text.note} onChange={(e) => setText({ ...text, note: e.target.value })} error={fe.note} />}
          {dlg?.kind === "approve" && <TextAreaField label="Catatan persetujuan (opsional)" rows={2} value={text.note} onChange={(e) => setText({ ...text, note: e.target.value })} error={fe.note} />}
          {dlg?.kind === "paid" && (
            <>
              <TextField label="Tanggal pembayaran" type="date" value={text.paidOn} onChange={(e) => setText({ ...text, paidOn: e.target.value })} error={fe.paidOn} hint="Kosong = hari ini." />
              <TextField label="Referensi pembayaran (opsional)" value={text.reference} onChange={(e) => setText({ ...text, reference: e.target.value })} error={fe.reference} hint="Nomor transfer / bukti kas." />
              <Notice tone="warn">Setelah dicatat dibayar, penyelesaian akhir terkunci dan tidak dapat dibatalkan.</Notice>
            </>
          )}
          {dlg?.kind === "cancel" && <TextAreaField label="Alasan pembatalan" required rows={3} value={text.reason} onChange={(e) => setText({ ...text, reason: e.target.value })} error={fe.reason} />}
        </div>
      </Dialog>
    </div>
  );
}
