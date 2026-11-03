import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Trilogika Internal Portal", template: "%s · Trilogika Internal Portal" },
  description: "Trilogika Internal Portal — HRIS (karyawan, absensi, penggajian, surat tugas, dokumen) dan Training & Operations (proyek, tugas, jadwal) Trilogika Edutama",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
