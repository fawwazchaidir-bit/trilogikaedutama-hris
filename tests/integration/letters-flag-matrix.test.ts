/**
 * MATRIKS bendera Persuratan × operasi surat tugas. File yang SAMA dijalankan dua kali (`npm run test:letters-flags`): LETTERS_MODULE_ENABLED=true lalu =false
 * (env() tersimpan per proses, jadi dua proses). Pada uji biasa (`vitest run`) berjalan pada keadaan bawaan uji (menyala).
 *
 *   operasi                         | bendera MENYALA                               | bendera MATI
 *   membuat surat tugas             | HR tertaut & Direktur: draf; staf ditolak      | HR/Direktur: penjelasan (CONFLICT); staf: 404
 *   persetujuan                     | ajukan → penandatangan setujui → terbit        | dokumen yang ada dijeda (penjelasan bagi yang berwenang)
 *   pembatalan                      | dari dokumen, berantai ke surat tugas          | surat tugas dibatalkan lewat layanan penugasan (tak bergantung bendera)
 *   uang harian                     | terbit & batal bukti penerimaan                | sama (tak bergantung bendera)
 *   verifikasi QR, Surat Tugas Saya | berfungsi                                      | berfungsi
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { lettersEnabled } from "@/server/env";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { addDays, todayIso } from "@/lib/time";
import { exitCodeFor } from "@/lib/letters-readiness";
import { resetDb, makeUser } from "../helpers/db";
import { approveLetter, cancelLetter, createLetter, submitLetter, updateLetter } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { verifyByToken } from "@/server/services/letters/public";
import { cancelAssignment, issueReceipt, listAssignments, listMyAssignments, voidReceipt } from "@/server/services/assignments";
import { checkLettersReadiness } from "@/server/services/letters/readiness";
import { loadNav } from "@/server/nav";

const ON = lettersEnabled();
let direktur: Actor, hr: Actor, manajer: Actor, staf: Actor;
let stafEmp = "";
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const day = () => addDays(todayIso("Asia/Jakarta"), 3);
const emp = (no: string, name: string, extra: Record<string, unknown> = {}) => prisma.employee.create({ data: { employeeNo: no, fullName: name, position: name, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT", ...extra } as never });
const payload = () => ({ purpose: "Pendampingan pelatihan di klien", destination: "Bandung", startDate: day(), endDate: addDays(day(), 2), details: "Mendampingi instruktur", assignees: [{ employeeId: stafEmp, dailyRate: 300_000 }] });

/** Surat tugas yang SUDAH terbit (disisipkan langsung): mewakili surat tugas lama / terbit sebelum modul dimatikan. */
async function issuedAssignment(seq = 1) {
  const l = await prisma.assignmentLetter.create({ data: { seqYear: 2026, seqNo: seq, number: `${String(seq).padStart(3, "0")}/ST/XI/2026`, status: "ISSUED", purpose: "Pendampingan", destination: "Bandung", startDate: isoToDate(day()), endDate: isoToDate(addDays(day(), 2)), issueDate: isoToDate(todayIso("Asia/Jakarta")), snapshot: {}, issuedById: hr.userId } });
  const a = await prisma.assignmentAssignee.create({ data: { letterId: l.id, employeeId: stafEmp, days: 3, dailyRate: 300_000n, total: 900_000n } });
  return { letter: l, assignee: a };
}

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur", "SUPER_ADMIN", (await emp("D-1", "Direktur Utama")).id);
  hr = await makeUser("hr@uji.test", "HR Uji", "HR_ADMIN", (await emp("H-1", "HR Uji")).id);
  manajer = await makeUser("mgr@uji.test", "Manajer Operasional", "EMPLOYEE", (await emp("M-1", "Manajer Operasional", { jobLevel: "MANAGER" })).id);
  stafEmp = (await emp("S-1", "Staf Admisi")).id;
  staf = await makeUser("staf@uji.test", "Staf Admisi", "EMPLOYEE", stafEmp);
});

describe(`MEMBUAT surat tugas — Persuratan ${ON ? "MENYALA" : "MATI"}`, () => {
  it(ON ? "HR tertaut dan Direktur membuat draf; staf & manajer ditolak" : "HR/Direktur mendapat penjelasan yang bisa ditindaklanjuti (bukan 'tidak ditemukan'); staf tetap 404", async () => {
    if (ON) {
      const t = await prisma.letterType.findFirst({ where: { kind: "TUGAS" } }) ?? (await listTypes(direktur), await prisma.letterType.findFirstOrThrow({ where: { kind: "TUGAS" } }));
      expect((await createLetter(hr, { typeId: t.id })).kind).toBe("TUGAS");
      expect((await createLetter(direktur, { typeId: t.id })).kind).toBe("TUGAS");
      expect((await fail(createLetter(staf, { typeId: t.id })))?.code).toBe("FORBIDDEN");
      expect((await fail(createLetter(manajer, { typeId: t.id })))?.code).toBe("FORBIDDEN");
    } else {
      const fake = "00000000-0000-4000-8000-000000000000";
      for (const a of [hr, direktur]) {
        for (const call of [listTypes(a), createLetter(a, { typeId: fake })]) {
          const e = await fail(call);
          expect(e?.code).toBe("CONFLICT");
          expect(e?.message).toMatch(/LETTERS_MODULE_ENABLED=false/);
        }
      }
      expect((await fail(listTypes(staf)))?.code).toBe("NOT_FOUND");
      expect((await fail(createLetter(manajer, { typeId: fake })))?.code).toBe("NOT_FOUND");
      expect(await prisma.letterDocument.count()).toBe(0);
    }
  });
});

describe(`PERSETUJUAN — Persuratan ${ON ? "MENYALA" : "MATI"}`, () => {
  it(ON ? "ajukan → penandatangan menyetujui → terbit dengan nomor Persuratan dan surat tugas terbentuk" : "dokumen yang sudah ada DIJEDA: penandatangan berwenang mendapat penjelasan, status tidak berubah", async () => {
    if (ON) {
      await listTypes(direktur);
      const t = await prisma.letterType.findFirstOrThrow({ where: { kind: "TUGAS" } });
      const d = await createLetter(hr, { typeId: t.id });
      await updateLetter(hr, d.id, { assignment: payload(), signerId: manajer.userId });
      await submitLetter(hr, d.id);
      const out = await approveLetter(manajer, d.id);
      expect(out.status).toBe("ISSUED");
      expect(out.number).toMatch(/\/TE-INT\/002\//);
      const a = await prisma.assignmentLetter.findFirstOrThrow({ where: { letterDocumentId: d.id } });
      expect(a).toMatchObject({ status: "ISSUED", number: out.number });
    } else {
      // dokumen menunggu persetujuan yang dibuat sebelum modul dimatikan
      const type = await prisma.letterType.create({ data: { series: "INT", code: 2, kind: "TUGAS", name: "Surat Tugas", templateBody: { type: "doc", content: [] } } });
      const doc = await prisma.letterDocument.create({ data: { typeId: type.id, series: "INT", creatorId: hr.userId, signerId: direktur.userId, subject: "S", body: { type: "doc", content: [] }, verifyToken: "b".repeat(32) } });
      await prisma.$executeRaw`UPDATE letter_documents SET status='IN_REVIEW' WHERE id = ${doc.id}::uuid`;
      const e = await fail(approveLetter(direktur, doc.id));
      expect(e?.code).toBe("CONFLICT");
      expect(e?.message).toMatch(/Persuratan belum diaktifkan/);
      expect((await prisma.letterDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("IN_REVIEW");
    }
  });
});

describe(`PEMBATALAN — Persuratan ${ON ? "MENYALA" : "MATI"}`, () => {
  it("surat tugas yang sudah terbit dapat dibatalkan lewat layanan penugasan (tidak bergantung bendera); penerima diberi tahu", async () => {
    const { letter } = await issuedAssignment();
    const r = await cancelAssignment(hr, letter.id, { reason: "Perjalanan dibatalkan klien" });
    expect(r.status).toBe("CANCELLED");
    expect(await prisma.notification.count({ where: { type: "assignment.cancelled", userId: staf.userId } })).toBe(1);
  });
  if (ON) {
    it("dari dokumen: pembatalan berantai ke surat tugasnya", async () => {
      await listTypes(direktur);
      const t = await prisma.letterType.findFirstOrThrow({ where: { kind: "TUGAS" } });
      const d = await createLetter(hr, { typeId: t.id });
      await updateLetter(hr, d.id, { assignment: payload(), signerId: manajer.userId });
      await submitLetter(hr, d.id);
      await approveLetter(manajer, d.id);
      await cancelLetter(direktur, d.id, { note: "Dibatalkan dari dokumen" });
      expect((await prisma.assignmentLetter.findFirstOrThrow({ where: { letterDocumentId: d.id } })).status).toBe("CANCELLED");
    });
  }
});

describe(`UANG HARIAN — Persuratan ${ON ? "MENYALA" : "MATI"} (tidak bergantung bendera)`, () => {
  it("HR menerbitkan Bukti Penerimaan; Direktur membatalkannya; staf melihat bukti aktifnya di Surat Tugas Saya", async () => {
    const { assignee } = await issuedAssignment();
    const rc = await issueReceipt(hr, { assigneeId: assignee.id, method: "CASH" });
    expect(rc.total).toBe(900_000);
    expect((await listMyAssignments(staf))[0]!.receipt?.number).toBe(rc.number);
    expect((await listAssignments(hr, {})).items[0]!.assignees[0]!.receipt?.id).toBe(rc.id);
    await voidReceipt(direktur, rc.id, { reason: "Salah nominal" });
    expect((await listMyAssignments(staf))[0]!.receipt).toBeNull();
    expect((await issueReceipt(hr, { assigneeId: assignee.id, method: "TRANSFER" })).total).toBe(900_000);   // dapat diterbitkan ulang setelah dibatalkan
  });
});

describe(`VERIFIKASI QR & MENU — Persuratan ${ON ? "MENYALA" : "MATI"}`, () => {
  it("verifikasi publik surat terbit berfungsi di kedua keadaan", async () => {
    const type = await prisma.letterType.create({ data: { series: "EKS", code: 9, name: "Uji", templateBody: { type: "doc", content: [] } } });
    await prisma.letterDocument.create({ data: { typeId: type.id, series: "EKS", creatorId: direktur.userId, signerId: direktur.userId, subject: "S", body: { type: "doc", content: [] }, verifyToken: "a".repeat(32) } });
    await prisma.$executeRaw`UPDATE letter_documents SET status='IN_REVIEW' WHERE "verifyToken" = ${"a".repeat(32)}`;
    await prisma.$executeRaw`UPDATE letter_documents SET status='ISSUED', number='001/TE-EKS/009/I/2026', "seqNo"=1, "seqYear"=2026, "pdfSha256"='abc', "issueDate"='2026-01-05', "pdfFileId"=gen_random_uuid() WHERE "verifyToken" = ${"a".repeat(32)}`;
    expect((await verifyByToken("a".repeat(32)))?.state).toBe("VALID");
  });
  it(ON ? "menu HR memuat Persuratan (bukan jalan pintas Surat Tugas)" : "menu HR memuat jalan ke Surat Tugas & Uang Harian walau Persuratan mati; staf tetap punya Surat Tugas Saya", async () => {
    const hrNav = (await loadNav(hr as never)).nav.map((n) => n.href);
    if (ON) { expect(hrNav).toContain("/persuratan"); expect(hrNav).not.toContain("/persuratan/surat-tugas"); }
    else { expect(hrNav).not.toContain("/persuratan"); expect(hrNav).toContain("/persuratan/surat-tugas"); }
    expect((await loadNav(staf as never)).nav.map((n) => n.href)).toContain("/surat-tugas-saya");
    expect((await loadNav(staf as never)).nav.map((n) => n.href)).not.toContain("/persuratan/surat-tugas");
  });
});

describe(`KESIAPAN — Persuratan ${ON ? "MENYALA" : "MATI"}`, () => {
  it("laporan: bendera dinilai; surat tugas baru hanya 'dapat dibuat' bila menyala dan tanpa masalah menghalangi; kode keluar CLI", async () => {
    const r = await checkLettersReadiness();
    const flag = r.checks.find((c) => c.key === "flag")!;
    expect(flag.severity).toBe(ON ? "OK" : "WARN");
    if (!ON) { expect(flag.detail).toMatch(/Surat tugas BARU tidak dapat dibuat/); expect(flag.fix).toMatch(/LETTERS_MODULE_ENABLED=true/); }
    expect(r.canCreateAssignments).toBe(ON && r.errors === 0);
    expect(exitCodeFor(r, false)).toBe(r.errors > 0 ? 1 : 0);
    expect(exitCodeFor(r, true)).toBe(r.errors > 0 || r.warnings > 0 ? 1 : 0);
    expect(r.checks.find((c) => c.key === "worker")?.severity).toBe("OK");
  });

  it("memeriksa prasyarat: HR belum tertaut karyawan, cap & tanda tangan Direktur belum ada, kop belum lengkap → peringatan yang menyebut akunnya; jenis dinonaktifkan → ERROR; uji mesin PDF berhasil", async () => {
    const e = await prisma.user.create({ data: { email: "hr-lepas@uji.test", name: "HR Lepas", role: "HR_ADMIN", passwordHash: "x" } });
    expect(e.id).toBeTruthy();
    await prisma.companySettings.upsert({ where: { id: 1 }, update: { address: null, phone: null, email: null, slipSignerName: null }, create: { id: 1, name: "Trilogika Edutama" } });
    await listTypes(direktur).catch(() => undefined);                      // modul mati: tidak membuat jenis; baris di bawah menyisipkannya
    if (!(await prisma.letterType.findFirst({ where: { kind: "TUGAS" } }))) await prisma.letterType.create({ data: { series: "INT", code: 2, kind: "TUGAS", name: "Surat Tugas", templateBody: { type: "doc", content: [] }, directorOnly: false, hrCanSign: true, signerJobLevels: ["MANAGER"] } });
    const r = await checkLettersReadiness({ renderTest: true });
    const by = (k: string) => r.checks.find((c) => c.key === k)!;
    expect(by("creators")).toMatchObject({ severity: "WARN" });
    expect(by("creators").detail).toContain("HR Lepas");
    expect(by("letterhead").severity).toBe("WARN");
    expect(by("stamp").severity).toBe("WARN");
    expect(by("signature").severity).toBe("WARN");
    expect(by("receipt").severity).toBe("WARN");
    expect(by("pdf")).toMatchObject({ severity: "OK" });
    await prisma.letterType.updateMany({ where: { kind: "TUGAS" }, data: { isActive: false } });
    const r2 = await checkLettersReadiness();
    expect(r2.checks.find((c) => c.key === "type")).toMatchObject({ severity: "ERROR" });
    expect(r2.ok).toBe(false);
    expect(r2.canCreateAssignments).toBe(false);
    expect(exitCodeFor(r2, false)).toBe(1);
  });
});
