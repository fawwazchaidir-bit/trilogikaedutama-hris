"use client";
import { useMemo, useState } from "react";
import { Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import {
  ANCHORS, ANCHOR_LABEL, COMPONENTS, COMPONENT_LABEL, ITEM_COMPONENTS, TRACKS, TRACK_LABEL, checkIndicatorConfig,
  type Anchor, type IndicatorConfig, type ItemTemplate, type MilestoneTemplate, type Track,
} from "@/lib/training/indicators/config";
import { offsetLabel } from "@/lib/training/indicators/format";
import { DELIVERY_MODES, DELIVERY_MODE_LABEL } from "@/lib/training/types";
import type { IndicatorConfigDto, SaveConfigResult } from "@/server/services/training/indicator-config";
import { useRunner } from "./use-runner";

const cell = "h-8 w-full min-w-16 rounded-md border border-line bg-white px-2 text-sm disabled:bg-stone-50 disabled:text-ink-soft";
const DAYS = [[1, "Sen"], [2, "Sel"], [3, "Rab"], [4, "Kam"], [5, "Jum"], [6, "Sab"], [7, "Min"]] as const;

/** Angka dengan teks lokal: kolom boleh dikosongkan sementara mengetik; saat keluar kolom, nilai tidak sah dikembalikan ke nilai terakhir yang sah. */
function Num({ label, value, onChange, hint, step = "any", className }: { label: string; value: number; onChange: (n: number) => void; hint?: string; step?: string; className?: string }) {
  const [text, setText] = useState(String(value));
  return (
    <TextField
      className={className} label={label} type="number" inputMode="decimal" step={step} value={text} hint={hint}
      onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n); }}
      onBlur={() => setText(String(value))}
    />
  );
}
function NumCell({ value, onChange, label, step = "any" }: { value: number; onChange: (n: number) => void; label: string; step?: string }) {
  const [text, setText] = useState(String(value));
  return <input aria-label={label} className={cell} type="number" inputMode="decimal" step={step} value={text}
    onChange={(e) => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n)) onChange(n); }} onBlur={() => setText(String(value))} />;
}

function Section({ title, desc, children, open = false }: { title: string; desc?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-lg border border-line bg-surface shadow-sm">
      <summary className="cursor-pointer select-none px-5 py-3 text-base font-semibold text-ink">{title}</summary>
      <div className="space-y-4 border-t border-line px-5 py-4">{desc && <p className="text-xs text-muted">{desc}</p>}{children}</div>
    </details>
  );
}

export function IndicatorConfigEditor({ initial }: { initial: IndicatorConfigDto }) {
  const { busy, error, run, reset } = useRunner();
  const [cfg, setCfg] = useState<IndicatorConfig>(() => structuredClone(initial.config));
  const [note, setNote] = useState("");
  const [gen, setGen] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  const [result, setResult] = useState<SaveConfigResult | null>(null);
  const edit = (fn: (c: IndicatorConfig) => void) => setCfg((c) => { const n = structuredClone(c); fn(n); return n; });
  const check = useMemo(() => checkIndicatorConfig(cfg), [cfg]);
  const dirty = useMemo(() => JSON.stringify(cfg) !== JSON.stringify(initial.config), [cfg, initial.config]);
  const canEdit = initial.canEdit;
  const empName = useMemo(() => new Map(initial.employees.map((e) => [e.id, e.name])), [initial.employees]);
  const roleOptions = cfg.roles.map((r) => ({ key: r.key, label: r.label }));
  const codes = (t: Track) => cfg.templates[t].milestones.map((m) => m.code);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const save = () => void run(() => api<SaveConfigResult>("/api/training/indicators/config", { method: "PUT", body: { config: cfg, note: note || null } }), "Konfigurasi disimpan sebagai versi baru.", (r) => { setResult(r); setNote(""); });
  const doReset = () => void run(() => api<SaveConfigResult>("/api/training/indicators/config/reset", { body: {} }), "Dikembalikan ke nilai bawaan dokumen (versi baru).", () => { setConfirmReset(false); });

  const holderSelect = (key: string, label: string) => (
    <select aria-label={`Pemegang ${label}`} className={cell} value={cfg.roleHolders[key] ?? ""} onChange={(e) => edit((c) => { c.roleHolders[key] = e.target.value || null; })}>
      <option value="">— Belum ada —</option>
      {initial.employees.map((e) => <option key={e.id} value={e.id}>{e.name}{e.position ? ` · ${e.position}` : ""}</option>)}
    </select>
  );
  const roleSelect = (value: string | null | undefined, onChange: (v: string | null) => void, label: string) => (
    <select aria-label={label} className={cell} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>{roleOptions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
    </select>
  );
  const anchorSelect = (value: Anchor, onChange: (v: Anchor) => void, label: string, only?: readonly Anchor[]) => (
    <select aria-label={label} className={cell} value={value} onChange={(e) => onChange(e.target.value as Anchor)}>
      {(only ?? ANCHORS).map((a) => <option key={a} value={a}>{ANCHOR_LABEL[a]}</option>)}
    </select>
  );

  const milestoneTable = (track: Track) => {
    const rows = cfg.templates[track].milestones;
    const set = (i: number, p: Partial<MilestoneTemplate>) => edit((c) => { Object.assign(c.templates[track].milestones[i]!, p); });
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold text-ink">Milestone — {TRACK_LABEL[track]}</h4>
          <span className="text-xs text-muted">Jumlah bobot: <b className={sum(rows.map((r) => r.weight)) === 100 ? "text-emerald-700" : "text-amber-700"}>{sum(rows.map((r) => r.weight))}</b> (dokumen: 100)</span></div>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-stone-50 text-left text-xs text-muted"><tr>{["Kode", "Nama milestone", "Acuan", "± hari", "Hari kerja", "Milestone acuan", "Jabatan PIC", "Bobot", "Kritikal", "Khusus BNSP", "Rujukan SOP", "Tenggat", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((m, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5"><input aria-label="Kode" className={cell} value={m.code} maxLength={20} onChange={(e) => set(i, { code: e.target.value.trim() })} /></td>
                <td className="px-2 py-1.5"><input aria-label="Nama milestone" className={`${cell} min-w-56`} value={m.name} maxLength={200} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td className="px-2 py-1.5">{anchorSelect(m.anchor, (a) => set(i, { anchor: a }), "Acuan")}</td>
                <td className="px-2 py-1.5"><NumCell label="Selisih hari" step="1" value={m.days} onChange={(n) => set(i, { days: Math.trunc(n) })} /></td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Hari kerja" checked={m.work} onChange={(e) => set(i, { work: e.target.checked })} /></td>
                <td className="px-2 py-1.5">{m.anchor === "MILESTONE" ? <select aria-label="Milestone acuan" className={cell} value={m.ref ?? ""} onChange={(e) => set(i, { ref: e.target.value || null })}><option value="">—</option>{codes(track).filter((c) => c !== m.code).map((c) => <option key={c} value={c}>{c}</option>)}</select> : <span className="text-xs text-muted">—</span>}</td>
                <td className="px-2 py-1.5">{roleSelect(m.roleKey, (v) => set(i, { roleKey: v }), "Jabatan PIC")}</td>
                <td className="px-2 py-1.5"><NumCell label="Bobot" step="1" value={m.weight} onChange={(n) => set(i, { weight: Math.max(0, Math.trunc(n)) })} /></td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Kritikal" checked={m.critical} onChange={(e) => set(i, { critical: e.target.checked })} /></td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Khusus BNSP" checked={m.bnspOnly} onChange={(e) => set(i, { bnspOnly: e.target.checked })} /></td>
                <td className="px-2 py-1.5"><input aria-label="Rujukan SOP" className={cell} value={m.reference ?? ""} maxLength={80} onChange={(e) => set(i, { reference: e.target.value || null })} /></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted">{offsetLabel(m)}</td>
                <td className="px-2 py-1.5"><button type="button" aria-label={`Hapus milestone ${m.code}`} className="rounded p-1 text-muted hover:bg-stone-100 hover:text-brand-700" onClick={() => edit((c) => { c.templates[track].milestones.splice(i, 1); })}><Trash2 className="size-4" /></button></td>
              </tr>))}</tbody>
          </table>
        </div>
        <Button size="sm" onClick={() => edit((c) => { c.templates[track].milestones.push({ code: `${track === "REGULAR" ? "R" : "K"}${String(rows.length + 1).padStart(2, "0")}`, name: "Milestone baru", anchor: "H", days: 0, work: false, ref: null, roleKey: null, weight: 0, critical: false, bnspOnly: false, reference: null }); })}><Plus className="size-4" />Tambah milestone</Button>
      </div>
    );
  };

  const itemTable = (track: Track) => {
    const rows = cfg.templates[track].items;
    const set = (i: number, p: Partial<ItemTemplate>) => edit((c) => { Object.assign(c.templates[track].items[i]!, p); });
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-ink">Item kesiapan — {TRACK_LABEL[track]}</h4>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-stone-50 text-left text-xs text-muted"><tr>{["Komponen", "Item", "Acuan", "± hari", "Milestone acuan", "Jabatan PIC", "Kritikal", "Khusus BNSP", "Tenggat", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{rows.map((it, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5"><select aria-label="Komponen" className={cell} value={it.component} onChange={(e) => set(i, { component: e.target.value as ItemTemplate["component"] })}>{ITEM_COMPONENTS.map((k) => <option key={k} value={k}>{COMPONENT_LABEL[k]}</option>)}</select></td>
                <td className="px-2 py-1.5"><input aria-label="Nama item" className={`${cell} min-w-56`} value={it.name} maxLength={200} onChange={(e) => set(i, { name: e.target.value })} /></td>
                <td className="px-2 py-1.5">{anchorSelect(it.anchor, (a) => set(i, { anchor: a }), "Acuan")}</td>
                <td className="px-2 py-1.5"><NumCell label="Selisih hari" step="1" value={it.days} onChange={(n) => set(i, { days: Math.trunc(n) })} /></td>
                <td className="px-2 py-1.5">{it.anchor === "MILESTONE" ? <select aria-label="Milestone acuan" className={cell} value={it.ref ?? ""} onChange={(e) => set(i, { ref: e.target.value || null })}><option value="">—</option>{codes(track).map((c) => <option key={c} value={c}>{c}</option>)}</select> : <span className="text-xs text-muted">—</span>}</td>
                <td className="px-2 py-1.5">{roleSelect(it.roleKey, (v) => set(i, { roleKey: v }), "Jabatan PIC")}</td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Kritikal" checked={it.critical} onChange={(e) => set(i, { critical: e.target.checked })} /></td>
                <td className="px-2 py-1.5 text-center"><input type="checkbox" aria-label="Khusus BNSP" checked={it.bnspOnly} onChange={(e) => set(i, { bnspOnly: e.target.checked })} /></td>
                <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted">{offsetLabel(it)}</td>
                <td className="px-2 py-1.5"><button type="button" aria-label={`Hapus item ${it.name}`} className="rounded p-1 text-muted hover:bg-stone-100 hover:text-brand-700" onClick={() => edit((c) => { c.templates[track].items.splice(i, 1); })}><Trash2 className="size-4" /></button></td>
              </tr>))}</tbody>
          </table>
        </div>
        <Button size="sm" onClick={() => edit((c) => { c.templates[track].items.push({ component: "ADMIN", name: "Item baru", anchor: "H", days: -1, work: false, ref: null, roleKey: null, critical: false, bnspOnly: false }); })}><Plus className="size-4" />Tambah item</Button>
      </div>
    );
  };

  return (
    <div className="space-y-5" key={gen}>
      <Notice tone="info">
        <p className="font-medium">Cara kerja perubahan</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
          <li><b>Langsung berlaku</b> untuk semua program saat dihitung: ambang warna, bobot kesiapan, kapasitas, proyeksi peserta, KP, fasilitator, wajib bukti.</li>
          <li><b>Berlaku untuk program baru</b> (salinan milik program): template milestone/item dan pemegang jabatan sebagai PIC.</li>
          <li><b>Berlaku saat jam kerja dihitung ulang</b> (otomatis ketika tanggal/peserta/moda program berubah, atau tombol “Hitung ulang dari template”): Tabel Jam Standar dan pemegang jabatan.</li>
          <li>Setiap simpan membuat <b>versi baru</b>; versi lama tetap tercatat. Hanya Super Admin (Direktur) yang dapat mengubah.</li>
        </ul>
      </Notice>
      {initial.damaged && <Notice tone="danger">Konfigurasi tersimpan tidak sah; nilai bawaan dokumen ditampilkan dan dipakai. Simpan untuk menimpa dengan konfigurasi yang benar.</Notice>}
      {!canEdit && <Notice tone="warn">Anda dapat melihat rumus dan parameter yang berlaku, tetapi hanya Super Admin (Direktur) yang dapat mengubahnya.</Notice>}

      <fieldset disabled={!canEdit || busy} className="space-y-5 border-0 p-0">
        <Section open title="Ambang warna" desc="Batas Hijau/Kuning/Merah. Usulan awal dari dokumen; ditinjau setelah tiga bulan data berjalan.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Num label="Ketepatan Waktu — Hijau bila SPI ≥" value={cfg.thresholds.spi.greenMin} onChange={(n) => edit((c) => { c.thresholds.spi.greenMin = n; })} />
            <Num label="Ketepatan Waktu — Kuning bila SPI ≥" value={cfg.thresholds.spi.yellowMin} onChange={(n) => edit((c) => { c.thresholds.spi.yellowMin = n; })} hint="Di bawah ini Merah." />
            <span className="hidden lg:block" />
            <Num label="Kesiapan — Hijau bila selisih ≥ (poin)" value={cfg.thresholds.readiness.greenMin} onChange={(n) => edit((c) => { c.thresholds.readiness.greenMin = n; })} hint="Selisih = skor kesiapan − target hari ini." />
            <Num label="Kesiapan — Kuning bila selisih ≥ (poin)" value={cfg.thresholds.readiness.yellowMin} onChange={(n) => edit((c) => { c.thresholds.readiness.yellowMin = n; })} />
            <span className="hidden lg:block" />
            <Num label="Beban — “Ada ruang” bila ≤ (%)" value={cfg.thresholds.load.roomyMax} onChange={(n) => edit((c) => { c.thresholds.load.roomyMax = n; })} />
            <Num label="Beban — Hijau (ideal) bila ≤ (%)" value={cfg.thresholds.load.greenMax} onChange={(n) => edit((c) => { c.thresholds.load.greenMax = n; })} />
            <Num label="Beban — Kuning bila ≤ (%)" value={cfg.thresholds.load.yellowMax} onChange={(n) => edit((c) => { c.thresholds.load.yellowMax = n; })} hint="Di atas ini Overload (Merah). Persen dibulatkan." />
            <Num label="Proyeksi peserta — Hijau bila rasio ≥" value={cfg.thresholds.projection.greenMin} onChange={(n) => edit((c) => { c.thresholds.projection.greenMin = n; })} />
            <Num label="Proyeksi peserta — Kuning bila rasio ≥" value={cfg.thresholds.projection.yellowMin} onChange={(n) => edit((c) => { c.thresholds.projection.yellowMin = n; })} hint="Pemicu Merah bila di bawah ini pada tahap pemeriksaan." />
            <Num label="Jendela laju pendaftar (hari)" step="1" value={cfg.thresholds.projection.windowDays} onChange={(n) => edit((c) => { c.thresholds.projection.windowDays = Math.trunc(n); })} />
            <Num label="Tutup pendaftaran bawaan (H-n)" step="1" value={cfg.thresholds.projection.defaultCloseDaysBeforeH} onChange={(n) => edit((c) => { c.thresholds.projection.defaultCloseDaysBeforeH = Math.trunc(n); })} />
            <Num label="Pemeriksaan pendaftar mulai (H-n)" step="1" value={cfg.thresholds.projection.triggerDaysBeforeH} onChange={(n) => edit((c) => { c.thresholds.projection.triggerDaysBeforeH = Math.trunc(n); })} />
            <Num label="Kepadatan kelas (KP) maksimum" value={cfg.thresholds.parallelDensityMax} onChange={(n) => edit((c) => { c.thresholds.parallelDensityMax = n; })} hint="Di atas ini = kelas tanpa pendamping (Merah)." />
            <Num label="Indeks ketimpangan divisi maksimum" value={cfg.thresholds.imbalanceMax} onChange={(n) => edit((c) => { c.thresholds.imbalanceMax = n; })} />
            <Num label="Eskalasi bila milestone terlambat > (hari)" step="1" value={cfg.thresholds.overdueEscalationDays} onChange={(n) => edit((c) => { c.thresholds.overdueEscalationDays = Math.trunc(n); })} />
          </div>
        </Section>

        <Section title="Kapasitas kerja" desc="Dasar penyebut Beban Tim. Per staf dapat dikecualikan oleh Manajer Program (bagian bawah halaman).">
          <div className="grid gap-4 sm:grid-cols-3">
            <Num label="Jam efektif per hari" value={cfg.capacity.hoursPerDay} onChange={(n) => edit((c) => { c.capacity.hoursPerDay = n; })} hint="Dokumen: 6 jam (sisanya rapat, administrasi, dan lain-lain)." />
            <Num label="Minggu ke depan yang dihitung" step="1" value={cfg.capacity.weeksAhead} onChange={(n) => edit((c) => { c.capacity.weeksAhead = Math.trunc(n); })} hint="Selain minggu berjalan." />
          </div>
          <fieldset className="text-sm"><legend className="mb-1 font-medium text-ink">Hari kerja</legend>
            <div className="flex flex-wrap gap-3">{DAYS.map(([d, l]) => <label key={d} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={cfg.capacity.workDays.includes(d)} onChange={(e) => edit((c) => { c.capacity.workDays = e.target.checked ? [...new Set([...c.capacity.workDays, d])].sort() : c.capacity.workDays.filter((x) => x !== d); })} />{l}</label>)}</div></fieldset>
          <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={cfg.capacity.useHrisLeave} onChange={(e) => edit((c) => { c.capacity.useHrisLeave = e.target.checked; })} /><span>Kurangi kapasitas dengan cuti yang sudah disetujui di HRIS<span className="block text-xs text-muted">Hanya tanggal dan porsi hari yang dibaca; alasan dan lampiran cuti tidak diakses.</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={cfg.capacity.skipHolidays} onChange={(e) => edit((c) => { c.capacity.skipHolidays = e.target.checked; })} /><span>Hari libur pada kalender HRIS bukan hari kerja<span className="block text-xs text-muted">Dokumen menghitung hari kerja tanpa hari libur (NETWORKDAYS); aktifkan bila kalender libur HRIS sudah dipelihara.</span></span></label>
        </Section>

        <Section title="Bobot kesiapan" desc="Bobot tiap komponen pada Indeks Kesiapan Program (IKP). Komponen tanpa item yang berlaku (mis. Sertifikasi pada program tanpa BNSP) otomatis dikeluarkan dan bobot sisanya dinormalkan.">
          <div className="overflow-x-auto rounded-md border border-line"><table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Komponen</th>{TRACKS.map((t) => <th key={t} className="px-3 py-2 font-medium">{TRACK_LABEL[t]}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{COMPONENTS.map((k) => <tr key={k}><td className="px-3 py-1.5">{COMPONENT_LABEL[k]}</td>{TRACKS.map((t) => <td key={t} className="px-3 py-1.5"><NumCell label={`Bobot ${COMPONENT_LABEL[k]} ${TRACK_LABEL[t]}`} value={cfg.weights[t][k]} onChange={(n) => edit((c) => { c.weights[t][k] = Math.max(0, n); })} /></td>)}</tr>)}
              <tr className="bg-stone-50 font-medium"><td className="px-3 py-1.5">Jumlah</td>{TRACKS.map((t) => { const s = sum(Object.values(cfg.weights[t])); return <td key={t} className={`px-3 py-1.5 ${s === 100 ? "text-emerald-700" : "text-amber-700"}`}>{s}</td>; })}</tr></tbody>
          </table></div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm"><span className="mb-1 block font-medium text-ink">Komponen Peserta (reguler): naik dari tenggat</span><select aria-label="Awal kenaikan peserta" className={cell} value={cfg.participants.rampStartCode} onChange={(e) => edit((c) => { c.participants.rampStartCode = e.target.value; })}>{codes("REGULAR").map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block font-medium text-ink">…sampai tenggat</span><select aria-label="Akhir kenaikan peserta" className={cell} value={cfg.participants.rampEndCode} onChange={(e) => edit((c) => { c.participants.rampEndCode = e.target.value; })}>{codes("REGULAR").map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label className="text-sm"><span className="mb-1 block font-medium text-ink">Kerjasama: daftar peserta diterima pada</span><select aria-label="Tenggat daftar peserta kerjasama" className={cell} value={cfg.participants.partnerDeadlineCode} onChange={(e) => edit((c) => { c.participants.partnerDeadlineCode = e.target.value; })}>{codes("PARTNER").map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          </div>
        </Section>

        <Section title="Jabatan, pemegang, dan fasilitator" desc="Pemegang jabatan menjadi PIC milestone dan pemegang jam kerja pada program baru. Pemegang diganti di sini, bukan di setiap program.">
          <div className="overflow-x-auto rounded-md border border-line"><table className="w-full min-w-[640px] text-sm">
            <thead className="bg-stone-50 text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Kunci</th><th className="px-3 py-2 font-medium">Nama jabatan</th><th className="px-3 py-2 font-medium">Pemegang saat ini</th><th /></tr></thead>
            <tbody className="divide-y divide-line">{cfg.roles.map((r, i) => (
              <tr key={i}>
                <td className="px-3 py-1.5"><input aria-label="Kunci jabatan" className={cell} value={r.key} maxLength={40} onChange={(e) => edit((c) => { const old = c.roles[i]!.key; const nk = e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""); c.roles[i]!.key = nk; if (old in c.roleHolders) { c.roleHolders[nk] = c.roleHolders[old]!; delete c.roleHolders[old]; } })} /></td>
                <td className="px-3 py-1.5"><input aria-label="Nama jabatan" className={cell} value={r.label} maxLength={80} onChange={(e) => edit((c) => { c.roles[i]!.label = e.target.value; })} /></td>
                <td className="px-3 py-1.5">{holderSelect(r.key, r.label)}</td>
                <td className="px-3 py-1.5"><button type="button" aria-label={`Hapus jabatan ${r.label}`} className="rounded p-1 text-muted hover:bg-stone-100 hover:text-brand-700" onClick={() => edit((c) => { delete c.roleHolders[c.roles[i]!.key]; c.roles.splice(i, 1); })}><Trash2 className="size-4" /></button></td>
              </tr>))}</tbody>
          </table></div>
          <Button size="sm" onClick={() => edit((c) => { c.roles.push({ key: `JABATAN_${c.roles.length + 1}`, label: "Jabatan baru" }); })}><Plus className="size-4" />Tambah jabatan</Button>
          <div>
            <p className="mb-1 text-sm font-medium text-ink">Fasilitator kelas (penyebut Kepadatan Kelas Paralel)</p>
            <div className="mb-2 flex flex-wrap gap-2">{cfg.facilitators.length === 0 ? <span className="text-xs text-muted">Belum ada fasilitator.</span> : cfg.facilitators.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-xs text-ink">{empName.get(id) ?? "Karyawan"}<button type="button" aria-label={`Hapus fasilitator ${empName.get(id) ?? ""}`} className="text-muted hover:text-brand-700" onClick={() => edit((c) => { c.facilitators = c.facilitators.filter((x) => x !== id); })}>×</button></span>))}</div>
            <select aria-label="Tambah fasilitator" className={`${cell} max-w-sm`} value="" onChange={(e) => { const v = e.target.value; if (v) edit((c) => { c.facilitators = [...new Set([...c.facilitators, v])]; }); }}>
              <option value="">+ Tambah fasilitator…</option>{initial.employees.filter((e) => !cfg.facilitators.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
        </Section>

        <Section title="Template milestone & item kesiapan" desc="Diterapkan otomatis saat program dibuat (sesuai jenisnya). Tenggat = tanggal acuan ± hari; “hari kerja” melewati akhir pekan. H = hari pertama, T = permintaan klien masuk. Daftar item di luar contoh dokumen adalah usulan awal: tinjau bersama tim.">
          {TRACKS.map((t) => <div key={t} className="space-y-5">{milestoneTable(t)}{itemTable(t)}</div>)}
        </Section>

        <Section title="Tabel jam standar" desc="Jam = tetap + jam/peserta × peserta acuan + jam/hari-kelas × lama kelas; dibagi rata pada hari kerja jendela. Dokumen menyarankan mengganti angka ini dengan jam nyata dari tiga program terakhir (Minggu 0).">
          <div className="overflow-x-auto rounded-md border border-line"><table className="w-full min-w-[1150px] text-sm">
            <thead className="bg-stone-50 text-left text-xs text-muted"><tr>{["Jabatan", "Tugas", "Jenis", "Tetap (Reguler)", "Tetap (Kerjasama)", "Per peserta", "Per hari kelas", "Moda (kosong = semua)", "Mulai", "Selesai", ""].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">{cfg.hourTable.map((h, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5">{roleSelect(h.roleKey, (v) => edit((c) => { if (v) c.hourTable[i]!.roleKey = v; }), "Jabatan")}</td>
                <td className="px-2 py-1.5"><input aria-label="Tugas" className={`${cell} min-w-48`} value={h.task} maxLength={200} onChange={(e) => edit((c) => { c.hourTable[i]!.task = e.target.value; })} /></td>
                <td className="px-2 py-1.5"><div className="flex gap-2">{TRACKS.map((t) => <label key={t} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={h.tracks.includes(t)} onChange={(e) => edit((c) => { const cur = c.hourTable[i]!.tracks; c.hourTable[i]!.tracks = e.target.checked ? [...new Set([...cur, t])] : cur.filter((x) => x !== t); })} />{t === "REGULAR" ? "Reg" : "Kerja"}</label>)}</div></td>
                <td className="px-2 py-1.5"><NumCell label="Jam tetap reguler" value={h.fixed.REGULAR} onChange={(n) => edit((c) => { c.hourTable[i]!.fixed.REGULAR = Math.max(0, n); })} /></td>
                <td className="px-2 py-1.5"><NumCell label="Jam tetap kerjasama" value={h.fixed.PARTNER} onChange={(n) => edit((c) => { c.hourTable[i]!.fixed.PARTNER = Math.max(0, n); })} /></td>
                <td className="px-2 py-1.5"><NumCell label="Jam per peserta" value={h.perParticipant} onChange={(n) => edit((c) => { c.hourTable[i]!.perParticipant = Math.max(0, n); })} /></td>
                <td className="px-2 py-1.5"><NumCell label="Jam per hari kelas" value={h.perClassDay} onChange={(n) => edit((c) => { c.hourTable[i]!.perClassDay = Math.max(0, n); })} /></td>
                <td className="px-2 py-1.5"><div className="flex gap-2">{DELIVERY_MODES.map((m) => <label key={m} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={h.modes.includes(m)} onChange={(e) => edit((c) => { const cur = c.hourTable[i]!.modes; c.hourTable[i]!.modes = e.target.checked ? [...new Set([...cur, m])] : cur.filter((x) => x !== m); })} />{DELIVERY_MODE_LABEL[m].split(" ")[0]}</label>)}</div></td>
                <td className="px-2 py-1.5"><div className="flex items-center gap-1">{anchorSelect(h.start.anchor, (a) => edit((c) => { if (a === "H" || a === "H_END" || a === "T") c.hourTable[i]!.start.anchor = a; }), "Acuan mulai", ["H", "H_END", "T"])}<NumCell label="Hari mulai" step="1" value={h.start.days} onChange={(n) => edit((c) => { c.hourTable[i]!.start.days = Math.trunc(n); })} /></div></td>
                <td className="px-2 py-1.5"><div className="flex items-center gap-1">{anchorSelect(h.end.anchor, (a) => edit((c) => { if (a === "H" || a === "H_END" || a === "T") c.hourTable[i]!.end.anchor = a; }), "Acuan selesai", ["H", "H_END", "T"])}<NumCell label="Hari selesai" step="1" value={h.end.days} onChange={(n) => edit((c) => { c.hourTable[i]!.end.days = Math.trunc(n); })} /></div></td>
                <td className="px-2 py-1.5"><button type="button" aria-label={`Hapus baris jam ${h.task}`} className="rounded p-1 text-muted hover:bg-stone-100 hover:text-brand-700" onClick={() => edit((c) => { c.hourTable.splice(i, 1); })}><Trash2 className="size-4" /></button></td>
              </tr>))}</tbody>
          </table></div>
          <Button size="sm" onClick={() => edit((c) => { c.hourTable.push({ roleKey: c.roles[0]!.key, task: "Tugas baru", tracks: ["REGULAR", "PARTNER"], fixed: { REGULAR: 0, PARTNER: 0 }, perParticipant: 0, perClassDay: 0, modes: [], start: { anchor: "H", days: -7 }, end: { anchor: "H", days: 0 } }); })}><Plus className="size-4" />Tambah baris</Button>
        </Section>

        <Section title="Aturan lain">
          <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={cfg.requireEvidence} onChange={(e) => edit((c) => { c.requireEvidence = e.target.checked; })} /><span>Milestone tidak dianggap selesai tanpa bukti<span className="block text-xs text-muted">Tautan atau rujukan dokumen (Berita Acara, Form Serah Terima, Checklist Kesiapan Kelas, dst.).</span></span></label>
          <label className="flex items-start gap-2 text-sm"><input className="mt-0.5" type="checkbox" checked={cfg.autoApplyOnCreate} onChange={(e) => edit((c) => { c.autoApplyOnCreate = e.target.checked; })} /><span>Terapkan template pemantauan otomatis saat program dibuat<span className="block text-xs text-muted">Bila dimatikan, tombol “Terapkan template” tersedia di tab Pemantauan setiap program.</span></span></label>
        </Section>
      </fieldset>

      {check.errors.length > 0 && <Notice tone="danger"><p className="font-medium">Perbaiki sebelum menyimpan:</p><ul className="mt-1 list-disc pl-4 text-xs">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
      {check.warnings.length > 0 && <Notice tone="warn"><ul className="list-disc pl-4 text-xs">{check.warnings.map((e) => <li key={e}>{e}</li>)}</ul></Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {result && <Notice tone="success">Tersimpan sebagai versi {result.version}{result.changed.length ? ` (bagian berubah: ${result.changed.join(", ")})` : ""}.</Notice>}

      {canEdit && (
        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-end gap-3 border-t border-line bg-canvas/95 px-1 py-3 backdrop-blur">
          <TextAreaField className="min-w-64 flex-1" label="Catatan perubahan" rows={1} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} hint="Mis. “Ambang Kuning SPI diturunkan setelah peninjauan Q1”. Tercatat di riwayat." />
          <Button variant="primary" loading={busy} disabled={!dirty || check.errors.length > 0} onClick={save}><Save className="size-4" />Simpan sebagai versi baru</Button>
          <Button disabled={!dirty || busy} onClick={() => { setCfg(structuredClone(initial.config)); setGen((g) => g + 1); reset(); setResult(null); }}>Batalkan perubahan</Button>
          <Button variant="danger" disabled={busy} onClick={() => setConfirmReset(true)}><RotateCcw className="size-4" />Kembalikan ke bawaan dokumen</Button>
        </div>
      )}
      <ConfirmDialog open={confirmReset} onClose={() => !busy && setConfirmReset(false)} title="Kembalikan ke nilai bawaan dokumen?" confirmLabel="Kembalikan" tone="danger" loading={busy} onConfirm={doReset}
        description="Ambang, bobot, template, dan jam standar kembali ke dokumen v1.0. Pemegang jabatan dan fasilitator dipertahankan. Ini menjadi versi baru; riwayat tidak dihapus." />

      <section aria-label="Riwayat versi" className="rounded-lg border border-line bg-surface">
        <div className="border-b border-line px-5 py-3"><h2 className="text-base font-semibold text-ink">Riwayat versi</h2><p className="text-xs text-muted">Versi aktif: {initial.version === 0 ? "bawaan dokumen v1.0 (belum pernah disimpan)" : initial.version}.</p></div>
        {initial.history.length === 0 ? <p className="px-5 py-4 text-sm text-muted">Belum ada perubahan.</p> : (
          <ul className="divide-y divide-line">{initial.history.map((h) => <li key={h.version} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5 text-sm"><span><Badge tone={h.version === initial.version ? "green" : "gray"}>Versi {h.version}</Badge> <span className="ml-2 text-ink">{h.note ?? "Tanpa catatan"}</span></span><span className="text-xs text-muted">{h.changedByName ?? "—"} · {formatDateTime(h.createdAt)}</span></li>)}</ul>
        )}
      </section>
    </div>
  );
}
