/**
 * Modul aset: daftar aset, serah-terima ke karyawan, pengembalian (kondisi + alasan bila rusak/hilang), satu pemegang per aset,
 * penjaga database, dan sinyal pada butir "Pengembalian aset" di checklist karyawan berhenti.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { addDays, todayIso } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { assignAsset, createAsset, foundAsset, getAsset, listAssets, listEmployeeAssets, retireAsset, returnAsset, updateAsset } from "@/server/services/assets";
import { listEmployeeChecklists, startChecklist } from "@/server/services/employee-checklists";

let fx: TrainingFixtures;
const TODAY = () => todayIso("Asia/Jakarta");
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const laptop = (over: Record<string, unknown> = {}) => createAsset(fx.hr, { name: "Laptop Lenovo E14", category: "LAPTOP", serialNo: "SN-123", ...over });

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

describe("mendaftarkan & mengubah aset", () => {
  it("kode urut dari sequence, tercatat di audit; hanya HR yang boleh mengubah, karyawan biasa tidak melihat", async () => {
    const a = await laptop();
    const b = await laptop({ name: "Kunci Ruang Arsip", category: "KEY", serialNo: "" });
    expect(a.code).toMatch(/^AST-\d{4,}$/);
    expect(b.code).not.toBe(a.code);
    expect(b.serialNo).toBeNull();
    expect(a).toMatchObject({ status: "AVAILABLE", holder: null, categoryLabel: "Laptop / komputer" });
    expect(await prisma.auditLog.count({ where: { action: "asset.create" } })).toBe(2);

    expect((await fail(createAsset(fx.emp1, { name: "Meja", category: "OTHER" })))?.code).toBe("FORBIDDEN");
    expect((await fail(listAssets(fx.emp1)))?.code).toBe("FORBIDDEN");
    expect((await fail(createAsset(fx.hr, { name: "X", category: "LAPTOP" })))?.fieldErrors?.name).toBeTruthy();
    expect((await fail(createAsset(fx.hr, { name: "Laptop", category: "MOBIL" })))?.fieldErrors?.category).toBeTruthy();

    const u = await updateAsset(fx.hr, a.id, { name: "Laptop Lenovo E14 Gen 2", category: "LAPTOP", serialNo: "SN-999", note: "Garansi sampai 2027" });
    expect(u).toMatchObject({ name: "Laptop Lenovo E14 Gen 2", serialNo: "SN-999", note: "Garansi sampai 2027", code: a.code });
  });

  it("daftar dapat disaring menurut status, kategori, dan pencarian (termasuk nama pemegang)", async () => {
    const a = await laptop();
    await laptop({ name: "Kartu Akses Lantai 2", category: "ACCESS_CARD", serialNo: "CARD-7" });
    await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0] });
    expect((await listAssets(fx.hr)).length).toBe(2);
    expect((await listAssets(fx.hr, { status: "ASSIGNED" })).map((x) => x.id)).toEqual([a.id]);
    expect((await listAssets(fx.hr, { category: "ACCESS_CARD" })).map((x) => x.name)).toEqual(["Kartu Akses Lantai 2"]);
    expect((await listAssets(fx.hr, { q: "card-7" })).length).toBe(1);
    const holder = (await listAssets(fx.hr, { status: "ASSIGNED" }))[0]!.holder!;
    expect((await listAssets(fx.hr, { q: holder.employeeName.split(" ")[0] })).map((x) => x.id)).toContain(a.id);
    expect((await fail(listAssets(fx.hr, { status: "ANEH" })))?.code).toBe("VALIDATION");
  });
});

describe("serah-terima & pengembalian", () => {
  it("serahkan → dipegang karyawan → kembalikan baik → tersedia lagi; riwayat dan audit tercatat", async () => {
    const a = await laptop();
    const given = await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0], assignedOn: addDays(TODAY(), -3), note: "Dengan charger" });
    expect(given.status).toBe("ASSIGNED");
    expect(given.holder).toMatchObject({ employeeId: fx.empIds[0], assignedOn: addDays(TODAY(), -3), note: "Dengan charger" });
    expect((await listEmployeeAssets(fx.hr, fx.empIds[0])).holding.map((h) => h.assetId)).toEqual([a.id]);

    const back = await returnAsset(fx.hr, a.id, { condition: "GOOD" });
    expect(back).toMatchObject({ status: "AVAILABLE", holder: null, lastCondition: "GOOD" });
    const d = await getAsset(fx.hr, a.id);
    expect(d.history).toHaveLength(1);
    expect(d.history[0]).toMatchObject({ returnedOn: TODAY(), returnCondition: "GOOD", assignedBy: expect.any(String), returnedBy: expect.any(String) });
    expect(await prisma.auditLog.count({ where: { action: { in: ["asset.assign", "asset.return"] } } })).toBe(2);

    // bisa dipinjamkan lagi ke orang lain
    expect((await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[1] })).holder?.employeeId).toBe(fx.empIds[1]);
    expect((await getAsset(fx.hr, a.id)).history).toHaveLength(2);
  });

  it("tidak bisa dipinjamkan ganda, ke karyawan nonaktif, atau dengan tanggal di masa depan; pengembalian divalidasi", async () => {
    const a = await laptop();
    await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0] });
    expect((await fail(assignAsset(fx.hr, a.id, { employeeId: fx.empIds[1] })))?.code).toBe("CONFLICT");
    await returnAsset(fx.hr, a.id, { condition: "GOOD" });

    await prisma.employee.update({ where: { id: fx.empIds[1] }, data: { isActive: false } });
    expect((await fail(assignAsset(fx.hr, a.id, { employeeId: fx.empIds[1] })))?.fieldErrors?.employeeId).toBeTruthy();
    expect((await fail(assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0], assignedOn: addDays(TODAY(), 2) })))?.fieldErrors?.assignedOn).toBeTruthy();
    expect((await fail(assignAsset(fx.emp1, a.id, { employeeId: fx.empIds[0] })))?.code).toBe("FORBIDDEN");

    await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0], assignedOn: addDays(TODAY(), -2) });
    expect((await fail(returnAsset(fx.hr, a.id, { condition: "GOOD", returnedOn: addDays(TODAY(), -5) })))?.fieldErrors?.returnedOn).toBeTruthy(); // sebelum serah-terima
    expect((await fail(returnAsset(fx.hr, a.id, { condition: "GOOD", returnedOn: addDays(TODAY(), 1) })))?.fieldErrors?.returnedOn).toBeTruthy();
    expect((await fail(returnAsset(fx.hr, a.id, { condition: "DAMAGED" })))?.fieldErrors?.note).toBeTruthy(); // rusak wajib berketerangan
    expect((await fail(returnAsset(fx.hr, a.id, { condition: "LOST", note: "  " })))?.fieldErrors?.note).toBeTruthy();
    expect((await fail(returnAsset(fx.emp1, a.id, { condition: "GOOD" })))?.code).toBe("FORBIDDEN");
    await returnAsset(fx.hr, a.id, { condition: "GOOD" });
    expect((await fail(returnAsset(fx.hr, a.id, { condition: "GOOD" })))?.code).toBe("CONFLICT"); // sudah kembali
  });

  it("dua serah-terima bersamaan: hanya satu yang berhasil", async () => {
    const a = await laptop();
    const rs = await Promise.allSettled([assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0] }), assignAsset(fx.hr, a.id, { employeeId: fx.empIds[1] })]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.assetAssignment.count({ where: { assetId: a.id, returnedOn: null } })).toBe(1);
  });

  it("dikembalikan rusak → tersedia dengan penanda; dikembalikan hilang → status Hilang, bisa ditemukan atau dinonaktifkan", async () => {
    const a = await laptop();
    await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0] });
    const dmg = await returnAsset(fx.hr, a.id, { condition: "DAMAGED", note: "Layar retak" });
    expect(dmg).toMatchObject({ status: "AVAILABLE", lastCondition: "DAMAGED", lastReturnNote: "Layar retak" });

    await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0] });
    const lost = await returnAsset(fx.hr, a.id, { condition: "LOST", note: "Hilang di perjalanan dinas" });
    expect(lost.status).toBe("LOST");
    expect((await fail(assignAsset(fx.hr, a.id, { employeeId: fx.empIds[1] })))?.code).toBe("CONFLICT");
    expect((await foundAsset(fx.hr, a.id)).status).toBe("AVAILABLE");
    expect((await fail(foundAsset(fx.hr, a.id)))?.code).toBe("CONFLICT"); // bukan lagi hilang

    const lost2 = await laptop({ name: "Ponsel Kantor" });
    await assignAsset(fx.hr, lost2.id, { employeeId: fx.empIds[1] });
    expect((await fail(retireAsset(fx.hr, lost2.id, { reason: "Rusak berat" })))?.code).toBe("CONFLICT"); // masih dipinjam
    await returnAsset(fx.hr, lost2.id, { condition: "LOST", note: "Dicuri" });
    const retired = await retireAsset(fx.hr, lost2.id, { reason: "Dihapusbukukan setelah laporan polisi" });
    expect(retired.status).toBe("RETIRED");
    expect((await fail(retireAsset(fx.hr, lost2.id, { reason: "Lagi" })))?.code).toBe("CONFLICT");
    expect((await fail(updateAsset(fx.hr, lost2.id, { name: "Ponsel Lama", category: "PHONE" })))?.code).toBe("CONFLICT");
    expect((await fail(retireAsset(fx.hr, a.id, { reason: "x" })))?.fieldErrors?.reason).toBeTruthy();
  });
});

describe("penjaga database", () => {
  it("aset & riwayat tidak dihapus; riwayat yang sudah kembali terkunci; satu penugasan aktif per aset; kode tidak berubah", async () => {
    const a = await laptop();
    await assignAsset(fx.hr, a.id, { employeeId: fx.empIds[0] });
    const open = (await prisma.assetAssignment.findFirst({ where: { assetId: a.id } }))!;
    await expect(prisma.assetAssignment.delete({ where: { id: open.id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.asset.delete({ where: { id: a.id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.asset.update({ where: { id: a.id }, data: { code: "AST-9999" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.assetAssignment.update({ where: { id: open.id }, data: { employeeId: fx.empIds[1] } })).rejects.toThrow(/HRIS-GUARD/); // data serah-terima tetap
    // penugasan aktif kedua pada aset yang sama ditolak indeks unik parsial, walau service dilewati
    await expect(prisma.assetAssignment.create({ data: { assetId: a.id, employeeId: fx.empIds[1], assignedOn: new Date(), assignedById: fx.hr.userId } })).rejects.toThrow();

    await returnAsset(fx.hr, a.id, { condition: "GOOD" });
    await expect(prisma.assetAssignment.update({ where: { id: open.id }, data: { returnNote: "ubah diam-diam" } })).rejects.toThrow(/HRIS-GUARD/);
    // pengembalian tanpa alasan untuk rusak ditolak CHECK walau service dilewati
    const b = await laptop({ name: "Tablet" });
    await assignAsset(fx.hr, b.id, { employeeId: fx.empIds[0] });
    const o2 = (await prisma.assetAssignment.findFirst({ where: { assetId: b.id, returnedOn: null } }))!;
    await expect(prisma.assetAssignment.update({ where: { id: o2.id }, data: { returnedOn: new Date(), returnedById: fx.hr.userId, returnCondition: "DAMAGED" } })).rejects.toThrow();
  });
});

describe("sinyal pada checklist karyawan berhenti", () => {
  it("menunjukkan aset yang belum dikembalikan; OK setelah dikembalikan; tidak pernah mencentang sendiri", async () => {
    const e = fx.empIds[0];
    const c = await startChecklist(fx.hr, e, { kind: "OFFBOARDING" });
    const sig = async () => (await listEmployeeChecklists(fx.hr, e)).find((x) => x.id === c.id)!.items.find((i) => i.key === "assets")!;
    expect((await sig()).signal).toMatchObject({ state: "INFO" }); // belum ada aset tercatat

    const a = await laptop();
    await assignAsset(fx.hr, a.id, { employeeId: e });
    const warn = await sig();
    expect(warn.signal?.state).toBe("WARN");
    expect(warn.signal?.text).toContain("Laptop Lenovo E14");
    expect(warn.status).toBe("TODO");

    await returnAsset(fx.hr, a.id, { condition: "DAMAGED", note: "Engsel patah" });
    const ok = await sig();
    expect(ok.signal?.state).toBe("OK");
    expect(ok.signal?.text).toMatch(/rusak\/hilang/);
    expect(ok.status).toBe("TODO"); // HR tetap yang menandai
  });
});
