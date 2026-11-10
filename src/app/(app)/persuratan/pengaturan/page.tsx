import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/server/db";
import { requirePageUser } from "@/server/auth/current";
import { lettersEnabled } from "@/server/env";
import { PageHeader } from "@/components/ui/card";
import { LetterSettings } from "@/components/letters/letter-settings";
import { getLetterSettingsDto, listSignatureHolders } from "@/server/services/letters/admin";
import { listTypes, signerMatrix } from "@/server/services/letters/types";

export const metadata: Metadata = { title: "Pengaturan Persuratan" };
export const dynamic = "force-dynamic";

export default async function LetterSettingsPage() {
  const user = await requirePageUser();
  if (!lettersEnabled() || user.role !== "SUPER_ADMIN") notFound();
  const [settings, types, holders, matrix] = await Promise.all([getLetterSettingsDto(user), listTypes(user), listSignatureHolders(user), signerMatrix(user)]);
  const divisions = await prisma.division.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div>
      <Link href="/persuratan" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" />Persuratan</Link>
      <PageHeader title="Pengaturan Persuratan" description="Kebijakan penandatangan, kop, cap, tanda tangan, dan nomor urut." />
      <LetterSettings settings={settings} types={types} holders={holders} matrix={matrix} divisions={divisions} />
    </div>
  );
}
