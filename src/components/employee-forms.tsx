"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, Eye, KeyRound, Pencil, Plus, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { PasswordField, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { uploadFile } from "@/components/upload";
import { EMPLOYMENT_LABEL, type EmploymentStatus } from "@/lib/labels";
import { TAX_STATUSES, TAX_STATUS_LABEL, type TaxStatus } from "@/lib/statutory";
import type { EmployeeDto } from "@/server/services/employees";

interface Div { id: string; name: string }
type Form = {
  employeeNo: string; fullName: string; divisionId: string; position: string; employmentStatus: EmploymentStatus; joinDate: string;
  phone: string; email: string; address: string; bankName: string; bankAccountNo: string; clearBank: boolean; bankAccountHolder: string; notes: string;
  emergencyContactName: string; emergencyContactRelation: string; emergencyContactPhone: string;
  taxStatus: TaxStatus; hasNpwp: boolean; bpjsHealthEnrolled: boolean; bpjsEmploymentEnrolled: boolean;
};

const blank = (today: string): Form => ({
  employeeNo: "", fullName: "", divisionId: "", position: "", employmentStatus: "PERMANENT", joinDate: today, phone: "", email: "", address: "",
  bankName: "", bankAccountNo: "", clearBank: false, bankAccountHolder: "", notes: "",
  emergencyContactName: "", emergencyContactRelation: "", emergencyContactPhone: "",
  taxStatus: "TK0", hasNpwp: true, bpjsHealthEnrolled: true, bpjsEmploymentEnrolled: true,
});
const fromDto = (e: EmployeeDto): Form => ({
  employeeNo: e.employeeNo, fullName: e.fullName, divisionId: e.divisionId ?? "", position: e.position, employmentStatus: e.employmentStatus, joinDate: e.joinDate,
  phone: e.phone ?? "", email: e.email ?? "", address: e.address ?? "", bankName: e.bankName ?? "", bankAccountNo: "", clearBank: false,
  bankAccountHolder: e.bankAccountHolder ?? "", notes: e.notes ?? "",
  emergencyContactName: e.emergencyContactName ?? "", emergencyContactRelation: e.emergencyContactRelation ?? "", emergencyContactPhone: e.emergencyContactPhone ?? "",
  taxStatus: e.taxStatus, hasNpwp: e.hasNpwp, bpjsHealthEnrolled: e.bpjsHealthEnrolled, bpjsEmploymentEnrolled: e.bpjsEmploymentEnrolled,
});

export function EmployeeFormDialog({ open, onClose, employee, divisions, today }: { open: boolean; onClose: () => void; employee: EmployeeDto | null; divisions: Div[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => (employee ? fromDto(employee) : blank(today)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true); setError(null); setFe({});
    const body = {
      employeeNo: form.employeeNo, fullName: form.fullName, divisionId: form.divisionId || null, position: form.position, employmentStatus: form.employmentStatus,
      joinDate: form.joinDate, phone: form.phone, email: form.email, address: form.address, bankName: form.bankName, bankAccountHolder: form.bankAccountHolder, notes: form.notes,
      emergencyContactName: form.emergencyContactName, emergencyContactRelation: form.emergencyContactRelation, emergencyContactPhone: form.emergencyContactPhone,
      taxStatus: form.taxStatus, hasNpwp: form.hasNpwp, bpjsHealthEnrolled: form.bpjsHealthEnrolled, bpjsEmploymentEnrolled: form.bpjsEmploymentEnrolled,
      ...(form.clearBank ? { bankAccountNo: null } : form.bankAccountNo.trim() ? { bankAccountNo: form.bankAccountNo.trim() } : {}),
    };
    try {
      if (employee) await api(`/api/employees/${employee.id}`, { method: "PUT", body });
      else await api("/api/employees", { body });
      toast.success(employee ? "Data karyawan diperbarui." : "Karyawan ditambahkan.");
      onClose(); router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      if (e instanceof ApiClientError) setFe(e.fieldErrors);
    } finally { setBusy(false); }
  }

  return (
    <Dialog open={open} onClose={() => !busy && onClose()} size="lg" title={employee ? `Ubah data — ${employee.fullName}` : "Tambah karyawan"}
      footer={<><Button onClick={onClose} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
        <TextField label="Nomor induk karyawan" required value={form.employeeNo} onChange={(e) => set("employeeNo", e.target.value)} error={fe.employeeNo} hint="Unik, mis. TE-001" />
        <TextField label="Nama lengkap" required value={form.fullName} onChange={(e) => set("fullName", e.target.value)} error={fe.fullName} />
        <SelectField label="Divisi" value={form.divisionId} onChange={(e) => set("divisionId", e.target.value)} error={fe.divisionId}>
          <option value="">— Tanpa divisi —</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </SelectField>
        <TextField label="Jabatan" required value={form.position} onChange={(e) => set("position", e.target.value)} error={fe.position} />
        <SelectField label="Status karyawan" required value={form.employmentStatus}
          onChange={(e) => { const v = e.target.value as EmploymentStatus; setForm((f) => ({ ...f, employmentStatus: v, ...(employee ? {} : { bpjsHealthEnrolled: v !== "INTERN", bpjsEmploymentEnrolled: v !== "INTERN" }) })); }} error={fe.employmentStatus}>
          {(Object.keys(EMPLOYMENT_LABEL) as EmploymentStatus[]).map((s) => <option key={s} value={s}>{EMPLOYMENT_LABEL[s]}</option>)}
        </SelectField>
        <TextField label="Tanggal mulai bekerja" type="date" required value={form.joinDate} onChange={(e) => set("joinDate", e.target.value)} error={fe.joinDate} />
        <TextField label="Telepon" inputMode="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} error={fe.phone} />
        <TextField label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} error={fe.email} />
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium text-ink-soft">Kontak darurat (dilengkapi saat karyawan masuk)</legend>
          <TextField label="Nama" value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} error={fe.emergencyContactName} />
          <TextField label="Hubungan" placeholder="Mis. istri, orang tua" value={form.emergencyContactRelation} onChange={(e) => set("emergencyContactRelation", e.target.value)} error={fe.emergencyContactRelation} />
          <TextField label="Telepon" inputMode="tel" value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} error={fe.emergencyContactPhone} />
        </fieldset>
        <div className="sm:col-span-2"><TextAreaField label="Alamat" rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} error={fe.address} /></div>
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:col-span-2 sm:grid-cols-3">
          <legend className="px-1 text-sm font-medium text-ink-soft">Rekening pembayaran gaji (opsional)</legend>
          <TextField label="Nama bank" value={form.bankName} onChange={(e) => set("bankName", e.target.value)} error={fe.bankName} />
          <TextField label="Nomor rekening" inputMode="numeric" value={form.bankAccountNo} disabled={form.clearBank} onChange={(e) => set("bankAccountNo", e.target.value)} error={fe.bankAccountNo}
            placeholder={employee?.bankAccountMasked ? "Kosongkan jika tidak diubah" : ""} hint="Disimpan terenkripsi" />
          <TextField label="Nama pemilik rekening" value={form.bankAccountHolder} onChange={(e) => set("bankAccountHolder", e.target.value)} error={fe.bankAccountHolder} />
          {employee?.bankAccountMasked && <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" checked={form.clearBank} onChange={(e) => set("clearBank", e.target.checked)} />Hapus nomor rekening tersimpan ({employee.bankAccountMasked})</label>}
        </fieldset>
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium text-ink-soft">Pajak &amp; BPJS (untuk perhitungan otomatis)</legend>
          <SelectField label="Status PTKP" value={form.taxStatus} onChange={(e) => set("taxStatus", e.target.value as TaxStatus)} error={fe.taxStatus} hint="Menentukan kategori TER dan PTKP PPh 21.">
            {TAX_STATUSES.map((s) => <option key={s} value={s}>{TAX_STATUS_LABEL[s]}</option>)}
          </SelectField>
          <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.hasNpwp} onChange={(e) => set("hasNpwp", e.target.checked)} />Memiliki NPWP / NIK terdaftar (tanpa NPWP: tarif PPh 21 lebih tinggi)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.bpjsHealthEnrolled} onChange={(e) => set("bpjsHealthEnrolled", e.target.checked)} />Peserta BPJS Kesehatan</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.bpjsEmploymentEnrolled} onChange={(e) => set("bpjsEmploymentEnrolled", e.target.checked)} />Peserta BPJS Ketenagakerjaan (JHT, JP, JKK, JKM)</label>
          </div>
        </fieldset>
        <div className="sm:col-span-2"><TextAreaField label="Catatan internal" rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} error={fe.notes} /></div>
      </div>
    </Dialog>
  );
}

export function AddEmployeeButton({ divisions, today }: { divisions: Div[]; today: string }) {
  const [open, setOpen] = useState(false);
  return (<><Button variant="primary" onClick={() => setOpen(true)}><Plus className="size-4" />Tambah karyawan</Button>{open && <EmployeeFormDialog open onClose={() => setOpen(false)} employee={null} divisions={divisions} today={today} />}</>);
}

/** Aksi pada halaman detail karyawan. */
export function EmployeeActions({ employee, divisions, today, canManage, canCreateAccount }: { employee: EmployeeDto; divisions: Div[]; today: string; canManage: boolean; canCreateAccount: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [dlg, setDlg] = useState<null | "edit" | "deactivate" | "account" | "bank">(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [deact, setDeact] = useState({ endDate: today, reason: "" });
  const [acct, setAcct] = useState({ email: employee.email ?? "", password: "" });
  const [bank, setBank] = useState<{ bankName: string | null; accountNo: string | null; holder: string | null } | null>(null);
  const close = () => { setDlg(null); setError(null); setFe({}); setBank(null); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); close(); router.refresh(); }
    catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); }
    finally { setBusy(false); }
  }
  async function onPhoto(f: File | null) {
    if (!f) return;
    await run(() => uploadFile(`/api/employees/${employee.id}/photo`, f), "Foto profil diperbarui.");
  }
  if (!canManage) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={() => setDlg("edit")}><Pencil className="size-4" />Ubah data</Button>
      <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas">
        <Camera className="size-4" />Foto<input type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Unggah foto profil" onChange={(e) => void onPhoto(e.target.files?.[0] ?? null)} />
      </label>
      {employee.bankAccountMasked && <Button onClick={async () => { setBusy(true); try { setBank(await api(`/api/employees/${employee.id}/reveal-bank`, { body: {} })); setDlg("bank"); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }} loading={busy}><Eye className="size-4" />Lihat rekening</Button>}
      {canCreateAccount && !employee.userId && employee.isActive && <Button onClick={() => setDlg("account")}><KeyRound className="size-4" />Buat akun login</Button>}
      {employee.isActive
        ? <Button variant="danger" onClick={() => setDlg("deactivate")}><UserX className="size-4" />Nonaktifkan</Button>
        : <Button onClick={() => void run(() => api(`/api/employees/${employee.id}/reactivate`, { body: {} }), "Karyawan diaktifkan kembali.")}><UserCheck className="size-4" />Aktifkan kembali</Button>}

      {dlg === "edit" && <EmployeeFormDialog open onClose={close} employee={employee} divisions={divisions} today={today} />}

      <Dialog open={dlg === "deactivate"} onClose={() => !busy && close()} size="sm" title={`Nonaktifkan ${employee.fullName}?`} description="Data tidak dihapus. Akun login dinonaktifkan dan sesi diakhiri. Hari setelah tanggal berhenti tidak dihitung dalam rekap & gaji."
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant="danger" loading={busy} onClick={() => void run(() => api(`/api/employees/${employee.id}/deactivate`, { body: deact }), "Karyawan dinonaktifkan.")}>Nonaktifkan</Button></>}>
        <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Tanggal berhenti" type="date" required value={deact.endDate} onChange={(e) => setDeact({ ...deact, endDate: e.target.value })} error={fe.endDate} hint="Hari terakhir masih dihitung." />
          <TextAreaField label="Alasan (opsional)" rows={2} value={deact.reason} onChange={(e) => setDeact({ ...deact, reason: e.target.value })} /></div>
      </Dialog>

      <Dialog open={dlg === "account"} onClose={() => !busy && close()} size="sm" title="Buat akun login karyawan" description="Karyawan wajib mengganti password sementara saat login pertama."
        footer={<><Button onClick={close} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={() => void run(() => api("/api/users", { body: { email: acct.email, name: employee.fullName, role: "EMPLOYEE", password: acct.password, employeeId: employee.id } }), "Akun login dibuat.")}>Buat akun</Button></>}>
        <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Email login" type="email" required value={acct.email} onChange={(e) => setAcct({ ...acct, email: e.target.value })} error={fe.email} />
          <PasswordField label="Password sementara" autoComplete="new-password" required value={acct.password} onChange={(e) => setAcct({ ...acct, password: e.target.value })} error={fe.password} hint="Minimal 12 karakter. Sampaikan lewat kanal aman." /></div>
      </Dialog>

      <Dialog open={dlg === "bank" && !!bank} onClose={close} size="sm" title="Rekening pembayaran gaji" description="Pembukaan nomor lengkap dicatat di audit log. Jangan dibagikan."
        footer={<Button onClick={close}>Tutup</Button>}>
        {bank && <dl className="space-y-2 text-sm"><div><dt className="text-muted">Bank</dt><dd className="font-medium">{bank.bankName ?? "—"}</dd></div><div><dt className="text-muted">Nomor rekening</dt><dd className="tabular font-mono text-base font-semibold">{bank.accountNo ?? "—"}</dd></div><div><dt className="text-muted">Atas nama</dt><dd className="font-medium">{bank.holder ?? "—"}</dd></div></dl>}
      </Dialog>
    </div>
  );
}
