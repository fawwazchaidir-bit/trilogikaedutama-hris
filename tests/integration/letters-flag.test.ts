/** Persuratan DIMATIKAN (LETTERS_MODULE_ENABLED=false — default): layanan menolak (pembuat surat tugas dijelaskan, lainnya "tidak ditemukan"); verifikasi publik tetap berfungsi untuk surat yang sudah terbit. */
process.env.LETTERS_MODULE_ENABLED = "false";

import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { lettersEnabled } from "@/server/env";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter, listLetters } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { verifyByToken } from "@/server/services/letters/public";
import { isoToDate } from "@/server/json";

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
beforeEach(async () => { await resetDb(); });

describe("flag persuratan mati", () => {
  it("flag mati → Direktur/HR mendapat penjelasan (CONFLICT), selain itu NOT_FOUND; verifikasi publik surat terbit tetap jalan", async () => {
    expect(lettersEnabled()).toBe(false);
    const e = await prisma.employee.create({ data: { employeeNo: "D-1", fullName: "Direktur", position: "Direktur Utama", employmentStatus: "PERMANENT", joinDate: isoToDate("2026-01-05") } });
    const dir = await makeUser("d@uji.test", "Direktur", "SUPER_ADMIN", e.id);
    // Pembuat surat tugas (Direktur/HR) mendapat PENJELASAN yang bisa ditindaklanjuti (pembuatan surat tugas hanya lewat Persuratan); selain mereka tetap 404.
    for (const call of [listTypes(dir), listLetters(dir, {}), createLetter(dir, { typeId: "00000000-0000-4000-8000-000000000000" })]) {
      const e = await fail(call);
      expect(e).toMatchObject({ code: "CONFLICT" });
      expect(e?.message).toMatch(/Persuratan belum diaktifkan[^]*LETTERS_MODULE_ENABLED=false[^]*check:config/);
    }
    const hrEmp = await prisma.employee.create({ data: { employeeNo: "H-1", fullName: "HR", position: "HR", employmentStatus: "PERMANENT", joinDate: isoToDate("2026-01-05") } });
    const hr = await makeUser("hr@uji.test", "HR", "HR_ADMIN", hrEmp.id);
    expect(await fail(createLetter(hr, { typeId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ code: "CONFLICT" });
    const stafEmp = await prisma.employee.create({ data: { employeeNo: "S-1", fullName: "Staf", position: "Staf", employmentStatus: "PERMANENT", joinDate: isoToDate("2026-01-05") } });
    const staf = await makeUser("s@uji.test", "Staf", "EMPLOYEE", stafEmp.id);
    expect(await fail(listTypes(staf))).toMatchObject({ code: "NOT_FOUND" });                                  // yang tidak berwenang: modul tidak membocorkan keberadaannya
    expect(await fail(createLetter(staf, { typeId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ code: "NOT_FOUND" });
    // surat terbit yang sudah beredar tetap dapat diverifikasi lewat QR
    const type = await prisma.letterType.create({ data: { series: "EKS", code: 9, name: "Uji", templateBody: { type: "doc", content: [] } } });
    await prisma.letterDocument.create({ data: { typeId: type.id, series: "EKS", creatorId: dir.userId, signerId: dir.userId, subject: "S", body: { type: "doc", content: [] }, verifyToken: "a".repeat(32), status: "DRAFT" } });
    await prisma.$executeRaw`UPDATE letter_documents SET status='IN_REVIEW' WHERE "verifyToken" = ${"a".repeat(32)}`;
    await prisma.$executeRaw`UPDATE letter_documents SET status='ISSUED', number='001/TE-EKS/009/I/2026', "seqNo"=1, "seqYear"=2026, "pdfSha256"='abc', "issueDate"='2026-01-05', "pdfFileId"=gen_random_uuid() WHERE "verifyToken" = ${"a".repeat(32)}`;
    expect((await verifyByToken("a".repeat(32)))?.state).toBe("VALID");
  });
});
