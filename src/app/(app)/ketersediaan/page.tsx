import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePageUser } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { getTeamAvailability } from "@/server/services/availability";
import { Card, PageHeader } from "@/components/ui/card";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { formatDateRange } from "@/lib/format";
import { addDays, isoWeekday } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Ketersediaan Tim" };
export const dynamic = "force-dynamic";

const DOW = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

export default async function AvailabilityPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  const sp = await flattenSearchParams(searchParams);
  let a;
  try { a = await getTeamAvailability(user, { from: sp.from, days: sp.days, divisionId: sp.divisionId, q: sp.q }); } catch (e) { if (e instanceof AppError && e.status !== 422) notFound(); throw e; }
  const keep = { divisionId: sp.divisionId, q: sp.q, days: sp.days };
  const span = a.days.length;
  return (
    <div className="space-y-4">
      <PageHeader title="Ketersediaan Tim" description="Siapa bertugas di luar (surat tugas), cuti/izin, atau tersedia — per hari. Surat tugas hanya penanda jadwal; kehadiran tetap dicatat dari absensi sesuai kebijakan." />
      {a.summary && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan hari ini">
          <Tile label="Tersedia hari ini" value={a.summary.available} tone="green" /><Tile label="Dinas luar" value={a.summary.duty} tone={a.summary.duty ? "amber" : undefined} />
          <Tile label="Cuti / izin / sakit" value={a.summary.leave} /><Tile label="Libur / di luar masa kerja" value={a.summary.off} />
        </section>
      )}
      <FilterBar action="/ketersediaan" resetHref="/ketersediaan">
        <FilterField label="Divisi"><select name="divisionId" defaultValue={sp.divisionId ?? ""} className={filterInput}><option value="">Semua</option>{a.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FilterField>
        <FilterField label="Karyawan"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama / no. induk" className={`${filterInput} w-48`} /></FilterField>
        <input type="hidden" name="from" value={a.from} />
      </FilterBar>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3 text-sm">
          <span className="font-medium">{formatDateRange(a.from, a.to)}</span>
          <span className="flex items-center gap-2">
            <Link className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={`/ketersediaan${buildQuery({ ...keep, from: addDays(a.from, -span) })}`}><ChevronLeft className="size-4" />Sebelumnya</Link>
            <Link className="text-brand-700 hover:underline" href={`/ketersediaan${buildQuery(keep)}`}>Pekan ini</Link>
            <Link className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={`/ketersediaan${buildQuery({ ...keep, from: addDays(a.from, span) })}`}>Berikutnya<ChevronRight className="size-4" /></Link>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-48 bg-white px-4 py-2 text-left font-semibold text-muted">Karyawan</th>
                {a.days.map((d) => (
                  <th key={d} className={cn("min-w-24 px-1 py-2 text-center font-medium", isoWeekday(d) > 5 && "bg-canvas", d === a.today && "bg-brand-50 text-brand-700")}>
                    <div>{DOW[isoWeekday(d) - 1]}</div><div className="tabular text-[11px] font-normal text-muted">{d.slice(8)}/{d.slice(5, 7)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.rows.length === 0 && <tr><td colSpan={span + 1} className="px-4 py-8 text-center text-muted">Tidak ada karyawan yang cocok.</td></tr>}
              {a.rows.map((r) => (
                <tr key={r.employeeId} className="border-t border-line">
                  <th scope="row" className="sticky left-0 z-10 bg-white px-4 py-2 text-left font-medium"><span className="block">{r.name}</span><span className="block text-[11px] font-normal text-muted">{r.position}{r.division ? ` · ${r.division}` : ""}</span></th>
                  {r.cells.map((c) => (
                    <td key={c.date} className={cn("px-1 py-1.5 text-center align-middle", isoWeekday(c.date) > 5 && "bg-canvas", c.date === a.today && "bg-brand-50/50")}>
                      {c.duty && <span title={`Dinas luar — ${c.duty.destination}${c.duty.number ? ` (${c.duty.number})` : ""}`} className="block max-w-28 truncate rounded bg-brand-100 px-1.5 py-0.5 font-medium text-brand-800">DL · {c.duty.destination}</span>}
                      {c.leave && <span className={cn("mt-0.5 block rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800")} title={c.half ? "Setengah hari" : undefined}>{c.leave === "CUTI" ? "Cuti" : "Izin/sakit"}{c.half ? " ½" : ""}</span>}
                      {!c.duty && !c.leave && (c.off ? <span className="text-muted" title={c.off}>—</span> : <span className="text-green-700" aria-label="Tersedia">●</span>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          <b className="text-brand-800">DL · tujuan</b> = ada surat tugas (dinas luar) · <b className="text-amber-800">Cuti / Izin/sakit</b> = pengajuan disetujui · — = libur / bukan hari kerja · <span className="text-green-700">●</span> = tersedia.
          Penugasan bukan bukti hadir; absensi tetap dicatat sesuai kebijakan. {a.canSeeNumbers ? "Arahkan kursor ke penanda DL untuk melihat nomor surat." : "Nomor dan maksud surat hanya terlihat oleh HR."}
        </p>
      </Card>
    </div>
  );
}
