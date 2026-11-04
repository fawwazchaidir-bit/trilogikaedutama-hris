/** Cincin progres (0–100). `percent` null = belum tersedia (bukan 0%). */
export function ProgressRing({ percent, size = 48, label }: { percent: number | null; size?: number; label: string }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const p = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label}: ${percent === null ? "belum tersedia" : `${percent}%`}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e7e2dd" strokeWidth="5" />
        {percent !== null && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-brand-600)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * p) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <span aria-hidden className="absolute inset-0 grid place-items-center text-[11px] font-semibold text-ink">{percent === null ? "—" : `${percent}%`}</span>
    </div>
  );
}
