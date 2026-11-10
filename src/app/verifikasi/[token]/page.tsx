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
              {v.state === "CANCELLED" && <p className="mt-1 text-sm text-amber-800">Dokumen ini pernah diterbitkan namun sudah tidak berlaku.{v.cancelledNote ? ` Alasan: ${v.cancelledNote}` : ""}</p>}
            </div>
            <dl className="mt-5 divide-y divide-line text-sm">
              <Row k="Nomor" v={v.number} mono />
              <Row k="Jenis" v={v.typeName} />
              {v.subject && <Row k="Perihal" v={v.subject} />}
              <Row k="Tanggal terbit" v={v.issueDateText} />
              <Row k="Penandatangan" v={`${v.signerName}${v.signerTitle ? ` — ${v.signerTitle}` : ""}`} />
              <Row k="Sidik jari berkas (SHA-256)" v={v.sha256} mono small />
            </dl>
            <HashCheck expected={v.sha256} />
            <p className="mt-4 text-xs text-muted">Halaman ini hanya menampilkan data pengenal. Isi surat tidak ditampilkan; mintalah salinan resmi kepada pihak yang menerbitkan.</p>
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
