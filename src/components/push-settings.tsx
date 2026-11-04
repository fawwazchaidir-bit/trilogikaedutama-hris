"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BellRing, Monitor, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { currentEndpoint, disableThisBrowser, enableThisBrowser, pushPermission, type PushPermission } from "@/lib/push-client";
import type { PushStatusDto } from "@/server/services/push";

/** Kartu "Notifikasi desktop" di Keamanan & Notifikasi: aktifkan per peramban, daftar perangkat, matikan, dan pesan uji. Hanya untuk komputer desktop. */
export function PushSettingsCard({ status, email }: { status: PushStatusDto; email: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perm, setPerm] = useState<PushPermission>("default");
  const [here, setHere] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => { const p = pushPermission(); const e = await currentEndpoint().catch(() => null); if (alive) { setPerm(p); setHere(e); } })();
    return () => { alive = false; };
  }, [status.devices.length]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setError(null);
    try { await fn(); toast.success(ok); router.refresh(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const thisDevice = status.devices.find((d) => d.endpoint === here);

  return (
    <Card>
      <CardHeader title="Notifikasi desktop" description="Tampil sebagai notifikasi sistem di komputer Anda (pojok layar), termasuk saat tab portal tidak sedang dibuka — selama peramban berjalan. Tanpa biaya per pesan." />
      <div className="space-y-4 p-5 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        {perm === "mobile" ? <Notice tone="info">Notifikasi desktop hanya tersedia di komputer (laptop/PC). Di ponsel Anda tetap menerima notifikasi di dalam aplikasi (ikon lonceng).</Notice>
          : perm === "unsupported" ? <Notice tone="warn">Peramban ini tidak mendukung notifikasi push. Gunakan Chrome, Edge, Firefox, atau Safari versi terbaru melalui alamat https.</Notice>
          : !status.available ? <Notice tone="info">Notifikasi desktop belum diaktifkan oleh admin sistem (kunci VAPID belum diisi di server).</Notice>
          : (
            <>
              {perm === "denied" && <Notice tone="warn">Izin notifikasi untuk situs ini diblokir di peramban. Buka pengaturan situs (ikon gembok di bilah alamat) → Notifikasi → Izinkan, lalu muat ulang halaman.</Notice>}
              <div className="flex flex-wrap items-center gap-2">
                {!thisDevice ? (
                  <Button variant="primary" loading={busy} disabled={perm === "denied"} onClick={() => void run(() => enableThisBrowser(email, status.publicKey!), "Notifikasi desktop diaktifkan di browser ini.")}><BellRing className="size-4" />Aktifkan di browser ini</Button>
                ) : (
                  <Button loading={busy} onClick={() => void run(() => disableThisBrowser(email, { browser: true }), "Notifikasi desktop dimatikan di browser ini.")}>Matikan di browser ini</Button>
                )}
                <Button disabled={busy || status.devices.length === 0} onClick={() => void run(() => api("/api/account/notifications/test", { body: { channel: "PUSH" } }), "Notifikasi uji dikirim. Lihat pojok layar komputer Anda.")}>Kirim notifikasi uji</Button>
              </div>
            </>
          )}
        {status.devices.length > 0 && (
          <div>
            <p className="mb-1 font-medium text-ink">Perangkat yang aktif ({status.devices.length}/{status.maxDevices})</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {status.devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <span className="flex items-center gap-2"><Monitor className="size-4 text-muted" aria-hidden /><span><span className="font-medium text-ink">{d.label ?? "Peramban"}</span>{d.endpoint === here && <span className="ml-2 rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">Perangkat ini</span>}
                    <span className="block text-xs text-muted">Aktif sejak {formatDateTime(d.createdAt)}{d.lastSuccessAt ? ` · terakhir terkirim ${formatDateTime(d.lastSuccessAt)}` : ""}</span></span></span>
                  <Button size="sm" variant="danger" disabled={busy} aria-label={`Matikan ${d.label ?? "perangkat"}`} onClick={() => void run(() => api(`/api/push/devices/${d.id}`, { method: "DELETE" }), "Perangkat dimatikan.")}><Trash2 className="size-4" />Matikan</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="text-xs text-muted">Isi notifikasi (judul + ringkasan) dapat terbaca orang di dekat layar Anda — aktifkan hanya di komputer pribadi. Pesan dienkripsi untuk peramban Anda; layanan push peramban (Google/Mozilla/Apple/Microsoft) hanya menyampaikan data terenkripsi. Saat Anda keluar dari portal, perangkat ini otomatis berhenti menerima sampai Anda masuk lagi.</p>
      </div>
    </Card>
  );
}
