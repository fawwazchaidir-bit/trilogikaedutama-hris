import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";
import { lettersEnabled } from "@/server/env";
import { PageHeader } from "@/components/ui/card";
import { LetterTable, NewLetterButton } from "@/components/letters/letter-list";
import { listLetters, pendingReviewCount } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { personFacts } from "@/server/services/letters/access";
import { canViewRegister } from "@/server/services/letters/register";
import { canHoldSignature } from "@/lib/documents/policy";
import { MySignature } from "@/components/letters/my-signature";
import { prisma } from "@/server/db";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Persuratan" };
export const dynamic = "force-dynamic";

export default async function LettersPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  if (!lettersEnabled()) notFound();
  const sp = await flattenSearchParams(searchParams);
  const director = user.role === "SUPER_ADMIN";
  const hr = user.role === "HR_ADMIN";
  const scope = sp.scope === "review" ? "review" : sp.scope === "all" && (director || hr) ? "all" : "mine";
  const [res, types, pending] = await Promise.all([listLetters(user, { scope, q: sp.q, status: sp.status, page: sp.page ? Number(sp.page) : 1 }), listTypes(user).catch(() => []), pendingReviewCount(user)]);
  const facts = await personFacts(user.userId);
  const showRegister = await canViewRegister(user);
  const holder = !!facts && canHoldSignature(facts);
  const hasSig = holder ? (await prisma.letterSigner.count({ where: { userId: user.userId, signatureFileId: { not: null } } })) > 0 : false;
  const tabs = [
    { key: "mine", label: "Surat saya" }, { key: "review", label: `Perlu tanda tangan${pending ? ` (${pending})` : ""}` }, ...(director ? [{ key: "all", label: "Semua surat" }] : hr ? [{ key: "all", label: "Surat yang dapat saya lihat" }] : []),
  ];
  return (
    <div>
      <PageHeader title="Persuratan" description="Buat surat, penawaran, dan SK dengan editor visual. Nomor resmi dan QR verifikasi diberikan otomatis saat penandatangan menyetujui."
        actions={<div className="flex gap-2">{holder && <MySignature has={hasSig} />}{showRegister && <><Link href="/persuratan/register" className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas">Register</Link><Link href="/persuratan/dasbor" className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas">Dasbor</Link></>}{director && <Link href="/persuratan/pengaturan" className="inline-flex h-10 items-center rounded-md border border-line bg-white px-4 text-sm font-medium shadow-sm hover:bg-canvas">Pengaturan</Link>}{types.length > 0 && <NewLetterButton types={types} />}</div>} />
      <nav className="mb-4 flex gap-1 border-b border-line" aria-label="Daftar surat">
        {tabs.map((t) => <Link key={t.key} href={`/persuratan?scope=${t.key}`} aria-current={scope === t.key ? "page" : undefined} className={cn("px-3 py-2 text-sm font-medium", scope === t.key ? "border-b-2 border-brand-600 text-brand-700" : "text-muted hover:text-ink")}>{t.label}</Link>)}
      </nav>
      <LetterTable items={res.items} showCreator={scope !== "mine"} />
    </div>
  );
}
