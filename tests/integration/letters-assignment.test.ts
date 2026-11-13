/**
 * Persuratan tahap 4: Surat Tugas (INT-002) diterbitkan lewat mesin dokumen. Data penugasan terstruktur → isi surat dibangkitkan → saat disetujui
 * terbit nomor master + AssignmentLetter (uang harian, jadwal, ketersediaan) dalam satu transaksi; PDF resmi = PDF dokumen; pembatalan berantai.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { addDays, todayIso } from "@/lib/time";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter, updateLetter, submitLetter, approveLetter, cancelLetter, getLetter } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { assignmentPdfFile, cancelAssignment, getAssignmentForPdf, issueReceipt, listAssignments, listMyAssignments, voidReceipt } from "@/server/services/assignments";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";

let direktur: Actor, hr: Actor, manajer: Actor, staf: Actor;
let stafEmp = "", hrEmp = "";
const fail = async (pr: Promise<unknown>) => { try { await pr; return null; } catch (e) { return e as AppError; } };
const FORBIDDEN = { code: "FORBIDDEN" }, VALIDATION = { code: "VALIDATION" }, CONFLICT = { code: "CONFLICT" };
const day = () => addDays(todayIso("Asia/Jakarta"), 3);
async function emp(no: string, name: string, extra: Record<string, unknown> = {}) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position: name, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT", ...extra } as never });
}
const payload = (over: Record<string, unknown> = {}) => ({ purpose: "Pendampingan pelatihan di klien", destination: "Bandung", startDate: day(), endDate: addDays(day(), 2), details: "Mendampingi instruktur", assignees: [{ employeeId: stafEmp, dailyRate: 300_000 }], ...over });
async function tugasType() { await listTypes(direktur); return prisma.letterType.findFirstOrThrow({ where: { series: "INT", code: 2 } }); }
async function issued(creator: Actor = hr, signer: Actor = manajer) {
  const d = await createLetter(creator, { typeId: (await tugasType()).id });
  await updateLetter(creator, d.id, { assignment: payload(), signerId: signer.userId });
  await submitLetter(creator, d.id);
  return approveLetter(signer, d.id);
}

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur", "SUPER_ADMIN", (await emp("D-1", "Direktur Utama")).id);
  hrEmp = (await emp("H-1", "HR Uji")).id;
  hr = await makeUser("hr@uji.test", "HR Uji", "HR_ADMIN", hrEmp);
  manajer = await makeUser("mgr@uji.test", "Manajer Operasional", "EMPLOYEE", (await emp("M-1", "Manajer Operasional", { jobLevel: "MANAGER" })).id);
  stafEmp = (await emp("S-1", "Staf Admisi")).id;
  staf = await makeUser("staf@uji.test", "Staf Admisi", "EMPLOYEE", stafEmp);
});

describe("Surat Tugas via Persuratan (INT-002)", () => {
  it("hanya HR/Direktur yang dapat membuat; jenis tersembunyi bagi staf", async () => {
    const t = await tugasType();
    expect((await listTypes(hr)).some((x) => x.id === t.id)).toBe(true);
    expect((await listTypes(staf)).some((x) => x.id === t.id)).toBe(false);
    expect(await fail(createLetter(staf, { typeId: t.id }))).toMatchObject(FORBIDDEN);
    expect(await fail(createLetter(manajer, { typeId: t.id }))).toMatchObject(FORBIDDEN);
    expect((await createLetter(direktur, { typeId: t.id })).kind).toBe("TUGAS");
  });

  it("isi dibangkitkan dari data penugasan; isi tidak dapat diketik; HR tidak boleh menugaskan diri sendiri; karyawan nonaktif ditolak", async () => {
    const d = await createLetter(hr, { typeId: (await tugasType()).id });
    const u = await updateLetter(hr, d.id, { assignment: payload() });
    expect(u.subject).toBe("Surat Tugas: Pendampingan pelatihan di klien");
    expect(JSON.stringify(u.body)).toContain("Staf Admisi"); expect(JSON.stringify(u.body)).not.toContain("300"); // uang harian tidak dicetak di surat
    expect(await fail(updateLetter(hr, d.id, { body: { type: "doc", content: [{ type: "paragraph" }] } }))).toMatchObject(VALIDATION);
    expect(await fail(updateLetter(hr, d.id, { assignment: payload({ assignees: [{ employeeId: hrEmp, dailyRate: 1 }] }) }))).toMatchObject(VALIDATION);
    await prisma.employee.update({ where: { id: stafEmp }, data: { isActive: false } });
    expect(await fail(updateLetter(hr, d.id, { assignment: payload() }))).toMatchObject(VALIDATION);
    await prisma.employee.update({ where: { id: stafEmp }, data: { isActive: true } });
    expect(await fail(submitLetter(hr, (await createLetter(hr, { typeId: (await tugasType()).id })).id))).toMatchObject(VALIDATION); // belum ada data penugasan
    // Direktur boleh menugaskan dirinya
    const dd = await createLetter(direktur, { typeId: (await tugasType()).id });
    expect((await updateLetter(direktur, dd.id, { assignment: payload({ assignees: [{ employeeId: (await prisma.employee.findFirstOrThrow({ where: { userId: direktur.userId } })).id, dailyRate: 0 }] }) })).assignment).toBeTruthy();
  });

  it("disetujui → nomor master TE-INT/002, surat tugas terbit dengan nomor sama (tanpa penomoran lama), penerima diberi tahu, PDF = PDF dokumen", async () => {
    const out = await issued();
    expect(out.number).toMatch(/^001\/TE-INT\/002\//);
    const a = await prisma.assignmentLetter.findUniqueOrThrow({ where: { letterDocumentId: out.id }, include: { assignees: true } });
    expect(a).toMatchObject({ number: out.number, status: "ISSUED", seqNo: null, seqYear: null });
    expect(a.number).not.toContain("/ST/");
    expect(a.assignees).toHaveLength(1); expect(Number(a.assignees[0]!.total)).toBe(900_000); // 3 hari × 300.000
    expect(a.issuedById).toBe(hr.userId);
    expect(await prisma.notification.count({ where: { userId: staf.userId, type: "assignment.issued" } })).toBe(1);
    const my = await listMyAssignments(staf);
    expect(my.map((m) => m.number)).toEqual([out.number]);
    const pdf = await getAssignmentForPdf(staf, a.id);
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: out.id } });
    expect(pdf.engineFileId).toBe(row.pdfFileId);
    expect((await listAssignments(hr)).items.map((x) => x.number)).toContain(out.number);
    // data penugasan terkunci setelah terbit
    await expect(prisma.$executeRaw`UPDATE letter_documents SET assignment = '{}'::jsonb WHERE id = ${out.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    // dokumen penugasan memuat rujukan surat tugas
    expect((await getLetter(hr, out.id)).assignmentId).toBe(a.id);
  });

  it("uang harian oleh HR/Direktur; pembatalan dokumen diblok selama bukti aktif; lalu berantai membatalkan surat tugas", async () => {
    const out = await issued();
    const a = await prisma.assignmentLetter.findUniqueOrThrow({ where: { letterDocumentId: out.id }, include: { assignees: true } });
    const r = await issueReceipt(hr, { assigneeId: a.assignees[0]!.id, method: "CASH" });
    expect(await fail(issueReceipt(staf, { assigneeId: a.assignees[0]!.id, method: "CASH" }))).toMatchObject(FORBIDDEN);
    expect(await fail(cancelLetter(direktur, out.id, { note: "Batal tugas" }))).toMatchObject(CONFLICT);
    expect((await getLetter(direktur, out.id)).status).toBe("ISSUED"); // rollback utuh
    await voidReceipt(direktur, r.id, { reason: "Salah nominal" });
    expect(await fail(cancelAssignment(hr, a.id, { reason: "Lewat jalur lama" }))).toMatchObject(CONFLICT); // harus dari Persuratan
    await cancelLetter(direktur, out.id, { note: "Penugasan dibatalkan" });
    expect((await prisma.assignmentLetter.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("CANCELLED");
    expect(await prisma.notification.count({ where: { userId: staf.userId, type: "assignment.cancelled" } })).toBe(1);
  });

  it("gagal membuat surat tugas (mis. penugas kehilangan wewenang) → nomor dokumen tidak terpakai", async () => {
    const d = await createLetter(hr, { typeId: (await tugasType()).id });
    await updateLetter(hr, d.id, { assignment: payload(), signerId: manajer.userId });
    await submitLetter(hr, d.id);
    await prisma.user.update({ where: { id: hr.userId }, data: { role: "EMPLOYEE" } });
    expect(await fail(approveLetter(manajer, d.id))).toBeTruthy();
    await prisma.user.update({ where: { id: hr.userId }, data: { role: "HR_ADMIN" } });
    expect((await approveLetter(manajer, d.id)).number).toMatch(/^001\//);
    expect(await prisma.assignmentLetter.count()).toBe(1);
  });
});

describe("PDF Surat Tugas dibatalkan: salinan status bertanda DIBATALKAN", () => {
  const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
  it("sebelum dibatalkan = PDF resmi apa adanya; sesudah dibatalkan (lewat Persuratan) unduhan penerima & HR = salinan bertanda, arsip asli utuh, penerima diberi tahu untuk menghentikan pemakaian salinan lama", async () => {
    const out = await issued();
    const a = await prisma.assignmentLetter.findUniqueOrThrow({ where: { letterDocumentId: out.id } });
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: out.id } });
    const live = await assignmentPdfFile(staf, a.id);
    expect(live.cancelled).toBe(false);
    expect(live.fileName).toBe(`Surat_Tugas_${a.number}`.replace(/[^0-9A-Za-z]+/g, "_") + ".pdf");
    expect(sha(live.bytes)).toBe(row.pdfSha256);

    await cancelLetter(direktur, out.id, { note: "Penugasan dibatalkan klien" });
    for (const who of [staf, hr]) {
      const f = await assignmentPdfFile(who, a.id);
      expect(f.cancelled).toBe(true);
      expect(f.fileName).toMatch(/_DIBATALKAN\.pdf$/);
      expect(sha(f.bytes)).not.toBe(row.pdfSha256);                                   // BUKAN PDF asli tanpa tanda
      const meta = await PDFDocument.load(f.bytes);
      expect(meta.getSubject()).toContain("DIBATALKAN");
      expect(meta.getPageCount()).toBe((await PDFDocument.load(live.bytes)).getPageCount());
    }
    // arsip asli tidak berubah
    const stored = Buffer.from((await prisma.storedFile.findUniqueOrThrow({ where: { id: row.pdfFileId! } })).data);
    expect(sha(stored)).toBe(row.pdfSha256);
    // tercatat & hak akses tetap: hanya penerima/pengelola
    expect((await prisma.auditLog.findMany({ where: { action: "assignment.download", entityId: a.id }, orderBy: { id: "desc" }, take: 1 }))[0]!.summary).toContain("salinan status DIBATALKAN");
    const other = await makeUser("lain@uji.test", "Staf Lain", "EMPLOYEE", (await emp("S-9", "Staf Lain")).id);
    expect(await fail(assignmentPdfFile(other, a.id))).toMatchObject({ code: "NOT_FOUND" });
    // penerima diberi tahu, termasuk agar menghentikan pemakaian salinan PDF yang sudah dimiliki
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: staf.userId, type: "assignment.cancelled" } });
    expect(n.body).toContain("Penugasan dibatalkan klien");
    expect(n.body).toContain("Hentikan penggunaan salinan PDF");
  });
});
