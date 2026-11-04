import { trainingPage } from "./_lib";

/**
 * Gerbang modul Training & Operations. Dijalankan SEBELUM halaman mulai di-stream, sehingga akun tanpa akses modul (mis. admin HRIS
 * tanpa level/keanggotaan) dan modul yang dimatikan (TRAINING_MODULE_ENABLED=false) mendapat HTTP 404 sungguhan.
 * Layout tidak dijalankan ulang pada navigasi antar-halaman, jadi SETIAP halaman tetap memeriksa akses sendiri (lapis kedua).
 */
export default async function TrainingLayout({ children }: { children: React.ReactNode }) {
  await trainingPage();
  return <>{children}</>;
}
