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
 * Baris LAMA (dibuat sebelum ada `templateKey`) tidak ditebak: hanya bila NAMANYA PERSIS sama dengan tepat satu pekerjaan template (dan tidak ada yang kembar) ditautkan otomatis;
 * selain itu → "perlu diperiksa" (jabatan yang kini hanya punya satu pekerjaan hanya menjadi SARAN yang dikonfirmasi pengguna); bila ada dua baris untuk pekerjaan yang
 * sama → "kembar" untuk dirapikan pengguna.
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

/** Saran (BUKAN keputusan) pekerjaan template untuk baris lama yang tidak dapat ditautkan pasti: jabatannya kini hanya punya satu pekerjaan. Pengguna yang memastikan. */
export interface LegacySuggestion { key: string; task: string }
export type LegacyState =
  | { state: "LINK"; key: string; adjusted: boolean }
  | { state: "UNLINKED"; suggestion: LegacySuggestion | null }
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
    // PASTI hanya bila nama PERSIS sama dengan tepat satu pekerjaan. Jabatan yang kini hanya punya satu pekerjaan BUKAN bukti: pekerjaan lama bisa saja sudah diganti dengan yang lain,
    // dan menautkannya akan menulis ulang nama/jam/tanggalnya. Itu hanya SARAN yang dikonfirmasi pengguna (tidak ada data yang berubah sebelum itu).
    const key = byName.length === 1 ? byName[0]!.key : null;
    if (key === null) {
      const only = byName.length === 0 && sameRole.length === 1 ? sameRole[0]! : null;
      byRow.set(r.id, { state: "UNLINKED", suggestion: only ? { key: only.key, task: only.task } : null });
      continue;
    }
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

/** Mengapa sebuah pekerjaan template yang BERLAKU belum dapat dihitung sekarang (bukan berarti pekerjaannya sudah tidak ada): jabatannya belum punya pemegang aktif, atau tanggal acuan (H/T) belum lengkap. */
export type UnresolvedReason = "NO_HOLDER" | "NO_DATES";
export const UNRESOLVED_TEXT: Record<UnresolvedReason, string> = {
  NO_HOLDER: "pemegang jabatannya belum aktif — tetapkan pemegang jabatan yang aktif di Rumus Indikator lalu hitung ulang agar pekerjaan ini dialihkan",
  NO_DATES: "tanggal acuan (H/T) belum lengkap — lengkapi tanggal program lalu hitung ulang",
};

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
  /** Baris Terbuka yang pekerjaan template-nya masih berlaku tetapi BELUM DAPAT DIHITUNG sekarang: DIPERTAHANKAN apa adanya (tidak dihapus, tidak diubah). */
  keptUnresolved: { id: string; name: string; reason: UnresolvedReason }[];
  /** Baris lama yang meragukan / kembar (tidak disentuh). */
  review: { id: string; name: string; state: "UNLINKED" | "DUPLICATE"; suggestion?: LegacySuggestion | null }[];
  /** Pekerjaan template yang TIDAK dibuat karena masih ada baris lama yang asalnya belum jelas. */
  blocked: { templateKey: string; name: string }[];
  warnings: string[];
}

/**
 * Rencana sinkronisasi. `skipWarnings` = peringatan dari pembentukan hitungan template (mis. jabatan belum punya pemegang) yang diteruskan apa adanya.
 * Sama persis dipakai saat membuat, menghitung ulang, dan mengganti jenis program — jadi hasilnya konsisten dan idempoten: masukan yang sama → rencana kosong.
 */
export function planWorkloadSync(args: {
  entries: readonly TemplateEntry[]; desired: readonly DesiredRow[]; existing: readonly ExistingRow[]; skipWarnings?: readonly string[];
  /** ID baris tabel jam yang BERLAKU tetapi belum dapat dihitung (lihat `UnresolvedReason`). Barisnya tidak dihapus: "tidak dapat dihitung" ≠ "tidak berlaku lagi". */
  unresolved?: ReadonlyMap<string, UnresolvedReason>;
}): SyncPlan {
  const { entries, desired, existing } = args;
  const unresolved = args.unresolved ?? new Map<string, UnresolvedReason>();
  const cls = classifyLegacy(existing, entries);
  const plan: SyncPlan = { link: [], create: [], update: [], remove: [], drift: [], orphanKept: [], keptUnresolved: [], review: [], blocked: [], warnings: [...(args.skipWarnings ?? [])] };

  // Baris yang sudah (atau akan) punya ID.
  const keyed = new Map<string, ExistingRow>();
  for (const r of existing) if (r.templateKey !== null) keyed.set(r.templateKey, r);
  for (const r of existing) {
    const s = cls.byRow.get(r.id);
    if (s?.state === "LINK") { plan.link.push({ id: r.id, templateKey: s.key, adjusted: s.adjusted }); keyed.set(s.key, { ...r, templateKey: s.key, adjusted: s.adjusted }); }
    else if (s) plan.review.push(s.state === "UNLINKED" ? { id: r.id, name: r.name, state: "UNLINKED", suggestion: s.suggestion } : { id: r.id, name: r.name, state: "DUPLICATE" });
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
    const why = unresolved.get(key);
    if (why) { if (r.status === "OPEN") plan.keptUnresolved.push({ id: r.id, name: r.name, reason: why }); continue; }   // belum dapat dihitung ≠ tidak berlaku: JANGAN dihapus
    if (!r.adjusted && r.status === "OPEN") plan.remove.push({ id: r.id, name: r.name });
    else plan.orphanKept.push({ id: r.id, name: r.name });
  }

  const names = (xs: { name: string }[]) => xs.slice(0, 3).map((x) => `"${x.name}"`).join(", ") + (xs.length > 3 ? `, +${xs.length - 3} lainnya` : "");
  if (plan.drift.length) plan.warnings.push(`${plan.drift.length} baris jam kerja sudah disesuaikan manual sehingga TIDAK ikut berubah mengikuti template (${names(plan.drift)}). Pakai "Kembalikan ke template" bila ingin mengikuti lagi.`);
  for (const k of plan.keptUnresolved.slice(0, 5)) plan.warnings.push(`Jam kerja "${k.name}" DIPERTAHANKAN (tidak dihapus): ${UNRESOLVED_TEXT[k.reason]}.`);
  if (plan.keptUnresolved.length > 5) plan.warnings.push(`+${plan.keptUnresolved.length - 5} baris jam kerja lain juga dipertahankan karena belum dapat dihitung ulang.`);
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
