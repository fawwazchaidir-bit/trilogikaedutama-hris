import Link from "next/link";
import { addDays, isoWeekday, monthRange } from "@/lib/time";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/cn";

const HEAD = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** Kalender bulanan mini (Senin–Minggu). Titik = ada sesi pelatihan pada hari itu; lingkaran = hari ini. */
export function MiniCalendar({ month, today, days, href }: { month: string; today: string; days: { date: string; count: number }[]; href: string }) {
  const { from, to } = monthRange(month);
  const lead = isoWeekday(from) - 1;
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
  while (cells.length % 7) cells.push(null);
  const count = new Map(days.map((d) => [d.date, d.count]));
  return (
    <div>
      <p className="mb-2 text-center text-sm font-semibold text-ink">{monthLabel(month)}</p>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs" role="grid" aria-label={`Kalender ${monthLabel(month)}`}>
        {HEAD.map((h) => <span key={h} role="columnheader" className="pb-1 font-medium text-muted">{h}</span>)}
        {cells.map((d, i) => d === null ? <span key={i} /> : (
          <Link key={d} href={`${href}?bulan=${month}`} role="gridcell" aria-label={`${Number(d.slice(8))}${count.get(d) ? `, ${count.get(d)} sesi` : ""}${d === today ? ", hari ini" : ""}`}
            className={cn("relative mx-auto grid size-8 place-items-center rounded-full text-[13px] hover:bg-brand-50", d === today ? "bg-brand-600 font-semibold text-white hover:bg-brand-700" : "text-ink-soft", isoWeekday(d) >= 6 && d !== today && "text-muted")}>
            {Number(d.slice(8))}
            {count.has(d) && <span aria-hidden className={cn("absolute bottom-0.5 size-1 rounded-full", d === today ? "bg-white" : "bg-brand-600")} />}
          </Link>
        ))}
      </div>
    </div>
  );
}
