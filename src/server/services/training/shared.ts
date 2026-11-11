import "server-only";
import type { Prisma } from "@prisma/client";
import type { Tx } from "../../db";
import { prisma } from "../../db";
import { env } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { writeAudit, type AuditEntry } from "../../audit";
import { todayIso } from "@/lib/time";
import { SENSITIVE_DOC_CATEGORIES } from "@/lib/training/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ID di URL/body yang bukan UUID = "tidak ada" (404), bukan 500 dari database. Mencegah enumerasi lewat galat. */
export function assertUuid(id: string, what: string): void {
  if (typeof id !== "string" || !UUID_RE.test(id)) throw Errors.notFound(what);
}

/** Tanggal "hari ini" menurut APP_TIMEZONE (WIB) — satu-satunya sumber untuk indikator terlambat/jatuh tempo. */
export const today = (): string => todayIso(env().APP_TIMEZONE);

/**
 * Audit untuk kejadian DI DALAM proyek: entityType="TrainingProject", entityId=id proyek. Dengan satu kunci ini tab
 * "Riwayat aktivitas" cukup membaca satu indeks. JANGAN menaruh kontak, isi dokumen, atau data sensitif di before/after.
 */
/** Awalan aksi audit yang memuat NAMA peserta (`training.participant.add|confirm|status|update`). Aksi peserta BARU otomatis tercakup oleh awalan ini. */
export const PARTICIPANT_AUDIT_PREFIX = "training.participant.";

/**
 * Filter `where` untuk membaca audit proyek (Riwayat proyek, aktivitas terbaru di beranda) yang MENYEMBUNYIKAN baris berisi data peserta bagi pelaku yang
 * tidak berhak — pembatasan akses peserta berlaku di SEMUA jalur baca, bukan hanya daftar peserta:
 *   · tanpa `view_participants` (akun Magang): baris `training.participant.*` (nama & status peserta) disembunyikan seluruhnya;
 *   · tanpa `manage_participants` pada proyek itu: baris dokumen PESERTA (unggah/hapus/dibuka) disembunyikan — judul dokumen itu pun tidak boleh terlihat
 *     oleh yang tidak berhak membukanya.
 * Disaring di QUERY (bukan di tampilan) agar total/halaman dan "N terbaru" tetap benar. Mengembalikan null bila tidak ada yang perlu disembunyikan.
 * `manageProjectIds`: untuk feed lintas proyek — proyek tempat pelaku berhak mengelola peserta (dokumen peserta di proyek itu tetap terlihat).
 */
export function auditVisibilityWhere(v: { viewParticipants: boolean; manageAll: boolean; manageProjectIds?: readonly string[] }): Prisma.AuditLogWhereInput | null {
  const hide: Prisma.AuditLogWhereInput[] = [];
  if (!v.viewParticipants) hide.push({ action: { startsWith: PARTICIPANT_AUDIT_PREFIX } });
  if (!v.manageAll) {
    const sensitiveDoc: Prisma.AuditLogWhereInput = {
      OR: [
        { action: "training.document.view" },
        ...SENSITIVE_DOC_CATEGORIES.flatMap((c): Prisma.AuditLogWhereInput[] => [
          { action: "training.document.upload", after: { path: ["category"], equals: c } },
          { action: "training.document.delete", before: { path: ["category"], equals: c } },
        ]),
      ],
    };
    hide.push(v.manageProjectIds?.length ? { AND: [sensitiveDoc, { entityId: { notIn: [...v.manageProjectIds] } }] } : sensitiveDoc);
  }
  return hide.length ? { NOT: { OR: hide } } : null;
}

export async function auditProject(tx: Tx | typeof prisma, actor: Actor, projectId: string, entry: Omit<AuditEntry, "entityType" | "entityId">): Promise<void> {
  await writeAudit(tx, actor, { ...entry, entityType: "TrainingProject", entityId: projectId });
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/**
 * Tugas yang masih "hidup": proyeknya belum final, ATAU proyeknya Selesai dan tugas itu ditandai tindak lanjut (dipilih Koordinator Program saat menutup).
 * Tugas lain pada proyek Selesai/Dibatalkan terkunci, tidak dapat diselesaikan, dan karena itu TIDAK dihitung di Tugas Saya, lencana, dasbor, beranda, laporan,
 * pengingat, maupun serah terima. Satu definisi agar semua angka konsisten.
 */
export const liveTaskWhere: Prisma.TrainingTaskWhereInput = {
  OR: [{ project: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }, { isFollowUp: true, project: { status: "COMPLETED" } }],
};
