import "server-only";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit } from "../../audit";
import { toJson } from "../../json";
import { checkIndicatorConfig, defaultIndicatorConfig, indicatorConfigSchema, type IndicatorConfig } from "@/lib/training/indicators/config";
import { indicatorConfigSaveSchema } from "@/lib/validation/training";
import { assertModuleEnabled, requireModule } from "./access";

type Db = Tx | typeof prisma;

export interface LoadedConfig { version: number; config: IndicatorConfig; updatedAt: Date | null; updatedById: string | null; note: string | null; fromDefault: boolean; damaged: boolean }

/**
 * Konfigurasi indikator AKTIF. Belum pernah disimpan → nilai bawaan dokumen v1.0 (versi 0). Isi tersimpan divalidasi setiap dibaca; bila rusak
 * (mis. disunting langsung di database) dipakai nilai bawaan dan ditandai `damaged` — indikator tidak pernah dihitung dari konfigurasi tak sah.
 */
export async function loadConfig(db: Db = prisma): Promise<LoadedConfig> {
  const row = await db.trainingIndicatorConfig.findUnique({ where: { id: 1 } });
  if (!row) return { version: 0, config: defaultIndicatorConfig(), updatedAt: null, updatedById: null, note: null, fromDefault: true, damaged: false };
  const parsed = indicatorConfigSchema.safeParse(row.config);
  if (!parsed.success) return { version: row.version, config: defaultIndicatorConfig(), updatedAt: row.updatedAt, updatedById: row.updatedById, note: row.note, fromDefault: true, damaged: true };
  return { version: row.version, config: parsed.data, updatedAt: row.updatedAt, updatedById: row.updatedById, note: row.note, fromDefault: false, damaged: false };
}

export interface ConfigVersionDto { version: number; note: string | null; changedByName: string | null; createdAt: string }
export interface IndicatorConfigDto {
  version: number; config: IndicatorConfig; fromDefault: boolean; damaged: boolean; updatedAt: string | null; updatedByName: string | null;
  history: ConfigVersionDto[];
  /** Karyawan untuk memilih pemegang jabatan & fasilitator (Super Admin: semua yang aktif; lainnya: hanya yang sudah terpasang). */
  employees: { id: string; name: string; position: string }[];
  canEdit: boolean;
}

/** Semua pengguna modul boleh MELIHAT rumus & parameter yang berlaku (transparansi); hanya Super Admin yang mengubahnya. */
export async function getIndicatorConfig(actor: Actor): Promise<IndicatorConfigDto> {
  const mod = await requireModule(actor);
  const cur = await loadConfig();
  const [versions, emps] = await Promise.all([
    prisma.trainingIndicatorConfigVersion.findMany({ orderBy: { version: "desc" }, take: 20, select: { version: true, note: true, changedById: true, createdAt: true } }),
    // Super Admin memilih dari seluruh karyawan aktif; pengguna lain hanya perlu nama pemegang yang sudah terpasang (tanpa daftar karyawan penuh).
    prisma.employee.findMany({
      where: mod.caps.manageAccess ? { isActive: true } : { id: { in: [...Object.values(cur.config.roleHolders).filter((x): x is string => !!x), ...cur.config.facilitators] } },
      orderBy: { fullName: "asc" }, select: { id: true, fullName: true, position: true },
    }),
  ]);
  const ids = [...new Set([...versions.map((v) => v.changedById), ...(cur.updatedById ? [cur.updatedById] : [])])];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nm = new Map(users.map((u) => [u.id, u.name]));
  return {
    version: cur.version, config: cur.config, fromDefault: cur.fromDefault, damaged: cur.damaged, updatedAt: cur.updatedAt?.toISOString() ?? null,
    updatedByName: cur.updatedById ? nm.get(cur.updatedById) ?? null : null,
    history: versions.map((v) => ({ version: v.version, note: v.note, changedByName: nm.get(v.changedById) ?? null, createdAt: v.createdAt.toISOString() })),
    employees: emps.map((e) => ({ id: e.id, name: e.fullName, position: e.position })), canEdit: mod.caps.manageAccess,
  };
}

function sectionsChanged(a: IndicatorConfig, b: IndicatorConfig): string[] {
  const out: string[] = [];
  for (const k of Object.keys(b) as (keyof IndicatorConfig)[]) if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push(k);
  return out;
}

async function persist(tx: Tx, actor: Actor, config: IndicatorConfig, note: string | null, summaryPrefix: string): Promise<{ version: number; changed: string[] }> {
  const cur = await loadConfig(tx);
  const version = cur.version + 1;
  const changed = sectionsChanged(cur.config, config);
  await tx.trainingIndicatorConfig.upsert({
    where: { id: 1 }, create: { id: 1, version, config: toJson(config) ?? {}, note, updatedById: actor.userId }, update: { version, config: toJson(config) ?? {}, note, updatedById: actor.userId },
  });
  await tx.trainingIndicatorConfigVersion.create({ data: { version, config: toJson(config) ?? {}, note, changedById: actor.userId } });
  await writeAudit(tx, actor, {
    action: "training.indicator.config", entityType: "TrainingIndicatorConfig", entityId: "1",
    summary: `${summaryPrefix} → versi ${version}${changed.length ? ` (bagian: ${changed.join(", ")})` : " (tanpa perubahan isi)"}`,
    before: { version: cur.version }, after: { version, sections: changed }, reason: note,
  });
  return { version, changed };
}

/** Pemegang jabatan & fasilitator harus karyawan aktif yang ada. */
async function assertEmployeesActive(tx: Tx, ids: string[]): Promise<void> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return;
  const n = await tx.employee.count({ where: { id: { in: uniq }, isActive: true } });
  if (n !== uniq.length) throw Errors.validation("Ada pemegang jabatan atau fasilitator yang bukan karyawan aktif. Muat ulang halaman dan pilih ulang.", { config: "Karyawan tidak valid" });
}

export interface SaveConfigResult { version: number; warnings: string[]; changed: string[] }

/** Simpan konfigurasi baru sebagai VERSI BARU. Hanya Super Admin (Direktur). Galat semantik memblokir; peringatan (mis. bobot ≠ 100) tidak. */
export async function saveIndicatorConfig(actor: Actor, raw: unknown): Promise<SaveConfigResult> {
  assertModuleEnabled();
  if (actor.role !== "SUPER_ADMIN") throw Errors.forbidden("Hanya Super Admin (Direktur) yang dapat mengubah rumus dan parameter indikator.");
  const input = parseInput(indicatorConfigSaveSchema, raw);
  const check = checkIndicatorConfig(input.config);
  if (check.errors.length) throw Errors.validation(check.errors[0]!, { config: check.errors.join(" · ") });
  return transaction(async (tx) => {
    await assertEmployeesActive(tx, [...Object.values(input.config.roleHolders).filter((x): x is string => !!x), ...input.config.facilitators]);
    const r = await persist(tx, actor, input.config, input.note, "Konfigurasi indikator diubah");
    return { version: r.version, warnings: check.warnings, changed: r.changed };
  });
}

/** Kembalikan ke nilai bawaan dokumen v1.0 — tetap menjadi VERSI BARU (riwayat tidak dihapus). Pemegang jabatan & fasilitator dipertahankan. */
export async function resetIndicatorConfig(actor: Actor): Promise<SaveConfigResult> {
  assertModuleEnabled();
  if (actor.role !== "SUPER_ADMIN") throw Errors.forbidden("Hanya Super Admin (Direktur) yang dapat mengubah rumus dan parameter indikator.");
  return transaction(async (tx) => {
    const cur = await loadConfig(tx);
    const fresh = defaultIndicatorConfig();
    fresh.roleHolders = cur.config.roleHolders;
    fresh.facilitators = cur.config.facilitators;
    const r = await persist(tx, actor, fresh, "Dikembalikan ke nilai bawaan dokumen v1.0", "Konfigurasi indikator dikembalikan ke bawaan");
    return { version: r.version, warnings: [], changed: r.changed };
  });
}
