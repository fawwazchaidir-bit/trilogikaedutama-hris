import type { Metadata } from "next";
import { CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { verifyByToken } from "@/server/services/letters/public";
import { getBrand } from "@/server/services/settings";
import { HashCheck } from "@/components/letters/hash-check";

export const metadata: Metadata = { title: "Verifikasi Dokumen", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Halaman publik (tanpa login): memastikan surat benar-benar diterbitkan lembaga. Hanya metadata; isi surat tidak ditampilkan. */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [v, brand] = await Promise.all([verifyByToken(token), getBrand().catch(() => ({ name: "Trilogika Edutama", logoUrl: "" }))]);
  return (
    <main className="min-h-screen bg-canvas px-4 py-10">
      <div className="mx-auto max-w-xl">
        <p className="mb-4 text-center text-sm font-semibold tracking-wide text-brand-700">{brand.name.toUpperCase()}</p>
        {!v ? (
          <section className="rounded-xl border border-line bg-white p-6 text-center shadow-sm" aria-live="polite">
            <XCircle className="mx-auto size-12 text-brand-600" aria-hidden />
            <h1 className="mt-3 text-lg font-semibold text-ink">Dokumen tidak ditemukan</h1>
            <p className="mt-1 text-sm text-ink-soft">Kode verifikasi ini tidak dikenali. Dokumen mungkin bukan terbitan resmi kami, atau tautan salah ketik.</p>
          </section>
        ) : (
          <section className="rounded-xl border border-line bg-white p-6 shadow-sm" aria-live="polite">
            <div className="text-center">
              {v.state === "VALID" ? <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden /> : <ShieldAlert className="mx-auto size-12 text-amber-600" aria-hidden />}
              <h1 className="mt-3 text-lg font-semibold text-ink">{v.state === "VALID" ? "Dokumen sah dan terdaftar" : "Dokumen telah DIBATALKAN"}</h1>
              {v.state === "CANCELLED" && <p className="mt-1 text-sm text-amber-800">Dokumen ini pernah diterbitkan namun sudah tidak berlaku. Mohon tidak menggunakan salinan yang Anda miliki; alasan pembatalan hanya diberikan kepada pihak berwenang.</p>}
            </div>
            <dl className="mt-5 divide-y divide-line text-sm">
              <Row k="Nomor" v={v.number} mono />
              <Row k="Jenis" v={v.typeName} />
              {v.subject && <Row k="Perihal" v={v.subject} />}
              <Row k="Tanggal terbit" v={v.issueDateText} />
              <Row k="Penandatangan" v={`${v.signerName}${v.signerTitle ? ` — ${v.signerTitle}` : ""}`} />
              {v.sha256 ? <Row k={v.attachments.some((a) => a.mode === "MERGED") ? "Sidik jari berkas surat + lampiran gabungan (SHA-256)" : "Sidik jari berkas (SHA-256)"} v={v.sha256} mono small /> : <Row k="Berkas arsip" v="Nomor terdaftar; PDF pindaian belum diunggah." />}
            </dl>
            {v.archiveOnly && <p className="mt-3 rounded-md bg-sky-50 p-2.5 text-xs text-sky-900">Surat ini dibuat dan ditandatangani di luar portal; yang terdaftar di sini adalah nomornya{v.sha256 ? " dan sidik jari PDF pindaiannya" : ""}.</p>}
            {v.sha256 && <HashCheck expected={v.sha256} label="Cocokkan berkas surat Anda" />}
            {v.attachments.length > 0 && (
              <section className="mt-5" aria-label="Lampiran">
                <h2 className="text-sm font-semibold text-ink">Lampiran ({v.attachments.length})</h2>
                <ul className="mt-2 space-y-2">
                  {v.attachments.map((a, i) => (
                    <li key={i} className="rounded-lg border border-line p-3 text-sm">
                      <p className="font-medium text-ink">{a.title} <span className="ml-1 rounded bg-canvas px-1.5 py-0.5 text-[11px] font-normal text-ink-soft">{a.mode === "MERGED" ? "digabung ke PDF surat" : "berkas terpisah"}</span></p>
                      {a.pages ? <p className="mt-0.5 text-xs text-muted">{a.pages} hlm</p> : null}
                      <p className="mt-1 break-all font-mono text-[11px] text-ink-soft">{a.sha256}</p>
                      {a.mode === "SEPARATE" && <HashCheck expected={a.sha256} label={`Cocokkan berkas lampiran: ${a.title}`} compact />}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="mt-4 text-xs text-muted">Halaman ini hanya menampilkan data pengenal. Isi surat, alasan pembatalan, dan nama berkas tidak ditampilkan; mintalah salinan resmi kepada pihak yang menerbitkan.</p>
          </section>
        )}
      </div>
    </main>
  );
}

function Row({ k, v, mono, small }: { k: string; v: string; mono?: boolean; small?: boolean }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[11rem_1fr]">
      <dt className="text-ink-soft">{k}</dt>
      <dd className={`${mono ? "font-mono" : ""} ${small ? "break-all text-xs" : ""} text-ink`}>{v}</dd>
    </div>
  );
}
