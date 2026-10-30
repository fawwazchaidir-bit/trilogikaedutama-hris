import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { z } from "zod";
import { requirePageUser } from "@/server/auth/current";
import { getPayslip, auditPayslipAccess } from "@/server/services/payslips";
import { AppError } from "@/server/errors";
import { PageHeader } from "@/components/ui/card";
import { PayslipView } from "@/components/payslip-view";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Slip Gaji" };
export const dynamic = "force-dynamic";

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let data;
  try { data = await getPayslip(user, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  await auditPayslipAccess(user, [id], `Slip ${data.dto.number} dilihat di layar`);
  const back = can(user.role, "payroll:view") ? `/penggajian/${data.dto.runId}` : "/slip-saya";
  return (
    <div>
      <Link href={back} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Kembali</Link>
      <PageHeader title={`Slip Gaji — ${data.dto.periodLabel}`} description={`${data.dto.employeeName} · No. ${data.dto.number}`}
        actions={<a href={`/api/payslips/${id}/pdf`} className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"><Download className="size-4" />Unduh PDF</a>} />
      <PayslipView s={data.snapshot} voided={data.dto.status === "VOIDED"} />
    </div>
  );
}
