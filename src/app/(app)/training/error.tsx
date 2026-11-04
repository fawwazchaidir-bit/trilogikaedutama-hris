"use client";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Batas error modul Training & Operations: pesan jelas + tindakan; tanpa stack trace/detail internal. */
export default function TrainingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[training] error:", error.digest ?? error.message); }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md rounded-lg border border-brand-200 bg-brand-50 px-6 py-8 text-center">
      <h1 className="text-lg font-semibold text-brand-800">Halaman tidak dapat dimuat</h1>
      <p className="mt-2 text-sm text-brand-800">Terjadi kesalahan saat mengambil data. Coba muat ulang; bila berulang, hubungi administrator{error.digest ? ` (kode: ${error.digest})` : ""}.</p>
      <div className="mt-5 flex justify-center gap-2"><Button variant="primary" onClick={reset}>Coba lagi</Button><Link href="/training" className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-medium hover:bg-canvas">Ke dashboard</Link></div>
    </div>
  );
}
