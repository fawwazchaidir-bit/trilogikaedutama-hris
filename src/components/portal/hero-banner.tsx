import Image from "next/image";

/** Banner sambutan beranda (maroon → putih). Tanpa foto stok: hanya identitas lembaga. */
export function HeroBanner({ title, subtitle, logoUrl }: { title: string; subtitle?: string; logoUrl: string }) {
  return (
    <section aria-label="Sambutan" className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-maroon-950 via-maroon-900 to-brand-600 px-6 py-7 text-white shadow-sm sm:px-8 sm:py-9">
      <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full bg-white/10" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 right-24 size-56 rounded-full bg-white/5" />
      <div className="relative flex items-center justify-between gap-6">
        <div className="min-w-0">
          <p className="text-2xl font-bold leading-tight sm:text-3xl">{title}</p>
          {subtitle && <p className="mt-2 max-w-xl text-sm text-white/80">{subtitle}</p>}
        </div>
        <Image src={logoUrl} alt="" width={72} height={72} unoptimized className="hidden size-[72px] shrink-0 rounded-full bg-white object-contain p-1 shadow-lg sm:block" />
      </div>
    </section>
  );
}
