import "server-only";
import { prisma } from "../../db";
import { AppError } from "../../errors";
import type { Actor } from "../../actor";
import { writeAudit } from "../../audit";
import { SENSITIVE_DOC_CATEGORIES } from "@/lib/training/types";
import { loadProjectAccess } from "./access";

/**
 * Aturan membuka berkas dokumen proyek (dipanggil oleh `readFileForActor` pada SETIAP unduhan/tampilan):
 *  - dokumen harus ada dan belum disembunyikan;
 *  - pelaku harus berhak MELIHAT proyeknya (lingkup proyek; bukan sekadar login);
 *  - kategori sensitif (dokumen peserta) hanya untuk pengelola peserta; pembukaannya dicatat di audit.
 * Modul mati / tidak berhak → false (pemanggil menjawab 403 tanpa membocorkan isi).
 */
export async function canReadTrainingFile(actor: Actor, fileId: string): Promise<boolean> {
  const doc = await prisma.trainingProjectDocument.findUnique({ where: { fileId }, select: { id: true, projectId: true, category: true, deletedAt: true } });
  if (!doc || doc.deletedAt) return false;
  let access;
  try {
    access = await loadProjectAccess(actor, doc.projectId);
  } catch (e) {
    if (e instanceof AppError) return false;
    throw e;
  }
  if (SENSITIVE_DOC_CATEGORIES.includes(doc.category)) {
    if (!access.abilities.has("manage_participants")) return false;
    await writeAudit(prisma, actor, { action: "training.document.view", entityType: "TrainingProject", entityId: doc.projectId, summary: "Dokumen peserta dibuka", after: { documentId: doc.id } });
  }
  return true;
}
