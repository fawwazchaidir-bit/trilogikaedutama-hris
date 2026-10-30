import { Info } from "lucide-react";
import { STATUS_LABEL } from "@/lib/attendance";

/** Penjelasan cara perhitungan setiap angka rekap — selalu tersedia di layar agar angka dapat diperiksa. */
export function RecapExplanation({ lateAfterTolerance = false }: { lateAfterTolerance?: boolean }) {
  const rows: [string, string][] = [
    ["Hari kerja terjadwal", "Hari yang sesuai jadwal kerja karyawan pada rentang tanggal, di luar hari libur, libur mingguan, dan hari di luar masa kerja. Hari kerja khusus tetap dihitung."],
    ["Hadir", "Hari terjadwal dengan check-in. Hadir = tepat waktu + terlambat."],
    ["Terlambat", `Check-in melewati jam masuk + toleransi. Menit terlambat dihitung ${lateAfterTolerance ? "setelah batas toleransi" : "dari jam masuk"} (detik dibuang).`],
    ["Izin / Sakit / Cuti", "Pengajuan berstatus DISETUJUI yang mencakup hari terjadwal tanpa check-in. Pengajuan yang menunggu atau ditolak tidak dihitung. Kehadiran nyata selalu menang atas pengajuan."],
    ["Tidak hadir", "Hari terjadwal yang sudah lewat tanpa check-in dan tanpa pengajuan disetujui. Untuk hari ini, ditetapkan setelah batas jam tidak hadir pada jadwal."],
    ["Belum lengkap", "Ada check-in tetapi tidak ada check-out pada hari yang sudah lewat. Jam kerjanya tidak dihitung sampai dikoreksi admin."],
    ["Jam kerja tercatat", "Jumlah (check-out − check-in) dari semua absensi lengkap, termasuk kehadiran di hari libur."],
  ];
  return (
    <details className="group rounded-lg border border-line bg-surface shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-sm font-medium text-ink-soft">
        <Info className="size-4 text-brand-600" /> Bagaimana angka ini dihitung?
        <span className="ml-auto text-xs text-muted group-open:hidden">tampilkan</span>
      </summary>
      <div className="space-y-3 border-t border-line px-5 py-4 text-sm">
        <dl className="space-y-2">
          {rows.map(([k, v]) => (<div key={k}><dt className="font-medium">{k}</dt><dd className="text-muted">{v}</dd></div>))}
        </dl>
        <p className="rounded-md bg-canvas p-3 text-xs text-muted">
          Identitas yang selalu berlaku: <strong>hari kerja terjadwal = hadir + izin + sakit + cuti + tidak hadir + belum dinilai</strong>.
          Status harian: {Object.values(STATUS_LABEL).slice(0, 8).join(", ")}. Koreksi admin langsung tercermin pada rekap dan tercatat pada riwayat koreksi.
        </p>
      </div>
    </details>
  );
}
