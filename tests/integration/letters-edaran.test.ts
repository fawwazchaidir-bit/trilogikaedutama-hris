/**
 * Surat Edaran (INT-005, layout EDARAN) di basis data: jenis lama (SURAT) diselaraskan ke EDARAN beserta templatnya tanpa mengubah surat yang sudah ada; surat dapat diajukan
 * TANPA penerima; judul TENTANG diambil dari kolom Perihal (huruf besar); bingkai PDF tanpa blok surat; surat biasa tetap berbingkai SURAT dengan kop tiga baris.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter, getLetter, letterPdf, submitLetter, updateLetter } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { buildFrame } from "@/server/services/letters/frame";
import { docText, type PmDoc, type PmNode } from "@/lib/documents/content";
import { doc, p } from "@/lib/documents/builders";

let direktur: Actor, manajer: Actor, staf: Actor;
const fail = async (pr: Promise<unknown>) => { try { await pr; return null; } catch (e) { return e as AppError; } };
async function emp(no: string, name: string, position: string, extra: Record<string, unknown> = {}) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT", ...extra } as never });
}
const typeOf = async (code: number, series: "EKS" | "INT" = "INT") => { await listTypes(direktur); return prisma.letterType.findFirstOrThrow({ where: { series, code } }); };
/** Ganti teks panduan [..] pada templat dengan isi nyata (bagian lain, termasuk variabel, dipertahankan). */
const fill = (d: PmDoc): PmDoc => {
  const w = (n: PmNode): PmNode => (n.type === "text" ? { ...n, text: (n.text ?? "").replace(/\[[^\]]+\]/g, "isi uji") } : n.content ? { ...n, content: n.content.map(w) } : n);
  return { type: "doc", content: d.content.map(w) };
};

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur Uji", "SUPER_ADMIN", (await emp("D-1", "Direktur Uji", "Direktur Utama")).id);
  manajer = await makeUser("mgr@uji.test", "Manajer Uji", "EMPLOYEE", (await emp("M-1", "Manajer Uji", "Manajer Operasional", { jobLevel: "MANAGER" })).id);
  staf = await makeUser("staf@uji.test", "Staf Uji", "EMPLOYEE", (await emp("S-1", "Staf Uji", "Staf Admisi")).id);
});

describe("jenis Surat Edaran", () => {
  it("jenis bawaan berlayout EDARAN; surat baru memakai templat Memo Internal tanpa salam/penutup", async () => {
    const t = (await listTypes(staf)).find((x) => x.series === "INT" && x.code === 5)!;
    expect(t.kind).toBe("EDARAN");
    const d = await createLetter(staf, { typeId: t.id });
    expect(d.kind).toBe("EDARAN");
    expect(d.salutation).toBeNull();
    expect(d.closing).toBeNull();
    expect(docText(d.body as unknown as PmDoc)).toContain("MEMO INTERNAL");
  });

  it("jenis lama (SURAT + templat generik) diselaraskan ke EDARAN beserta templat baru; surat yang sudah dibuat TIDAK berubah", async () => {
    const t = await typeOf(5);
    // surat dibuat lebih dulu, lalu basis data dikembalikan ke keadaan SEBELUM pembaruan: jenis berlayout SURAT + templat generik + salam, draf lama berisi templat generik
    const old = await createLetter(staf, { typeId: t.id });
    const legacy = doc(p("[isi surat]"), p("Demikian untuk dilaksanakan sebagaimana mestinya."));
    await prisma.letterType.update({ where: { id: t.id }, data: { kind: "SURAT", templateBody: legacy as object, defaultSalutation: "Dengan Hormat," } });
    await prisma.letterDocument.update({ where: { id: old.id }, data: { body: legacy as object, salutation: "Dengan Hormat," } });

    await listTypes(direktur); // pemicu penyelarasan katalog (ensureDefaultTypes)
    const after = await prisma.letterType.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.kind).toBe("EDARAN");
    expect(after.defaultSalutation).toBeNull();
    expect(docText(after.templateBody as unknown as PmDoc)).toContain("MEMO INTERNAL");
    // draf lama memegang salinan isinya sendiri
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: old.id } });
    expect(docText(row.body as unknown as PmDoc)).toContain("[isi surat]");
    expect(row.salutation).toBe("Dengan Hormat,");
  });

  it("surat edaran diajukan TANPA penerima; Perihal tetap wajib; teks panduan [..] masih memblokir", async () => {
    const t = await typeOf(5);
    const d = await createLetter(staf, { typeId: t.id });
    // belum ada perihal, penandatangan, dan isi → ditolak, tetapi BUKAN karena penerima
    const e1 = await fail(submitLetter(staf, d.id));
    expect(e1).toMatchObject({ code: "VALIDATION" });
    expect(e1!.fieldErrors).toHaveProperty("subject");
    expect(e1!.fieldErrors).not.toHaveProperty("recipientLines");
    // perihal + penandatangan terisi tetapi templat belum diganti → masih ditolak karena teks panduan
    await updateLetter(staf, d.id, { subject: "Penyesuaian jam kerja Ramadhan", signerId: manajer.userId });
    const e2 = await fail(submitLetter(staf, d.id));
    expect(e2!.fieldErrors).toHaveProperty("body");
    expect(e2!.fieldErrors).not.toHaveProperty("recipientLines");
    // isi lengkap → terkirim
    const cur = await getLetter(staf, d.id);
    await updateLetter(staf, d.id, { body: fill(cur.body as unknown as PmDoc) });
    expect((await submitLetter(staf, d.id)).status).toBe("IN_REVIEW");
  });

  it("bingkai PDF: layout EDARAN tanpa blok surat; TENTANG memakai Perihal huruf besar; nomor tampil sebagai [nomor terisi saat terbit] pada draf", async () => {
    const t = await typeOf(5);
    const d = await createLetter(staf, { typeId: t.id });
    await updateLetter(staf, d.id, { subject: "Penyesuaian jam kerja Ramadhan", signerId: manajer.userId, body: fill(d.body as unknown as PmDoc), recipientLines: ["Diabaikan"], salutation: "Diabaikan," });
    const row = await prisma.letterDocument.findUniqueOrThrow({ where: { id: d.id }, include: { type: true } });
    const { frame, missing } = await buildFrame(row, { number: null, date: "2026-02-10", signerUserId: manajer.userId, draft: true });
    expect(missing).toEqual([]);
    expect(frame.kind).toBe("EDARAN");
    expect(frame.recipient).toBeNull();
    expect(frame.subject).toBeNull();
    expect(frame.salutation).toBeNull();
    expect(frame.closing).toBeNull();
    expect(frame.attachmentText).toBeNull();
    const text = docText(frame.body);
    expect(text).toContain("PENYESUAIAN JAM KERJA RAMADHAN");
    expect(text).toContain("[nomor terisi saat terbit]");
    expect(text).not.toMatch(/\{\{|\[perihal\]/);
    // pada surat terbit nomor sungguhan masuk ke judul
    const issued = await buildFrame(row, { number: "001/TE-INT/005/II/2026", date: "2026-02-10", signerUserId: manajer.userId, draft: false });
    expect(docText(issued.frame.body)).toMatch(/Nomor :\s+001\/TE-INT\/005\/II\/2026/);
    // kop: tiga baris (tagline, nama, alamat) — tanpa baris kontak/identitas
    expect(Object.keys(frame.letterhead).sort()).toEqual(["addressLines", "logo", "name", "tagline"]);
  });

  it("pratinjau PDF surat edaran berhasil dirender (satu halaman); surat biasa tetap berbingkai SURAT dengan penerima", async () => {
    const t = await typeOf(5);
    const d = await createLetter(staf, { typeId: t.id });
    await updateLetter(staf, d.id, { subject: "Penyesuaian jam kerja Ramadhan", signerId: manajer.userId, body: fill(d.body as unknown as PmDoc) });
    const pdf = await letterPdf(staf, d.id);
    expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);

    const t3 = await typeOf(3, "EKS");
    const s = await createLetter(staf, { typeId: t3.id });
    await updateLetter(staf, s.id, { subject: "Permohonan narasumber", recipientLines: ["Bapak Uji", "PT Contoh"], signerId: manajer.userId });
    const srow = await prisma.letterDocument.findUniqueOrThrow({ where: { id: s.id }, include: { type: true } });
    const sf = (await buildFrame(srow, { number: null, date: "2026-02-10", signerUserId: manajer.userId, draft: true })).frame;
    expect(sf.kind).toBe("SURAT");
    expect(sf.recipient?.lines.map((l) => l.text)).toEqual(["Bapak Uji", "PT Contoh"]);
    expect(sf.subject).toBe("Permohonan narasumber");
    expect(sf.salutation).toBe("Dengan Hormat,");
  });
});
