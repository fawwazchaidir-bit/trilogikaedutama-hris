import { describe, expect, it } from "vitest";
import { canHoldSignature, canSignOwn, canTakeOver, isEditable, isEligibleSigner, workingDaysElapsed } from "@/lib/documents/policy";
import { hasPlaceholder, normalizeDoc } from "@/lib/documents/content";
import { doc, p } from "@/lib/documents/builders";

const person = (o: Partial<Parameters<typeof isEligibleSigner>[1]> = {}) => ({ role: "EMPLOYEE" as const, jobLevel: "STAFF" as const, isIntern: false, isActive: true, ...o });

describe("kewenangan penandatangan", () => {
  it("Direktur selalu berwenang; Manajer hanya bila jenis mengizinkan; Staf & Magang tidak; nonaktif tidak", () => {
    const open = { directorOnly: false, signerJobLevels: ["MANAGER" as const] };
    expect(isEligibleSigner(open, person({ role: "SUPER_ADMIN", jobLevel: null }))).toBe(true);
    expect(isEligibleSigner(open, person({ jobLevel: "MANAGER" }))).toBe(true);
    expect(isEligibleSigner(open, person({ jobLevel: "SUPERVISOR" }))).toBe(false);
    expect(isEligibleSigner(open, person())).toBe(false);
    expect(isEligibleSigner(open, person({ jobLevel: "MANAGER", isIntern: true }))).toBe(false);
    expect(isEligibleSigner(open, person({ jobLevel: "MANAGER", isActive: false }))).toBe(false);
    expect(isEligibleSigner({ directorOnly: true, signerJobLevels: ["MANAGER"] }, person({ jobLevel: "MANAGER" }))).toBe(false);
    expect(isEligibleSigner({ directorOnly: true, signerJobLevels: [] }, person({ role: "SUPER_ADMIN", jobLevel: null }))).toBe(true);
  });
  it("HR (role Admin/HR) berwenang hanya bila jenis mengizinkan hrCanSign; Magang tidak pernah", () => {
    const pol = { directorOnly: false, signerJobLevels: [] as ("MANAGER")[], hrCanSign: true };
    expect(isEligibleSigner(pol, person({ role: "HR_ADMIN" }))).toBe(true);
    expect(isEligibleSigner({ ...pol, hrCanSign: false }, person({ role: "HR_ADMIN" }))).toBe(false);
    expect(isEligibleSigner(pol, person({ role: "HR_ADMIN", isIntern: true }))).toBe(false);
    expect(canHoldSignature(person({ role: "HR_ADMIN" }))).toBe(true);
    expect(canHoldSignature(person({ jobLevel: "MANAGER" }))).toBe(true);
    expect(canHoldSignature(person())).toBe(false);
  });
  it("pembatasan divisi: Manajer hanya sah bila divisinya termasuk; Direktur & HR tidak terikat divisi; tanpa batas = semua divisi", () => {
    const pol = { directorOnly: false, signerJobLevels: ["MANAGER" as const], hrCanSign: true, signerDivisionIds: ["div-pemasaran"] };
    expect(isEligibleSigner(pol, { ...person({ jobLevel: "MANAGER" }), divisionId: "div-pemasaran" })).toBe(true);
    expect(isEligibleSigner(pol, { ...person({ jobLevel: "MANAGER" }), divisionId: "div-ops" })).toBe(false);
    expect(isEligibleSigner(pol, { ...person({ jobLevel: "MANAGER" }), divisionId: null })).toBe(false);
    expect(isEligibleSigner(pol, { ...person({ role: "SUPER_ADMIN", jobLevel: null }), divisionId: "div-ops" })).toBe(true);
    expect(isEligibleSigner(pol, { ...person({ role: "HR_ADMIN" }), divisionId: "div-ops" })).toBe(true);
    expect(isEligibleSigner({ ...pol, signerDivisionIds: [] }, { ...person({ jobLevel: "MANAGER" }), divisionId: "div-ops" })).toBe(true);
    expect(isEligibleSigner({ ...pol, signerDivisionIds: [] }, { ...person({ jobLevel: "MANAGER" }), divisionId: null })).toBe(true);
  });
  it("hanya Direktur boleh menandatangani suratnya sendiri; hanya Draf/Dikembalikan yang dapat disunting", () => {
    expect(canSignOwn({ role: "SUPER_ADMIN" })).toBe(true);
    expect(canSignOwn({ role: "EMPLOYEE" })).toBe(false);
    expect(isEditable("DRAFT") && isEditable("RETURNED")).toBe(true);
    expect(isEditable("IN_REVIEW") || isEditable("ISSUED")).toBe(false);
  });
});

describe("eskalasi hari kerja", () => {
  it("menghitung hari kerja (Sen–Jum) di zona waktu lokal; akhir pekan tidak dihitung", () => {
    const mon = new Date("2026-11-09T03:00:00Z"); // Senin 10.00 WIB
    expect(workingDaysElapsed(mon, new Date("2026-11-09T09:00:00Z"))).toBe(0);
    expect(workingDaysElapsed(mon, new Date("2026-11-11T03:00:00Z"))).toBe(2); // Rabu
    expect(workingDaysElapsed(new Date("2026-11-13T03:00:00Z"), new Date("2026-11-16T03:00:00Z"))).toBe(1); // Jumat→Senin
    expect(canTakeOver(mon, new Date("2026-11-10T03:00:00Z"), 2)).toBe(false);
    expect(canTakeOver(mon, new Date("2026-11-11T03:00:00Z"), 2)).toBe(true);
    expect(canTakeOver(null, new Date(), 2)).toBe(false);
  });
});

describe("isi dokumen", () => {
  it("mendeteksi teks panduan [..] hanya di teks (bukan di struktur JSON)", () => {
    expect(hasPlaceholder(doc(p("Isi [nama program] ini")))).toBe(true);
    expect(hasPlaceholder(doc(p("Isi final tanpa penanda")))).toBe(false);
  });
  it("normalizeDoc membuang atribut default/null tetapi mempertahankan yang bermakna", () => {
    const out = normalizeDoc({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left", indent: null, firstLine: true, spaceAfter: null }, content: [] }] });
    expect(out.content[0]!.attrs).toEqual({ firstLine: true });
  });
});
