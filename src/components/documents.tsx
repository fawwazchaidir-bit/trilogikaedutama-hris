"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Archive, Download, ExternalLink, FileText, Plus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong, formatDateTime } from "@/lib/format";
import type { DocumentDto, RenewableContract } from "@/server/services/documents";

const KIND_LABEL = { CONTRACT: "Kontrak kerja", OTHER: "Dokumen lain" } as const;
const kb = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Penanda status masa berlaku & keputusan pimpinan. */
export function DocumentStatus({ d }: { d: DocumentDto }) {
  if (d.archived) return <Badge>Diarsipkan</Badge>;
  if (d.kind !== "CONTRACT") return <Badge>Tersimpan</Badge>;
  return (
    <div className="flex flex-col items-start gap-1">
      {d.phase === "NO_EXPIRY" && <Badge tone="blue">Tanpa batas waktu</Badge>}
      {d.phase === "ACTIVE" && <Badge tone="green">Berlaku · {d.daysLeft} hari lagi</Badge>}
      {d.phase === "EXPIRING" && <Badge tone="amber">Segera berakhir · {d.daysLeft} hari lagi</Badge>}
      {d.phase === "EXPIRED" && <Badge tone="red">Berakhir {formatDateLong(d.endDate)}</Badge>}
      {d.renewedById && <Badge tone="blue">Sudah diperpanjang</Badge>}
      {!d.renewedById && d.needsDecision && <Badge tone="amber">Perlu keputusan pimpinan</Badge>}
      {!d.renewedById && d.decision === "CONTINUE" && <Badge tone="green">Dilanjutkan{d.needsRenewalUpload ? " · PDF baru belum diunggah" : ""}</Badge>}
      {!d.renewedById && d.decision === "DISCONTINUE" && <Badge tone="red">Tidak dilanjutkan</Badge>}
    </div>
  );
}

/** Tombol "Lihat" yang membuka PDF di penampil dalam aplikasi (iframe), plus tautan tab baru & unduh. */
export function PdfViewButton({ doc, label = "Lihat" }: { doc: Pick<DocumentDto, "title" | "viewUrl" | "downloadUrl" | "fileName" | "employeeName">; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} aria-label={`Lihat PDF ${doc.title}`}><FileText className="size-3.5" />{label}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="xl" title={doc.title} description={`${doc.employeeName} · ${doc.fileName}`}
        footer={<>
          <a href={doc.viewUrl} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-canvas"><ExternalLink className="size-4" />Buka di tab baru</a>
          <a href={doc.downloadUrl} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-canvas"><Download className="size-4" />Unduh PDF</a>
          <Button onClick={() => setOpen(false)}>Tutup</Button>
        </>}>
        <iframe src={`${doc.viewUrl}#view=FitH`} title={`Pratinjau PDF: ${doc.title}`} className="h-[65vh] w-full rounded-md border border-line bg-canvas" />
        <p className="mt-2 text-xs text-muted">Bila PDF tidak tampil di sini (mis. sebagian peramban ponsel), gunakan “Buka di tab baru” atau “Unduh PDF”.</p>
      </Dialog>
    </>
  );
}

interface EmpOpt { id: string; employeeNo: string; fullName: string }
interface UploadPrefill { employeeId: string; renewsDocumentId: string; title: string; startDate: string }

export function DocumentUpload({ employees, renewable, prefill, onClose, triggerLabel = "Unggah dokumen", initialEmployeeId }: {
  employees: EmpOpt[]; renewable: RenewableContract[]; prefill?: UploadPrefill | null; onClose?: () => void; triggerLabel?: string; initialEmployeeId?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const blank = { employeeId: initialEmployeeId ?? "", kind: "CONTRACT", title: "", documentNo: "", startDate: "", endDate: "", note: "", renewsDocumentId: "" };
  const [open, setOpen] = useState(!!prefill);
  const [form, setForm] = useState(prefill ? { ...blank, ...prefill } : blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const close = () => { setOpen(false); setError(null); setFe({}); onClose?.(); };
  const renewables = renewable.filter((r) => r.employeeId === form.employeeId);

  async function submit() {
    setBusy(true); setError(null); setFe({});
    try {
      if (!file) { setFe({ file: "Pilih berkas PDF" }); throw new Error("Pilih berkas PDF kontrak/dokumen terlebih dulu."); }
      const body = new FormData();
      body.append("file", file);
      for (const [k, v] of Object.entries(form)) body.append(k, v);
      await api("/api/documents", { form: body });
      toast.success("Dokumen tersimpan."); setFile(null); setForm(blank); close(); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  return (
    <>
      {!prefill && <Button variant="primary" onClick={() => { setForm(blank); setFile(null); setOpen(true); }}><Plus className="size-4" />{triggerLabel}</Button>}
      <Dialog open={open} onClose={() => !busy && close()} size="lg" title={prefill ? "Unggah kontrak perpanjangan" : "Unggah dokumen kepegawaian"}
        description="Unggah hasil pindai PDF kontrak bermaterai yang sudah ditandatangani basah. Dokumen tidak dihapus — salah unggah diarsipkan dengan alasan."
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={submit}><Upload className="size-4" />Simpan</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <SelectField label="Karyawan" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value, renewsDocumentId: "" })} error={fe.employeeId} disabled={!!prefill}>
            <option value="">— pilih karyawan —</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeNo})</option>)}
          </SelectField>
          <SelectField label="Jenis dokumen" required value={form.kind} onChange={(e) => set("kind", e.target.value)} error={fe.kind} disabled={!!prefill}>
            <option value="CONTRACT">Kontrak kerja (bermaterai, tanda tangan basah)</option><option value="OTHER">Dokumen lain</option>
          </SelectField>
          <TextField className="sm:col-span-2" label="Judul dokumen" required value={form.title} onChange={(e) => set("title", e.target.value)} error={fe.title} placeholder="mis. PKWT I — Staf Admin (1 Jan – 31 Des 2026)" />
          <TextField label="Nomor dokumen (opsional)" value={form.documentNo} onChange={(e) => set("documentNo", e.target.value)} error={fe.documentNo} />
          <div className="hidden sm:block" />
          <TextField label={form.kind === "CONTRACT" ? "Tanggal mulai kontrak" : "Tanggal mulai (opsional)"} type="date" required={form.kind === "CONTRACT"} value={form.startDate} onChange={(e) => set("startDate", e.target.value)} error={fe.startDate} />
          <TextField label={form.kind === "CONTRACT" ? "Tanggal berakhir" : "Tanggal berakhir (opsional)"} type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} error={fe.endDate}
            hint={form.kind === "CONTRACT" ? "Kosongkan bila kontrak tanpa batas waktu (PKWTT). Pimpinan diingatkan H-3 bulan sebelum tanggal ini." : undefined} />
          {form.kind === "CONTRACT" && renewables.length > 0 && (
            <SelectField className="sm:col-span-2" label="Memperpanjang kontrak sebelumnya (opsional)" value={form.renewsDocumentId} onChange={(e) => set("renewsDocumentId", e.target.value)} error={fe.renewsDocumentId} disabled={!!prefill}
              hint="Memilih ini menghentikan pengingat kontrak lama.">
              <option value="">— kontrak baru, bukan perpanjangan —</option>
              {renewables.map((r) => <option key={r.id} value={r.id}>{r.title}{r.endDate ? ` (berakhir ${formatDateLong(r.endDate)})` : ""}</option>)}
            </SelectField>
          )}
          <TextAreaField className="sm:col-span-2" label="Catatan (opsional)" rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} error={fe.note} />
          <div className="sm:col-span-2">
            <label htmlFor="doc-file" className="mb-1.5 block text-sm font-medium text-ink-soft">Berkas PDF <span className="text-brand-600" aria-hidden>*</span></label>
            <input id="doc-file" name="file" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-canvas" />
            {file && <p className="mt-1 text-xs text-muted">{file.name} · {kb(file.size)}</p>}
            {fe.file && <p role="alert" className="mt-1 text-xs font-medium text-brand-700">{fe.file}</p>}
          </div>
        </div>
      </Dialog>
    </>
  );
}

type Action = { kind: "DECIDE"; doc: DocumentDto } | { kind: "ARCHIVE"; doc: DocumentDto };

export function DocumentTable({ items, employees, renewable, canManage, canDecide, showEmployee = true }: {
  items: DocumentDto[]; employees: EmpOpt[]; renewable: RenewableContract[]; canManage: boolean; canDecide: boolean; showEmployee?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [action, setAction] = useState<Action | null>(null);
  const [decision, setDecision] = useState<"CONTINUE" | "DISCONTINUE">("CONTINUE");
  const [note, setNote] = useState("");
  const [renewFor, setRenewFor] = useState<DocumentDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const close = () => { setAction(null); setNote(""); setError(null); setFe({}); };

  async function run() {
    if (!action) return;
    setBusy(true); setError(null); setFe({});
    try {
      if (action.kind === "DECIDE") await api(`/api/documents/${action.doc.id}/decision`, { body: { decision, note } });
      else await api(`/api/documents/${action.doc.id}/archive`, { body: { reason: note } });
      toast.success(action.kind === "DECIDE" ? (decision === "CONTINUE" ? "Keputusan dicatat: kontrak dilanjutkan." : "Keputusan dicatat: kontrak tidak dilanjutkan.") : "Dokumen diarsipkan.");
      close(); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  if (items.length === 0) return <EmptyState title="Tidak ada dokumen" description="Ubah filter, atau unggah kontrak kerja pertama lewat tombol “Unggah dokumen”." />;
  return (
    <>
      <TableWrap><Table>
        <thead><tr>{showEmployee && <Th>Karyawan</Th>}<Th>Dokumen</Th><Th>Masa berlaku & status</Th><Th align="right">Aksi</Th></tr></thead>
        <tbody>{items.map((d) => (
          <tr key={d.id} className={d.archived ? "opacity-60" : undefined}>
            {showEmployee && <Td className="font-medium">{d.employeeName}<span className="block text-xs font-normal text-muted">{d.employeeNo}{d.division ? ` · ${d.division}` : ""}{!d.employeeActive ? " · nonaktif" : ""}</span></Td>}
            <Td className="min-w-52 max-w-xs">
              <span className="font-medium">{d.title}</span>
              <span className="block text-xs text-muted">{KIND_LABEL[d.kind]}{d.documentNo ? ` · No. ${d.documentNo}` : ""} · {d.fileName} ({kb(d.fileSize)})</span>
              {d.note && <span className="mt-0.5 block text-xs text-muted">{d.note}</span>}
              {d.decision !== "PENDING" && d.decidedAt && <span className="mt-0.5 block text-xs text-muted">Keputusan oleh {d.decidedBy ?? "—"}, {formatDateTime(d.decidedAt)}{d.decisionNote ? ` · ${d.decisionNote}` : ""}</span>}
              {d.archived && <span className="mt-0.5 block text-xs text-muted">Diarsipkan: {d.archiveReason}</span>}
              <span className="mt-0.5 block text-xs text-muted">Diunggah {d.uploadedBy}, {formatDateTime(d.createdAt)}</span>
            </Td>
            <Td className="min-w-48">
              <span className="block whitespace-nowrap">{d.startDate ? formatDateLong(d.startDate) : "—"}{d.kind === "CONTRACT" && <span className="text-muted"> s.d. {d.endDate ? formatDateLong(d.endDate) : "tanpa batas waktu"}</span>}</span>
              <div className="mt-1.5"><DocumentStatus d={d} /></div>
            </Td>
            <Td align="right">
              <div className="flex flex-col items-end gap-2">
                <PdfViewButton doc={d} />
                {canDecide && !d.archived && !d.renewedById && d.kind === "CONTRACT" && !!d.endDate && (
                  <Button size="sm" variant={d.needsDecision ? "primary" : "secondary"} onClick={() => { setDecision(d.decision === "DISCONTINUE" ? "DISCONTINUE" : "CONTINUE"); setNote(d.decisionNote ?? ""); setAction({ kind: "DECIDE", doc: d }); }}>
                    {d.decision === "PENDING" ? "Putuskan lanjut/tidak" : "Ubah keputusan"}
                  </Button>
                )}
                {canManage && d.needsRenewalUpload && <Button size="sm" variant="primary" onClick={() => setRenewFor(d)}><Upload className="size-3.5" />Unggah perpanjangan</Button>}
                {canManage && !d.archived && <Button size="sm" variant="danger" onClick={() => setAction({ kind: "ARCHIVE", doc: d })} aria-label={`Arsipkan ${d.title}`}><Archive className="size-3.5" />Arsipkan</Button>}
              </div>
            </Td>
          </tr>
        ))}</tbody>
      </Table></TableWrap>

      <Dialog open={!!action} onClose={() => !busy && close()} size="sm"
        title={action?.kind === "DECIDE" ? "Keputusan kontrak: lanjut atau tidak?" : "Arsipkan dokumen"}
        description={action ? `${action.doc.employeeName} · ${action.doc.title}${action.doc.endDate ? ` · berakhir ${formatDateLong(action.doc.endDate)}` : ""}` : undefined}
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant={action?.kind === "ARCHIVE" || decision === "DISCONTINUE" ? "danger" : "primary"} loading={busy} onClick={run}>{action?.kind === "ARCHIVE" ? "Arsipkan" : "Simpan keputusan"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {action?.kind === "DECIDE" && (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-medium text-ink-soft">Keputusan</legend>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="decision" checked={decision === "CONTINUE"} onChange={() => setDecision("CONTINUE")} />Lanjutkan kontrak (HR diminta mengunggah kontrak perpanjangan)</label>
                <label className="flex items-center gap-2 text-sm"><input type="radio" name="decision" checked={decision === "DISCONTINUE"} onChange={() => setDecision("DISCONTINUE")} />Tidak dilanjutkan (kontrak berakhir sesuai tanggalnya)</label>
              </fieldset>
              <Notice tone="info">HR diberi tahu. Karyawan <strong>tidak</strong> diberi tahu otomatis — HR yang menyampaikannya. Pengingat berhenti setelah keputusan dicatat.</Notice>
            </>
          )}
          <TextAreaField label={action?.kind === "ARCHIVE" ? "Alasan pengarsipan (wajib)" : decision === "DISCONTINUE" ? "Alasan tidak melanjutkan (wajib)" : "Catatan (opsional)"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} error={fe.note ?? fe.reason} />
        </div>
      </Dialog>

      {renewFor && (
        <DocumentUpload employees={employees} renewable={renewable}
          prefill={{ employeeId: renewFor.employeeId, renewsDocumentId: renewFor.id, title: `Perpanjangan: ${renewFor.title}`, startDate: renewFor.endDate ?? "" }}
          onClose={() => setRenewFor(null)} />
      )}
    </>
  );
}
