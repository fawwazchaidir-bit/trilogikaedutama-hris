"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Ban, Calculator, CheckCircle2, FilePlus2, Plus, RotateCcw, Send, Stamp, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { monthLabel } from "@/lib/format";
import { addDays, monthRange } from "@/lib/time";
import type { PayrollStatus } from "@/lib/labels";

function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function run<T>(fn: () => Promise<T>, ok: string | ((r: T) => string), done?: (r: T) => void) {
    setBusy(true); setError(null); setFe({});
    try { const r = await fn(); toast.success(typeof ok === "function" ? ok(r) : ok); done?.(r); router.refresh(); }
    catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); }
    finally { setBusy(false); }
  }
  return { router, toast, busy, error, fe, run, reset: () => { setError(null); setFe({}); } };
}

export function CreateRunButton({ today }: { today: string }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const prev = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const [f, setF] = useState(() => { const r = monthRange(prev); return { label: `Gaji ${monthLabel(prev)}`, periodStart: r.from, periodEnd: r.to, custom: false, attendanceStart: r.from, attendanceEnd: r.to, note: "" }; });
  const preset = (ym: string) => { const r = monthRange(ym); setF((x) => ({ ...x, label: `Gaji ${monthLabel(ym)}`, periodStart: r.from, periodEnd: r.to, attendanceStart: r.from, attendanceEnd: r.to })); };
  const cur = today.slice(0, 7);
  return (
    <>
      <Button variant="primary" onClick={() => { a.reset(); setOpen(true); }}><Plus className="size-4" />Buat periode gaji</Button>
      <Dialog open={open} onClose={() => !a.busy && setOpen(false)} size="md" title="Buat periode penggajian" description="Sistem menarik rekap absensi pada periode lalu menghitung gaji berdasarkan komponen & aturan yang tersimpan."
        footer={<><Button onClick={() => setOpen(false)} disabled={a.busy}>Batal</Button><Button variant="primary" loading={a.busy} onClick={() => void a.run(
          () => api<{ id: string; skipped: { name: string }[] }>("/api/payroll", { body: { label: f.label, periodStart: f.periodStart, periodEnd: f.periodEnd, note: f.note, ...(f.custom ? { attendanceStart: f.attendanceStart, attendanceEnd: f.attendanceEnd } : {}) } }),
          (r) => `Periode dibuat dan dihitung.${r.skipped.length ? ` ${r.skipped.length} karyawan dilewati (tanpa komponen gaji).` : ""}`, (r) => { setOpen(false); a.router.push(`/penggajian/${r.id}`); })}>Buat & hitung</Button></>}>
        <div className="space-y-4">
          {a.error && <Notice tone="danger">{a.error}</Notice>}
          <div className="flex flex-wrap gap-2 text-sm"><span className="self-center text-muted">Pilih cepat:</span>
            <button type="button" className="rounded-full border border-line bg-white px-3 py-1 hover:bg-canvas" onClick={() => preset(prev)}>{monthLabel(prev)}</button>
            <button type="button" className="rounded-full border border-line bg-white px-3 py-1 hover:bg-canvas" onClick={() => preset(cur)}>{monthLabel(cur)}</button></div>
          <TextField label="Nama periode" required value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} error={a.fe.label} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Awal periode gaji" type="date" required value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} error={a.fe.periodStart} />
            <TextField label="Akhir periode gaji" type="date" required value={f.periodEnd} min={f.periodStart} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} error={a.fe.periodEnd} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.custom} onChange={(e) => setF({ ...f, custom: e.target.checked })} />Periode absensi berbeda dari periode gaji (mis. cut-off tanggal 25)</label>
          {f.custom && <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Absensi dari" type="date" required value={f.attendanceStart} onChange={(e) => setF({ ...f, attendanceStart: e.target.value })} error={a.fe.attendanceStart} />
            <TextField label="Absensi sampai" type="date" required value={f.attendanceEnd} min={f.attendanceStart} onChange={(e) => setF({ ...f, attendanceEnd: e.target.value })} error={a.fe.attendanceEnd} />
          </div>}
          <TextAreaField label="Catatan (opsional)" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </Dialog>
    </>
  );
}

type Kind = "submit" | "return" | "approve" | "issue" | "cancel" | "revision";

export function RunActions({ runId, status, can }: { runId: string; status: PayrollStatus; can: { prepare: boolean; approve: boolean; revoke: boolean } }) {
  const a = useAction();
  const [dlg, setDlg] = useState<Kind | null>(null);
  const [note, setNote] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const close = () => { setDlg(null); setNote(""); a.reset(); };
  const post = (path: string, body?: unknown) => api(`/api/payroll/${runId}/${path}`, { body: body ?? {} });
  const open = (k: Kind) => { a.reset(); setNote(""); setDlg(k); };

  const cfg: Record<Kind, { title: string; desc?: string; label: string; tone: "primary" | "danger"; noteLabel?: string; noteRequired?: boolean; ok: string; call: () => Promise<unknown> }> = {
    submit: { title: "Ajukan untuk persetujuan?", desc: "Rincian dikunci dan dikirim ke pimpinan. Data absensi harus sudah final.", label: "Ajukan", tone: "primary", ok: "Diajukan untuk persetujuan.", call: () => post("submit") },
    return: { title: "Kembalikan ke Draf?", desc: "HR dapat memperbaiki dan menghitung ulang.", label: "Kembalikan", tone: "danger", noteLabel: "Catatan untuk HR (wajib)", noteRequired: true, ok: "Dikembalikan ke Draf.", call: () => post("return", { note }) },
    approve: { title: "Setujui penggajian?", desc: "Setelah disetujui, HR dapat menerbitkan slip gaji.", label: "Setujui", tone: "primary", noteLabel: "Catatan persetujuan (opsional)", ok: "Penggajian disetujui.", call: () => post("approve", { note }) },
    issue: { title: "Terbitkan slip gaji?", desc: "Slip dibuat sebagai snapshot yang TERKUNCI, karyawan mendapat notifikasi dan dapat mengunduhnya. Koreksi setelah ini hanya lewat pembatalan/revisi oleh pimpinan.", label: "Terbitkan", tone: "primary", ok: "Slip gaji diterbitkan.", call: () => post("issue", issueDate ? { issueDate } : {}) },
    cancel: { title: status === "ISSUED" ? "Batalkan penerbitan?" : "Batalkan periode?", desc: status === "ISSUED" ? "Semua slip pada periode ini dibatalkan (tetap tersimpan sebagai arsip) dan tidak lagi tampil bagi karyawan. Buat revisi untuk menerbitkan ulang." : "Periode dibatalkan dan rentang tanggalnya dapat dipakai lagi.", label: "Batalkan", tone: "danger", noteLabel: "Alasan pembatalan (wajib)", noteRequired: true, ok: "Dibatalkan.", call: () => post("cancel", { reason: note }) },
    revision: { title: "Buat revisi?", desc: "Membuat Draf baru dengan rentang yang sama, menghitung ulang dari data terkini, dan menyimpan jejak periode asal.", label: "Buat revisi", tone: "primary", ok: "Revisi dibuat.", call: () => post("revision") },
  };
  const c = dlg ? cfg[dlg] : null;
  const btn = (k: Kind, text: string, icon: React.ReactNode, variant: "primary" | "secondary" | "danger" = "secondary") => <Button key={k} variant={variant} onClick={() => open(k)}>{icon}{text}</Button>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "DRAFT" && can.prepare && <>
        <Button loading={a.busy} onClick={() => void a.run(() => post("calculate"), "Gaji dihitung ulang dari data terkini.")}><Calculator className="size-4" />Hitung ulang</Button>
        {btn("submit", "Ajukan persetujuan", <Send className="size-4" />, "primary")}{btn("cancel", "Batalkan periode", <Ban className="size-4" />, "danger")}</>}
      {status === "PENDING_APPROVAL" && <>
        {can.approve && btn("approve", "Setujui", <CheckCircle2 className="size-4" />, "primary")}{can.approve && btn("return", "Kembalikan ke Draf", <Undo2 className="size-4" />)}
        {can.prepare && !can.approve && btn("cancel", "Batalkan periode", <Ban className="size-4" />, "danger")}</>}
      {status === "APPROVED" && <>
        {can.prepare && btn("issue", "Terbitkan slip", <Stamp className="size-4" />, "primary")}{can.approve && btn("return", "Batalkan persetujuan", <Undo2 className="size-4" />)}{can.revoke && btn("cancel", "Batalkan periode", <Ban className="size-4" />, "danger")}</>}
      {status === "ISSUED" && can.revoke && btn("cancel", "Batalkan penerbitan", <Ban className="size-4" />, "danger")}
      {status === "CANCELLED" && can.prepare && btn("revision", "Buat revisi", <RotateCcw className="size-4" />, "primary")}

      <Dialog open={!!c} onClose={() => !a.busy && close()} size="sm" title={c?.title ?? ""} description={c?.desc}
        footer={<><Button onClick={close} disabled={a.busy}>Batal</Button><Button variant={c?.tone ?? "primary"} loading={a.busy} onClick={() => c && void a.run(c.call, c.ok, (r) => { close(); const id = (r as { data?: { id?: string } } | undefined)?.data?.id ?? (r as { id?: string } | undefined)?.id; if (dlg === "revision" && id) a.router.push(`/penggajian/${id}`); })}>{c?.label}</Button></>}>
        <div className="space-y-4">
          {a.error && <Notice tone="danger">{a.error}</Notice>}
          {dlg === "issue" && <TextField label="Tanggal penerbitan" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} error={a.fe.issueDate} hint="Kosong = hari ini" />}
          {c?.noteLabel && <TextAreaField label={c.noteLabel} rows={3} required={c.noteRequired} value={note} onChange={(e) => setNote(e.target.value)} error={a.fe.note ?? a.fe.reason} />}
        </div>
      </Dialog>
    </div>
  );
}

export function AdjustmentForm({ itemId }: { itemId: string }) {
  const a = useAction();
  const [f, setF] = useState({ kind: "EARNING", name: "", amount: null as number | null, reason: "" });
  return (
    <Card>
      <CardHeader title="Tambah penyesuaian" description="Penyesuaian manual (mis. koreksi, bonus khusus, potongan lain) wajib beralasan, tercatat di jejak audit, dan bertahan saat hitung ulang." />
      <form className="grid gap-4 p-5 sm:grid-cols-2" aria-label="Form penyesuaian" onSubmit={(e) => { e.preventDefault(); void a.run(() => api(`/api/payroll/items/${itemId}/adjustments`, { body: { kind: f.kind, name: f.name, amount: f.amount ?? 0, reason: f.reason } }), "Penyesuaian ditambahkan.", () => setF({ kind: "EARNING", name: "", amount: null, reason: "" })); }}>
        {a.error && <div className="sm:col-span-2"><Notice tone="danger">{a.error}</Notice></div>}
        <SelectField label="Jenis" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="EARNING">Tambah pendapatan</option><option value="DEDUCTION">Tambah potongan</option></SelectField>
        <TextField label="Nama" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={a.fe.name} />
        <MoneyInput label="Nominal" required value={f.amount} onChange={(v) => setF({ ...f, amount: v })} error={a.fe.amount} />
        <TextField label="Alasan (wajib)" required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} error={a.fe.reason} />
        <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={a.busy}><FilePlus2 className="size-4" />Tambahkan</Button></div>
      </form>
    </Card>
  );
}

export function RemoveAdjustmentButton({ lineId }: { lineId: string }) {
  const a = useAction();
  return <Button size="sm" variant="danger" loading={a.busy} aria-label="Hapus penyesuaian" onClick={() => void a.run(() => api(`/api/payroll/lines/${lineId}`, { method: "DELETE" }), "Penyesuaian dihapus.")}><Trash2 className="size-3.5" /></Button>;
}

export function SlipNoteForm({ itemId, initial }: { itemId: string; initial: string }) {
  const a = useAction();
  const [v, setV] = useState(initial);
  return (
    <form className="space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); void a.run(() => api(`/api/payroll/items/${itemId}/note`, { body: { note: v } }), "Catatan slip disimpan."); }}>
      {a.error && <Notice tone="danger">{a.error}</Notice>}
      <TextAreaField label="Catatan pada slip (opsional)" rows={2} maxLength={400} value={v} onChange={(e) => setV(e.target.value)} error={a.fe.note} />
      <Button type="submit" loading={a.busy}>Simpan catatan</Button>
    </form>
  );
}
