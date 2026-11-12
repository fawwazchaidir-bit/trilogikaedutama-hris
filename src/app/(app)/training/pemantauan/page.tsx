import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Breadcrumb, ProjectStatusBadge, TabNav } from "@/components/training/ui";
import { ColorBadge, MiniIndicators } from "@/components/training/indicator-ui";
import { LOAD_BAND_LABEL, type LoadBand } from "@/lib/training/indicators/engine";
import { TRACK_LABEL } from "@/lib/training/indicators/config";
import { fmtNum, fmtPct } from "@/lib/training/indicators/format";
import { formatDateRange, formatDateShort, formatDateWithDay } from "@/lib/format";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { getClassDensity, getTeamHeatmap, listProgramCards } from "@/server/services/training/indicator-compute";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Pemantauan Program" };
export const dynamic = "force-dynamic";

const TABS = ["program", "tim", "kelas"] as const;
const BAND_TONE: Record<LoadBand, "blue" | "green" | "amber" | "red"> = { ROOMY: "blue", IDEAL: "green", BUSY: "amber", OVERLOAD: "red" };

export default async function MonitoringPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await trainingPage();
  const sp = await flattenSearchParams(searchParams);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as (typeof TABS)[number]) : "program";
  const base = "/training/pemantauan";

  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Pemantauan Program" }]} />
      <PageHeader title="Pemantauan Program" description="Ketepatan Waktu, Kesiapan, dan Beban Tim menurut dokumen Indikator Pemantauan. Rumus dan ambang warna dapat dilihat di Rumus Indikator." actions={<Link href="/training/indikator" className="text-sm font-medium text-brand-700 hover:underline">Rumus Indikator →</Link>} />
      <TabNav base={base} active={tab} tabs={[{ key: "program", label: "Program" }, { key: "tim", label: "Beban tim" }, { key: "kelas", label: "Kelas paralel" }]} />

      {tab === "program" && (async () => {
        const { cards, configVersion, configDamaged } = await guard(() => listProgramCards(user));
        return (
          <div className="space-y-4">
            {configDamaged && <Notice tone="danger">Konfigurasi indikator tersimpan tidak sah; nilai bawaan dokumen dipakai sementara. Minta Direktur menyimpan ulang di Rumus Indikator.</Notice>}
            <p className="text-xs text-muted">Konfigurasi versi {configVersion === 0 ? "bawaan dokumen v1.0" : configVersion}. Diurutkan dari yang paling perlu perhatian.</p>
            {cards.length === 0 ? <Card><EmptyState title="Belum ada program aktif" description="Program berstatus Draf, Persiapan, atau Berjalan yang dapat Anda lihat akan muncul di sini." /></Card> : (
              <ul className="grid gap-3 lg:grid-cols-2">{cards.map((c) => (
                <li key={c.projectId} className="rounded-lg border border-line bg-surface p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/training/proyek/${c.projectId}?tab=pemantauan`} className="font-semibold text-ink hover:underline">{c.name}</Link>
                      <p className="text-xs text-muted">{c.code} · {TRACK_LABEL[c.track]}{c.bnsp ? " · BNSP" : ""} · {c.startDate ? formatDateRange(c.startDate, c.endDate ?? c.startDate) : "Tanggal belum diisi"}{c.daysToStart !== null && c.daysToStart >= 0 ? ` · H-${c.daysToStart}` : ""}</p>
                    </div>
                    <span className="flex items-center gap-2"><ProjectStatusBadge status={c.status} /><ColorBadge color={c.overall} /></span>
                  </div>
                  <div className="mt-3"><MiniIndicators ind={c} /></div>
                  {c.triggers.length > 0 && <p className="mt-2 text-xs font-medium text-brand-700">Pemicu Merah: {c.triggers.length} (buka rincian)</p>}
                  {c.next && <p className="mt-2 text-xs text-muted">Berikutnya: {c.next.code} {c.next.name} · {formatDateShort(c.next.due)} ({c.next.daysLeft === 0 ? "hari ini" : `${c.next.daysLeft} hari lagi`})</p>}
                  {c.applied && c.gaps.length > 0 && <p className="mt-1 text-xs text-amber-800">{c.gaps[0]}</p>}
                  {!c.applied && <p className="mt-2 text-xs text-muted">Buka rincian untuk menerapkan template pemantauan.</p>}
                </li>))}</ul>
            )}
          </div>
        );
      })()}

      {tab === "tim" && (async () => {
        const h = await guard(() => getTeamHeatmap(user));
        return (
          <div className="space-y-5">
            {h.scope === "self" && <Notice tone="info">Anda melihat beban Anda sendiri. Peta seluruh tim hanya untuk Pemantau, Koordinator Program, dan Direktur.</Notice>}
            <div className="flex flex-wrap gap-2 text-xs"><span className="text-muted">Pita:</span>
              <Badge tone="blue">Ada ruang ≤ {h.thresholds.roomyMax}%</Badge><Badge tone="green">Ideal ≤ {h.thresholds.greenMax}%</Badge><Badge tone="amber">Padat ≤ {h.thresholds.yellowMax}%</Badge><Badge tone="red">Overload &gt; {h.thresholds.yellowMax}%</Badge>
            </div>
            <Notice tone="info">
              <div className="space-y-1 text-xs" data-testid="heatmap-legend">
                <p><strong>Beban jam standar</strong> (kolom persen, per minggu) adalah <strong>estimasi berdasarkan template dan penyesuaian</strong>, bukan catatan waktu kerja aktual. Angka ini tidak dijumlahkan dengan jumlah tugas, karena satu pekerjaan bisa sudah terwakili jam standar.</p>
                <p><strong>Tugas operasional</strong> = seluruh tugas terbuka <em>saat ini</em> (termasuk yang menunggu pemeriksaan, yang ditampilkan terpisah); <strong>terlambat</strong> adalah bagian dari tugas terbuka. Tindak lanjut pada proyek Selesai dihitung; tugas terkunci pada proyek Selesai/Dibatalkan tidak.</p>
                <p><strong>Perlu dicek</strong> muncul bila beban jam minggu ini masih “Ada ruang” tetapi staf punya ≥ {h.operationalThresholds.openMin} tugas terbuka atau ≥ {h.operationalThresholds.overdueMin} tugas terlambat (ambang awal, dapat diubah di Rumus Indikator). Penanda hanya meminta PIC atau atasan memeriksa keadaan — tidak mengubah status program dan bukan penilaian kinerja.</p>
              </div>
            </Notice>
            {h.rows.length === 0 ? <Card><EmptyState title="Belum ada data beban" description="Beban dihitung dari tugas jam kerja program (template atau manual) dan pemegang jabatan yang sudah diisi di Rumus Indikator." /></Card> : (
              <TableWrap>
                <Table>
                  <thead><tr><Th>Staf</Th>{h.weekStarts.map((w, i) => <Th key={w} align="center">{i === 0 ? "Jam standar: minggu ini" : formatDateShort(w)}</Th>)}<Th>Tugas operasional (saat ini)</Th><Th>Catatan</Th></tr></thead>
                  <tbody>{h.rows.map((r) => (
                    <tr key={r.employeeId}>
                      <Td><p className="font-medium text-ink">{r.name}</p>{r.division && <p className="text-xs text-muted">{r.division}</p>}</Td>
                      {r.weeks.map((w) => (
                        <Td key={w.weekStart} align="center">
                          <span title={`${w.hours} jam dari kapasitas ${w.capacity} jam${w.items.length ? ` — ${w.items.map((x) => `${x.projectCode} ${x.task} ${x.hours} jam`).join("; ")}` : ""}`}>
                            <Badge tone={BAND_TONE[w.band]}>{fmtPct(w.pct)}</Badge>
                          </span>
                          <span className="sr-only"> {LOAD_BAND_LABEL[w.band]}, {w.hours} jam dari {w.capacity} jam</span>
                        </Td>
                      ))}
                      <Td>
                        <div data-testid={`operational-${r.employeeId}`} className="text-xs">
                          <p><strong>{r.operational.open}</strong> terbuka</p>
                          <p className={r.operational.overdue ? "font-medium text-brand-700" : "text-muted"}>{r.operational.overdue} terlambat <span className="font-normal text-muted">(dari {r.operational.open})</span></p>
                          <p className="text-muted">{r.operational.inReview} menunggu pemeriksaan</p>
                        </div>
                      </Td>
                      <Td>
                        {r.operational.needsCheck && <p title={r.operational.reason ?? undefined}><Badge tone="amber">Perlu dicek</Badge></p>}
                        {r.operational.needsCheck && r.operational.reason && <p className="mt-0.5 max-w-56 text-xs text-muted">{r.operational.reason}</p>}
                        {r.overloadStreak ? <Badge tone="red">Overload 2 minggu berturut-turut</Badge> : <span className="text-xs text-muted">{LOAD_BAND_LABEL[r.peakBand]}</span>}
                      </Td>
                    </tr>))}</tbody>
                </Table>
              </TableWrap>
            )}
            {h.divisions.length > 0 && (
              <Card><CardHeader title="Ketimpangan beban per divisi" description="Indeks = beban tertinggi ÷ rerata divisi pada minggu ini. Ditandai “Timpang” bila di atas ambang dan beban tertinggi sudah melewati batas “Ada ruang”." />
                <ul className="divide-y divide-line">{h.divisions.map((d) => <li key={d.name} className="flex items-center justify-between px-5 py-3 text-sm"><span>{d.name} <span className="text-xs text-muted">({d.members} orang)</span></span><span className="flex items-center gap-2">{d.index === null ? <span className="text-xs text-muted">Belum dapat dihitung</span> : <><span className="tabular">{fmtNum(d.index)}</span><ColorBadge color={d.flagged ? "YELLOW" : "GREEN"} label={d.flagged ? "Timpang" : "Merata"} /></>}</span></li>)}</ul>
              </Card>
            )}
          </div>
        );
      })()}

      {tab === "kelas" && (async () => {
        const d = await guard(() => getClassDensity(user));
        if (d.restricted) return <Notice tone="info">Kepadatan kelas menggabungkan seluruh program, sehingga hanya terlihat oleh Pemantau, Koordinator Program, dan Direktur.</Notice>;
        return (
          <div className="space-y-4">
            <p className="text-xs text-muted">KP = (luring + daring + 2 × hybrid) ÷ fasilitator tersedia. Di atas {fmtNum(d.max, 1)} berarti ada kelas tanpa pendamping (pemicu Merah). Fasilitator dikonfigurasi: {d.facilitatorsConfigured}. 31 hari ke depan, hari kerja saja.</p>
            {d.facilitatorsConfigured === 0 && <Notice tone="warn">Belum ada fasilitator di Rumus Indikator, sehingga setiap hari ber-kelas dinilai tanpa pendamping.</Notice>}
            {d.list.length === 0 ? <Card><EmptyState title="Tidak ada kelas pada 31 hari ke depan" /></Card> : (
              <TableWrap>
                <Table>
                  <thead><tr><Th>Tanggal</Th><Th>Kelas</Th><Th align="right">Beban kelas</Th><Th align="right">Fasilitator</Th><Th align="right">KP</Th><Th>Status</Th></tr></thead>
                  <tbody>{d.list.map((x) => (
                    <tr key={x.date}><Td>{formatDateWithDay(x.date)}</Td>
                      <Td>{x.classes.map((c) => <Link key={c.projectId} href={`/training/proyek/${c.projectId}?tab=pemantauan`} className="mr-2 text-brand-700 hover:underline">{c.code}</Link>)}</Td>
                      <Td align="right">{x.load}</Td><Td align="right">{x.facilitators}</Td><Td align="right">{x.kp >= 9999 ? "∞" : fmtNum(x.kp)}</Td>
                      <Td><ColorBadge color={x.status} label={x.status === "RED" ? "Melebihi fasilitator" : "Aman"} /></Td></tr>
                  ))}</tbody>
                </Table>
              </TableWrap>
            )}
          </div>
        );
      })()}
    </div>
  );
}
