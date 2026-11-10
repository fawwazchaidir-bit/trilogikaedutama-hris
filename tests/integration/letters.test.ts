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
import { createLetter, updateLetter, submitLetter, approveLetter, returnLetter, rejectLetter, cancelLetter, withdrawLetter, getLetter, listLetters, letterPdf, cosignLetter, pendingReviewCount, uploadArchiveFile } from "@/server/services/letters/documents";
import { listTypes, listSigners, updateTypePolicy } from "@/server/services/letters/types";
import { assertCanSetSignature, setCounterOffset } from "@/server/services/letters/admin";
import { verifyByToken } from "@/server/services/letters/public";
import { doc, p } from "@/lib/documents/builders";
import { PDFDocument } from "pdf-lib";
import { addEditorAttachment, deleteAttachment, updateAttachment, uploadAttachment } from "@/server/services/letters/attachments";

let direktur: Actor, manajer: Actor, staf: Actor, staf2: Actor, magang: Actor, hr: Actor;
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
  hr = await makeUser("hr@uji.test", "HR Uji", "HR_ADMIN", (await emp("H-1", "HR Uji", "HR Officer")).id);
  magang = await makeUser("mag@uji.test", "Magang Uji", "EMPLOYEE", (await emp("I-1", "Magang Uji", "Magang", { employmentStatus: "INTERN" })).id);
});

describe("jenis & penandatangan", () => {
  it("jenis bawaan tersemai; Magang hanya melihat yang diizinkan", async () => {
    const all = await listTypes(staf);
    expect(all.map((t) => `${t.series}-${t.codeText}`)).toEqual(expect.arrayContaining(["EKS-001", "EKS-002", "EKS-003", "EKS-013", "INT-001", "INT-011"]));
    const mg = await listTypes(magang);
    expect(mg.map((t) => `${t.series}-${t.codeText}`)).toEqual(["EKS-011"]);
    expect(all.length).toBe(23); // Surat Tugas (INT-002) hanya terlihat bagi HR/Direktur
    expect((await listTypes(direktur)).length).toBe(24);
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

  it("nomor urut per seri & tahun (EKS dan INT terpisah), tanpa lubang; persetujuan serentak tidak menghasilkan nomor ganda", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = await draftReady(staf, manajer);
      await updateLetter(staf, d.id, { body: doc(p(`Isi ${i}`)) });
      await submitLetter(staf, d.id); ids.push(d.id);
    }
    const res = await Promise.all(ids.map((id) => approveLetter(manajer, id)));
    const seqs = res.map((r) => Number(r.number!.split("/")[0])).sort((a, b) => a - b);
    expect(seqs).toEqual([1, 2, 3, 4]);
    // seri INT punya urutan sendiri (tidak dicampur dengan EKS)
    const sk = await draftReady(staf, direktur, { series: "INT", code: 1 });
    await updateLetter(staf, sk.id, { body: doc(p("Isi SK final.")), variables: {} });
    await submitLetter(staf, sk.id);
    expect((await approveLetter(direktur, sk.id)).number).toMatch(/^001\/TE-INT\/001\//);
  });

  it("offset arsip: lanjut dari nomor terakhir; tidak boleh diturunkan", async () => {
    const yr = Number(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }).slice(0, 4));
    await setCounterOffset(direktur, { series: "EKS", year: yr, lastSeq: 80 });
    expect(await fail(setCounterOffset(direktur, { series: "EKS", year: yr, lastSeq: 10 }))).toMatchObject(VALIDATION);
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

describe("tahap 2a: HR penandatangan, surat Rahasia, multi-penandatangan, tanda tangan pribadi", () => {
  const publish = async (creator: Actor, id: string, signer: Actor, body = "Isi final.") => {
    await updateLetter(creator, id, { body: doc(p(body)) }); await submitLetter(creator, id); return approveLetter(signer, id);
  };

  it("HR boleh menandatangani INT-007/010/011 saja; tidak boleh EKS atau INT lain", async () => {
    for (const code of [7, 10, 11]) expect((await listSigners(staf, (await typeOf("INT", code)).id)).map((x) => x.userId)).toContain(hr.userId);
    for (const [series, code] of [["EKS", 3], ["INT", 3], ["INT", 6]] as const) expect((await listSigners(staf, (await typeOf(series, code)).id)).map((x) => x.userId)).not.toContain(hr.userId);
    const d = await draftReady(staf, hr, { series: "INT", code: 11 });
    expect((await publish(staf, d.id, hr)).number).toMatch(/^001\/TE-INT\/011\//);
  });

  it("nomor EKS dan INT dipisah (masing-masing 001 pada tahun yang sama)", async () => {
    const a = await draftReady(staf, manajer); const eks = await publish(staf, a.id, manajer);
    const b = await draftReady(staf, direktur, { series: "INT", code: 1 }); const int = await publish(staf, b.id, direktur);
    expect(eks.number!.split("/")[0]).toBe("001"); expect(int.number!.split("/")[0]).toBe("001");
  });

  it("surat Rahasia: hanya pembuat/penandatangan/Direktur; HR hanya INT-010; perihal tak tampil di verifikasi; pembukaan Direktur diaudit", async () => {
    const eval9 = await draftReady(staf, manajer, { series: "INT", code: 9 });
    expect((await getLetter(staf, eval9.id)).confidential).toBe(true);
    expect(await fail(getLetter(hr, eval9.id))).toMatchObject(NOT_FOUND);
    expect(await fail(getLetter(staf2, eval9.id))).toMatchObject(NOT_FOUND);
    await getLetter(direktur, eval9.id);
    expect(await prisma.auditLog.count({ where: { action: "letter.view_confidential", entityId: eval9.id } })).toBe(1);
    await getLetter(staf, eval9.id); // pembuat membuka sendiri: tidak diaudit
    expect(await prisma.auditLog.count({ where: { action: "letter.view_confidential", entityId: eval9.id } })).toBe(1);
    const ket = await draftReady(staf, direktur, { series: "INT", code: 10 });
    expect((await getLetter(hr, ket.id)).id).toBe(ket.id); // HR boleh melihat keterangan kerja
    expect((await listLetters(hr, { scope: "all" })).items.map((x) => x.id)).toEqual([ket.id]);
    const out = await publish(staf, ket.id, direktur, "Isi surat keterangan.");
    const tok = (await prisma.letterDocument.findUniqueOrThrow({ where: { id: ket.id } })).verifyToken;
    const v = await verifyByToken(tok);
    expect(v?.state).toBe("VALID"); expect(v?.subject).toBeNull(); expect(out.number).toBeTruthy();
    // notifikasi tidak membocorkan perihal
    const n = await prisma.notification.findFirst({ where: { type: "letter.issued" } });
    expect(n?.body).not.toContain("Permohonan uji");
  });

  it("berita acara multi-penandatangan: pihak internal wajib menandatangani dulu; slot mitra luar kosong; hanya jenis multiSigner", async () => {
    expect(await fail(updateLetter(staf, (await draftReady(staf, manajer)).id, { signatories: [{ kind: "EXTERNAL", name: "X" }] }))).toMatchObject(VALIDATION);
    const ba = await draftReady(staf, manajer, { series: "EKS", code: 13 });
    expect(await fail(updateLetter(staf, ba.id, { signatories: [{ kind: "INTERNAL", userId: magang.userId }] }))).toMatchObject(VALIDATION);
    expect(await fail(updateLetter(staf, ba.id, { signatories: [{ kind: "INTERNAL", userId: manajer.userId }] }))).toMatchObject(VALIDATION); // sama dgn penandatangan utama
    expect(await fail(updateLetter(staf, ba.id, { signatories: [{ kind: "EXTERNAL", name: "" }] }))).toMatchObject(VALIDATION);
    const d = await updateLetter(staf, ba.id, { body: doc(p("Isi final BA.")), signatories: [{ kind: "INTERNAL", userId: staf2.userId }, { kind: "EXTERNAL", name: "Ibu Mitra", title: "Kepala SPPG", org: "SPPG Contoh" }] });
    expect(d.signatories.map((x) => x.kind)).toEqual(["INTERNAL", "EXTERNAL"]);
    await submitLetter(staf, ba.id);
    expect(await pendingReviewCount(staf2)).toBe(1); // penandatangan tambahan melihat antreannya
    expect((await getLetter(staf2, ba.id)).can.cosign).toBe(true);
    expect(await fail(approveLetter(manajer, ba.id))).toMatchObject(CONFLICT); // belum lengkap
    expect(await fail(cosignLetter(manajer, ba.id))).toMatchObject(FORBIDDEN);
    expect(await fail(cosignLetter(staf, ba.id))).toMatchObject(FORBIDDEN);
    await cosignLetter(staf2, ba.id);
    expect(await fail(cosignLetter(staf2, ba.id))).toMatchObject(CONFLICT);
    const out = await approveLetter(manajer, ba.id);
    expect(out.status).toBe("ISSUED");
    expect(out.signatories.find((x) => x.kind === "EXTERNAL")).toMatchObject({ name: "Ibu Mitra", org: "SPPG Contoh" });
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: ba.id } });
    expect(createHash("sha256").update((await prisma.storedFile.findUniqueOrThrow({ where: { id: row.pdfFileId! } })).data).digest("hex")).toBe(row.pdfSha256);
    // terkunci oleh database setelah terbit
    await expect(prisma.$executeRaw`DELETE FROM letter_signatories WHERE "documentId" = ${ba.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE letter_signatories SET name = 'x' WHERE "documentId" = ${ba.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
  });

  it("tanda tangan pribadi: Direktur untuk siapa saja; Manajer untuk dirinya; staf tidak; tidak untuk orang lain", async () => {
    await assertCanSetSignature(direktur, staf.userId);
    await assertCanSetSignature(manajer, manajer.userId);
    await assertCanSetSignature(hr, hr.userId);
    expect(await fail(assertCanSetSignature(manajer, direktur.userId))).toMatchObject(FORBIDDEN);
    expect(await fail(assertCanSetSignature(staf, staf.userId))).toMatchObject(FORBIDDEN);
    expect(await fail(assertCanSetSignature(magang, magang.userId))).toMatchObject(FORBIDDEN);
  });
});

const pdfOf = async (pages: number) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([595, 842]); return new Uint8Array(await d.save()); };
const pageCount = async (bytes: Uint8Array | Buffer) => (await PDFDocument.load(bytes)).getPageCount();
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");

describe("tahap 2b: lampiran", () => {
  it("lampiran editor + PDF digabung + PDF terpisah: halaman PDF bertambah sesuai, hash tercatat, verifikasi publik mencantumkan hash lampiran", async () => {
    const d = await draftReady(staf, manajer);
    await updateLetter(staf, d.id, { body: doc(p("Isi final dengan lampiran.")) });
    const base = await pageCount((await letterPdf(staf, d.id)).bytes);
    const ed = await addEditorAttachment(staf, d.id, { title: "Rincian Investasi" });
    await updateAttachment(staf, d.id, ed.id, { body: doc(p("Isi lampiran editor.")) });
    const merged = await uploadAttachment(staf, d.id, { title: "Proposal Lengkap", mode: "MERGED", name: "proposal.pdf", bytes: await pdfOf(3) });
    const sep = await uploadAttachment(staf, d.id, { title: "Profil Lembaga", mode: "SEPARATE", name: "profil.pdf", bytes: await pdfOf(2) });
    expect([ed.kind, merged.kind, sep.kind]).toEqual(["EDITOR", "UPLOAD_MERGED", "UPLOAD_SEPARATE"]);
    expect(await pageCount((await letterPdf(staf, d.id)).bytes)).toBe(base + 1 + 3); // +1 halaman lampiran editor, +3 PDF digabung; terpisah tidak ikut
    await submitLetter(staf, d.id);
    const out = await approveLetter(manajer, d.id);
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: d.id } });
    const file = await prisma.storedFile.findUniqueOrThrow({ where: { id: row.pdfFileId! } });
    expect(await pageCount(file.data)).toBe(base + 4);
    expect(sha(file.data)).toBe(row.pdfSha256);
    expect(out.attachments.map((a) => a.title)).toEqual(["Rincian Investasi", "Proposal Lengkap", "Profil Lembaga"]);
    const v = await verifyByToken(row.verifyToken);
    expect(v?.attachments.map((a) => [a.title, a.mode])).toEqual([["Proposal Lengkap", "MERGED"], ["Profil Lembaga", "SEPARATE"]]);
    expect(v?.attachments[1]?.sha256).toBe(sep.sha256);
    // terkunci sejak diajukan
    expect(await fail(deleteAttachment(staf, d.id, merged.id))).toMatchObject(CONFLICT);
    await expect(prisma.$executeRaw`UPDATE letter_attachments SET title = 'x' WHERE id = ${merged.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    // berkas lampiran hanya terbuka bagi yang melihat surat (anti-IDOR)
    const { canReadLetterPdf } = await import("@/server/services/letters/access");
    expect(await canReadLetterPdf(staf, merged.fileId!)).toBe(true);
    expect(await canReadLetterPdf(staf2, merged.fileId!)).toBe(false);
  });

  it("menolak: bukan PDF, PDF rusak, bukan pembuat, status terkunci, lebih dari batas; mengganti mode & judul", async () => {
    const d = await draftReady(staf, manajer);
    expect(await fail(uploadAttachment(staf, d.id, { title: "Rusak", mode: "MERGED", name: "x.pdf", bytes: new TextEncoder().encode("%PDF-1.4 bukan pdf sungguhan") }))).toMatchObject(VALIDATION);
    expect(await fail(uploadAttachment(staf, d.id, { title: "Teks", mode: "MERGED", name: "x.pdf", bytes: new TextEncoder().encode("halo dunia") }))).toMatchObject(VALIDATION);
    expect(await fail(uploadAttachment(manajer, d.id, { title: "Bukan pembuat", mode: "MERGED", name: "x.pdf", bytes: await pdfOf(1) }))).toMatchObject(FORBIDDEN);
    expect(await fail(uploadAttachment(staf, d.id, { title: "x", mode: "MERGED", name: "x.pdf", bytes: await pdfOf(1) }))).toMatchObject(VALIDATION); // judul terlalu pendek
    const a = await uploadAttachment(staf, d.id, { title: "Lampiran A", mode: "MERGED", name: "a.pdf", bytes: await pdfOf(1) });
    expect((await updateAttachment(staf, d.id, a.id, { mode: "SEPARATE", title: "Lampiran A (terpisah)" })).kind).toBe("UPLOAD_SEPARATE");
    expect(await fail(updateAttachment(staf, d.id, a.id, { body: doc(p("x")) }))).toMatchObject(VALIDATION); // hanya lampiran editor yang punya isi
    for (let i = 0; i < 9; i++) await addEditorAttachment(staf, d.id, { title: `Lampiran ${i + 2}` });
    expect(await fail(addEditorAttachment(staf, d.id, { title: "Kesebelas" }))).toMatchObject(VALIDATION);
    expect(await fail(getLetter(staf2, d.id))).toMatchObject(NOT_FOUND);
  });
});

describe("tahap 2b: mode arsip-saja (surat dibuat di luar portal)", () => {
  it("mesin hanya memberi nomor; PDF pindaian diunggah sesudah terbit sekali saja; verifikasi menampilkan hash setelah diunggah", async () => {
    const type = await typeOf("EKS", 12);
    const a = await createLetter(staf, { typeId: type.id, archiveOnly: true });
    expect(a.archiveOnly).toBe(true);
    expect(await fail(addEditorAttachment(staf, a.id, { title: "Lampiran" }))).toMatchObject(VALIDATION);
    expect(await fail(submitLetter(staf, a.id))).toMatchObject(VALIDATION); // perihal & penandatangan wajib
    await updateLetter(staf, a.id, { subject: "MoU dengan Mitra Contoh", signerId: direktur.userId });
    expect(await fail(letterPdf(staf, a.id))).toMatchObject(CONFLICT); // tidak ada pratinjau
    await submitLetter(staf, a.id);
    const out = await approveLetter(direktur, a.id);
    expect(out.status).toBe("ISSUED"); expect(out.number).toMatch(/^001\/TE-EKS\/012\//); expect(out.hasPdf).toBe(false);
    expect(out.can.uploadArchive).toBe(true); // Direktur/penandatangan/pembuat boleh mengunggah pindaian
    const tok = (await prisma.letterDocument.findUniqueOrThrow({ where: { id: a.id } })).verifyToken;
    const v0 = await verifyByToken(tok);
    expect(v0).toMatchObject({ state: "VALID", archiveOnly: true, sha256: null });
    const scan = await pdfOf(2);
    expect(await fail(uploadArchiveFile(staf2, a.id, { name: "scan.pdf", bytes: scan }))).toMatchObject(NOT_FOUND);
    expect(await fail(uploadArchiveFile(staf, a.id, { name: "scan.pdf", bytes: new TextEncoder().encode("bukan pdf") }))).toBeTruthy();
    const done = await uploadArchiveFile(staf, a.id, { name: "scan.pdf", bytes: scan });
    expect(done.hasPdf).toBe(true);
    expect((await verifyByToken(tok))?.sha256).toBe(sha(scan));
    expect((await letterPdf(staf, a.id)).bytes.length).toBe(scan.length);
    expect(await fail(uploadArchiveFile(staf, a.id, { name: "scan2.pdf", bytes: await pdfOf(1) }))).toMatchObject(CONFLICT);
    await expect(prisma.$executeRaw`UPDATE letter_documents SET "pdfSha256" = 'x' WHERE id = ${a.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    // nomor arsip memakai urutan seri yang sama (tanpa lubang): surat berikutnya = 002
    const b = await draftReady(staf, manajer);
    await updateLetter(staf, b.id, { body: doc(p("Isi final.")) }); await submitLetter(staf, b.id);
    expect((await approveLetter(manajer, b.id)).number).toMatch(/^002\/TE-EKS\/003\//);
  });
});
