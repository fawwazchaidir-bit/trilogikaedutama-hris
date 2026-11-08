import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { getTemplate, listAssignableUsers } from "@/server/services/employee-checklist-templates";
import { PageHeader } from "@/components/ui/card";
import { ChecklistTemplateEditor } from "@/components/checklist-template-editor";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Template Checklist" };
export const dynamic = "force-dynamic";

export default async function ChecklistTemplatePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("employee:view");
  const sp = await flattenSearchParams(searchParams);
  const kind = sp.kind === "OFFBOARDING" ? "OFFBOARDING" : "ONBOARDING";
  const [items, users] = await Promise.all([getTemplate(user, kind), listAssignableUsers(user)]);
  const tab = (k: string, label: string) => <Link href={`/masuk-berhenti/template?kind=${k}`} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", kind === k ? "bg-brand-600 text-white" : "border border-line bg-white hover:bg-canvas")}>{label}</Link>;
  return (
    <div className="space-y-4">
      <PageHeader title="Template Checklist" description="Atur butir, tenggat, dan penanggung jawab bawaan checklist karyawan masuk dan berhenti. Berlaku untuk checklist baru." actions={<Link href="/masuk-berhenti" className="text-sm text-brand-700 hover:underline">← Masuk & Berhenti</Link>} />
      <div className="flex gap-2">{tab("ONBOARDING", "Karyawan masuk")}{tab("OFFBOARDING", "Karyawan berhenti")}</div>
      <ChecklistTemplateEditor kind={kind} items={items} users={users.map((u) => ({ id: u.id, name: u.name }))} canManage={actorCan(user, "employee:manage")} />
    </div>
  );
}
