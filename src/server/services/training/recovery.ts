import "server-only";
import { prisma, transaction } from "../../db";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { dateToIso, isoToDate } from "../../json";
import { RECOVERY_KIND_LABEL, type RecoveryKind } from "@/lib/training/indicators/escalation";
import { recoveryNoteSchema } from "@/lib/validation/training";
import { assertEditable, loadProjectAccess, requireAbility } from "./access";
import { auditProject } from "./shared";

export interface RecoveryNoteDto { id: string; kind: RecoveryKind; kindLabel: string; body: string; newDate: string | null; createdByName: string | null; createdAt: string }

/** Catatan pemulihan program (dokumen §5.2: "rencana pemulihan ditulis di portal"). Siapa pun yang boleh melihat proyek boleh membacanya. */
export async function listRecoveryNotes(actor: Actor, projectId: string): Promise<RecoveryNoteDto[]> {
  await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingRecoveryNote.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 100 });
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, kind: r.kind, kindLabel: RECOVERY_KIND_LABEL[r.kind], body: r.body, newDate: r.newDate ? dateToIso(r.newDate) : null, createdByName: name.get(r.createdById) ?? null, createdAt: r.createdAt.toISOString() }));
}

/** Menambah catatan (append-only: tidak dapat diubah/dihapus). Pengelola tugas proyek (PIC, Admin Program, Manajer Program, Direktur). */
export async function addRecoveryNote(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_tasks", "Hanya pengelola tugas proyek (PIC, Admin Program, Manajer Program) yang dapat menulis catatan pemulihan.");
  assertEditable(access.project);
  const input = parseInput(recoveryNoteSchema, raw);
  return transaction(async (tx) => {
    const n = await tx.trainingRecoveryNote.create({ data: { projectId, kind: input.kind, body: input.body, newDate: input.newDate ? isoToDate(input.newDate) : null, createdById: actor.userId } });
    await auditProject(tx, actor, projectId, { action: "training.recovery.add", summary: `Catatan pemulihan (${RECOVERY_KIND_LABEL[input.kind]}) ditulis di ${access.project.code}`, after: { noteId: n.id, kind: input.kind, newDate: input.newDate ?? null } });
    return { id: n.id };
  });
}
