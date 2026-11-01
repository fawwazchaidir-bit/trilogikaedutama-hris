"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { Notice } from "@/components/ui/card";

type LoginResponse = { requiresTwoFactor: true; challenge: string } | { requiresTwoFactor: false; user: { mustChangePassword: boolean } };

export function LoginForm({ canReset }: { canReset: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = (mustChange: boolean) => { router.replace(mustChange ? "/change-password" : "/"); router.refresh(); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (challenge) {
        const res = await api<{ user: { mustChangePassword: boolean } }>("/api/auth/2fa", { body: { challenge, code } });
        done(res.user.mustChangePassword);
        return;
      }
      const res = await api<LoginResponse>("/api/auth/login", { body: { email, password } });
      if (res.requiresTwoFactor) { setChallenge(res.challenge); setPassword(""); setLoading(false); return; }
      done(res.user.mustChangePassword);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Gagal masuk. Coba lagi.");
      // Tantangan kedaluwarsa / habis percobaan → kembali ke langkah email & password.
      if (challenge && err instanceof ApiClientError && err.status === 401) { setChallenge(null); setCode(""); }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-8 shadow-sm" aria-label={challenge ? "Form verifikasi dua langkah" : "Form masuk"}>
      <div className="flex flex-col items-center gap-3 text-center">
        <Image src="/brand/logo.png" alt="Trilogika Edutama" width={72} height={72} priority unoptimized />
        <div>
          <h1 className="text-xl font-semibold text-ink">Trilogika Edutama</h1>
          <p className="text-sm text-muted">Mini HRIS · Absensi &amp; Penggajian</p>
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {challenge ? (
        <>
          <Notice tone="info">Masukkan kode 6 digit dari aplikasi autentikator Anda, atau salah satu kode pemulihan.</Notice>
          <TextField label="Kode verifikasi" name="code" autoComplete="one-time-code" inputMode="text" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          <Button type="submit" variant="primary" loading={loading} className="w-full">Verifikasi &amp; masuk</Button>
          <button type="button" className="block w-full text-center text-xs text-muted underline" onClick={() => { setChallenge(null); setCode(""); setError(null); }}>Kembali</button>
        </>
      ) : (
        <>
          <TextField label="Email" type="email" name="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Password" type="password" name="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" variant="primary" loading={loading} className="w-full">Masuk</Button>
          <p className="text-center text-xs text-muted">
            {canReset ? <>Lupa password? <Link href="/lupa-password" className="font-medium text-brand-700 underline">Atur ulang lewat email</Link>.</> : "Lupa password? Hubungi Admin/HR perusahaan Anda."}
          </p>
        </>
      )}
    </form>
  );
}
