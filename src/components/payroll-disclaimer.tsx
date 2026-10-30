import { AlertTriangle } from "lucide-react";

/** Penanda tetap: aturan penggajian bukan tarif baku dan wajib disesuaikan/diverifikasi. */
export function PayrollDisclaimer() {
  return (
    <div role="note" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p><strong>Perlu disesuaikan dengan kebijakan perusahaan dan ketentuan yang berlaku.</strong> Aplikasi ini tidak menetapkan tarif BPJS, pajak, lembur, atau potongan apa pun sebagai aturan baku — semuanya berasal dari komponen &amp; aturan yang Anda konfigurasi dan verifikasi sendiri.</p>
    </div>
  );
}
