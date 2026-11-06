"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Clock3, LogIn, LogOut, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { DayStatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { TextAreaField } from "@/components/ui/field";
import { PhotoCapture } from "@/components/photo-capture";
import { api, errorMessage } from "@/lib/api-client";
import { formatDateWithDay, dotTime } from "@/lib/format";
import type { TodayState } from "@/server/services/attendance";

/** Jam yang ditampilkan berasal dari jam SERVER (offset dihitung sekali saat dimuat) — bukan jam perangkat. */
function useServerClock(serverNow: string, timeZone: string) {
  const base = useRef<{ server: number; perf: number }>({ server: Date.parse(serverNow), perf: 0 });
  const [now, setNow] = useState(() => new Date(Date.parse(serverNow)));
  useEffect(() => {
    base.current = { server: Date.parse(serverNow), perf: performance.now() };
    const tick = () => setNow(new Date(base.current.server + (performance.now() - base.current.perf)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNow]);
  return new Intl.DateTimeFormat("id-ID", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now).replace(/\./g, ":");
}

/** Koordinat + waktu pembacaan (jam perangkat) agar server dapat menilai kesegaran pembacaan. */
function readLocation(): Promise<{ lat: number; lng: number; accuracy: number; timestamp: number; clientNow: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("Perangkat/browser Anda tidak mendukung lokasi."));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, timestamp: p.timestamp, clientNow: Date.now() }),
      (e) => reject(new Error(
        e.code === e.PERMISSION_DENIED ? "Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser/ponsel, lalu coba lagi."
          : e.code === e.TIMEOUT ? "Lokasi tidak berhasil dibaca (waktu habis). Pastikan GPS aktif dan coba lagi."
            : "Lokasi tidak tersedia. Pastikan GPS aktif dan coba lagi.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

export function AttendancePanel({ initial }: { initial: TodayState }) {
  const router = useRouter();
  const toast = useToast();
  // Hasil check-in/out langsung ditampilkan; begitu server mengirim state baru (router.refresh) override ini diabaikan.
  const [override, setOverride] = useState<{ forServerNow: string; state: TodayState } | null>(null);
  const state = override && override.forServerNow === initial.serverNow ? override.state : initial;
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clock = useServerClock(state.serverNow, state.timeZone);

  async function punch(kind: "in" | "out") {
    setBusy(kind);
    setError(null);
    try {
      const photoOn = state.photo.mode !== "OFF";
      if (photoOn && state.photo.mode === "REQUIRED" && !photo) throw new Error("Ambil foto absensi dulu (tombol Buka kamera), lalu tekan lagi.");
      // Lokasi dibaca bila absensi berbasis lokasi aktif, atau bila ada foto yang harus bercap lokasi (wajib → galat jelas bila gagal; tidak wajib → dicoba saja).
      const location = state.geo.enabled || (photo && state.photo.requireLocation) ? await readLocation() : photo ? await readLocation().catch(() => null) : null;
      const payload = { note: note.trim() || null, location };
      let next: TodayState;
      if (photo) {
        const form = new FormData();
        form.set("payload", JSON.stringify(payload));
        form.set("photo", photo, "absensi.jpg");
        next = await api<TodayState>(`/api/attendance/check-${kind}`, { form });
      } else {
        next = await api<TodayState>(`/api/attendance/check-${kind}`, { body: payload });
      }
      setOverride({ forServerNow: initial.serverNow, state: next });
      setNote("");
      setPhoto(null);
      toast.success(kind === "in" ? `Check-in tercatat pukul ${dotTime(next.day.checkInTime ?? "")} WIB.` : `Check-out tercatat pukul ${dotTime(next.day.checkOutTime ?? "")} WIB.`);
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const d = state.day;
  return (
    <Card>
      <CardHeader title="Absensi hari ini" description={state.workDate !== state.today ? `Shift ${formatDateWithDay(state.workDate)} masih berjalan` : formatDateWithDay(state.today)} />
      <div className="space-y-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="tabular text-4xl font-semibold tracking-tight text-ink" aria-live="off" data-testid="server-clock">{clock}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Clock3 className="size-3.5" />Waktu server · {state.timeZone === "Asia/Jakarta" ? "WIB" : state.timeZone}</p>
          </div>
          <div className="text-right text-sm">
            {state.schedule ? (
              <>
                <p className="font-medium text-ink">{state.schedule.name}</p>
                <p className="text-muted">{dotTime(state.schedule.startTime)} – {dotTime(state.schedule.endTime)}{state.schedule.endTime < state.schedule.startTime ? " (+1 hari)" : ""} · toleransi {state.schedule.lateToleranceMinutes} mnt</p>
              </>
            ) : <p className="text-muted">Tidak ada jadwal kerja</p>}
            <div className="mt-1.5 flex justify-end"><DayStatusBadge status={d.status} missingCheckout={d.missingCheckout} /></div>
          </div>
        </div>

        {d.duty && <Notice tone="info"><b>{d.duty.label}</b> ({d.duty.number}). Surat tugas bukan bukti hadir: tetap catat kehadiran sesuai kebijakan absensi.</Notice>}
        {!d.scheduled && d.status === "LIBUR" && <Notice tone="info">Hari ini {d.offReason?.toLowerCase() ?? "libur"}. Anda tetap dapat mencatat kehadiran bila bekerja.</Notice>}
        {state.blockedReason && <Notice tone="warn">{state.blockedReason}</Notice>}
        {!state.hasDefaultSchedule && <Notice tone="warn">Belum ada jadwal kerja yang berlaku untuk Anda. Hubungi Admin/HR.</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border border-line bg-canvas/60 p-3"><dt className="text-xs text-muted">Check-in</dt><dd className="tabular mt-0.5 text-lg font-semibold">{d.checkInTime ? dotTime(d.checkInTime) : "—"}{d.checkInNextDay && <span className="ml-1 text-xs font-normal text-muted">(+1 hari)</span>}</dd></div>
          <div className="rounded-md border border-line bg-canvas/60 p-3"><dt className="text-xs text-muted">Check-out</dt><dd className="tabular mt-0.5 text-lg font-semibold">{d.checkOutTime ? dotTime(d.checkOutTime) : "—"}{d.checkOutNextDay && <span className="ml-1 text-xs font-normal text-muted">(+1 hari)</span>}</dd></div>
        </dl>
        {d.checkInTime && <p className="text-xs text-muted">{d.explain}</p>}

        {(state.canCheckIn || state.canCheckOut) && (
          <TextAreaField label="Catatan (opsional)" rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="mis. bekerja dari lokasi klien" />
        )}
        {state.photo.mode !== "OFF" && (state.canCheckIn || state.canCheckOut) && (
          <div className="space-y-2 rounded-md border border-line p-3">
            <PhotoCapture value={photo} onChange={setPhoto} required={state.photo.mode === "REQUIRED"} disabled={busy !== null} />
            <p className="flex items-start gap-1.5 text-xs text-muted"><MapPin className="mt-0.5 size-3.5 shrink-0" />
              Foto dicap <strong className="mx-0.5 font-medium">waktu server</strong>{state.photo.requireLocation ? " dan koordinat lokasi Anda" : " (dan koordinat bila tersedia)"} oleh server, sehingga cocok untuk dinas luar. Tanpa syarat Wi-Fi/jaringan kantor.
              Browser akan meminta izin kamera{state.photo.requireLocation ? " dan lokasi" : ""}.
            </p>
          </div>
        )}
        {state.geo.enabled && (state.canCheckIn || state.canCheckOut) && (
          <p className="flex items-start gap-1.5 text-xs text-muted"><MapPin className="mt-0.5 size-3.5 shrink-0" />
            Absensi berbasis lokasi aktif{state.geo.name ? ` (${state.geo.name})` : ""}: browser akan meminta izin lokasi satu kali saat Anda menekan tombol. Radius {state.geo.radiusMeters} m.
            Lokasi dibaca sekali dan diperiksa kewajarannya (mis. terhadap aplikasi lokasi palsu); tidak dilacak terus-menerus.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Button variant="primary" className="h-12 text-base" disabled={!state.canCheckIn} loading={busy === "in"} onClick={() => punch("in")}><LogIn className="size-5" />Check-in</Button>
          <Button className="h-12 text-base" disabled={!state.canCheckOut} loading={busy === "out"} onClick={() => punch("out")}><LogOut className="size-5" />Check-out</Button>
        </div>
      </div>
    </Card>
  );
}
