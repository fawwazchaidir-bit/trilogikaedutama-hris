import Link from "next/link";
import { cn } from "@/lib/cn";

export function Tile({ label, value, hint, href, tone }: { label: string; value: string | number; hint?: string; href?: string; tone?: "red" | "green" | "amber" }) {
  const body = (
    <div className={cn("h-full rounded-lg border border-line bg-surface p-4 shadow-sm transition-colors", href && "hover:border-brand-200 hover:bg-brand-50/30")}>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("tabular mt-1 text-2xl font-semibold tracking-tight",
        tone === "red" ? "text-brand-700" : tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}
