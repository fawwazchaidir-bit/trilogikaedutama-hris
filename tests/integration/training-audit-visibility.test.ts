/**
 * Pembatasan data peserta berlaku di SEMUA jalur baca, termasuk audit proyek: Riwayat proyek dan "Aktivitas terbaru" di beranda Training.
 * Akun Magang tidak melihat baris peserta sama sekali; dokumen peserta (judulnya) hanya terlihat oleh yang berhak membukanya.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { makeUser, resetDb } from "../helpers/db";
import { addTeam, mkProject, PDF, seedTraining, type TrainingFixtures } from "../helpers/training";
import { addParticipant, updateParticipant, uploadDocument } from "@/server/services/training/operations";
import { createTask } from "@/server/services/training/work";
import { listProjectActivity } from "@/server/services/training/insights";
import { getTrainingHome } from "@/server/services/training/home";
import { auditVisibilityWhere, PARTICIPANT_AUDIT_PREFIX } from "@/server/services/training/shared";

let fx: TrainingFixtures; let pid: string; let magang: Actor;
const NAME = "Budi Rahasia Santoso";
const DOC = "KTP Budi Rahasia";

/** Seluruh baris Riwayat (semua halaman, halaman kecil agar paginasi ikut teruji). */
async function history(actor: Actor): Promise<{ rows: { action: string; summary: string | null }[]; total: number }> {
  const first = await listProjectActivity(actor, pid, 1, 3);
  const rows = [...first.items];
  for (let p = 2; p <= first.pageCount; p++) rows.push(...(await listProjectActivity(actor, pid, p, 3)).items);
  return { rows, total: first.total };
}
const mentions = (rows: { action: string; summary: string | null }[], needle: string) => rows.filter((r) => (r.summary ?? "").includes(needle));
const isParticipantRow = (r: { action: string }) => r.action.startsWith(PARTICIPANT_AUDIT_PREFIX);

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
  pid = await mkProject(fx.mgr);
  const e = await prisma.employee.create({ data: { employeeNo: "TE-090", fullName: "Mira Magang", position: "Magang Administrasi", employmentStatus: "INTERN", joinDate: isoToDate("2026-01-05"), divisionId: fx.divisionA } });
  magang = await makeUser("mira@uji.test", "Mira Magang", "EMPLOYEE", e.id);
  await addTeam(fx.mgr, pid, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"], [e.id, "STAFF"]]);
  await createTask(fx.mgr, pid, { title: "Siapkan ruang", assigneeId: fx.empIds[1], requiresReview: false });
  await uploadDocument(fx.mgr, pid, { name: "proposal.pdf", bytes: PDF() }, { category: "PROPOSAL", title: "Proposal Pelatihan" });
  // kegiatan yang memuat data peserta (nama, status, dokumen peserta)
  const p = await addParticipant(fx.mgr, pid, { fullName: NAME, email: "budi@x.test", phone: "081234567890" });
  await updateParticipant(fx.mgr, p.id, { status: "READY" });
  await updateParticipant(fx.mgr, p.id, { confirmed: true });
  await uploadDocument(fx.mgr, pid, { name: "ktp.pdf", bytes: PDF() }, { category: "PARTICIPANT_DOC", title: DOC });
});

describe("Riwayat proyek", () => {
  it("akun Magang tidak melihat baris peserta atau dokumen peserta; kegiatan lain tetap terlihat; total & halaman akurat", async () => {
    const m = await history(magang);
    expect(m.rows.filter(isParticipantRow)).toEqual([]);
    expect(mentions(m.rows, NAME)).toEqual([]);
    expect(mentions(m.rows, DOC)).toEqual([]);
    expect(JSON.stringify(m.rows)).not.toMatch(/budi@x\\.test|081234567890/);
    // kegiatan lain tetap tampil
    expect(mentions(m.rows, "dibuat").length).toBeGreaterThan(0);
    expect(mentions(m.rows, "Proposal Pelatihan").length).toBe(1);
    expect(mentions(m.rows, "Siapkan ruang").length).toBe(1);
    // total mengikuti baris yang terlihat (tidak membocorkan jumlah baris tersembunyi) dan konsisten dengan isi semua halaman
    expect(m.total).toBe(m.rows.length);
    const full = await history(fx.mgr);
    const hiddenCount = full.rows.filter((r) => isParticipantRow(r) || (r.summary ?? "").includes(DOC)).length;
    expect(hiddenCount).toBeGreaterThanOrEqual(5);                      // tambah, status, konfirmasi + dokumen peserta (+ perubahan data)
    expect(m.total).toBe(full.total - hiddenCount);
  });

  it("yang berhak tetap melihat nama peserta & dokumen peserta: Koordinator, PIC, Direktur", async () => {
    for (const a of [fx.mgr, fx.emp1, fx.superAdmin]) {
      const h = await history(a);
      expect(mentions(h.rows, NAME).length, `peserta terlihat oleh ${a.email}`).toBeGreaterThanOrEqual(3);
      expect(mentions(h.rows, DOC).length, `dokumen peserta terlihat oleh ${a.email}`).toBe(1);
    }
  });

  it("Staf non-magang dan Pemantau berhak melihat daftar peserta → nama terlihat; tetapi dokumen peserta (bukan pengelola peserta) tersembunyi", async () => {
    for (const a of [fx.emp2, fx.viewer]) {
      const h = await history(a);
      expect(mentions(h.rows, NAME).length, `peserta terlihat oleh ${a.email}`).toBeGreaterThanOrEqual(3);
      expect(mentions(h.rows, DOC), `dokumen peserta tersembunyi untuk ${a.email}`).toEqual([]);
      expect(mentions(h.rows, "Proposal Pelatihan").length).toBe(1);
    }
  });

  it("aksi audit peserta BARU otomatis tersaring lewat awalan (mis. impor), dan data audit aslinya tidak dihapus", async () => {
    await prisma.auditLog.create({ data: { action: "training.participant.import", entityType: "TrainingProject", entityId: pid, summary: `Impor peserta: ${NAME} dan 11 lainnya` } });
    expect(mentions((await history(magang)).rows, "Impor peserta")).toEqual([]);
    expect(mentions((await history(fx.mgr)).rows, "Impor peserta").length).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: pid, action: { startsWith: PARTICIPANT_AUDIT_PREFIX } } })).toBeGreaterThanOrEqual(5);
  });
});

describe("Beranda Training — aktivitas terbaru", () => {
  it("akun Magang: tidak ada baris peserta/dokumen peserta, tetapi feed tetap terisi dari kegiatan lain", async () => {
    const act = (await getTrainingHome(magang)).activity;
    expect(act.length).toBeGreaterThan(0);
    expect(act.filter((a) => a.action.startsWith(PARTICIPANT_AUDIT_PREFIX))).toEqual([]);
    expect(act.filter((a) => a.summary.includes(NAME) || a.summary.includes(DOC))).toEqual([]);
  });

  it("Koordinator & PIC melihat baris peserta dan dokumen peserta; Staf non-magang melihat peserta tetapi bukan dokumen peserta", async () => {
    const mgr = (await getTrainingHome(fx.mgr)).activity;
    expect(mgr.some((a) => a.summary.includes(DOC))).toBe(true);        // dokumen peserta = kejadian terbaru
    expect(mgr.some((a) => a.summary.includes(NAME))).toBe(true);
    const pic = (await getTrainingHome(fx.emp1)).activity;               // PIC: pengelola peserta pada proyek ini
    expect(pic.some((a) => a.summary.includes(DOC))).toBe(true);
    const staff = (await getTrainingHome(fx.emp2)).activity;
    expect(staff.some((a) => a.summary.includes(DOC))).toBe(false);
    expect(staff.some((a) => a.summary.includes(NAME))).toBe(true);
  });
});

describe("pembangun filter", () => {
  it("tidak menyaring apa pun bila pelaku berhak penuh", () => {
    expect(auditVisibilityWhere({ viewParticipants: true, manageAll: true })).toBeNull();
  });
  it("tanpa hak lihat peserta → menyaring awalan aksi peserta", () => {
    expect(JSON.stringify(auditVisibilityWhere({ viewParticipants: false, manageAll: true }))).toContain(PARTICIPANT_AUDIT_PREFIX);
  });
});
