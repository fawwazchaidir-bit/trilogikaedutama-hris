/**
 * Slip gaji: penanda tangan (nama, jabatan, kota, gambar) diatur Super Admin dan DIBEKUKAN pada snapshot saat terbit;
 * lembur dibayar masuk snapshot & ringkasan kehadiran; PDF memuat semuanya dan tetap satu halaman.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { normalizeSignature } from "@/server/photo/signature";
import { readFileForActor, storeFile } from "@/server/services/files";
import { reviewOvertime, submitOvertime } from "@/server/services/overtime";
import { approveRun, createRun, getRun, issueRun, submitRun } from "@/server/services/payroll";
import { getRunPayslips } from "@/server/services/payslips";
import { renderPayslipsPdf } from "@/server/pdf/render";
import { confirmPayrollRules, getSettingsDto, setSignature, updateAttendancePolicy, updateCompany, updatePayrollRules } from "@/server/services/settings";
import { addAttendance, addComponent, resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

pinNow(); // tanggal tetap Maret 2026 + aturan lembur mundur 365 hari

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const dir = mkdtempSync(join(tmpdir(), "signer-"));
let k = 0;
const company = (over: Record<string, unknown> = {}) => ({
  name: "TRILOGIKA EDUTAMA (UJI)", legalName: null, tagline: "Light & Insight", address: "Alamat uji", phone: null, email: null, website: null,
  slipShowAttendance: true, slipFooterNote: null, slipNumberPrefix: "SG", slipSignerName: "Fawwaz Chaidir, S.Psi.", slipSignerTitle: "Chief Executive Officer", slipSignerPlace: "Yogyakarta", ...over,
});
const RULES = { lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false, overtimeMode: "APPROVED", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240 } as const;

async function uploadSignature(actor = fx.superAdmin) {
  const png = await normalizeSignature(await sharp({ create: { width: 500, height: 200, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><path d="M10 150 C80 10 140 190 220 80 S380 20 490 120" stroke="#1a2b6b" stroke-width="6" fill="none"/></svg>') }]).png().toBuffer());
  const file = await storeFile(actor, "SIGNATURE", { name: "tanda-tangan.png", bytes: png });
  await setSignature(actor, file.id);
  return file.id;
}
async function issue(label: string, start: string, end: string) {
  const { id } = await createRun(fx.hr, { label, periodStart: start, periodEnd: end });
  await submitRun(fx.hr, id); await approveRun(fx.superAdmin, id); await issueRun(fx.hr, id);
  const slips = await getRunPayslips(fx.hr, id);
  return slips.find((s) => s.snapshot.employee.employeeNo === "TE-001")!;
}
const pdfText = async (snapshot: Parameters<typeof renderPayslipsPdf>[0][number]["snapshot"]) => {
  const pdf = await renderPayslipsPdf([{ snapshot, voided: false }]);
  const f = join(dir, `s${k++}.pdf`); writeFileSync(f, pdf);
  const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f], { encoding: "utf8" }))![1]);
  const images = execFileSync("pdfimages", ["-list", f], { encoding: "utf8" }).split("\n").filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).length;
  return { text: execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }), pages, images };
};

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, { lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false });
  await updatePayrollRules(fx.superAdmin, { ...RULES });
  await confirmPayrollRules(fx.superAdmin);
  await addComponent(fx.empIds[0], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
});

describe("pengaturan penanda tangan (akses Super Admin)", () => {
  it("hanya Super Admin yang dapat mengubah nama/jabatan/kota & gambar; HR dan Karyawan ditolak; tercatat di audit", async () => {
    expect((await fail(updateCompany(fx.hr, company())))?.code).toBe("FORBIDDEN");
    expect((await fail(updateCompany(fx.emp1, company())))?.code).toBe("FORBIDDEN");
    await updateCompany(fx.superAdmin, company());
    expect((await getSettingsDto(fx.hr)).slip.signer).toEqual({ name: "Fawwaz Chaidir, S.Psi.", title: "Chief Executive Officer", place: "Yogyakarta", signatureUrl: null });
    expect(await prisma.auditLog.count({ where: { action: "settings.company_update" } })).toBe(1);

    const id = await uploadSignature();
    expect((await getSettingsDto(fx.superAdmin)).slip.signer.signatureUrl).toBe(`/api/files/${id}`);
    expect((await fail(storeFile(fx.hr, "SIGNATURE", { name: "x.png", bytes: await sharp({ create: { width: 100, height: 50, channels: 3, background: "#fff" } }).png().toBuffer() })))?.code).toBe("FORBIDDEN");
    expect((await fail(setSignature(fx.hr, id)))?.code).toBe("FORBIDDEN");
    expect((await fail(setSignature(fx.superAdmin, "00000000-0000-4000-8000-000000000000")))?.code).toBe("VALIDATION");
    expect(await prisma.auditLog.count({ where: { action: "settings.signature_update" } })).toBe(1);
    await setSignature(fx.superAdmin, null);
    expect((await getSettingsDto(fx.superAdmin)).slip.signer.signatureUrl).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "settings.signature_remove" } })).toBe(1);
  });

  it("panjang bidang dibatasi; berkas jenis lain tidak dapat dipasang sebagai tanda tangan; karyawan dapat memuat gambar (tampil di slipnya) tetapi tidak mengunggah", async () => {
    expect((await fail(updateCompany(fx.superAdmin, company({ slipSignerName: "x".repeat(121) }))))?.fieldErrors?.slipSignerName).toBeTruthy();
    const logo = await storeFile(fx.superAdmin, "LOGO", { name: "l.png", bytes: await sharp({ create: { width: 100, height: 100, channels: 3, background: "#c00" } }).png().toBuffer() });
    expect((await fail(setSignature(fx.superAdmin, logo.id)))?.code).toBe("VALIDATION");
    const id = await uploadSignature();
    expect((await readFileForActor(fx.emp1, id)).kind).toBe("SIGNATURE");
  });
});

describe("snapshot slip membekukan penanda tangan; PDF memuatnya", () => {
  it("slip terbit memuat nama/jabatan/kota & gambar; mengubah pengaturan sesudahnya TIDAK mengubah slip lama, hanya slip baru", async () => {
    await updateCompany(fx.superAdmin, company());
    const sigId = await uploadSignature();
    const s1 = await issue("Gaji Maret 2026", "2026-03-01", "2026-03-31");
    expect(s1.snapshot.signer).toEqual({ name: "Fawwaz Chaidir, S.Psi.", title: "Chief Executive Officer", place: "Yogyakarta", signatureFileId: sigId });

    await updateCompany(fx.superAdmin, company({ slipSignerName: "Rudi Hartono", slipSignerTitle: "Direktur Operasional", slipSignerPlace: "Sleman" }));
    await setSignature(fx.superAdmin, null);
    const s2 = await issue("Gaji April 2026", "2026-04-01", "2026-04-30");
    expect(s2.snapshot.signer).toEqual({ name: "Rudi Hartono", title: "Direktur Operasional", place: "Sleman", signatureFileId: null });

    const old = (await getRunPayslips(fx.hr, s1.dto.runId)).find((s) => s.snapshot.employee.employeeNo === "TE-001")!;
    expect(old.snapshot.signer?.name).toBe("Fawwaz Chaidir, S.Psi."); // tidak berubah

    const a = await pdfText(old.snapshot), b = await pdfText(s2.snapshot);
    expect(a.text).toContain("Fawwaz Chaidir, S.Psi."); expect(a.text).toContain("Chief Executive Officer"); expect(a.text).toContain("Yogyakarta, 1");
    expect(b.text).toContain("Rudi Hartono"); expect(b.text).not.toContain("Fawwaz");
    expect(a.images - b.images, "slip lama memuat gambar tanda tangan, slip baru tidak").toBe(1);
    expect([a.pages, b.pages]).toEqual([1, 1]);
  });

  it("tanpa nama penanda tangan → tidak ada blok tanda tangan di slip; kolom CATATAN tetap ada dan memuat catatan item", async () => {
    await updateCompany(fx.superAdmin, company({ slipSignerName: "", slipSignerTitle: "", slipSignerPlace: "" }));
    await uploadSignature(); // gambar saja tanpa nama tidak dipakai
    const { id } = await createRun(fx.hr, { label: "Gaji Maret 2026", periodStart: "2026-03-01", periodEnd: "2026-03-31" });
    const item = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!;
    const { setSlipNote } = await import("@/server/services/payroll");
    await setSlipNote(fx.hr, item.id, { note: "Pertahankan kinerja Anda; ketepatan waktu perlu ditingkatkan." });
    await submitRun(fx.hr, id); await approveRun(fx.superAdmin, id); await issueRun(fx.hr, id);
    const s = (await getRunPayslips(fx.hr, id)).find((x) => x.snapshot.employee.employeeNo === "TE-001")!;
    expect(s.snapshot.signer).toBeNull();
    const r = await pdfText(s.snapshot);
    expect(r.text).toContain("CATATAN");
    expect(r.text.replace(/\s+/g, " ")).toContain("Pertahankan kinerja Anda; ketepatan waktu perlu ditingkatkan.");
    expect(r.text).not.toContain("Chief Executive Officer");
    expect(r.pages).toBe(1);
  });
});

describe("lembur pada ringkasan kehadiran slip", () => {
  it("lembur disetujui & terbukti dibayar → menit tersimpan di snapshot dan tampil 'Lembur dibayar'; tanpa lembur → 0 tampil '-'", async () => {
    await updateCompany(fx.superAdmin, company());
    await addAttendance(fx.empIds[0], "2026-03-03", "08:00", "18:10"); // 130 menit setelah jam pulang
    const o = await submitOvertime(fx.emp1, { date: "2026-03-03", startTime: "16:00", minutes: 120, reason: "Menyelesaikan laporan akhir bulan" });
    await reviewOvertime(fx.hr, o.id, { decision: "APPROVE" });
    const s = await issue("Gaji Maret 2026", "2026-03-01", "2026-03-31");
    expect(s.snapshot.overtimePaidMinutes).toBe(120);
    const r = await pdfText(s.snapshot);
    expect(r.text).toMatch(/Lembur dibayar[\s\S]*2\s?j/);
    expect(r.text).toContain("Lembur (disetujui)");

    const none = await issue("Gaji April 2026", "2026-04-01", "2026-04-30");
    expect(none.snapshot.overtimePaidMinutes === 0 || none.snapshot.overtimePaidMinutes == null).toBe(true);
  });
});
