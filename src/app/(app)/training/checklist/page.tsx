import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb } from "@/components/training/ui";
import { TemplateManager } from "@/components/training/admin-managers";
import { listMyChecklistItems, listTemplates } from "@/server/services/training/work";
import { CHECKLIST_PHASE_LABEL } from "@/lib/training/types";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Checklist" };
export const dynamic = "force-dynamic";

export default async function ChecklistPage() {
  const { user, ctx } = await trainingPage();
  const [mine, templates] = await Promise.all([guard(() => listMyChecklistItems(user)), ctx.caps.createProject ? guard(() => listTemplates(user, { includeInactive: ctx.caps.managePrograms })) : Promise.resolve(null)]);
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Checklist" }]} />
      <PageHeader title="Checklist" description="Item checklist yang menjadi tanggung jawab Anda, dan template checklist standar untuk proyek baru." />
      <Card><CardHeader title="Checklist saya" description="Belum selesai, pada proyek aktif yang Anda ikuti." />
        {mine.length === 0 ? <EmptyState title="Tidak ada checklist untuk Anda" description="Item yang ditugaskan kepada Anda akan muncul di sini." /> : (
          <ul className="divide-y divide-line">{mine.map((i) => <li key={i.id} className="px-5 py-3 text-sm"><Link href={`/training/proyek/${i.projectId}?tab=tugas`} className="font-medium text-ink hover:underline">{i.title}</Link> {i.isRequired && <Badge tone="red">Wajib</Badge>}<p className="text-xs text-muted">{i.projectCode} · {i.projectName} · {CHECKLIST_PHASE_LABEL[i.phase]}</p></li>)}</ul>
        )}
      </Card>
      {templates && <Card className="mt-6"><CardHeader title="Template checklist" description="Dipilih saat membuat proyek; itemnya disalin menjadi milik proyek." /><div className="p-5"><TemplateManager templates={templates} canManage={ctx.caps.managePrograms} /></div></Card>}
    </div>
  );
}
