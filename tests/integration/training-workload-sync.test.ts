/**
 * Tugas jam kerja (indikator Beban Tim) vs Tabel Jam Standar — TANPA hitung ganda.
 * Baris asal-template membawa ID tetap baris tabel jam; "disesuaikan" disimpan terpisah dari asal; hitung ulang idempoten; baris lama tidak ditebak.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { defaultIndicatorConfig, type IndicatorConfig } from "@/lib/training/indicators/config";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { saveIndicatorConfig, loadConfig } from "@/server/services/training/indicator-config";
import { updateProject } from "@/server/services/training/projects";
import {
  addWorkloadTask, listWorkloadTasks, listWorkloadTemplateEntries, mergeWorkloadDuplicates, previewWorkloadRevert, regenerateProjectWorkload, reviewWorkloadRow, revertWorkloadToTemplate,
  updateWorkloadTask,
} from "@/server/services/training/indicator-data";

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

async function setConfig(mutate?: (c: IndicatorConfig) => void) {
  const c = defaultIndicatorConfig();
  c.roleHolders = {
    SPV_CURRICULUM: fx.empIds[0], MANAGER_MARKETING: fx.empIds[1], MANAGER_OPS: fx.mgrEmp, STAFF_GENERAL: fx.empIds[2], STAFF_CURRICULUM: fx.admEmp,
    STAFF_FINANCE: fx.lonerEmp, STAFF_ADMISI_2: fx.lonerEmp, STAFF_SOCIAL: fx.lonerEmp, SPV_IT: fx.empIds[2], FACILITATOR: fx.empIds[1],
  };
  c.facilitators = [fx.empIds[0], fx.empIds[1]];
  mutate?.(c);
  await saveIndicatorConfig(fx.superAdmin, { config: c, note: "uji" });
}
async function program(over: Record<string, unknown> = {}) {
  const id = await mkProject(fx.mgr, { startDate: inDays(40), endDate: inDays(42), participantsMin: 20, ...over });
  await addTeam(fx.mgr, id, [[fx.empIds[0]!, "PROJECT_MANAGER"]]);
  return id;
}
const rowsOf = (id: string) => prisma.trainingWorkloadTask.findMany({ where: { projectId: id }, orderBy: { name: "asc" } });
const totalHours = (rs: { hours: number }[]) => Math.round(rs.reduce((a, r) => a + r.hours, 0) * 1000) / 1000;
const byKey = async (id: string, key: string) => (await rowsOf(id)).find((r) => r.templateKey === key)!;
const idsAndHours = (rs: { id: string; hours: number }[]) => rs.map((r) => `${r.id}:${r.hours}`).sort();

describe("hitung ulang idempoten", () => {
  it("dihitung ulang berulang kali: jumlah baris, ID baris, dan total jam TETAP; setiap baris asal-template punya ID tetap", async () => {
    await setConfig();
    const id = await program();
    const before = await rowsOf(id);
    expect(before.length).toBeGreaterThanOrEqual(5);
    expect(before.every((r) => r.templateKey !== null && r.source === "TEMPLATE" && !r.adjusted)).toBe(true);
    for (let i = 0; i < 3; i++) {
      const r = await regenerateProjectWorkload(fx.mgr, id);
      expect(r).toMatchObject({ created: 0, updated: 0, removed: 0, linked: 0, review: 0, warnings: [] });
    }
    const after = await rowsOf(id);
    expect(idsAndHours(after)).toEqual(idsAndHours(before));
    expect(totalHours(after)).toBe(totalHours(before));
  });
});

describe("baris disesuaikan / selesai / manual", () => {
  it("baris DIEDIT lalu dihitung ulang: jumlah baris tidak bertambah; asal tetap Template, ditandai Disesuaikan; ada peringatan 'tidak ikut berubah'", async () => {
    await setConfig();
    const id = await program();
    const before = await rowsOf(id);
    const target = before.find((r) => r.templateKey === "kampanye-reguler")!;
    await updateWorkloadTask(fx.mgr, target.id, { hours: target.hours + 2 });
    const edited = await byKey(id, "kampanye-reguler");
    expect(edited).toMatchObject({ source: "TEMPLATE", adjusted: true, hours: target.hours + 2 });
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(r.warnings.join(" ")).toMatch(/1 baris jam kerja sudah disesuaikan manual.*TIDAK ikut berubah/);
    const after = await rowsOf(id);
    expect(after).toHaveLength(before.length);
    expect(totalHours(after)).toBe(totalHours(before) + 2);
    expect((await listWorkloadTasks(fx.mgr, id)).find((x) => x.id === target.id)).toMatchObject({ adjusted: true, differsFromTemplate: true, canRevert: true, review: null });
  });

  it("baris SELESAI lalu dihitung ulang: status tetap Selesai, tidak dibuka kembali, tidak ada baris baru — juga setelah tanggal program berubah", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    const target = await byKey(id, "admin-umum");
    await updateWorkloadTask(fx.mgr, target.id, { status: "DONE" });
    expect(await byKey(id, "admin-umum")).toMatchObject({ status: "DONE", source: "TEMPLATE", adjusted: false });   // status saja bukan "penyesuaian"; asal tidak berubah
    await regenerateProjectWorkload(fx.mgr, id);
    await updateProject(fx.mgr, id, { startDate: inDays(50), endDate: inDays(52) });                                 // memicu hitung ulang otomatis
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n);
    expect(rows.filter((r) => r.templateKey === "admin-umum")).toHaveLength(1);
    expect(await byKey(id, "admin-umum")).toMatchObject({ id: target.id, status: "DONE", hours: target.hours, startDate: target.startDate });   // riwayatnya utuh
  });

  it("tanggal & jumlah peserta berubah: baris belum disentuh ikut berubah; baris disesuaikan TETAP (peringatan); selesai TETAP; jumlah baris sama", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    const free = await byKey(id, "kampanye-reguler");
    const adj = await byKey(id, "spv-kurikulum");
    const done = await byKey(id, "staf-kurikulum");
    await updateWorkloadTask(fx.mgr, adj.id, { hours: 1 });
    await updateWorkloadTask(fx.mgr, done.id, { status: "DONE" });
    await updateProject(fx.mgr, id, { startDate: inDays(60), endDate: inDays(63), participantsMin: 30 });
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n);
    const nowFree = rows.find((r) => r.id === free.id)!;
    expect(nowFree.startDate.getTime()).not.toBe(free.startDate.getTime());                   // mengikuti template
    expect(rows.find((r) => r.id === adj.id)).toMatchObject({ hours: 1, startDate: adj.startDate });             // disesuaikan: tetap
    expect(rows.find((r) => r.id === done.id)).toMatchObject({ status: "DONE", hours: done.hours, startDate: done.startDate });
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.indicator.workload" }, orderBy: { id: "desc" } });
    expect(au.summary).toMatch(/peringatan/);
    expect(JSON.stringify(au.after)).toContain("disesuaikan manual");
  });

  it("pemegang jabatan berganti: baris belum disentuh pindah ke staf baru (TIDAK muncul dua baris); yang disesuaikan tetap pada stafnya + peringatan", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    const free = await byKey(id, "admin-umum");
    const adj = await byKey(id, "spv-kurikulum");
    await updateWorkloadTask(fx.mgr, adj.id, { hours: adj.hours + 1 });
    await setConfig((c) => { c.roleHolders.STAFF_GENERAL = fx.empIds[1]!; c.roleHolders.SPV_CURRICULUM = fx.empIds[2]!; });
    const r = await regenerateProjectWorkload(fx.mgr, id);
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n);
    expect(r.updated).toBe(1);
    expect(rows.find((x) => x.id === free.id)!.employeeId).toBe(fx.empIds[1]);
    expect(rows.find((x) => x.id === adj.id)!.employeeId).toBe(fx.empIds[0]);          // disesuaikan: tidak pindah
    expect(r.warnings.join(" ")).toMatch(/disesuaikan manual/);
  });

  it("baris MANUAL dari awal berdiri sendiri: tidak ditimpa, tidak dihitung dua kali, tidak memblokir template", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    const m = await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[0], name: "Rapat khusus klien", hours: 3, startDate: inDays(41), endDate: inDays(41) });
    await regenerateProjectWorkload(fx.mgr, id);
    await regenerateProjectWorkload(fx.mgr, id);
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n + 1);
    expect(rows.find((r) => r.id === m.id)).toMatchObject({ source: "MANUAL", templateKey: null, hours: 3, adjusted: false });
  });

  it("jenis program berganti (Reguler → Kerjasama) selama belum ada kemajuan: baris template berganti sesuai jenis baru tanpa ID kembar; sudah ada baris disesuaikan/selesai → ditolak (kemajuan dijaga)", async () => {
    await setConfig();
    const id = await program();
    const keep = await byKey(id, "spv-kurikulum");           // berlaku untuk kedua jenis
    const gone = await byKey(id, "kampanye-reguler");        // hanya Reguler
    await updateProject(fx.mgr, id, { track: "PARTNER" });
    const rows = await rowsOf(id);
    expect(rows.find((r) => r.id === gone.id)).toBeUndefined();
    expect(rows.find((r) => r.templateKey === "negosiasi-kerjasama")).toBeTruthy();
    expect(rows.find((r) => r.id === keep.id)).toBeTruthy();                         // pekerjaan yang berlaku untuk kedua jenis: baris yang sama, bukan salinan
    const keys = rows.map((r) => r.templateKey).filter(Boolean);
    expect(new Set(keys).size).toBe(keys.length);

    const id2 = await program({ name: "Program kedua" });
    const t = await byKey(id2, "spv-kurikulum");
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours + 1 });                  // disesuaikan = kemajuan yang dijaga
    expect(await fail(updateProject(fx.mgr, id2, { track: "PARTNER" }))).toMatchObject({ code: "CONFLICT" });
    const id3 = await program({ name: "Program ketiga" });
    await updateWorkloadTask(fx.mgr, (await byKey(id3, "admin-umum")).id, { status: "DONE" });
    expect(await fail(updateProject(fx.mgr, id3, { track: "PARTNER" }))).toMatchObject({ code: "CONFLICT" });
  });
});

describe("kembalikan ke template", () => {
  it("pratinjau menyebut jam/tanggal yang akan diganti; menerapkan mengembalikan nilai & mencabut penanda; hitung ulang sesudahnya tanpa peringatan", async () => {
    await setConfig();
    const id = await program();
    const t = await byKey(id, "kampanye-reguler");
    await updateWorkloadTask(fx.mgr, t.id, { hours: 99, startDate: inDays(1), endDate: inDays(2), name: "Nama sendiri" });
    const pv = await previewWorkloadRevert(fx.mgr, t.id);
    expect(pv.canApply).toBe(true);
    expect(pv.changes.map((c) => [c.label, c.current, c.template])).toEqual(expect.arrayContaining([["Jam", 99, t.hours], ["Nama pekerjaan", "Nama sendiri", t.name]]));
    expect(await byKey(id, "kampanye-reguler")).toMatchObject({ hours: 99 });                          // pratinjau tidak mengubah data
    await revertWorkloadToTemplate(fx.mgr, t.id);
    expect(await byKey(id, "kampanye-reguler")).toMatchObject({ hours: t.hours, name: t.name, adjusted: false, startDate: t.startDate, endDate: t.endDate });
    expect((await regenerateProjectWorkload(fx.mgr, id)).warnings).toEqual([]);
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.workload.revert" } });
    expect(au.actorId).toBe(fx.mgr.userId);
  });

  it("baris SELESAI tidak dikembalikan (tidak terbuka kembali, riwayat utuh); baris tanpa asal template jelas juga tidak", async () => {
    await setConfig();
    const id = await program();
    const t = await byKey(id, "admin-umum");
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours + 5 });
    await updateWorkloadTask(fx.mgr, t.id, { status: "DONE" });
    const pv = await previewWorkloadRevert(fx.mgr, t.id);
    expect(pv).toMatchObject({ canApply: false });
    expect(pv.reason).toMatch(/selesai atau dibatalkan/);
    expect(await fail(revertWorkloadToTemplate(fx.mgr, t.id))).toMatchObject({ code: "CONFLICT" });
    expect(await byKey(id, "admin-umum")).toMatchObject({ status: "DONE", hours: t.hours + 5 });
    const m = await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[0], name: "Manual", hours: 2, startDate: inDays(41), endDate: inDays(41) });
    expect((await previewWorkloadRevert(fx.mgr, m.id)).canApply).toBe(false);
  });

  it("hanya pengelola tugas proyek: staf biasa ditolak", async () => {
    await setConfig();
    const id = await program();
    await addTeam(fx.mgr, id, [[fx.empIds[1]!, "STAFF"]]);
    const t = await byKey(id, "kampanye-reguler");
    await updateWorkloadTask(fx.mgr, t.id, { hours: 50 });
    expect(await fail(previewWorkloadRevert(fx.emp2, t.id))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(revertWorkloadToTemplate(fx.emp2, t.id))).toMatchObject({ code: "FORBIDDEN" });
  });
});

/** Keadaan SEBELUM perbaikan (data lama): tanpa ID asal; baris template yang diedit/diselesaikan berstatus MANUAL; hitung ulang membuat salinan. */
async function legacyState(id: string) {
  await prisma.trainingWorkloadTask.updateMany({ where: { projectId: id }, data: { templateKey: null, adjusted: false, adjustedAt: null, originReviewedAt: null } });
}

describe("data LAMA — tidak ditebak", () => {
  it("baris template lama yang tak pernah disentuh: ditautkan otomatis saat dihitung ulang (jumlah & jam tetap, tidak ada baris baru)", async () => {
    await setConfig();
    const id = await program();
    const before = await rowsOf(id);
    await legacyState(id);
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r).toMatchObject({ created: 0, removed: 0, linked: before.length, review: 0 });
    const after = await rowsOf(id);
    expect(idsAndHours(after)).toEqual(idsAndHours(before));
    expect(after.every((x) => x.templateKey !== null && !x.adjusted)).toBe(true);
  });

  it("baris lama berstatus MANUAL yang ternyata template yang diedit (jabatan terisi, cocok pasti): ditautkan sebagai Disesuaikan — TIDAK dibuatkan baris pengganti", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    const t = await byKey(id, "kampanye-reguler");
    await legacyState(id);
    await prisma.trainingWorkloadTask.update({ where: { id: t.id }, data: { source: "MANUAL", hours: t.hours + 4 } });   // keadaan lama setelah diedit
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r.created).toBe(0);
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n);
    expect(rows.find((x) => x.id === t.id)).toMatchObject({ templateKey: "kampanye-reguler", adjusted: true, hours: t.hours + 4 });
  });

  it("KEMBAR warisan bug: satu baris diedit (MANUAL) + salinan template → keduanya ditandai, TIDAK ada yang diubah/dihapus/dibuat; DTO menunjuk kelompoknya", async () => {
    await setConfig();
    const id = await program();
    const t = await byKey(id, "kampanye-reguler");
    await legacyState(id);
    await prisma.trainingWorkloadTask.update({ where: { id: t.id }, data: { source: "MANUAL", hours: t.hours + 2 } });
    const copy = await prisma.trainingWorkloadTask.create({ data: { projectId: id, employeeId: t.employeeId, name: t.name, hours: t.hours, startDate: t.startDate, endDate: t.endDate, source: "TEMPLATE", roleKey: t.roleKey, createdById: fx.mgr.userId } });
    const n = (await rowsOf(id)).length;
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r).toMatchObject({ created: 0, updated: 0, removed: 0 });
    expect(r.review).toBe(2);
    expect(r.warnings.join(" ")).toMatch(/2 baris jam kerja lama perlu diperiksa asalnya/);
    expect(await rowsOf(id)).toHaveLength(n);
    const dto = (await listWorkloadTasks(fx.mgr, id)).filter((x) => x.review === "DUPLICATE");
    expect(dto.map((x) => x.id).sort()).toEqual([t.id, copy.id].sort());
    expect(dto[0]!.duplicateGroup!.sort()).toEqual([t.id, copy.id].sort());
  });

  it("rapikan kembar: pengguna memilih yang dipertahankan (baris manual yang diedit) → ber-ID & Disesuaikan, salinan dihapus, tercatat siapa & baris mana", async () => {
    await setConfig();
    const id = await program();
    const t = await byKey(id, "kampanye-reguler");
    await legacyState(id);
    await prisma.trainingWorkloadTask.update({ where: { id: t.id }, data: { source: "MANUAL", hours: t.hours + 2 } });
    const copy = await prisma.trainingWorkloadTask.create({ data: { projectId: id, employeeId: t.employeeId, name: t.name, hours: t.hours, startDate: t.startDate, endDate: t.endDate, source: "TEMPLATE", roleKey: t.roleKey, createdById: fx.mgr.userId } });
    const n = (await rowsOf(id)).length;
    // kelompok harus lengkap & hanya satu yang dipertahankan
    expect(await fail(mergeWorkloadDuplicates(fx.mgr, id, { keepId: t.id, removeIds: [] }))).toMatchObject({ code: "VALIDATION" });
    expect(await fail(mergeWorkloadDuplicates(fx.mgr, id, { keepId: t.id, removeIds: [(await rowsOf(id)).find((r) => r.name !== t.name)!.id] }))).toMatchObject({ code: "VALIDATION" });
    expect(await mergeWorkloadDuplicates(fx.mgr, id, { keepId: t.id, removeIds: [copy.id] })).toEqual({ kept: t.id, removed: 1 });
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n - 1);
    expect(rows.find((r) => r.id === t.id)).toMatchObject({ templateKey: "kampanye-reguler", adjusted: true, hours: t.hours + 2 });
    expect(rows.find((r) => r.id === copy.id)).toBeUndefined();
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.workload.merge" } });
    expect(au.actorId).toBe(fx.mgr.userId);
    expect(JSON.stringify(au.before)).toContain(copy.id);
    expect(JSON.stringify(au.after)).toContain(t.id);
    expect((await regenerateProjectWorkload(fx.mgr, id)).review).toBe(0);                 // tidak ada lagi yang perlu diperiksa
  });

  it("rapikan kembar: baris yang sudah SELESAI tidak boleh dihapus; dipertahankan boleh (salinan terbuka yang dihapus)", async () => {
    await setConfig();
    const id = await program();
    const t = await byKey(id, "admin-umum");
    await legacyState(id);
    await prisma.trainingWorkloadTask.update({ where: { id: t.id }, data: { source: "MANUAL", status: "DONE" } });
    const copy = await prisma.trainingWorkloadTask.create({ data: { projectId: id, employeeId: t.employeeId, name: t.name, hours: t.hours, startDate: t.startDate, endDate: t.endDate, source: "TEMPLATE", roleKey: t.roleKey, createdById: fx.mgr.userId } });
    const e = await fail(mergeWorkloadDuplicates(fx.mgr, id, { keepId: copy.id, removeIds: [t.id] }));
    expect(e).toMatchObject({ code: "CONFLICT" });
    expect(e!.message).toMatch(/tidak dapat dihapus/);
    await mergeWorkloadDuplicates(fx.mgr, id, { keepId: t.id, removeIds: [copy.id] });
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "DONE", templateKey: "admin-umum" });
  });

  it("jabatan kini hanya punya SATU pekerjaan tetapi NAMA baris lama berbeda: TIDAK ditautkan otomatis (itu menebak) — isinya tidak ditulis ulang; muncul 'perlu diperiksa' dengan SARAN; baru berubah setelah pengguna menautkan (butir 4c)", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    const k = await byKey(id, "kampanye-reguler");
    await legacyState(id);
    // Pekerjaan lama yang sudah diganti orang: nama berbeda, jam berbeda (bukan sekadar berganti nama)
    await prisma.trainingWorkloadTask.update({ where: { id: k.id }, data: { name: "Menyusun materi ajar", hours: k.hours + 7, source: "TEMPLATE" } });
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r).toMatchObject({ created: 0, removed: 0, updated: 0, review: 1, linked: n - 1 });
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: k.id } })).toMatchObject({ templateKey: null, name: "Menyusun materi ajar", hours: k.hours + 7 });   // TIDAK ditulis ulang
    const dto = (await listWorkloadTasks(fx.mgr, id)).find((x) => x.id === k.id)!;
    expect(dto).toMatchObject({ review: "UNLINKED", reviewSuggestion: { key: "kampanye-reguler", task: "Kampanye program reguler" } });
    // Pengguna memastikan: tautkan ke saran → kini tertaut; isinya dijaga sebagai "disesuaikan" (nama/jam berbeda dari template), tidak ditimpa
    await reviewWorkloadRow(fx.mgr, k.id, { action: "LINK", templateKey: "kampanye-reguler" });
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: k.id } })).toMatchObject({ templateKey: "kampanye-reguler", adjusted: true, name: "Menyusun materi ajar", hours: k.hours + 7 });
    expect((await rowsOf(id)).length).toBe(n);
  });

  it("asal MERAGUKAN (nama diubah, jabatan punya beberapa pekerjaan): 'perlu diperiksa', tidak ditebak; pekerjaan jabatan itu tidak dibuat diam-diam; tinjau → tautkan / berdiri sendiri", async () => {
    await setConfig((c) => { c.hourTable.push({ ...c.hourTable.find((h) => h.id === "spv-kurikulum")!, id: "spv-tambahan", task: "Pekerjaan SPV tambahan" }); });
    const id = await program();
    const spv1 = await byKey(id, "spv-kurikulum");
    const spv2 = await byKey(id, "spv-tambahan");
    await legacyState(id);
    await prisma.trainingWorkloadTask.update({ where: { id: spv1.id }, data: { source: "MANUAL", name: "Nama yang sudah diganti orang" } });
    await prisma.trainingWorkloadTask.delete({ where: { id: spv2.id } });                 // tidak ada baris untuk pekerjaan kedua
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r.review).toBe(1);
    expect(r.created).toBe(0);                                                             // "spv-tambahan" TIDAK dibuat diam-diam
    expect(r.warnings.join(" ")).toMatch(/Pekerjaan SPV tambahan" belum dibuat/);
    expect((await rowsOf(id)).find((x) => x.id === spv1.id)).toMatchObject({ templateKey: null });
    const dto = (await listWorkloadTasks(fx.mgr, id)).find((x) => x.id === spv1.id)!;
    expect(dto.review).toBe("UNLINKED");
    // pilihan pekerjaan template untuk menautkan
    const entries = await listWorkloadTemplateEntries(fx.mgr, id);
    expect(entries.find((e) => e.key === "spv-tambahan")).toMatchObject({ claimedBy: null, task: "Pekerjaan SPV tambahan" });
    expect(entries.find((e) => e.key === "kampanye-reguler")!.claimedBy).not.toBeNull();   // sudah dipakai baris lain
    expect(await fail(reviewWorkloadRow(fx.mgr, spv1.id, { action: "LINK", templateKey: "kampanye-reguler" }))).toMatchObject({ code: "CONFLICT" });   // sudah punya baris
    expect(await fail(reviewWorkloadRow(fx.mgr, spv1.id, { action: "LINK", templateKey: "tidak-ada" }))).toMatchObject({ code: "VALIDATION" });
    await reviewWorkloadRow(fx.mgr, spv1.id, { action: "LINK", templateKey: "spv-kurikulum" });
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: spv1.id } })).toMatchObject({ templateKey: "spv-kurikulum", adjusted: true });
    expect((await regenerateProjectWorkload(fx.mgr, id)).created).toBe(1);                 // kini "spv-tambahan" boleh dibuat
    expect(await fail(reviewWorkloadRow(fx.mgr, spv1.id, { action: "STANDALONE" }))).toMatchObject({ code: "CONFLICT" });   // sudah jelas
  });

  it("dinyatakan BERDIRI SENDIRI: tidak lagi 'perlu diperiksa'; template untuk jabatannya dibuat terpisah (pilihan sadar pengguna)", async () => {
    await setConfig((c) => { c.hourTable.push({ ...c.hourTable.find((h) => h.id === "spv-kurikulum")!, id: "spv-tambahan", task: "Pekerjaan SPV tambahan" }); });
    const id = await program();
    const spv1 = await byKey(id, "spv-kurikulum");
    await legacyState(id);
    await prisma.trainingWorkloadTask.update({ where: { id: spv1.id }, data: { source: "MANUAL", name: "Nama lain" } });
    await prisma.trainingWorkloadTask.deleteMany({ where: { projectId: id, roleKey: "SPV_CURRICULUM", NOT: { id: spv1.id } } });
    await reviewWorkloadRow(fx.mgr, spv1.id, { action: "STANDALONE" });
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r.review).toBe(0);
    expect(r.created).toBe(2);
    expect((await rowsOf(id)).find((x) => x.id === spv1.id)).toMatchObject({ source: "MANUAL", templateKey: null });
  });
});

/** Pelebar jendela balapan: setiap baris yang disisipkan tertunda sebentar, sehingga tanpa kunci kedua pemanggil sama-sama melihat "belum ada baris" lalu saling bertabrakan. */
const slowInserts = async () => {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_slow_workload() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.06); RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_workload ON training_workload_tasks`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER test_slow_workload BEFORE INSERT ON training_workload_tasks FOR EACH ROW EXECUTE FUNCTION test_slow_workload()`);
};
const fastInserts = async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_workload ON training_workload_tasks`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_slow_workload()`);
};

describe("serentak & konfigurasi", () => {
  it("dua pengguna menekan 'Hitung ulang' hampir bersamaan (dan perubahan program bersamaan): tidak ada duplikat, tidak ada galat unik", async () => {
    await setConfig();
    const id = await program();
    const n = (await rowsOf(id)).length;
    await prisma.trainingWorkloadTask.deleteMany({ where: { projectId: id } });                  // paksa kedua pemanggil membuat baris
    await slowInserts();
    try {
      const res = await Promise.allSettled([
        regenerateProjectWorkload(fx.mgr, id), regenerateProjectWorkload(fx.superAdmin, id), regenerateProjectWorkload(fx.mgr, id),
        updateProject(fx.mgr, id, { participantsMin: 21 }),
      ]);
      expect(res.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason?.message?.slice(0, 160))).toEqual([]);
    } finally { await fastInserts(); }
    const rows = await rowsOf(id);
    expect(rows).toHaveLength(n);
    const keys = rows.map((r) => r.templateKey);
    expect(new Set(keys).size).toBe(keys.length);
  }, 60_000);

  it("konfigurasi LAMA tanpa ID baris jam: dilengkapi saat dibaca (ID bawaan bila cocok); proyek baru memakai ID itu; ID tidak berubah saat nama/urutan/jam diubah di versi baru", async () => {
    const legacy = JSON.parse(JSON.stringify(defaultIndicatorConfig())) as { hourTable: Record<string, unknown>[]; roleHolders: Record<string, string> };
    for (const h of legacy.hourTable) delete h.id;
    legacy.roleHolders = { MANAGER_MARKETING: fx.empIds[1]!, SPV_CURRICULUM: fx.empIds[0]!, STAFF_GENERAL: fx.empIds[2]!, STAFF_CURRICULUM: fx.admEmp };
    await prisma.trainingIndicatorConfig.create({ data: { id: 1, version: 1, config: legacy as never, updatedById: fx.superAdmin.userId } });
    const loaded = await loadConfig();
    expect(loaded.damaged).toBe(false);
    expect(loaded.config.hourTable.map((h) => h.id)).toEqual(defaultIndicatorConfig().hourTable.map((h) => h.id));
    const id = await program();
    expect((await rowsOf(id)).every((r) => r.templateKey !== null)).toBe(true);
    // Versi baru: urutan dibalik, nama & jam diubah → ID sama → baris yang ada tetap dikenali (tidak dibuat ulang)
    const cfg = loaded.config;
    cfg.hourTable.reverse();
    cfg.hourTable.find((h) => h.id === "kampanye-reguler")!.task = "Kampanye (nama baru)";
    cfg.hourTable.find((h) => h.id === "kampanye-reguler")!.fixed.REGULAR = 7;
    await saveIndicatorConfig(fx.superAdmin, { config: cfg, note: "ubah nama & urutan" });
    const before = await rowsOf(id);
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(1);
    const after = await rowsOf(id);
    expect(after).toHaveLength(before.length);
    expect(after.find((x) => x.templateKey === "kampanye-reguler")).toMatchObject({ name: "Kampanye (nama baru)", hours: 7 });
  });

  it("ID baris jam kembar ditolak saat konfigurasi disimpan; klien yang tidak mengirim ID tetap bisa menyimpan (ID dilengkapi server)", async () => {
    const c = defaultIndicatorConfig();
    c.hourTable[1]!.id = c.hourTable[0]!.id;
    expect(await fail(saveIndicatorConfig(fx.superAdmin, { config: c, note: "x" }))).toMatchObject({ code: "VALIDATION" });
    const d = JSON.parse(JSON.stringify(defaultIndicatorConfig())) as { hourTable: Record<string, unknown>[] };
    for (const h of d.hourTable) delete h.id;
    await saveIndicatorConfig(fx.superAdmin, { config: d, note: "tanpa id" });
    expect((await loadConfig()).config.hourTable.every((h) => typeof h.id === "string" && h.id.length > 0)).toBe(true);
  });
});

describe("DTO untuk yang tidak berwenang", () => {
  it("anggota biasa hanya melihat barisnya sendiri dan tanpa penanda tinjauan/kembar", async () => {
    await setConfig();
    const id = await program();
    await addTeam(fx.mgr, id, [[fx.empIds[2]!, "STAFF"]]);
    const mine = await listWorkloadTasks(fx.emp3, id);
    expect(mine.every((x) => x.employeeId === fx.empIds[2])).toBe(true);
    expect(mine.every((x) => x.review === null && !x.canRevert)).toBe(true);
    expect(isoToDate("2027-01-01")).toBeTruthy();
  });
});

describe("pemegang jabatan NONAKTIF: baris estimasi jam TIDAK hilang (butir 4a)", () => {
  it("menonaktifkan pemegang jabatan lalu menghitung ulang: jumlah baris & total jam tetap, baris tetap atas nama pemegang lama dan ditandai 'nonaktif — alihkan'; peringatan menyebutnya dipertahankan; idempoten", async () => {
    await setConfig();
    const id = await program();
    const before = await rowsOf(id);
    const holder = fx.empIds[1]!;                                                   // MANAGER_MARKETING (+ fasilitator)
    const held = before.filter((r) => r.employeeId === holder);
    expect(held.length).toBeGreaterThan(0);
    await prisma.employee.update({ where: { id: holder }, data: { isActive: false } });
    for (let i = 0; i < 2; i++) {                                                   // hitung ulang berulang kali: tidak ada yang berubah
      const r = await regenerateProjectWorkload(fx.mgr, id);
      expect(r).toMatchObject({ removed: 0, created: 0, updated: 0 });
      expect(r.warnings.join(" ")).toMatch(/DIPERTAHANKAN \(tidak dihapus\): pemegang jabatannya belum aktif/);
    }
    const after = await rowsOf(id);
    expect(after.length).toBe(before.length);
    expect(totalHours(after)).toBe(totalHours(before));                             // estimasi beban TIDAK berkurang sebelum pekerjaan benar-benar dialihkan
    expect(idsAndHours(after)).toEqual(idsAndHours(before));
    expect(after.filter((r) => r.employeeId === holder).length).toBe(held.length);
    const dto = await listWorkloadTasks(fx.mgr, id);
    expect(dto.filter((x) => x.employeeInactive && x.status === "OPEN").map((x) => x.id).sort()).toEqual(held.map((x) => x.id).sort());
    expect(dto.filter((x) => !x.employeeInactive).every((x) => x.employeeId !== holder)).toBe(true);
  });

  it("pemegang jabatan BARU ditetapkan lalu dihitung ulang: baris yang sama PINDAH ke staf baru (tidak dibuat ganda) dan penanda nonaktif hilang", async () => {
    await setConfig();
    const id = await program();
    const holder = fx.empIds[1]!;
    const campaign = (await rowsOf(id)).find((r) => r.templateKey === "kampanye-reguler")!;
    expect(campaign.employeeId).toBe(holder);
    await prisma.employee.update({ where: { id: holder }, data: { isActive: false } });
    await regenerateProjectWorkload(fx.mgr, id);
    expect((await byKey(id, "kampanye-reguler")).employeeId).toBe(holder);          // dipertahankan
    await setConfig((c) => { c.roleHolders.MANAGER_MARKETING = fx.admEmp; c.roleHolders.FACILITATOR = fx.empIds[0]; c.facilitators = [fx.empIds[0]]; });   // konfigurasi menolak pemegang nonaktif: SEMUA jabatannya diganti (pemegang baru aktif)
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r).toMatchObject({ created: 0, removed: 0 });
    expect(r.updated).toBeGreaterThanOrEqual(1);
    const moved = await byKey(id, "kampanye-reguler");
    expect(moved).toMatchObject({ id: campaign.id, employeeId: fx.admEmp });        // baris yang SAMA, kini atas nama pemegang baru
    expect((await rowsOf(id)).filter((x) => x.templateKey === "kampanye-reguler")).toHaveLength(1);
  });

  it("pekerjaan yang sungguh TIDAK BERLAKU lagi tetap dihapus (pembeda: dipertahankan hanya bila 'belum dapat dihitung')", async () => {
    await setConfig();
    const id = await program();
    await setConfig((c) => { c.hourTable = c.hourTable.filter((h) => h.id !== "kampanye-reguler"); });   // pekerjaan dihapus dari Tabel Jam Standar
    const r = await regenerateProjectWorkload(fx.mgr, id);
    expect(r.removed).toBe(1);
    expect((await rowsOf(id)).some((x) => x.templateKey === "kampanye-reguler")).toBe(false);
  });
});
