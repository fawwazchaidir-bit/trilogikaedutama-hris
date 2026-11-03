import "server-only";
import type { Tx } from "../../db";
import { prisma } from "../../db";
import { env } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { writeAudit, type AuditEntry } from "../../audit";
import { todayIso } from "@/lib/time";

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
export async function auditProject(tx: Tx | typeof prisma, actor: Actor, projectId: string, entry: Omit<AuditEntry, "entityType" | "entityId">): Promise<void> {
  await writeAudit(tx, actor, { ...entry, entityType: "TrainingProject", entityId: projectId });
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
