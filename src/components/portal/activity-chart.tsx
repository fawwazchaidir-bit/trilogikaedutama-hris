interface Series { label: string; color: string; values: number[] }

/**
 * Grafik garis aktivitas (SVG murni, tanpa pustaka). Disertai tabel tersembunyi untuk pembaca layar. Data dari pemanggil — tidak ada angka dikarang.
 */
export function ActivityChart({ days, series, title }: { days: string[]; series: Series[]; title: string }) {
  const W = 560, H = 190, L = 28, R = 12, T = 12, B = 26;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const top = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, days.length - 1);
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  const pts = (vs: number[]) => vs.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const label = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const ticks = [0, 1, 2, 3, 4].map((i) => Math.round((top * i) / 4));
  const total = series.map((s) => `${s.label}: ${s.values.reduce((a, b) => a + b, 0)}`).join(", ");
  return (
    <figure className="m-0">
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
        {series.map((s) => <span key={s.label} className="inline-flex items-center gap-1.5 text-ink-soft"><span aria-hidden className="size-2.5 rounded-full" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. ${days.length} hari terakhir. ${total}.`}>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={L} x2={W - R} y1={y(tv)} y2={y(tv)} stroke="#ebe7e2" strokeWidth="1" />
            <text x={L - 6} y={y(tv) + 3.5} textAnchor="end" fontSize="10" fill="#6b6760">{tv}</text>
          </g>
        ))}
        {days.map((d, i) => (i % 2 === 0 || i === days.length - 1) && <text key={d} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#6b6760">{label(d)}</text>)}
        {series.map((s, k) => (
          <g key={s.label}>
            {k === 0 && <polygon points={`${x(0)},${y(0)} ${pts(s.values)} ${x(days.length - 1)},${y(0)}`} fill={s.color} opacity="0.08" />}
            <polyline points={pts(s.values)} fill="none" stroke={s.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="#fff" stroke={s.color} strokeWidth="2"><title>{`${s.label} ${label(days[i]!)}: ${v}`}</title></circle>)}
          </g>
        ))}
      </svg>
      <div className="sr-only"><table><caption>{title}</caption>
        <thead><tr><th>Tanggal</th>{series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{days.map((d, i) => <tr key={d}><td>{d}</td>{series.map((s) => <td key={s.label}>{s.values[i]}</td>)}</tr>)}</tbody></table></div>
    </figure>
  );
}
