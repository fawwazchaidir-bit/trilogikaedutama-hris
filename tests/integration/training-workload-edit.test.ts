/**
 * Dialog "Ubah jam & tanggal" baris jam kerja — sisi layanan: perubahan tercatat LENGKAP (nilai lama dan baru, termasuk tanggal mulai/selesai), asal template dipertahankan
 * dan baris ditandai Disesuaikan, baris Selesai TIDAK dibuka kembali, validasi jam/tanggal, hak akses, proyek final terkunci, nilai template sebagai rujukan.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { defaultIndicatorConfig } from "@/lib/training/indicators/config";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { saveIndicatorConfig } from "@/server/services/training/indicator-config";
import { cancelProject } from "@/server/services/training/projects";
import { listWorkloadTasks, regenerateProjectWorkload, updateWorkloadTask } from "@/server/services/training/indicator-data";

let fx: TrainingFixtures;
beforeEach(async () => {
  await resetDb(); fx = await seedTraining();
  const c = defaultIndicatorConfig();
  c.roleHolders = {
    SPV_CURRICULUM: fx.empIds[0], MANAGER_MARKETING: fx.empIds[1], MANAGER_OPS: fx.mgrEmp, STAFF_GENERAL: fx.empIds[2], STAFF_CURRICULUM: fx.admEmp,
    STAFF_FINANCE: fx.lonerEmp, STAFF_ADMISI_2: fx.lonerEmp, STAFF_SOCIAL: fx.lonerEmp, SPV_IT: fx.empIds[2], FACILITATOR: fx.empIds[1],
  };
  c.facilitators = [fx.empIds[0], fx.empIds[1]];
  await saveIndicatorConfig(fx.superAdmin, { config: c, note: "uji" });
});
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
async function program() {
  const id = await mkProject(fx.mgr, { startDate: inDays(40), endDate: inDays(42), participantsMin: 20 });
  await addTeam(fx.mgr, id, [[fx.empIds[0]!, "PROJECT_MANAGER"]]);
  return id;
}
const day = (d: Date) => d.toISOString().slice(0, 10);
async function target(id: string) {
  const r = (await prisma.trainingWorkloadTask.findMany({ where: { projectId: id, status: "OPEN" }, orderBy: { name: "asc" } })).find((x) => x.templateKey && x.hours > 0 && day(x.endDate) > day(x.startDate)) ??
    (await prisma.trainingWorkloadTask.findFirstOrThrow({ where: { projectId: id, status: "OPEN", templateKey: { not: null } } }));
  return r;
}
const lastAudit = (taskId: string) => prisma.auditLog.findFirstOrThrow({ where: { action: "training.workload.update", before: { path: ["taskId"], equals: taskId } }, orderBy: { createdAt: "desc" } });
const shift = (iso: string, days: number) => day(new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000));

describe("ubah jam & tanggal", () => {
  it("jam + tanggal mulai + tanggal selesai berubah: tersimpan, asal tetap Template (ID asal sama), ditandai Disesuaikan", async () => {
    const id = await program();
    const t = await target(id);
    const newStart = shift(day(t.startDate), 1), newEnd = shift(day(t.endDate), 2);
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours + 2.5, startDate: newStart, endDate: newEnd });
    const after = await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(after).toMatchObject({ hours: t.hours + 2.5, source: "TEMPLATE", templateKey: t.templateKey, roleKey: t.roleKey, adjusted: true, status: "OPEN", name: t.name, employeeId: t.employeeId });
    expect([day(after.startDate), day(after.endDate)]).toEqual([newStart, newEnd]);
    expect(after.adjustedAt).not.toBeNull();
    expect((await listWorkloadTasks(fx.mgr, id)).find((x) => x.id === t.id)).toMatchObject({ adjusted: true, source: "TEMPLATE", templateKey: t.templateKey, differsFromTemplate: true, canRevert: true });
  });

  it("AUDIT memuat nilai LAMA dan BARU: jam, tanggal mulai, tanggal selesai, status, dan asal — serta ringkasan yang terbaca", async () => {
    const id = await program();
    const t = await target(id);
    const oldStart = day(t.startDate), oldEnd = day(t.endDate), newStart = shift(oldStart, 1), newEnd = shift(oldEnd, 2);
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours + 3, startDate: newStart, endDate: newEnd });
    const a = await lastAudit(t.id);
    expect(a.before).toMatchObject({ taskId: t.id, name: t.name, hours: t.hours, startDate: oldStart, endDate: oldEnd, status: "OPEN", adjusted: false, source: "TEMPLATE" });
    expect(a.after).toMatchObject({ taskId: t.id, name: t.name, hours: t.hours + 3, startDate: newStart, endDate: newEnd, status: "OPEN", adjusted: true, source: "TEMPLATE" });
    expect(a.summary).toContain(`jam ${t.hours} → ${t.hours + 3}`);
    expect(a.summary).toContain(`mulai ${oldStart} → ${newStart}`);
    expect(a.summary).toContain(`selesai ${oldEnd} → ${newEnd}`);
    expect(a.summary).toContain("disesuaikan dari template");
    expect(a.actorId).toBe(fx.mgr.userId);
  });

  it("perubahan SATU bidang: audit tetap memuat seluruh nilai lama/baru; ringkasan hanya menyebut yang berubah", async () => {
    const id = await program();
    const t = await target(id);
    await updateWorkloadTask(fx.mgr, t.id, { startDate: shift(day(t.startDate), -1) });
    const a = await lastAudit(t.id);
    expect(a.before).toMatchObject({ hours: t.hours, startDate: day(t.startDate), endDate: day(t.endDate) });
    expect(a.after).toMatchObject({ hours: t.hours, startDate: shift(day(t.startDate), -1), endDate: day(t.endDate) });
    expect(a.summary).toMatch(/mulai \d{4}-\d{2}-\d{2} → /);
    expect(a.summary).not.toMatch(/jam [\d.]+ →/);      // nama tugas memuat kata "jam": yang dicari adalah bagian perubahan jam
    expect(a.summary).not.toMatch(/selesai \d{4}-\d{2}-\d{2} →/);
  });

  it("tidak ada perubahan nilai: tidak menulis dan tidak mencatat audit; tidak ditandai Disesuaikan", async () => {
    const id = await program();
    const t = await target(id);
    const before = await prisma.auditLog.count({ where: { action: "training.workload.update" } });
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours, startDate: day(t.startDate), endDate: day(t.endDate) });
    expect(await prisma.auditLog.count({ where: { action: "training.workload.update" } })).toBe(before);
    expect((await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } })).adjusted).toBe(false);
  });

  it("baris SELESAI: jam/tanggal dapat disesuaikan tetapi status TETAP Selesai (tidak dibuka kembali) — juga setelah hitung ulang", async () => {
    const id = await program();
    const t = await target(id);
    await updateWorkloadTask(fx.mgr, t.id, { status: "DONE" });
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours + 1, endDate: shift(day(t.endDate), 1) });
    const done = await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(done).toMatchObject({ status: "DONE", adjusted: true, hours: t.hours + 1, source: "TEMPLATE" });
    const a = await lastAudit(t.id);
    expect(a.before).toMatchObject({ status: "DONE" });
    expect(a.after).toMatchObject({ status: "DONE" });
    expect(a.summary).not.toContain("status");
    await regenerateProjectWorkload(fx.mgr, id);
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "DONE", hours: t.hours + 1 });
    expect(await prisma.trainingWorkloadTask.count({ where: { projectId: id, templateKey: t.templateKey } })).toBe(1);
  });

  it("mengganti status SAJA bukan penyesuaian dan tidak mengubah tanggal; ringkasan audit menyebut status", async () => {
    const id = await program();
    const t = await target(id);
    await updateWorkloadTask(fx.mgr, t.id, { status: "DONE" });
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ status: "DONE", adjusted: false, startDate: t.startDate, endDate: t.endDate });
    const a = await lastAudit(t.id);
    expect(a.summary).toContain("status OPEN → DONE");
    expect(a.after).toMatchObject({ startDate: day(t.startDate), endDate: day(t.endDate), status: "DONE" });
  });

  it("nilai template tersedia sebagai rujukan di dialog (hitungan template saat ini) — tetap bernilai ASLI setelah baris diubah", async () => {
    const id = await program();
    const t = await target(id);
    const orig = (await listWorkloadTasks(fx.mgr, id)).find((x) => x.id === t.id)!;
    expect(orig.templateValues).toEqual({ hours: t.hours, startDate: day(t.startDate), endDate: day(t.endDate) });
    await updateWorkloadTask(fx.mgr, t.id, { hours: t.hours + 4 });
    const edited = (await listWorkloadTasks(fx.mgr, id)).find((x) => x.id === t.id)!;
    expect(edited.hours).toBe(t.hours + 4);
    expect(edited.templateValues).toEqual({ hours: t.hours, startDate: day(t.startDate), endDate: day(t.endDate) });
  });
});

describe("validasi dan batas", () => {
  it("jam ≤ 0, negatif, > 2000, bukan angka: VALIDATION; tanggal selesai sebelum mulai (juga terhadap tanggal TERSIMPAN) dan tanggal kalender tak sah: VALIDATION — tidak ada yang tersimpan", async () => {
    const id = await program();
    const t = await target(id);
    const snap = async () => JSON.stringify(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: t.id } }));
    const before = await snap();
    for (const bad of [{ hours: 0 }, { hours: -1 }, { hours: 2001 }, { hours: "8" }, { hours: Number.NaN }, { startDate: "2026-02-30" }, { endDate: "bukan-tanggal" }, { startDate: shift(day(t.endDate), 1) }, { endDate: shift(day(t.startDate), -1) }, { startDate: "2026-12-10", endDate: "2026-12-09" }]) {
      expect(await fail(updateWorkloadTask(fx.mgr, t.id, bad)), JSON.stringify(bad)).toMatchObject({ code: "VALIDATION" });
    }
    expect(await snap()).toBe(before);
    expect(await fail(updateWorkloadTask(fx.mgr, t.id, { hours: 0 }))).toMatchObject({ fieldErrors: expect.objectContaining({ hours: expect.stringContaining("lebih dari 0") }) });
  });

  it("hanya pengelola tugas proyek: karyawan tanpa izin ditolak; proyek Dibatalkan terkunci (CONFLICT)", async () => {
    const id = await program();
    const t = await target(id);
    expect(await fail(updateWorkloadTask(fx.loner, t.id, { hours: 5 }))).toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    await cancelProject(fx.mgr, id, { reason: "Klien membatalkan seluruh kegiatan (uji penguncian)" });
    expect(await fail(updateWorkloadTask(fx.mgr, t.id, { hours: 5 }))).toMatchObject({ code: "CONFLICT" });
  });
});
