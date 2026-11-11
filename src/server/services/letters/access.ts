import "server-only";
import type { LetterDocument } from "@prisma/client";
import { prisma } from "../../db";
import { lettersEnabled } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { can } from "@/lib/permissions";
import type { PersonFacts } from "@/lib/documents/policy";

/**
 * Modul Persuratan harus menyala. Bila MATI: pengguna yang berwenang membuat surat tugas (HR/Direktur) mendapat PENJELASAN yang bisa ditindaklanjuti — pembuatan
 * surat tugas hanya lewat Persuratan, jadi "tidak ditemukan" saja menyesatkan; selain mereka tetap 404 (modul tidak membocorkan keberadaannya).
 */
export function requireLetters(actor?: Pick<Actor, "role">): void {
  if (lettersEnabled()) return;
  if (actor && (actor.role === "SUPER_ADMIN" || can(actor.role, "assignment:manage"))) {
    throw Errors.conflict("Persuratan belum diaktifkan di instalasi ini (LETTERS_MODULE_ENABLED=false), sehingga surat tugas baru belum dapat dibuat. Minta administrator sistem mengaktifkannya setelah pemeriksaan kesiapan (npm run check:config) lulus.", { code: "LETTERS_DISABLED" });
  }
  throw Errors.notFound("Halaman");
}

export const isDirector = (actor: Pick<Actor, "role">): boolean => actor.role === "SUPER_ADMIN";

/** Fakta seseorang yang menentukan kewenangan surat (peran akun, tingkat jabatan, status magang, aktif). */
export async function personFacts(userId: string): Promise<(PersonFacts & { name: string; title: string | null; employeeId: string | null; divisionId: string | null; divisionName: string | null }) | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, role: true, isActive: true, employee: { select: { id: true, fullName: true, position: true, jobLevel: true, employmentStatus: true, isActive: true, divisionId: true, division: { select: { name: true } } } } },
  });
  if (!u) return null;
  const e = u.employee;
  return {
    role: u.role, jobLevel: e?.jobLevel ?? null, isIntern: e?.employmentStatus === "INTERN", isActive: u.isActive && (e ? e.isActive : true),
    name: e?.fullName ?? u.name, title: e?.position ?? null, employeeId: e?.id ?? null, divisionId: e?.divisionId ?? null, divisionName: e?.division?.name ?? null,
  };
}

/** Dokumen terlihat bagi pembuat, penandatangan, dan Direktur; selain itu 404 (anti-IDOR). */
export type LetterWithType = LetterDocument & { type: { id: string; series: "EKS" | "INT"; code: number; name: string; kind: string; confidential: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean }; signatories: { id: string; userId: string | null }[] };
export const LETTER_INCLUDE = { type: { select: { id: true, series: true, code: true, name: true, kind: true, confidential: true, hrCanView: true, multiSigner: true, funnel: true } }, signatories: { select: { id: true, userId: true }, orderBy: { position: "asc" as const } } };

/** Pihak yang boleh melihat: pembuat, penandatangan utama, penandatangan tambahan internal, Direktur, dan HR untuk jenis yang memberinya hak lihat. */
export function canSee(actor: Actor, d: LetterWithType): boolean {
  return d.creatorId === actor.userId || d.signerId === actor.userId || isDirector(actor) || d.signatories.some((s) => s.userId === actor.userId) || (actor.role === "HR_ADMIN" && d.type.hrCanView);
}
/** Penawaran (jenis corong): terlihat juga bagi PIC-nya dan Manajer (tingkat jabatan) — agar corong penjualan dapat dipantau tim pemasaran. */
export async function canSeeFunnel(actor: Actor, d: LetterWithType): Promise<boolean> {
  if (!d.type.funnel) return false;
  if (d.picId === actor.userId) return true;
  const f = await personFacts(actor.userId);
  return !!f && !f.isIntern && f.isActive && f.jobLevel === "MANAGER";
}
export async function canSeeAsync(actor: Actor, d: LetterWithType): Promise<boolean> {
  return canSee(actor, d) || (await canSeeFunnel(actor, d));
}
export async function loadVisible(actor: Actor, id: string): Promise<LetterWithType> {
  requireLetters(actor);
  const d = await prisma.letterDocument.findUnique({ where: { id }, include: LETTER_INCLUDE });
  if (!d || !(await canSeeAsync(actor, d))) throw Errors.notFound("Surat");
  return d;
}

/** PDF terbit dapat dibuka oleh pihak yang melihat dokumennya. */
export async function canReadLetterPdf(actor: Actor, fileId: string): Promise<boolean> {
  if (!lettersEnabled()) return false;
  const d = await prisma.letterDocument.findFirst({ where: { OR: [{ pdfFileId: fileId }, { dealEvidenceFileId: fileId }, { attachments: { some: { fileId } } }] }, include: LETTER_INCLUDE });
  return !!d && (await canSeeAsync(actor, d));
}
