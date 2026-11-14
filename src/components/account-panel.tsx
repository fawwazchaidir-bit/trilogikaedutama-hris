"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PasswordField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { formatWhatsappNumber } from "@/lib/phone";
import type { AccountDto } from "@/server/services/account";
import type { TwoFactorSetup } from "@/server/services/two-factor";

function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function run<T>(fn: () => Promise<T>, ok?: string, done?: (r: T) => void) {
    setBusy(true); setError(null); setFe({});
    try { const r = await fn(); if (ok) toast.success(ok); done?.(r); router.refresh(); }
    catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); }
    finally { setBusy(false); }
  }
  return { busy, error, fe, run, setError, toast };
}

function RecoveryCodes({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const toast = useToast();
  return (
    <div className="space-y-3" role="region" aria-label="Kode pemulihan">
      <Notice tone="warn"><strong>Simpan kode pemulihan ini sekarang.</strong> Masing-masing hanya berlaku sekali dan <strong>tidak akan ditampilkan lagi</strong>. Gunakan bila ponsel hilang atau aplikasi autentikator tidak dapat dipakai.</Notice>
      <ul className="grid grid-cols-2 gap-2 rounded-md border border-line bg-canvas p-4 font-mono text-sm sm:grid-cols-5" data-testid="recovery-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void navigator.clipboard.writeText(codes.join("\n")).then(() => toast.success("Kode disalin."))}><Copy className="size-3.5" />Salin</Button>
        <Button size="sm" variant="primary" onClick={onClose}>Sudah saya simpan</Button>
      </div>
    </div>
  );
}

export function TwoFactorCard({ account, forced }: { account: AccountDto; forced: boolean }) {
  const f = useRun();
  const tf = account.twoFactor;
  const [step, setStep] = useState<"idle" | "password" | "scan" | "codes" | "disable" | "regen">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const reset = () => { setStep("idle"); setPassword(""); setCode(""); setSetup(null); f.setError(null); };

  return (
    <Card>
      <CardHeader title="Autentikasi dua langkah (2FA)" description="Tambahan keamanan: selain password, masuk memerlukan kode 6 digit dari aplikasi autentikator (Google Authenticator, Microsoft Authenticator, Authy, 1Password, dll.)."
        actions={tf.enabled ? <Badge tone="green"><ShieldCheck className="mr-1 size-3" />Aktif</Badge> : <Badge tone={tf.required ? "red" : "gray"}>{tf.required ? "Wajib — belum aktif" : "Nonaktif"}</Badge>} />
      <div className="space-y-4 p-5 text-sm">
        {forced && !tf.enabled && <Notice tone="danger">Kebijakan perusahaan <strong>mewajibkan 2FA</strong> untuk akun Direktur dan HR. Aktifkan sekarang untuk melanjutkan memakai aplikasi.</Notice>}
        {f.error && <Notice tone="danger">{f.error}</Notice>}

        {step === "codes" && <RecoveryCodes codes={codes} onClose={() => { reset(); window.location.reload(); }} />}

        {step === "idle" && !tf.enabled && <Button variant="primary" onClick={() => setStep("password")}><KeyRound className="size-4" />Aktifkan 2FA</Button>}
        {step === "idle" && tf.enabled && (
          <div className="space-y-3">
            <p className="text-muted">Aktif sejak {formatDateTime(tf.enabledAt)}. Kode pemulihan tersisa: <strong className={tf.recoveryRemaining <= 2 ? "text-brand-700" : "text-ink"}>{tf.recoveryRemaining}</strong> dari 10.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setStep("regen")}>Buat ulang kode pemulihan</Button>
              {!tf.required && <Button variant="danger" onClick={() => setStep("disable")}>Matikan 2FA</Button>}
            </div>
            {tf.required && <p className="text-xs text-muted">2FA diwajibkan perusahaan untuk akun Direktur dan HR sehingga tidak dapat dimatikan. Bila ponsel hilang, hubungi Super Admin.</p>}
          </div>
        )}

        {step === "password" && (
          <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); void f.run(() => api<TwoFactorSetup>("/api/account/2fa/setup", { body: { password } }), undefined, (r) => { setSetup(r); setStep("scan"); setPassword(""); }); }}>
            <PasswordField label="Konfirmasi dengan password Anda" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} error={f.fe.password} />
            <div className="flex gap-2"><Button type="submit" variant="primary" loading={f.busy}>Lanjut</Button><Button onClick={reset} disabled={f.busy}>Batal</Button></div>
          </form>
        )}

        {step === "scan" && setup && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void f.run(() => api<{ recoveryCodes: string[] }>("/api/account/2fa/enable", { body: { code } }), "Autentikasi dua langkah aktif.", (r) => { setCodes(r.recoveryCodes); setStep("codes"); setCode(""); }); }}>
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>Buka aplikasi autentikator di ponsel, pilih <em>tambah akun</em>, lalu pindai kode QR ini.</li>
              <li>Tidak bisa memindai? Masukkan kunci ini secara manual (jenis: berbasis waktu).</li>
              <li>Masukkan kode 6 digit yang tampil di aplikasi untuk mengonfirmasi.</li>
            </ol>
            <div className="flex flex-wrap items-start gap-6">
              <div className="size-48 shrink-0 rounded-md border border-line bg-white p-2 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label="Kode QR untuk aplikasi autentikator" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
              <div className="min-w-0 space-y-3">
                <div><p className="text-xs text-muted">Kunci manual</p><p className="break-all font-mono text-sm font-semibold tracking-wider" data-testid="totp-secret">{setup.secret.match(/.{1,4}/g)?.join(" ")}</p></div>
                <TextField label="Kode 6 digit" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} error={f.fe.code} className="w-48" />
                <div className="flex gap-2"><Button type="submit" variant="primary" loading={f.busy}>Konfirmasi &amp; aktifkan</Button><Button onClick={reset} disabled={f.busy}>Batal</Button></div>
              </div>
            </div>
          </form>
        )}

        {(step === "disable" || step === "regen") && (
          <form className="max-w-sm space-y-3" onSubmit={(e) => {
            e.preventDefault();
            if (step === "disable") void f.run(() => api("/api/account/2fa/disable", { body: { password, code } }), "2FA dimatikan.", reset);
            else void f.run(() => api<{ recoveryCodes: string[] }>("/api/account/2fa/recovery", { body: { password, code } }), "Kode pemulihan baru dibuat.", (r) => { setCodes(r.recoveryCodes); setStep("codes"); setPassword(""); setCode(""); });
          }}>
            <Notice tone="info">{step === "disable" ? "Masukkan password dan kode dari aplikasi autentikator untuk mematikan 2FA." : "Kode pemulihan lama akan hangus. Masukkan password dan kode dari aplikasi autentikator."}</Notice>
            <PasswordField label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} error={f.fe.password} />
            <TextField label="Kode 6 digit" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} error={f.fe.code} />
            <div className="flex gap-2"><Button type="submit" variant={step === "disable" ? "danger" : "primary"} loading={f.busy}>{step === "disable" ? "Matikan 2FA" : "Buat ulang"}</Button><Button onClick={reset} disabled={f.busy}>Batal</Button></div>
          </form>
        )}
      </div>
    </Card>
  );
}

export function NotificationPrefsCard({ account }: { account: AccountDto }) {
  const f = useRun();
  const n = account.notifications;
  const [v, setV] = useState({ email: n.email, whatsapp: n.whatsapp, number: n.whatsappNumber ? `0${n.whatsappNumber.replace(/^62/, "")}` : "" });
  const save = () => f.run(() => api("/api/account/notifications", { method: "PUT", body: { notifyEmail: v.email, notifyWhatsapp: v.whatsapp, whatsappNumber: v.number.trim() === "" ? null : v.number } }), "Preferensi notifikasi disimpan.");
  const test = (channel: "EMAIL" | "WHATSAPP") => f.run(() => api("/api/account/notifications/test", { body: { channel } }), channel === "EMAIL" ? "Email uji dikirim. Periksa kotak masuk Anda." : "Pesan WhatsApp uji dikirim.");
  return (
    <Card>
      <CardHeader title="Notifikasi" description="Notifikasi di dalam aplikasi (ikon lonceng) selalu aktif. Anda juga dapat menerimanya lewat email dan/atau WhatsApp." />
      <div className="space-y-4 p-5 text-sm">
        {f.error && <Notice tone="danger">{f.error}</Notice>}
        <div className="space-y-2">
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={v.email} disabled={!n.emailAvailable} onChange={(e) => setV({ ...v, email: e.target.checked })} />
            <span>Kirim ke email <strong>{account.email}</strong>{!n.emailAvailable && <span className="block text-xs text-muted">Email belum dikonfigurasi di server (hubungi admin sistem).</span>}</span></label>
          <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={v.whatsapp} disabled={!n.whatsappAvailable} onChange={(e) => setV({ ...v, whatsapp: e.target.checked })} />
            <span>Kirim ke WhatsApp{!n.whatsappAvailable && <span className="block text-xs text-muted">WhatsApp belum dikonfigurasi di server (hubungi admin sistem).</span>}</span></label>
        </div>
        {n.whatsappAvailable && <TextField label="Nomor WhatsApp" inputMode="tel" value={v.number} onChange={(e) => setV({ ...v, number: e.target.value })} error={f.fe.whatsappNumber} placeholder="0812-3456-7890" hint={n.whatsappNumber ? `Tersimpan: ${formatWhatsappNumber(n.whatsappNumber)}` : "Format Indonesia atau internasional (+62…)."} className="max-w-xs" />}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" loading={f.busy} onClick={() => void save()}>Simpan</Button>
          {n.emailAvailable && <Button disabled={f.busy} onClick={() => void test("EMAIL")}>Kirim email uji</Button>}
          {n.whatsappAvailable && <Button disabled={f.busy || !n.whatsappNumber} onClick={() => void test("WHATSAPP")}>Kirim WhatsApp uji</Button>}
        </div>
        <p className="text-xs text-muted">Pesan email/WhatsApp hanya berisi ringkasan dan tautan — angka gaji tidak pernah dikirim. Rincian selalu dibuka di aplikasi setelah masuk.</p>
      </div>
    </Card>
  );
}

export function PasswordCard() {
  return (
    <Card>
      <CardHeader title="Password" description="Ganti password secara berkala. Sesi di perangkat lain akan diakhiri." />
      <div className="p-5"><Link href="/change-password" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas"><KeyRound className="size-4" />Ganti password</Link></div>
    </Card>
  );
}
