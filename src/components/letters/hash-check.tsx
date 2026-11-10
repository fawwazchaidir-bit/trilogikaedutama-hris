"use client";
import { useId, useState } from "react";

/** Cocokkan berkas PDF yang Anda pegang dengan sidik jari terdaftar. Berkas TIDAK diunggah — hash dihitung di peramban Anda. */
export function HashCheck({ expected }: { expected: string }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "same" | "diff" | "error">("idle");
  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      const h = await crypto.subtle.digest("SHA-256", buf);
      const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
      setState(hex === expected ? "same" : "diff");
    } catch { setState("error"); }
  }
  return (
    <div className="mt-5 rounded-lg border border-dashed border-line bg-canvas p-4">
      <label htmlFor={id} className="text-sm font-medium text-ink">Cocokkan berkas PDF Anda</label>
      <p className="mt-0.5 text-xs text-muted">Pilih PDF yang Anda terima. Berkas diperiksa di perangkat Anda dan tidak dikirim ke server.</p>
      <input id={id} type="file" accept="application/pdf" onChange={(e) => void onFile(e.target.files?.[0])} className="mt-2 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm" />
      <div role="status" className="mt-2 text-sm">
        {state === "same" && <span className="font-medium text-emerald-700">Cocok — berkas ini identik dengan terbitan resmi.</span>}
        {state === "diff" && <span className="font-medium text-brand-700">TIDAK cocok — berkas berbeda dari terbitan resmi (mungkin diubah).</span>}
        {state === "error" && <span className="text-brand-700">Berkas tidak dapat dibaca.</span>}
      </div>
    </div>
  );
}
