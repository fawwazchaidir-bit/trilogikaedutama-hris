import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePageUser } from "@/server/auth/current";
import { lettersEnabled } from "@/server/env";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { canViewRegister, funnelDashboard } from "@/server/services/letters/register";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { formatRupiah } from "@/lib/money";
import { monthLabel } from "@/lib/format";

export const metadata: Metadata = { title: "Dasbor Surat & Penjualan" };
export const dynamic = "force-dynamic";
const pct = (n: number) => `${(n * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%`;
const rp = (n: number) => formatRupiah(n);

export default async function FunnelPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  if (!lettersEnabled() || !(await canViewRegister(user))) notFound();
  const sp = await flattenSearchParams(searchParams);
  const d = await funnelDashboard(user, { year: sp.year });
  const s = d.summary;
  const maxMonth = Math.max(1, ...d.perMonth.map((m) => m.dealValue));
  return (
    <div className="space-y-5">
      <Link href="/persuratan" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" />Persuratan</Link>
      <PageHeader title={`Dasbor Surat & Penjualan ${d.year}`} description="Dihitung otomatis dari register. Nilai deal hanya dari penawaran yang tercatat di portal, bukan total revenue lembaga."
        actions={<form className="flex items-end gap-2" action="/persuratan/dasbor"><label className="text-sm">Tahun<input type="number" name="year" defaultValue={d.year} className="ml-2 h-10 w-24 rounded-md border border-line px-2" /></label><button className="h-10 rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas">Tampilkan</button></form>} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Total surat terbit" value={s.issued} hint={`${s.cancelled} dibatalkan`} href={`/persuratan/register?year=${d.year}`} />
        <Tile label="Penawaran terkirim" value={s.offersSent} hint="Terkirim s.d. Tolak" />
        <Tile label="Pipeline aktif" value={s.pipeline} hint={`Nilai potensi ${rp(s.pipelineValue)}`} tone="amber" />
        <Tile label="Deal" value={s.deal} hint={`${s.rejected} ditolak`} tone="green" />
        <Tile label="Konversi penawaran → deal" value={pct(s.conversion)} />
        <Tile label="Win rate (deal vs tolak)" value={pct(s.winRate)} hint="Hanya yang sudah diputuskan" />
        <Tile label="Nilai deal" value={rp(s.dealValue)} hint={`Capaian ${pct(s.targetAchievement)} dari target ${rp(d.target)}`} tone="green" />
        <Tile label="Follow-up terlambat" value={s.overdueFollowUp} tone={s.overdueFollowUp ? "red" : undefined} href={`/persuratan/register?year=${d.year}&status=SENT`} />
      </div>
      <Card>
        <CardHeader title="Nilai deal per bulan" description="Tinggi batang = nilai deal; angka di bawah nama bulan = jumlah surat terbit. Bulan mengikuti tanggal terbit surat." />
        <div className="grid grid-cols-12 items-end gap-1.5 p-4" role="img" aria-label="Grafik nilai deal per bulan">
          {d.perMonth.map((m) => (
            <div key={m.month} className="flex flex-col items-center gap-1 text-[11px] text-muted" title={`${monthLabel(`${d.year}-${String(m.month).padStart(2, "0")}`)}: ${m.issued} surat, ${m.deal} deal, ${rp(m.dealValue)}`}>
              <div className="flex h-28 w-full items-end"><div className="w-full rounded-t bg-brand-500" style={{ height: `${Math.max(m.dealValue ? 4 : 0, (m.dealValue / maxMonth) * 100)}%` }} /></div>
              <span>{monthLabel(`${d.year}-${String(m.month).padStart(2, "0")}`, true)}</span><span className="tabular text-ink-soft">{m.issued}</span>
            </div>
          ))}
        </div>
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader title="Per jenis surat" /><TableWrap><Table><thead><tr><Th>Jenis</Th><Th align="right">Surat</Th><Th align="right">Deal</Th><Th align="right">Potensi</Th><Th align="right">Nilai deal</Th></tr></thead><tbody>
          {d.perType.filter((t) => t.count > 0).length === 0 && <tr><Td>Belum ada surat.</Td></tr>}
          {d.perType.filter((t) => t.count > 0).map((t) => <tr key={t.code}><Td>{t.code} {t.name}</Td><Td align="right">{t.count}</Td><Td align="right">{t.deal}</Td><Td align="right">{rp(t.potential)}</Td><Td align="right">{rp(t.dealValue)}</Td></tr>)}
        </tbody></Table></TableWrap></Card>
        <Card><CardHeader title="Per status" /><TableWrap><Table><thead><tr><Th>Status</Th><Th align="right">Surat</Th><Th align="right">Nilai potensi</Th></tr></thead><tbody>
          {d.perStatus.map((t) => <tr key={t.status}><Td>{t.label}</Td><Td align="right">{t.count}</Td><Td align="right">{rp(t.potential)}</Td></tr>)}
        </tbody></Table></TableWrap></Card>
        <Card><CardHeader title="Per produk" /><TableWrap><Table><thead><tr><Th>Produk</Th><Th align="right">Surat</Th><Th align="right">Terkirim</Th><Th align="right">Deal</Th><Th align="right">Nilai deal</Th></tr></thead><tbody>
          {d.perProduct.length === 0 && <tr><Td>Belum ada penawaran.</Td></tr>}
          {d.perProduct.map((t) => <tr key={t.product}><Td>{t.product}</Td><Td align="right">{t.count}</Td><Td align="right">{t.offersSent}</Td><Td align="right">{t.deal}</Td><Td align="right">{rp(t.dealValue)}</Td></tr>)}
        </tbody></Table></TableWrap></Card>
        <Card><CardHeader title="Per PIC" /><TableWrap><Table><thead><tr><Th>PIC</Th><Th align="right">Terkirim</Th><Th align="right">Deal</Th><Th align="right">Nilai deal</Th><Th align="right">Pipeline</Th></tr></thead><tbody>
          {d.perPic.length === 0 && <tr><Td>Belum ada penawaran.</Td></tr>}
          {d.perPic.map((t) => <tr key={t.pic}><Td>{t.pic}</Td><Td align="right">{t.offers}</Td><Td align="right">{t.deal}</Td><Td align="right">{rp(t.dealValue)}</Td><Td align="right">{rp(t.pipelineValue)}</Td></tr>)}
        </tbody></Table></TableWrap></Card>
      </div>
    </div>
  );
}
