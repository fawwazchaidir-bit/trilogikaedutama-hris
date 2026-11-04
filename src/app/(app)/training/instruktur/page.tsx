import type { Metadata } from "next";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumb } from "@/components/training/ui";
import { InstructorDirectory } from "@/components/training/instructors-panel";
import { listInstructors } from "@/server/services/training/operations";
import { listDirectory } from "@/server/services/training/access";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Instruktur / Asesor" };
export const dynamic = "force-dynamic";

export default async function InstructorsPage() {
  const { user, ctx } = await trainingPage();
  const canManage = ctx.caps.manageDirectory;
  const [items, employees] = await Promise.all([guard(() => listInstructors(user, { includeInactive: canManage })), canManage ? guard(() => listDirectory(user)) : Promise.resolve(null)]);
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Instruktur / Asesor" }]} />
      <PageHeader title="Instruktur / Asesor" description="Direktori instruktur, asesor, narasumber, dan fasilitator. Pihak eksternal tidak memerlukan akun portal. Kontak hanya terlihat oleh Manajer/Admin Program." />
      <Card className="p-5"><InstructorDirectory items={items} employees={employees} canManage={canManage} /></Card>
    </div>
  );
}
