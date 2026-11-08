import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { listAssets } from "@/server/services/assets";
import { listEmployeeOptions } from "@/server/services/employees";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { AssetManager } from "@/components/asset-manager";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_STATUSES, ASSET_STATUS_LABEL } from "@/lib/assets";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Aset" };
export const dynamic = "force-dynamic";

const inputCls = "h-9 rounded-md border border-line bg-white px-2 text-sm";

export default async function AssetsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("employee:view");
  const sp = await flattenSearchParams(searchParams);
  const status = ASSET_STATUSES.find((s) => s === sp.status);
  const category = ASSET_CATEGORIES.find((c) => c === sp.category);
  const [assets, all, employees] = await Promise.all([
    listAssets(user, { status, category, q: sp.q || undefined }),
    listAssets(user, {}),
    listEmployeeOptions(user),
  ]);
  const count = (s: (typeof ASSET_STATUSES)[number]) => all.filter((a) => a.status === s).length;
  const chip = (s: string | undefined, label: string, n: number) => (
    <Link key={label} href={s ? `/aset?status=${s}` : "/aset"} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", status === s ? "bg-brand-600 text-white" : "border border-line bg-white hover:bg-canvas")}>{label} ({n})</Link>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Aset" description="Aset perusahaan yang dipinjamkan ke karyawan: laptop, ponsel, kartu akses, kunci, seragam. Serah-terima dan pengembalian tercatat (siapa, kapan, kondisi) dan menjadi dasar butir Pengembalian aset pada checklist karyawan berhenti." />
      <div className="flex flex-wrap gap-2">{chip(undefined, "Semua", all.length)}{ASSET_STATUSES.map((s) => chip(s, ASSET_STATUS_LABEL[s], count(s)))}</div>
      <Card>
        <CardHeader title="Daftar aset" />
        <form method="get" className="flex flex-wrap items-end gap-2 px-5 pb-3" role="search" aria-label="Cari aset">
          {status && <input type="hidden" name="status" value={status} />}
          <label className="text-xs font-medium text-muted">Cari<input name="q" defaultValue={sp.q ?? ""} placeholder="Nama, kode, no. seri, pemegang" className={cn(inputCls, "mt-1 block w-64")} /></label>
          <label className="text-xs font-medium text-muted">Kategori
            <select name="category" defaultValue={category ?? ""} className={cn(inputCls, "mt-1 block")}><option value="">Semua</option>{ASSET_CATEGORIES.map((c) => <option key={c} value={c}>{ASSET_CATEGORY_LABEL[c]}</option>)}</select>
          </label>
          <button className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-canvas">Terapkan</button>
        </form>
        {assets.length === 0 && !actorCan(user, "employee:manage") ? <EmptyState title="Belum ada aset" /> : (
          <AssetManager assets={assets} employees={employees.map((e) => ({ id: e.id, name: e.fullName, no: e.employeeNo }))} canManage={actorCan(user, "employee:manage")} />
        )}
        {assets.length === 0 && actorCan(user, "employee:manage") && <EmptyState title="Belum ada aset yang cocok" description="Daftarkan aset pertama dengan tombol di atas, atau ubah filter." />}
      </Card>
    </div>
  );
}
