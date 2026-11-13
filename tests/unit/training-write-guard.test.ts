/**
 * Tes STATIS: setiap jalur tulis data proyek di `src/server/services/training/*.ts` harus memakai pagar TERKUNCI (`assertEditableLocked` / `assertTaskEditableLocked` /
 * `lockProjectShared` / `lockProjectExclusive`) sebagai langkah PERTAMA transaksinya — pemeriksaan `assertEditable(access.project)` di awal service dibaca SEBELUM transaksi,
 * sehingga penulis yang sudah lolos dapat menyimpan hampir bersamaan dengan penutupan proyek (lihat TRAINING-OPS.md "Penutupan vs perubahan bersamaan").
 *
 * Tes ini bukan pengganti tes serentak (`training-closure-writers.test.ts`); ia mencegah jalur BARU ditambahkan tanpa pagar: jalur tulis baru yang tidak memeriksa status
 * sama sekali harus dimasukkan ke daftar pengecualian di bawah DENGAN ALASAN — sebuah keputusan sadar, bukan kelalaian.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DIR = "src/server/services/training";
const LOCKED = /assertEditableLocked\(|assertTaskEditableLocked\(|lockProjectShared\(|lockProjectExclusive\(/;

interface Fn { file: string; name: string; text: string }
function functionsOf(): Fn[] {
  const out: Fn[] = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".ts"))) {
    const src = readFileSync(`${DIR}/${f}`, "utf8");
    for (const ch of src.split(/\n(?=(?:export )?(?:async )?function \w+|(?:export )?const \w+ = (?:async )?\()/)) {
      const m = /^(?:export )?(?:async )?function (\w+)|^(?:export )?const (\w+) =/.exec(ch);
      if (m) out.push({ file: f, name: (m[1] ?? m[2])!, text: ch });
    }
  }
  return out;
}
const FNS = functionsOf();
const calls = (fn: Fn, name: string) => new RegExp(`\\b${name}\\(`).test(fn.text.replace(new RegExp(`(export )?(async )?function ${name}\\b`), ""));

/** Pembantu pemeriksaan-awal (bukan jalur tulis): pemanggil yang punya transaksi wajib memasang pagar terkunci sendiri. */
const EARLY_HELPERS = ["assertEditable", "assertEditableLocked", "assertTaskEditable", "assertTaskEditableLocked", "assertCanUploadDocument", "loadWorkloadForManage"];

/** Jalur tulis TANPA pemeriksaan status — daftar pengecualian SADAR, lengkap dengan alasan. */
const NO_STATUS_CHECK: Record<string, string> = {
  setAccessLevel: "data akses modul (global), bukan data proyek",
  revokeAccessLevel: "data akses modul (global), bukan data proyek",
  saveIndicatorConfig: "konfigurasi indikator (global, berversi)",
  resetIndicatorConfig: "konfigurasi indikator (global, berversi)",
  upsertStaffCapacity: "kapasitas staf (global), bukan data proyek",
  clearStaffCapacity: "kapasitas staf (global), bukan data proyek",
  createInstructor: "direktori instruktur/asesor (global)",
  updateInstructor: "direktori instruktur/asesor (global)",
  createProgram: "master program (global)",
  updateProgram: "master program (global)",
  createProject: "membuat proyek baru (belum ada status final yang dapat dilanggar)",
  saveTemplate: "template checklist (global); disalin ke proyek lewat applyChecklistTemplate yang terkunci",
  dispatch: "pekerja latar belakang (otomasi), bukan aksi pengguna pada data proyek",
  // RUJUKAN SENGAJA tetap dapat dicatat setelah proyek Selesai/Dibatalkan (mis. nomor invoice yang terbit sesudah pelatihan); bukan data yang memengaruhi penutupan.
  linkAssignment: "rujukan surat tugas — sengaja tetap dapat dicatat setelah proyek ditutup",
  unlinkAssignment: "rujukan surat tugas — sengaja tetap dapat dikelola setelah proyek ditutup",
  addExternalRef: "referensi sistem lain — sengaja tetap dapat dicatat setelah proyek ditutup (mis. invoice terbit sesudah pelatihan)",
  removeExternalRef: "referensi sistem lain — sengaja tetap dapat dikelola setelah proyek ditutup",
};

describe("pagar penulisan proyek terkunci (statis)", () => {
  it("fungsi sumber ditemukan (tes ini tidak diam-diam kosong)", () => {
    expect(FNS.length).toBeGreaterThan(100);
    for (const n of ["closeProject", "createSchedule", "addMilestone", "updateWorkloadTask"]) expect(FNS.some((f) => f.name === n), n).toBe(true);
  });

  it("setiap fungsi yang memeriksa status di AWAL (assertEditable) juga mengambil kunci proyek terkunci", () => {
    const bad = FNS.filter((f) => !EARLY_HELPERS.includes(f.name) && calls(f, "assertEditable") && !LOCKED.test(f.text)).map((f) => `${f.file}: ${f.name}`);
    expect(bad, "jalur tulis dengan pemeriksaan status HANYA di awal service — pasang assertEditableLocked(tx, projectId) sebagai langkah pertama transaksi").toEqual([]);
  });

  it("pemanggil pembantu pemeriksaan-awal yang punya transaksi juga memasang pagar terkunci (loadWorkloadForManage, assertCanUploadDocument)", () => {
    const bad = FNS.filter((f) => !EARLY_HELPERS.includes(f.name) && /\btransaction\(/.test(f.text) && (calls(f, "loadWorkloadForManage") || calls(f, "assertCanUploadDocument")) && !LOCKED.test(f.text)).map((f) => `${f.file}: ${f.name}`);
    expect(bad).toEqual([]);
  });

  it("setiap fungsi bertransaksi tanpa pemeriksaan status apa pun ada di daftar pengecualian SADAR (dengan alasan)", () => {
    const bad = FNS.filter((f) => !EARLY_HELPERS.includes(f.name) && /\btransaction\(/.test(f.text) && !calls(f, "assertEditable") && !calls(f, "assertTaskEditable") && !calls(f, "loadWorkloadForManage") && !calls(f, "assertCanUploadDocument") && !LOCKED.test(f.text) && !(f.name in NO_STATUS_CHECK))
      .map((f) => `${f.file}: ${f.name}`);
    expect(bad, "jalur tulis baru tanpa pemeriksaan status: pasang assertEditableLocked(tx, projectId) — atau, bila memang sengaja terbuka, masukkan ke NO_STATUS_CHECK dengan alasan").toEqual([]);
  });

  it("daftar pengecualian tidak berisi fungsi yang sudah tidak ada atau yang kini sudah memeriksa status (tidak menumpuk basi)", () => {
    for (const name of Object.keys(NO_STATUS_CHECK)) {
      const fn = FNS.find((f) => f.name === name);
      expect(fn, `${name} tidak ditemukan`).toBeTruthy();
      expect(calls(fn!, "assertEditable") || LOCKED.test(fn!.text), `${name} kini memeriksa status — hapus dari pengecualian`).toBe(false);
    }
  });

  it("kunci proyek adalah hal PERTAMA di transaksi — sebelum kunci workload, kunci baris (FOR UPDATE), atau pembacaan lain (urutan kunci seragam → tidak ada deadlock)", () => {
    const bad: string[] = [];
    for (const f of FNS) {
      if (EARLY_HELPERS.includes(f.name) || !LOCKED.test(f.text)) continue;
      const m = /transaction\(async \(tx\) => \{\n/.exec(f.text);
      if (!m) continue;
      const first = f.text.slice(m.index + m[0].length).split("\n").find((l) => l.trim() !== "" && !l.trim().startsWith("//"))?.trim() ?? "";
      if (!/^(const [^=]+= )?await (assertEditableLocked|assertTaskEditableLocked|lockProjectShared|lockProjectExclusive)\(/.test(first)) bad.push(`${f.file}: ${f.name} → "${first.slice(0, 70)}"`);
    }
    expect(bad).toEqual([]);
  });
});
