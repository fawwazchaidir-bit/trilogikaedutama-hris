import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumb } from "@/components/training/ui";
import { AccessManager } from "@/components/training/admin-managers";
import { listAccessRows } from "@/server/services/training/access";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Akses Training" };
export const dynamic = "force-dynamic";

export default async function AccessPage() {
  const { user, ctx } = await trainingPage();
  if (!ctx.caps.manageAccess) notFound();
  const rows = await guard(() => listAccessRows(user));
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Akses Training" }]} />
      <PageHeader title="Akses Training & Operations" description="Atur siapa memegang level modul. Hak akses melekat pada orang dan penugasan proyek, bukan pada teks jabatan. Setiap perubahan tercatat di Audit Log." />
      <Card className="p-5"><AccessManager rows={rows} /></Card>
    </div>
  );
}
