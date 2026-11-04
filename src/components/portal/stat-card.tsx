import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "maroon" | "green" | "amber" | "slate";
const TONE: Record<Tone, string> = { maroon: "bg-brand-50 text-brand-600", green: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", slate: "bg-stone-100 text-stone-700" };

/** Kartu angka ringkasan dengan ikon (gaya beranda portal). */
export function StatCard({ icon: Icon, label, value, hint, href, tone = "maroon" }: { icon: LucideIcon; label: string; value: string | number; hint?: string; href?: string; tone?: Tone }) {
  const body = (
    <div className={cn("flex h-full items-center gap-4 rounded-xl border border-line bg-white p-4 shadow-sm transition-colors", href && "hover:border-brand-200 hover:bg-brand-50/20")}>
      <span aria-hidden className={cn("grid size-12 shrink-0 place-items-center rounded-xl", TONE[tone])}><Icon className="size-6" /></span>
      <div className="min-w-0">
        <p className="text-sm leading-tight text-muted">{label}</p>
        <p className="tabular text-2xl font-bold leading-tight tracking-tight text-ink">{value}</p>
        {hint && <p className="mt-0.5 line-clamp-2 text-xs leading-tight text-muted">{hint}</p>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
