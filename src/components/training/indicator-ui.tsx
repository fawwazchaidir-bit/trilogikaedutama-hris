/** Tampilan indikator pemantauan (tanpa state; aman untuk server maupun client component). Warna SELALU disertai teks agar tidak bergantung pada penglihatan warna. */
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { COLOR_LABEL, LOAD_BAND_LABEL, TRIGGER_LABEL, type Color } from "@/lib/training/indicators/engine";
import { fmtNum, fmtPct } from "@/lib/training/indicators/format";
import { formatDateShort } from "@/lib/format";
import type { ProgramIndicatorDto } from "@/server/services/training/indicator-compute";

const TONE: Record<Color, "green" | "amber" | "red"> = { GREEN: "green", YELLOW: "amber", RED: "red" };
const DOT: Record<Color, string> = { GREEN: "bg-emerald-500", YELLOW: "bg-amber-500", RED: "bg-brand-600" };

export function ColorBadge({ color, label }: { color: Color | null; label?: string }) {
  if (!color) return <Badge tone="gray">Belum dinilai</Badge>;
  return <Badge tone={TONE[color]}><span aria-hidden className={cn("mr-1.5 inline-block size-2 rounded-full", DOT[color])} />{label ?? COLOR_LABEL[color]}</Badge>;
}

function IndicatorTile({ title, value, color, hint, sub }: { title: string; value: string; color: Color | null; hint?: string; sub?: string }) {
  return (
    <div className="h-full rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2"><p className="text-sm text-muted">{title}</p><ColorBadge color={color} /></div>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

/** Tiga indikator + proyeksi peserta + status gabungan untuk satu program. */
export function IndicatorTiles({ ind }: { ind: ProgramIndicatorDto }) {
  const t = ind.timeliness, r = ind.readiness, pj = ind.projection;
  if (!ind.applied || !t || !r) return <Notice tone="info">Template pemantauan belum diterapkan pada program ini, sehingga indikator belum dapat dihitung.</Notice>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">Status program:</span><ColorBadge color={ind.overall} />
        <span className="text-xs text-muted">= yang terburuk dari tiga indikator, kecuali ada pemicu Merah.</span>
      </div>
      {ind.runs && ind.overall === "YELLOW" && ind.runs.yellow.count >= ind.runs.yellowStreakDays && (
        <Notice tone="warn">Kuning {ind.runs.yellow.count} hari kerja berturut-turut (sejak {ind.runs.yellow.startDate ? formatDateShort(ind.runs.yellow.startDate) : "—"}). Atasan PIC sudah diberi tahu; <a href="#pemulihan" className="font-medium underline">tulis rencana pemulihan</a> dalam 1 hari kerja.</Notice>
      )}
      {ind.runs && ind.overall === "RED" && ind.runs.red.count > 0 && (
        <Notice tone="danger">Merah{ind.runs.red.count > 1 ? ` ${ind.runs.red.count} hari kerja berturut-turut` : " sejak hari ini"}. Putuskan pemulihan hari yang sama (tambah orang, geser tugas, atau ubah rencana) dan <a href="#pemulihan" className="font-medium underline">catat keputusannya</a>.</Notice>
      )}
      {ind.triggers.length > 0 && (
        <Notice tone="danger"><ul className="space-y-0.5">{ind.triggers.map((c) => <li key={c} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{TRIGGER_LABEL[c]}</li>)}</ul></Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <IndicatorTile title="Ketepatan Waktu" value={t.spi === null ? "—" : fmtNum(t.spi)} color={t.status}
          hint={t.spi === null ? "Belum ada tenggat yang lewat" : `SPI = ${t.ev} ÷ ${t.pv} (bobot selesai ÷ bobot jatuh tempo)`}
          sub={t.overdueActive ? `${t.overdueActive} milestone terlambat${t.oldestOverdueDays ? `, terlama ${t.oldestOverdueDays} hari` : ""}` : "Tidak ada milestone terlambat"} />
        <IndicatorTile title="Kesiapan" value={r.ikp === null ? "—" : fmtNum(r.ikp, 1)} color={r.status}
          hint={r.target === null ? "Belum ada item yang berlaku" : `Target hari ini ${fmtNum(r.target, 1)} · selisih ${r.gap! > 0 ? "+" : ""}${fmtNum(r.gap, 1)} poin`}
          sub={r.criticalOpen.length ? `Item kritikal terbuka: ${r.criticalOpen.join("; ")}` : undefined} />
        <IndicatorTile title="Beban tim (pemegang milestone)" value={fmtPct(ind.load.pct)} color={ind.load.status}
          hint={ind.load.band ? `${LOAD_BAND_LABEL[ind.load.band]} · minggu ini dan depan` : "Belum ada pemegang milestone terbuka"}
          sub={ind.load.topPerson ? `Tertinggi: ${ind.load.topPerson}` : undefined} />
        <IndicatorTile title="Proyeksi peserta" value={pj ? fmtNum(pj.ratio) : "—"} color={pj ? pj.status : null}
          hint={pj ? `Proyeksi ${fmtNum(pj.projection, 1)} peserta · sisa ${pj.daysLeft} hari pendaftaran` : ind.track === "PARTNER" ? "Hanya untuk program reguler" : "Isi peserta minimum & tanggal mulai"} />
      </div>
      {ind.escalate.length > 0 && <Notice tone="warn">Milestone terlambat lebih dari ambang eskalasi: {ind.escalate.join(", ")}. Catat penyebab dan tanggal selesai baru; atasan PIC perlu diberi tahu.</Notice>}
      {ind.gaps.length > 0 && <Notice tone="warn"><ul className="list-disc space-y-0.5 pl-4">{ind.gaps.map((g) => <li key={g}>{g}</li>)}</ul></Notice>}
    </div>
  );
}

/** Ringkas satu baris: dipakai pada kartu daftar program. */
export function MiniIndicators({ ind }: { ind: ProgramIndicatorDto }) {
  if (!ind.applied || !ind.timeliness || !ind.readiness) return <span className="text-xs text-muted">Template pemantauan belum diterapkan</span>;
  return (
    <dl className="grid grid-cols-3 gap-2 text-xs">
      <div><dt className="text-muted">Waktu</dt><dd className="mt-0.5 flex items-center gap-1"><ColorBadge color={ind.timeliness.status} label={ind.timeliness.spi === null ? "—" : fmtNum(ind.timeliness.spi)} /></dd></div>
      <div><dt className="text-muted">Kesiapan</dt><dd className="mt-0.5"><ColorBadge color={ind.readiness.status} label={ind.readiness.ikp === null ? "—" : fmtNum(ind.readiness.ikp, 0)} /></dd></div>
      <div><dt className="text-muted">Beban</dt><dd className="mt-0.5"><ColorBadge color={ind.load.status} label={fmtPct(ind.load.pct)} /></dd></div>
    </dl>
  );
}
