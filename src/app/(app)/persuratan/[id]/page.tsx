import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { actorCan } from "@/server/actor";
import { requirePageUser } from "@/server/auth/current";
import { lettersEnabled } from "@/server/env";
import { AppError } from "@/server/errors";
import { getLetter } from "@/server/services/letters/documents";
import { listEmployeeOptions } from "@/server/services/employees";
import { listCoSignerCandidates, listSigners } from "@/server/services/letters/types";
import { getCommercial } from "@/server/services/letters/commercial";
import { CommercialCard } from "@/components/letters/commercial-card";
import { LetterEditor } from "@/components/letters/letter-editor";
import { isUuid } from "@/lib/chat/logic";

export const metadata: Metadata = { title: "Surat" };
export const dynamic = "force-dynamic";

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  if (!lettersEnabled()) notFound();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const d = await getLetter(user, id).catch((e) => { if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return null; throw e; });
  if (!d) notFound();
  const signers = d.can.edit ? await listSigners(user, d.typeId) : [];
  const people = d.can.edit && d.multiSigner ? await listCoSignerCandidates(user) : [];
  const empOpts = d.kind === "TUGAS" && d.can.edit ? await listEmployeeOptions(user).catch(() => []) : [];
  const commercial = d.funnel ? await getCommercial(user, d.id).catch(() => null) : null;
  const employees = commercial ? (await listCoSignerCandidates(user).catch(() => [] as { userId: string; name: string; title: string | null }[])).concat(user.employeeId ? [{ userId: user.userId, name: user.name, title: null as string | null }] : []).map((p) => ({ userId: p.userId, name: p.name })) : [];
  return (
    <div>
      <Link href="/persuratan" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ChevronLeft className="size-4" />Persuratan</Link>
      <LetterEditor initial={d} signers={signers} employees={empOpts.map((e) => ({ id: e.id, employeeNo: e.employeeNo, fullName: e.fullName }))} me={{ employeeId: user.employeeId, isSuper: user.role === "SUPER_ADMIN", canManage: actorCan(user, "assignment:manage") }} people={people.map((p) => ({ userId: p.userId, name: p.name, title: p.title }))} />
      {d.funnel && !d.archiveOnly && commercial && (
        <div className="mt-4"><CommercialCard letterId={d.id} initial={commercial} issued={d.status === "ISSUED"} people={employees} /></div>
      )}
    </div>
  );
}
