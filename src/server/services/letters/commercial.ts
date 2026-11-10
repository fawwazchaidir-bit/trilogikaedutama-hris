import "server-only";
import { z } from "zod";
import { prisma, transaction } from "../../db";
import { env, trainingEnabled } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { notifyUsers } from "../notifications";
import { storeFile } from "../files";
import { createProject, getProject } from "../training/projects";
import { canTransition, dealProblems, displayStatus, followUpAlert, STATUS_LABEL, type CommercialStatus } from "@/lib/documents/commercial";
import { isoDate, optionalText, rupiah, uuid } from "@/lib/validation/common";
import { todayIso } from "@/lib/time";
import { isDirector, loadVisible, personFacts, requireLetters, type LetterWithType } from "./access";
import { getLetterSettings } from "./frame";

export interface CommercialDto {
  funnel: boolean; clientName: string | null; clientRef: string | null; product: string | null; picId: string | null; picName: string | null;
  potentialValue: number | null; dealValue: number | null; status: ReturnType<typeof displayStatus>; statusLabel: string; commercialNote: string | null;
  sentAt: string | null; followUpAt: string | null; alert: "TERLAMBAT" | "HARI_INI" | null;
  evidence: { fileId: string; name: string } | null; products: string[];
  projects: { projectId: string; code: string | null; name: string | null }[];
  can: { edit: boolean; setStatus: boolean; createProject: boolean };
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const num = (v: bigint | null) => (v == null ? null : Number(v));

/** Pembuat, penandatangan, PIC, Direktur, dan Manajer (untuk jenis corong) boleh mengelola data komersial. */
async function assertManage(actor: Actor, d: LetterWithType): Promise<void> {
  if (!d.type.funnel) throw Errors.validation("Jenis surat ini tidak masuk corong penjualan.");
  if (d.status === "CANCELLED" || d.status === "REJECTED") throw Errors.conflict("Surat sudah dibatalkan/ditolak.");
  if (d.creatorId === actor.userId || d.signerId === actor.userId || d.picId === actor.userId || isDirector(actor)) return;
  const f = await personFacts(actor.userId);
  if (f && f.jobLevel === "MANAGER" && !f.isIntern && f.isActive) return;
  throw Errors.forbidden("Anda tidak berwenang mengelola data penjualan surat ini.");
}

export async function getCommercial(actor: Actor, id: string): Promise<CommercialDto> {
  const d = await loadVisible(actor, id);
  const settings = await getLetterSettings();
  let canManage = true;
  try { await assertManage(actor, d); } catch { canManage = false; }
  const st = displayStatus({ letterStatus: d.status, commercialStatus: d.commercialStatus });
  const pic = d.picId ? await personFacts(d.picId) : null;
  const links = await prisma.letterProjectLink.findMany({ where: { documentId: id }, orderBy: { createdAt: "asc" } });
  const projects: CommercialDto["projects"] = [];
  if (trainingEnabled()) {
    for (const l of links) {
      const p = await getProject(actor, l.projectId).then((x) => ({ code: (x as { code?: string }).code ?? null, name: (x as { name?: string }).name ?? null })).catch(() => ({ code: null, name: null }));
      projects.push({ projectId: l.projectId, ...p });
    }
  }
  return {
    funnel: d.type.funnel, clientName: d.clientName, clientRef: d.clientRef, product: d.product, picId: d.picId, picName: pic?.name ?? null,
    potentialValue: num(d.potentialValue), dealValue: num(d.dealValue), status: st, statusLabel: STATUS_LABEL[st], commercialNote: d.commercialNote,
    sentAt: iso(d.sentAt), followUpAt: iso(d.followUpAt), alert: followUpAlert(st, iso(d.followUpAt), todayIso(env().APP_TIMEZONE)),
    evidence: d.dealEvidenceFileId ? { fileId: d.dealEvidenceFileId, name: d.dealEvidenceName ?? "bukti" } : null, products: settings.products,
    projects,
    can: { edit: canManage && d.type.funnel, setStatus: canManage && d.status === "ISSUED", createProject: canManage && d.status === "ISSUED" && d.commercialStatus === "DEAL" && trainingEnabled() },
  };
}

const editSchema = z.object({
  clientName: optionalText(160, "Klien / instansi").optional(), clientRef: optionalText(120, "ID lead CRM").optional(), product: optionalText(120, "Produk").optional(),
  picId: uuid.nullable().optional(), potentialValue: rupiah("Nilai potensi").nullable().optional(), followUpAt: isoDate.nullable().optional(), commercialNote: optionalText(1000, "Catatan").optional(),
  sentAt: isoDate.nullable().optional(),
}).strict();

export async function updateCommercial(actor: Actor, id: string, raw: unknown): Promise<CommercialDto> {
  const input = parseInput(editSchema, raw);
  const d = await loadVisible(actor, id);
  await assertManage(actor, d);
  if (input.picId) { const f = await personFacts(input.picId); if (!f || !f.isActive || f.isIntern) throw Errors.validation("PIC harus karyawan aktif (bukan magang).", { picId: "PIC tidak valid" }); }
  const data: Record<string, unknown> = {};
  for (const k of ["clientName", "clientRef", "product", "picId", "commercialNote"] as const) if (input[k] !== undefined) data[k] = input[k];
  if (input.potentialValue !== undefined) data.potentialValue = input.potentialValue == null ? null : BigInt(input.potentialValue);
  if (input.followUpAt !== undefined) { data.followUpAt = input.followUpAt ? new Date(`${input.followUpAt}T00:00:00Z`) : null; data.lastReminderOn = null; }
  if (input.sentAt !== undefined) data.sentAt = input.sentAt ? new Date(`${input.sentAt}T00:00:00Z`) : null;
  await transaction(async (tx) => {
    await tx.letterDocument.update({ where: { id }, data });
    await writeAudit(tx, actor, { action: "letter.commercial_update", entityType: "LetterDocument", entityId: id, summary: `Data penjualan surat ${d.number ?? "(draf)"} diubah`, after: { ...input } });
  });
  return getCommercial(actor, id);
}

const statusSchema = z.object({ to: z.enum(["SENT", "FOLLOW_UP", "NEGOTIATION", "DEAL", "REJECTED", "DONE"]), dealValue: rupiah("Nilai deal").nullable().optional(), note: optionalText(1000, "Catatan").optional(), followUpAt: isoDate.nullable().optional() }).strict();

/** Ubah status komersial penawaran terbit. Deal wajib bernilai + bukti/catatan; perubahan tercatat di riwayat surat dan Audit Log. */
export async function setCommercialStatus(actor: Actor, id: string, raw: unknown): Promise<CommercialDto> {
  const input = parseInput(statusSchema, raw);
  const d = await loadVisible(actor, id);
  await assertManage(actor, d);
  if (d.status !== "ISSUED") throw Errors.conflict("Status penjualan hanya dapat diubah setelah surat terbit.");
  const from = displayStatus({ letterStatus: d.status, commercialStatus: d.commercialStatus });
  if (!canTransition(from, input.to)) throw Errors.conflict(`Status ${STATUS_LABEL[from]} tidak dapat diubah menjadi ${STATUS_LABEL[input.to]}.`);
  const note = input.note ?? d.commercialNote;
  const dealValue = input.dealValue !== undefined ? input.dealValue : num(d.dealValue);
  if (input.to === "DEAL") {
    const problems = dealProblems({ dealValue, hasEvidence: !!d.dealEvidenceFileId, note });
    if (problems.length) throw Errors.validation(problems.join(" "), { dealValue: problems[0]! });
  }
  const today = todayIso(env().APP_TIMEZONE);
  await transaction(async (tx) => {
    await tx.letterDocument.update({
      where: { id },
      data: {
        commercialStatus: input.to, commercialNote: note ?? null, dealValue: dealValue == null ? null : BigInt(dealValue),
        ...(input.to === "SENT" && !d.sentAt ? { sentAt: new Date(`${today}T00:00:00Z`) } : {}),
        ...(input.followUpAt !== undefined ? { followUpAt: input.followUpAt ? new Date(`${input.followUpAt}T00:00:00Z`) : null, lastReminderOn: null } : {}),
        ...(["DEAL", "REJECTED", "DONE"].includes(input.to) ? { followUpAt: null } : {}),
      },
    });
    await tx.letterEvent.create({ data: { documentId: id, actorId: actor.userId, action: "COMMERCIAL_STATUS", note: `${STATUS_LABEL[from]} → ${STATUS_LABEL[input.to as CommercialStatus]}${note ? ` · ${note}` : ""}` } });
    await writeAudit(tx, actor, { action: "letter.commercial_status", entityType: "LetterDocument", entityId: id, summary: `Status penjualan ${d.number}: ${STATUS_LABEL[from]} → ${STATUS_LABEL[input.to as CommercialStatus]}`, after: { to: input.to, dealValue } });
    if (input.to === "DEAL" && d.creatorId !== actor.userId) await notifyUsers(tx, [d.creatorId], { type: "letter.deal", title: `Penawaran ${d.number} Deal`, body: d.clientName ?? d.type.name, href: `/persuratan/${id}` });
  });
  return getCommercial(actor, id);
}

/** Bukti Deal (PO / persetujuan klien): PDF atau JPG; mengganti bukti sebelumnya (berkas lama tetap tersimpan, tercatat di Audit Log). */
export async function uploadDealEvidence(actor: Actor, id: string, input: { name: string; bytes: Uint8Array }): Promise<CommercialDto> {
  const d = await loadVisible(actor, id);
  await assertManage(actor, d);
  if (d.status !== "ISSUED") throw Errors.conflict("Bukti dapat diunggah setelah surat terbit.");
  await transaction(async (tx) => {
    const file = await storeFile(actor, "LETTER_EVIDENCE", input, tx);
    const full = await tx.storedFile.findUniqueOrThrow({ where: { id: file.id }, select: { originalName: true, sha256: true } });
    await tx.letterDocument.update({ where: { id }, data: { dealEvidenceFileId: file.id, dealEvidenceName: full.originalName } });
    await writeAudit(tx, actor, { action: "letter.deal_evidence", entityType: "LetterDocument", entityId: id, summary: `Bukti Deal surat ${d.number} diunggah`, after: { sha256: full.sha256, replaced: d.dealEvidenceFileId } });
  });
  return getCommercial(actor, id);
}

/** Buat proyek Training in-house dari penawaran Deal dan tautkan (rujukan saja; nilai/harga tidak disalin). */
export async function createProjectFromLetter(actor: Actor, id: string, raw: unknown): Promise<CommercialDto> {
  requireLetters();
  if (!trainingEnabled()) throw Errors.notFound("Modul Training");
  const input = parseInput(z.object({ name: z.string().trim().min(3).max(160).optional(), existingProjectId: uuid.optional() }).strict(), raw ?? {});
  const d = await loadVisible(actor, id);
  await assertManage(actor, d);
  if (d.status !== "ISSUED" || d.commercialStatus !== "DEAL") throw Errors.conflict("Proyek hanya dapat dibuat dari penawaran berstatus Deal.");
  let projectId = input.existingProjectId ?? null;
  if (projectId) await getProject(actor, projectId); // anti-IDOR: harus proyek yang boleh diakses pelaku
  else {
    const p = await createProject(actor, { name: input.name ?? (d.subject || d.type.name), kind: "IN_HOUSE", clientName: d.clientName, notes: `Dari penawaran ${d.number}${d.product ? ` · produk: ${d.product}` : ""}`.slice(0, 2000) });
    projectId = p.id;
  }
  await transaction(async (tx) => {
    await tx.letterProjectLink.upsert({ where: { documentId_projectId: { documentId: id, projectId: projectId! } }, create: { documentId: id, projectId: projectId!, createdById: actor.userId }, update: {} });
    await tx.letterEvent.create({ data: { documentId: id, actorId: actor.userId, action: "PROJECT_LINKED", note: projectId } });
    await writeAudit(tx, actor, { action: "letter.project_link", entityType: "LetterDocument", entityId: id, summary: `Penawaran ${d.number} ditautkan ke proyek Training`, after: { projectId } });
  });
  return getCommercial(actor, id);
}

/** Pekerja harian: ingatkan PIC (atau pembuat) bila jadwal follow-up penawaran jatuh tempo/terlambat — sekali per hari per surat. */
export async function runFollowUpReminders(): Promise<{ checked: number; sent: number }> {
  if (!env().LETTERS_MODULE_ENABLED) return { checked: 0, sent: 0 };
  const today = todayIso(env().APP_TIMEZONE);
  const t = new Date(`${today}T00:00:00Z`);
  const due = await prisma.letterDocument.findMany({
    where: { status: "ISSUED", type: { funnel: true }, commercialStatus: { in: ["SENT", "FOLLOW_UP", "NEGOTIATION"] }, followUpAt: { lte: t }, OR: [{ lastReminderOn: null }, { lastReminderOn: { lt: t } }] },
    select: { id: true, number: true, clientName: true, followUpAt: true, picId: true, creatorId: true },
  });
  let sent = 0;
  for (const d of due) {
    await transaction(async (tx) => {
      const claimed = await tx.letterDocument.updateMany({ where: { id: d.id, OR: [{ lastReminderOn: null }, { lastReminderOn: { lt: t } }] }, data: { lastReminderOn: t } });
      if (claimed.count === 0) return;
      const late = d.followUpAt!.toISOString().slice(0, 10) < today;
      await notifyUsers(tx, [d.picId ?? d.creatorId], { type: "letter.followup", title: late ? `Follow-up TERLAMBAT: ${d.number}` : `Follow-up hari ini: ${d.number}`, body: d.clientName ?? undefined, href: `/persuratan/${d.id}` });
      sent++;
    });
  }
  return { checked: due.length, sent };
}
