import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/card";
import { Breadcrumb } from "@/components/training/ui";
import { IndicatorConfigEditor } from "@/components/training/indicator-config-editor";
import { CapacityPanel } from "@/components/training/capacity-panel";
import { getIndicatorConfig } from "@/server/services/training/indicator-config";
import { listStaffCapacity } from "@/server/services/training/indicator-data";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Rumus Indikator" };
export const dynamic = "force-dynamic";

export default async function IndicatorConfigPage() {
  const { user, ctx } = await trainingPage();
  const dto = await guard(() => getIndicatorConfig(user));
  const capacity = ctx.caps.fullAccess ? await guard(() => listStaffCapacity(user)) : null;
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Pemantauan Program", href: "/training/pemantauan" }, { label: "Rumus Indikator" }]} />
        <PageHeader title="Rumus Indikator" description="Parameter indikator Ketepatan Waktu, Kesiapan, dan Beban Tim — bobot, ambang warna, template milestone, jam standar, kapasitas. Rumusnya tetap; angkanya dapat diperbarui berkala tanpa programmer. Sumber: dokumen Indikator Pemantauan Program Pelatihan v1.0." />
      </div>
      <IndicatorConfigEditor key={dto.version} initial={dto} />
      {capacity && <CapacityPanel data={capacity} />}
    </div>
  );
}
