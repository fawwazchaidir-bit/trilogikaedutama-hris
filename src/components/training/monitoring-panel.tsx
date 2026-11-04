"use client";
import { useState } from "react";
import { Check, Plus, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { COMPONENT_LABEL, ITEM_COMPONENTS } from "@/lib/training/indicators/config";
import type { ProgramIndicatorDto } from "@/server/services/training/indicator-compute";
import type { MilestoneDto, ReadinessItemDto, WorkloadTaskDto } from "@/server/services/training/indicator-data";
import type { RecoveryNoteDto } from "@/server/services/training/recovery";
import { RECOVERY_KINDS, RECOVERY_KIND_LABEL, type RecoveryKind } from "@/lib/training/indicators/escalation";
import { IndicatorTiles } from "./indicator-ui";
import { useRunner } from "./use-runner";

interface Props {
  recovery: RecoveryNoteDto[]; canWriteRecovery: boolean;
  projectId: string; indicators: ProgramIndicatorDto; milestones: MilestoneDto[]; items: ReadinessItemDto[]; workload: WorkloadTaskDto[];
  employees: { id: string; name: string }[];
  /** Kemampuan pada proyek ini (dari server; penegakan tetap di server). */
  canUpdate: boolean; canManageTasks: boolean; canManageChecklist: boolean; editable: boolean;
  /** Boleh melihat nama staf pada baris jam kerja (hanya yang melihat semua proyek atau mengelola tugas). */
  canSeeWorkload: boolean;
}

const dueText = (due: string | null) => (due ? formatDateShort(due) : "Belum dapat dihitung");

export function MonitoringPanel(p: Props) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const live = p.editable;
  const [finish, setFinish] = useState<MilestoneDto | null>(null);
  const [evidence, setEvidence] = useState("");
  const [doneAt, setDoneAt] = useState("");
  const [reopen, setReopen] = useState<MilestoneDto | null>(null);
  const [reason, setReason] = useState("");
  const [addWork, setAddWork] = useState(false);
  const [w, setW] = useState({ employeeId: "", name: "", hours: "", startDate: "", endDate: "" });
  const [rec, setRec] = useState<{ kind: RecoveryKind; body: string; newDate: string }>({ kind: "YELLOW_STREAK", body: "", newDate: "" });

  const applied = p.indicators.applied;
  const byComponent = ITEM_COMPONENTS.map((c) => ({ c, rows: p.items.filter((i) => i.component === c) })).filter((g) => g.rows.length > 0);

  return (
    <div className="space-y-8">
      {error && !finish && !reopen && !addWork && <Notice tone="danger">{error}</Notice>}
      <IndicatorTiles ind={p.indicators} />

      {!applied ? (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-sm text-ink">Terapkan template agar program ini punya milestone, item kesiapan, dan tugas jam kerja menurut jenis programnya. Tenggat dihitung dari tanggal mulai (H) — tidak disimpan, sehingga ikut bergeser bila H berubah.</p>
          {p.canUpdate && live && <Button className="mt-3" variant="primary" loading={busy} onClick={() => void run(() => api(`/api/training/projects/${p.projectId}/indicators/apply`, { body: {} }), "Template pemantauan diterapkan.")}>Terapkan template pemantauan</Button>}
        </div>
      ) : (
        <>
          <section aria-label="Milestone" className="space-y-3">
            <h2 className="text-base font-semibold text-ink">Milestone & tenggat</h2>
            <p className="text-xs text-muted">Milestone dianggap selesai bila ada bukti (tautan/rujukan dokumen). Selesai lebih awal ikut dihitung; keterlambatan dihitung dari tenggat.</p>
            <TableWrap>
              <Table>
                <thead><tr><Th>Kode</Th><Th>Milestone</Th><Th>Tenggat</Th><Th>PIC</Th><Th align="right">Bobot</Th><Th>Status</Th>{live && <Th />}</tr></thead>
                <tbody>{p.milestones.map((m) => (
                  <tr key={m.id}>
                    <Td mono>{m.code}</Td>
                    <Td><p className="font-medium text-ink">{m.name}{m.critical && <Badge tone="red" className="ml-2">Kritikal</Badge>}</p>{m.reference && <p className="text-xs text-muted">{m.reference}</p>}{m.evidence && <p className="text-xs text-muted">Bukti: {m.evidence}</p>}</Td>
                    <Td><p>{dueText(m.due)}</p><p className="text-xs text-muted">{m.offsetLabel}</p></Td>
                    <Td>{m.assigneeName ?? <span className="text-xs text-muted">Belum ada</span>}</Td>
                    <Td align="right">{m.weight}</Td>
                    <Td>{m.notApplicable ? <Badge tone="gray">Tidak berlaku</Badge> : m.doneAt ? <Badge tone="green">Selesai {formatDateShort(m.doneAt)}</Badge> : m.overdue ? <Badge tone="red">Terlambat {m.daysOverdue} hari</Badge> : <Badge tone="gray">Menunggu</Badge>}</Td>
                    {live && <Td align="right"><span className="inline-flex gap-1.5">
                      {m.canComplete && !m.doneAt && !m.notApplicable && <Button size="sm" onClick={() => { reset(); setEvidence(""); setDoneAt(""); setFinish(m); }}><Check className="size-4" />Selesai</Button>}
                      {m.canManage && m.doneAt && <Button size="sm" onClick={() => { reset(); setReason(""); setReopen(m); }}><RotateCcw className="size-4" />Buka</Button>}
                    </span></Td>}
                  </tr>
                ))}</tbody>
              </Table>
            </TableWrap>
          </section>

          <section aria-label="Item kesiapan" className="space-y-3">
            <h2 className="text-base font-semibold text-ink">Item kesiapan</h2>
            <p className="text-xs text-muted">Skor tiap komponen = item selesai ÷ item yang berlaku. Item “Tidak berlaku” dikeluarkan dari hitungan; komponen Peserta dihitung dari jumlah peserta terkonfirmasi.</p>
            {byComponent.length === 0 ? <EmptyState title="Belum ada item kesiapan" /> : byComponent.map(({ c, rows }) => {
              const applicable = rows.filter((r) => r.status !== "NOT_APPLICABLE");
              return (
                <div key={c} className="rounded-lg border border-line bg-surface">
                  <div className="flex items-baseline justify-between border-b border-line px-4 py-2"><h3 className="text-sm font-semibold text-ink">{COMPONENT_LABEL[c]}</h3><span className="tabular text-xs text-muted">{applicable.filter((r) => r.status === "DONE").length}/{applicable.length} selesai</span></div>
                  <ul className="divide-y divide-line">{rows.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{i.name}{i.critical && <Badge tone="red" className="ml-2">Kritikal</Badge>}{i.bnspExcluded && <Badge tone="gray" className="ml-2">Khusus BNSP</Badge>}</p>
                        <p className="text-xs text-muted">Tenggat {dueText(i.due)} ({i.offsetLabel}){i.assigneeName ? ` · ${i.assigneeName}` : ""}{i.overdue ? " · terlambat" : ""}</p>
                      </div>
                      {i.canUpdate && live ? (
                        <select aria-label={`Status ${i.name}`} className="h-8 rounded-md border border-line bg-white px-2 text-sm" value={i.status} disabled={busy}
                          onChange={(e) => void run(() => api(`/api/training/readiness/${i.id}`, { method: "PATCH", body: { status: e.target.value } }))}>
                          <option value="OPEN">Terbuka</option><option value="DONE">Selesai</option>{i.canManage && <option value="NOT_APPLICABLE">Tidak berlaku</option>}
                        </select>
                      ) : <Badge tone={i.status === "DONE" ? "green" : i.status === "NOT_APPLICABLE" ? "gray" : i.overdue ? "red" : "gray"}>{i.status === "DONE" ? "Selesai" : i.status === "NOT_APPLICABLE" ? "Tidak berlaku" : "Terbuka"}</Badge>}
                    </li>
                  ))}</ul>
                </div>
              );
            })}
          </section>

          {p.canSeeWorkload && (
            <section aria-label="Jam kerja" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-ink">Jam kerja per staf</h2>
                {p.canManageTasks && live && <span className="inline-flex gap-2">
                  <Button loading={busy} onClick={() => void run(() => api<{ created: number }>(`/api/training/projects/${p.projectId}/indicators/workload`, { body: {} }), "Jam kerja dari template dihitung ulang.")}>Hitung ulang dari template</Button>
                  <Button variant="primary" onClick={() => { reset(); setW({ employeeId: "", name: "", hours: "", startDate: "", endDate: "" }); setAddWork(true); }}><Plus className="size-4" />Tambah tugas</Button>
                </span>}
              </div>
              <p className="text-xs text-muted">Jam standar = tetap + per peserta × peserta acuan + per hari kelas × lama kelas, dibagi rata pada hari kerja jendela tugas. Tugas manual tidak pernah ditimpa saat dihitung ulang.</p>
              {p.workload.length === 0 ? <EmptyState title="Belum ada tugas jam kerja" description="Tugas dibuat otomatis dari Tabel Jam Standar bila pemegang jabatan sudah diisi di Rumus Indikator." /> : (
                <TableWrap>
                  <Table>
                    <thead><tr><Th>Staf</Th><Th>Tugas</Th><Th align="right">Jam</Th><Th>Jendela</Th><Th>Sumber</Th><Th>Status</Th></tr></thead>
                    <tbody>{p.workload.map((x) => (
                      <tr key={x.id}><Td>{x.employeeName}</Td><Td>{x.name}</Td><Td align="right">{x.hours}</Td><Td>{formatDateShort(x.startDate)} – {formatDateShort(x.endDate)}</Td>
                        <Td><Badge tone={x.source === "MANUAL" ? "blue" : "gray"}>{x.source === "MANUAL" ? "Manual" : "Template"}</Badge></Td>
                        <Td>{p.canManageTasks && live ? (
                          <select aria-label={`Status ${x.name}`} className="h-8 rounded-md border border-line bg-white px-2 text-sm" value={x.status} disabled={busy}
                            onChange={(e) => void run(() => api(`/api/training/workload/${x.id}`, { method: "PATCH", body: { status: e.target.value } }))}>
                            <option value="OPEN">Terbuka</option><option value="DONE">Selesai</option><option value="CANCELLED">Dibatalkan</option>
                          </select>) : x.status === "OPEN" ? "Terbuka" : x.status === "DONE" ? "Selesai" : "Dibatalkan"}</Td></tr>
                    ))}</tbody>
                  </Table>
                </TableWrap>
              )}
            </section>
          )}
        </>
      )}

      <section id="pemulihan" aria-label="Catatan pemulihan" className="scroll-mt-20 space-y-3">
        <h2 className="text-base font-semibold text-ink">Catatan pemulihan</h2>
        <p className="text-xs text-muted">Rencana/keputusan pemulihan program (Kuning berturut-turut, Merah, milestone terlambat, beban berlebih). Catatan bersifat tetap: tidak dapat diubah atau dihapus, supaya jejak keputusan terjaga.</p>
        {p.canWriteRecovery && live && (
          <form className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[14rem_1fr_11rem_auto]" onSubmit={(e) => { e.preventDefault(); void run(() => api(`/api/training/projects/${p.projectId}/recovery`, { body: { kind: rec.kind, body: rec.body, newDate: rec.newDate || null } }), "Catatan pemulihan disimpan.", () => setRec({ ...rec, body: "", newDate: "" })); }}>
            <SelectField label="Jenis" value={rec.kind} onChange={(e) => setRec({ ...rec, kind: e.target.value as RecoveryKind })}>{RECOVERY_KINDS.map((k) => <option key={k} value={k}>{RECOVERY_KIND_LABEL[k]}</option>)}</SelectField>
            <TextAreaField label="Rencana / keputusan" required rows={2} maxLength={1000} value={rec.body} onChange={(e) => setRec({ ...rec, body: e.target.value })} error={fieldErrors.body} />
            <TextField label="Tanggal selesai baru" type="date" value={rec.newDate} onChange={(e) => setRec({ ...rec, newDate: e.target.value })} error={fieldErrors.newDate} hint="Opsional." />
            <div className="flex items-end"><Button type="submit" variant="primary" loading={busy} disabled={rec.body.trim().length < 5}>Simpan catatan</Button></div>
          </form>
        )}
        {p.recovery.length === 0 ? <p className="text-sm text-muted">Belum ada catatan pemulihan.</p> : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">{p.recovery.map((n) => (
            <li key={n.id} className="px-4 py-3 text-sm">
              <p className="flex flex-wrap items-center gap-2"><Badge tone={n.kind === "RED" ? "red" : n.kind === "YELLOW_STREAK" ? "amber" : "gray"}>{n.kindLabel}</Badge>{n.newDate && <span className="text-xs text-muted">Tanggal selesai baru: {formatDateShort(n.newDate)}</span>}</p>
              <p className="mt-1 whitespace-pre-wrap text-ink">{n.body}</p>
              <p className="mt-0.5 text-xs text-muted">{n.createdByName ?? "—"} · {formatDateTime(n.createdAt)}</p>
            </li>))}</ul>
        )}
      </section>

      <Dialog open={finish !== null} onClose={() => !busy && setFinish(null)} size="md" title={`Selesaikan ${finish?.code ?? ""}`} description={finish?.name}
        footer={<><Button onClick={() => setFinish(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={evidence.trim().length < 3} onClick={() => finish && void run(() => api(`/api/training/milestones/${finish.id}/complete`, { body: { evidence, doneAt: doneAt || null } }), "Milestone diselesaikan.", () => setFinish(null))}>Simpan</Button></>}>
        <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <TextAreaField label="Bukti penyelesaian" required rows={3} maxLength={500} value={evidence} onChange={(e) => setEvidence(e.target.value)} error={fieldErrors.evidence} hint="Tautan atau rujukan dokumen: Berita Acara, Form Serah Terima, Checklist Kesiapan Kelas, dst. Jangan menempelkan kata sandi." />
          <TextField label="Tanggal selesai" type="date" value={doneAt} onChange={(e) => setDoneAt(e.target.value)} error={fieldErrors.doneAt} hint="Kosong = hari ini. Tidak boleh di masa depan; selesai lebih awal dari tenggat boleh." />
        </div>
      </Dialog>

      <Dialog open={reopen !== null} onClose={() => !busy && setReopen(null)} size="md" title={`Buka kembali ${reopen?.code ?? ""}`} description={reopen?.name}
        footer={<><Button onClick={() => setReopen(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={reason.trim().length < 3} onClick={() => reopen && void run(() => api(`/api/training/milestones/${reopen.id}/reopen`, { body: { reason } }), "Milestone dibuka kembali.", () => setReopen(null))}>Buka kembali</Button></>}>
        <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}<TextAreaField label="Alasan" required rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} hint="Dicatat di riwayat aktivitas." /></div>
      </Dialog>

      <Dialog open={addWork} onClose={() => !busy && setAddWork(false)} size="md" title="Tambah tugas jam kerja" description="Tugas manual (di luar Tabel Jam Standar) dihitung pada beban staf."
        footer={<><Button onClick={() => setAddWork(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={!w.employeeId || w.name.trim().length < 3 || !w.hours || !w.startDate || !w.endDate} onClick={() => void run(() => api(`/api/training/projects/${p.projectId}/workload`, { body: { ...w, hours: Number(w.hours.replace(",", ".")) } }), "Tugas jam kerja ditambahkan.", () => setAddWork(false))}>Simpan</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">{error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <SelectField className="sm:col-span-2" label="Staf" required value={w.employeeId} onChange={(e) => setW({ ...w, employeeId: e.target.value })} error={fieldErrors.employeeId}><option value="">— Pilih staf —</option>{p.employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</SelectField>
          <TextField className="sm:col-span-2" label="Nama tugas" required maxLength={200} value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} error={fieldErrors.name} />
          <TextField label="Jam total" required inputMode="decimal" value={w.hours} onChange={(e) => setW({ ...w, hours: e.target.value })} error={fieldErrors.hours} hint="Dibagi rata pada hari kerja jendela tugas." />
          <span />
          <TextField label="Mulai" type="date" required value={w.startDate} onChange={(e) => setW({ ...w, startDate: e.target.value })} error={fieldErrors.startDate} />
          <TextField label="Selesai" type="date" required value={w.endDate} onChange={(e) => setW({ ...w, endDate: e.target.value })} error={fieldErrors.endDate} />
        </div>
      </Dialog>
    </div>
  );
}
