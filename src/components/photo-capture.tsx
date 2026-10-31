"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, RefreshCcw, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";

const MAX_SIDE = 1280;

/** Perkecil foto (mis. dari aplikasi kamera ponsel yang 12 MP) ke JPEG ≤ 1280 px; EXIF dibuang, orientasi diterapkan. */
async function downscale(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Foto gagal diproses."))), "image/jpeg", 0.85));
}

const cameraError = (e: unknown) => {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Izin kamera ditolak. Aktifkan izin kamera untuk situs ini di pengaturan browser/ponsel, lalu coba lagi.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "Kamera tidak ditemukan di perangkat ini.";
  return "Kamera tidak dapat dibuka. Tutup aplikasi lain yang memakai kamera, lalu coba lagi.";
};

/**
 * Foto absensi: kamera langsung (tanpa memilih dari galeri) agar foto diambil saat absen. Server yang mencetak waktu & lokasi
 * pada foto — di sini hanya mengambil gambarnya. Bila kamera langsung tidak tersedia (mis. browser dalam aplikasi), pakai
 * aplikasi kamera bawaan ponsel lewat input berkas.
 */
export function PhotoCapture({ value, onChange, required, disabled }: { value: Blob | null; onChange: (b: Blob | null) => void; required: boolean; disabled?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [ready, setReady] = useState(false); // video sudah punya gambar → tombol "Ambil foto" aktif
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [error, setError] = useState<string | null>(null);
  const canStream = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  const stop = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setLive(false); setReady(false); }, []);
  useEffect(() => () => stop(), [stop]);
  const preview = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    const v = videoRef.current;
    if (live && v && streamRef.current) { v.srcObject = streamRef.current; void v.play().catch(() => undefined); }
  }, [live]);

  async function open(mode: "user" | "environment") {
    setError(null); stop(); setFacing(mode);
    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
      setLive(true);
    } catch (e) { setError(cameraError(e)); }
  }

  function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) { setError("Kamera belum siap. Tunggu sebentar lalu coba lagi."); return; }
    const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((b) => { if (b) { onChange(b); stop(); } else setError("Foto gagal diambil. Coba lagi."); }, "image/jpeg", 0.85);
  }

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try { onChange(await downscale(file)); } catch { setError("Foto tidak dapat dibaca. Ambil ulang dengan kamera."); }
  }

  return (
    <div className="space-y-2" role="group" aria-label="Foto absensi">
      <p className="text-sm font-medium text-ink-soft">Foto absensi{required ? <span className="text-brand-700"> (wajib)</span> : <span className="text-muted"> (opsional)</span>}</p>
      {error && <p role="alert" className="text-xs font-medium text-brand-700">{error}</p>}
      {live && (
        <div className="space-y-2">
          <video ref={videoRef} playsInline muted autoPlay onLoadedData={() => setReady(true)} className="aspect-[4/3] w-full max-w-sm rounded-md border border-line bg-black object-cover" aria-label="Pratinjau kamera" />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" size="sm" onClick={snap} disabled={disabled || !ready}><Camera className="size-4" />Ambil foto</Button>
            <Button size="sm" onClick={() => void open(facing === "user" ? "environment" : "user")} disabled={disabled}><SwitchCamera className="size-4" />Ganti kamera</Button>
            <Button size="sm" onClick={stop}>Tutup</Button>
          </div>
        </div>
      )}
      {!live && preview && (
        <div className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Foto absensi yang akan dikirim" data-testid="photo-preview" className="aspect-[4/3] w-full max-w-sm rounded-md border border-line object-cover" />
          <p className="text-xs text-muted">Waktu server, lokasi, dan nama dicetak pada foto oleh server saat Anda menekan Check-in/Check-out.</p>
          <Button size="sm" onClick={() => { onChange(null); if (canStream) void open(facing); }} disabled={disabled}><RefreshCcw className="size-4" />Ulangi foto</Button>
        </div>
      )}
      {!live && !preview && (
        <div className="flex flex-wrap items-center gap-2">
          {canStream && <Button size="sm" onClick={() => void open(facing)} disabled={disabled}><Camera className="size-4" />Buka kamera</Button>}
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm font-medium shadow-sm hover:bg-canvas">
            {canStream ? "Pakai kamera ponsel" : "Ambil foto dengan kamera"}
            <input type="file" accept="image/*" capture={facing} className="sr-only" aria-label="Ambil foto dengan aplikasi kamera ponsel" disabled={disabled} onChange={(e) => { void fromFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
        </div>
      )}
    </div>
  );
}
