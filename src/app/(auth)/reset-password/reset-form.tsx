"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { PasswordField, TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/card";

export function ResetForm({ token, valid, needsTwoFactor }: { token: string; valid: boolean; needsTwoFactor: boolean }) {
  const router = useRouter();
  const [form, setForm] = useState({ newPassword: "", confirm: "", code: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (form.newPassword !== form.confirm) { setErrors({ confirm: "Konfirmasi password tidak sama." }); return; }
    setLoading(true); setErrors({});
    try {
      await api("/api/auth/reset", { body: { token, newPassword: form.newPassword, ...(needsTwoFactor ? { code: form.code } : {}) } });
      setDone(true);
      setTimeout(() => router.replace("/login"), 2500);
    } catch (err) {
      if (err instanceof ApiClientError) { setErrors(err.fieldErrors); setMessage(Object.keys(err.fieldErrors).length ? null : err.message); }
      setLoading(false);
    }
  }

  if (!valid && !done) {
    return (
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Tautan tidak berlaku</h1>
        <Notice tone="danger">Tautan pengaturan ulang tidak valid, sudah dipakai, atau kedaluwarsa.</Notice>
        <Link href="/lupa-password" className="inline-flex h-10 w-full items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Minta tautan baru</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-8 shadow-sm" aria-label="Form atur ulang password">
      <div>
        <h1 className="text-xl font-semibold text-ink">Atur ulang password</h1>
        <p className="mt-1 text-sm text-muted">Gunakan minimal 12 karakter. Setelah berhasil, semua sesi Anda diakhiri dan Anda masuk dengan password baru.</p>
      </div>
      {done && <Notice tone="success">Password berhasil diubah. Mengarahkan ke halaman masuk…</Notice>}
      {message && <Notice tone="danger">{message}</Notice>}
      {!done && (
        <>
          <PasswordField label="Password baru" autoComplete="new-password" required minLength={12} autoFocus value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} error={errors.newPassword} hint="Minimal 12 karakter, bukan password umum." />
          <PasswordField label="Ulangi password baru" autoComplete="new-password" required value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} />
          {needsTwoFactor && <TextField label="Kode verifikasi (2FA)" autoComplete="one-time-code" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} error={errors.code} hint="Kode 6 digit dari aplikasi autentikator, atau kode pemulihan." />}
          <Button type="submit" variant="primary" loading={loading} className="w-full">Simpan password baru</Button>
        </>
      )}
    </form>
  );
}
