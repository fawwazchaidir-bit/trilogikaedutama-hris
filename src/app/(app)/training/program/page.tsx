import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumb } from "@/components/training/ui";
import { ProgramManager } from "@/components/training/admin-managers";
import { listPrograms } from "@/server/services/training/projects";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Program Pelatihan" };
export const dynamic = "force-dynamic";

export default async function ProgramsPage() {
  const { user, ctx } = await trainingPage();
  const programs = await guard(() => listPrograms(user, { includeInactive: ctx.caps.managePrograms }));
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Program Pelatihan" }]} />
      <PageHeader title="Program Pelatihan" description="Master jenis program yang dapat dilaksanakan berkali-kali. Setiap pelaksanaan (batch) dibuat sebagai proyek yang terhubung ke program." />
      <Card className="p-5"><ProgramManager programs={programs} canManage={ctx.caps.managePrograms} /></Card>
    </div>
  );
}
