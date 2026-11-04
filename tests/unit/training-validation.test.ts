import { describe, expect, it } from "vitest";
import { instructorUpdateSchema, participantUpdateSchema, programUpdateSchema, projectCreateSchema, projectUpdateSchema, taskUpdateSchema } from "@/lib/validation/training";

/**
 * Regresi: Zod 4 menerapkan `.default()` walau skema dibungkus `.partial()`. Tanpa `patchOf`, PATCH sebagian akan diam-diam menimpa
 * prioritas/status/jenis/moda/jenis program/BNSP dengan nilai bawaan.
 */
describe("skema ubah sebagian tidak menimpa field yang tidak dikirim", () => {
  it("proyek", () => {
    const r = projectUpdateSchema.parse({ name: "Nama baru proyek" });
    expect(Object.keys(r)).toEqual(["name"]);
  });
  it("tugas", () => { expect(Object.keys(taskUpdateSchema.parse({ title: "Judul baru" }))).toEqual(["title"]); });
  it("peserta", () => { expect(Object.keys(participantUpdateSchema.parse({ note: "x" }))).toEqual(["note"]); });
  it("instruktur", () => { expect(Object.keys(instructorUpdateSchema.parse({ name: "Budi" }))).toEqual(["name"]); });
  it("program", () => { expect(Object.keys(programUpdateSchema.parse({ name: "Program X" }))).toEqual(["name"]); });
  it("field yang dikirim tetap dipakai, yang tidak valid tetap ditolak", () => {
    expect(projectUpdateSchema.parse({ track: "PARTNER", bnsp: true })).toMatchObject({ track: "PARTNER", bnsp: true });
    expect(projectUpdateSchema.safeParse({ track: "LAINNYA" }).success).toBe(false);
    expect(taskUpdateSchema.parse({ priority: "HIGH" })).toEqual({ priority: "HIGH" });
  });
  it("skema BUAT tetap memberi nilai bawaan", () => {
    const r = projectCreateSchema.parse({ name: "Proyek baru" });
    expect(r).toMatchObject({ kind: "REGULAR", deliveryMode: "ONSITE", track: "REGULAR", bnsp: false });
  });
});
