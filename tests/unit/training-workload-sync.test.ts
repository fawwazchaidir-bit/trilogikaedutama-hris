/**
 * Sinkronisasi tugas jam kerja dengan Tabel Jam Standar (logika murni): identitas asal template yang TETAP, "disesuaikan" terpisah dari asal,
 * baris lama tidak ditebak, hasil idempoten.
 */
import { describe, expect, it } from "vitest";
import { classifyLegacy, planIsEmpty, planWorkloadSync, revertChanges, type DesiredRow, type ExistingRow, type TemplateEntry } from "@/lib/training/workload-sync";
import { defaultIndicatorConfig, fillHourIds, indicatorConfigSchema, checkIndicatorConfig } from "@/lib/training/indicators/config";

const E: TemplateEntry[] = [
  { key: "k-kampanye", roleKey: "MM", task: "Kampanye" },
  { key: "k-promosi", roleKey: "SOC", task: "Promosi" },
  { key: "k-spv-1", roleKey: "SPV", task: "Instruktur" },
  { key: "k-spv-2", roleKey: "SPV", task: "Laporan" },
];
const des = (key: string, over: Partial<DesiredRow> = {}): DesiredRow => {
  const e = E.find((x) => x.key === key)!;
  return { templateKey: key, roleKey: e.roleKey, name: e.task, employeeId: `emp-${e.roleKey}`, hours: 8, startDate: "2027-03-01", endDate: "2027-03-10", ...over };
};
const row = (id: string, over: Partial<ExistingRow> = {}): ExistingRow => ({
  id, source: "TEMPLATE", templateKey: null, roleKey: null, name: "x", employeeId: "emp-x", hours: 8, startDate: "2027-03-01", endDate: "2027-03-10", status: "OPEN", adjusted: false, originReviewed: false, ...over,
});
const keyedRow = (key: string, id: string, over: Partial<ExistingRow> = {}) => {
  const d = des(key);
  return row(id, { templateKey: key, roleKey: d.roleKey, name: d.name, employeeId: d.employeeId, hours: d.hours, startDate: d.startDate, endDate: d.endDate, ...over });
};
const all = E.map((e) => des(e.key));

describe("sinkronisasi jam kerja — baris ber-ID", () => {
  it("masukan sama → rencana KOSONG (idempoten): tidak ada baris baru, jumlah & jam tetap", () => {
    const existing = E.map((e, i) => keyedRow(e.key, `r${i}`));
    const p = planWorkloadSync({ entries: E, desired: all, existing });
    expect(planIsEmpty(p)).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it("belum ada baris → semua dibuat, sekali saja", () => {
    const p = planWorkloadSync({ entries: E, desired: all, existing: [] });
    expect(p.create.map((c) => c.templateKey)).toEqual(E.map((e) => e.key));
  });

  it("belum disentuh & Terbuka: mengikuti template (jam/tanggal/staf/nama diperbarui); tanggal & peserta berubah → baris ikut berubah", () => {
    const existing = [keyedRow("k-kampanye", "a")];
    const p = planWorkloadSync({ entries: [E[0]!], desired: [des("k-kampanye", { hours: 12, startDate: "2027-03-05", employeeId: "emp-baru" })], existing });
    expect(p.update).toHaveLength(1);
    expect(p.update[0]).toMatchObject({ id: "a", fields: expect.arrayContaining(["hours", "startDate", "employeeId"]) });
    expect(p.create).toEqual([]);
  });

  it("SUDAH DISESUAIKAN: dipertahankan, TIDAK dibuatkan baris baru; berbeda dari template → peringatan (bukan update)", () => {
    const existing = [keyedRow("k-kampanye", "a", { adjusted: true, hours: 5, name: "Kampanye (diubah)" })];
    const p = planWorkloadSync({ entries: [E[0]!], desired: [des("k-kampanye")], existing });
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.drift).toMatchObject([{ id: "a", fields: expect.arrayContaining(["hours", "name"]) }]);
    expect(p.warnings.join(" ")).toMatch(/disesuaikan manual.*TIDAK ikut berubah/);
  });

  it("SUDAH SELESAI: dipertahankan beserta status; tidak dibuat ulang, tidak dibuka kembali, tidak diubah", () => {
    for (const status of ["DONE", "CANCELLED"] as const) {
      const existing = [keyedRow("k-kampanye", "a", { status, hours: 99 })];
      const p = planWorkloadSync({ entries: [E[0]!], desired: [des("k-kampanye")], existing });
      expect(planIsEmpty(p), status).toBe(true);
    }
  });

  it("pemegang jabatan berganti: baris belum disentuh pindah ke staf baru — TIDAK muncul dua baris", () => {
    const existing = [keyedRow("k-kampanye", "a")];
    const p = planWorkloadSync({ entries: [E[0]!], desired: [des("k-kampanye", { employeeId: "emp-pengganti" })], existing });
    expect(p.create).toEqual([]);
    expect(p.update).toMatchObject([{ id: "a", fields: ["employeeId"] }]);
  });

  it("pekerjaan tidak berlaku lagi: baris belum disentuh dihapus; yang disesuaikan/selesai dipertahankan dengan peringatan", () => {
    const existing = [keyedRow("k-kampanye", "a"), keyedRow("k-promosi", "b", { adjusted: true }), keyedRow("k-spv-1", "c", { status: "DONE" })];
    const p = planWorkloadSync({ entries: E, desired: [], existing });
    expect(p.remove).toEqual([{ id: "a", name: "Kampanye" }]);
    expect(p.orphanKept.map((x) => x.id).sort()).toEqual(["b", "c"]);
  });

  it("baris MANUAL dari awal (tanpa jabatan) tidak pernah disentuh dan tidak memblokir template", () => {
    const manual = row("m", { source: "MANUAL", roleKey: null, name: "Rapat khusus klien" });
    const p = planWorkloadSync({ entries: E, desired: [des("k-kampanye")], existing: [manual] });
    expect(p.create.map((c) => c.templateKey)).toEqual(["k-kampanye"]);
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
  });

  it("ID tetap walau nama pekerjaan/urutan tabel berubah: identitas = ID, bukan nama", () => {
    const existing = [keyedRow("k-kampanye", "a", { name: "Nama lama" })];
    const p = planWorkloadSync({ entries: [E[0]!], desired: [des("k-kampanye", { name: "Nama baru di template" })], existing });
    expect(p.create).toEqual([]);
    expect(p.update).toMatchObject([{ id: "a", fields: ["name"] }]);
  });
});

describe("baris LAMA (sebelum ada ID) — tidak ditebak", () => {
  it("baris template lama yang tak pernah diedit & namanya cocok tepat satu baris tabel → ditautkan otomatis (tidak disesuaikan)", () => {
    const legacy = row("l", { source: "TEMPLATE", roleKey: "MM", name: "Kampanye" });
    const p = planWorkloadSync({ entries: E, desired: [des("k-kampanye")], existing: [legacy] });
    expect(p.link).toEqual([{ id: "l", templateKey: "k-kampanye", adjusted: false }]);
    expect(p.create).toEqual([]);
  });

  it("baris lama berstatus MANUAL tetapi berjabatan (= template yang diedit) & cocok pasti → ditautkan sebagai DISESUAIKAN; tidak dibuatkan baris baru", () => {
    const legacy = row("l", { source: "MANUAL", roleKey: "MM", name: "Kampanye", hours: 5 });
    const p = planWorkloadSync({ entries: E, desired: [des("k-kampanye")], existing: [legacy] });
    expect(p.link).toEqual([{ id: "l", templateKey: "k-kampanye", adjusted: true }]);
    expect(p.create).toEqual([]);
    expect(p.drift).toMatchObject([{ id: "l", fields: expect.arrayContaining(["hours"]) }]);   // tertaut + langsung diberi tahu bahwa jamnya berbeda dari template (dipertahankan)
  });

  it("nama diubah tetapi jabatan hanya punya SATU pekerjaan di tabel → pasti (jabatan jadi bukti)", () => {
    const legacy = row("l", { source: "MANUAL", roleKey: "SOC", name: "Materi promosi versi baru" });
    expect(classifyLegacy([legacy], E).byRow.get("l")).toEqual({ state: "LINK", key: "k-promosi", adjusted: true });
  });

  it("nama diubah & jabatan punya BEBERAPA pekerjaan → PERLU DIPERIKSA; tidak ditebak; pekerjaan jabatan itu tidak dibuat diam-diam", () => {
    const legacy = row("l", { source: "MANUAL", roleKey: "SPV", name: "Nama yang sudah berubah" });
    const p = planWorkloadSync({ entries: E, desired: [des("k-spv-1"), des("k-spv-2"), des("k-kampanye")], existing: [legacy] });
    expect(p.review).toEqual([{ id: "l", name: "Nama yang sudah berubah", state: "UNLINKED" }]);
    expect(p.link).toEqual([]);
    expect(p.create.map((c) => c.templateKey)).toEqual(["k-kampanye"]);          // jabatan lain tetap berjalan
    expect(p.blocked.map((b) => b.templateKey).sort()).toEqual(["k-spv-1", "k-spv-2"]);
    expect(p.warnings.join(" ")).toMatch(/perlu diperiksa asalnya/);
  });

  it("KEMBAR (bug lama): satu baris disesuaikan + salinan template untuk pekerjaan yang sama → keduanya ditandai, tidak ada yang diubah/dibuat", () => {
    const edited = row("m", { source: "MANUAL", roleKey: "MM", name: "Kampanye", hours: 5 });
    const copy = row("t", { source: "TEMPLATE", roleKey: "MM", name: "Kampanye", hours: 3 });
    const c = classifyLegacy([edited, copy], E);
    expect(c.byRow.get("m")).toEqual({ state: "DUPLICATE", key: "k-kampanye" });
    expect(c.byRow.get("t")).toEqual({ state: "DUPLICATE", key: "k-kampanye" });
    expect(c.duplicateGroups).toEqual([{ key: "k-kampanye", rowIds: ["m", "t"] }]);
    const p = planWorkloadSync({ entries: E, desired: [des("k-kampanye")], existing: [edited, copy] });
    expect(p.create).toEqual([]);
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
    expect(p.review.map((r) => r.state)).toEqual(["DUPLICATE", "DUPLICATE"]);
  });

  it("baris lama yang cocok dengan baris yang SUDAH ber-ID → kembar dengan baris itu (keduanya masuk kelompok)", () => {
    const keyed = keyedRow("k-kampanye", "k");
    const legacy = row("l", { source: "MANUAL", roleKey: "MM", name: "Kampanye" });
    expect(classifyLegacy([keyed, legacy], E).duplicateGroups).toEqual([{ key: "k-kampanye", rowIds: ["k", "l"] }]);
  });

  it("kembar dengan baris yang SUDAH ber-ID: baris ber-ID itu pun tidak diperbarui/dihapus otomatis sampai pengguna memutuskan", () => {
    const keyed = keyedRow("k-kampanye", "k", { hours: 3 });                                  // berbeda dari hitungan template (8)
    const legacy = row("l", { source: "MANUAL", roleKey: "MM", name: "Kampanye", hours: 5 });
    const p = planWorkloadSync({ entries: E, desired: [des("k-kampanye")], existing: [keyed, legacy] });
    expect(p.update).toEqual([]);
    expect(p.remove).toEqual([]);
    expect(p.create).toEqual([]);
    expect(p.review.map((r) => r.id)).toEqual(["l"]);
    const gone = planWorkloadSync({ entries: E, desired: [], existing: [keyed, legacy] });          // pekerjaan tak berlaku lagi pun: kembar tetap menunggu keputusan
    expect(gone.remove).toEqual([]);
  });

  it("baris lama yang sudah ditinjau pengguna (berdiri sendiri) tidak dianggap lama lagi", () => {
    const legacy = row("l", { source: "MANUAL", roleKey: "MM", name: "Kampanye", originReviewed: true });
    expect(classifyLegacy([legacy], E).byRow.size).toBe(0);
    const p = planWorkloadSync({ entries: E, desired: [des("k-kampanye")], existing: [legacy] });
    expect(p.create.map((c) => c.templateKey)).toEqual(["k-kampanye"]);          // dinyatakan berdiri sendiri → template tetap dibuat
  });
});

describe("kembalikan ke template — pratinjau perubahan", () => {
  it("menyebut apa yang berubah: jam, tanggal, nama, staf; kosong bila sudah sama", () => {
    const cur = { name: "Kampanye (diubah)", employeeId: "e1", hours: 5, startDate: "2027-03-02", endDate: "2027-03-10" };
    const tpl = { name: "Kampanye", employeeId: "e2", hours: 8, startDate: "2027-03-01", endDate: "2027-03-10" };
    const ch = revertChanges(cur, tpl, (id) => ({ e1: "Ayu", e2: "Budi" })[id] ?? id);
    expect(ch.map((c) => [c.label, c.current, c.template])).toEqual([
      ["Nama pekerjaan", "Kampanye (diubah)", "Kampanye"], ["Staf", "Ayu", "Budi"], ["Jam", 5, 8], ["Mulai", "2027-03-02", "2027-03-01"],
    ]);
    expect(revertChanges(tpl, tpl, (id) => id)).toEqual([]);
  });
});

describe("ID baris tabel jam standar (konfigurasi)", () => {
  it("bawaan: setiap baris punya ID tetap yang unik, dan konfigurasi lolos validasi", () => {
    const c = defaultIndicatorConfig();
    const ids = c.hourTable.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(indicatorConfigSchema.safeParse(c).success).toBe(true);
    expect(checkIndicatorConfig(c).errors).toEqual([]);
  });

  it("konfigurasi LAMA tanpa ID: baris yang cocok dengan bawaan memakai ID bawaannya; yang lain mendapat ID turunan yang stabil; ID yang ada tidak disentuh", () => {
    const d = defaultIndicatorConfig();
    const legacy = JSON.parse(JSON.stringify(d)) as { hourTable: Record<string, unknown>[] };
    const original = d.hourTable.map((h) => h.id);
    for (const h of legacy.hourTable) delete h.id;
    legacy.hourTable.push({ ...legacy.hourTable[0]!, task: "Tugas tambahan lama" });
    const a = fillHourIds(legacy) as { hourTable: { id: string; task: string }[] };
    const b = fillHourIds(legacy) as { hourTable: { id: string }[] };
    expect(a.hourTable.slice(0, original.length).map((h) => h.id)).toEqual(original);
    expect(a.hourTable[original.length]!.id).toMatch(/^legacy-/);
    expect(b.hourTable.map((h) => h.id)).toEqual(a.hourTable.map((h) => h.id));        // stabil antar pemanggilan
    const again = fillHourIds(a);
    expect(again).toEqual(a);                                                              // tidak mengubah yang sudah ber-ID
    expect(indicatorConfigSchema.safeParse(a).success).toBe(true);
  });

  it("ID tidak bergantung pada nama/urutan/jam/pemegang: mengubahnya tidak mengganti ID", () => {
    const c = defaultIndicatorConfig();
    const before = c.hourTable.map((h) => h.id);
    c.hourTable.reverse();
    c.hourTable[0]!.task = "Nama baru"; c.hourTable[0]!.fixed.REGULAR = 99; c.hourTable[0]!.roleKey = c.hourTable[1]!.roleKey;
    expect(c.hourTable.map((h) => h.id).sort()).toEqual([...before].sort());
  });

  it("ID kembar ditolak saat simpan; baris tanpa ID dari klien lama dilengkapi", () => {
    const c = defaultIndicatorConfig();
    c.hourTable[1]!.id = c.hourTable[0]!.id;
    expect(checkIndicatorConfig(c).errors.join(" ")).toMatch(/ID baris kembar/);
  });
});
