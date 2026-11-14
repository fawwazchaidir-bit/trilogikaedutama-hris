"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import { Paper } from "./paper";
import { CheckCircle2, Clock, Download, Eye, FileText, Loader2, Send, Undo2, XCircle, Ban, PencilLine, PenLine, Plus, Trash2, Lock, FileUp, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { documentExtensions } from "@/lib/documents/editor-extensions";
import { normalizeDoc, type PmDoc } from "@/lib/documents/content";
import { hasRecipientBlock, LETTER_SERIES_LABEL, type LetterStatus } from "@/lib/documents/policy";
import type { LetterDetailDto, SignatoryDto } from "@/server/services/letters/documents";
import { EditorToolbar } from "./editor-toolbar";
import { AttachmentEditor } from "./attachment-editor";
import { AttachmentsPanel } from "./attachments-panel";
import { AssignmentDialog } from "./assignment-dialog";
import type { AttachmentDto } from "@/server/services/letters/attachments";

const TONE: Record<LetterStatus, "gray" | "amber" | "green" | "red" | "blue"> = { DRAFT: "gray", IN_REVIEW: "amber", RETURNED: "blue", ISSUED: "green", REJECTED: "red", CANCELLED: "red" };
const ACTION_LABEL: Record<string, string> = {
  CREATED: "Draf dibuat", COSIGNED: "Penandatangan tambahan menandatangani", SUBMITTED: "Diajukan ke penandatangan", WITHDRAWN: "Ditarik kembali", RETURNED: "Dikembalikan untuk revisi", REJECTED: "Ditolak", ISSUED: "Disetujui & diterbitkan", CANCELLED: "Dibatalkan",
  TAKEOVER_ISSUED: "Diambil alih Direktur & diterbitkan", TAKEOVER_RETURNED: "Diambil alih Direktur & dikembalikan", TAKEOVER_REJECTED: "Diambil alih Direktur & ditolak",
};
const fmt = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

type Signer = { userId: string; name: string; title: string | null; division?: string | null };
type Meta = { subject: string; recipientLines: string; recipientPlace: string; attachmentCount: string; attachmentUnit: string; salutation: string; closing: string; cc: string; signerId: string };
const toMeta = (d: LetterDetailDto): Meta => ({
  subject: d.subject, recipientLines: d.recipientLines.join("\n"), recipientPlace: d.recipientPlace ?? "", attachmentCount: d.attachmentCount ? String(d.attachmentCount) : "", attachmentUnit: d.attachmentUnit ?? "halaman",
  salutation: d.salutation ?? "", closing: d.closing ?? "", cc: d.cc.join("\n"), signerId: d.signerId ?? "",
});
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

type SigRow = { kind: "INTERNAL" | "EXTERNAL"; userId: string; name: string; title: string; org: string };
const toSigRows = (list: SignatoryDto[]): SigRow[] => list.map((s) => ({ kind: s.kind, userId: s.userId ?? "", name: s.kind === "EXTERNAL" ? s.name : "", title: s.kind === "EXTERNAL" ? s.title ?? "" : "", org: s.org ?? "" }));

export function LetterEditor({ initial, signers, people, employees = [], me }: { initial: LetterDetailDto; signers: Signer[]; people: Signer[]; employees?: { id: string; employeeNo: string; fullName: string }[]; me?: { employeeId: string | null; isSuper: boolean; canManage?: boolean } }) {
  const router = useRouter();
  const toast = useToast();
  const [d, setD] = useState(initial);
  const [meta, setMeta] = useState<Meta>(() => toMeta(initial));
  const [sigs, setSigs] = useState<SigRow[]>(() => toSigRows(initial.signatories));
  const sigsDirty = useRef(false);
  const sigsRef = useRef(sigs);
  const [save, setSave] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [tab, setTab] = useState<string>(initial.archiveOnly ? "arsip" : initial.can.edit ? "edit" : "pdf");
  const [atts, setAtts] = useState<AttachmentDto[]>(initial.attachments);
  const [side, setSide] = useState<"data" | "riwayat">("data");
  const [pdfKey, setPdfKey] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "return" | "reject" | "cancel">(null);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editable = d.can.edit;
  const dirtyBody = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metaRef = useRef(meta);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const persistRef = useRef<() => Promise<boolean>>(async () => false);

  const schedule = useCallback(() => {
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void persistRef.current(); }, 1500);
  }, []);

  const editor = useEditor({
    extensions: documentExtensions, content: initial.body, editable: initial.can.edit && initial.kind !== "TUGAS", immediatelyRender: false,
    editorProps: { attributes: { "aria-label": "Isi surat", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor: e }) => { if (!e.isEditable) return; dirtyBody.current = true; schedule(); },
  });
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => { metaRef.current = meta; }, [meta]);
  useEffect(() => { sigsRef.current = sigs; }, [sigs]);

  const persist = useCallback(async (): Promise<boolean> => {
    const m = metaRef.current; const ed = editorRef.current;
    setSave("saving");
    try {
      const body: Record<string, unknown> = {
        ...(initial.kind === "TUGAS" ? {} : { subject: m.subject }), recipientLines: lines(m.recipientLines), recipientPlace: m.recipientPlace || null, attachmentCount: m.attachmentCount ? Number(m.attachmentCount) : null,
        attachmentUnit: m.attachmentCount ? m.attachmentUnit : null, salutation: m.salutation || null, closing: m.closing || null, cc: lines(m.cc), signerId: m.signerId || null,
      };
      if (dirtyBody.current && ed) body.body = normalizeDoc(ed.getJSON() as PmDoc);
      if (sigsDirty.current) body.signatories = sigsRef.current.map((s) => (s.kind === "INTERNAL" ? { kind: s.kind, userId: s.userId || null } : { kind: s.kind, name: s.name, title: s.title || null, org: s.org || null }));
      const next = await api<LetterDetailDto>(`/api/letters/${initial.id}`, { method: "PATCH", body });
      dirtyBody.current = false; sigsDirty.current = false; setD(next); setErrors({}); setSave("saved"); setPdfKey((k) => k + 1);
      return true;
    } catch (e) {
      setSave("error"); setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}); toast.error(errorMessage(e)); return false;
    }
  }, [initial.id, initial.kind, toast]);

  useEffect(() => { persistRef.current = persist; }, [persist]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { editor?.setEditable(editable && d.kind !== "TUGAS", false); }, [editor, editable, d.kind]);
  const set = (k: keyof Meta) => (e: { target: { value: string } }) => { setMeta((m) => ({ ...m, [k]: e.target.value })); if (editable) schedule(); };

  async function act(kind: "submit" | "withdraw" | "approve" | "return" | "reject" | "cancel" | "cosign", withNote = false) {
    setBusy(kind);
    try {
      if (editable && (save === "dirty" || kind === "submit")) { if (timer.current) clearTimeout(timer.current); if (!(await persist())) return; }
      const next = await api<LetterDetailDto>(`/api/letters/${initial.id}/${kind}`, { method: "POST", body: withNote ? { note } : undefined });
      setD(next); setMeta(toMeta(next)); setSigs(toSigRows(next.signatories)); setAtts(next.attachments); setDialog(null); setNote(""); setPdfKey((k) => k + 1);
      editor?.commands.setContent(next.body, { emitUpdate: false });
      setTab(next.archiveOnly ? "arsip" : next.can.edit ? "edit" : "pdf");
      toast.success({ submit: "Surat diajukan ke penandatangan.", withdraw: "Surat ditarik kembali ke draf.", approve: `Surat terbit dengan nomor ${next.number}.`, return: "Surat dikembalikan ke pembuat.", reject: "Surat ditolak.", cancel: "Surat dibatalkan.", cosign: "Tanda tangan Anda tercatat." }[kind]);
      router.refresh();
    } catch (e) {
      const fe = (e as { fieldErrors?: Record<string, string> }).fieldErrors; if (fe) setErrors(fe);
      toast.error(errorMessage(e));
    } finally { setBusy(null); }
  }

  const numberText = d.number ?? "Nomor diberikan saat disetujui";
  const pdfUrl = `/api/letters/${d.id}/pdf?v=${pdfKey}`;
  const signerName = useMemo(() => signers.find((s) => s.userId === meta.signerId)?.name ?? d.signerName, [signers, meta.signerId, d.signerName]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-white px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><FileText className="size-4 text-brand-600" aria-hidden /><h2 className="truncate text-base font-semibold text-ink">{d.typeName}</h2><Badge tone={TONE[d.status]}>{d.statusLabel}</Badge></div>
          <p className="mt-0.5 text-xs text-muted"><span className="font-mono text-ink-soft">{numberText}</span> · {LETTER_SERIES_LABEL[d.series]} · dibuat oleh {d.creatorName}{signerName ? ` · penandatangan ${signerName}` : ""}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {editable && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status" aria-live="polite">
              {save === "saving" ? <><Loader2 className="size-3.5 animate-spin" />Menyimpan…</> : save === "dirty" ? <><Clock className="size-3.5" />Perubahan belum tersimpan</> : save === "error" ? <span className="text-brand-700">Gagal menyimpan</span> : <><CheckCircle2 className="size-3.5 text-emerald-600" />Tersimpan otomatis</>}
            </span>
          )}
          {d.can.submit && <Button variant="primary" loading={busy === "submit"} onClick={() => void act("submit")}><Send className="size-4" />Ajukan ke penandatangan</Button>}
          {d.can.cosign && <Button variant="primary" loading={busy === "cosign"} onClick={() => void act("cosign")}><PenLine className="size-4" />Tandatangani bagian saya</Button>}
          {d.can.withdraw && <Button loading={busy === "withdraw"} onClick={() => void act("withdraw")}><Undo2 className="size-4" />Tarik kembali</Button>}
          {d.can.review && <>
            <Button variant="primary" loading={busy === "approve"} onClick={() => void act("approve")}><CheckCircle2 className="size-4" />{d.can.takeOver ? "Ambil alih & terbitkan" : "Setujui & terbitkan"}</Button>
            <Button onClick={() => { setNote(""); setDialog("return"); }}><PencilLine className="size-4" />Kembalikan</Button>
            <Button variant="danger" onClick={() => { setNote(""); setDialog("reject"); }}><XCircle className="size-4" />Tolak</Button>
          </>}
          {d.status === "ISSUED" && <a href={`/api/letters/${d.id}/pdf`} download className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas"><Download className="size-4" />Unduh PDF</a>}
          {d.can.cancel && <Button variant="danger" onClick={() => { setNote(""); setDialog("cancel"); }}><Ban className="size-4" />Batalkan</Button>}
        </div>
      </div>

      {d.status === "RETURNED" && d.returnNote && <Notice tone="warn"><strong>Dikembalikan:</strong> {d.returnNote}</Notice>}
      {d.status === "REJECTED" && d.rejectNote && <Notice tone="danger"><strong>Ditolak:</strong> {d.rejectNote}</Notice>}
      {d.status === "CANCELLED" && (
        <Notice tone="danger">
          <div className="space-y-1" data-testid="cancelled-notice">
            <p>{d.cancelNote ? <><strong>Dibatalkan:</strong> {d.cancelNote}</> : <strong>Surat ini DIBATALKAN.</strong>}</p>
            <p className="text-xs">PDF yang tampil dan diunduh di sini adalah <strong>salinan status bertanda DIBATALKAN</strong>. PDF asli tetap tersimpan sebagai arsip{d.hasPdf ? <> — <a className="font-medium underline" href={`/api/letters/${d.id}/pdf?asli=1`} download>unduh arsip asli</a> (pengambilannya tercatat)</> : null}. PDF yang sudah terlanjur dikirim <strong>tidak ikut berubah</strong>: beritahukan pembatalan ini kepada penerima sesuai prosedur Trilogika.</p>
          </div>
        </Notice>
      )}
      {d.can.takeOver && <Notice tone="info">Surat ini sudah menunggu penandatangan lebih dari batas eskalasi. Sebagai Direktur Anda dapat mengambil alih.</Notice>}
      {Object.keys(errors).length > 0 && <Notice tone="danger">{Object.values(errors).join(" · ")}</Notice>}

      <div className="grid gap-3 lg:grid-cols-[19rem_1fr]">
        <aside className="rounded-xl border border-line bg-white" aria-label="Data surat">
          <div className="flex border-b border-line text-sm" role="tablist">
            {(["data", "riwayat"] as const).map((t) => <button key={t} role="tab" aria-selected={side === t} onClick={() => setSide(t)} className={`flex-1 px-3 py-2 font-medium ${side === t ? "border-b-2 border-brand-600 text-brand-700" : "text-muted"}`}>{t === "data" ? "Data surat" : "Riwayat"}</button>)}
          </div>
          {side === "data" ? (
            <div className="space-y-3 p-3">
              <SelectField label="Penandatangan" value={meta.signerId} onChange={set("signerId")} disabled={!editable} error={errors.signerId} hint="Pilih satu orang yang berwenang menandatangani jenis surat ini (menurut jabatan & divisi). Direktur dapat mengambil alih bila perlu.">
                <option value="">— pilih —</option>
                {signers.map((s) => <option key={s.userId} value={s.userId}>{s.name}{s.title ? ` · ${s.title}` : ""}{s.division ? ` · ${s.division}` : ""}</option>)}
                {meta.signerId && !signers.some((s) => s.userId === meta.signerId) && <option value={meta.signerId}>{d.signerName}</option>}
              </SelectField>
              {d.kind === "TUGAS" && <AssignmentDialog letterId={d.id} current={d.assignment} employees={employees} editable={editable} selfEmployeeId={me?.employeeId ?? null} isSuper={!!me?.isSuper} onSaved={(n) => { setD(n); setMeta((m) => ({ ...m, subject: n.subject })); editor?.commands.setContent(n.body, { emitUpdate: false }); setPdfKey((k) => k + 1); setErrors({}); }} />}
              {d.kind === "TUGAS" && d.assignmentId && me?.canManage && <Link href={`/persuratan/surat-tugas?q=${encodeURIComponent(d.number ?? "")}`} className="block rounded-md bg-emerald-50 p-2 text-xs font-medium text-emerald-900 hover:underline">Kelola Uang Harian & Bukti Penerimaan →</Link>}
              {(d.kind === "SURAT" || d.kind === "EDARAN") && <>
                <TextField label="Perihal" value={meta.subject} onChange={set("subject")} disabled={!editable} error={errors.subject} maxLength={300}
                  hint={d.kind === "EDARAN" ? "Dicetak huruf besar sebagai judul \"TENTANG\" pada surat dan tampil di daftar surat." : undefined} />
                {!d.archiveOnly && <>
                {hasRecipientBlock(d.kind) && <>
                <TextAreaField label="Penerima (satu baris per baris)" rows={3} value={meta.recipientLines} onChange={set("recipientLines")} disabled={!editable} error={errors.recipientLines} hint="Dua baris pertama dicetak tebal." />
                <TextField label="Tempat penerima" value={meta.recipientPlace} onChange={set("recipientPlace")} disabled={!editable} placeholder="Tempat" />
                <div className="grid grid-cols-[5rem_1fr] gap-2">
                  <TextField label="Lampiran" type="number" min={0} max={99} value={meta.attachmentCount} onChange={set("attachmentCount")} disabled={!editable} />
                  <SelectField label="Satuan" value={meta.attachmentUnit} onChange={set("attachmentUnit")} disabled={!editable || !meta.attachmentCount}><option>halaman</option><option>berkas</option><option>lembar</option></SelectField>
                </div>
                <TextField label="Salam pembuka" value={meta.salutation} onChange={set("salutation")} disabled={!editable} />
                <TextField label="Kalimat penutup (opsional)" value={meta.closing} onChange={set("closing")} disabled={!editable} />
                </>}
                <TextAreaField label="Tembusan (satu per baris)" rows={2} value={meta.cc} onChange={set("cc")} disabled={!editable} />
                </>}
              </>}
              {!d.archiveOnly && <AttachmentsPanel letterId={d.id} items={atts} editable={editable} onChange={(l) => { setAtts(l); setPdfKey((k) => k + 1); }} onOpen={(id) => setTab(`att:${id}`)} />}
              {d.multiSigner && (
                <fieldset className="space-y-2 rounded-lg border border-line p-2.5">
                  <legend className="px-1 text-xs font-semibold text-ink-soft">Penandatangan tambahan</legend>
                  {sigs.length === 0 && <p className="text-xs text-muted">Belum ada. Tambahkan pihak internal yang wajib menandatangani, atau slot kosong untuk tanda tangan basah mitra luar.</p>}
                  {sigs.map((sg, i) => {
                    const st = d.signatories[i];
                    const upd = (patch: Partial<SigRow>) => { setSigs((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x))); sigsDirty.current = true; if (editable) schedule(); };
                    return (
                      <div key={i} className="space-y-1.5 rounded-md bg-canvas p-2">
                        <div className="flex items-center gap-1.5">
                          <select aria-label={`Jenis penandatangan ${i + 1}`} disabled={!editable} value={sg.kind} onChange={(e) => upd({ kind: e.target.value as SigRow["kind"] })} className="h-8 flex-1 rounded-md border border-line bg-white px-2 text-sm">
                            <option value="INTERNAL">Internal (akun portal)</option><option value="EXTERNAL">Mitra luar (tanda tangan basah)</option>
                          </select>
                          {editable && <button type="button" aria-label={`Hapus penandatangan ${i + 1}`} onClick={() => { setSigs((l) => l.filter((_, k) => k !== i)); sigsDirty.current = true; schedule(); }} className="rounded-md p-1.5 text-muted hover:bg-black/5"><Trash2 className="size-4" /></button>}
                        </div>
                        {sg.kind === "INTERNAL" ? (
                          <select aria-label={`Akun penandatangan ${i + 1}`} disabled={!editable} value={sg.userId} onChange={(e) => upd({ userId: e.target.value })} className="h-8 w-full rounded-md border border-line bg-white px-2 text-sm">
                            <option value="">— pilih orang —</option>
                            {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}{p.title ? ` · ${p.title}` : ""}</option>)}
                          </select>
                        ) : (
                          <div className="grid gap-1.5">
                            <input aria-label={`Nama mitra ${i + 1}`} disabled={!editable} value={sg.name} onChange={(e) => upd({ name: e.target.value })} placeholder="Nama penandatangan" className="h-8 rounded-md border border-line bg-white px-2 text-sm" />
                            <input aria-label={`Jabatan mitra ${i + 1}`} disabled={!editable} value={sg.title} onChange={(e) => upd({ title: e.target.value })} placeholder="Jabatan" className="h-8 rounded-md border border-line bg-white px-2 text-sm" />
                            <input aria-label={`Lembaga mitra ${i + 1}`} disabled={!editable} value={sg.org} onChange={(e) => upd({ org: e.target.value })} placeholder="Lembaga / perusahaan" className="h-8 rounded-md border border-line bg-white px-2 text-sm" />
                          </div>
                        )}
                        {st && st.kind === "INTERNAL" && d.status === "IN_REVIEW" && <p className={`text-xs ${st.signedAt ? "text-emerald-700" : "text-amber-700"}`}>{st.signedAt ? `Sudah menandatangani · ${fmt(st.signedAt)}` : "Menunggu tanda tangan"}</p>}
                      </div>
                    );
                  })}
                  {editable && sigs.length < 6 && <Button size="sm" onClick={() => { setSigs((l) => [...l, { kind: "INTERNAL", userId: "", name: "", title: "", org: "" }]); sigsDirty.current = true; }}><Plus className="size-3.5" />Tambah penandatangan</Button>}
                  {errors.signatories && <p className="text-xs text-brand-700">{errors.signatories}</p>}
                </fieldset>
              )}
              {d.confidential && <p className="flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-900"><Lock className="mt-0.5 size-3.5 shrink-0" />Surat Rahasia: hanya pembuat, penandatangan, dan Direktur{d.typeName.includes("keterangan kerja") ? " (serta HR)" : ""} yang dapat membukanya. Tulis perihal tanpa nama karyawan.</p>}
              {d.kind === "SK" && <p className="text-xs text-muted">Judul, konsiderans, dan diktum SK disusun langsung pada kertas. Gunakan <code>{"{{nomor}}"}</code> bila nomor perlu muncul di judul.</p>}
              {d.kind === "EDARAN" && <p className="text-xs text-muted">Judul, Nomor, dan TENTANG disusun langsung pada kertas. <code>{"{{nomor}}"}</code> diisi saat terbit dan <code>{"{{perihal}}"}</code> diambil dari kolom Perihal. Surat edaran tidak memakai penerima, salam, dan tanggal.</p>}
            </div>
          ) : (
            <ol className="space-y-3 p-3 text-sm">
              {d.events.map((e) => (
                <li key={e.id} className="border-l-2 border-brand-200 pl-3">
                  <p className="font-medium text-ink">{ACTION_LABEL[e.action] ?? e.action}{e.action.includes("ISSUED") && e.note ? ` · ${e.note}` : ""}</p>
                  <p className="text-xs text-muted">{e.actorName} · {fmt(e.at)}</p>
                  {e.note && !e.action.includes("ISSUED") && <p className="mt-0.5 text-xs text-ink-soft">“{e.note}”</p>}
                </li>
              ))}
            </ol>
          )}
        </aside>

        <section className="min-w-0 rounded-xl border border-line bg-[#ececea]" aria-label="Isi surat">
          <div className="flex items-center gap-1 border-b border-line bg-white px-3 py-1.5" role="tablist">
            {d.archiveOnly && <button role="tab" aria-selected={tab === "arsip"} onClick={() => setTab("arsip")} className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "arsip" ? "bg-brand-100 text-brand-700" : "text-muted"}`}><FileUp className="mr-1 inline size-3.5" />Surat arsip</button>}
            {!d.archiveOnly && <button role="tab" aria-selected={tab === "edit"} onClick={() => setTab("edit")} className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "edit" ? "bg-brand-100 text-brand-700" : "text-muted"}`}><PencilLine className="mr-1 inline size-3.5" />{editable ? "Editor" : "Isi"}</button>}
            {atts.filter((a) => a.kind === "EDITOR").map((a) => <button key={a.id} role="tab" aria-selected={tab === `att:${a.id}`} onClick={() => setTab(`att:${a.id}`)} className={`max-w-40 truncate rounded-md px-3 py-1 text-sm font-medium ${tab === `att:${a.id}` ? "bg-brand-100 text-brand-700" : "text-muted"}`}><Paperclip className="mr-1 inline size-3.5" />{a.title}</button>)}
            {!d.archiveOnly && <button role="tab" aria-selected={tab === "pdf"} onClick={() => { setTab("pdf"); if (editable && save === "dirty") { if (timer.current) clearTimeout(timer.current); void persist(); } }} className={`rounded-md px-3 py-1 text-sm font-medium ${tab === "pdf" ? "bg-brand-100 text-brand-700" : "text-muted"}`}><Eye className="mr-1 inline size-3.5" />{d.status === "ISSUED" || d.status === "CANCELLED" ? "PDF terbit" : "Pratinjau PDF"}</button>}
            {tab === "pdf" && !d.number && <span className="ml-2 text-xs text-muted">Pratinjau berwatermark DRAF; nomor & QR muncul setelah disetujui.</span>}
          </div>
          <div className={tab === "edit" && !d.archiveOnly ? "block" : "hidden"}>
            {editor && editable && d.kind !== "TUGAS" && <EditorToolbar editor={editor} />}
            {editable && d.kind === "TUGAS" && <p className="border-b border-line bg-brand-50 px-4 py-1.5 text-xs text-brand-800">Isi Surat Tugas dibangkitkan otomatis dari <b>Data penugasan</b> (panel kiri). Ubah datanya, bukan isinya.</p>}
            {editable && d.kind !== "TUGAS" && <p className="border-b border-line bg-brand-50 px-4 py-1.5 text-xs text-brand-800">Kop surat, nomor, penerima, salam, blok tanda tangan + cap, dan QR verifikasi disusun otomatis — lihat tab <b>Pratinjau PDF</b>. Di sini Anda menyunting isi surat saja.</p>}
            <div className="max-h-[calc(100vh-18rem)] overflow-auto p-4 sm:p-6">
              <Paper layout={d.kind === "EDARAN" ? "edaran" : "default"}>
                <EditorContent editor={editor} />
              </Paper>
            </div>
          </div>
          {atts.filter((a) => a.kind === "EDITOR").map((a) => tab === `att:${a.id}` && <AttachmentEditor key={a.id} letterId={d.id} att={a} editable={editable} onSaved={(n) => { setAtts((l) => l.map((x) => (x.id === n.id ? n : x))); setPdfKey((k) => k + 1); }} />)}
          {tab === "arsip" && <ArchivePanel d={d} onDone={(n) => { setD(n); setPdfKey((k) => k + 1); router.refresh(); }} />}
          {tab === "pdf" && !d.archiveOnly && <iframe key={pdfKey} title="Pratinjau PDF surat" src={pdfUrl} className="h-[calc(100vh-14rem)] min-h-[32rem] w-full bg-white" />}
        </section>
      </div>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} size="sm"
        title={dialog === "return" ? "Kembalikan untuk revisi" : dialog === "reject" ? "Tolak surat" : "Batalkan surat terbit"}
        description={dialog === "cancel" ? "Nomor tetap tercatat dan halaman verifikasi akan menampilkan status Dibatalkan (alasan tidak ditampilkan di halaman publik). Unduhan baru diberi tanda DIBATALKAN, tetapi PDF yang sudah terlanjur dikirim tidak berubah — beritahukan pembatalan kepada penerima sesuai prosedur Trilogika." : dialog === "reject" ? "Penolakan bersifat final; pembuat dapat membuat surat baru." : "Pembuat akan menyunting dan mengajukan ulang."}
        footer={<><Button onClick={() => setDialog(null)}>Batal</Button><Button variant="primary" disabled={note.trim().length < 3} loading={busy === dialog} onClick={() => dialog && void act(dialog, true)}>Kirim</Button></>}>
        <TextAreaField label="Catatan / alasan" rows={4} value={note} onChange={(e) => setNote(e.target.value)} required />
      </Dialog>
    </div>
  );
}

/** Panel surat arsip-saja: nomor dari mesin; unggah PDF pindaian (tanda tangan basah) sekali setelah terbit. */
function ArchivePanel({ d, onDone }: { d: LetterDetailDto; onDone: (n: LetterDetailDto) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function upload(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try { const form = new FormData(); form.set("file", f); onDone(await api<LetterDetailDto>(`/api/letters/${d.id}/archive`, { method: "POST", form })); toast.success("PDF pindaian terpasang dan terkunci."); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-3 bg-white p-6 text-sm">
      <h3 className="text-base font-semibold text-ink">Surat dibuat di luar portal (arsip saja)</h3>
      <p className="text-ink-soft">Portal hanya memberi <b>nomor resmi</b> dan mencatat surat ini. Susun dan tanda tangani surat di luar portal (mis. Word + tanda tangan basah), cantumkan nomor di surat, lalu unggah hasil pindaiannya di sini.</p>
      <ol className="list-decimal space-y-1 pl-5 text-ink-soft">
        <li className={d.status === "DRAFT" || d.status === "RETURNED" ? "font-medium text-ink" : ""}>Isi perihal & penandatangan di panel kiri, lalu ajukan.</li>
        <li className={d.status === "IN_REVIEW" ? "font-medium text-ink" : ""}>Penandatangan menyetujui → nomor diterbitkan.</li>
        <li className={d.status === "ISSUED" && !d.hasPdf ? "font-medium text-ink" : ""}>Cetak dengan nomor tersebut, tanda tangani, pindai, unggah PDF.</li>
      </ol>
      {d.number && <p className="rounded-md bg-emerald-50 p-3 text-emerald-900">Nomor surat: <b className="font-mono">{d.number}</b></p>}
      {d.can.uploadArchive && (
        <label className="block"><span className="mb-1 block font-medium text-ink">Unggah PDF pindaian (sekali pasang)</span>
          <input type="file" accept="application/pdf" aria-label="Unggah PDF pindaian" disabled={busy} onChange={(e) => void upload(e.target.files?.[0])} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5" /></label>
      )}
      {d.status === "ISSUED" && d.hasPdf && <a href={`/api/letters/${d.id}/pdf`} download className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 font-medium shadow-sm hover:bg-canvas">Unduh PDF pindaian</a>}
    </div>
  );
}
