import { CalendarDays } from "lucide-react";
import { formatDateWithDay } from "@/lib/format";
import { HeroBanner } from "./hero-banner";

/** Sapaan + tanggal (WIB) + banner. `subtitle` menyesuaikan peran. */
export function PortalIntro({ name, today, subtitle, logoUrl, banner }: { name: string; today: string; subtitle: string; logoUrl: string; banner: { title: string; subtitle?: string } }) {
  const first = name.trim().split(/\s+/)[0] ?? name;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[28px]">Selamat datang, {first}!</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <p className="inline-flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-2.5 text-sm shadow-sm">
          <span aria-hidden className="grid size-9 place-items-center rounded-lg bg-brand-50 text-brand-600"><CalendarDays className="size-5" /></span>
          <span className="font-medium text-ink-soft">{formatDateWithDay(today)}</span>
        </p>
      </div>
      <HeroBanner title={banner.title} subtitle={banner.subtitle} logoUrl={logoUrl} />
    </div>
  );
}
