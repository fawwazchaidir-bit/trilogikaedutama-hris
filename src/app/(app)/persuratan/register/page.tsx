import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ChevronLeft } from "lucide-react";
import { requirePageUser } from "@/server/auth/current";
import { lettersEnabled } from "@/server/env";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { canViewRegister, listRegister } from "@/server/services/letters/register";
import { listTypes } from "@/server/services/letters/types";
import { getLetterSettings } from "@/server/services/letters/frame";
import { STATUS_LABEL, type DisplayStatus } from "@/lib/documents/commercial";
import { flattenSearchParams, buildQuery, type SearchParams } from "@/lib/query-string";
import { formatRupiah } from "@/lib/money";
import { todayIso } from "@/lib/time";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Register Surat" };
export const dynamic = "force-dynamic";
const TONE: Record<DisplayStatus, "gray" | "amber" | "green" | "red" | "blue"> = { DRAFT: "gray", SENT: "blue", FOLLOW_UP: "amber", NEGOTIATION: "amber", DEAL: "green", REJECTED: "red", DONE: "green", CANCELLED: "red" };

export default async function RegisterPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  if (!lettersEnabled() || !(await canViewRegister(user))) notFound();
  const sp = await flattenSearchParams(searchParams);
  const year = sp.year ? Number(sp.year) : Number(todayIso(env().APP_TIMEZONE).slice(0, 4));
  const filters = { year, typeId: sp.typeId, status: sp.status, product: sp.product, q: sp.q, page: sp.page };
  const [res, types, settings] = await Promise.all([listRegister(user, filters), listTypes(user), getLetterSettings()]);
  const exportQuery = buildQuery({ year, typeId: sp.typeId, status: sp.status, product: sp.product, q: sp.q });
  return (
    <div>
      <Link href="/persuratan" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" />Persuratan</Link>
      <PageHeader title="Register Surat" description="Seluruh surat bernomor (terbit & dibatalkan), terisi otomatis. Kolom mengikuti Register Excel."
        actions={<a href={`/api/letters/register/export${exportQuery ? `?${exportQuery}` : ""}`} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas"><Download className="size-4" />Ekspor CSV</a>} />
      <FilterBar action="/persuratan/register" resetHref="/persuratan/register">
        <FilterField label="Tahun"><input type="number" name="year" defaultValue={year} className={`${filterInput} w-24`} /></FilterField>
        <FilterField label="Jenis"><select name="typeId" defaultValue={sp.typeId ?? ""} className={filterInput}><option value="">Semua</option>{types.map((t) => <option key={t.id} value={t.id}>{t.series}-{t.codeText} {t.name}</option>)}</select></FilterField>
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{(Object.keys(STATUS_LABEL) as DisplayStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></FilterField>
        <FilterField label="Produk"><select name="product" defaultValue={sp.product ?? ""} className={filterInput}><option value="">Semua</option>{settings.products.map((p) => <option key={p}>{p}</option>)}</select></FilterField>
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Nomor / perihal / klien" className={`${filterInput} w-56`} /></FilterField>
      </FilterBar>
      <p className="mb-2 text-sm text-muted">{res.total} surat</p>
      <TableWrap>
        <Table>
          <thead><tr><Th>No.</Th><Th>Tanggal</Th><Th>Nomor surat</Th><Th>Jenis</Th><Th>Tujuan / instansi</Th><Th>Perihal</Th><Th>Produk</Th><Th>PIC</Th><Th>Status</Th><Th align="right">Potensi (Rp)</Th><Th align="right">Deal (Rp)</Th><Th>Follow-up</Th></tr></thead>
          <tbody>
            {res.items.length === 0 && <tr><Td>Belum ada surat bernomor pada filter ini.</Td></tr>}
            {res.items.map((r) => (
              <tr key={r.id} className="hover:bg-canvas">
                <Td>{r.seqNo}</Td><Td>{r.date}</Td>
                <Td mono><Link href={`/persuratan/${r.id}`} className="text-brand-700 hover:underline">{r.number}</Link>{r.archiveOnly && <span className="ml-1 text-[11px] text-muted">(arsip)</span>}</Td>
                <Td>{r.typeName}{r.confidential && <Badge tone="amber" className="ml-1">Rahasia</Badge>}</Td>
                <Td>{r.recipient ?? "—"}</Td><Td>{r.subject ?? <span className="text-muted">—</span>}</Td><Td>{r.product ?? "—"}</Td><Td>{r.picName ?? "—"}</Td>
                <Td><Badge tone={TONE[r.status]}>{r.statusLabel}</Badge></Td>
                <Td align="right">{r.potentialValue == null ? "—" : formatRupiah(r.potentialValue)}</Td><Td align="right">{r.dealValue == null ? "—" : formatRupiah(r.dealValue)}</Td>
                <Td>{r.followUpAt ?? "—"}{r.alert === "TERLAMBAT" && <Badge tone="red" className="ml-1">TERLAMBAT</Badge>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    </div>
  );
}
