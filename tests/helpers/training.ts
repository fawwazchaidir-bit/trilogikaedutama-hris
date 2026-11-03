import { prisma } from "@/server/db";
import type { Actor } from "@/server/actor";
import { isoToDate } from "@/server/json";
import { addDays, todayIso } from "@/lib/time";
import type { TrainingLevel } from "@/lib/training/types";
import { makeEmployee, makeUser, seedFixtures, type Fixtures } from "./db";

export const TODAY = () => todayIso("Asia/Jakarta");
export const inDays = (n: number) => addDays(TODAY(), n);

export interface TrainingFixtures extends Fixtures {
  /** Manajer Program: level MANAGER, EMPLOYEE secara global. */
  mgr: Actor; mgrEmp: string;
  /** Admin Program: level ADMIN_PROGRAM. */
  adm: Actor; admEmp: string;
  /** Pemantau: level VIEWER. */
  viewer: Actor;
  /** Karyawan biasa tanpa level & tanpa keanggotaan (Fixtures.emp1..3 adalah karyawan biasa yang dapat dijadikan anggota). */
  loner: Actor; lonerEmp: string;
}

async function grant(userId: string, level: TrainingLevel, by: string) {
  await prisma.trainingAccess.create({ data: { userId, level, grantedById: by } });
}

/** Fixtures HRIS + akun Training & Operations. Role GLOBAL semuanya EMPLOYEE: izin berasal murni dari level modul / peran proyek. */
export async function seedTraining(): Promise<TrainingFixtures> {
  const fx = await seedFixtures();
  const e1 = await makeEmployee({ employeeNo: "TE-010", fullName: "Maya Manajer", position: "Manajer Operasional & Keuangan", divisionId: fx.divisionA });
  const e2 = await makeEmployee({ employeeNo: "TE-011", fullName: "Andi Admin", position: "Supervisor Administrasi & Kurikulum", divisionId: fx.divisionA });
  const e3 = await makeEmployee({ employeeNo: "TE-012", fullName: "Vina Viewer", position: "Manajer Marketing & Relations", divisionId: fx.divisionB });
  const e4 = await makeEmployee({ employeeNo: "TE-013", fullName: "Lola Loner", position: "Staf Social Media", divisionId: fx.divisionB });
  const mgr = await makeUser("maya@uji.test", "Maya Manajer", "EMPLOYEE", e1.id);
  const adm = await makeUser("andi@uji.test", "Andi Admin", "EMPLOYEE", e2.id);
  const viewer = await makeUser("vina@uji.test", "Vina Viewer", "EMPLOYEE", e3.id);
  const loner = await makeUser("lola@uji.test", "Lola Loner", "EMPLOYEE", e4.id);
  await grant(mgr.userId, "MANAGER", fx.superAdmin.userId);
  await grant(adm.userId, "ADMIN_PROGRAM", fx.superAdmin.userId);
  await grant(viewer.userId, "VIEWER", fx.superAdmin.userId);
  return { ...fx, mgr, mgrEmp: e1.id, adm, admEmp: e2.id, viewer, loner, lonerEmp: e4.id };
}

/** Surat tugas minimal langsung ke tabel (menghindari ketergantungan ke alur penerbitan HRIS yang tidak diuji di sini). */
export async function makeLetter(issuedById: string, seq = 1) {
  return prisma.assignmentLetter.create({
    data: {
      seqYear: 2026, seqNo: seq, number: `${String(seq).padStart(3, "0")}/ST/XI/2026`, status: "ISSUED", purpose: "Pendampingan pelatihan", destination: "Bandung",
      startDate: isoToDate("2026-11-02"), endDate: isoToDate("2026-11-06"), issueDate: isoToDate("2026-11-01"), snapshot: {}, issuedById,
    },
  });
}

/** Bytes PDF minimal yang lolos pemeriksaan magic bytes (%PDF-). */
export const PDF = () => new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"));

import { createProject, addMember } from "@/server/services/training/projects";
import type { ProjectRole } from "@/lib/training/types";

/** Manajer membuat proyek (Draf, bertanggal) dan mengembalikan id-nya. */
export async function mkProject(actor: Actor, over: Record<string, unknown> = {}): Promise<string> {
  const r = await createProject(actor, { name: "Pelatihan Digital Marketing", kind: "REGULAR", startDate: inDays(3), endDate: inDays(5), ...over });
  return r.id;
}

/** Tambah anggota [employeeId, peran] oleh `by` (default: tidak diset → pemanggil wajib memberi Manajer). */
export async function addTeam(by: Actor, projectId: string, members: [string, ProjectRole][]): Promise<void> {
  for (const [employeeId, role] of members) await addMember(by, projectId, { employeeId, role });
}
