import "server-only";
import type { LetterDocument } from "@prisma/client";
import { prisma } from "../../db";
import { lettersEnabled } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import type { PersonFacts } from "@/lib/documents/policy";

export function requireLetters(): void {
  if (!lettersEnabled()) throw Errors.notFound("Halaman");
}

export const isDirector = (actor: Pick<Actor, "role">): boolean => actor.role === "SUPER_ADMIN";

/** Fakta seseorang yang menentukan kewenangan surat (peran akun, tingkat jabatan, status magang, aktif). */
export async function personFacts(userId: string): Promise<(PersonFacts & { name: string; title: string | null; employeeId: string | null }) | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, isActive: true, employee: { select: { id: true, fullName: true, position: true, jobLevel: true, employmentStatus: true, isActive: true } } },
  });
  if (!u) return null;
  const e = u.employee;
  return {
    role: u.role, jobLevel: e?.jobLevel ?? null, isIntern: e?.employmentStatus === "INTERN", isActive: u.isActive && (e ? e.isActive : true),
    name: e?.fullName ?? u.name, title: e?.position ?? null, employeeId: e?.id ?? null,
  };
}

/** Dokumen terlihat bagi pembuat, penandatangan, dan Direktur; selain itu 404 (anti-IDOR). */
export async function loadVisible(actor: Actor, id: string): Promise<LetterDocument & { type: { id: string; series: "EKS" | "INT"; code: number; name: string; kind: string } }> {
  requireLetters();
  const d = await prisma.letterDocument.findUnique({ where: { id }, include: { type: { select: { id: true, series: true, code: true, name: true, kind: true } } } });
  if (!d || !(d.creatorId === actor.userId || d.signerId === actor.userId || isDirector(actor))) throw Errors.notFound("Surat");
  return d;
}

/** PDF terbit dapat dibuka oleh pihak yang melihat dokumennya. */
export async function canReadLetterPdf(actor: Actor, fileId: string): Promise<boolean> {
  if (!lettersEnabled()) return false;
  const d = await prisma.letterDocument.findFirst({ where: { pdfFileId: fileId }, select: { creatorId: true, signerId: true } });
  return !!d && (d.creatorId === actor.userId || d.signerId === actor.userId || isDirector(actor));
}
