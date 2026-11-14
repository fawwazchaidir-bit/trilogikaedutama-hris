/**
 * Dialog "Ubah jam & tanggal" baris jam kerja: validasi cepat di layar dan perbedaan nilai (hanya yang berubah dikirim). Murni.
 */
import { describe, expect, it } from "vitest";
import { parseHours, validateWorkloadEdit, WORKLOAD_HOURS_MAX } from "@/lib/training/workload-edit";

const cur = { hours: 8, startDate: "2026-12-07", endDate: "2026-12-09" };
const ok = (hours: string, startDate = cur.startDate, endDate = cur.endDate) => validateWorkloadEdit({ hours, startDate, endDate }, cur);

describe("jam", () => {
  it("menerima angka desimal dengan koma atau titik, > 0 dan ≤ 2000", () => {
    expect(parseHours("8")).toBe(8);
    expect(parseHours("8,5")).toBe(8.5);
    expect(parseHours("8.25")).toBe(8.25);
    expect(parseHours(" 12 ")).toBe(12);
    expect(parseHours(String(WORKLOAD_HOURS_MAX))).toBe(WORKLOAD_HOURS_MAX);
    expect(parseHours("0.5")).toBe(0.5);
  });
  it("menolak kosong, nol, negatif, huruf, terlalu besar, lebih dari 2 angka desimal, dan bentuk ganjil", () => {
    for (const bad of ["", "   ", "0", "0,0", "-1", "abc", "8 jam", "2001", "1e3", "8.123", "8,", ",5", "1.2.3", "∞", "NaN"]) expect(parseHours(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("validateWorkloadEdit", () => {
  it("nilai sah: ok, nilai terurai, dan HANYA bidang yang berubah masuk patch", () => {
    expect(ok("10")).toMatchObject({ ok: true, value: { hours: 10, startDate: "2026-12-07", endDate: "2026-12-09" }, patch: { hours: 10 } });
    expect(ok("8", "2026-12-08", "2026-12-09").patch).toEqual({ startDate: "2026-12-08" });
    expect(ok("8,5", "2026-12-07", "2026-12-12").patch).toEqual({ hours: 8.5, endDate: "2026-12-12" });
    expect(ok("8").patch).toEqual({}); // tidak ada perubahan → tombol Simpan nonaktif
    expect(ok("8,00").patch).toEqual({}); // 8,00 = 8
  });
  it("tanggal selesai sebelum tanggal mulai ditolak; satu hari (sama) sah", () => {
    expect(ok("8", "2026-12-10", "2026-12-09")).toMatchObject({ ok: false, errors: { endDate: "Tanggal selesai tidak boleh sebelum tanggal mulai" }, patch: {} });
    expect(ok("8", "2026-12-09", "2026-12-09").ok).toBe(true);
  });
  it("tanggal kosong, bukan tanggal kalender (30 Februari, bulan 13), atau format salah ditolak dengan pesan per bidang", () => {
    expect(ok("8", "", cur.endDate).errors).toEqual({ startDate: "Tanggal mulai wajib diisi" });
    expect(ok("8", cur.startDate, "").errors).toEqual({ endDate: "Tanggal selesai wajib diisi" });
    expect(ok("8", "2026-02-30", cur.endDate).errors).toEqual({ startDate: "Tanggal mulai tidak valid" });
    expect(ok("8", cur.startDate, "2026-13-01").errors).toEqual({ endDate: "Tanggal selesai tidak valid" });
    expect(ok("8", "07/12/2026", cur.endDate).errors.startDate).toBe("Tanggal mulai tidak valid");
  });
  it("beberapa kesalahan sekaligus dilaporkan; hasil tidak ok tanpa nilai/patch", () => {
    const r = ok("", "", "");
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(["endDate", "hours", "startDate"]);
    expect(r.value).toBeNull();
    expect(r.patch).toEqual({});
    expect(ok("abc").errors.hours).toMatch(/lebih dari 0/);
  });
});
