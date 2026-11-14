import "server-only";
import { prisma } from "../../db";
import { env, lettersEnabled } from "../../env";
import { getSettings } from "../settings";
import { personFacts } from "./access";
import { isEligibleSigner } from "@/lib/documents/policy";
import { buildReport, type ReadinessCheck, type ReadinessReport } from "@/lib/letters-readiness";

/**
 * KESIAPAN PERSURATAN untuk membuat & menerbitkan surat tugas (jenis INT-002) dan uang harian. HANYA MEMBACA (tidak membuat data apa pun). Tidak memeriksa izin pemanggil:
 * pemanggil (CLI, log awal, halaman Pengaturan Direktur) yang menjaga akses. Pembuatan surat tugas SEKARANG hanya lewat Persuratan — jalur lama dihapus — sehingga
 * modul yang mati berarti tidak ada cara membuat surat tugas baru.
 */
export async function checkLettersReadiness(opts: { renderTest?: boolean } = {}): Promise<ReadinessReport> {
  const checks: ReadinessCheck[] = [];
  const add = (c: ReadinessCheck) => checks.push(c);
  const ok = (key: string, title: string, detail: string) => add({ key, severity: "OK", title, detail, fix: null });

  // 1) Bendera modul
  if (!lettersEnabled()) {
    add({
      key: "flag", severity: "WARN", title: "Modul Persuratan",
      detail: "MATI (LETTERS_MODULE_ENABLED=false). Surat tugas BARU tidak dapat dibuat: pembuatannya hanya lewat Persuratan. Surat tugas yang sudah terbit, Surat Tugas Saya, uang harian/bukti penerimaan, dan verifikasi QR tetap berfungsi.",
      fix: "Setel LETTERS_MODULE_ENABLED=true di environment lalu mulai ulang aplikasi — setelah semua pemeriksaan di bawah siap.",
    });
  } else ok("flag", "Modul Persuratan", "Menyala (LETTERS_MODULE_ENABLED=true).");

  // 2) Jenis Surat Tugas (INT-002) — dibuat otomatis saat modul pertama dibuka bila belum ada
  const tugas = await prisma.letterType.findFirst({ where: { kind: "TUGAS" }, select: { isActive: true, directorOnly: true, signerJobLevels: true, hrCanSign: true, signerDivisionIds: true } });
  if (!tugas) ok("type", "Jenis Surat Tugas (INT-002)", "Belum ada di database; dibuat otomatis saat Persuratan pertama kali dibuka.");
  else if (!tugas.isActive) add({ key: "type", severity: "ERROR", title: "Jenis Surat Tugas (INT-002)", detail: "Dinonaktifkan di katalog jenis surat sehingga surat tugas tidak dapat dibuat.", fix: "Aktifkan kembali jenis Surat Tugas di Persuratan → Pengaturan → Jenis surat (Direktur)." });
  else ok("type", "Jenis Surat Tugas (INT-002)", "Aktif.");

  // 3) Pembuat: HR/Direktur aktif yang tertaut ke data karyawan (Direktur dikecualikan dari syarat tautan)
  const creators = await prisma.user.findMany({ where: { isActive: true, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } }, select: { name: true, role: true, employee: { select: { id: true, isActive: true } } } });
  const unlinkedHr = creators.filter((u) => u.role === "HR_ADMIN" && !u.employee);
  const director = creators.filter((u) => u.role === "SUPER_ADMIN");
  if (director.length === 0) add({ key: "creators", severity: "ERROR", title: "Pembuat surat tugas", detail: "Tidak ada akun Direktur (Super Admin) yang aktif.", fix: "Buat/aktifkan akun Super Admin." });
  else if (unlinkedHr.length) add({ key: "creators", severity: "WARN", title: "Pembuat surat tugas", detail: `${unlinkedHr.length} akun HR belum tertaut ke data karyawan sehingga tidak dapat membuat surat: ${unlinkedHr.map((u) => u.name).join(", ")}. Direktur tetap dapat membuat.`, fix: "Tautkan akun HR itu ke data karyawannya (menu Karyawan → Buat akun login / tautkan)." });
  else ok("creators", "Pembuat surat tugas", `${creators.length} akun HR/Direktur aktif dapat membuat surat tugas.`);

  // 4) Penandatangan yang berhak untuk Surat Tugas
  if (tugas) {
    const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true } });
    let eligible = 0;
    for (const u of users) {
      const f = await personFacts(u.id);
      if (f && isEligibleSigner({ directorOnly: tugas.directorOnly, signerJobLevels: tugas.signerJobLevels, hrCanSign: tugas.hrCanSign, signerDivisionIds: tugas.signerDivisionIds }, f)) eligible++;
    }
    if (eligible === 0) add({ key: "signers", severity: "ERROR", title: "Penandatangan Surat Tugas", detail: "Tidak ada akun yang berhak menandatangani Surat Tugas menurut kebijakan penandatangan saat ini.", fix: "Atur kebijakan penandatangan di Persuratan → Pengaturan → Bagan penandatangan, atau pastikan akun Direktur aktif." });
    else ok("signers", "Penandatangan Surat Tugas", `${eligible} akun berhak menandatangani.`);
  }

  // 5) Identitas lembaga (kop surat) & cap
  const [company, ls] = await Promise.all([getSettings(), prisma.letterSettings.findUnique({ where: { id: 1 } })]);
  const missingKop = [!company.address?.trim() && "alamat", !company.email?.trim() && "email", !company.phone?.trim() && "telepon", !company.website?.trim() && "website"].filter(Boolean) as string[];
  if (missingKop.length) add({ key: "letterhead", severity: "WARN", title: "Kop surat", detail: `Data lembaga belum lengkap: ${missingKop.join(", ")} (kop surat memakainya).`, fix: "Lengkapi di Pengaturan → Lembaga." });
  else ok("letterhead", "Kop surat", "Alamat, email, telepon, dan website lembaga terisi.");
  if (!ls?.stampFileId) add({ key: "stamp", severity: "WARN", title: "Cap lembaga", detail: "Belum diunggah; surat terbit tanpa cap (cap dipakai pada semua surat).", fix: "Unggah cap di Persuratan → Pengaturan (Direktur)." });
  else ok("stamp", "Cap lembaga", "Terpasang.");
  const directorIds = director.length ? (await prisma.user.findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: { id: true } })).map((u) => u.id) : [];
  const dirSigs = directorIds.length ? await prisma.letterSigner.count({ where: { userId: { in: directorIds }, signatureFileId: { not: null } } }) : 0;
  if (director.length && dirSigs === 0) add({ key: "signature", severity: "WARN", title: "Tanda tangan Direktur", detail: "Gambar tanda tangan Direktur belum diunggah; surat yang ia setujui terbit tanpa tanda tangan bergambar.", fix: "Unggah di Persuratan → Pengaturan → Tanda tangan penandatangan." });
  else if (director.length) ok("signature", "Tanda tangan Direktur", "Terpasang.");

  // 6) Uang harian: penandatangan Bukti Penerimaan (memakai penanda tangan resmi yang sama dengan slip gaji)
  if (!company.slipSignerName?.trim()) add({ key: "receipt", severity: "WARN", title: "Bukti Penerimaan Uang Harian", detail: "Penanda tangan resmi (yang sama dengan slip gaji) belum diisi, sehingga bukti penerimaan tanpa nama penanda tangan.", fix: "Isi di Pengaturan → Slip gaji → Penanda tangan." });
  else ok("receipt", "Bukti Penerimaan Uang Harian", `Penanda tangan: ${company.slipSignerName}.`);

  // 7) QR verifikasi memakai APP_URL
  const appUrl = env().APP_URL;
  if (/localhost|127\.0\.0\.1/.test(appUrl) && process.env.NODE_ENV === "production") add({ key: "appurl", severity: "ERROR", title: "Tautan verifikasi (QR)", detail: `APP_URL=${appUrl} menunjuk ke mesin lokal; QR pada surat yang terbit tidak dapat dibuka orang lain.`, fix: "Setel APP_URL ke alamat publik https:// aplikasi." });
  else if (process.env.NODE_ENV === "production" && !appUrl.startsWith("https://")) add({ key: "appurl", severity: "WARN", title: "Tautan verifikasi (QR)", detail: `APP_URL=${appUrl} tidak memakai https.`, fix: "Gunakan alamat https:// agar QR aman dibuka." });
  else ok("appurl", "Tautan verifikasi (QR)", `Memakai ${appUrl}.`);

  // 8) Pekerja pengingat follow-up
  if (lettersEnabled() && !env().LETTERS_WORKER) add({ key: "worker", severity: "WARN", title: "Pekerja Persuratan", detail: "LETTERS_WORKER=false: pengingat follow-up penawaran tidak berjalan (penerbitan surat tugas tidak terpengaruh).", fix: "Setel LETTERS_WORKER=true bila pengingat follow-up diperlukan." });
  else ok("worker", "Pekerja Persuratan", lettersEnabled() ? "Menyala." : "Tidak relevan (modul mati).");

  // 9) Uji mesin PDF (react-pdf + QR) — hanya bila diminta (CLI/halaman Kesiapan), karena memakan beberapa detik. Dijalankan di PROSES TERPISAH dengan Node biasa: mesin PDF
  //    membutuhkan React penuh, sedangkan CLI & runtime server memuat React versi server (kondisi react-server). Yang diuji: paket mesin PDF terpasang & berfungsi,
  //    font bawaan, dan pembuat QR untuk tautan verifikasi. Dokumen mini mandiri (bukan template surat).
  if (opts.renderTest) {
    const probe = await runPdfProbe(`${appUrl.replace(/\/$/, "")}/verifikasi/uji`, company.name);
    if (probe.ok) ok("pdf", "Mesin PDF & QR", `Uji render berhasil (${probe.size} byte; QR dibuat).`);
    else add({ key: "pdf", severity: "ERROR", title: "Mesin PDF & QR", detail: `Uji render PDF gagal: ${probe.error}`, fix: "Periksa instalasi @react-pdf/renderer dan qrcode (npm ci); surat tidak dapat diterbitkan sampai ini beres." });
  }
  return buildReport(checks);
}

const PROBE = `
const { renderToBuffer, Document, Page, Text, View } = await import("@react-pdf/renderer");
const React = (await import("react")).default;
const QRCode = (await import("qrcode")).default;
const url = process.env.PROBE_URL, name = process.env.PROBE_NAME;
const qr = await QRCode.toDataURL(url, { margin: 0, width: 120, errorCorrectionLevel: "M" });
const h = React.createElement;
const bytes = await renderToBuffer(h(Document, null, h(Page, { size: "A4" }, h(View, null, h(Text, null, "Uji mesin PDF — " + name)))));
process.stdout.write(JSON.stringify({ ok: bytes.subarray(0, 5).toString("latin1") === "%PDF-" && qr.startsWith("data:image/png"), size: bytes.byteLength }));
`;

async function runPdfProbe(url: string, name: string): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    execFile(process.execPath, ["--input-type=module", "-e", PROBE], { cwd: process.cwd(), timeout: 45_000, env: { ...process.env, NODE_OPTIONS: "", PROBE_URL: url, PROBE_NAME: name } }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: (stderr || err.message).toString().split("\n").find((l) => l.trim()) ?? err.message });
      try { const r = JSON.parse(stdout) as { ok: boolean; size: number }; resolve(r.ok ? { ok: true, size: r.size } : { ok: false, error: "keluaran bukan PDF/QR yang valid" }); } catch { resolve({ ok: false, error: "keluaran uji tidak dapat dibaca" }); }
    });
  });
}
