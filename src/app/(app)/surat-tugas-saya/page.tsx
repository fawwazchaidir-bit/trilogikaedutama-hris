import type { Metadata } from "next";
import { requirePageSelf } from "@/server/auth/current";
import { listMyAssignments } from "@/server/services/assignments";
import { PageHeader } from "@/components/ui/card";
import { MyAssignments } from "@/components/assignments";

export const metadata: Metadata = { title: "Surat Tugas Saya" };
export const dynamic = "force-dynamic";

export default async function MyAssignmentsPage() {
  const user = await requirePageSelf();
  const items = await listMyAssignments(user);
  return (
    <div>
      <PageHeader title="Surat Tugas Saya" description="Surat tugas yang menugaskan Anda, uang harian yang menjadi hak Anda, dan Bukti Penerimaan Uang Harian. Dokumen ini terpisah dari slip gaji." />
      <MyAssignments items={items} />
    </div>
  );
}
