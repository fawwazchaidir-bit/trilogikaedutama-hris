"use client";
import Link from "next/link";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/card";

export function ForgotForm({ enabled }: { enabled: boolean }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try { setMessage((await api<{ message: string }>("/api/auth/forgot", { body: { email } })).message); }
    catch (err) { setError(err instanceof ApiClientError ? err.message : "Gagal mengirim permintaan. Coba lagi."); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-8 shadow-sm" aria-label="Form lupa password">
      <div>
        <h1 className="text-xl font-semibold text-ink">Lupa password</h1>
        <p className="mt-1 text-sm text-muted">Masukkan email akun Anda. Kami mengirim tautan pengaturan ulang yang berlaku singkat dan hanya sekali pakai.</p>
      </div>
      {!enabled && <Notice tone="warn">Fitur ini belum diaktifkan (email server belum dikonfigurasi). Hubungi Admin/HR untuk mengatur ulang password Anda.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {enabled && !message && (
        <>
          <TextField label="Email" type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" variant="primary" loading={loading} className="w-full">Kirim tautan</Button>
        </>
      )}
      <Link href="/login" className="block text-center text-sm text-brand-700 underline">Kembali ke halaman masuk</Link>
    </form>
  );
}
