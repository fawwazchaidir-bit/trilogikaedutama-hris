import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Trilogika HRIS", template: "%s · Trilogika HRIS" },
  description: "Mini HRIS internal Trilogika Edutama — karyawan, absensi, rekap, penggajian, dan slip gaji",
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
