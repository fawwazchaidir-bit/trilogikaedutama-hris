import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { getSettingsDto } from "@/server/services/settings";
import { Notice, PageHeader } from "@/components/ui/card";
import { getDeliveryStats } from "@/server/services/delivery-admin";
import { CompanyForm, DeliveriesCard, LogoCard, PayrollRulesForm, PolicyForm, SecurityForm, SignatureCard, StatutoryForm } from "@/components/settings-forms";

export const metadata: Metadata = { title: "Pengaturan" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requirePagePermission("settings:view");
  const s = await getSettingsDto(user);
  const sa = actorCan(user, "settings:manage");
  const deliveries = sa ? await getDeliveryStats(user) : null;
  return (
    <div className="space-y-4">
      <PageHeader title="Pengaturan" description="Identitas lembaga, kebijakan absensi & cuti, dan aturan penggajian. Nilai yang ditandai perlu dikonfirmasi masih memakai pengaturan awal." />
      {!sa && <Notice tone="info">Anda dapat melihat pengaturan. Perubahan hanya dapat dilakukan Super Admin/Pimpinan.</Notice>}
      <CompanyForm s={s} canEdit={sa} />
      <LogoCard logoUrl={s.company.logoUrl} canEdit={sa} />
      <SignatureCard signatureUrl={s.slip.signer.signatureUrl} signerName={s.slip.signer.name} canEdit={sa} />
      <PolicyForm s={s} canEdit={sa} />
      <SecurityForm s={s} canEdit={sa} />
      {deliveries && <DeliveriesCard stats={deliveries} />}
      <PayrollRulesForm s={s} canEdit={actorCan(user, "payroll:rules")} />
      <StatutoryForm s={s} canEdit={actorCan(user, "payroll:rules")} />
    </div>
  );
}
