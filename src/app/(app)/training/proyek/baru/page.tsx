import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumb } from "@/components/training/ui";
import { ProjectCreateForm } from "@/components/training/project-form";
import { getProjectFormOptions } from "@/server/services/training/projects";
import { listDirectory } from "@/server/services/training/access";
import { guard, trainingPage } from "../../_lib";

export const metadata: Metadata = { title: "Proyek Baru" };
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const { user, ctx } = await trainingPage();
  if (!ctx.caps.createProject) notFound();
  const canSetPic = ctx.subject.level === "MANAGER";
  const [opts, dir] = await Promise.all([guard(() => getProjectFormOptions(user)), canSetPic ? guard(() => listDirectory(user)) : Promise.resolve(null)]);
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Proyek Pelatihan", href: "/training/proyek" }, { label: "Proyek baru" }]} />
      <PageHeader title="Proyek baru" description="Kode proyek dibuat otomatis (TRN-tahun-nomor). Proyek dimulai sebagai Draf; tim, tugas, jadwal, dan dokumen ditambahkan sesudahnya." />
      <Card className="p-5"><ProjectCreateForm programs={opts.programs} templates={opts.templates} directory={dir} canSetPic={canSetPic} /></Card>
    </div>
  );
}
