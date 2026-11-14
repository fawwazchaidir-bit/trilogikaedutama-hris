/**
 * Kop surat di basis data: isi kop (tagline/nama/alamat + email/telepon/website) dari Pengaturan lembaga, garis di bawah kop (bawaan ada; dapat ditiadakan),
 * tambalan murni, hanya Direktur, jejak audit, pemakaian di bingkai PDF surat, dan pratinjau PDF (belum tersimpan tidak mengubah apa pun).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter, updateLetter } from "@/server/services/letters/documents";
import { listTypes } from "@/server/services/letters/types";
import { getLetterSettingsDto, previewFooterPdf, updateLetterSettings } from "@/server/services/letters/admin";
import { buildFrame } from "@/server/services/letters/frame";
import { kopContactLine } from "@/lib/documents/kop";
import { pageStreams } from "../helpers/pdf-streams";

let direktur: Actor, staf: Actor, hr: Actor;
const fail = async (pr: Promise<unknown>) => { try { await pr; return null; } catch (e) { return e as AppError; } };
async function emp(no: string, name: string, position: string) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT" } as never });
}
const company = (patch: { address?: string | null; email?: string | null; phone?: string | null; website?: string | null }) =>
  prisma.companySettings.upsert({ where: { id: 1 }, update: patch, create: { id: 1, name: "Trilogika Edutama", ...patch } });

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur Uji", "SUPER_ADMIN", (await emp("D-1", "Direktur Uji", "Direktur Utama")).id);
  staf = await makeUser("staf@uji.test", "Staf Uji", "EMPLOYEE", (await emp("S-1", "Staf Uji", "Staf Admisi")).id);
  hr = await makeUser("hr@uji.test", "HR Uji", "HR_ADMIN", (await emp("H-1", "HR Uji", "HR Officer")).id);
});

describe("garis di bawah kop (pengaturan)", () => {
  it("bawaan: garis ada (perilaku sebelumnya tidak berubah)", async () => {
    expect((await getLetterSettingsDto(direktur)).kopRule).toBe(true);
  });

  it("dapat ditiadakan lalu diadakan lagi; tercatat di Audit Log dengan ringkasan yang jelas", async () => {
    await updateLetterSettings(direktur, { kopRule: false });
    expect((await getLetterSettingsDto(direktur)).kopRule).toBe(false);
    const a1 = await prisma.auditLog.findFirstOrThrow({ where: { action: "letter.settings" }, orderBy: { createdAt: "desc" } });
    expect(a1.summary).toContain("garis kop ditiadakan");
    await updateLetterSettings(direktur, { kopRule: true });
    expect((await getLetterSettingsDto(direktur)).kopRule).toBe(true);
    const a2 = await prisma.auditLog.findFirstOrThrow({ where: { action: "letter.settings" }, orderBy: { createdAt: "desc" } });
    expect(a2.summary).toContain("garis kop diadakan");
  });

  it("tambalan murni: mengubah garis kop tidak mengubah kota, kaki halaman, dst.; mengubah kaki halaman tidak mengubah garis kop", async () => {
    await updateLetterSettings(direktur, { place: "Yogyakarta", escalationDays: 5, footer: { center: "{nomor}" } });
    await updateLetterSettings(direktur, { kopRule: false });
    let dto = await getLetterSettingsDto(direktur);
    expect(dto).toMatchObject({ place: "Yogyakarta", escalationDays: 5, kopRule: false });
    expect(dto.footer.center).toBe("{nomor}");
    await updateLetterSettings(direktur, { footer: { size: 10 } });
    dto = await getLetterSettingsDto(direktur);
    expect(dto.kopRule).toBe(false);
    expect(dto.footer.size).toBe(10);
  });

  it("nilai bukan boolean ditolak (VALIDATION) dan tidak tersimpan", async () => {
    for (const v of ["ya", 1, null, "false"]) expect(await fail(updateLetterSettings(direktur, { kopRule: v })), String(v)).toMatchObject({ code: "VALIDATION" });
    expect((await getLetterSettingsDto(direktur)).kopRule).toBe(true);
  });

  it("hanya Direktur: HR dan staf ditolak (ubah, baca, pratinjau)", async () => {
    for (const a of [hr, staf]) {
      expect(await fail(updateLetterSettings(a, { kopRule: false })), "ubah").toMatchObject({ code: "FORBIDDEN" });
      expect(await fail(previewFooterPdf(a, { kopRule: false })), "pratinjau").toMatchObject({ code: "FORBIDDEN" });
      expect(await fail(getLetterSettingsDto(a)), "baca").toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await getLetterSettingsDto(direktur)).kopRule).toBe(true);
  });
});

describe("isi kop dari Pengaturan lembaga", () => {
  it("DTO memuat tagline/nama/alamat dan baris kontak (Email → Telp → Website) menurut data lembaga", async () => {
    await company({ address: "Alamat Uji 1", email: "info@lembaga.example", phone: "(0274) 555-0100", website: "www.lembaga.example" });
    const { kop } = await getLetterSettingsDto(direktur);
    expect(kop).toMatchObject({ name: "Trilogika Edutama", address: "Alamat Uji 1", email: "info@lembaga.example", phone: "(0274) 555-0100", website: "www.lembaga.example" });
    expect(kop.contactLine).toBe(kopContactLine({ email: "info@lembaga.example", phone: "(0274) 555-0100", website: "www.lembaga.example" }));
  });

  it("kontak kosong → tidak ada baris kontak (null)", async () => {
    await company({ email: null, phone: null, website: null });
    expect((await getLetterSettingsDto(direktur)).kop.contactLine).toBeNull();
  });
});

describe("pemakaian di bingkai & PDF surat", () => {
  async function draftRow() {
    await listTypes(direktur);
    const t = await prisma.letterType.findFirstOrThrow({ where: { series: "EKS", code: 3 } });
    const d = await createLetter(staf, { typeId: t.id });
    await updateLetter(staf, d.id, { subject: "Uji kop", recipientLines: ["Bapak Uji", "PT Contoh"], signerId: direktur.userId });
    return prisma.letterDocument.findUniqueOrThrow({ where: { id: d.id }, include: { type: true } });
  }
  const frameOf = async () => (await buildFrame(await draftRow(), { number: null, date: "2026-02-10", signerUserId: direktur.userId, draft: true })).frame;

  it("bingkai surat memuat baris kontak dan penanda garis dari data tersimpan", async () => {
    await company({ address: "Alamat Uji", email: "a@b.example", phone: "0274 1", website: "w.example" });
    let f = await frameOf();
    expect(f.letterhead.rule).toBe(true);
    expect(f.letterhead.contactLine).toBe(kopContactLine({ email: "a@b.example", phone: "0274 1", website: "w.example" }));
    await updateLetterSettings(direktur, { kopRule: false });
    await company({ email: null, website: null });
    f = await frameOf();
    expect(f.letterhead.rule).toBe(false);
    expect(f.letterhead.contactLine).toBe(kopContactLine({ phone: "0274 1" }));
  });

  it("pratinjau PDF memakai pengaturan yang SEDANG disunting tanpa menyimpannya (garis hilang di pratinjau, tersimpan tetap ada)", async () => {
    await company({ email: "a@b.example" });
    const strokes = async (b: Buffer) => ((await pageStreams(b))[0]!.match(/0 0 0 SCN/g) ?? []).length;
    const off = await previewFooterPdf(direktur, { kopRule: false });
    const on = await previewFooterPdf(direktur, { kopRule: true });
    expect((await PDFDocument.load(off)).getPageCount()).toBe(2);
    expect(await strokes(on)).toBeGreaterThan(await strokes(off));
    expect((await getLetterSettingsDto(direktur)).kopRule).toBe(true);                       // tidak tersimpan
    // tanpa `kopRule` di pratinjau → memakai nilai tersimpan
    await updateLetterSettings(direktur, { kopRule: false });
    expect(await strokes(await previewFooterPdf(direktur, {}))).toBe(await strokes(off));
  });

  it("kolom basis data bertipe boolean NOT NULL bawaan true (baris lama tetap bergaris)", async () => {
    await getLetterSettingsDto(direktur);
    const r = await prisma.$queryRaw<{ is_nullable: string; column_default: string }[]>`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'letter_settings' AND column_name = 'kopRule'`;
    expect(r[0]).toMatchObject({ is_nullable: "NO", column_default: "true" });
  });
});
