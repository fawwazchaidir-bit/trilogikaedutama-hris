import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { AppError } from "@/server/errors";
import { getSettlement } from "@/server/services/final-settlements";
import { PageHeader } from "@/components/ui/card";
import { SettlementEditor } from "@/components/settlement-editor";

export const metadata: Metadata = { title: "Detail Penyelesaian Akhir" };
export const dynamic = "force-dynamic";

export default async function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("payroll:view");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let s;
  try { s = await getSettlement(user, id); } catch (err) { if (err instanceof AppError) notFound(); throw err; }
  return (
    <div className="space-y-4">
      <Link href="/penyelesaian-akhir" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Daftar penyelesaian akhir</Link>
      <PageHeader title={`Penyelesaian akhir · ${s.employeeName}`} description={`${s.employeeNo} · ${s.position}`} />
      <SettlementEditor s={s} canPrepare={actorCan(user, "payroll:prepare")} canApprove={actorCan(user, "payroll:approve")} canRevoke={actorCan(user, "payroll:revoke")} isSelf={user.employeeId === s.employeeId} />
    </div>
  );
}
