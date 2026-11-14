/**
 * Pengaturan kaki halaman (footer) persuratan di basis data: bawaan meniru tampilan lama, tambalan sebagian, nama lama `footerText`, validasi (font/ukuran/warna/token/panjang),
 * hanya Direktur, jejak audit, pemakaian di bingkai PDF surat, pratinjau PDF (konfigurasi belum tersimpan), dan pagar CHECK basis data.
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
import { DEFAULT_FOOTER } from "@/lib/documents/footer";

let direktur: Actor, staf: Actor, hr: Actor;
const fail = async (pr: Promise<unknown>) => { try { await pr; return null; } catch (e) { return e as AppError; } };
async function emp(no: string, name: string, position: string) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT" } as never });
}
const base = { place: "Sleman", escalationDays: 2 };

beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur Uji", "SUPER_ADMIN", (await emp("D-1", "Direktur Uji", "Direktur Utama")).id);
  staf = await makeUser("staf@uji.test", "Staf Uji", "EMPLOYEE", (await emp("S-1", "Staf Uji", "Staf Admisi")).id);
  hr = await makeUser("hr@uji.test", "HR Uji", "HR_ADMIN", (await emp("H-1", "HR Uji", "HR Officer")).id);
});

describe("pengaturan kaki halaman", () => {
  it("bawaan meniru tampilan lama: kanan \"Hal. {halaman} dari {total}\", miring, 8,5 pt, Liberation Serif; zona kiri kosong", async () => {
    expect((await getLetterSettingsDto(direktur)).footer).toEqual(DEFAULT_FOOTER);
  });

  it("tambalan sebagian: hanya bidang yang dikirim berubah; sisanya tetap", async () => {
    await updateLetterSettings(direktur, { ...base, footer: { fontKey: "CALADEA", size: 10, bold: true, center: "{nomor}", rule: true } });
    const f = (await getLetterSettingsDto(direktur)).footer;
    expect(f).toMatchObject({ fontKey: "CALADEA", size: 10, bold: true, center: "{nomor}", rule: true, italic: true, right: "Hal. {halaman} dari {total}", enabled: true, firstPage: true, attachments: true, color: "#444444" });
    await updateLetterSettings(direktur, { ...base, footer: { left: "Trilogika Edutama", firstPage: false, attachments: false, enabled: false, underline: true, color: "#112233", italic: false } });
    expect((await getLetterSettingsDto(direktur)).footer).toMatchObject({ left: "Trilogika Edutama", firstPage: false, attachments: false, enabled: false, underline: true, color: "#112233", italic: false, fontKey: "CALADEA", size: 10 });
  });

  it("tambalan murni (seperti kartu di layar): hanya `footer` dikirim → kota, baris identitas, dan batas eskalasi tidak berubah", async () => {
    await updateLetterSettings(direktur, { place: "Yogyakarta", idLine: "Baris identitas uji", escalationDays: 5 });
    await updateLetterSettings(direktur, { footer: { center: "{nomor}", size: 10 } });
    const dto = await getLetterSettingsDto(direktur);
    expect(dto).toMatchObject({ place: "Yogyakarta", idLine: "Baris identitas uji", escalationDays: 5 });
    expect(dto.footer).toMatchObject({ center: "{nomor}", size: 10 });
    // bidang yang dikirim tetap divalidasi
    expect(await fail(updateLetterSettings(direktur, { place: "X" }))).toMatchObject({ code: "VALIDATION" });
    expect(await fail(updateLetterSettings(direktur, { escalationDays: 99 }))).toMatchObject({ code: "VALIDATION" });
  });

  it("zona dapat dikosongkan (null / string kosong); kosong = tidak dicetak", async () => {
    await updateLetterSettings(direktur, { ...base, footer: { right: "", center: "   ", left: "A" } });
    expect((await getLetterSettingsDto(direktur)).footer).toMatchObject({ left: "A", center: null, right: null });
  });

  it("nama lama footerText = zona kiri; dihilangkan TIDAK menghapusnya (kecuali dikirim); footer.left didahulukan", async () => {
    await updateLetterSettings(direktur, { ...base, footerText: "Teks lama" });
    expect((await getLetterSettingsDto(direktur)).footer.left).toBe("Teks lama");
    expect((await getLetterSettingsDto(direktur)).footerText).toBe("Teks lama");
    await updateLetterSettings(direktur, { ...base, idLine: "Baris identitas" }); // tanpa footerText → tidak berubah
    expect((await getLetterSettingsDto(direktur)).footerText).toBe("Teks lama");
    await updateLetterSettings(direktur, { ...base, footerText: "Lama", footer: { left: "Baru" } });
    expect((await getLetterSettingsDto(direktur)).footerText).toBe("Baru");
    await updateLetterSettings(direktur, { ...base, footerText: null });
    expect((await getLetterSettingsDto(direktur)).footerText).toBeNull();
  });

  it("validasi: font tak dikenal, ukuran di luar 6–14 / bukan kelipatan 0,5, warna bukan #RRGGBB, token salah ketik, teks >200, kunci asing — semuanya VALIDATION", async () => {
    const bad: unknown[] = [
      { fontKey: "COMIC_SANS" }, { size: 5.5 }, { size: 14.5 }, { size: 8.3 }, { size: "9" }, { color: "red" }, { color: "#12345" }, { color: "#GGGGGG" },
      { left: "Hal. {halamn}" }, { right: "{halaman" }, { center: "x".repeat(201) }, { bold: "ya" }, { tidakAda: 1 },
    ];
    for (const footer of bad) {
      const e = await fail(updateLetterSettings(direktur, { ...base, footer }));
      expect(e, JSON.stringify(footer)).toMatchObject({ code: "VALIDATION" });
    }
    expect((await getLetterSettingsDto(direktur)).footer).toEqual(DEFAULT_FOOTER); // tidak ada yang tersimpan
    const e = await fail(updateLetterSettings(direktur, { ...base, footer: { left: "Hal. {halamn}" } }));
    expect(e!.message + JSON.stringify(e!.fieldErrors)).toContain("Token tidak dikenal");
    expect(await fail(updateLetterSettings(direktur, { ...base, footerText: "{xx}" }))).toMatchObject({ code: "VALIDATION" });
  });

  it("batas sah diterima: ukuran 6 dan 14, teks 200 karakter, semua token", async () => {
    await updateLetterSettings(direktur, { ...base, footer: { size: 6, left: "x".repeat(200), right: "{halaman}/{total} {nomor} {tanggal}" } });
    await updateLetterSettings(direktur, { ...base, footer: { size: 14 } });
    expect((await getLetterSettingsDto(direktur)).footer).toMatchObject({ size: 14, right: "{halaman}/{total} {nomor} {tanggal}" });
  });

  it("hanya Direktur (HR dan staf ditolak, termasuk pratinjau); perubahan tercatat di Audit Log", async () => {
    for (const a of [hr, staf]) {
      expect(await fail(updateLetterSettings(a, { ...base, footer: { size: 9 } })), "ubah").toMatchObject({ code: "FORBIDDEN" });
      expect(await fail(previewFooterPdf(a, { footer: { size: 9 } })), "pratinjau").toMatchObject({ code: "FORBIDDEN" });
      expect(await fail(getLetterSettingsDto(a)), "baca").toMatchObject({ code: "FORBIDDEN" });
    }
    await updateLetterSettings(direktur, { ...base, footer: { size: 9, center: "{nomor}" } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "letter.settings" }, orderBy: { createdAt: "desc" } });
    expect(audit.summary).toContain("kaki halaman");
    expect(JSON.stringify(audit.after)).toContain("{nomor}");
  });

  it("pagar basis data (CHECK): ukuran, warna, dan font di luar batas ditolak walau melewati layanan", async () => {
    await getLetterSettingsDto(direktur); // memastikan baris tunggal ada
    for (const set of ["\"footerSize\" = 99", "\"footerSize\" = 5", "\"footerColor\" = 'merah'", "\"footerFont\" = 'COMIC_SANS'"]) {
      await expect(prisma.$executeRawUnsafe(`UPDATE "letter_settings" SET ${set} WHERE "id" = 1`), set).rejects.toThrow();
    }
  });
});

describe("pemakaian di PDF surat", () => {
  async function draftRow() {
    await listTypes(direktur);
    const t = await prisma.letterType.findFirstOrThrow({ where: { series: "EKS", code: 3 } });
    const d = await createLetter(staf, { typeId: t.id });
    await updateLetter(staf, d.id, { subject: "Uji kaki halaman", recipientLines: ["Bapak Uji", "PT Contoh"], signerId: direktur.userId });
    return prisma.letterDocument.findUniqueOrThrow({ where: { id: d.id }, include: { type: true } });
  }

  it("bingkai surat memuat konfigurasi tersimpan (bukan nilai bawaan)", async () => {
    await updateLetterSettings(direktur, { ...base, footer: { left: "Lembaga Uji", center: "{nomor}", fontKey: "CARLITO", size: 9, bold: true, underline: true, color: "#abcdef", rule: true, firstPage: false, attachments: false } });
    const row = await draftRow();
    const { frame } = await buildFrame(row, { number: null, date: "2026-02-10", signerUserId: direktur.userId, draft: true });
    expect(frame.footer).toEqual({ enabled: true, left: "Lembaga Uji", center: "{nomor}", right: "Hal. {halaman} dari {total}", fontKey: "CARLITO", size: 9, bold: true, italic: true, underline: true, color: "#abcdef", rule: true, firstPage: false, attachments: false });
  });

  it("data kaki yang rusak di basis data (di luar layanan) tidak menggagalkan PDF: jatuh ke bawaan", async () => {
    await getLetterSettingsDto(direktur);
    await prisma.$executeRawUnsafe(`ALTER TABLE "letter_settings" DROP CONSTRAINT "letter_settings_footer_font_chk"`);
    try {
      await prisma.$executeRawUnsafe(`UPDATE "letter_settings" SET "footerFont" = 'COMIC_SANS' WHERE "id" = 1`);
      const { frame } = await buildFrame(await draftRow(), { number: null, date: "2026-02-10", signerUserId: direktur.userId, draft: true });
      expect(frame.footer.fontKey).toBe(DEFAULT_FOOTER.fontKey);
    } finally {
      await prisma.$executeRawUnsafe(`UPDATE "letter_settings" SET "footerFont" = 'LIBERATION_SERIF' WHERE "id" = 1`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "letter_settings" ADD CONSTRAINT "letter_settings_footer_font_chk" CHECK ("footerFont" IN ('LIBERATION_SERIF', 'LIBERATION_SANS', 'CALADEA', 'CARLITO'))`);
    }
  });
});

describe("pratinjau PDF kaki halaman", () => {
  it("menghasilkan PDF dua halaman (surat + lampiran contoh) dengan konfigurasi yang dikirim (belum tersimpan)", async () => {
    const bytes = await previewFooterPdf(direktur, { footer: { fontKey: "CALADEA", bold: true, italic: true, center: "{nomor}" } });
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2);
    expect(bytes.toString("latin1")).toContain("Caladea-BoldItalic");
    expect((await getLetterSettingsDto(direktur)).footer).toEqual(DEFAULT_FOOTER); // tidak menyimpan apa pun
  });
  it("bagian yang tidak dikirim memakai nilai TERSIMPAN; halaman lampiran dikecualikan mengikuti konfigurasi", async () => {
    await updateLetterSettings(direktur, { ...base, footer: { fontKey: "CARLITO" } });
    const txt = (await previewFooterPdf(direktur, {})).toString("latin1");
    expect(txt).toContain("Carlito");
    expect(await fail(previewFooterPdf(direktur, { footer: { size: 99 } }))).toMatchObject({ code: "VALIDATION" });
    expect(await fail(previewFooterPdf(direktur, { bukanKunci: 1 }))).toMatchObject({ code: "VALIDATION" });
  });
});
