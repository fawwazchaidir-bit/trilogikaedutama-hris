/**
 * Sinkronisasi tugas jam kerja (indikator Beban Tim) dengan Tabel Jam Standar — logika MURNI (dapat diuji tanpa database).
 *
 * Masalah yang diperbaiki: baris template yang diedit/diselesaikan dulu berubah menjadi MANUAL; hitung ulang lalu membuat baris template yang sama lagi,
 * sehingga satu pekerjaan terhitung dua kali. Kini setiap baris asal-template membawa ID TETAP baris tabel jam (`templateKey`), dan "sudah disesuaikan"
 * disimpan terpisah (`adjusted`). Saat dihitung ulang:
 *
 *   Dari template, belum disentuh, masih Terbuka  → mengikuti hitungan template (diperbarui bila berbeda; dihapus bila tidak berlaku lagi).
 *   Dari template, sudah DISESUAIKAN               → dipertahankan apa adanya (tidak dibuatkan baris baru); bila berbeda dari template → peringatan.
 *   Dari template, sudah SELESAI/dibatalkan        → dipertahankan beserta status & riwayatnya.
 *   Dibuat manual dari awal                         → berdiri sendiri, tidak pernah ditimpa.
 *
 * Baris LAMA (dibuat sebelum ada `templateKey`) tidak ditebak: bila asalnya pasti (nama/jabatan cocok dengan tepat satu baris tabel jam dan tidak ada yang
 * kembar) ditautkan otomatis; bila meragukan → "perlu diperiksa"; bila ada dua baris untuk pekerjaan yang sama → "kembar" untuk dirapikan pengguna.
 */

export type WorkloadStatus = "OPEN" | "DONE" | "CANCELLED";

/** Baris Tabel Jam Standar yang BERLAKU untuk proyek ini (jenis program & moda cocok). */
export interface TemplateEntry { key: string; roleKey: string; task: string }

/** Hasil hitungan template untuk satu baris tabel jam (sudah ada pemegang jabatan aktif & jam > 0 & tanggal lengkap). */
export interface DesiredRow { templateKey: string; roleKey: string; name: string; employeeId: string; hours: number; startDate: string; endDate: string }

export interface ExistingRow {
  id: string; source: "TEMPLATE" | "MANUAL"; templateKey: string | null; roleKey: string | null;
  name: string; employeeId: string; hours: number; startDate: string; endDate: string;
  status: WorkloadStatus; adjusted: boolean;
  /** Baris lama yang asalnya sudah ditinjau pengguna (tautkan/berdiri sendiri). */
  originReviewed: boolean;
}

/** Baris LAMA yang belum punya identitas: pernah berasal dari template (jabatan terisi) dan belum ditinjau. Baris manual dari awal tidak pernah berjabatan. */
export const isLegacyUnresolved = (r: Pick<ExistingRow, "templateKey" | "roleKey" | "originReviewed">): boolean => r.templateKey === null && r.roleKey !== null && !r.originReviewed;

export type LegacyState =
  | { state: "LINK"; key: string; adjusted: boolean }
  | { state: "UNLINKED" }
  | { state: "DUPLICATE"; key: string };

export interface LegacyClassification {
  /** Hanya baris lama yang belum ditinjau. */
  byRow: Map<string, LegacyState>;
  /** Kelompok kembar: satu pekerjaan template yang diklaim lebih dari satu baris (termasuk baris ber-ID bila ada). */
  duplicateGroups: { key: string; rowIds: string[] }[];
}

/** Tentukan asal baris lama TANPA menebak. */
export function classifyLegacy(rows: readonly ExistingRow[], entries: readonly TemplateEntry[]): LegacyClassification {
  const byRow = new Map<string, LegacyState>();
  const keyedBy = new Map(rows.filter((r) => r.templateKey !== null).map((r) => [r.templateKey!, r.id]));
  const claim = new Map<string, string[]>();
  for (const r of rows) {
    if (!isLegacyUnresolved(r)) continue;
    const sameRole = entries.filter((e) => e.roleKey === r.roleKey);
    const byName = sameRole.filter((e) => e.task === r.name);
    const key = byName.length === 1 ? byName[0]!.key : byName.length === 0 && sameRole.length === 1 ? sameRole[0]!.key : null;
    if (key === null) { byRow.set(r.id, { state: "UNLINKED" }); continue; }
    claim.set(key, [...(claim.get(key) ?? []), r.id]);
  }
  const duplicateGroups: LegacyClassification["duplicateGroups"] = [];
  for (const [key, ids] of claim) {
    const keyed = keyedBy.get(key);
    if (ids.length === 1 && !keyed) {
      const r = rows.find((x) => x.id === ids[0])!;
      byRow.set(r.id, { state: "LINK", key, adjusted: r.source === "MANUAL" || r.adjusted });
    } else {
      for (const id of ids) byRow.set(id, { state: "DUPLICATE", key });
      duplicateGroups.push({ key, rowIds: [...(keyed ? [keyed] : []), ...ids] });
    }
  }
  return { byRow, duplicateGroups };
}

const EPS = 1e-6;
export interface RowValues { name: string; employeeId: string; hours: number; startDate: string; endDate: string }
export function valueChanges(current: RowValues, template: RowValues): (keyof RowValues)[] {
  const out: (keyof RowValues)[] = [];
  if (current.name !== template.name) out.push("name");
  if (current.employeeId !== template.employeeId) out.push("employeeId");
  if (Math.abs(current.hours - template.hours) > EPS) out.push("hours");
  if (current.startDate !== template.startDate) out.push("startDate");
  if (current.endDate !== template.endDate) out.push("endDate");
  return out;
}

export interface SyncPlan {
  /** Baris lama yang pasti asalnya → diberi templateKey (& penanda disesuaikan). */
  link: { id: string; templateKey: string; adjusted: boolean }[];
  create: DesiredRow[];
  update: { id: string; templateKey: string; fields: (keyof RowValues)[]; to: DesiredRow }[];
  remove: { id: string; name: string }[];
  /** Baris disesuaikan yang kini berbeda dari hitungan template (dipertahankan). */
  drift: { id: string; name: string; fields: (keyof RowValues)[] }[];
  /** Baris disesuaikan/selesai yang tidak lagi ada di template (dipertahankan). */
  orphanKept: { id: string; name: string }[];
  /** Baris lama yang meragukan / kembar (tidak disentuh). */
  review: { id: string; name: string; state: "UNLINKED" | "DUPLICATE" }[];
  /** Pekerjaan template yang TIDAK dibuat karena masih ada baris lama yang asalnya belum jelas. */
  blocked: { templateKey: string; name: string }[];
  warnings: string[];
}

/**
 * Rencana sinkronisasi. `skipWarnings` = peringatan dari pembentukan hitungan template (mis. jabatan belum punya pemegang) yang diteruskan apa adanya.
 * Sama persis dipakai saat membuat, menghitung ulang, dan mengganti jenis program — jadi hasilnya konsisten dan idempoten: masukan yang sama → rencana kosong.
 */
export function planWorkloadSync(args: { entries: readonly TemplateEntry[]; desired: readonly DesiredRow[]; existing: readonly ExistingRow[]; skipWarnings?: readonly string[] }): SyncPlan {
  const { entries, desired, existing } = args;
  const cls = classifyLegacy(existing, entries);
  const plan: SyncPlan = { link: [], create: [], update: [], remove: [], drift: [], orphanKept: [], review: [], blocked: [], warnings: [...(args.skipWarnings ?? [])] };

  // Baris yang sudah (atau akan) punya ID.
  const keyed = new Map<string, ExistingRow>();
  for (const r of existing) if (r.templateKey !== null) keyed.set(r.templateKey, r);
  for (const r of existing) {
    const s = cls.byRow.get(r.id);
    if (s?.state === "LINK") { plan.link.push({ id: r.id, templateKey: s.key, adjusted: s.adjusted }); keyed.set(s.key, { ...r, templateKey: s.key, adjusted: s.adjusted }); }
    else if (s) plan.review.push({ id: r.id, name: r.name, state: s.state === "DUPLICATE" ? "DUPLICATE" : "UNLINKED" });
  }
  const blockedKeys = new Set(cls.duplicateGroups.map((g) => g.key));
  const blockedRoles = new Set(existing.filter((r) => cls.byRow.get(r.id)?.state === "UNLINKED").map((r) => r.roleKey!));

  const wanted = new Set(desired.map((d) => d.templateKey));
  for (const d of desired) {
    const r = keyed.get(d.templateKey);
    if (r) {
      const fields = valueChanges(r, d);
      if (r.adjusted || r.status !== "OPEN") { if (r.adjusted && r.status === "OPEN" && fields.length) plan.drift.push({ id: r.id, name: r.name, fields }); continue; }
      if (blockedKeys.has(d.templateKey)) continue;                                    // kembar: tunggu keputusan pengguna
      if (fields.length) plan.update.push({ id: r.id, templateKey: d.templateKey, fields, to: d });
      continue;
    }
    if (blockedKeys.has(d.templateKey) || blockedRoles.has(d.roleKey)) { plan.blocked.push({ templateKey: d.templateKey, name: d.name }); continue; }
    plan.create.push(d);
  }
  for (const [key, r] of keyed) {
    if (wanted.has(key) || blockedKeys.has(key)) continue;
    if (!r.adjusted && r.status === "OPEN") plan.remove.push({ id: r.id, name: r.name });
    else plan.orphanKept.push({ id: r.id, name: r.name });
  }

  const names = (xs: { name: string }[]) => xs.slice(0, 3).map((x) => `"${x.name}"`).join(", ") + (xs.length > 3 ? `, +${xs.length - 3} lainnya` : "");
  if (plan.drift.length) plan.warnings.push(`${plan.drift.length} baris jam kerja sudah disesuaikan manual sehingga TIDAK ikut berubah mengikuti template (${names(plan.drift)}). Pakai "Kembalikan ke template" bila ingin mengikuti lagi.`);
  if (plan.orphanKept.length) plan.warnings.push(`${plan.orphanKept.length} baris jam kerja yang disesuaikan/selesai tidak lagi ada di template dan dipertahankan (${names(plan.orphanKept)}).`);
  if (plan.review.length) plan.warnings.push(`${plan.review.length} baris jam kerja lama perlu diperiksa asalnya (${names(plan.review)}) — tidak diubah.`);
  for (const b of plan.blocked) plan.warnings.push(`Jam kerja "${b.name}" belum dibuat: masih ada baris lama untuk pekerjaan/jabatan ini yang asalnya belum jelas. Periksa dulu di tab Pemantauan.`);
  return plan;
}

export const planIsEmpty = (p: SyncPlan): boolean => !p.link.length && !p.create.length && !p.update.length && !p.remove.length;

/** Perubahan yang akan terjadi bila baris dikembalikan ke template (untuk pratinjau sebelum menerapkan). */
export interface RevertChange { field: keyof RowValues; label: string; current: string | number; template: string | number }
export const REVERT_LABEL: Record<keyof RowValues, string> = { name: "Nama pekerjaan", employeeId: "Staf", hours: "Jam", startDate: "Mulai", endDate: "Selesai" };
export function revertChanges(current: RowValues, template: RowValues, employeeName: (id: string) => string): RevertChange[] {
  return valueChanges(current, template).map((field) => ({
    field, label: REVERT_LABEL[field],
    current: field === "employeeId" ? employeeName(current.employeeId) : current[field],
    template: field === "employeeId" ? employeeName(template.employeeId) : template[field],
  }));
}
