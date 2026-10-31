"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { uploadFile } from "@/components/upload";
import { formatDateTime } from "@/lib/format";
import { ABSENCE_MODE_LABEL, LATE_MODE_LABEL, OVERTIME_MODE_LABEL, OVERTIME_RATE_MODE_LABEL } from "@/lib/labels";
import { defaultStatutoryConfig, type StatutoryConfig } from "@/lib/statutory";
import type { SettingsDto } from "@/server/services/settings";

function useForm() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); router.refresh(); } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  return { busy, error, fe, run };
}

const check = (label: string, checked: boolean, on: (v: boolean) => void, disabled?: boolean, hint?: string) => (
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => on(e.target.checked)} /><span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span></label>
);

export function CompanyForm({ s, canEdit }: { s: SettingsDto; canEdit: boolean }) {
  const f = useForm();
  const [v, setV] = useState({ name: s.company.name, legalName: s.company.legalName ?? "", tagline: s.company.tagline ?? "", address: s.company.address ?? "", phone: s.company.phone ?? "", email: s.company.email ?? "", website: s.company.website ?? "",
    slipShowAttendance: s.slip.showAttendance, slipFooterNote: s.slip.footerNote ?? "", slipNumberPrefix: s.slip.numberPrefix });
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((p) => ({ ...p, [k]: x }));
  const d = !canEdit || f.busy;
  return (
    <Card>
      <CardHeader title="Profil lembaga & slip gaji" description="Nama dan logo tampil pada header aplikasi dan slip gaji PDF." />
      <form className="grid gap-4 p-5 sm:grid-cols-2" aria-label="Form profil lembaga" onSubmit={(e) => { e.preventDefault(); void f.run(() => api("/api/settings", { method: "PUT", body: v }), "Profil lembaga disimpan."); }}>
        {f.error && <div className="sm:col-span-2"><Notice tone="danger">{f.error}</Notice></div>}
        <TextField label="Nama lembaga" required disabled={d} value={v.name} onChange={(e) => set("name", e.target.value)} error={f.fe.name} />
        <TextField label="Nama badan hukum" disabled={d} value={v.legalName} onChange={(e) => set("legalName", e.target.value)} error={f.fe.legalName} />
        <TextField label="Tagline" disabled={d} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} error={f.fe.tagline} />
        <TextField label="Situs web" disabled={d} value={v.website} onChange={(e) => set("website", e.target.value)} error={f.fe.website} />
        <div className="sm:col-span-2"><TextAreaField label="Alamat" rows={2} disabled={d} value={v.address} onChange={(e) => set("address", e.target.value)} error={f.fe.address} /></div>
        <TextField label="Telepon" disabled={d} value={v.phone} onChange={(e) => set("phone", e.target.value)} error={f.fe.phone} />
        <TextField label="Email" type="email" disabled={d} value={v.email} onChange={(e) => set("email", e.target.value)} error={f.fe.email} />
        <TextField label="Awalan nomor slip" disabled={d} value={v.slipNumberPrefix} onChange={(e) => set("slipNumberPrefix", e.target.value)} error={f.fe.slipNumberPrefix} hint="Contoh hasil: SG-202610-R01-001" />
        <div className="sm:col-span-2">{check("Tampilkan ringkasan kehadiran pada slip gaji", v.slipShowAttendance, (x) => set("slipShowAttendance", x), d)}</div>
        <div className="sm:col-span-2"><TextAreaField label="Catatan kaki slip (opsional)" rows={2} disabled={d} value={v.slipFooterNote} onChange={(e) => set("slipFooterNote", e.target.value)} error={f.fe.slipFooterNote} /></div>
        {canEdit && <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={f.busy}>Simpan</Button></div>}
      </form>
    </Card>
  );
}

export function LogoCard({ logoUrl, canEdit }: { logoUrl: string | null; canEdit: boolean }) {
  const f = useForm();
  return (
    <Card>
      <CardHeader title="Logo" description="PNG atau JPG (maks. 3 MB). Dipakai di header aplikasi dan slip PDF; slip lama tetap memakai logo saat diterbitkan." />
      <div className="flex flex-wrap items-center gap-5 p-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logoUrl ?? "/brand/logo.png"} alt="Logo saat ini" className="size-20 rounded-lg border border-line bg-white object-contain p-1" />
        {canEdit && <div className="space-y-1.5"><label htmlFor="logo-file" className="block text-sm font-medium text-ink-soft">Unggah logo baru</label>
          <input id="logo-file" type="file" accept="image/png,image/jpeg" disabled={f.busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void f.run(() => uploadFile("/api/settings/logo", file), "Logo diperbarui."); }} className="block text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 hover:file:bg-canvas" />
          {f.error && <p role="alert" className="text-xs font-medium text-brand-700">{f.error}</p>}</div>}
      </div>
    </Card>
  );
}

export function PolicyForm({ s, canEdit }: { s: SettingsDto; canEdit: boolean }) {
  const f = useForm();
  const a = s.attendance;
  const [v, setV] = useState({
    lateMinutesAfterTolerance: a.lateMinutesAfterTolerance, locationEnabled: a.locationEnabled, locationName: a.locationName ?? "", locationLat: a.locationLat === null ? "" : String(a.locationLat),
    locationLng: a.locationLng === null ? "" : String(a.locationLng), locationRadiusMeters: String(a.locationRadiusMeters), locationMaxAccuracyMeters: String(a.locationMaxAccuracyMeters),
    requestBackdateDays: String(a.requestBackdateDays), annualLeaveQuota: String(s.leave.annualLeaveQuota), allowNegativeLeaveBalance: s.leave.allowNegativeLeaveBalance,
  });
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((p) => ({ ...p, [k]: x }));
  const d = !canEdit || f.busy;
  const num = (x: string) => (x.trim() === "" ? null : Number(x.replace(",", ".")));
  return (
    <Card>
      <CardHeader title="Kebijakan absensi & cuti" description="Berlaku untuk seluruh karyawan. Hanya Super Admin yang dapat mengubah." actions={a.confirmedAt ? <Badge tone="green">Dikonfirmasi {formatDateTime(a.confirmedAt)}</Badge> : <Badge tone="amber">Nilai awal — perlu dikonfirmasi</Badge>} />
      <form className="grid gap-4 p-5 sm:grid-cols-2" aria-label="Form kebijakan" onSubmit={(e) => { e.preventDefault(); void f.run(() => api("/api/settings/attendance", { method: "PUT", body: { lateMinutesAfterTolerance: v.lateMinutesAfterTolerance, locationEnabled: v.locationEnabled, locationName: v.locationName, locationLat: num(v.locationLat), locationLng: num(v.locationLng), locationRadiusMeters: Number(v.locationRadiusMeters), locationMaxAccuracyMeters: Number(v.locationMaxAccuracyMeters), requestBackdateDays: Number(v.requestBackdateDays), annualLeaveQuota: Number(v.annualLeaveQuota), allowNegativeLeaveBalance: v.allowNegativeLeaveBalance } }), "Kebijakan disimpan dan dikonfirmasi."); }}>
        {f.error && <div className="sm:col-span-2"><Notice tone="danger">{f.error}</Notice></div>}
        <div className="sm:col-span-2">{check("Hitung menit keterlambatan setelah toleransi", v.lateMinutesAfterTolerance, (x) => set("lateMinutesAfterTolerance", x), d, "Nonaktif (default): menit terlambat dihitung dari jam masuk, mis. masuk 08.21 dengan jam 08.00 = 21 menit. Aktif: dihitung dari batas toleransi.")}</div>
        <TextField label="Kuota cuti tahunan (hari)" type="number" min={0} max={366} disabled={d} value={v.annualLeaveQuota} onChange={(e) => set("annualLeaveQuota", e.target.value)} error={f.fe.annualLeaveQuota} hint="Contoh 12. Sesuaikan dengan kebijakan perusahaan & ketentuan yang berlaku." />
        <TextField label="Batas pengajuan mundur (hari)" type="number" min={0} max={365} disabled={d} value={v.requestBackdateDays} onChange={(e) => set("requestBackdateDays", e.target.value)} error={f.fe.requestBackdateDays} hint="Izin/sakit/cuti boleh diajukan sampai sekian hari ke belakang." />
        <div className="sm:col-span-2">{check("Izinkan saldo cuti menjadi negatif", v.allowNegativeLeaveBalance, (x) => set("allowNegativeLeaveBalance", x), d)}</div>
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-ink-soft">Absensi berbasis lokasi (opsional)</legend>
          <div className="sm:col-span-2">{check("Aktifkan absensi berbasis lokasi", v.locationEnabled, (x) => set("locationEnabled", x), d, "Karyawan diminta izin lokasi satu kali saat check-in/out. Lokasi perangkat hanya alat bantu dan tidak menjamin pencegahan manipulasi sepenuhnya; tidak ada pelacakan terus-menerus dan tidak ada selfie.")}</div>
          <TextField label="Nama lokasi" disabled={d} value={v.locationName} onChange={(e) => set("locationName", e.target.value)} error={f.fe.locationName} placeholder="mis. Kantor Pusat" />
          <TextField label="Radius diizinkan (meter)" type="number" min={10} disabled={d} value={v.locationRadiusMeters} onChange={(e) => set("locationRadiusMeters", e.target.value)} error={f.fe.locationRadiusMeters} />
          <TextField label="Lintang (latitude)" inputMode="decimal" disabled={d} value={v.locationLat} onChange={(e) => set("locationLat", e.target.value)} error={f.fe.locationLat} placeholder="-7.795600" />
          <TextField label="Bujur (longitude)" inputMode="decimal" disabled={d} value={v.locationLng} onChange={(e) => set("locationLng", e.target.value)} error={f.fe.locationLng} placeholder="110.369500" />
          <TextField label="Akurasi GPS terburuk yang diterima (meter)" type="number" min={5} disabled={d} value={v.locationMaxAccuracyMeters} onChange={(e) => set("locationMaxAccuracyMeters", e.target.value)} error={f.fe.locationMaxAccuracyMeters} />
          <p className="self-end text-xs text-muted">Cara mengambil koordinat: buka Google Maps, klik lama pada titik kantor, salin angka lintang &amp; bujur.</p>
        </fieldset>
        {canEdit && <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={f.busy}>Simpan & konfirmasi</Button></div>}
      </form>
    </Card>
  );
}

export function PayrollRulesForm({ s, canEdit }: { s: SettingsDto; canEdit: boolean }) {
  const f = useForm();
  const p = s.payroll;
  const [v, setV] = useState({ ...p, absenceDivisor: p.absenceDivisor === null ? "" : String(p.absenceDivisor) });
  const set = <K extends keyof typeof v>(k: K, x: (typeof v)[K]) => setV((q) => ({ ...q, [k]: x }));
  const d = !canEdit || f.busy;
  const payload = () => ({
    lateMode: v.lateMode, lateAmount: v.lateAmount, absenceMode: v.absenceMode, absenceAmount: v.absenceAmount, absenceDivisor: v.absenceDivisor.trim() === "" ? null : Number(v.absenceDivisor),
    izinDeductsPay: v.izinDeductsPay, sakitDeductsPay: v.sakitDeductsPay, cutiDeductsPay: v.cutiDeductsPay, overtimeMode: v.overtimeMode, overtimeRatePerHour: v.overtimeRatePerHour,
    overtimeMinMinutes: v.overtimeMinMinutes, overtimeMaxMinutesPerDay: v.overtimeMaxMinutesPerDay,
    overtimeRateMode: v.overtimeRateMode, overtimeSalaryDivisor: v.overtimeSalaryDivisor, overtimeFirstHourBp: v.overtimeFirstHourBp,
    overtimeNextHoursBp: v.overtimeNextHoursBp, overtimeRequireAttendance: v.overtimeRequireAttendance,
  });
  return (
    <Card>
      <CardHeader title="Aturan penggajian" description="Default NONAKTIF — tidak ada tarif baku. BPJS, pajak, dan potongan lain diinput sebagai komponen gaji per karyawan."
        actions={p.confirmedAt ? <Badge tone="green">Dikonfirmasi {formatDateTime(p.confirmedAt)}</Badge> : <Badge tone="amber">Belum dikonfirmasi</Badge>} />
      <div className="p-5 pb-0"><Notice tone="warn"><strong>Perlu disesuaikan dengan kebijakan perusahaan dan ketentuan yang berlaku.</strong> Mengubah aturan mencabut konfirmasi; gaji tidak dapat disetujui sampai Super Admin memverifikasi dan mengonfirmasi ulang. Periode yang sudah dihitung/terbit tidak berubah.</Notice></div>
      <form className="grid gap-4 p-5 sm:grid-cols-2" aria-label="Form aturan penggajian" onSubmit={(e) => { e.preventDefault(); void f.run(() => api("/api/settings/payroll-rules", { method: "PUT", body: payload() }), "Aturan penggajian disimpan. Konfirmasi ulang diperlukan."); }}>
        {f.error && <div className="sm:col-span-2"><Notice tone="danger">{f.error}</Notice></div>}
        <SelectField label="Potongan keterlambatan" disabled={d} value={v.lateMode} onChange={(e) => set("lateMode", e.target.value as typeof v.lateMode)}>{Object.entries(LATE_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
        {v.lateMode !== "NONE" && <MoneyInput label={v.lateMode === "PER_MINUTE" ? "Nominal per menit" : "Nominal per kali"} disabled={d} value={v.lateAmount} onChange={(x) => set("lateAmount", x ?? 0)} error={f.fe.lateAmount} />}
        <SelectField label="Potongan ketidakhadiran" disabled={d} value={v.absenceMode} onChange={(e) => set("absenceMode", e.target.value as typeof v.absenceMode)}>{Object.entries(ABSENCE_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
        {v.absenceMode === "FIXED_PER_DAY" && <MoneyInput label="Nominal per hari" disabled={d} value={v.absenceAmount} onChange={(x) => set("absenceAmount", x ?? 0)} error={f.fe.absenceAmount} />}
        {v.absenceMode === "SALARY_DIVISOR" && <TextField label="Pembagi gaji pokok (hari)" type="number" min={1} max={31} disabled={d} value={v.absenceDivisor} onChange={(e) => set("absenceDivisor", e.target.value)} error={f.fe.absenceDivisor} hint="mis. jumlah hari kerja per bulan menurut kebijakan Anda" />}
        {v.absenceMode !== "NONE" && <fieldset className="rounded-md border border-line p-4 sm:col-span-2"><legend className="px-1 text-sm font-medium text-ink-soft">Hari berikut ikut dipotong seperti tidak hadir</legend>
          <div className="flex flex-wrap gap-x-6 gap-y-2">{check("Izin", v.izinDeductsPay, (x) => set("izinDeductsPay", x), d)}{check("Sakit", v.sakitDeductsPay, (x) => set("sakitDeductsPay", x), d)}{check("Cuti", v.cutiDeductsPay, (x) => set("cutiDeductsPay", x), d)}</div></fieldset>}
        <SelectField label="Lembur" disabled={d} value={v.overtimeMode} onChange={(e) => set("overtimeMode", e.target.value as typeof v.overtimeMode)}>{Object.entries(OVERTIME_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
        {v.overtimeMode !== "MANUAL" && <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-ink-soft">Tarif &amp; batas lembur</legend>
          <SelectField label="Tarif dasar per jam" disabled={d} value={v.overtimeRateMode} onChange={(e) => set("overtimeRateMode", e.target.value as typeof v.overtimeRateMode)}>{Object.entries(OVERTIME_RATE_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectField>
          {v.overtimeRateMode === "FIXED_PER_HOUR"
            ? <MoneyInput label="Tarif lembur per jam" disabled={d} value={v.overtimeRatePerHour} onChange={(x) => set("overtimeRatePerHour", x ?? 0)} error={f.fe.overtimeRatePerHour} />
            : <TextField label="Pembagi gaji pokok per jam" type="number" min={1} max={1000} disabled={d} value={String(v.overtimeSalaryDivisor)} onChange={(e) => set("overtimeSalaryDivisor", Number(e.target.value))} error={f.fe.overtimeSalaryDivisor} hint="Umum dipakai 173 (1/173 upah sebulan per jam). Verifikasi dengan ketentuan yang berlaku." />}
          <TextField label="Pengali jam lembur pertama (×)" inputMode="decimal" disabled={d} value={String(v.overtimeFirstHourBp / 10000).replace(".", ",")} onChange={(e) => set("overtimeFirstHourBp", Math.round(Number(e.target.value.replace(",", ".")) * 10000) || 0)} error={f.fe.overtimeFirstHourBp} hint="1 = tanpa pengali; mis. 1,5. Berlaku per hari." />
          <TextField label="Pengali jam berikutnya (×)" inputMode="decimal" disabled={d} value={String(v.overtimeNextHoursBp / 10000).replace(".", ",")} onChange={(e) => set("overtimeNextHoursBp", Math.round(Number(e.target.value.replace(",", ".")) * 10000) || 0)} error={f.fe.overtimeNextHoursBp} hint="mis. 2" />
          <TextField label="Minimal menit lembur per hari" type="number" min={0} disabled={d} value={String(v.overtimeMinMinutes)} onChange={(e) => set("overtimeMinMinutes", Number(e.target.value))} error={f.fe.overtimeMinMinutes} />
          <TextField label="Maksimal menit lembur per hari" type="number" min={0} disabled={d} value={String(v.overtimeMaxMinutesPerDay)} onChange={(e) => set("overtimeMaxMinutesPerDay", Number(e.target.value))} error={f.fe.overtimeMaxMinutesPerDay} />
          {v.overtimeMode === "APPROVED" && <div className="sm:col-span-2">{check("Bayar hanya sebesar yang terbukti di absensi", v.overtimeRequireAttendance, (x) => set("overtimeRequireAttendance", x), d, "Dibayar = yang terkecil antara menit disetujui dan menit check-out setelah jam pulang (hari non-kerja: seluruh jam kerja tercatat). Nonaktifkan hanya bila absensi tidak dapat diandalkan.")}</div>}
          {v.overtimeMode === "AUTO" && <div className="sm:col-span-2"><Notice tone="warn">Lembur otomatis dihitung dari jam check-out melewati jam pulang — <strong>tanpa</strong> persetujuan. Pilih &quot;Hanya lembur yang disetujui&quot; bila lembur memerlukan persetujuan atasan.</Notice></div>}
        </fieldset>}
        {canEdit && <div className="flex flex-wrap gap-2 sm:col-span-2"><Button type="submit" variant="primary" loading={f.busy}>Simpan aturan</Button>
          <Button disabled={f.busy || !!p.confirmedAt} onClick={() => void f.run(() => api("/api/settings/payroll-rules/confirm", { body: {} }), "Aturan penggajian dikonfirmasi.")}>{p.confirmedAt ? "Sudah dikonfirmasi" : "Saya sudah memverifikasi aturan ini"}</Button></div>}
      </form>
    </Card>
  );
}

// ─────────────────────────── BPJS & PPh 21 otomatis ───────────────────────────

const pctText = (bp: number) => String(bp / 100).replace(".", ",");
const toBp = (t: string) => Math.round(Number(t.replace(",", ".")) * 100);

export function StatutoryForm({ s, canEdit }: { s: SettingsDto; canEdit: boolean }) {
  const f = useForm();
  const c = s.statutory;
  const [bp, setBp] = useState(c.bpjs);
  const [pph, setPph] = useState({ enabled: c.pph21.enabled, noNpwp: String(c.pph21.noNpwpMultiplierBp / 100).replace(".", ","), bj: pctText(c.pph21.biayaJabatanBp), bjCap: c.pph21.biayaJabatanMonthlyCap, employerInsuranceInGross: c.pph21.employerInsuranceInGross });
  const tables = (x: StatutoryConfig) => JSON.stringify({ ptkp: x.pph21.ptkp, terCategoryOf: x.pph21.terCategoryOf, ter: x.pph21.ter, brackets: x.pph21.brackets }, null, 1);
  const [tablesJson, setTablesJson] = useState(() => tables(c));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const d = !canEdit || f.busy;
  const setB = <K extends keyof typeof bp>(k: K, x: (typeof bp)[K]) => setBp((p) => ({ ...p, [k]: x }));
  const bpField = (label: string, key: "healthEmployeeBp" | "healthEmployerBp" | "jhtEmployeeBp" | "jhtEmployerBp" | "jpEmployeeBp" | "jpEmployerBp" | "jkkEmployerBp" | "jkmEmployerBp", hint?: string) => (
    <TextField label={`${label} (%)`} inputMode="decimal" disabled={d} value={pctText(bp[key])} onChange={(e) => setB(key, toBp(e.target.value) || 0)} error={f.fe[`bpjs.${key}`]} hint={hint} />
  );

  function save() {
    setJsonError(null);
    let t: { ptkp: StatutoryConfig["pph21"]["ptkp"]; terCategoryOf: StatutoryConfig["pph21"]["terCategoryOf"]; ter: StatutoryConfig["pph21"]["ter"]; brackets: StatutoryConfig["pph21"]["brackets"] };
    try { t = JSON.parse(tablesJson); } catch { setJsonError("Tabel (JSON) tidak valid — periksa tanda kurung/koma, atau klik \"Pulihkan tabel bawaan\"."); return; }
    const body: StatutoryConfig = {
      version: 1, bpjs: bp,
      pph21: { enabled: pph.enabled, ...t, biayaJabatanBp: toBp(pph.bj) || 0, biayaJabatanMonthlyCap: pph.bjCap, noNpwpMultiplierBp: toBp(pph.noNpwp) || 0, employerInsuranceInGross: pph.employerInsuranceInGross },
    };
    void f.run(() => api("/api/settings/statutory", { method: "PUT", body }), "Konfigurasi BPJS & PPh 21 disimpan. Konfirmasi ulang aturan diperlukan.");
  }

  return (
    <Card>
      <CardHeader title="BPJS & PPh 21 otomatis" description="Menghitung potongan BPJS karyawan, beban BPJS perusahaan, dan PPh 21 (TER; true-up pada masa pajak terakhir). Nonaktif secara bawaan. Komponen potongan BPJS/Pajak manual per karyawan menggantikan perhitungan otomatis."
        actions={c.bpjs.enabled || c.pph21.enabled ? <Badge tone="blue">Aktif</Badge> : <Badge>Nonaktif</Badge>} />
      <div className="p-5 pb-0"><Notice tone="warn"><strong>Verifikasi sebelum dipakai.</strong> Tarif, batas upah (mis. batas upah JP berubah tiap tahun), PTKP, dan tabel TER di bawah adalah nilai awal berdasarkan ketentuan yang diketahui saat pengembangan — bukan nasihat pajak. Cocokkan dengan peraturan/lampiran terkini (PP 58/2023, PMK 168/2023, ketentuan BPJS) atau konsultan Anda. Menyimpan perubahan mencabut konfirmasi aturan penggajian.</Notice></div>
      <form className="space-y-4 p-5" aria-label="Form BPJS dan PPh 21" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {(f.error || jsonError) && <Notice tone="danger">{jsonError ?? f.error}</Notice>}
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-ink-soft">BPJS</legend>
          <div className="sm:col-span-2">{check("Hitung BPJS otomatis", bp.enabled, (x) => setB("enabled", x), d, "Dasar upah = komponen pendapatan bertanda \"dasar BPJS\" (bawaan: gaji pokok + tunjangan jabatan). Peserta diatur per karyawan.")}</div>
          {bpField("Kesehatan — porsi karyawan", "healthEmployeeBp")}{bpField("Kesehatan — porsi perusahaan", "healthEmployerBp")}
          <MoneyInput label="Batas upah Kesehatan" disabled={d} value={bp.healthWageCap} onChange={(x) => setB("healthWageCap", x ?? 0)} error={f.fe["bpjs.healthWageCap"]} />
          <span />
          {bpField("JHT — porsi karyawan", "jhtEmployeeBp")}{bpField("JHT — porsi perusahaan", "jhtEmployerBp")}
          {bpField("JP — porsi karyawan", "jpEmployeeBp")}{bpField("JP — porsi perusahaan", "jpEmployerBp")}
          <MoneyInput label="Batas upah JP" disabled={d} value={bp.jpWageCap} onChange={(x) => setB("jpWageCap", x ?? 0)} error={f.fe["bpjs.jpWageCap"]} hint="Diperbarui BPJS Ketenagakerjaan tiap tahun — sesuaikan." />
          <span />
          {bpField("JKK — perusahaan", "jkkEmployerBp", "Menurut kelas risiko tempat kerja (0,24%–1,74%)")}{bpField("JKM — perusahaan", "jkmEmployerBp")}
        </fieldset>
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-ink-soft">PPh 21</legend>
          <div className="sm:col-span-2">{check("Hitung PPh 21 otomatis", pph.enabled, (x) => setPph((p) => ({ ...p, enabled: x })), d, "Januari–November memakai tarif efektif (TER). Masa pajak terakhir (Desember / karyawan berhenti) dihitung setahun dengan tarif Pasal 17 dan dikurangi PPh yang sudah dipotong (butuh data penggajian disetujui/terbit bulan sebelumnya di sistem).")}</div>
          <TextField label="Biaya jabatan (%)" inputMode="decimal" disabled={d} value={pph.bj} onChange={(e) => setPph((p) => ({ ...p, bj: e.target.value }))} error={f.fe["pph21.biayaJabatanBp"]} />
          <MoneyInput label="Batas biaya jabatan per bulan" disabled={d} value={pph.bjCap} onChange={(x) => setPph((p) => ({ ...p, bjCap: x ?? 0 }))} error={f.fe["pph21.biayaJabatanMonthlyCap"]} />
          <TextField label="Pengali tarif tanpa NPWP (%)" inputMode="decimal" disabled={d} value={pph.noNpwp} onChange={(e) => setPph((p) => ({ ...p, noNpwp: e.target.value }))} error={f.fe["pph21.noNpwpMultiplierBp"]} hint="120 = tarif × 120%" />
          <div className="self-end">{check("Premi Kesehatan/JKK/JKM yang dibayar perusahaan ikut penghasilan bruto", pph.employerInsuranceInGross, (x) => setPph((p) => ({ ...p, employerInsuranceInGross: x })), d)}</div>
          <div className="sm:col-span-2 space-y-1.5">
            <label htmlFor="stat-tables" className="block text-sm font-medium text-ink-soft">Tabel PTKP, kategori TER, tabel TER (A/B/C), dan lapisan Pasal 17 (JSON)</label>
            <textarea id="stat-tables" rows={10} spellCheck={false} disabled={d} value={tablesJson} onChange={(e) => setTablesJson(e.target.value)} className="w-full rounded-md border border-line bg-white px-3 py-2 font-mono text-xs" />
            <p className="text-xs text-muted">Tarif dalam basis point (25 = 0,25%). Batas atas naik tegas; baris terakhir <code>upTo: null</code>. Kesalahan ditolak dengan pesan jelas saat disimpan.</p>
            {canEdit && <Button size="sm" disabled={f.busy} onClick={() => { setTablesJson(tables(defaultStatutoryConfig())); setJsonError(null); }}>Pulihkan tabel bawaan</Button>}
            {Object.entries(f.fe).filter(([k]) => k.startsWith("pph21.ter") || k.startsWith("pph21.brackets") || k.startsWith("pph21.ptkp") || k.startsWith("pph21.terCategoryOf")).slice(0, 3).map(([k, m]) => <p key={k} role="alert" className="text-xs font-medium text-brand-700">{m}</p>)}
          </div>
        </fieldset>
        {canEdit && <div className="flex flex-wrap gap-2"><Button type="submit" variant="primary" loading={f.busy}>Simpan konfigurasi</Button></div>}
      </form>
    </Card>
  );
}
