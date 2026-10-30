import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { commitEmployeeImport, previewEmployeeImport } from "@/server/services/employee-import";
import { revealBankAccount } from "@/server/services/employees";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
});

const enc = (s: string) => new TextEncoder().encode(s);
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const HEAD = "No. Induk,Nama Lengkap,Divisi,Jabatan,Status,Mulai Bekerja,Telepon,Email,Nomor Rekening";

describe("impor karyawan (CSV/Excel)", () => {
  it("pratinjau tidak menyimpan apa pun; komit membuat karyawan, divisi baru, dan mengenkripsi rekening", async () => {
    const csv = [HEAD, "IMP-1,Rani Satu,Divisi Baru,Staf,Kontrak,05/02/2026,0812-1111-0001,rani@contoh.test,1234567890", "IMP-2,Sari Dua,Operasional,Staf,Tetap,2026-03-02,,,"].join("\n");
    const before = await prisma.employee.count();
    const p = await previewEmployeeImport(fx.hr, enc(csv), "a.csv", "skip");
    expect(p.counts).toEqual({ create: 2, update: 0, skip: 0, error: 0 });
    expect(p.newDivisions).toEqual(["Divisi Baru"]);
    expect(await prisma.employee.count()).toBe(before);

    await commitEmployeeImport(fx.hr, enc(csv), "a.csv", "skip");
    expect(await prisma.employee.count()).toBe(before + 2);
    const rani = await prisma.employee.findFirstOrThrow({ where: { employeeNo: "IMP-1" }, include: { division: true } });
    expect(rani.division?.name).toBe("Divisi Baru");
    expect(rani.employmentStatus).toBe("CONTRACT");
    expect(rani.joinDate.toISOString().slice(0, 10)).toBe("2026-02-05");
    expect(rani.bankAccountEnc).toMatch(/^v1:/);
    expect((await revealBankAccount(fx.hr, rani.id)).accountNo).toBe("1234567890");
    expect(await prisma.auditLog.count({ where: { action: "employee.import" } })).toBe(1);
  });

  it("semua-atau-tidak-sama-sekali: satu baris bermasalah membatalkan seluruh impor", async () => {
    const csv = [HEAD, "IMP-1,Baik Satu,,Staf,Tetap,2026-01-05,,,", "IMP-2,Salah Dua,,Staf,Honorer,2026-01-05,,,", "IMP-3,Salah Tiga,,Staf,Tetap,31/02/2026,,,", "IMP-1,Dobel,,Staf,Tetap,2026-01-05,,,"].join("\n");
    const p = await previewEmployeeImport(fx.hr, enc(csv), "b.csv", "skip");
    expect(p.counts.error).toBe(3);
    expect(p.rows[1]!.errors.join()).toMatch(/Honorer/);
    expect(p.rows[2]!.errors.join()).toMatch(/Tanggal mulai/);
    expect(p.rows[3]!.errors.join()).toMatch(/lebih dari sekali/);
    const before = await prisma.employee.count();
    expect((await fail(commitEmployeeImport(fx.hr, enc(csv), "b.csv", "skip")))?.code).toBe("VALIDATION");
    expect(await prisma.employee.count()).toBe(before);
    expect(await prisma.division.count()).toBe(2);
  });

  it("nomor induk yang sudah ada: dilewati (default) atau diperbarui tanpa menimpa kolom kosong", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[0] }, data: { phone: "0811-0000-0000" } });
    const csv = [HEAD, "te-001,Ayu Lestari Baru,,Senior Staf,Tetap,2025-01-01,,,"].join("\n");
    const skip = await commitEmployeeImport(fx.hr, enc(csv), "c.csv", "skip");
    expect(skip.counts.skip).toBe(1);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: fx.empIds[0] } })).fullName).toBe("Ayu Lestari");
    const upd = await commitEmployeeImport(fx.hr, enc(csv), "c.csv", "update");
    expect(upd.counts.update).toBe(1);
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: fx.empIds[0] } });
    expect(e.fullName).toBe("Ayu Lestari Baru");
    expect(e.position).toBe("Senior Staf");
    expect(e.phone).toBe("0811-0000-0000"); // kolom kosong tidak menimpa
  });

  it("membaca file Excel (.xlsx) termasuk sel tanggal", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Karyawan");
    ws.addRow(["No. Induk", "Nama Lengkap", "Jabatan", "Status", "Mulai Bekerja", "Telepon"]);
    ws.addRow(["XLS-1", "Tono Excel", "Staf", "Magang", new Date(Date.UTC(2026, 3, 6)), "0812-2222-0002"]);
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const r = await commitEmployeeImport(fx.hr, buf, "karyawan.xlsx", "skip");
    expect(r.counts.create).toBe(1);
    const e = await prisma.employee.findFirstOrThrow({ where: { employeeNo: "XLS-1" } });
    expect(e.employmentStatus).toBe("INTERN");
    expect(e.joinDate.toISOString().slice(0, 10)).toBe("2026-04-06");
  });

  it("titik koma (Excel Indonesia), kolom wajib hilang, format salah, batas baris, dan izin", async () => {
    const semi = "No. Induk;Nama Lengkap;Jabatan;Mulai Bekerja\nSEM-1;Dewi Titik Koma;Staf;2026-01-05";
    expect((await previewEmployeeImport(fx.hr, enc(semi), "d.csv", "skip")).counts.create).toBe(1);
    expect((await fail(previewEmployeeImport(fx.hr, enc("Nama Lengkap,Jabatan\nX,Y"), "e.csv", "skip")))?.message).toMatch(/Kolom wajib/);
    expect((await fail(previewEmployeeImport(fx.hr, enc("a"), "f.csv", "skip")))?.code).toBe("VALIDATION");
    expect((await fail(previewEmployeeImport(fx.hr, enc("x"), "g.pdf", "skip")))?.message).toMatch(/Format file/);
    const big = [HEAD, ...Array.from({ length: 501 }, (_, i) => `B-${i},Nama ${i},,Staf,Tetap,2026-01-05,,,`)].join("\n");
    expect((await fail(previewEmployeeImport(fx.hr, enc(big), "h.csv", "skip")))?.message).toMatch(/Maksimal 500/);
    expect((await fail(previewEmployeeImport(fx.emp1, enc(semi), "d.csv", "skip")))?.code).toBe("FORBIDDEN");
  });
});
