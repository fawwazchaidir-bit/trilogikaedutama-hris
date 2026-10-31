import { cn } from "@/lib/cn";

/**
 * Grafik SVG sederhana, dirender di server (tanpa pustaka). Setiap grafik berisi `role="img"` + ringkasan teks,
 * dan nilainya ditulis langsung pada grafik (tidak bergantung pada warna/tooltip saja).
 */

export interface Point { label: string; value: number | null }

const W = 320, H = 120, PAD_X = 22, PAD_TOP = 16, PAD_BOTTOM = 22;

/** Grafik garis tren dengan titik & nilai pada setiap titik. `format` mengubah angka menjadi teks. */
export function LineChart({ points, format, title, className }: { points: Point[]; format: (v: number) => string; title: string; className?: string }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length === 0) return <p className="text-sm text-muted">Belum ada data.</p>;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(Math.abs(hi), 1) * 0.1;
  const min = lo - span * 0.15, max = hi + span * 0.15;
  const x = (i: number) => PAD_X + (points.length === 1 ? (W - 2 * PAD_X) / 2 : (i * (W - 2 * PAD_X)) / (points.length - 1));
  const y = (v: number) => PAD_TOP + (1 - (v - min) / (max - min)) * (H - PAD_TOP - PAD_BOTTOM);
  const drawn = points.map((p, i) => (p.value === null ? null : { x: x(i), y: y(p.value), p }));
  const path = drawn.reduce<string>((acc, d, i) => (d ? `${acc}${acc && drawn[i - 1] ? "L" : "M"}${d.x.toFixed(1)},${d.y.toFixed(1)}` : acc), "");
  const summary = `${title}: ${points.map((p) => `${p.label} ${p.value === null ? "tidak ada data" : format(p.value)}`).join(", ")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full text-brand-600", className)} role="img" aria-label={summary}>
      <line x1={PAD_X} x2={W - PAD_X} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} className="stroke-line" strokeWidth={1} />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {drawn.map((d, i) => d && (
        <g key={i}>
          <circle cx={d.x} cy={d.y} r={3} fill="currentColor" />
          <text x={d.x} y={d.y - 7} textAnchor="middle" className="fill-ink text-[9px] font-medium">{format(d.p.value!)}</text>
        </g>
      ))}
      {points.map((p, i) => <text key={p.label} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[9px]">{p.label}</text>)}
    </svg>
  );
}

/** Batang vertikal dengan nilai di atas tiap batang. */
export function BarChart({ items, format, title, className }: { items: Point[]; format: (v: number) => string; title: string; className?: string }) {
  const vals = items.map((p) => p.value ?? 0);
  if (items.length === 0 || vals.every((v) => v === 0)) return <p className="text-sm text-muted">Belum ada data.</p>;
  const max = Math.max(...vals, 1);
  const slot = (W - 2 * PAD_X) / items.length;
  const bw = Math.min(28, slot * 0.6);
  const summary = `${title}: ${items.map((p) => `${p.label} ${format(p.value ?? 0)}`).join(", ")}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-auto w-full text-brand-600", className)} role="img" aria-label={summary}>
      <line x1={PAD_X} x2={W - PAD_X} y1={H - PAD_BOTTOM} y2={H - PAD_BOTTOM} className="stroke-line" strokeWidth={1} />
      {items.map((p, i) => {
        const v = p.value ?? 0;
        const h = ((H - PAD_TOP - PAD_BOTTOM) * v) / max;
        const cx = PAD_X + slot * i + slot / 2;
        return (
          <g key={p.label}>
            <rect x={cx - bw / 2} y={H - PAD_BOTTOM - h} width={bw} height={Math.max(h, v > 0 ? 1 : 0)} rx={2} fill="currentColor" opacity={0.85} />
            <text x={cx} y={H - PAD_BOTTOM - h - 4} textAnchor="middle" className="fill-ink text-[9px] font-medium">{format(v)}</text>
            <text x={cx} y={H - 6} textAnchor="middle" className="fill-muted text-[8px]">{p.label.length > 9 ? `${p.label.slice(0, 8)}…` : p.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Daftar batang horizontal (nama + batang + nilai) — dapat dibaca tanpa grafik, cocok untuk peringkat/divisi. */
export function HBarList({ items, format, max, tone = "brand" }: { items: { label: string; value: number; hint?: string }[]; format: (v: number) => string; max?: number; tone?: "brand" | "amber" | "green" }) {
  if (items.length === 0) return <p className="text-sm text-muted">Belum ada data.</p>;
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  const fill = tone === "amber" ? "bg-amber-500" : tone === "green" ? "bg-emerald-600" : "bg-brand-600";
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex items-baseline justify-between gap-3"><span className="truncate font-medium">{i.label}</span><span className="tabular shrink-0">{format(i.value)}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100" aria-hidden><div className={cn("h-full rounded-full", fill)} style={{ width: `${Math.max(2, Math.min(100, (i.value / top) * 100))}%` }} /></div>
          {i.hint && <p className="mt-0.5 text-xs text-muted">{i.hint}</p>}
        </li>
      ))}
    </ul>
  );
}
