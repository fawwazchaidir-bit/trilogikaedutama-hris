import Image from "next/image";

/**
 * Banner sambutan beranda (maroon → putih). Isinya pesan dari Direktur (broadcast) atau teks bawaan. Teks ditampilkan sebagai TEKS BIASA
 * (bukan HTML). Tanpa foto stok: hanya identitas lembaga.
 */
export function HeroBanner({ title, body, caption, logoUrl, action }: { title: string; body?: string | null; caption?: string; logoUrl: string; action?: React.ReactNode }) {
  return (
    <section aria-label="Sambutan" className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-maroon-950 via-maroon-900 to-brand-600 px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-white/5" />
      <div className="relative flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="break-words text-2xl font-bold leading-tight sm:text-3xl">{title}</p>
          {body && <p className="mt-3 max-w-3xl whitespace-pre-line break-words text-sm leading-relaxed text-white/90 sm:text-base">{body}</p>}
          {caption && <p className="mt-3 text-xs text-white/70">{caption}</p>}
          {action && <div className="mt-4">{action}</div>}
        </div>
        <Image src={logoUrl} alt="" width={72} height={72} unoptimized className="hidden size-[72px] shrink-0 rounded-full bg-white object-contain p-1 shadow-lg sm:block" />
      </div>
    </section>
  );
}
