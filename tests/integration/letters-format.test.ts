/**
 * Salam baku "Dengan hormat,": jenis surat bawaan yang masih memakai penulisan lama dirapikan (hanya bila PERSIS bawaan lama); salam yang sudah diubah Direktur dan surat yang sudah dibuat
 * tidak disentuh; surat baru memakai penulisan baku.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { resetDb, makeUser } from "../helpers/db";
import { createLetter } from "@/server/services/letters/documents";
import { ensureDefaultTypes, listTypes } from "@/server/services/letters/types";
import { DEFAULT_LETTER_TYPES, LEGACY_GENERIC_TEMPLATES, sameDoc } from "@/lib/documents/templates";

let direktur: Actor, staf: Actor;
async function emp(no: string, name: string, position: string) {
  return prisma.employee.create({ data: { employeeNo: no, fullName: name, position, joinDate: isoToDate("2026-01-05"), employmentStatus: "PERMANENT" } as never });
}
beforeEach(async () => {
  await resetDb();
  direktur = await makeUser("dir@uji.test", "Direktur Uji", "SUPER_ADMIN", (await emp("D-1", "Direktur Uji", "Direktur Utama")).id);
  staf = await makeUser("staf@uji.test", "Staf Uji", "EMPLOYEE", (await emp("S-1", "Staf Uji", "Staf Admisi")).id);
});
const typeOf = (code: number) => prisma.letterType.findFirstOrThrow({ where: { series: "EKS", code } });

describe("salam baku jenis surat", () => {
  it("jenis baru memakai 'Dengan hormat,'; surat baru mewarisinya", async () => {
    await listTypes(direktur);
    const t = await typeOf(3);
    expect(t.defaultSalutation).toBe("Dengan hormat,");
    expect((await createLetter(staf, { typeId: t.id })).salutation).toBe("Dengan hormat,");
  });

  it("jenis yang masih memakai penulisan lama persis dirapikan; salam yang diubah Direktur dan surat yang sudah ada tidak disentuh", async () => {
    await listTypes(direktur);
    const [legacy, custom] = [await typeOf(3), await typeOf(1)];
    const old = await createLetter(staf, { typeId: legacy.id });
    await prisma.letterType.update({ where: { id: legacy.id }, data: { defaultSalutation: "Dengan Hormat," } });
    await prisma.letterType.update({ where: { id: custom.id }, data: { defaultSalutation: "Salam Sejahtera," } });
    await prisma.letterDocument.update({ where: { id: old.id }, data: { salutation: "Dengan Hormat," } });
    await ensureDefaultTypes();
    expect((await typeOf(3)).defaultSalutation).toBe("Dengan hormat,");
    expect((await typeOf(1)).defaultSalutation).toBe("Salam Sejahtera,");                          // kebijakan Direktur dipertahankan
    expect((await prisma.letterDocument.findUniqueOrThrow({ where: { id: old.id } })).salutation).toBe("Dengan Hormat,");   // surat yang ada tidak berubah
  });

  it("idempoten: dijalankan berulang tidak mengubah apa pun lagi", async () => {
    await listTypes(direktur);
    await ensureDefaultTypes(); await ensureDefaultTypes();
    expect((await typeOf(3)).defaultSalutation).toBe("Dengan hormat,");
  });
});

describe("peningkatan templat dari kerangka umum lama", () => {
  const tpl = (series: "EKS" | "INT", code: number) => DEFAULT_LETTER_TYPES.find((t) => t.series === series && t.code === code)!.template;

  it("jenis yang templatnya PERSIS kerangka umum lama ditingkatkan; yang sudah diubah Direktur dan surat yang ada tidak disentuh", async () => {
    await listTypes(direktur);
    const [untouched, edited, internal] = [await typeOf(5), await typeOf(6), await prisma.letterType.findFirstOrThrow({ where: { series: "INT", code: 4 } })];
    expect(sameDoc(untouched.templateBody, tpl("EKS", 5))).toBe(true);            // database baru: sudah templat khusus
    const [, legacyUmum, legacyInternal] = LEGACY_GENERIC_TEMPLATES;
    const old = await createLetter(staf, { typeId: untouched.id });
    const oldBody = (await prisma.letterDocument.findUniqueOrThrow({ where: { id: old.id } })).body;
    // simulasi database lama: dua jenis masih kerangka umum; satu jenis sudah dikustomisasi Direktur (kerangka + satu kalimat)
    const custom = JSON.parse(JSON.stringify(legacyUmum).replace("Demikian kami sampaikan.", "Demikian kami sampaikan, dengan penyesuaian Direktur."));
    expect(sameDoc(custom, legacyUmum)).toBe(false);                               // kustomisasi benar-benar berbeda dari kerangka lama
    await prisma.letterType.update({ where: { id: untouched.id }, data: { templateBody: legacyUmum as object } });
    await prisma.letterType.update({ where: { id: edited.id }, data: { templateBody: custom } });
    await prisma.letterType.update({ where: { id: internal.id }, data: { templateBody: legacyInternal as object } });
    await ensureDefaultTypes();
    expect(sameDoc((await typeOf(5)).templateBody, tpl("EKS", 5))).toBe(true);    // ditingkatkan
    expect(sameDoc((await prisma.letterType.findUniqueOrThrow({ where: { id: internal.id } })).templateBody, tpl("INT", 4))).toBe(true);
    expect(sameDoc((await typeOf(6)).templateBody, custom)).toBe(true);            // kustomisasi Direktur dipertahankan
    expect((await prisma.letterDocument.findUniqueOrThrow({ where: { id: old.id } })).body).toEqual(oldBody);   // surat yang sudah dibuat tidak berubah
    // idempoten
    await ensureDefaultTypes();
    expect(sameDoc((await typeOf(5)).templateBody, tpl("EKS", 5))).toBe(true);
    expect(sameDoc((await typeOf(6)).templateBody, custom)).toBe(true);
  });

  it("Surat Tugas (INT-02) tidak dipengaruhi (isinya dibangkitkan dari data penugasan)", async () => {
    await listTypes(direktur);
    const before = (await prisma.letterType.findFirstOrThrow({ where: { series: "INT", code: 2 } })).templateBody;
    await ensureDefaultTypes();
    expect((await prisma.letterType.findFirstOrThrow({ where: { series: "INT", code: 2 } })).templateBody).toEqual(before);
  });
});
