import { redirect } from "next/navigation";
import { requirePagePermission } from "@/server/auth/current";
import { flattenSearchParams, buildQuery, type SearchParams } from "@/lib/query-string";

/** Surat Tugas kini dikelola di Persuratan (pembuatan lewat jenis INT-002; Uang Harian di halaman "Surat Tugas & Uang Harian"). Alamat lama dialihkan. */
export default async function LegacyAssignmentsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePagePermission("assignment:view_all");
  const sp = await flattenSearchParams(searchParams);
  redirect(`/persuratan/surat-tugas${buildQuery(sp)}`);
}
