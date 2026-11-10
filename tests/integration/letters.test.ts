/**
 * Persuratan tahap 1: siklus (draf → diajukan → terbit), penomoran atomik (nomor master 001/TE-EKS/003/I/2026), PDF terkunci + hash,
 * kewenangan penandatangan (per jenis, bukan diri sendiri, Magang), eskalasi Direktur, anti-IDOR, verifikasi publik, penjaga database.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter, updateLetter, submitLetter, approveLetter, returnLetter, rejectLetter, cancelLetter, withdrawLetter, getLetter, listLetters, letterPdf } from "@/server/services/letters/documents";
import { listTypes, listSigners, updateTypePolicy } from "@/server/services/letters/types";
import { setCounterOffset } from "@/server/services/letters/admin";
import { verifyByToken } from "@/server/services/letters/public";
import { doc, p } from "@/lib/documents/builders";

let direktur: Actor, manajer: Actor, staf: Actor, staf2: Actor, magang: Actor;
const fail = async (pr: Promise<unknown>) => { try { await pr; return null; } catch (e) { return e as AppError; } };
const FORBIDDEN = { code: "FORBIDDEN" }, NOT_FOUND = { code: "NOT_FOUND" }, VALIDATION = { code: "VALIDATION" }, CONFLICT = { code: "CONFLICT" };

async function emp(no: string, name: string, position: string, extra: Record<string, unknown> = {}) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT", ...extra } as never });
}
const body = doc(p("Isi surat uji yang lengkap.", { textAlign: "justify" }));
const complete = { subject: "Permohonan uji", recipientLines: ["Bapak Penerima Uji", "PT Contoh"], body };

async function typeOf(series: "EKS" | "INT", code: number) { await listTypes(direktur); return prisma.letterType.findFirstOrThrow({ where: { series, code } }); }
async function draftReady(creator: Actor, signer: Actor, t: { series: "EKS" | "INT"; code: number } = { series: "EKS", code: 3 }) {
  const type = await typeOf(t.series, t.code);
  const d = await createLetter(creator, { typeId: type.id });
  return updateLetter(creator, d.id, { ...complete, signerId: signer.userId });
}

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur Uji", "SUPER_ADMIN", (await emp("D-1", "Direktur Uji", "Direktur Utama")).id);
  manajer = await makeUser("mgr@uji.test", "Manajer Uji", "EMPLOYEE", (await emp("M-1", "Manajer Uji", "Manajer Pemasaran", { jobLevel: "MANAGER" })).id);
  staf = await makeUser("staf@uji.test", "Staf Uji", "EMPLOYEE", (await emp("S-1", "Staf Uji", "Staf Admisi")).id);
  staf2 = await makeUser("staf2@uji.test", "Staf Dua", "EMPLOYEE", (await emp("S-2", "Staf Dua", "Staf Sosmed")).id);
  magang = await makeUser("mag@uji.test", "Magang Uji", "EMPLOYEE", (await emp("I-1", "Magang Uji", "Magang", { employmentStatus: "INTERN" })).id);
});

describe("jenis & penandatangan", () => {
  it("jenis bawaan tersemai; Magang hanya melihat yang diizinkan", async () => {
    const all = await listTypes(staf);
    expect(all.map((t) => `${t.series}-${t.codeText}`)).toEqual(expect.arrayContaining(["EKS-001", "EKS-002", "EKS-003", "EKS-013", "INT-001", "INT-011"]));
    const mg = await listTypes(magang);
    expect(mg.map((t) => `${t.series}-${t.codeText}`)).toEqual(["EKS-011"]);
    expect(all.length).toBe(24);
  });
  it("penandatangan sesuai kebijakan: SK hanya Direktur; surat eksternal Direktur + Manajer; bukan diri sendiri; Magang tidak pernah", async () => {
    const sk = await typeOf("INT", 1);
    expect((await listSigners(staf, sk.id)).map((s) => s.userId)).toEqual([direktur.userId]);
    const eks = await typeOf("EKS", 3);
    expect((await listSigners(staf, eks.id)).map((s) => s.userId).sort()).toEqual([direktur.userId, manajer.userId].sort());
    const undangan = await typeOf("EKS", 6); // Direktur saja menurut Register
    expect((await listSigners(staf, undangan.id)).map((s) => s.userId)).toEqual([direktur.userId]);
    expect((await listSigners(manajer, eks.id)).map((s) => s.userId)).toEqual([direktur.userId]);
  });
  it("kebijakan jenis diubah Direktur saja", async () => {
    const t = await typeOf("EKS", 3);
    expect(await fail(updateTypePolicy(manajer, t.id, { directorOnly: true }))).toMatchObject(FORBIDDEN);
    expect((await updateTypePolicy(direktur, t.id, { directorOnly: true })).directorOnly).toBe(true);
    expect((await listSigners(staf, t.id)).map((s) => s.userId)).toEqual([direktur.userId]);
  });
  it("Magang tidak dapat membuat jenis di luar yang diizinkan", async () => {
    const t = await typeOf("EKS", 3);
    expect(await fail(createLetter(magang, { typeId: t.id }))).toMatchObject(FORBIDDEN);
  });
});

describe("siklus: draf → diajukan → terbit", () => {
  it("staf membuat, memilih Manajer; manajer menyetujui → nomor master, PDF terkunci + hash, QR token", async () => {
    const d = await draftReady(staf, manajer);
    expect(d.status).toBe("DRAFT");
    // Templat yang masih berisi teks panduan [..] → ajukan diblok
    const tpl = await createLetter(staf, { typeId: (await typeOf("EKS", 3)).id });
    await updateLetter(staf, tpl.id, { subject: "Uji", recipientLines: ["Penerima"], signerId: manajer.userId });
    expect(await fail(submitLetter(staf, tpl.id))).toMatchObject(VALIDATION);
    await updateLetter(staf, d.id, { body: doc(p("Isi final tanpa kurung siku.")) });
    const sub = await submitLetter(staf, d.id);
    expect(sub.status).toBe("IN_REVIEW");
    const out = await approveLetter(manajer, d.id);
    const yy = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 4);
    expect(out.status).toBe("ISSUED");
    expect(out.number).toMatch(new RegExp(`^001/TE-EKS/003/(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)/${yy}$`));
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: d.id } });
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: row.pdfFileId! } });
    expect(file.kind).toBe("LETTER_PDF");
    expect(Buffer.from(file.data).subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(file.data).digest("hex")).toBe(row.pdfSha256);
    const pdf = await letterPdf(staf, d.id);
    expect(createHash("sha256").update(pdf.bytes).digest("hex")).toBe(row.pdfSha256);
    expect(out.events.map((e) => e.action)).toEqual(["CREATED", "SUBMITTED", "ISSUED"]);
  });

  it("nomor urut GLOBAL per tahun (lintas seri), tanpa lubang; persetujuan serentak tidak menghasilkan nomor ganda", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = await draftReady(staf, manajer);
      await updateLetter(staf, d.id, { body: doc(p(`Isi ${i}`)) });
      await submitLetter(staf, d.id); ids.push(d.id);
    }
    const res = await Promise.all(ids.map((id) => approveLetter(manajer, id)));
    const seqs = res.map((r) => Number(r.number!.split("/")[0])).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4]);
    // urutan GLOBAL: seri INT melanjutkan setelah EKS (bukan mulai dari 001 lagi)
    const sk = await draftReady(staf, direktur, { series: "INT", code: 1 });
    await updateLetter(staf, sk.id, { body: doc(p("Isi SK final.")), variables: {} });
    await submitLetter(staf, sk.id);
    expect((await approveLetter(direktur, sk.id)).number).toMatch(/^005\/TE-INT\/001\//);
  });

  it("offset arsip: lanjut dari nomor terakhir; tidak boleh diturunkan", async () => {
    const yr = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 4));
    await setCounterOffset(direktur, { year: yr, lastSeq: 80 });
    expect(await fail(setCounterOffset(direktur, { year: yr, lastSeq: 10 }))).toMatchObject(VALIDATION);
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, d.id);
    expect((await approveLetter(manajer, d.id)).number).toMatch(/^081\/TE-EKS\/003\//);
  });

  it("nomor tidak terpakai bila penerbitan gagal (rollback)", async () => {
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, d.id);
    await prisma.user.update({ where: { id: manajer.userId }, data: { isActive: false } });
    expect(await fail(approveLetter(manajer, d.id))).toBeTruthy();
    await prisma.user.update({ where: { id: manajer.userId }, data: { isActive: true } });
    expect((await approveLetter(manajer, d.id)).number).toMatch(/^001\//);
  });

  it("dikembalikan → disunting → diajukan lagi; ditolak final; ditarik kembali ke draf", async () => {
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, d.id);
    expect((await withdrawLetter(staf, d.id)).status).toBe("DRAFT");
    await submitLetter(staf, d.id);
    expect(await fail(returnLetter(manajer, d.id, { note: "" }))).toMatchObject(VALIDATION);
    const r = await returnLetter(manajer, d.id, { note: "Perbaiki perihal" });
    expect(r.status).toBe("RETURNED"); expect(r.returnNote).toBe("Perbaiki perihal"); expect((await getLetter(staf, d.id)).can.edit).toBe(true);
    await updateLetter(staf, d.id, { subject: "Perihal baru" }); await submitLetter(staf, d.id);
    const rj = await rejectLetter(manajer, d.id, { note: "Tidak sesuai" });
    expect(rj.status).toBe("REJECTED");
    expect(await fail(updateLetter(staf, d.id, { subject: "x" }))).toMatchObject(CONFLICT);
  });

  it("surat terbit terkunci: tidak dapat disunting; dibatalkan dengan alasan tetap menyimpan nomor", async () => {
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, d.id);
    const out = await approveLetter(manajer, d.id);
    expect(await fail(updateLetter(staf, d.id, { subject: "ubah" }))).toMatchObject(CONFLICT);
    expect(await fail(cancelLetter(staf, d.id, { note: "salah" }))).toMatchObject(FORBIDDEN);
    const c = await cancelLetter(direktur, d.id, { note: "Salah penerima" });
    expect(c.status).toBe("CANCELLED"); expect(c.number).toBe(out.number);
  });
});

describe("kewenangan & keamanan", () => {
  it("tidak dapat memilih penandatangan yang tak berwenang atau diri sendiri; tak ada penandatangan → tak bisa diajukan", async () => {
    const t = await typeOf("EKS", 3);
    const d = await createLetter(staf, { typeId: t.id });
    expect(await fail(updateLetter(staf, d.id, { signerId: staf2.userId }))).toMatchObject(VALIDATION);
    expect(await fail(updateLetter(staf, d.id, { signerId: staf.userId }))).toMatchObject(VALIDATION);
    await updateLetter(staf, d.id, { ...complete, body: doc(p("Isi final.")) });
    expect(await fail(submitLetter(staf, d.id))).toMatchObject(VALIDATION);
  });
  it("manajer tidak dapat menyetujui surat buatannya sendiri; Direktur boleh menandatangani suratnya", async () => {
    const d = await draftReady(manajer, direktur);
    await updateLetter(manajer, d.id, { body: doc(p("Isi final.")) }); await submitLetter(manajer, d.id);
    expect(await fail(approveLetter(manajer, d.id))).toMatchObject(FORBIDDEN);
    const own = await draftReady(direktur, direktur);
    await updateLetter(direktur, own.id, { body: doc(p("Isi final.")) }); await submitLetter(direktur, own.id);
    expect((await approveLetter(direktur, own.id)).status).toBe("ISSUED");
  });
  it("anti-IDOR: pihak lain mendapat 404; hanya pembuat yang menyunting; staf lain tak bisa menyetujui", async () => {
    const d = await draftReady(staf, manajer);
    expect(await fail(getLetter(staf2, d.id))).toMatchObject(NOT_FOUND);
    expect(await fail(letterPdf(staf2, d.id))).toMatchObject(NOT_FOUND);
    expect(await fail(updateLetter(manajer, d.id, { subject: "x" }))).toMatchObject(FORBIDDEN);
    expect((await getLetter(direktur, d.id)).id).toBe(d.id);
    expect((await listLetters(staf2, { scope: "all" })).total).toBe(0);
    expect((await listLetters(direktur, { scope: "all" })).total).toBe(1);
  });
  it("eskalasi: Direktur belum boleh mengambil alih sebelum batas hari kerja; sesudahnya boleh dan menjadi penandatangan", async () => {
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, d.id);
    expect(await fail(approveLetter(direktur, d.id))).toMatchObject(FORBIDDEN);
    expect((await getLetter(direktur, d.id)).can.takeOver).toBe(false);
    // mundurkan waktu pengajuan 7 hari (lewat batas 2 hari kerja)
    await prisma.$executeRaw`UPDATE letter_documents SET "submittedAt" = now() - interval '7 days' WHERE id = ${d.id}::uuid`;
    expect((await getLetter(direktur, d.id)).can.takeOver).toBe(true);
    const out = await approveLetter(direktur, d.id);
    expect(out.status).toBe("ISSUED"); expect(out.signerId).toBe(direktur.userId);
    expect(out.events.at(-1)!.action).toBe("TAKEOVER_ISSUED");
  });
});

describe("verifikasi publik & penjaga database", () => {
  it("token tidak dikenal/draf → null; terbit → metadata saja (tanpa isi); batal → status batal", async () => {
    expect(await verifyByToken("0".repeat(32))).toBeNull();
    expect(await verifyByToken("../etc/passwd")).toBeNull();
    const d = await draftReady(staf, manajer);
    const row0 = await prisma.letterDocument.findUniqueOrThrow({ where: { id: d.id } });
    expect(await verifyByToken(row0.verifyToken)).toBeNull();
    await updateLetter(staf, d.id, { body: doc(p("RAHASIA isi surat.")) }); await submitLetter(staf, d.id);
    const out = await approveLetter(manajer, d.id);
    const v = await verifyByToken(row0.verifyToken);
    expect(v).toMatchObject({ state: "VALID", number: out.number, signerName: "Manajer Uji" });
    expect(JSON.stringify(v)).not.toContain("RAHASIA");
    await cancelLetter(direktur, d.id, { note: "Dibatalkan" });
    expect((await verifyByToken(row0.verifyToken))!.state).toBe("CANCELLED");
  });
  it("trigger: isi/nomor surat terbit tidak dapat diubah langsung di database; dokumen tidak bisa dihapus; jejak tambah-saja", async () => {
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, d.id); await approveLetter(manajer, d.id);
    await expect(prisma.$executeRaw`UPDATE letter_documents SET subject = 'x' WHERE id = ${d.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE letter_documents SET number = '999' WHERE id = ${d.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`DELETE FROM letter_documents WHERE id = ${d.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE letter_events SET note = 'x' WHERE "documentId" = ${d.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE letter_documents SET status = 'DRAFT' WHERE id = ${d.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
  });
});
