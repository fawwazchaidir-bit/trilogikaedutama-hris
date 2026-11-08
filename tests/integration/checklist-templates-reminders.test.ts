/**
 * Template checklist yang dapat diedit, penanggung jawab & tenggat per butir, halaman butir saya, dan pengingat otomatis (idempoten).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addDays, todayIso } from "@/lib/time";
import { ONBOARDING_TEMPLATE } from "@/lib/employee-checklist";
import { resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { createEmployee } from "@/server/services/employees";
import { addTemplateItem, getTemplate, moveTemplateItem, updateTemplateItem } from "@/server/services/employee-checklist-templates";
import {
  assignChecklistItem, cancelChecklist, listEmployeeChecklists, listMyChecklistItems, myChecklistCount, runChecklistReminders, setChecklistItem, startChecklist,
} from "@/server/services/employee-checklists";

let fx: TrainingFixtures;
const TODAY = () => todayIso("Asia/Jakarta");
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const hire = (n = 1) => createEmployee(fx.hr, { employeeNo: `TE-30${n}`, fullName: `Karyawan Baru ${n}`, position: "Staf", employmentStatus: "CONTRACT", joinDate: TODAY() });
const open = async (employeeId: string) => (await listEmployeeChecklists(fx.hr, employeeId)).find((c) => c.status === "OPEN")!;
const notes = (a: { userId: string }, type: string) => prisma.notification.findMany({ where: { userId: a.userId, type } });
const setDue = (itemId: string, due: string) => prisma.employeeChecklistItem.update({ where: { id: itemId }, data: { dueDate: isoToDate(due) } });

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

describe("template yang dapat diedit", () => {
  it("template terisi dari bawaan kode saat pertama dipakai; checklist baru menyalin butir, tenggat, dan penanggung jawab dari template", async () => {
    const tpl = await getTemplate(fx.hr, "ONBOARDING");
    expect(tpl.map((t) => t.title)).toEqual(ONBOARDING_TEMPLATE.map((t) => t.title));
    expect(tpl.every((t) => t.builtin && t.active && t.required)).toBe(true);
    const placement = tpl.find((t) => t.key === "placement")!;
    await updateTemplateItem(fx.hr, placement.id, { title: "Atasan, divisi, dan ruang kerja ditetapkan", dueOffsetDays: 2, defaultAssigneeId: fx.emp1.userId });
    await addTemplateItem(fx.hr, { kind: "ONBOARDING", title: "Foto & ID card dibuat", hint: "Minta foto ke karyawan baru", required: false, dueOffsetDays: 10 });

    const e = await hire();
    const c = await open(e.id);
    expect(c.items).toHaveLength(10);
    const p = c.items.find((i) => i.key === "placement")!;
    expect(p).toMatchObject({ title: "Atasan, divisi, dan ruang kerja ditetapkan", assigneeId: fx.emp1.userId, assigneeName: "Ayu Lestari", dueDate: addDays(TODAY(), 2) });
    expect(c.items.at(-1)).toMatchObject({ title: "Foto & ID card dibuat", required: false, group: "Tambahan HR", dueDate: addDays(TODAY(), 10) });
    expect((await notes(fx.emp1, "checklist.assigned"))).toHaveLength(1); // penanggung jawab diberi tahu saat checklist dimulai

    // perubahan template berikutnya tidak menyentuh checklist yang sudah berjalan
    await updateTemplateItem(fx.hr, placement.id, { title: "Judul baru lagi" });
    expect((await open(e.id)).items.find((i) => i.key === "placement")!.title).toBe("Atasan, divisi, dan ruang kerja ditetapkan");
    expect((await getTemplate(fx.hr, "ONBOARDING")).find((t) => t.key === "placement")!.title).toBe("Judul baru lagi");
  });

  it("butir nonaktif tidak disalin; tidak boleh menonaktifkan butir terakhir; geser menukar urutan; validasi & hak akses", async () => {
    const tpl = await getTemplate(fx.hr, "OFFBOARDING");
    const assets = tpl.find((t) => t.key === "assets")!;
    await updateTemplateItem(fx.hr, assets.id, { active: false });
    const e = await hire(2);
    const c = await startChecklist(fx.hr, e.id, { kind: "OFFBOARDING" });
    expect(c.items.map((i) => i.key)).not.toContain("assets");

    await moveTemplateItem(fx.hr, tpl[0]!.id, { direction: "DOWN" });
    const moved = await getTemplate(fx.hr, "OFFBOARDING");
    expect(moved.slice(0, 2).map((t) => t.key)).toEqual([tpl[1]!.key, tpl[0]!.key]);

    for (const t of moved.filter((x) => x.active).slice(1)) await updateTemplateItem(fx.hr, t.id, { active: false });
    expect((await fail(updateTemplateItem(fx.hr, moved.find((t) => t.active)!.id, { active: false })))?.message).toMatch(/setidaknya satu butir aktif/);

    expect((await fail(addTemplateItem(fx.hr, { kind: "ONBOARDING", title: "Butir uji", dueOffsetDays: 400 })))?.fieldErrors?.dueOffsetDays).toBeTruthy();
    await prisma.user.update({ where: { id: fx.emp3.userId }, data: { isActive: false } });
    expect((await fail(addTemplateItem(fx.hr, { kind: "ONBOARDING", title: "Butir uji", defaultAssigneeId: fx.emp3.userId })))?.fieldErrors?.defaultAssigneeId).toBeTruthy();
    expect((await fail(updateTemplateItem(fx.emp1, tpl[0]!.id, { title: "Dibajak" })))?.code).toBe("FORBIDDEN");
    expect((await fail(getTemplate(fx.emp1, "ONBOARDING")))?.code).toBe("FORBIDDEN");
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "checklist.template" } } })).toBeGreaterThanOrEqual(4);
  });
});

describe("penanggung jawab per butir", () => {
  it("HR menunjuk penanggung jawab & tenggat; penanggung jawab menandai butirnya sendiri tetapi tidak butir lain; daftar & hitungan 'butir saya'", async () => {
    const e = await hire();
    const c = await open(e.id);
    const mine = c.items.find((i) => i.key === "portal_account")!, other = c.items.find((i) => i.key === "orientation")!;
    await assignChecklistItem(fx.hr, mine.id, { assigneeId: fx.emp2.userId, dueDate: addDays(TODAY(), 4) });
    expect((await notes(fx.emp2, "checklist.assigned")).length).toBe(1);
    expect(await myChecklistCount(fx.emp2.userId)).toBe(1);
    const list = await listMyChecklistItems(fx.emp2);
    expect(list).toEqual([expect.objectContaining({ itemId: mine.id, employeeName: "Karyawan Baru 1", title: "Akun portal dibuat", dueDate: addDays(TODAY(), 4), overdue: false })]);

    await setChecklistItem(fx.emp2, mine.id, { status: "DONE", note: "Akun dibuat" });
    expect((await open(e.id)).items.find((i) => i.id === mine.id)).toMatchObject({ status: "DONE", doneBy: "Budi Santoso" });
    expect(await myChecklistCount(fx.emp2.userId)).toBe(0);
    expect((await fail(setChecklistItem(fx.emp2, other.id, { status: "DONE" })))?.code).toBe("FORBIDDEN"); // bukan butirnya
    expect((await fail(assignChecklistItem(fx.emp2, other.id, { assigneeId: fx.emp2.userId })))?.code).toBe("FORBIDDEN"); // menunjuk hanya HR
    await prisma.user.update({ where: { id: fx.emp3.userId }, data: { isActive: false } });
    expect((await fail(assignChecklistItem(fx.hr, other.id, { assigneeId: fx.emp3.userId })))?.fieldErrors?.assigneeId).toBeTruthy();
    await assignChecklistItem(fx.hr, other.id, { assigneeId: null, dueDate: null });
    expect((await open(e.id)).items.find((i) => i.id === other.id)).toMatchObject({ assigneeId: null, dueDate: null });
  });
});

describe("pengingat otomatis", () => {
  it("H-1 dan hari-H ke penanggung jawab; idempoten; butir tanpa penanggung jawab → HR; selesai/dibatalkan tidak diingatkan", async () => {
    const e = await hire();
    const c = await open(e.id);
    const a = c.items.find((i) => i.key === "portal_account")!, b = c.items.find((i) => i.key === "salary_components")!, d = c.items.find((i) => i.key === "orientation")!;
    await assignChecklistItem(fx.hr, a.id, { assigneeId: fx.emp2.userId, dueDate: addDays(TODAY(), 1) });
    await setDue(b.id, TODAY()); // tanpa penanggung jawab
    await setDue(d.id, addDays(TODAY(), 9)); // masih jauh

    const r1 = await runChecklistReminders();
    expect(r1.sent).toBeGreaterThanOrEqual(3); // emp2 (H-1) + HR & Super Admin (butir tanpa penanggung jawab, H)
    const budi = await notes(fx.emp2, "checklist.reminder");
    expect(budi).toHaveLength(1);
    expect(budi[0]).toMatchObject({ title: "Butir checklist jatuh tempo besok", href: "/checklist-saya" });
    expect(budi[0]!.body).toContain("Akun portal dibuat");
    expect((await notes(fx.hr, "checklist.reminder"))[0]).toMatchObject({ title: "Butir checklist jatuh tempo hari ini", href: `/karyawan/${e.id}` });
    expect(await notes(fx.superAdmin, "checklist.reminder")).toHaveLength(1);

    expect((await runChecklistReminders()).sent).toBe(0); // idempoten
    expect(await notes(fx.emp2, "checklist.reminder")).toHaveLength(1);

    await setChecklistItem(fx.hr, a.id, { status: "DONE" });
    await setDue(a.id, TODAY()); // sudah selesai → tidak diingatkan lagi walau tenggat hari ini
    await setDue(b.id, addDays(TODAY(), -3));
    const r2 = await runChecklistReminders();
    expect(r2.checked).toBe(1); // hanya butir yang belum selesai (b: terlambat) — a sudah selesai
    await cancelChecklist(fx.hr, c.id, { reason: "Batal bergabung" });
    expect((await runChecklistReminders()).checked).toBe(0); // checklist tidak terbuka → tidak ada pengingat
  });

  it("terlambat: penanggung jawab dan HR diberi tahu, sekali per pekan keterlambatan; pekan berikutnya diingatkan lagi", async () => {
    const e = await hire();
    const c = await open(e.id);
    const a = c.items.find((i) => i.key === "portal_account")!;
    await assignChecklistItem(fx.hr, a.id, { assigneeId: fx.emp2.userId, dueDate: addDays(TODAY(), 1) });
    await setDue(a.id, addDays(TODAY(), -2));
    await runChecklistReminders(); await runChecklistReminders();
    expect((await notes(fx.emp2, "checklist.reminder")).map((n) => n.title)).toEqual(["Butir checklist terlambat 2 hari"]);
    expect((await notes(fx.hr, "checklist.reminder")).length).toBe(1);

    await setDue(a.id, addDays(TODAY(), -9)); // pekan keterlambatan ke-2
    await runChecklistReminders();
    expect((await notes(fx.emp2, "checklist.reminder")).map((n) => n.title).sort()).toEqual(["Butir checklist terlambat 2 hari", "Butir checklist terlambat 9 hari"]);
    expect(await prisma.employeeChecklistReminderLog.count()).toBeGreaterThanOrEqual(4);
  });
});
