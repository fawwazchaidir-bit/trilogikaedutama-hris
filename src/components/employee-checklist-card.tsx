"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Info, MinusCircle } from "lucide-react";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateLong, formatDateTime } from "@/lib/format";
import { KIND_LABEL, type ChecklistKind } from "@/lib/employee-checklist";
import type { ChecklistDto, ChecklistItemDto } from "@/server/services/employee-checklists";

const SIGNAL_TONE = { OK: "text-green-700", WARN: "text-amber-700", INFO: "text-muted" } as const;
const SignalIcon = ({ state }: { state: "OK" | "WARN" | "INFO" }) => state === "OK" ? <CheckCircle2 className="size-3.5" aria-hidden /> : state === "WARN" ? <AlertTriangle className="size-3.5" aria-hidden /> : <Info className="size-3.5" aria-hidden />;

/**
 * Checklist masuk & berhenti satu karyawan. Sistem memberi SINYAL dari data (mis. "atasan belum ditetapkan") tetapi tidak mencentang sendiri:
 * HR menandai Selesai / Tidak berlaku (beralasan) sehingga siapa dan kapan tercatat. `canManage` = HR / Super Admin.
 */
export function EmployeeChecklistCard({ employeeId, checklists, canManage, isActive }: { employeeId: string; checklists: ChecklistDto[]; canManage: boolean; isActive: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [dlg, setDlg] = useState<null | { kind: "item"; item: ChecklistItemDto; status: "DONE" | "NOT_APPLICABLE" } | { kind: "add"; id: string } | { kind: "cancel"; id: string } | { kind: "complete"; id: string }>(null);
  const [text, setText] = useState({ note: "", title: "", hint: "" });
  const [error, setError] = useState<string | null>(null);
  const openOnes = checklists.filter((c) => c.status === "OPEN");
  const closed = checklists.filter((c) => c.status !== "OPEN");
  const hasOpen = (k: ChecklistKind) => openOnes.some((c) => c.kind === k);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null);
    try { await fn(); toast.success(ok); setDlg(null); setText({ note: "", title: "", hint: "" }); router.refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const start = (kind: ChecklistKind) => run(() => api(`/api/employees/${employeeId}/checklists`, { body: { kind } }), `Checklist "${KIND_LABEL[kind]}" dimulai.`);
  const quick = (it: ChecklistItemDto, status: "TODO" | "DONE") => run(() => api(`/api/employee-checklists/item/${it.id}`, { method: "PATCH", body: { status, note: it.note ?? "" } }), status === "DONE" ? "Butir ditandai selesai." : "Butir dibuka lagi.");

  function submit() {
    if (!dlg) return;
    if (dlg.kind === "item") return run(() => api(`/api/employee-checklists/item/${dlg.item.id}`, { method: "PATCH", body: { status: dlg.status, note: text.note } }), dlg.status === "DONE" ? "Butir ditandai selesai." : "Butir ditandai tidak berlaku.");
    if (dlg.kind === "add") return run(() => api(`/api/employee-checklists/${dlg.id}/items`, { body: { title: text.title, hint: text.hint, required: false } }), "Butir ditambahkan.");
    if (dlg.kind === "cancel") return run(() => api(`/api/employee-checklists/${dlg.id}/cancel`, { body: { reason: text.note } }), "Checklist dibatalkan.");
    return run(() => api(`/api/employee-checklists/${dlg.id}/complete`, { body: { note: text.note } }), "Checklist diselesaikan.");
  }

  function list(c: ChecklistDto) {
    const groups = [...new Set(c.items.map((i) => i.group))];
    const readOnly = c.status !== "OPEN" || !canManage;
    return (
      <div key={c.id} className="border-t border-line px-5 py-4 first:border-t-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{KIND_LABEL[c.kind]}</h3>
            {c.status === "OPEN" ? <Badge tone={c.overdue ? "red" : "amber"}>{c.overdue ? "Terlambat" : "Berjalan"}</Badge> : c.status === "COMPLETED" ? <Badge tone="green">Selesai</Badge> : <Badge>Dibatalkan</Badge>}
            <span className="text-xs text-muted">{c.progress.done + c.progress.notApplicable}/{c.progress.total} butir{c.targetDate ? ` · target ${formatDateLong(c.targetDate)}` : ""} · dimulai {formatDateTime(c.startedAt)} oleh {c.startedBy}</span>
          </div>
          {c.status === "OPEN" && canManage && (
            <div className="flex gap-2">
              <Button onClick={() => { setError(null); setDlg({ kind: "add", id: c.id }); }}>Tambah butir</Button>
              <Button onClick={() => { setError(null); setDlg({ kind: "cancel", id: c.id }); }}>Batalkan</Button>
              <Button variant="primary" onClick={() => { setError(null); setDlg({ kind: "complete", id: c.id }); }} disabled={c.progress.requiredLeft > 0} title={c.progress.requiredLeft > 0 ? `${c.progress.requiredLeft} butir wajib belum diselesaikan` : undefined}>Selesaikan proses</Button>
            </div>
          )}
        </div>
        {c.status === "COMPLETED" && <p className="mt-1 text-xs text-muted">Diselesaikan {formatDateTime(c.completedAt)} oleh {c.completedBy}{c.note ? ` · ${c.note}` : ""}</p>}
        {c.status === "CANCELLED" && <p className="mt-1 text-xs text-muted">Alasan pembatalan: {c.cancelReason}</p>}
        <div className="mt-3 space-y-4">
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g}</p>
              <ul className="divide-y divide-line rounded-md border border-line">
                {c.items.filter((i) => i.group === g).map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="flex min-w-0 flex-1 gap-2.5">
                      {i.status === "DONE" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" aria-label="Selesai" /> : i.status === "NOT_APPLICABLE" ? <MinusCircle className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Tidak berlaku" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Belum" />}
                      <div className="min-w-0">
                        <p className={i.status === "TODO" ? "font-medium" : "font-medium text-muted"}>{i.title}{!i.required && <span className="ml-2 text-xs font-normal text-muted">(opsional)</span>}</p>
                        {i.hint && i.status === "TODO" && <p className="text-xs text-muted">{i.hint}</p>}
                        {i.signal && i.status === "TODO" && <p className={`mt-0.5 flex items-start gap-1 text-xs ${SIGNAL_TONE[i.signal.state]}`}><span className="mt-0.5"><SignalIcon state={i.signal.state} /></span><span>{i.signal.text}</span></p>}
                        {i.status !== "TODO" && <p className="text-xs text-muted">{i.status === "DONE" ? "Selesai" : "Tidak berlaku"} · {i.doneBy} · {formatDateTime(i.doneAt)}{i.note ? ` · ${i.note}` : ""}</p>}
                      </div>
                    </div>
                    {!readOnly && (
                      <div className="flex shrink-0 gap-2">
                        {i.status === "TODO" ? (<>
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => quick(i, "DONE")} aria-label={`Tandai selesai: ${i.title}`}>Selesai</Button>
                          <Button size="sm" disabled={busy} onClick={() => { setError(null); setText({ ...text, note: "" }); setDlg({ kind: "item", item: i, status: "NOT_APPLICABLE" }); }} aria-label={`Tidak berlaku: ${i.title}`}>Tidak berlaku</Button>
                          <Button size="sm" disabled={busy} onClick={() => { setError(null); setText({ ...text, note: i.note ?? "" }); setDlg({ kind: "item", item: i, status: "DONE" }); }} aria-label={`Selesai dengan catatan: ${i.title}`}>+ Catatan</Button>
                        </>) : <Button size="sm" disabled={busy} onClick={() => quick(i, "TODO")} aria-label={`Buka lagi: ${i.title}`}>Buka lagi</Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const titleOf = !dlg ? "" : dlg.kind === "item" ? (dlg.status === "DONE" ? "Selesai dengan catatan" : "Tandai tidak berlaku") : dlg.kind === "add" ? "Tambah butir" : dlg.kind === "cancel" ? "Batalkan checklist" : "Selesaikan proses";
  return (
    <Card>
      <CardHeader title="Checklist masuk & berhenti" description="Daftar centang agar proses tidak bergantung pada ingatan satu orang. Sinyal dari data sistem hanya petunjuk; keputusan selesai tetap dicatat HR."
        actions={canManage ? (
          <div className="flex gap-2">
            {isActive && !hasOpen("ONBOARDING") && <Button onClick={() => start("ONBOARDING")} loading={busy}>Mulai checklist masuk</Button>}
            {!hasOpen("OFFBOARDING") && <Button onClick={() => start("OFFBOARDING")} loading={busy}>Mulai checklist berhenti</Button>}
          </div>
        ) : undefined} />
      {error && !dlg && <div className="px-5 pb-3"><Notice tone="danger">{error}</Notice></div>}
      {openOnes.length === 0 && closed.length === 0 && <p className="px-5 pb-5 text-sm text-muted">Belum ada checklist. Checklist masuk dimulai otomatis untuk karyawan baru, dan checklist berhenti saat karyawan dinonaktifkan.</p>}
      {openOnes.map(list)}
      {closed.length > 0 && (
        <details className="border-t border-line px-5 py-3 text-sm"><summary className="cursor-pointer font-medium text-muted">Riwayat checklist ({closed.length})</summary><div className="-mx-5 mt-2">{closed.map(list)}</div></details>
      )}
      <Dialog open={!!dlg} onClose={() => !busy && setDlg(null)} size="md" title={titleOf}
        description={dlg?.kind === "item" ? dlg.item.title : dlg?.kind === "complete" ? "Semua butir wajib harus Selesai atau Tidak berlaku. Setelah diselesaikan, checklist terkunci." : undefined}
        footer={<><Button onClick={() => setDlg(null)} disabled={busy}>Batal</Button><Button variant={dlg?.kind === "cancel" ? "danger" : "primary"} loading={busy} onClick={submit}>{dlg?.kind === "cancel" ? "Batalkan checklist" : dlg?.kind === "complete" ? "Selesaikan" : "Simpan"}</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {dlg?.kind === "add" ? (<>
            <TextField label="Butir" required value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} placeholder="Mis. Serahkan seragam kerja" />
            <TextAreaField label="Keterangan (opsional)" rows={2} value={text.hint} onChange={(e) => setText({ ...text, hint: e.target.value })} />
          </>) : (
            <TextAreaField label={dlg?.kind === "cancel" ? "Alasan pembatalan (wajib)" : dlg?.kind === "item" && dlg.status === "NOT_APPLICABLE" ? "Alasan tidak berlaku (wajib)" : "Catatan (opsional)"} rows={3} value={text.note} onChange={(e) => setText({ ...text, note: e.target.value })}
              placeholder={dlg?.kind === "item" && dlg.item.key === "assets" ? "Mis. laptop & kartu akses dikembalikan 5/11" : dlg?.kind === "item" && dlg.item.key === "orientation" ? "Mis. orientasi 3 hari, pelatihan keselamatan kerja" : undefined} />
          )}
        </div>
      </Dialog>
    </Card>
  );
}
